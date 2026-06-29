/**
 * Memory Engine — Cato's own memory. Owns durable knowledge in PostgreSQL.
 * This is the heart of the "Cato remembers" principle: workers feed it, but it
 * never lives inside a worker. See docs/MEMORY-SCHEMA.md.
 *
 * Embeddings are not produced yet (Phase 3) — the `embedding` columns stay NULL.
 */

import type { Pool } from "../db.js";
import type { CatoEvent, EventType, ProjectStatus } from "@cato/shared";
import { clean, scoreLine, detect } from "./importance.js";
import { toVectorLiteral, type Embedder } from "./embeddings.js";

/** Events with importance >= this get embedded for semantic recall. */
const EMBED_THRESHOLD = 0.5;

export interface RetrievedMemory {
  id: string;
  kind: string;
  content: string;
  importance: number;
  similarity: number;
}

export interface IngestContext {
  workerId: string;
  projectId: string;
  projectName: string;
  stream?: "stdout" | "stderr";
}

export interface IngestResult {
  content: string;
  importance: number;
  events: CatoEvent[];
}

export class MemoryEngine {
  constructor(
    private readonly pool: Pool,
    private readonly embedder?: Embedder,
    /** Called for every appended event — routes the whole event stream to the bus. */
    private readonly onEvent?: (event: CatoEvent) => void,
  ) {}

  /** Best-effort embedding; never throws (memory writes must not fail on this). */
  async #tryEmbed(text: string): Promise<string | null> {
    if (!this.embedder) return null;
    try {
      return toVectorLiteral(await this.embedder.embed(text));
    } catch {
      return null;
    }
  }

  /** Upsert a project (workspace) and return its id. */
  async ensureProject(name: string, rootPath: string): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO project (name, root_path) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET root_path = EXCLUDED.root_path
       RETURNING id`,
      [name, rootPath],
    );
    return rows[0]!.id;
  }

  /** Register a worker and emit WorkerStarted. Returns the worker id. */
  async startWorker(input: {
    projectId: string;
    projectName: string;
    agentKind: string;
    sessionId?: string;
    tmuxTarget?: string;
    launchCommand?: string;
    taskId?: string;
  }): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO worker (task_id, project_id, agent_kind, session_id, tmux_target, launch_command, state)
       VALUES ($1, $2, $3, $4, $5, $6, 'running') RETURNING id`,
      [
        input.taskId ?? null, input.projectId, input.agentKind,
        input.sessionId ?? null, input.tmuxTarget ?? null, input.launchCommand ?? null,
      ],
    );
    const workerId = rows[0]!.id;
    await this.appendEvent({
      type: "WorkerStarted",
      project: input.projectName,
      projectId: input.projectId,
      workerId,
      importance: 0.6,
      summary: `${input.projectName}: worker started (${input.agentKind})`,
      data: { workerId, sessionId: input.sessionId ?? "", taskId: input.taskId },
    });
    return workerId;
  }

  /** Mark a worker stopped and emit WorkerStopped. */
  async stopWorker(
    workerId: string,
    projectId: string | null,
    projectName: string | undefined,
    reason: "clean" | "crash" | "killed",
  ): Promise<void> {
    await this.pool.query(
      `UPDATE worker SET state = $2, stopped_at = now() WHERE id = $1`,
      [workerId, reason === "clean" ? "stopped" : "crashed"],
    );
    await this.appendEvent({
      type: "WorkerStopped",
      project: projectName,
      projectId,
      workerId,
      importance: reason === "clean" ? 0.4 : 0.8,
      summary: `${projectName ?? "worker"}: worker ${reason}`,
      data: { workerId, reason },
    });
  }

  /**
   * Ingest one raw terminal line: store it cheaply as capture_line, then extract
   * any notable domain events into `event`. This is the memory pipeline entrypoint.
   */
  async ingestLine(raw: string, ctx: IngestContext): Promise<IngestResult> {
    const content = clean(raw);
    const importance = scoreLine(content);
    if (content.trim().length === 0) {
      return { content, importance: 0, events: [] };
    }

    await this.pool.query(
      `INSERT INTO capture_line (worker_id, project_id, stream, content, importance)
       VALUES ($1, $2, $3, $4, $5)`,
      [ctx.workerId, ctx.projectId, ctx.stream ?? "stdout", content, importance],
    );

    const events: CatoEvent[] = [];
    for (const d of detect(content, ctx.projectName)) {
      const ev = await this.appendEvent({
        type: d.type,
        project: ctx.projectName,
        projectId: ctx.projectId,
        workerId: ctx.workerId,
        importance: Math.max(importance, 0.7),
        summary: d.summary,
        data: d.data,
      });
      events.push(ev);
    }
    return { content, importance, events };
  }

  /** Append an immutable domain event. DB assigns id + created_at. */
  async appendEvent(input: {
    type: EventType;
    project?: string;
    projectId?: string | null;
    taskId?: string | null;
    workerId?: string | null;
    importance: number;
    summary?: string;
    data: Record<string, unknown>;
  }): Promise<CatoEvent> {
    const { rows } = await this.pool.query<{ id: string; created_at: Date }>(
      `INSERT INTO event (type, project_id, task_id, worker_id, importance, data, summary)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, created_at`,
      [
        input.type,
        input.projectId ?? null,
        input.taskId ?? null,
        input.workerId ?? null,
        input.importance,
        JSON.stringify(input.data),
        input.summary ?? null,
      ],
    );
    const id = rows[0]!.id;

    // Embed notable events so they're semantically recallable later.
    if (input.summary && input.importance >= EMBED_THRESHOLD) {
      const vec = await this.#tryEmbed(input.summary);
      if (vec) {
        await this.pool
          .query(`UPDATE event SET embedding = $1::vector WHERE id = $2`, [vec, id])
          .catch(() => {});
      }
    }

    const event: CatoEvent = {
      id,
      type: input.type,
      project: input.project,
      workerId: input.workerId ?? undefined,
      taskId: input.taskId ?? undefined,
      importance: input.importance,
      ts: rows[0]!.created_at.toISOString(),
      summary: input.summary,
      data: input.data as never,
    };
    this.onEvent?.(event);
    return event;
  }

  /**
   * Store a long-term memory (decision, project knowledge, summary, preference)
   * with an embedding for semantic retrieval. This is durable knowledge Cato owns.
   */
  async remember(input: {
    projectId?: string;
    kind: "decision" | "knowledge" | "summary" | "preference";
    content: string;
    importance?: number;
  }): Promise<string> {
    const vec = await this.#tryEmbed(input.content);
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO memory (project_id, kind, content, importance, embedding)
       VALUES ($1, $2, $3, $4, $5::vector) RETURNING id`,
      [input.projectId ?? null, input.kind, input.content, input.importance ?? 0.5, vec],
    );
    return rows[0]!.id;
  }

  /**
   * Semantic retrieval — "do it the same way as last time." Embeds the query and
   * finds the nearest memories, blended with importance. Returns a compact set;
   * workers never receive the full memory.
   */
  async retrieve(
    query: string,
    opts: { projectName?: string; limit?: number } = {},
  ): Promise<RetrievedMemory[]> {
    const limit = opts.limit ?? 5;
    const vec = await this.#tryEmbed(query);
    if (!vec) {
      // No embedder: fall back to most-recent memories.
      const { rows } = await this.pool.query(
        `SELECT m.id, m.kind, m.content, m.importance
         FROM memory m LEFT JOIN project p ON p.id = m.project_id
         WHERE ($2::text IS NULL OR p.name = $2)
         ORDER BY m.created_at DESC LIMIT $1`,
        [limit, opts.projectName ?? null],
      );
      return rows.map((r) => ({ ...r, similarity: 0 }));
    }

    const { rows } = await this.pool.query(
      `SELECT m.id, m.kind, m.content, m.importance,
              1 - (m.embedding <=> $1::vector) AS similarity
       FROM memory m LEFT JOIN project p ON p.id = m.project_id
       WHERE m.embedding IS NOT NULL AND ($3::text IS NULL OR p.name = $3)
       ORDER BY m.embedding <=> $1::vector
       LIMIT $2`,
      [vec, limit * 2, opts.projectName ?? null],
    );
    // Blend semantic similarity with stored importance, then take top `limit`.
    return rows
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        content: r.content,
        importance: r.importance,
        similarity: Number(r.similarity),
      }))
      .sort((a, b) => b.similarity * 0.8 + b.importance * 0.2 - (a.similarity * 0.8 + a.importance * 0.2))
      .slice(0, limit);
  }

  /** Recent notable events, newest first. `exclude` drops meta event types. */
  async recentEvents(
    limit = 20,
    projectName?: string,
    exclude: EventType[] = [],
  ): Promise<CatoEvent[]> {
    const { rows } = await this.pool.query(
      `SELECT e.id, e.type, p.name AS project, e.worker_id, e.task_id,
              e.importance, e.summary, e.data, e.created_at
       FROM event e LEFT JOIN project p ON p.id = e.project_id
       WHERE ($2::text IS NULL OR p.name = $2)
         AND ($3::text[] IS NULL OR e.type <> ALL($3))
       ORDER BY e.created_at DESC LIMIT $1`,
      [limit, projectName ?? null, exclude.length ? exclude : null],
    );
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      project: r.project ?? undefined,
      workerId: r.worker_id ?? undefined,
      taskId: r.task_id ?? undefined,
      importance: r.importance,
      ts: r.created_at.toISOString(),
      summary: r.summary ?? undefined,
      data: r.data,
    }));
  }

  /** All known project names (for NLU intent classification context). */
  async listProjects(): Promise<string[]> {
    const { rows } = await this.pool.query<{ name: string }>(`SELECT name FROM project ORDER BY name`);
    return rows.map((r) => r.name);
  }

  /** The live tail of a project's captured terminal output (chronological). */
  async recentCapture(projectName: string, limit = 50): Promise<string[]> {
    const { rows } = await this.pool.query<{ content: string }>(
      `SELECT cl.content FROM capture_line cl JOIN project p ON p.id = cl.project_id
       WHERE p.name = $1 ORDER BY cl.id DESC LIMIT $2`,
      [projectName, limit],
    );
    return rows.map((r) => r.content).reverse();
  }

  /** A running worker we can route input to. */
  async runningWorker(projectName?: string): Promise<{
    workerId: string;
    project: string;
    tmuxTarget: string | null;
    agentKind: string;
    taskId: string | null;
  } | null> {
    const { rows } = await this.pool.query(
      `SELECT w.id, p.name AS project, w.tmux_target, w.agent_kind, w.task_id
       FROM worker w JOIN project p ON p.id = w.project_id
       WHERE w.state = 'running' AND ($1::text IS NULL OR p.name = $1)
       ORDER BY w.started_at DESC LIMIT 1`,
      [projectName ?? null],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      workerId: r.id, project: r.project, tmuxTarget: r.tmux_target,
      agentKind: r.agent_kind, taskId: r.task_id,
    };
  }

  // ---- Tasks: permanent units of intent; workers attach to them over time -------

  async createTask(projectId: string, intent: string): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO task (project_id, intent, state) VALUES ($1, $2, 'active') RETURNING id`,
      [projectId, intent],
    );
    return rows[0]!.id;
  }

  async setTaskIntent(taskId: string, intent: string): Promise<void> {
    await this.pool.query(
      `UPDATE task SET intent = $2, updated_at = now() WHERE id = $1`,
      [taskId, intent],
    );
  }

  /** Latest active task for a project (its current intent). */
  async activeTask(projectName: string): Promise<{ id: string; intent: string } | null> {
    const { rows } = await this.pool.query<{ id: string; intent: string }>(
      `SELECT t.id, t.intent FROM task t JOIN project p ON p.id = t.project_id
       WHERE p.name = $1 AND t.state = 'active'
       ORDER BY t.updated_at DESC LIMIT 1`,
      [projectName],
    );
    return rows[0] ?? null;
  }

  /** Running workers Cato manages (it knows how to relaunch them). */
  async runningManagedWorkers(): Promise<
    {
      workerId: string;
      projectId: string;
      project: string;
      tmuxTarget: string;
      agentKind: string;
      launchCommand: string;
      startedAt: Date;
      taskId: string | null;
    }[]
  > {
    const { rows } = await this.pool.query(
      `SELECT w.id, w.project_id, p.name AS project, w.tmux_target, w.agent_kind,
              w.launch_command, w.started_at, w.task_id
       FROM worker w JOIN project p ON p.id = w.project_id
       WHERE w.state = 'running' AND w.launch_command IS NOT NULL
         AND w.tmux_target IS NOT NULL
       ORDER BY w.started_at DESC`,
    );
    return rows.map((r) => ({
      workerId: r.id,
      projectId: r.project_id,
      project: r.project,
      tmuxTarget: r.tmux_target,
      agentKind: r.agent_kind,
      launchCommand: r.launch_command,
      startedAt: r.started_at,
      taskId: r.task_id,
    }));
  }

  /** Save a checkpoint for a project (the resumable state, e.g. a resume prompt). */
  async saveCheckpoint(projectId: string, state: unknown): Promise<void> {
    await this.pool.query(
      `INSERT INTO checkpoint (project_id, state) VALUES ($1, $2)`,
      [projectId, JSON.stringify(state)],
    );
  }

  /** Latest checkpoint state for a project, or null. */
  async latestCheckpoint(projectId: string): Promise<unknown | null> {
    const { rows } = await this.pool.query<{ state: unknown }>(
      `SELECT state FROM checkpoint WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [projectId],
    );
    return rows[0]?.state ?? null;
  }

  /**
   * Coarse per-project status for "What is happening?" — derived from the latest
   * notable event per project. Reconstructed from events (event sourcing).
   */
  async projectStatuses(): Promise<ProjectStatus[]> {
    const { rows } = await this.pool.query<{
      name: string;
      type: EventType;
      summary: string | null;
      has_running: boolean;
    }>(
      `SELECT DISTINCT ON (p.id) p.name, e.type, e.summary,
              EXISTS (
                SELECT 1 FROM worker w
                WHERE w.project_id = p.id AND w.state = 'running'
              ) AS has_running
       FROM project p
       JOIN event e ON e.project_id = p.id
       ORDER BY p.id, e.created_at DESC`,
    );
    return rows
      .map((r) => ({
        name: r.name,
        state: deriveState(r.type, r.has_running),
        summary: r.summary ?? r.type,
        attention: r.type === "WorkerError" || r.type === "TestsFailed" || r.type === "ApprovalRequested",
        hasRunning: r.has_running,
      }))
      // Only surface what's actually happening: a live worker, or something needing attention.
      .filter((r) => r.hasRunning || r.attention)
      .map(({ name, state, summary }) => ({ name, state, summary }));
  }
}

/** State reflects current worker liveness, not just the last event ever recorded. */
function deriveState(type: EventType, hasRunning: boolean): ProjectStatus["state"] {
  if (type === "ApprovalRequested") return "waiting";
  if (type === "TestsFailed" || type === "WorkerError") return "attention";
  return hasRunning ? "active" : "idle";
}
