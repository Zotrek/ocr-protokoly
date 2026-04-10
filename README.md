# OCR_protokoly

Odczyt skanów protokołów (OCR) w przeglądarce — osobny projekt względem `arkusz-mapa`.

- **Specyfikacja:** [`OCR_protokoly_skan_spec.md`](OCR_protokoly_skan_spec.md)
- **Co zrobione / TODO (POC):** [`STATUS_IMPLEMENTACJI.md`](STATUS_IMPLEMENTACJI.md)
- **Hosting (krok po kroku):** [`HOSTING.md`](HOSTING.md)
- **POC:** [`index.html`](index.html) + [`app.mjs`](app.mjs), … — **Chrome / Edge:** Excel w folderze, PDF → `done` / `problematyczne` (File System Access). **Firefox:** ten sam OCR i Excel, plik `.xlsx` przez **pobranie** (brak zapisu do wybranego katalogu i brak przenoszenia PDF).
- **Dane testowe (layout Word → PDF):** folder [`dane testowe/`](dane%20testowe/)
- **Kalibracja ROI (str. 1, `pdftotext -tsv`):** uruchom `python3 tools/calibrate_layout.py` → plik [`calibration/roi_hints.json`](calibration/roi_hints.json)

Uruchomienie lokalne: z tego katalogu `python3 -m http.server 8765`, potem w przeglądarce `http://127.0.0.1:8765` (Chrome / Edge — pełny tryb z folderem; Firefox — tryb z pobraniem Excela). Opcjonalnie **filtr nazwy** pliku PDF w UI.

Testy bez PDF: `node tests/protocol_parse_selftest.mjs`, `node tests/pdf_errors_selftest.mjs`, `node tests/excel_export_selftest.mjs`
