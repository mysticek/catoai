/**
 * Local database — embedded Postgres (PGlite, WASM) with pgvector. No Docker, no server:
 * the DB is just a directory under ~/.cato/db, and it runs in-process. Cross-platform
 * (Linux / macOS / Windows) since it's WASM. The Memory Engine talks to the `Pool`
 * adapter below exactly like node-postgres (`query(sql, params) -> { rows }`).
 */
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

export interface Pool {
  // Default row type is `any` to match node-postgres's loose typing (callers pass a
  // generic where they care). Keeps the Memory Engine queries unchanged.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

// Embedded so distribution never depends on a file path. `gen_random_uuid()` is Postgres
// core (no uuid-ossp); HNSW vector indexes are supported by PGlite's pgvector.
const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS project (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  root_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS task (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project(id),
  intent TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS worker (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES task(id),
  project_id UUID REFERENCES project(id),
  agent_kind TEXT NOT NULL,
  session_id TEXT,
  tmux_target TEXT,
  launch_command TEXT,
  state TEXT NOT NULL DEFAULT 'starting',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  stopped_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  project_id UUID REFERENCES project(id),
  task_id UUID REFERENCES task(id),
  worker_id UUID REFERENCES worker(id),
  importance REAL NOT NULL DEFAULT 0,
  data JSONB NOT NULL DEFAULT '{}',
  summary TEXT,
  embedding VECTOR(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS capture_line (
  id BIGSERIAL PRIMARY KEY,
  worker_id UUID REFERENCES worker(id),
  project_id UUID REFERENCES project(id),
  stream TEXT NOT NULL DEFAULT 'stdout',
  content TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS capture_line_worker_idx ON capture_line (worker_id, id);
CREATE INDEX IF NOT EXISTS capture_line_project_idx ON capture_line (project_id, id);

CREATE TABLE IF NOT EXISTS memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES project(id),
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  importance REAL NOT NULL DEFAULT 0.5,
  source_event_id UUID REFERENCES event(id),
  embedding VECTOR(1024),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checkpoint (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES project(id),
  task_id UUID REFERENCES task(id),
  state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checkpoint_project_idx ON checkpoint (project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS event_embedding_idx ON event USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS memory_embedding_idx ON memory USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS event_project_created_idx ON event (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS event_type_idx ON event (type);
CREATE INDEX IF NOT EXISTS task_project_state_idx ON task (project_id, state);
`;

async function applySchema(db: PGlite): Promise<void> {
  try {
    await db.exec(SCHEMA);
  } catch {
    // Fall back to per-statement so one unsupported line doesn't block the rest.
    for (const stmt of SCHEMA.split(";").map((s) => s.trim()).filter(Boolean)) {
      try {
        await db.exec(stmt + ";");
      } catch (e) {
        console.log(`[db] skipped statement: ${(e as Error).message.split("\n")[0]}`);
      }
    }
  }
}

export async function createPool(dataDir: string): Promise<Pool> {
  const db = await PGlite.create({ dataDir, extensions: { vector } });
  await applySchema(db);
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    query: <T = any>(sql: string, params?: unknown[]) =>
      db.query<T>(sql, params as unknown[]).then((r) => ({ rows: r.rows })),
    end: () => db.close(),
  };
}
