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
3. **End-to-end encryption.** The phone pins the agent's public key (QR or `/info`) and
   uses `secure.hello`: it seals the token to that key with an **ephemeral** key
   (X25519), so the **token is never in clear on the wire**, the agent is authenticated
   (pinned key ⇒ no MITM), and a per-session key encrypts every subsequent frame
   (XSalsa20‑Poly1305). Tampered/forged frames fail closed.
4. **The approval hook is localhost-only.** `POST /hooks/pretooluse` (how Claude asks
   permission) is rejected unless it comes from `127.0.0.1` — a LAN attacker cannot inject
   fake "approve rm -rf?" prompts to your phone.
5. **Workspace sandbox.** Folder browse/create resolve under the configured workspace root
   and **refuse `../` escapes**.
6. **Secrets at rest.** The agent's secret key (`~/.cato/keys.json`) is `chmod 600`.

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

## Known gaps / hardening backlog
- Forward secrecy: the agent uses a long-term key (phone side is ephemeral). v2: ephemeral
  on both sides with the long-term key only signing the handshake.
- Explicit **device approval list** on the desktop (confirm a new phone), revoke devices —
  so a leaked token on a *new* device still needs desktop confirmation.
- Bind to a chosen interface by default (not blind `0.0.0.0`).
- Secret **redaction** in captured output before it's stored / sent.

## Verify it yourself
`cato doctor` checks onboarding + that a real token replaced the default. The crypto and
gating are unit- + E2E-tested (`packages/desktop-agent/test/crypto.test.ts`, and the live
handshake test). A white-hat audit pass is tracked in `docs/NIGHT-PLAN.md` §7.
