#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RUNTIME_DIR="$HOME/Lumiverse/data/extensions/canvas/repo"

cd "$SCRIPT_DIR"
VERSION=$(jq -r .version package.json)

# Inject CANVAS_VERSION from package.json (sed replaces the stub before bundling)
sed -i "s|export const CANVAS_VERSION = ''|export const CANVAS_VERSION = '$VERSION'|" src/layout/persist.ts

bun build src/frontend.ts --outfile dist/frontend.js --target browser --format esm
bun build src/backend.ts --outfile dist/backend.js --target bun --format esm

# Restore the stub so the source stays clean for editing
sed -i "s|export const CANVAS_VERSION = '$VERSION'|export const CANVAS_VERSION = ''|" src/layout/persist.ts
mkdir -p "$RUNTIME_DIR/dist"
cp -v dist/frontend.js "$RUNTIME_DIR/dist/frontend.js"
cp -v dist/backend.js "$RUNTIME_DIR/dist/backend.js"
cp -v spindle.json "$RUNTIME_DIR/spindle.json"
echo "Done. Hard-refresh browser (Ctrl+F5)."
