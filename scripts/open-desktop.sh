#!/usr/bin/env bash
# Open the running Openbook web app in a standalone desktop window
# (Chrome/Edge/Chromium app mode). This is the KEP-002 desktop client.
set -euo pipefail
URL="${OPENBOOK_URL:-http://127.0.0.1:5173}"

open_app() {
  local bin="$1"
  exec "$bin" --app="$URL"
}

if command -v google-chrome >/dev/null; then
  open_app google-chrome
elif command -v chromium >/dev/null; then
  open_app chromium
elif command -v microsoft-edge >/dev/null; then
  open_app microsoft-edge
elif [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
  exec "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --app="$URL"
else
  echo "Install Chrome, Chromium, or Edge, then re-run. Falling back to the default browser." >&2
  if command -v open >/dev/null; then
    exec open "$URL"
  fi
  exec xdg-open "$URL"
fi
