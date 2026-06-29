# Cato — Project Specification

> Voice-first operating system for AI coding agents.

This document is the canonical assignment (`zadanie`) for any agent implementing
Cato. Read this first, then `ARCHITECTURE.md`, `PROTOCOL.md`,
`MEMORY-SCHEMA.md`, and `MVP.md`.

---

## 1. One-sentence summary

Cato is a persistent engineering brain that remembers everything, orchestrates
multiple AI coding agents, and lets a developer manage software projects entirely
through natural voice conversation.

---

## 2. The core principle

**Cato remembers. Workers implement.**

- Workers (Claude Code, Codex, Cursor, Gemini CLI, …) are **disposable**.
- They can crash, be killed, or be replaced — the user must not notice.
- Cato owns the **memory**, the **tasks**, and the **orchestration**.
- Tasks are permanent. Workers are temporary.

```
Task → Worker #1 → (crash) → Cato starts Worker #2 → Task continues
```

---

## 3. What the product does

The user can leave the computer — walk, drive, hike, sit by the pool — and keep
supervising and directing multiple AI coding agents purely by voice.

Example interaction:

> **User:** "What is happening?"
> **Cato:** "Safeforme finished the parser refactoring. Prajs is waiting for
> your decision. Client X has failing tests."

The user never thinks about *which* coding agent is running. They talk to Cato;
Cato routes.

---

## 4. What Cato is NOT

Cato is **not** another IDE, AI model, chat interface, or terminal.
It is the **operating system above** AI coding agents.

Explicit non-goals for the foreseeable future:

- Not a model provider — Cato does not run its own LLM for coding.
- Not an editor — no file editing UI.
- Not a cloud SaaS — local-first by default (see §6).
- No business logic in the mobile app — the mobile app is a voice terminal only.

---

## 5. Goals

| Goal | Meaning |
|------|---------|
| Persistent memory | Survives worker death, app restart, and crosses projects. |
| Voice-first | Primary interaction is spoken, not typed. |
| Multi-agent orchestration | Manage many workers across many projects at once. |
| Local-first | Runs on the user's machine; cloud is optional fallback. |
| Model independence | Never hard-coupled to one coding agent or one LLM. |
| Privacy by default | Secrets, keys, personal data are never in scope. |

---

## 6. Design principles

- **Local-first** — data and compute live on the user's machine.
- **Privacy-first** — workspace-scoped access; secrets ignored by default.
- **Voice-first** — every core action is reachable by voice.
- **Event-driven** — important facts are stored as immutable events.
- **Memory-centric** — memory is the most valuable asset, owned by Cato.
- **Agent-agnostic** — every worker hides behind one `CodingAgent` interface.
- **Stateless workers** — workers hold no durable truth.
- **Persistent orchestration** — the orchestrator is always-on and authoritative.

---

## 7. System shape (high level)

```
            Mobile (React Native) — Voice Client
                         │  WebSocket
                         ▼
                  Desktop Agent  ◄── the heart of the system
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   Memory Engine    Orchestrator      Event Bus
        └────────────────┼────────────────┘
                         ▼
                   Agent Manager
        ┌──────────┬──────────┬──────────┐
        ▼          ▼          ▼          ▼
   Claude Code   Codex      Cursor     Others
```

Detailed responsibilities and the chosen tech stack are in `ARCHITECTURE.md`.

---

## 8. Security posture (summary)

Default mode is **workspace-based access**. Cato never gets unrestricted access
to the whole computer.

- **Allowed:** selected project folders, their git repos, project docs.
- **Ignored by default:** secrets, SSH keys, certificates, browser data, personal
  documents, photos, emails.

The user explicitly opts a workspace in. Everything else is invisible to Cato.

---

## 9. Glossary

| Term | Definition |
|------|------------|
| **Cato** | The persistent orchestrator. The brain. Owns memory + tasks. |
| **Desktop Agent** | The always-on process on the user's machine that *is* Cato. |
| **Worker** | A disposable coding agent instance (e.g. one Claude Code session). |
| **Coding Agent** | A *type* of worker behind the `CodingAgent` interface. |
| **Adapter** | Concrete implementation of `CodingAgent` for one tool. |
| **Workspace** | A user-approved project folder Cato is allowed to see. |
| **Task** | A permanent unit of intent, executed by one or more workers over time. |
| **Event** | An immutable, important fact stored in the Memory Engine. |
| **Memory** | The durable, searchable knowledge owned by Cato. |

---

## 10. Document map

- `PROJECT.md` — this file: vision, scope, principles, glossary.
- `ARCHITECTURE.md` — modules, data flow, tech-stack decisions, repo layout.
- `PROTOCOL.md` — WebSocket protocol and event catalog.
- `MEMORY-SCHEMA.md` — PostgreSQL + pgvector schema and memory pipeline.
- `MVP.md` — MVP scope, phased plan, tasks, acceptance criteria.
