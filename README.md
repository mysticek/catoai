# Cato

> Voice-first operating system for AI coding agents.
> **Cato remembers. Workers implement.**

Cato (**C**oding **A**gent **T**ask **O**rchestrator) is a persistent, local-first brain
that watches your AI coding agents (Claude Code, Codex), remembers everything across
projects, alerts you when something needs attention — and lets you drive it all by voice
from your phone. Leave the desk; keep shipping.

Spec: [`docs/`](./docs) — [PROJECT](./docs/PROJECT.md) · [ARCHITECTURE](./docs/ARCHITECTURE.md) · [PROTOCOL](./docs/PROTOCOL.md) · [MEMORY-SCHEMA](./docs/MEMORY-SCHEMA.md) · [MVP](./docs/MVP.md)

## Install (macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/mysticek/catoai/main/install.sh | bash
```

(or clone and run `./install.sh`). One command sets up everything: tmux · ffmpeg ·
whisper.cpp · Ollama + models (bge-m3, gemma3:4b) · whisper large-v3-turbo ·
Postgres+pgvector (Docker) · builds the agent · links the `cato` launcher · and configures
the always-on agent (left **inactive** — enable with `npm run daemon:on`). Idempotent.
*(A Homebrew tap is planned.)*

Prereqs it expects: **Homebrew**, **Node ≥20**, **Docker Desktop**, and at least one
coding agent — **Claude Code** (`claude`) and/or **Codex** (`codex`).

## Use it

```bash
cato                  # launch your agent in any project — it runs in a tmux session
                      # Cato auto-watches. `cato codex` for Codex.
npm run daemon:on     # (optional) run the Cato brain always-on (auto-start on login)
# or, foreground:  npm start
```

Work normally; detach (Ctrl-b d) and walk away. On your phone (same Wi-Fi), open the
Cato app, Connect, hold the button and talk:

- *"Čo sa deje?"* — what's happening across all projects
- *"Povedz <projekt> …"* — send an instruction (with relevant memory injected)
- *"Spusti claude na projekte X"* — start a worker by voice
- *"Continue." / "Stop." / "Zhrň to."*

Cato pushes alerts unprompted (e.g. a worker error) and survives worker crashes by
relaunching from checkpoints.

## How it sees your sessions

Run agents via **`cato`** (not `claude`/`codex` directly). It launches them in a
`cato-<project>` tmux session that the brain auto-discovers and captures via rendered
snapshots — never by parsing an agent's private files (agent-agnostic). For a seamless
habit, alias it:

```sh
# ~/.zshrc — make `claude` always run under Cato
claude() { cato claude "$@"; }
```

## Mobile

React Native (Expo) voice terminal in [`packages/mobile`](./packages/mobile). iOS dev
build via Xcode today (see its README); TestFlight for friends is the next step.

## Layout

```
packages/shared          types: CodingAgent, protocol, events
packages/desktop-agent    the brain: capture · memory · orchestrator · recovery · ws · stt/llm
packages/mobile           Expo voice terminal
infra/                    docker-compose + schema.sql
bin/cato                  the launcher
install.sh                one-command setup
```
