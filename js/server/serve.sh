#!/usr/bin/env bash
# Start the hadith-kg API server from a local SSD cache of the databases.
# /Volumes/data (external, HDD-like) cannot handle SQLite random I/O, so the
# DB files are cached under ~/.hadith-kg/ and refreshed when the project copy
# is newer. Loads GEMINI_API_KEY from ../../.env if present (semantic search).
#
# Usage:  bash server/serve.sh [port]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJ="$(cd "$HERE/../.." && pwd)"
CACHE="$HOME/.hadith-kg"
PORT="${1:-8077}"

mkdir -p "$CACHE"
for f in hadith-kg.db hadith-app.db; do
  if [ ! -f "$CACHE/$f" ] || [ "$PROJ/$f" -nt "$CACHE/$f" ]; then
    echo "caching $f -> $CACHE (this can take a few minutes)..."
    cp "$PROJ/$f" "$CACHE/$f.tmp" && mv "$CACHE/$f.tmp" "$CACHE/$f"
  fi
done

if [ -z "${GEMINI_API_KEY:-}" ] && [ -f "$PROJ/.env" ]; then
  export "$(grep GEMINI_API_KEY "$PROJ/.env")"
fi

exec node "$HERE/server.mjs" \
  --app "$CACHE/hadith-app.db" \
  --kg "$CACHE/hadith-kg.db" \
  --port "$PORT"
