#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="$HOME/Lumiverse/data/extensions/sidebar_ux/repo"

cd "$SCRIPT_DIR"
bun build src/frontend.ts --outfile dist/frontend.js --target browser --format esm
bun build src/backend.ts --outfile dist/backend.js --target bun --format esm
mkdir -p "$RUNTIME_DIR/dist"
cp -v dist/frontend.js "$RUNTIME_DIR/dist/frontend.js"
cp -v dist/backend.js "$RUNTIME_DIR/dist/backend.js"
cp -v spindle.json "$RUNTIME_DIR/spindle.json"
echo "Done. Hard-refresh browser (Ctrl+F5)."
