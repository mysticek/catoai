#!/usr/bin/env bash
# Manage Cato's always-on macOS LaunchAgent.
#   setup   write the LaunchAgent (INACTIVE — does not start it). Run by install.sh.
#   on      start it (auto-launch on login + restart on crash). `npm run daemon:on`
#   off     stop it
#   remove  stop + delete
set -euo pipefail

self="$0"; [ -L "$self" ] && self="$(readlink "$self")"
ROOT="$(cd "$(dirname "$self")/.." && pwd)"
LABEL="dev.catoai.agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$(command -v node)"; NODEDIR="$(dirname "$NODE")"

write_plist() {
  mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.cato"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$ROOT/packages/desktop-agent/dist/index.js</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$NODEDIR:$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.cato/agent.log</string>
  <key>StandardErrorPath</key><string>$HOME/.cato/agent.log</string>
</dict></plist>
EOF
}

case "${1:-setup}" in
  setup)  write_plist; echo "✓ daemon configured (inactive). Enable always-on: npm run daemon:on" ;;
  on)     [ -f "$PLIST" ] || write_plist; launchctl unload "$PLIST" 2>/dev/null || true; launchctl load "$PLIST"; echo "✓ Cato always-on. Logs: ~/.cato/agent.log" ;;
  off)    launchctl unload "$PLIST" 2>/dev/null || true; echo "✓ Cato daemon stopped." ;;
  remove) launchctl unload "$PLIST" 2>/dev/null || true; rm -f "$PLIST"; echo "✓ Cato daemon removed." ;;
  *) echo "usage: cato-daemon.sh [setup|on|off|remove]"; exit 1 ;;
esac
