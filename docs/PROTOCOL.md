# Cato — WebSocket Protocol & Event Catalog

Transport between the **mobile voice client** and the **Desktop Agent**, plus the
internal **event** vocabulary. JSON over a single WebSocket connection.

---

## 1. Connection

- Mobile connects to `ws://<desktop-host>:<port>/v1` on the local network.
- First frame from mobile is `hello`; server replies `welcome`.
- Auth (MVP): a shared pairing token in the `hello` frame. Pairing UX is later.
- Heartbeat: client sends `ping` every 15s; server replies `pong`. Missed → reconnect.

---

## 2. Message envelope

Every frame is a JSON object with this envelope:

```jsonc
{
  "v": 1,                       // protocol version
  "id": "msg_01J...",           // unique message id (ULID)
  "type": "voice.command",      // dot-namespaced message type
  "ts": "2026-06-26T12:00:00Z", // ISO-8601 UTC
  "payload": { /* type-specific */ }
}
```

Server may reply correlating with `"replyTo": "<id>"`.

---

## 3. Client → Server messages

| `type` | payload | meaning |
|--------|---------|---------|
| `hello` | `{ token, device, clientVersion }` | open session, authenticate |
| `voice.command` | `{ audio? (base64 PCM/opus), text?, locale }` | a spoken command; `audio` OR pre-transcribed `text` |
| `voice.cancel` | `{}` | cancel the in-flight command/response |
| `control.action` | `{ action, target? }` | explicit control: `continue` \| `stop` \| `repeat` \| `summarize` |
| `subscribe` | `{ streams: [...] }` | choose which push streams to receive |
| `ping` | `{}` | heartbeat |

`target` (optional) names a project or worker, e.g. `{ "project": "safeforme" }`.

---

## 4. Server → Client messages

| `type` | payload | meaning |
|--------|---------|---------|
| `welcome` | `{ sessionId, serverVersion, projects: [...] }` | handshake accepted |
| `transcript.partial` | `{ text }` | live STT partial (optional) |
| `transcript.final` | `{ text, locale }` | finalized recognition of the user's command |
| `speech.say` | `{ text, locale, audio? }` | what Cato says back (TTS text, optional audio) |
| `status.update` | `{ projects: [{ name, state, summary }] }` | answer to "what is happening?" |
| `event.push` | `{ event }` | a notable `Event` (see §5) pushed live |
| `error` | `{ code, message }` | recoverable error |
| `pong` | `{}` | heartbeat reply |

---

## 5. Event catalog (internal + pushable)

Events are immutable facts. They flow on the Event Bus, are persisted by the
Memory Engine (`MEMORY-SCHEMA.md`), and notable ones are pushed as `event.push`.

| Event | key fields | emitted when |
|-------|-----------|--------------|
| `SessionStarted` | `project, sessionId, agentKind` | a worker session begins |
| `WorkerStarted` | `workerId, sessionId, taskId?` | a worker process starts |
| `WorkerStopped` | `workerId, reason` | a worker exits (clean or crash) |
| `VoiceCommandReceived` | `text, locale, target?` | user issues a voice command |
| `DecisionMade` | `taskId, decision, rationale?` | a decision is recorded |
| `TaskCreated` | `taskId, project, intent` | a new task is created |
| `TaskCompleted` | `taskId, result` | a task finishes |
| `TaskCheckpoint` | `taskId, checkpoint` | progress saved for recovery |
| `ApprovalRequested` | `taskId, question` | worker needs a user decision |
| `TestsFailed` | `project, summary` | a test run fails |
| `DeploymentStarted` | `project, target` | deploy begins |
| `DeploymentFinished` | `project, target, status` | deploy ends |

Current state is **reconstructed from events** — events are the source of truth.

### 5.1 Event shape

```jsonc
{
  "id": "evt_01J...",
  "type": "TestsFailed",
  "project": "client-x",
  "ts": "2026-06-26T12:00:00Z",
  "importance": 0.0,        // 0..1, set by importance scoring
  "data": { /* event-specific fields */ },
  "summary": "Client X has failing tests."  // short, human/voice-ready
}
```

---

## 6. Example exchanges

### "What is happening?"

```jsonc
// → client
{ "type":"voice.command", "payload":{ "text":"What is happening?", "locale":"en" } }

// ← server
{ "type":"transcript.final", "payload":{ "text":"What is happening?", "locale":"en" } }
{ "type":"status.update", "payload":{ "projects":[
    { "name":"safeforme", "state":"idle",     "summary":"finished the parser refactoring" },
    { "name":"prajs",     "state":"waiting",   "summary":"waiting for your decision" },
    { "name":"client-x",  "state":"attention", "summary":"has failing tests" }
] } }
{ "type":"speech.say", "payload":{ "locale":"sk",
    "text":"Safeforme dokončil refaktoring parsera. Prajs čaká na tvoje rozhodnutie. Client X má padajúce testy." } }
```

### "Tell Claude to continue"

```jsonc
// → client
{ "type":"voice.command", "payload":{ "text":"Povedz Claudovi nech pokračuje", "locale":"sk", "target":{"project":"safeforme"} } }

// ← server (after routing to the worker)
{ "type":"speech.say", "payload":{ "locale":"sk", "text":"Hotovo, poslal som Safeforme príkaz pokračovať." } }
```

---

## 7. Versioning

- `v` in the envelope is the protocol major version.
- Additive fields are non-breaking. Removing/renaming a field bumps `v`.
- Server advertises `serverVersion` + supported `v` range in `welcome`.
