# Cato — Security Model

Cato is, in effect, a remote control for your machine: connected clients can read terminal
output and start/▶ approve agent actions that run commands. So the link must be hard to
break. This documents what's protected, how, and what an attacker can and cannot do.

## Threat model
- **Adversary on the same Wi‑Fi** (coffee shop, office, home guest): can see traffic and
  reach the agent's port. Primary threat for the local mode.
- **Adversary on the internet** (relay mode, future): can reach the relay.
- **Goal of the attacker**: connect to your agent, read your code/terminal, inject
  approvals, or run commands. We must make all of these infeasible.

## Local (same network) — what's enforced today
1. **No anonymous access.** Until you run `cato setup`, the agent is *unsecured*: every
   privileged endpoint is disabled. Only `GET /info` (identity + `onboarded`/`secured`
   flags + public key) is public, so the phone can *show* the machine and say "finish
   setup" — but it cannot browse folders, spawn agents, or open a session.
2. **Pairing token.** `cato setup` generates a strong token. The WebSocket `hello`
   (and HTTP `/folders`) require it; wrong/absent token ⇒ rejected. **Rate-limited**:
   5 bad attempts per IP → 30s lockout (defeats brute force).
3. **End-to-end encryption, enforced on the network.** The phone pins the agent's public
   key (QR; or `/info` as trust-on-first-use) and uses `secure.hello`: it seals the token
   to that key with an **ephemeral** key (X25519), so the **token is never in clear on the
   wire**, the agent is authenticated (pinned key ⇒ no MITM), and a per-session key
   encrypts every subsequent frame (XSalsa20‑Poly1305). Tampered/forged frames fail closed.
   **Plaintext `hello` is refused for any non-loopback peer** (`encryption_required`) — only
   the local dashboard on `127.0.0.1` may speak plaintext. So all network traffic is E2E.
4. **The approval hook is locked down.** `POST /hooks/pretooluse` (how Claude asks
   permission) requires both a **loopback source** AND a **per-run hook secret**
   (`~/.cato/hook-secret`, shared only with Cato's own hook) — so neither a LAN attacker nor
   another local process can inject fake "approve rm -rf?" prompts.
5. **Workspace sandbox.** Folder browse/create **and `worker.spawn`** resolve under the
   configured workspace root and **refuse `../` escapes** (an agent can't be launched
   outside your workspace).
6. **Resource limits.** WS `maxPayload` + HTTP body cap (8 MiB) so an unauthenticated caller
   can't exhaust memory. Token attempts are rate-limited per IP, and a **correct** token is
   never penalized by another peer's lockout.
7. **Secrets at rest.** The agent's secret key (`~/.cato/keys.json`) and the hook secret are
   `chmod 600`.

### What an attacker on your Wi‑Fi can / cannot do
- ✅ See that a machine exists (`/info`: name, platform, "secured"). That's all.
- ❌ Open a session (needs the token; brute-force rate-limited; token is encrypted in the
  handshake so sniffing the wire doesn't reveal it).
- ❌ Read traffic (E2E encrypted once paired).
- ❌ Impersonate the agent / MITM (phone pins the agent's public key).
- ❌ Inject approvals (hook is localhost-only).
- ❌ Escape the workspace folder.

## Remote (Cato Relay) — design (not yet deployed)
- **Accounts** (Google / GitHub / email) on a hosted auth backend; an account **owns**
  its desktops + phones. The relay only bridges devices of the **same account**.
- The relay is a **zero-knowledge** pipe: the SAME end-to-end encryption as local runs
  over it, so the relay/back-end never see terminal output, code, or memory — only routing.
- Desktop connects **outbound** (NAT-friendly) with a per-device key minted at pairing.
- **APNs** push for approvals/alerts when the app is closed.
See `docs/ROADMAP.md` §1.

## Audited
A white-hat pass (see `docs/NIGHT-PLAN.md` §7) probed auth bypass, brute force, plaintext
downgrade, MITM, replay, sandbox escape, and hook injection. It confirmed the sandbox,
rate-limiter, unsecured-gating, hook localhost check, and crypto are solid, and found three
real gaps that are now **fixed + re-verified**: encryption is enforced on the network (was
optional), `worker.spawn` is sandboxed (was not), and the hook requires a secret (was
localhost-only). Body caps + the rate-limit self-DoS were also fixed.

## Known gaps / hardening backlog
- **Replay window**: handshakes have no nonce cache (a replayed `secure.hello` yields an
  unusable socket — the replayer lacks the ephemeral secret — and cross-socket frame replay
  is already blocked, but add a one-time-use nonce window for defense in depth).
- **TOFU vs QR**: pinning the key from `/info` is trust-on-first-use (an active MITM could
  swap it). **Prefer QR pairing** (out-of-band); consider requiring QR for first pair.
- Forward secrecy: agent uses a long-term key (phone side is ephemeral). v2: ephemeral on
  both sides, long-term key only signs the handshake.
- Explicit **device approval list** on the desktop (confirm a new phone), revoke devices.
- Bind to a chosen interface by default (not blind `0.0.0.0`).
- Secret **redaction** in captured output before it's stored / sent.
- `/info` advertises the real hostname (may carry a person's name) — offer a generic name.

## Verify it yourself
`cato doctor` checks onboarding + that a real token replaced the default. The crypto and
gating are unit- + E2E-tested (`packages/desktop-agent/test/crypto.test.ts`, and the live
handshake test). A white-hat audit pass is tracked in `docs/NIGHT-PLAN.md` §7.
