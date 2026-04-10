#!/usr/bin/env bash
# Uruchom wszystkie selftesty (Node.js, bez PDF).
# Katalog roboczy: OCR_protokoly/  (skrypt można wywołać też z tools/).
set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT"

PASS=0
FAIL=0

run_test() {
  local file="$1"
  printf "  %-50s" "$file"
  if node "$file" 2>&1; then
    echo "OK"
    PASS=$((PASS + 1))
  else
    echo "FAIL"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Selftesty OCR_protokoly ==="
run_test tests/protocol_parse_selftest.mjs
run_test tests/roi_pick_selftest.mjs
run_test tests/pdf_errors_selftest.mjs
run_test tests/excel_export_selftest.mjs
run_test tests/folder_jobs_selftest.mjs

echo ""
echo "Wynik: $PASS OK, $FAIL FAIL"
[ "$FAIL" -eq 0 ]
