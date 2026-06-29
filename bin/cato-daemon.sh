#!/usr/bin/env bash
# Manage Cato's always-on background agent. Cross-platform: macOS (launchd) and
# Linux (systemd user service). Windows: run `npm start` (or Task Scheduler).
#   setup   configure it, INACTIVE (run by install.sh)
#   on      start it (auto-launch on login + restart on crash)   `npm run daemon:on`
#   off     stop it
#   remove  stop + delete
set -euo pipefail

self="$0"; [ -L "$self" ] && self="$(readlink "$self")"
ROOT="$(cd "$(dirname "$self")/.." && pwd)"
NODE="$(command -v node)"; NODEDIR="$(dirname "$NODE")"
ENTRY="$ROOT/packages/desktop-agent/dist/index.js"
OS="$(uname)"
cmd="${1:-setup}"

# ---------------- macOS (launchd) ----------------
if [ "$OS" = "Darwin" ]; then
  LABEL="dev.catoai.agent"
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  write() {
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.cato"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$ENTRY</string></array>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$NODEDIR:$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.cato/agent.log</string>
  <key>StandardErrorPath</key><string>$HOME/.cato/agent.log</string>
</dict></plist>
EOF
  }
  case "$cmd" in
    setup)  write; echo "✓ daemon configured (inactive). Enable: npm run daemon:on" ;;
    on)     [ -f "$PLIST" ] || write; launchctl unload "$PLIST" 2>/dev/null || true; launchctl load "$PLIST"; echo "✓ Cato always-on. Logs: ~/.cato/agent.log" ;;
    off)    launchctl unload "$PLIST" 2>/dev/null || true; echo "✓ stopped." ;;
    remove) launchctl unload "$PLIST" 2>/dev/null || true; rm -f "$PLIST"; echo "✓ removed." ;;
    *) echo "usage: cato-daemon.sh [setup|on|off|remove]"; exit 1 ;;
  esac
  exit 0
fi

# ---------------- Linux (systemd user service) ----------------
if [ "$OS" = "Linux" ] && command -v systemctl >/dev/null 2>&1; then
  UNIT="$HOME/.config/systemd/user/cato.service"
  write() {
    mkdir -p "$HOME/.config/systemd/user" "$HOME/.cato"
    cat > "$UNIT" <<EOF
[Unit]
Description=Cato agent
After=network.target
[Service]
ExecStart=$NODE $ENTRY
WorkingDirectory=$ROOT
Environment=PATH=$NODEDIR:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
Restart=always
RestartSec=3
[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload 2>/dev/null || true
  }
  case "$cmd" in
    setup)  write; echo "✓ daemon configured (inactive). Enable: npm run daemon:on" ;;
    on)     [ -f "$UNIT" ] || write; systemctl --user enable --now cato.service; echo "✓ Cato always-on (systemd). Logs: journalctl --user -u cato -f" ;;
    off)    systemctl --user disable --now cato.service 2>/dev/null || true; echo "✓ stopped." ;;
    remove) systemctl --user disable --now cato.service 2>/dev/null || true; rm -f "$UNIT"; systemctl --user daemon-reload 2>/dev/null || true; echo "✓ removed." ;;
    *) echo "usage: cato-daemon.sh [setup|on|off|remove]"; exit 1 ;;
  esac
  exit 0
fi

# ---------------- other (Windows / no systemd) ----------------
echo "Auto-start isn't wired for this OS. Run the agent with: npm start"
[ "$cmd" = "setup" ] && exit 0 || exit 0
