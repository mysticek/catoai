# Cato — Overnight Plan & Standing Bar

The mandate (from the owner, going to sleep): build a serious chunk autonomously, secure
and tested, so it's safe to wake up to. This file is the execution checklist + the
**standing quality/security bar** every future change must meet.

## Standing bar (always)
- **TypeScript tip-top**: strict, **no `any`**, precise types, small focused files (no
  god-files like a 400-line `server.ts`). Split by responsibility.
- **Tested**: unit tests for logic, integration/E2E for protocol + crypto. Green before commit.
- **Context7 for every library**: check latest docs/versions before using a lib.
- **Security first**: brutally hard to break, but **dead-easy for the user** (QR pairing).
  End-to-end encrypted. Local-first; remote via Relay with real accounts.
- **Cross-platform target**: macOS, Linux, Windows (agent); iOS + Android (app), store-ready.
- **Easy to operate**: clear logs, `cato doctor`, obvious "what does what", debuggable.

## Honest scope (what needs the owner / can't be done overnight)
- App Store / Play Store submission: needs Apple Developer + Google Play accounts, signing,
  review. → I prepare configs/builds + checklist; you submit.
- Cato Relay **deploy**: needs a hosted server + OAuth apps (Google/GitHub) + APNs key +
  domain. → I build the code + design; you provision + deploy.
- On-device iOS/Android verification: needs your phones + a rebuild. → I make it compile,
  bundle, and unit-test the shared logic; you smoke-test on device.

---

## Tonight — phased (commit after each, all green)

### Phase 1 — Security: lock the LAN  `[in progress]`
- [x] Onboarding gate: app blocks un-secured machines; `/info` reports onboarded+secured.
- [x] Per-machine token pairing; prompt on `unauthorized`; gate sheet on `not_set_up`.
- [x] Privileged HTTP (`/folders`) requires the token; WS refuses until `cato setup`.
- [x] PreToolUse hook is **localhost-only** (no LAN-injected fake approvals).
- [ ] Rate-limit + lockout on failed token attempts (per IP).
- [ ] Bind WS to a chosen interface (setting); default LAN, not blind 0.0.0.0.

### Phase 2 — End-to-end encryption + QR pairing  `[next]`
- [ ] `@cato/shared` crypto module: X25519 + XSalsa20-Poly1305 (NaCl, via tweetnacl —
  pure JS, runs in Node + RN). Fully typed, **no any**, unit-tested round-trips.
- [ ] Handshake: agent has a long-term keypair (~/.cato/keys); `cato setup` emits a QR
  payload `{addr, machineId, pubkey, token}`. Phone scans → has pubkey+token. Authenticated
  key exchange → per-session shared key → every WS frame encrypted (nonce + box).
- [ ] Agent: wrap the WS transport in the encrypted layer; reject unencrypted frames once
  secured. Test with a Node client doing the full handshake (E2E, verifiable here).
- [ ] Mobile: same crypto; QR scan (expo-camera) with manual-token fallback. (Device test
  needed; logic unit-tested.)
- [ ] Same E2E layer is reused over Relay later (relay = dumb encrypted pipe).

### Phase 3 — Refactor agent into small, typed modules  `[ ]`
- [ ] Split `ws/server.ts` → `ws/http-routes.ts`, `ws/connection.ts`, `ws/frames.ts`,
  `ws/security.ts`, thin `ws/server.ts`. No `any`, precise message types from `@cato/shared`.
- [ ] Tighten the WS message handling with a typed dispatcher (discriminated unions).
- [ ] Unit tests per module (routing, auth, crypto, frame encode/decode).

### Phase 4 — Reliability for friends  `[ ]`
- [ ] Mobile auto-reconnect (exponential backoff) + replay pending on reconnect.
- [ ] `cato doctor`: models? ollama up? whisper? port free? token set? workspace exists?
- [ ] Agent supervises ollama/whisper; degrades gracefully if missing (no crash).
- [ ] `capture_line` retention/pruning.

### Phase 5 — Relay (design + code, no deploy)  `[ ]`
- [ ] `docs/RELAY.md`: accounts (Google/GitHub/email), device registry, presence,
  zero-knowledge bridge (reuse Phase-2 E2E), APNs, Stripe. Wire protocol.
- [ ] Agent `relay.enabled` outbound stub; phone account-stub. (No live backend.)

### Phase 6 — Quality gates  `[ ]`
- [ ] GitHub Actions CI: typecheck + build + test on push.
- [ ] `docs/SECURITY.md`: threat model, what's encrypted, pairing, what an attacker can't do.

### Phase 7 — White-hat audit  `[ ]`
- [ ] Adversarial pass (separate focused agent): try to break auth, sniff, replay, escape
  the workspace sandbox, inject approvals, MITM the handshake, downgrade to plaintext,
  brute-force the token. Fix everything found. E2E verify.

---

## Cross-platform / store-readiness checklist (track, finish with owner)
- iOS: expo prebuild clean, permissions (mic, local network, camera for QR), icons/splash,
  TestFlight build, App Store metadata. Needs Apple Developer acct.
- Android: permissions (record audio, internet, multicast, camera), adaptive icon, AAB,
  Play internal track. Needs Play Console acct.
- Agent: macOS (launchd) ✓, Linux (systemd) ✓, Windows (WSL / Task Scheduler) — verify.
- Pure-JS/WASM deps only where possible (PGlite ✓, tweetnacl ✓) to keep it portable.
