# Status implementacji — OCR_protokoly

Krótki przegląd **co działa w POC** i **co zostaje do zrobienia** (zwłaszcza po dostarczeniu **prawdziwych skanów**). Szczegóły wymagań: [`OCR_protokoly_skan_spec.md`](OCR_protokoly_skan_spec.md).

---

## Zrobione (POC)

### Przepływ główny
- Wybór folderu w **Chrome** z **zapisem** (File System Access) lub wybór folderu przez `<input webkitdirectory>` (pobranie Excela bez przenoszenia PDF).
- Kolejka **jeden PDF po drugim**, jeden worker **Tesseract.js** (polski), **pdf.js** do rasteru stron.
- Pola: **numer zlecenia**, **przewoźnik**, **lista plomb** → parser w [`protocol_parse.mjs`](protocol_parse.mjs).
- **Excel** `wynik_YYYY-MM-DD.xlsx` w folderze roboczym: dopisywanie przy drugim uruchomieniu tego samego dnia, normalizacja nagłówków ze starego pliku, **błąd przy uszkodzonym istniejącym .xlsx** → przerwanie zapisu, PDF **nie** przenoszone ([`export_xlsx.mjs`](export_xlsx.mjs)).
- Po sukcesie zapisu: PDF → **`done`** lub **`problematyczne`** (podfoldery tworzone automatycznie).
- **Ścieżka względna** w kolumnie `nazwa_pliku` przy PDF z podfolderów; przy przeniesieniu **unikalna nazwa** pliku (`pod__plik.pdf`).

### OCR / PDF
- **Warstwa tekstowa PDF** (eksport Word): odczyt bez OCR, jeśli heurystyka uzna tekst za pełny protokół.
- **Skany / brak tekstu**: OCR strony 1 przez **ROI** (`calibration/roi_default.json` + [`roi_ocr.mjs`](roi_ocr.mjs)), przy słabej strukturze — drugi przebieg **cała strona 1**; dalsze strony — pełny OCR.
- **Pewność Tesseract**: minimalna z użytych przebiegów vs próg (`OCR_CONFIDENCE_MIN` + regulacja w UI + `localStorage`); poniżej → **problematyczne**. Na stronie: widoczna podpowiedź + `title` na etykiecie „Próg OCR”.
- Czytelne błędy **pdf.js**: [`pdf_errors.mjs`](pdf_errors.mjs) (hasło, uszkodzony plik itd.).

### Kalibracja (dev, bez przeglądarki)
- [`tools/calibrate_layout.py`](tools/calibrate_layout.py) + [`calibration/roi_hints.json`](calibration/roi_hints.json) (wymaga `pdftotext` z Popplera).

### UX
- Pasek postępu (per plik), status, log na żywo.
- **Przerwij** batch + **Esc**; po przerwaniu: częściowy Excel (jeśli były wiersze), przeniesienia tylko dla przetworzonych.
- **Pobierz log (.txt)**, **Wyczyść log**; blokada opcji (podfoldery, próg OCR) w trakcie batcha.

### Testy (Node, bez PDF)
- `node tests/protocol_parse_selftest.mjs`
- `node tests/pdf_errors_selftest.mjs`
- `node tests/excel_export_selftest.mjs`

### Dokumentacja operacyjna
- [`README.md`](README.md), [`HOSTING.md`](HOSTING.md).

---

## TODO / dalsza praca

### Wymaga prawdziwych skanów (priorytet)
- [ ] **Próbki skanów bitowych** (kontrast, skos, zagięcia, dopiski odręczne).
- [ ] **Dopasowanie ROI** do skanów (marginesy, ewentualnie deskew / kontrast przed OCR).
- [ ] **Ostateczna długość i regex** `numer_zlecenia` (obecnie dowolna liczba cyfr z etykiety) i **`numer_plomby`** (POC: 15 cyfr jak w Word — do potwierdzenia).
- [ ] **Progi confidence per pole** (osobno ROI zlecenie / lista plomb / przewoźnik vs średnia z całego bloku).
- [ ] **Dopiski odręczne** w polach — heurystyka lub flaga z silnika (§4 spec) → na razie **nie** zaimplementowane.

### Excel / audyt (doprecyzowanie vs §3.2)
- [ ] Przy częściowym sukcesie plomb: spec przewiduje **różne `Uwagi_odczyt` per wiersz** dla problematycznych plomb; POC ustawia **jedną** wartość `uwagi_excel` dla wszystkich wierszy pliku i do Excela trafiają tylko plomby **z poprawnym formatem 15 cyfr**.

### Produkt / techniczne
- [ ] **Filtr nazw PDF** (jeśli potrzebny poza `*.pdf`).
- [ ] **Paczka offline** + ewentualnie `.bat` + lokalny serwer (opis w §6 spec — nie zautomatyzowane w repo).
- [ ] **CSP / SRI** pod konkretny hosting (jeśli polityka bezpieczeństwa wymaga).
- [ ] Opcjonalnie: **terminacja workera OCR** przy zamknięciu karty (oszczędność zasobów).

### Spec — otwarte punkty (skrót)
Pełna lista checkboxów: **§8** w [`OCR_protokoly_skan_spec.md`](OCR_protokoly_skan_spec.md). Najważniejsze nadal otwarte: **skany bitowe**, **regexy/długości**, **ROI po skanach**, **progi per pole**, **dopiski odręczne**.

---

## Skrót plików

| Plik | Rola |
|------|------|
| `index.html` | UI, style |
| `app.mjs` | Kolejka, FSA, integracja |
| `protocol_parse.mjs` | Parsowanie tekstu, kwalifikacja, próg OCR |
| `roi_ocr.mjs` | ROI + OCR + confidence na wycinkach |
| `export_xlsx.mjs` | Wiersze Excel, merge, zapis |
| `pdf_errors.mjs` | Komunikaty błędów PDF |
| `calibration/roi_default.json` | Domyślne ROI dla str. 1 |
| `tools/calibrate_layout.py` | Generowanie `roi_hints.json` z PDF z tekstem |

---

*Ostatnia aktualizacja dokumentu: stan repozytorium w momencie utworzenia pliku (POC).*
