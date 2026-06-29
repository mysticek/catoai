#!/usr/bin/env bash
# Cato installer — one command sets up the whole local stack. Cross-platform:
# macOS (Homebrew) and Linux (apt/dnf/pacman). Windows: run under WSL.
#
#   curl -fsSL https://raw.githubusercontent.com/mysticek/catoai/main/install.sh | bash
#   # or, in a clone:  ./install.sh
#
# No Docker, no database server — the DB is embedded (PGlite). Idempotent.
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
OS="$(uname)"

# Install a system package with whatever package manager is present.
pkg() { # pkg <command> [brew-name]
  local cmd="$1" brewname="${2:-$1}"
  if have "$cmd"; then ok "$cmd present"; return; fi
  echo "  installing $cmd..."
  if have brew;       then brew install "$brewname"
  elif have apt-get;  then sudo apt-get update -qq && sudo apt-get install -y "$cmd"
  elif have dnf;      then sudo dnf install -y "$cmd"
  elif have pacman;   then sudo pacman -S --noconfirm "$cmd"
  else warn "couldn't auto-install $cmd — install it manually"; fi
}

# Bootstrap: when piped from the web (curl | bash) we're not in the repo — clone it.
if [ ! -f "$ROOT/packages/desktop-agent/package.json" ]; then
  have git || { echo "git is required"; exit 1; }
  APPDIR="$HOME/.cato/app"
  say "Fetching Cato into $APPDIR"
  if [ -d "$APPDIR/.git" ]; then (cd "$APPDIR" && git pull -q); else git clone -q "$REPO" "$APPDIR"; fi
  ROOT="$APPDIR"
fi
cd "$ROOT"

say "1/7  Checking prerequisites ($OS)"
have node || { echo "  Node.js >=20 required (https://nodejs.org)"; exit 1; }
ok "node present"
if have claude || have codex; then
  have claude && ok "claude-cli found"; have codex && ok "codex-cli found"
else
  warn "No coding agent yet. Install one: claude (docs.claude.com/claude-code) or codex (npm i -g @openai/codex)"
fi

say "2/7  Installing CLI dependencies (tmux, ffmpeg)"
pkg tmux
pkg ffmpeg
[ "$OS" != "Darwin" ] && [ -z "${TMUX_OK:-}" ] && ! have tmux && warn "tmux is required to capture agents"

say "3/7  Installing whisper.cpp (speech-to-text)"
if have whisper-cli || have whisper-server; then ok "whisper.cpp present"
elif have brew; then brew install whisper-cpp
else warn "whisper.cpp not auto-installable here — voice STT will be off until you build it (github.com/ggerganov/whisper.cpp). Typed commands still work."
fi

say "4/7  Installing Ollama + models (bge-m3, gemma3:4b)"
if ! have ollama; then
  if have brew; then brew install ollama
  elif [ "$OS" = "Linux" ]; then curl -fsSL https://ollama.com/install.sh | sh
  else warn "install Ollama from https://ollama.com"; fi
fi
if have ollama; then
  curl -s --max-time 2 http://localhost:11434/api/tags >/dev/null 2>&1 || { ollama serve >/tmp/cato-ollama.log 2>&1 & sleep 2; }
  for m in bge-m3 gemma3:4b; do
    if ollama list 2>/dev/null | grep -q "$m"; then ok "$m present"; else echo "  pulling $m..."; ollama pull "$m"; fi
  done
fi

say "5/7  Downloading whisper model (large-v3-turbo, ~1.5GB)"
mkdir -p "$MODELDIR"
if [ -f "$MODELDIR/ggml-large-v3-turbo.bin" ]; then ok "whisper turbo present"
else curl -L --fail -o "$MODELDIR/ggml-large-v3-turbo.bin" "$TURBO_URL" || warn "model download failed — re-run later"; fi

say "6/7  Installing JS deps + building (embedded DB, no Docker)"
( npm install && npm run build ) && ok "built"

say "7/7  Linking 'cato' + configuring the daemon (inactive)"
DEST="$HOME/.local/bin"; mkdir -p "$DEST"
ln -sf "$ROOT/bin/cato" "$DEST/cato"
ok "linked $DEST/cato"
case ":$PATH:" in *":$DEST:"*) : ;; *) warn "Add to your shell rc:  export PATH=\"\$HOME/.local/bin:\$PATH\"";; esac
bash "$ROOT/bin/cato-daemon.sh" setup || warn "daemon setup skipped"

if [ -t 0 ]; then
  echo; node "$ROOT/bin/cato-setup.mjs" || warn "run 'cato setup' later"
else
  warn "piped install — run 'cato setup' in your terminal to choose your workspace + get your pairing token"
fi

echo
echo "${BOLD}Done. Cato is installed — no Docker, embedded database.${RESET}"
echo "  Set up / re-run:  cato setup       (workspace folder + pairing token)"
echo "  Run an agent:     cato             (launches your agent in a tmux session Cato watches)"
echo "  Always-on:        npm run daemon:on (auto-start on login)   — or run once: npm start"
echo "  Mobile app:       see packages/mobile/README.md"
