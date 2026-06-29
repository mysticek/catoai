# Cato — Architecture

Concrete module responsibilities, the chosen tech stack, and how data flows.
Decisions here are defaults for the MVP; deviations must be justified in a PR.

---

## 1. Tech-stack decisions (MVP)

| Layer | Choice | Why |
|-------|--------|-----|
| Desktop Agent | **TypeScript + Node.js** (≥ 20) | Same language as mobile; rich ecosystem for ws, PTY, pg. |
| Process control | **tmux** + `tmux send-keys` / `capture-pane` | Per vision; survives if our process dies; observable terminals. |
| Worker IO (later) | Optional **node-pty** | When we outgrow tmux for finer control. |
| Mobile | **React Native + TypeScript** (Expo for MVP) | Fast path to mic/speaker on a phone. |
| Transport | **WebSocket** (JSON, see `PROTOCOL.md`) | Bidirectional, low-latency, simple. |
| Database | **PostgreSQL 16 + pgvector** (docker-compose) | Local-first; events + embeddings in one store. |
| Speech-to-text | **whisper.cpp** (local) | Local-first; Slovak + English + mixed technical. |
| Text-to-speech | Native platform APIs (`say` on macOS; RN TTS on phone) | No cloud needed; Slovak default. |
| Embeddings | Local model (e.g. `nomic-embed-text` via Ollama) → fallback cloud | Privacy-first; cloud only opt-in. |
| LLM for routing/summaries | Pluggable; local model preferred, cloud optional | Model independence. |

> **Rule:** cloud services are **optional fallback only**, never required for core
> flows. The product must work fully offline for the local pieces.

---

## 2. Module responsibilities

### 2.1 Desktop Agent (the heart)

The always-on process. It *is* Cato. Responsibilities:

- discover running workers (tmux sessions, Claude Code sessions)
- monitor sessions and parse their output into events
- restart workers when they die; restore task checkpoints
- maintain memory (write to Memory Engine)
- expose the WebSocket API to mobile clients
- run local speech recognition (or accept audio/text from mobile)
- route voice commands to the right worker / answer from memory
- speak responses back

### 2.2 Orchestrator

Decides *what happens*. Given a parsed voice intent + memory context:

- resolve which project / worker the command targets
- map intent → action (query memory, send to worker, start/stop worker, summarize)
- enforce that workers receive **only relevant** context, never full memory
- own the task lifecycle (create, checkpoint, complete, reassign on crash)

### 2.3 Memory Engine

Owns all durable knowledge. See `MEMORY-SCHEMA.md`. Provides:

- `append(event)` — store an immutable event
- `summarize(...)` — produce compact summaries from raw events
- `embed(text)` — produce vector embeddings
- `retrieve(query, scope)` — hybrid (vector + structured) search
- `checkpoint(taskId)` / `restore(taskId)` — task continuity across workers

### 2.4 Event Bus

In-process pub/sub that decouples producers from consumers.

- Producers: Agent Manager (worker output), WS server (voice commands), Orchestrator.
- Consumers: Memory Engine (persist), WS server (push to mobile), Orchestrator (react).
- MVP: a simple typed `EventEmitter`/async iterator. Can graduate to NATS/Redis later.

### 2.5 Agent Manager

Manages the pool of workers through the `CodingAgent` interface (§4). Responsibilities:

- spawn / restart / stop workers
- map a worker instance ↔ a tmux session ↔ a task
- fan worker events into the Event Bus
- health-check workers and trigger recovery (§5)

---

## 3. Data flow

### 3.1 Worker output → memory

```
Worker (tmux pane) output
  → Agent Manager (adapter parses lines/session file)
  → Event Bus
  → Memory Engine: extract → score importance → summarize → embed → store
  → (if notable) Event Bus → WS → mobile push
```

### 3.2 Voice command → action

```
Mobile mic → (audio or text) → WS → Desktop Agent
  → STT (if audio) → intent parse
  → Orchestrator: resolve project/worker + retrieve memory context
  → action:
       • answer from memory        → TTS → WS → mobile speaker
       • send to worker            → adapter.sendMessage() → tmux send-keys
       • start/stop/restart worker → Agent Manager
  → resulting events → Memory Engine + mobile push
```

### 3.3 Worker crash → recovery

```
Health-check detects: Claude process gone, shell/tmux pane alive
  → Agent Manager: relaunch worker in same pane
  → Memory Engine.restore(taskId) → re-inject checkpoint
  → worker continues; user is (ideally) never interrupted
```

---

## 4. Agent abstraction

Cato must **never** depend directly on Claude Code. Every coding agent
implements one interface.

```ts
// packages/shared/src/agent.ts
export interface CodingAgent {
  /** Stable id of the adapter type, e.g. "claude-code". */
  readonly kind: string;

  /** List sessions this agent currently has (running or resumable). */
  listSessions(): Promise<AgentSession[]>;

  /** Read a session's transcript / state. */
  readSession(sessionId: string): Promise<SessionTranscript>;

  /** Inject a message/command into a running session. */
  sendMessage(sessionId: string, text: string): Promise<void>;

  /** Restart a dead/stuck session, restoring the given checkpoint if any. */
  restart(sessionId: string, checkpoint?: TaskCheckpoint): Promise<AgentSession>;

  /** Stream events (output, state changes) as they happen. */
  watchEvents(sessionId: string): AsyncIterable<AgentEvent>;
}
```

### 4.1 Capture model — Cato owns the stream

**Decision:** Cato does **not** parse a worker's private files (e.g. Claude Code's
`~/.claude/projects/*.jsonl`). That is version-sensitive and agent-specific — it
violates the agent-agnostic principle. Instead Cato **owns the terminal stream**.

The worker runs inside a terminal Cato controls; all of its I/O flows through us
into **our** memory, in **our** format. The same mechanism works for any CLI agent
(Claude Code, Codex, Cursor, Gemini CLI, aider, …) with no per-tool parsing.

```
worker (claude/codex/…) in a tmux pane we own
  → tmux pipe-pane streams raw output → ~/.cato/capture/<workerId>.log  (OUR file)
  → CaptureSource tails OUR file → Memory Engine: extract → score → store
  ← sendMessage writes via tmux send-keys
```

### 4.2 Generic terminal adapter (first implementation)

One `CodingAgent` implementation — `TerminalAgent` — drives any terminal worker:

- **spawn/discover:** create or attach a tmux session; one pane = one worker.
- **capture (`watchEvents`):** `tmux pipe-pane -o -t <pane> 'cat >> <captureFile>'`,
  then tail `<captureFile>`; turn raw lines into `AgentEvent`s and extracted
  `CatoEvent`s (see Memory Engine). The file is **ours**, not the worker's.
- **sendMessage:** `tmux send-keys -t <pane> -- "<text>" Enter`.
- **restart:** relaunch the worker command in the same pane, then re-inject the
  task checkpoint. The pane (shell) survives even when the worker process dies —
  this is what makes worker recovery (§5) possible.

A specific agent (e.g. Claude Code) is just a small **profile**: the launch command
(`claude`), optional resume flag, and any output detectors unique to it. The adapter
core is agent-agnostic.

> Resilience: because the tmux pane is owned by tmux (not by the Cato process),
> Cato can crash and restart without killing workers; on restart it re-attaches
> to existing panes and resumes tailing the capture files.

> Requires `tmux` on the host (`brew install tmux`). node-pty is a possible future
> driver when we want to own the process directly (at the cost of crash-survival).

### 4.2.1 Managed vs adopted workers

A worker can enter Cato two ways — both use the same capture mechanism:

- **Managed** — Cato spawns the worker (`new-session` + `pipe-pane`). Cato
  owns its lifecycle from the start.
- **Adopted** — the user starts the worker themselves **inside tmux**, works in the
  terminal, then walks away; Cato **attaches** later. On adopt it backfills the
  pane's existing scrollback (`capture-pane -p -S -`) into memory, then `pipe-pane`s
  for live capture. This is the "work, then leave" path.

> Requirement: an adopted worker must be running **inside tmux**. A worker in a plain
> terminal cannot be tapped from outside (no access to its PTY). Recommended: always
> launch coding agents inside tmux (e.g. a shell wrapper `tmux new -As <name> claude`),
> so any session is adoptable later.

### 4.3 Future adapters

Codex, Cursor, Gemini CLI, Aider, OpenHands — most are just a new **profile** for
the `TerminalAgent` (different launch command + detectors). A non-terminal tool can
still implement `CodingAgent` directly. Nothing above the adapter layer changes.

---

## 5. Worker recovery contract

A worker is **replaceable**; a task is **not**. Recovery must:

1. detect death (process gone, pane/shell alive) within a few seconds,
2. relaunch the worker,
3. restore the latest `TaskCheckpoint` from the Memory Engine,
4. resume execution, and
5. emit a `WorkerStopped` + `WorkerStarted` event pair so memory stays truthful.

---

## 6. Repository layout (target)

```
cato/
  docs/                     # this spec
  packages/
    shared/                 # types: CodingAgent, protocol messages, events
    desktop-agent/          # Node/TS: orchestrator, memory, agent manager, ws server
      src/
        orchestrator/
        memory/
        agents/             # adapters (claude-code first)
        bus/
        ws/
        voice/              # stt/tts glue
    mobile/                 # React Native (Expo) voice terminal
  infra/
    docker-compose.yml      # postgres + pgvector
    db/                     # migrations / schema.sql
  package.json              # workspaces
```

---

## 7. Boundaries / invariants

- The mobile app contains **no business logic** — UI, mic, speaker, ws only.
- Workers never receive full memory — only Orchestrator-selected context.
- All durable truth lives in the Memory Engine, never inside a worker.
- Core flows must work without any cloud dependency.
