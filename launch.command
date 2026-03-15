#!/bin/bash
# ATLAS Action Tracker — Double-click to launch
cd "$(dirname "$0")/app"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Build production frontend if dist/ is missing or stale
if [ ! -f dist/index.html ] || [ src/App.jsx -nt dist/index.html ]; then
  echo "Building frontend..."
  npx vite build --silent
fi

# Start Express in production mode (serves API + built frontend)
if ! lsof -ti:3001 >/dev/null 2>&1; then
  NODE_ENV=production node server/index.js &
  sleep 1
fi

# Start Vite dev server for local development (hot reload)
if ! lsof -ti:5173 >/dev/null 2>&1; then
  npx vite --host 0.0.0.0 --port 5173 &
  sleep 2
fi

# Open local dev server in browser
open http://localhost:5173

# Start Cloudflare tunnel if available (points to production on 3001)
TUNNEL_URL=""
if command -v cloudflared &>/dev/null; then
  cloudflared tunnel run atlas &>/dev/null &
  TUNNEL_DOMAIN=$(grep TUNNEL_DOMAIN .env 2>/dev/null | cut -d= -f2)
  if [ -n "$TUNNEL_DOMAIN" ]; then
    TUNNEL_URL="https://$TUNNEL_DOMAIN"
  fi
fi

# Get local IP for phone access
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo ""
echo "==================================="
echo "  ATLAS Action Tracker is running"
echo "==================================="
echo "  Local dev:  http://localhost:5173"
echo "  Phone LAN:  http://$IP:5173"
if [ -n "$TUNNEL_URL" ]; then
echo "  Remote:     $TUNNEL_URL"
fi
echo "==================================="
echo ""
echo "Press Ctrl+C to stop."

# Keep window open
wait
