# Cato — MVP Scope & Plan

The first version proves the core loop end-to-end: **talk to Cato by voice →
it inspects/controls one real Claude Code worker → it remembers → it answers.**

---

## 1. In scope (MVP)

- Single coding agent: **Claude Code** (one adapter).
- **tmux** integration for worker IO and survival.
- **Desktop Agent** (orchestrator + memory + agent manager + ws server).
- **React Native** (Expo) mobile voice client.
- **Local speech recognition** (whisper.cpp).
- **Local memory**: PostgreSQL + pgvector.
- **WebSocket** communication (see `PROTOCOL.md`).
- A small set of voice commands (see §3).

## 2. Out of scope (MVP)

Multiple agent types, wake word, Apple Watch / CarPlay / Vision Pro, Slack/GitHub/CI
integrations, knowledge graph, autonomous planning, multiple concurrent mobile
clients, cloud sync. (See `PROJECT.md` "Future".)

---

## 3. Supported voice commands (MVP)

| Command (intent) | Behaviour |
|------------------|-----------|
| "What is happening?" | Summarize all projects' states from memory. |
| "What is `<project>` doing?" | Summarize one project's current state/task. |
| "Tell Claude …" / "Povedz Claudovi …" | Route the message to the target worker. |
| "Continue." | Send a continue command to the active/target worker. |
| "Stop." | Stop the active/target worker. |
| "Repeat." | Repeat Cato's last spoken response. |
| "Summarize." | Produce a compact summary of recent activity. |

Input locales: Slovak, English, mixed technical. Output: Slovak by default.

---

## 4. Phased plan

Each phase ends with something demonstrable. Build in order.

### Phase 0 — Foundations
- Monorepo with workspaces: `packages/{shared,desktop-agent,mobile}`, `infra/`.
- `infra/docker-compose.yml`: PostgreSQL 16 + pgvector; apply `infra/db/schema.sql`.
- `packages/shared`: protocol envelope types, `Event` types, `CodingAgent` interface.
- **Done when:** DB is up, migrations apply, shared types compile.

### Phase 1 — Own capture + generic terminal adapter
> Pivot: Cato owns the terminal stream; it does **not** parse a worker's private
> files. See `ARCHITECTURE.md` §4.1–4.2. The Claude Code "adapter" is just a profile.
- Capture layer: `CaptureSource` (tail OUR file) + tmux driver (`pipe-pane`,
  `send-keys`, session lifecycle). `brew install tmux` required.
- `TerminalAgent` implementing `CodingAgent`:
  - `listSessions` (enumerate our tmux sessions / capture files),
  - `readSession` (read OUR capture log),
  - `sendMessage` (`tmux send-keys`),
  - `watchEvents` (tail OUR capture file → `AgentEvent`),
  - `restart` (relaunch command in same pane + checkpoint).
- **Done when:** Cato spawns a worker in tmux, captures its output into our own
  store, and injects a message the worker acts on — with zero parsing of the
  worker's internal files.

### Phase 2 — Desktop Agent core (bus + ws + orchestrator skeleton)
- Event Bus (typed in-process pub/sub).
- WebSocket server implementing `PROTOCOL.md` (`hello`/`welcome`, `voice.command`
  with `text`, `status.update`, `speech.say`).
- Orchestrator skeleton: intent parse for the §3 commands; route to adapter or memory.
- **Done when:** a CLI/test client sends `text` commands over ws and gets correct
  routing + spoken-text replies.

### Phase 3 — Memory Engine
- `append/summarize/embed/retrieve/checkpoint/restore` over the schema.
- Importance scoring (heuristic) + embeddings (local model).
- Wire worker events → memory; status answers read from memory.
- **Done when:** "What is happening?" is answered purely from stored memory, and a
  killed worker is auto-restarted from a checkpoint (recovery contract).

### Phase 4 — Voice loop (desktop STT) + mobile client
- **Desktop STT (done, tested):** whisper.cpp transcribes base64 audio from
  `voice.command` → orchestrator. Intent parsing is de-accented + **fuzzy** (edit
  distance) so it survives STT mis-hears ("zastav"→"zastau"). TTS via macOS `say`
  for the desktop dev loop. Verified end-to-end: spoken Slovak audio → whisper →
  intent → memory/worker → spoken Slovak reply.
- **Mobile (scaffolded):** Expo app — push-to-talk records 16 kHz WAV, sends over ws,
  plays `speech.say` via `expo-speech`, shows status + log, control chips, text
  fallback. Needs on-device run; the Android WAV recording format is the one piece
  to verify on real hardware (`packages/mobile/src/audio.ts`).
- **Done when:** the full voice loop works from a phone on the local network.
  (Desktop half proven; mobile half needs a device.)

---

## 5. End-to-end acceptance (MVP "done")

Demonstrate, by voice from a phone, with one real Claude Code worker running:

1. Ask **"What is happening?"** → hear a correct spoken Slovak summary.
2. Say **"Tell Claude to continue"** → the worker visibly continues.
3. **Kill the Claude process** → Cato restarts it and resumes the task; memory
   shows `WorkerStopped` + `WorkerStarted`; the user is not blocked.
4. Ask **"What is `<project>` doing?"** → answer reflects the recovered state.
5. Everything above runs with **no cloud dependency**.

---

## 6. Risks / things to validate early

- Claude Code transcript path & JSONL format are version-sensitive — verify against
  the installed version before building on them.
- tmux `send-keys` reliability for multi-line / special input.
- whisper.cpp latency & accuracy on Slovak + mixed technical speech.
- Crash detection: distinguishing "Claude exited" from "Claude is just idle".
- Embedding model choice fixes the vector dimension — pick once per deployment.

---

## 7. First task for the implementing agent

Start at **Phase 0**: scaffold the monorepo, stand up PostgreSQL + pgvector via
`docker-compose`, write `infra/db/schema.sql` from `MEMORY-SCHEMA.md`, and define
the shared types (`CodingAgent`, protocol envelope, `Event`) in `packages/shared`.
Then proceed to Phase 1.
