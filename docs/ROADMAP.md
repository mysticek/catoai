# Cato — Roadmap, Security & Backlog

> Working brainstorm + prioritized backlog. Living document. The north star: Cato is a
> voice-first, local-first command center for AI coding agents that is **secure by
> default**, trivially installable, and works from anywhere via an optional paid relay.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `(P0/P1/P2)` priority.

---

## 0. The two glaring gaps to close first (security)

Today the local link is **wide open**: the desktop agent serves WebSocket + HTTP on
`0.0.0.0:8787` and the only check is a shared `pairingToken` that defaults to `changeme`.
That means:

1. **Anyone on the same Wi‑Fi** can hit `http://<ip>:8787/info`, see the machine, and —
   if the token is still the default — open a WS and drive the agent. No account, no
   per-device pairing, no encryption (plaintext `ws://`).
2. **No onboarding gate**: the phone happily browses the workspace folder tree before the
   user has set anything up or approved the device on the machine.

### Security model we want

**Local (same network):**
- `cato setup` generates a strong **pairing token** (done) → `secured = true`. Until then
  the agent is **not secured** and must not expose the workspace.
- The agent advertises only **identity + status** publicly (`/info`: id, host, platform,
  `onboarded`, `secured`) so the phone can *show* a machine and its state — but **every
  privileged endpoint requires the token**: WS `hello`, `/folders`, `worker.spawn`,
  approvals, voice.
- The phone stores a **per-machine token** (from `cato setup`, entered once / QR). On
  `unauthorized` it prompts for the token. Wrong/missing token ⇒ no access.
- **Device approval on the desktop**: first time a new phone pairs, the agent shows/logs a
  pairing request the user confirms (so a stolen token alone on a new device still needs
  desktop confirmation). MVP: token is enough; v2: explicit device-approval list.
- **Encryption on the LAN**: `ws://` is plaintext → the token and all traffic are
  sniffable. Options (pick one):
  - (a) **Noise/`libsodium` channel**: ECDH handshake keyed by the pairing token (or a
    QR-exchanged key), then encrypt every frame. No TLS certs, works on a LAN. *Preferred.*
  - (b) **TLS (`wss://`)** with a self-signed cert the phone pins on pairing. More moving
    parts (cert lifecycle, trust).
- **Rate-limit + lockout** on `hello` token attempts; bind WS to the LAN by default
  (configurable), not `0.0.0.0` blindly.

**Remote (Cato Relay, paid):**
- Real **accounts** (Google / GitHub / email magic-link) on a hosted auth backend.
- Account **owns devices**: desktop agents + phones register to the account; the relay only
  bridges a phone to a desktop that belongs to the **same account**.
- All relay traffic **end-to-end encrypted** so the relay can't read terminal output /
  code (zero-knowledge bridge). Relay sees only routing metadata.
- Desktop connects **outbound** to the relay (NAT-friendly), authenticated by a per-device
  key minted at pairing. Phone likewise. Relay matches them by account + device grant.

### Tasks
- [x] (P0) `/info` + `welcome` report `onboarded` + `secured`.
- [x] (P0) Phone **onboarding gate**: refuse to browse/connect a machine that isn't
  onboarded; show "finish setup on this machine".
- [x] (P0) Per-machine **token** in the app: store, send, prompt on `unauthorized`, retry.
- [ ] (P0) Agent: token required on **all** privileged endpoints (`/folders`,
  `worker.spawn` already gated by WS auth; HTTP `/folders` currently open → gate it).
- [ ] (P0) Agent: refuse the default `changeme` token for WS (force setup) once a real
  token exists; rate-limit failed `hello`.
- [ ] (P1) **Encryption** of the local channel (Noise via libsodium keyed by token/QR).
- [ ] (P1) **Device approval** list on the desktop (confirm a new phone), revoke devices.
- [ ] (P1) QR pairing: `cato setup` prints a QR (token + address + key); phone scans.
- [ ] (P2) Bind to LAN interface by default; setting to widen.

---

## 1. Cato Relay (the paid tier) — full design

Goal: control your desktop agents **from anywhere**, with push notifications even when the
app is closed. This is the monetizable layer; local stays free.

### Components
- **Auth backend** (hosted): accounts, sessions, OAuth (Google, GitHub), email magic-link.
  Stack candidate: a small service (Node/Bun + Postgres) or Supabase (Auth + Postgres +
  Edge Functions) to move fast. Issues JWTs.
- **Relay service** (hosted, stateless bridge): authenticated WebSocket fan-in/out that
  pairs a phone session to a desktop session of the **same account**. Holds no plaintext.
- **Desktop agent**: optional outbound connection to the relay (`relay.enabled`), registers
  a device key, multiplexes the existing protocol over the relay link.
- **Phone**: signs in to the account; lists the account's online desktops; connects via
  relay; receives **APNs** push for approvals/alerts.
- **Billing**: Stripe subscription gating relay + push (€6/mo placeholder). Free local
  forever.

### Push (APNs) — the un-bypassable value
- Apple Developer account + APNs auth key. Phone registers a device token with the backend.
- Agent → backend "approval needed / alert" → backend → APNs → phone (even app closed).
- Notification actions (Approve / Deny / Review) handled to deep-link into the app.
- Android later: FCM.

### Privacy / zero-knowledge
- E2E encrypt the bridged stream (account-scoped keys exchanged at device pairing) so the
  relay/back-end never see terminal output, code, or memory — only routing.

### Tasks
- [ ] (P1) Auth backend: schema (users, devices, sessions, subscriptions), OAuth Google +
  GitHub, email magic-link, JWT issuance.
- [ ] (P1) Relay service: account-scoped bridge, device registry, online presence.
- [ ] (P1) Desktop: `relay.enabled`, outbound connect, device key, transport multiplexing.
- [ ] (P1) Phone: account sign-in (Google/GitHub/email), device list, relay connect.
- [ ] (P1) APNs: backend push pipeline + phone registration + notification actions.
- [ ] (P1) E2E encryption of the relayed stream (zero-knowledge relay).
- [ ] (P2) Stripe billing + entitlement checks (relay/push behind subscription).
- [ ] (P2) Team accounts: shared memory, multiple seats (later monetization).

---

## 2. Onboarding (desktop-first)

- [x] `cato setup` (workspace root + pairing token → ~/.cato/config.json), auto on first
  `cato`, and from install.sh.
- [ ] (P0) Phone **must** show machine onboarding state and block until done (see §0).
- [ ] (P1) `cato setup` prints a **QR** (address + token [+ key]) for one-scan pairing.
- [ ] (P1) `cato doctor` — diagnose: models present? ollama up? whisper ok? port free?
  token set? workspace exists? Print fixes.
- [ ] (P1) Multiple workspace roots (list) instead of a single root.
- [ ] (P2) macOS TCC guidance when the chosen root is under Documents/Desktop.

---

## 3. Reliability & robustness

- [ ] (P0) Mobile auto-reconnect (exponential backoff) + reconnect/replay UI (design has
  the screen). Today reconnection is manual after agent restart.
- [ ] (P1) Agent crash-safety: supervise whisper-server / ollama; restart if they die.
- [ ] (P1) `capture_line` **retention/pruning** (it's the growth driver even locally).
- [ ] (P1) Approval **anti-fatigue** verified on real Claude: deny+reason adaptation,
  allow-always / allow-session lifetimes (clear session rules on worker stop).
- [ ] (P1) Worker recovery tested on real claude/codex (not just `cat`).
- [ ] (P2) Graceful handling when ollama/whisper models are missing (degrade, don't crash).
- [ ] (P2) Structured logging + a `cato logs` tail.

---

## 4. Desktop dashboard (mission control)

Designed in Cato.dc.html; a separate Claude is scaffolding `packages/dashboard` / web.
- [ ] (P1) Grid of agents/projects with live preview.
- [ ] (P1) Approvals panel with full syntax-highlighted diff + deny-with-reason.
- [ ] (P1) Timeline of events; Memory search (semantic).
- [ ] (P1) Project/task detail (workers over time, crashes, recoveries).
- [ ] (P1) Served locally by the agent (static + WS), gated by the same token.

---

## 5. Mobile app polish (post-redesign)

- [x] Four-tab redesign, approval flows, pair screen with mDNS discovery, keyboard-safe.
- [ ] (P1) **Token entry / QR scan** in pairing (ties to §0).
- [ ] (P1) Pull-to-refresh on the machine list; **swipe-to-delete** a saved machine.
- [ ] (P1) Push notification → tap → decide flow (needs relay/APNs).
- [ ] (P1) Per-project actions on cards (mic/bell/speaker in the design).
- [ ] (P2) "How is X doing" live tail screen; activity feed filters by project.
- [ ] (P2) Haptics on approve/deny; large-type / accessibility pass.
- [ ] (P2) Continuous (hands-free) voice mode; "thinking" latency states.

---

## 6. Agent intelligence & coverage

- [ ] (P1) **Codex parity**: verify approvals via screen-scrape (no hook) + capture on a
  real codex run; the question-detector should catch its menu prompts.
- [ ] (P1) Multi-worker reality: several real agents at once, accurate per-project status.
- [ ] (P1) LLM-parsed structured cards everywhere (approvals summary+suggestions done;
  extend to activity feed + suggested next actions).
- [ ] (P2) Better Slovak output quality (bigger model option, prompt tuning).
- [ ] (P2) Proactive "suggested next actions" surfaced as tappable chips.

---

## 7. Memory & sync

- [ ] (P1) Keep full DB local (PGlite, done). Define the **curated memory** subset
  (embeddings + events + project metadata, NOT raw capture) for optional cloud sync.
- [ ] (P2) Cross-device memory via relay (account-scoped, E2E encrypted).
- [ ] (P2) Memory management UI: view/edit/forget; importance decay.

---

## 8. Distribution & cross-platform

- [x] One-command install (curl|bash), embedded DB (no Docker), OS-aware package install,
  launchd + systemd daemon.
- [ ] (P1) **Homebrew tap** (`brew install cato`).
- [ ] (P1) Mobile **TestFlight** for friends.
- [ ] (P2) Linux/Windows end-to-end verification (tmux→WSL on Windows, TTS adapters).
- [ ] (P2) Signed/notarized macOS distribution if a native wrapper appears.

---

## 9. Quality: tests, CI, observability

- [x] Unit tests (importance, phrasing, approvals scopes).
- [ ] (P1) Integration tests for the WS protocol + PGlite memory engine.
- [ ] (P1) GitHub Actions CI: typecheck + build + test on push.
- [ ] (P2) Mobile E2E smoke (Metro bundle in CI; Detox later).
- [ ] (P2) Crash/error telemetry (opt-in, privacy-respecting).

---

## Tonight's focus (this PR)
1. `docs/ROADMAP.md` (this file).
2. (P0) Security core: `/info` onboarded+secured, phone onboarding gate, per-machine token
   pairing with prompt-on-unauthorized, gate the HTTP `/folders` endpoint behind the token.
3. Everything else above is queued and specced for the next sessions.
