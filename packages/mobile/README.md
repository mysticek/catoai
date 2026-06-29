# @cato/mobile

React Native (Expo) **voice terminal** — mic, speaker, push-to-talk, WebSocket. The
brain is the desktop agent; this app contains **no business logic** (docs/PROJECT.md).

## What it does

- Connects to the desktop agent over WebSocket (`PROTOCOL.md`).
- **Push-to-talk**: hold the big button, speak; on release it sends the recorded
  16 kHz WAV to the desktop, which runs local whisper STT → orchestrator.
- Plays Cato's spoken reply via native TTS (`expo-speech`, Slovak by default).
- Shows a live **project status** list and a command/response log.
- Control chips (`continue / stop / repeat / summarize`) and a **type-a-command**
  fallback (the text path works identically to voice).

## Run it

```bash
cd packages/mobile
npx expo install          # resolves native deps for your Expo SDK
# point the app at your desktop agent:
#   edit app.json -> expo.extra.desktopWsUrl + pairingToken
#   (must match WS_HOST/WS_PORT/PAIRING_TOKEN of the desktop agent)
npx expo start            # then open in Expo Go / a dev build on your phone
```

The phone and the desktop must be on the **same local network**. Use the desktop's
LAN IP in `desktopWsUrl` (e.g. `ws://192.168.1.10:8787/v1`), not `localhost`.

## Known integration point to verify on-device

`src/audio.ts` records 16 kHz mono WAV (what desktop whisper.cpp expects). iOS
LINEARPCM+`.wav` is reliable; **Android** WAV via `expo-av` varies by device. If the
desktop STT rejects Android audio, either add a WAV header to recorded PCM or use the
text-command fallback (already wired). This is the one piece that needs a real device
to confirm — everything desktop-side (STT, intents, orchestration) is tested.
