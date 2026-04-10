#!/usr/bin/env bash
# Uruchomienie statycznego serwera dla OCR_protokoly (Chrome/Firefox — http://127.0.0.1, nie file://).
set -euo pipefail
PORT="${1:-8765}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
echo "OCR_protokoly: http://127.0.0.1:${PORT}/"
echo "Zatrzymanie: Ctrl+C"
exec python3 -m http.server "$PORT"
