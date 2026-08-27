#!/usr/bin/env sh
# Run ./play.sh (or `sh play.sh`) to play. Installs what is missing on the
# first run, starts the dev server and opens the browser.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install it from https://nodejs.org (LTS)." >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies. This happens once and takes a minute."
  npm install
fi

echo "Starting the game. The browser opens by itself."
npm start
