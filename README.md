# Cato

> Voice-first operating system for AI coding agents.
> **Cato remembers. Workers implement.**

Cato (**C**oding **A**gent **T**ask **O**rchestrator) is a persistent, local-first brain
that watches your AI coding agents (Claude Code, Codex), remembers everything across
projects, alerts you when something needs attention — and lets you drive it all by voice
from your phone. Leave the desk; keep shipping.

Spec: [`docs/`](./docs) — [PROJECT](./docs/PROJECT.md) · [ARCHITECTURE](./docs/ARCHITECTURE.md) · [PROTOCOL](./docs/PROTOCOL.md) · [MEMORY-SCHEMA](./docs/MEMORY-SCHEMA.md) · [MVP](./docs/MVP.md)

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/mysticek/catoai/main/install.sh | bash
```

(or clone and run `./install.sh`). One command sets up everything: tmux · ffmpeg ·
whisper.cpp · Ollama + models (bge-m3, gemma3:4b) · whisper large-v3-turbo · builds the
agent · links the `cato` launcher · configures the always-on agent (left **inactive** —
enable with `npm run daemon:on`) · and runs onboarding (`cato setup`). Idempotent.

**No Docker, no database server** — the DB is **embedded (PGlite, WASM)** in `~/.cato/db`.

**Cross-platform:** macOS (Homebrew) and Linux (apt/dnf/pacman) are auto-detected;
Windows runs under WSL. The agent + DB are pure JS/WASM, so they run anywhere Node does.

Prereqs: **Node ≥20** and at least one coding agent — **Claude Code** (`claude`) and/or
**Codex** (`codex`). *(A Homebrew tap is planned.)*

## Use it

```bash
cato setup            # one-time: pick your workspace + get a pairing token & QR (secures it)
cato                  # launch your agent in any project — it runs in a tmux session
                      # Cato auto-watches. `cato codex` for Codex.
npm run daemon:on     # (optional) run the Cato brain always-on (auto-start on login)
cato doctor           # diagnose setup (deps, models, onboarding, security, agent)
# or run the brain in the foreground:  npm start
```

On your phone (same Wi‑Fi), open the Cato app — it **auto-discovers** your machine
(mDNS). Scan the QR from `cato setup` (or enter the token) to pair: the link is
**end-to-end encrypted** and the agent exposes nothing until it's set up. See
[`docs/SECURITY.md`](./docs/SECURITY.md). Remote access (from anywhere) via the optional
**Cato Relay** — [`docs/RELAY.md`](./docs/RELAY.md).

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
infra/                    schema.sql (reference) + optional docker-compose (cloud/advanced)
bin/cato                  the launcher
install.sh                one-command setup
```
