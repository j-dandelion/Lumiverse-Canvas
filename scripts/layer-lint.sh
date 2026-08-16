#!/usr/bin/env bash
set -euo pipefail
ROOT="$(dirname "$0")/.."
CORE_DIR="$ROOT/src/core"
if [ ! -d "$CORE_DIR" ]; then echo "layer-lint: no src/core/ — OK"; exit 0; fi
failed=0
while IFS= read -r -d '' f; do
  while IFS= read -r spec; do
    [ -z "$spec" ] && continue
    [[ "$spec" == ./* || "$spec" == ../* ]] || continue  # skip tsconfig paths
    resolved="$(realpath -m "$(dirname "$f")/$spec" 2>/dev/null || echo .)"
    if ! echo "$resolved" | grep -q "/src/core/"; then
      echo "layer-lint: FAIL $f imports '$spec' (resolves outside src/core/)"
      failed=1
    fi
  done < <(grep -oP "(?:from|import)\s+'([^']+)'" "$f" | grep -oP "'[^']+'" | tr -d "'")
done < <(find "$CORE_DIR" -name '*.ts' ! -name '*.test.ts' ! -path '*/__tests__/*' -print0)
if [ "$failed" -eq 1 ]; then echo "layer-lint: VIOLATION"; exit 1; fi
echo "layer-lint: core/ isolation OK"
