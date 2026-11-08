#!/usr/bin/env bash
set -e

if ! command -v docker &>/dev/null; then
  echo "Docker Desktop is required. Install it from https://docs.docker.com/get-docker/"
  exit 1
fi

if ! docker compose version &>/dev/null; then
  echo "Docker Compose is required (included with Docker Desktop)."
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
fi

mkdir -p data/postgres data/workspaces

docker compose up -d

# On Mac, set Docker Desktop to start on login so the app survives reboots
if [ "$(uname)" = "Darwin" ] && [ -d "/Applications/Docker.app" ]; then
  osascript -e '
    tell application "System Events"
      if not (exists login item "Docker") then
        make login item at end with properties {path:"/Applications/Docker.app", hidden:true}
      end if
    end tell
  ' 2>/dev/null && echo "Docker Desktop set to start on login."
fi

PORT=$(grep -E '^APP_PORT=' .env 2>/dev/null | cut -d= -f2)
PORT=${PORT:-3000}

echo ""
echo "Running at http://localhost:${PORT}"
echo "Your data is stored in ./data/ — back up this folder to preserve your threads."
