# Cato

> Voice-first operating system for AI coding agents.
> **Cato remembers. Workers implement.**

A persistent orchestrator that manages disposable AI coding agents (Claude Code,
Codex, Cursor, …), remembers everything across projects, and lets you control your
whole engineering workflow by voice.

Full specification lives in [`docs/`](./docs):
[PROJECT](./docs/PROJECT.md) ·
[ARCHITECTURE](./docs/ARCHITECTURE.md) ·
[PROTOCOL](./docs/PROTOCOL.md) ·
[MEMORY-SCHEMA](./docs/MEMORY-SCHEMA.md) ·
[MVP](./docs/MVP.md)

## Monorepo layout

```
packages/
  shared/          # types: CodingAgent, protocol messages, events
  desktop-agent/   # the brain: orchestrator + memory + agent manager + ws server
  mobile/          # React Native (Expo) voice terminal  (scaffolded in Phase 4)
infra/
  docker-compose.yml   # PostgreSQL 16 + pgvector
  db/schema.sql        # memory schema
```

## Quick start (Phase 0)

```bash
# 1. install deps
npm install

# 2. start the database (PostgreSQL + pgvector); schema is applied on first boot
npm run db:up

# 3. build / typecheck the workspaces
npm run build
```

The database initializes `infra/db/schema.sql` automatically on first start
(mounted into the container's init dir). To re-apply manually: `npm run db:schema`.

## Status

Phase 0 — foundations: monorepo, database, shared types. See
[`docs/MVP.md`](./docs/MVP.md) for the phased plan.
