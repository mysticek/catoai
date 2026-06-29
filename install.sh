#!/usr/bin/env bash
# Cato installer — one command sets up the whole local stack on macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/mysticek/catoai/main/install.sh | bash
#   # or, in a clone:  ./install.sh
#
# Idempotent: re-running only does what's missing. Requires macOS + Homebrew + Docker.
set -uo pipefail

BOLD=$(tput bold 2>/dev/null || true); RESET=$(tput sgr0 2>/dev/null || true)
say()  { echo "${BOLD}> $*${RESET}"; }
ok()   { echo "  ok $*"; }
warn() { echo "  ! $*"; }
have() { command -v "$1" >/dev/null 2>&1; }

REPO="https://github.com/mysticek/catoai.git"
ROOT="$(cd "$(dirname "$0")" 2>/dev/null && pwd || pwd)"
MODELDIR="$HOME/.cato/models"
TURBO_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"

# Bootstrap: when piped from the web (curl | bash) we're not in the repo — clone it.
if [ ! -f "$ROOT/packages/desktop-agent/package.json" ]; then
  have git || { echo "git is required"; exit 1; }
  APPDIR="$HOME/.cato/app"
  say "Fetching Cato into $APPDIR"
  if [ -d "$APPDIR/.git" ]; then (cd "$APPDIR" && git pull -q); else git clone -q "$REPO" "$APPDIR"; fi
  ROOT="$APPDIR"
fi
cd "$ROOT"

say "1/8  Checking prerequisites"
[ "$(uname)" = "Darwin" ] || warn "Not macOS — TTS (say) and some defaults assume macOS."
have brew || { echo "  Homebrew required: https://brew.sh"; exit 1; }
have node || { echo "  Node.js >=20 required: brew install node"; exit 1; }
have docker || warn "Docker not found — install Docker Desktop, then re-run (needed for the database)."
ok "brew, node present"
if have claude || have codex; then
  have claude && ok "claude-cli found"; have codex && ok "codex-cli found"
else
  warn "No coding agent found. Install at least one: claude (docs.claude.com/claude-code) or codex (npm i -g @openai/codex)"
fi

say "2/8  Installing CLI dependencies (tmux, ffmpeg, whisper-cpp, ollama)"
for pkg in tmux ffmpeg whisper-cpp ollama; do
  if have "${pkg%%-*}" || brew list "$pkg" >/dev/null 2>&1; then ok "$pkg already installed";
  else echo "  installing $pkg..."; brew install "$pkg"; fi
done

say "3/8  Starting Ollama + pulling models (bge-m3, gemma3:4b)"
if ! curl -s --max-time 2 http://localhost:11434/api/tags >/dev/null 2>&1; then
  ollama serve >/tmp/cato-ollama.log 2>&1 & sleep 2
fi
for m in bge-m3 gemma3:4b; do
  if ollama list 2>/dev/null | grep -q "$m"; then ok "$m present";
  else echo "  pulling $m..."; ollama pull "$m"; fi
done

say "4/8  Downloading whisper model (large-v3-turbo, ~1.5GB)"
mkdir -p "$MODELDIR"
if [ -f "$MODELDIR/ggml-large-v3-turbo.bin" ]; then ok "whisper turbo present";
else curl -L --fail -o "$MODELDIR/ggml-large-v3-turbo.bin" "$TURBO_URL"; fi

say "5/8  Installing JS deps + building"
( npm install && npm run build ) && ok "built"

say "6/8  Starting database (Postgres + pgvector)"
if have docker; then
  ( docker compose -f infra/docker-compose.yml up -d ) && ok "db up (schema auto-applied)"
else warn "skipped — install Docker, then: npm run db:up"; fi

say "7/8  Installing the 'cato' launcher on PATH"
DEST="$HOME/.local/bin"; mkdir -p "$DEST"
ln -sf "$ROOT/bin/cato" "$DEST/cato"
ok "linked $DEST/cato"
case ":$PATH:" in *":$DEST:"*) : ;; *) warn "Add to your shell rc:  export PATH=\"\$HOME/.local/bin:\$PATH\"";; esac

say "8/8  Configuring the always-on agent (inactive)"
bash "$ROOT/bin/cato-daemon.sh" setup || warn "daemon setup skipped"

echo
echo "${BOLD}Done. Cato is installed.${RESET}"
echo "  Run an agent:   cato            (launches claude in a tmux session Cato watches)"
echo "  Always-on:      npm run daemon:on   (auto-start on login)   — or run once: npm start"
echo "  Mobile app:     see packages/mobile/README.md"
