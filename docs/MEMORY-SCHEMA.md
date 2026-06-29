# Cato — Memory Engine: Schema & Pipeline

Memory is the most valuable part of the product. It is owned by **Cato**, never
by individual workers. Storage is local **PostgreSQL + pgvector**.

---

## 1. What memory stores

- raw **events** (immutable, append-only)
- compact **summaries** (derived from events)
- long-term **decisions**
- **project knowledge** (architecture, conventions, preferences)
- **task checkpoints** (for worker recovery)
- **user preferences**

Important events remain forever. Noise is scored low and pruned/ignored.

---

## 2. Memory pipeline

```
Worker output
  → Event Extraction      (parse adapter output into typed events)
  → Importance Scoring     (0..1; cheap heuristic + optional LLM)
  → Summary                (short, voice-ready text)
  → Embedding              (vector for semantic retrieval)
  → PostgreSQL + pgvector  (persist event + summary + embedding)
```

Low-importance events may skip summary/embedding and be retained briefly or dropped.

---

## 3. Schema (PostgreSQL 16 + pgvector)

> Embedding dimension below assumes `nomic-embed-text` (768). Adjust to the chosen
> embedding model and keep a single dimension per deployment.

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Projects (workspaces Cato is allowed to see)
CREATE TABLE project (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,          -- "safeforme"
  root_path   TEXT NOT NULL,                 -- approved workspace folder
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tasks: permanent units of intent
CREATE TABLE task (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID NOT NULL REFERENCES project(id),
  intent      TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'open',  -- open|active|waiting|done|abandoned
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Workers: disposable instances bound to a task over time
CREATE TABLE worker (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id     UUID REFERENCES task(id),
  agent_kind  TEXT NOT NULL,                 -- "claude-code"
  session_id  TEXT,                          -- adapter-native session id
  tmux_target TEXT,                          -- pane reference
  state       TEXT NOT NULL DEFAULT 'starting', -- starting|running|stopped|crashed
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at  TIMESTAMPTZ
);

-- Events: immutable, append-only source of truth
CREATE TABLE event (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type        TEXT NOT NULL,                 -- "TestsFailed", ...
  project_id  UUID REFERENCES project(id),
  task_id     UUID REFERENCES task(id),
  worker_id   UUID REFERENCES worker(id),
  importance  REAL NOT NULL DEFAULT 0,       -- 0..1
  data        JSONB NOT NULL DEFAULT '{}',
  summary     TEXT,                          -- short, voice-ready
  embedding   VECTOR(768),                   -- nullable: only notable events embedded
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Long-term derived memory: decisions, project knowledge, summaries
CREATE TABLE memory (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID REFERENCES project(id),
  kind        TEXT NOT NULL,                 -- decision|knowledge|summary|preference
  content     TEXT NOT NULL,
  importance  REAL NOT NULL DEFAULT 0.5,
  source_event_id UUID REFERENCES event(id),
  embedding   VECTOR(768),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Task checkpoints for worker recovery
CREATE TABLE checkpoint (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id     UUID NOT NULL REFERENCES task(id),
  state       JSONB NOT NULL,                -- enough to resume the task
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vector indexes. HNSW gives near-exact recall with no training and works even at
-- low row counts. (ivfflat is approximate and recalls poorly on a small/growing
-- store unless lists/probes are tuned — avoid that footgun for local-first.)
CREATE INDEX event_embedding_idx  ON event  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX memory_embedding_idx ON memory USING hnsw (embedding vector_cosine_ops);

-- Helpful lookups
CREATE INDEX event_project_created_idx ON event (project_id, created_at DESC);
CREATE INDEX event_type_idx            ON event (type);
CREATE INDEX task_project_state_idx    ON task (project_id, state);
```

---

## 4. Importance scoring

Cheap heuristic first; optional LLM second.

- Base score by event type (e.g. `TestsFailed`, `ApprovalRequested`,
  `DeploymentFinished`, `DecisionMade` → high; routine log lines → low).
- Boost: user-referenced, error/failure, decision, approval-needed.
- Damp: repetitive output, progress spam.
- `importance ≥ threshold` ⇒ summarize + embed + eligible for `event.push`.

---

## 5. Retrieval

When the user says e.g. *"Do it the same way as last time."* Cato must:

1. understand the request (intent parse),
2. identify the current project,
3. retrieve relevant memories,
4. construct a **compact** context,
5. send **only** the relevant slice to the worker.

> Workers never receive the complete memory.

### 5.1 Hybrid retrieval

```sql
-- Semantic: nearest memories/events to the query embedding, scoped to a project
SELECT id, kind, content
FROM memory
WHERE project_id = $1
ORDER BY embedding <=> $2          -- $2 = query embedding
LIMIT 8;
```

Combine with structured filters (recent events of given types, current task state)
and rank by a blend of `similarity × importance × recency`. Cap the assembled
context to a small token budget before handing it to the Orchestrator.

---

## 6. Event sourcing

- `event` is append-only and authoritative.
- Current state (project status, task state, who's waiting) is **reconstructed**
  from events; derived tables (`task.state`, `memory`) are projections/caches.
- Never mutate an event; correct with a new compensating event.

---

## 7. Retention

| Class | Policy |
|-------|--------|
| Important events (high `importance`) | keep forever |
| Decisions, project knowledge | keep forever |
| Low-importance raw events | short TTL, then prune |
| Checkpoints | keep latest N per task; older pruned |
