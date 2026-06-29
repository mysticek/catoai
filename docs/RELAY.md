# Cato Relay — Remote access (design)

Local Cato is free and works on your Wi‑Fi. **Cato Relay** is the paid tier that lets you
reach your desktop agents **from anywhere** and get **push notifications** even when the app
is closed — without weakening the security model. This is the design to implement + deploy
(deploy needs the owner's accounts: a host, OAuth apps, an Apple Push key, a domain).

## Principles
- **Zero-knowledge bridge.** The relay only routes bytes. The SAME end-to-end encryption as
  local (see `docs/SECURITY.md`) runs over the relay, so the relay/back-end never see
  terminal output, code, or memory — only which device talks to which.
- **Account owns devices.** A user signs in (Google / GitHub / email magic-link). Their
  account owns desktop agents and phones. The relay bridges a phone to a desktop **only if
  both belong to the same account**.
- **Local stays free & primary.** Relay is opt-in; nothing about the local path changes.

## Components
1. **Auth + control backend** (hosted). Postgres + a small API (Node/Bun, or Supabase to
   move fast: Auth + Postgres + Edge Functions).
   - Tables: `user`, `device` (id, user_id, kind=desktop|phone, pubkey, name, push_token,
     created_at, last_seen), `pairing_grant` (account-scoped device approvals), `subscription`.
   - OAuth: Google, GitHub. Email: magic-link. Issues short-lived JWTs.
2. **Relay service** (hosted, stateless). Authenticated WebSocket. Maintains presence
   (which devices are online) and bridges two sockets of the same account. Holds no plaintext.
3. **Desktop agent**: `relay.enabled` → opens an **outbound** WS to the relay (NAT-friendly),
   authenticates with a per-device key minted at pairing, and tunnels the existing protocol
   (already E2E-encrypted) through it.
4. **Phone**: account sign-in → lists the account's online desktops → connects via relay →
   same encrypted session as local.
5. **Push (APNs)**: the un-bypassable value — approvals/alerts arrive even when the app is
   closed.

## Device pairing → account
- A desktop joins an account during `cato setup --relay` (or `cato relay login`): browser
  OAuth → backend mints a desktop device key + registers its pubkey.
- A phone joins via account sign-in; pairing a specific desktop still uses the **same QR /
  pinned-pubkey** flow so E2E keys are exchanged directly (relay never holds them).

## Wire protocol (relay)
- Devices authenticate to the relay with their JWT/device key.
- A phone requests `connect(desktopDeviceId)`; the relay checks same-account + online, then
  pipes frames both ways. Frames are already `enc` envelopes (opaque to the relay).
- Heartbeats for presence; the relay drops the pipe if either side disconnects.

## Push pipeline (APNs)
- Phone registers its APNs device token with the backend (per account).
- Agent → backend `notify(account, {kind: approval|alert, summary})` → backend → APNs →
  phone. Notification actions (Approve / Deny / Review) deep-link into the app.
- Payload carries only a short summary + an id; the phone fetches details over the encrypted
  session (no sensitive content in the push).
- Android later: FCM, same shape.

## Billing
- Stripe subscription gates relay + push (e.g. €6/mo). Free local forever.
- Backend checks entitlement before bridging / pushing.

## Security notes
- Relay compromise ⇒ attacker still can't read content (E2E) nor impersonate a device
  (per-device keys, account scoping).
- Stolen JWT ⇒ scope to short TTL + device binding; allow device revocation from the app.
- Rate-limit relay connects; abuse detection on the backend.

## What the owner must provision (can't be done overnight)
- A host for the backend + relay (Fly.io / Render / a VPS), a domain, TLS.
- Google + GitHub OAuth apps (client id/secret), email sending (magic-link).
- Apple Developer account + an APNs auth key (.p8) + the app's push entitlement.
- Stripe account + products.

## Build order (when ready)
1. Backend: accounts + OAuth + device registry (no relay yet).
2. Relay service: account-scoped bridge + presence.
3. Desktop `relay.enabled` outbound + phone account sign-in + device list.
4. APNs push pipeline + notification actions.
5. Stripe entitlements.

The transport encryption (`@cato/shared/crypto`) is already built and tested, so the relay
is a "dumb encrypted pipe" — most of the hard security work is done.
