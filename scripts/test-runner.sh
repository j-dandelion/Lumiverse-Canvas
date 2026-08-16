#!/usr/bin/env bash

FAILED_FILES=()
PASSED_COUNT=0
FAILED_COUNT=0
TOTAL_FILES=0

for test_file in $(find src -name '*.test.*' -type f | sort); do
  TOTAL_FILES=$((TOTAL_FILES + 1))
  REL_PATH="${test_file#src/}"

  OUTPUT=$(bun run "$test_file" 2>&1) || true
  EXIT_CODE=$?

  HAS_FAILED=$(echo "$OUTPUT" | grep -cE "FAILED: [1-9]" 2>/dev/null || true)

  if [ "$EXIT_CODE" -ne 0 ]; then
    FAILED_COUNT=$((FAILED_COUNT + 1))
    FAILED_FILES+=("$REL_PATH")
    echo "FAIL  $REL_PATH  (exit $EXIT_CODE)"
    echo "$OUTPUT" | grep -vE "^(PASS|FAILED):" 2>/dev/null | tail -20 || true
    echo ""
  elif [ "$HAS_FAILED" -gt 0 ]; then
    FAILED_COUNT=$((FAILED_COUNT + 1))
    FAILED_FILES+=("$REL_PATH")
    echo "FAIL  $REL_PATH  (assertion failures)"
    echo "$OUTPUT" | grep -E "^FAIL:" 2>/dev/null || true
    echo "$OUTPUT" | grep -E "^FAILED:" 2>/dev/null || true
    echo ""
  else
    PASSED_COUNT=$((PASSED_COUNT + 1))
    PASS_LINE=$(echo "$OUTPUT" | grep -E "(PASS:|passed)" 2>/dev/null | tail -1 || true)
    echo "PASS  $REL_PATH  $PASS_LINE"
  fi
done

echo ""
echo "============================="
echo "Summary: $PASSED_COUNT passed, $FAILED_COUNT failed of $TOTAL_FILES total"

if [ ${#FAILED_FILES[@]} -gt 0 ]; then
  echo ""
  echo "Failed files:"
  for f in "${FAILED_FILES[@]}"; do
    echo "  $f"
  done
  exit 1
fi

echo "All tests passed."
