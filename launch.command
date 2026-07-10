#!/bin/bash
# ATLAS Action Tracker — owner-only local development launcher
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Kill stale processes from previous session (laptop sleep/reboot recovery)
lsof -ti:3001 | xargs kill 2>/dev/null
lsof -ti:5173 | xargs kill 2>/dev/null
sleep 1

# Start the canonical Cloudflare Worker API locally.
(cd worker && npx wrangler dev --port 3001) &
WORKER_PID=$!
sleep 1

# Start Vite dev server for local development (hot reload).
# Set ATLAS_LAN_DEV=1 only when intentionally testing from another device.
if [ "$ATLAS_LAN_DEV" = "1" ]; then
  (cd app && npx vite --host 0.0.0.0 --port 5173) &
else
  (cd app && npx vite --host 127.0.0.1 --port 5173) &
fi
APP_PID=$!

cleanup() {
  kill "$APP_PID" "$WORKER_PID" 2>/dev/null
}
trap cleanup EXIT INT TERM
sleep 2

# Open local dev server in browser
open http://localhost:5173

# Get local IP for phone access
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo ""
echo "==================================="
echo "  ATLAS Action Tracker is running"
echo "==================================="
echo "  Local dev:  http://localhost:5173"
if [ "$ATLAS_LAN_DEV" = "1" ]; then
echo "  Phone LAN:  http://$IP:5173"
fi
echo "  API:        http://localhost:3001"
echo "==================================="
echo ""
echo "Press Ctrl+C to stop."

# Keep window open
wait
