# OCR_protokoly

Odczyt skanów protokołów (OCR) w przeglądarce — osobny projekt względem `arkusz-mapa`.

- **Specyfikacja:** [`OCR_protokoly_skan_spec.md`](OCR_protokoly_skan_spec.md)
- **Hosting (krok po kroku):** [`HOSTING.md`](HOSTING.md)
- **POC:** [`index.html`](index.html) + [`app.mjs`](app.mjs), [`protocol_parse.mjs`](protocol_parse.mjs), [`roi_ocr.mjs`](roi_ocr.mjs), [`export_xlsx.mjs`](export_xlsx.mjs), [`pdf_errors.mjs`](pdf_errors.mjs) — Excel dzienny, `done` / `problematyczne` (Chrome + folder z zapisem)
- **Dane testowe (layout Word → PDF):** folder [`dane testowe/`](dane%20testowe/)
- **Kalibracja ROI (str. 1, `pdftotext -tsv`):** uruchom `python3 tools/calibrate_layout.py` → plik [`calibration/roi_hints.json`](calibration/roi_hints.json)

Uruchomienie lokalne: z tego katalogu `python3 -m http.server 8765`, potem w Chrome `http://127.0.0.1:8765`.

Testy bez PDF: `node tests/protocol_parse_selftest.mjs` oraz `node tests/pdf_errors_selftest.mjs`
