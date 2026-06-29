#!/usr/bin/env bash
# Cato installer — sets up the whole local stack on macOS in one go.
#
#   git clone <repo> cato && cd cato && ./install.sh
#
# Idempotent: re-running only does what's missing. Requires macOS + Homebrew + Docker.
set -uo pipefail

BOLD=$(tput bold 2>/dev/null || true); RESET=$(tput sgr0 2>/dev/null || true)
say()  { echo "${BOLD}▸ $*${RESET}"; }
ok()   { echo "  ✓ $*"; }
warn() { echo "  ⚠ $*"; }
have() { command -v "$1" >/dev/null 2>&1; }

ROOT="$(cd "$(dirname "$0")" && pwd)"
MODELDIR="$HOME/.cato/models"
TURBO_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin"

say "1/7  Checking prerequisites"
[ "$(uname)" = "Darwin" ] || warn "Not macOS — TTS (say) and some defaults assume macOS."
have brew   || { echo "  ✗ Homebrew required: https://brew.sh"; exit 1; }
have node   || { echo "  ✗ Node.js ≥20 required: brew install node"; exit 1; }
have docker || warn "Docker not found — install Docker Desktop, then re-run (needed for the database)."
ok "brew, node present"
# Coding agents Cato wraps (need at least one).
if have claude || have codex; then
  have claude && ok "claude-cli found"; have codex && ok "codex-cli found"
else
  warn "No coding agent found. Install at least one:"
  warn "  claude:  https://docs.claude.com/claude-code"
  warn "  codex:   npm i -g @openai/codex"
fi

say "2/7  Installing CLI dependencies (tmux, ffmpeg, whisper-cpp, ollama)"
for pkg in tmux ffmpeg whisper-cpp ollama; do
  if have "${pkg%%-*}" || brew list "$pkg" >/dev/null 2>&1; then ok "$pkg already installed";
  else echo "  installing $pkg..."; brew install "$pkg"; fi
done

say "3/7  Starting Ollama + pulling models (bge-m3, qwen3:4b)"
if ! curl -s --max-time 2 http://localhost:11434/api/tags >/dev/null 2>&1; then
  ollama serve >/tmp/cato-ollama.log 2>&1 & sleep 2
fi
for m in bge-m3 qwen3:4b; do
  if ollama list 2>/dev/null | grep -q "$m"; then ok "$m present";
  else echo "  pulling $m..."; ollama pull "$m"; fi
done

say "4/7  Downloading whisper model (large-v3-turbo, ~1.5GB)"
mkdir -p "$MODELDIR"
if [ -f "$MODELDIR/ggml-large-v3-turbo.bin" ]; then ok "whisper turbo present";
else curl -L --fail -o "$MODELDIR/ggml-large-v3-turbo.bin" "$TURBO_URL"; fi

say "5/7  Installing JS deps + building"
( cd "$ROOT" && npm install && npm run build )
ok "built"

say "6/7  Starting database (Postgres + pgvector)"
if have docker; then
  ( cd "$ROOT" && docker compose -f infra/docker-compose.yml up -d ) && ok "db up (schema auto-applied)"
else warn "skipped — install Docker, then: npm run db:up"; fi

say "7/7  Installing the 'cato' launcher on PATH"
DEST="$HOME/.local/bin"; mkdir -p "$DEST"
ln -sf "$ROOT/bin/cato" "$DEST/cato"
ok "linked $DEST/cato"
case ":$PATH:" in *":$DEST:"*) : ;; *) warn "Add to your shell rc:  export PATH=\"\$HOME/.local/bin:\$PATH\"";; esac

echo
echo "${BOLD}Done. Cato is installed.${RESET}"
echo "  Start the brain:   npm start"
echo "  Run an agent:      cato            (launches claude in a tmux session Cato watches)"
echo "  Mobile app:        see packages/mobile/README.md (Xcode dev build / TestFlight)"
