-- Cato — Memory Engine schema (PostgreSQL 16 + pgvector)
-- See docs/MEMORY-SCHEMA.md. Embedding dimension assumes nomic-embed-text (768).
-- Keep a single embedding dimension per deployment.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Projects (workspaces Cato is allowed to see)
CREATE TABLE IF NOT EXISTS project (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,            -- "safeforme"
  root_path   TEXT NOT NULL,                   -- approved workspace folder
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tasks: permanent units of intent
CREATE TABLE IF NOT EXISTS task (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID NOT NULL REFERENCES project(id),
  intent      TEXT NOT NULL,
  state       TEXT NOT NULL DEFAULT 'open',    -- open|active|waiting|done|abandoned
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Workers: disposable instances bound to a task over time
CREATE TABLE IF NOT EXISTS worker (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id     UUID REFERENCES task(id),
  project_id  UUID REFERENCES project(id),
  agent_kind  TEXT NOT NULL,                   -- "claude-code"
  session_id  TEXT,                            -- adapter-native session id
  tmux_target TEXT,                            -- pane reference
  launch_command TEXT,                         -- command to relaunch on recovery (managed only)
  state       TEXT NOT NULL DEFAULT 'starting',-- starting|running|stopped|crashed
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at  TIMESTAMPTZ
);

-- Events: immutable, append-only source of truth
CREATE TABLE IF NOT EXISTS event (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type        TEXT NOT NULL,                   -- "TestsFailed", ...
  project_id  UUID REFERENCES project(id),
  task_id     UUID REFERENCES task(id),
  worker_id   UUID REFERENCES worker(id),
  importance  REAL NOT NULL DEFAULT 0,         -- 0..1
  data        JSONB NOT NULL DEFAULT '{}',
  summary     TEXT,                            -- short, voice-ready
  embedding   VECTOR(768),                     -- nullable: only notable events embedded
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Raw capture: the terminal stream Cato owns (high-volume, append-only).
-- Notable lines are extracted into `event`; this is the cheap raw record.
CREATE TABLE IF NOT EXISTS capture_line (
  id          BIGSERIAL PRIMARY KEY,
  worker_id   UUID REFERENCES worker(id),
  project_id  UUID REFERENCES project(id),
  stream      TEXT NOT NULL DEFAULT 'stdout',  -- stdout|stderr
  content     TEXT NOT NULL,
  importance  REAL NOT NULL DEFAULT 0,         -- 0..1
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS capture_line_worker_idx  ON capture_line (worker_id, id);
CREATE INDEX IF NOT EXISTS capture_line_project_idx ON capture_line (project_id, id);

-- Long-term derived memory: decisions, project knowledge, summaries, preferences
CREATE TABLE IF NOT EXISTS memory (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id      UUID REFERENCES project(id),
  kind            TEXT NOT NULL,               -- decision|knowledge|summary|preference
  content         TEXT NOT NULL,
  importance      REAL NOT NULL DEFAULT 0.5,
  source_event_id UUID REFERENCES event(id),
  embedding       VECTOR(768),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Task checkpoints for worker recovery. Keyed by project so a checkpoint survives
-- the worker that created it (Worker #2 restores what Worker #1 saved).
CREATE TABLE IF NOT EXISTS checkpoint (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id  UUID REFERENCES project(id),
  task_id     UUID REFERENCES task(id),
  state       JSONB NOT NULL,                  -- enough to resume the task
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checkpoint_project_idx ON checkpoint (project_id, created_at DESC);

-- Vector indexes. HNSW: near-exact recall, no training, works at any row count.
-- (ivfflat is approximate and recalls poorly at low row counts unless lists/probes
--  are tuned — HNSW avoids that footgun for a local-first, growing store.)
CREATE INDEX IF NOT EXISTS event_embedding_idx
  ON event  USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS memory_embedding_idx
  ON memory USING hnsw (embedding vector_cosine_ops);

-- Helpful lookups
CREATE INDEX IF NOT EXISTS event_project_created_idx ON event (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS event_type_idx            ON event (type);
CREATE INDEX IF NOT EXISTS task_project_state_idx    ON task (project_id, state);
