#!/usr/bin/env bash
set -e

# Native setup — runs directly on your machine without Docker.
# Agents have full access to your filesystem.

missing=()

if ! command -v node &>/dev/null; then
  missing+=("Node.js (https://nodejs.org/)")
fi

if ! command -v psql &>/dev/null; then
  missing+=("PostgreSQL (brew install postgresql@17)")
fi

if ! command -v claude &>/dev/null; then
  missing+=("Claude Code CLI (npm install -g @anthropic-ai/claude-code)")
fi

if [ ${#missing[@]} -gt 0 ]; then
  echo "Missing dependencies:"
  for dep in "${missing[@]}"; do
    echo "  - $dep"
  done
  exit 1
fi

# Create the database if it doesn't exist
if ! psql -lqt 2>/dev/null | cut -d\| -f1 | grep -qw harness_v2; then
  echo "Creating database harness_v2..."
  createdb harness_v2
fi

npm install

echo ""
echo "Setup complete. To start:"
echo "  npm run dev"
echo ""
echo "This starts the server on port 3710 and the client on port 3711."
echo "Open http://localhost:3711 in your browser."
