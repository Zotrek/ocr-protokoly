# Status implementacji — OCR_protokoly

Krótki przegląd **co działa w POC** i **co zostaje do zrobienia** (zwłaszcza po dostarczeniu **prawdziwych skanów**). Szczegóły wymagań: [`OCR_protokoly_skan_spec.md`](OCR_protokoly_skan_spec.md).

---

## Zrobione (POC)

### Przepływ główny
- Wybór folderu: **Chrome / Edge** — File System Access (zapis Excela w folderze, przenoszenie PDF) albo **Firefox** — `<input webkitdirectory>` / `directory` (OCR jak w Chrome; Excel przez **pobranie**, bez przenoszenia PDF). Lista plików: [`folder_jobs.mjs`](folder_jobs.mjs) (`webkitRelativePath` z pierwszym segmentem = nazwa wybranego katalogu).
- Kolejka **jeden PDF po drugim**, jeden worker **Tesseract.js** (polski), **pdf.js** do rasteru stron.
- Pola: **numer zlecenia**, **przewoźnik**, **lista plomb** → parser w [`protocol_parse.mjs`](protocol_parse.mjs).
- **Excel** `wynik_YYYY-MM-DD.xlsx` w folderze roboczym: dopisywanie przy drugim uruchomieniu tego samego dnia, normalizacja nagłówków ze starego pliku, **błąd przy uszkodzonym istniejącym .xlsx** → przerwanie zapisu, PDF **nie** przenoszone ([`export_xlsx.mjs`](export_xlsx.mjs)).
- Po sukcesie zapisu: PDF → **`done`** lub **`problematyczne`** (podfoldery tworzone automatycznie).
- **Ścieżka względna** w kolumnie `nazwa_pliku` przy PDF z podfolderów; przy przeniesieniu **unikalna nazwa** pliku (`pod__plik.pdf`).

### OCR / PDF
- **Warstwa tekstowa PDF** (eksport Word): odczyt bez OCR, jeśli heurystyka uzna tekst za pełny protokół.
- **Skany / brak tekstu na str. 1**: OCR strony 1 przez **ROI** (`calibration/roi_default.json` + [`roi_ocr.mjs`](roi_ocr.mjs)), przy słabej strukturze — drugi przebieg **cała strona 1**; przed OCR na rastrze — **szarość + lekki kontrast** (`enhanceCanvasForOcr` w [`roi_ocr.mjs`](roi_ocr.mjs)).
- **Strony 2+** przy skanie (brak warstwy tekstowej): **OCR pełnej strony** dla każdej takiej strony (teksty łączone `\n\n` → parser). Str. 1 nadal **ROI** (+ ewentualnie pełna str. 1). Gdy strona ma **warstwę tekstową**, używany jest on zamiast OCR.
- **Wiele protokołów w jednym PDF:** `parseProtocolText` dzieli po nagłówku `Zlecenie transportowe nr:` i zwraca **`segments`** — Excel: osobne wiersze z **numerem zlecenia / przewoźnikiem** per segment.
- **Lista w dwóch kolumnach** (wiele `1. … 2. …` w jednym wierszu): wyciąganie plomb po **pozycjach `k.`** z zatrzymaniem przed następnym `k.` (funkcja `plombyFromListLine` w [`protocol_parse.mjs`](protocol_parse.mjs)).
- **ROI wąska vs A4**: w `roi_default.json` jest **`narrow_page_width_pt_max`** (domyślnie **585** pt w przestrzeni PDF): strona węższa niż próg (np. skan ~578×824) używa **`regions_norm_narrow`**, szersza — **`regions_norm`**. Gdy progu szerokości **nie ma** w JSON, wybór „wąskiej” mapy pada na **`aspect_ratio_narrow_max`** (fallback).
- **Str. 2+:** jeśli warstwa PDF jest **niepusta**, ale **bez** nagłówka listy plomb (`RE_LISTA_PLOMB` — m.in. „Lista o debranych…”, „Lista oderbranych…”) — **wymuszany OCR** pełnej strony (typowy skan z bezużytecznym tekstem).
- **Pewność Tesseract**: przy **OCR ROI str. 1** (wybrana ścieżka ROI, nie pełna strona) — osobno **numer zlecenia / przewoźnik / lista plomb** vs próg (`niski_confidence_ocr_roi_*` w `Uwagi_odczyt`); opcjonalnie **inny próg per region** (puste pole = próg ogólny). Przy **pełnej stronie 1** lub braku mapy ROI — **jedna** wartość `niski_confidence_ocr(min)`. Regulacja w UI + `localStorage`.
- **Podejrzenie dopisku / szumu OCR (POC):** surowe teksty ROI (`roiRawTexts` z [`roi_ocr.mjs`](roi_ocr.mjs)) — heurystyka `roiOcrTextSuggestsHandwritingNoise` w [`protocol_parse.mjs`](protocol_parse.mjs); przy ścieżce **ROI** (nie pełna str. 1) token `podejrzenie_odreczne_roi_*` → `problematyczne`; w Excelu etykiety w [`export_xlsx.mjs`](export_xlsx.mjs).
- **Zamknięcie karty**: `pagehide` → `terminate()` workera Tesseract (zwolnienie zasobów).
- Czytelne błędy **pdf.js**: [`pdf_errors.mjs`](pdf_errors.mjs) (hasło, uszkodzony plik itd.).

### Kalibracja (dev, bez przeglądarki)
- [`tools/calibrate_layout.py`](tools/calibrate_layout.py) + [`calibration/roi_hints.json`](calibration/roi_hints.json) (wymaga `pdftotext` z Popplera).

### UX
- Pasek postępu (per plik), status, log na żywo.
- **Przerwij** batch + **Esc**; po przerwaniu: częściowy Excel (jeśli były wiersze), przeniesienia tylko dla przetworzonych.
- **Pobierz log (.txt)**, **Wyczyść log**; blokada opcji (podfoldery, próg OCR) w trakcie batcha.

### Testy (Node, bez PDF)
- `node tests/protocol_parse_selftest.mjs`
- `node tests/roi_pick_selftest.mjs` (wybór `regions_norm` vs `regions_norm_narrow`)
- `node tests/pdf_errors_selftest.mjs`
- `node tests/excel_export_selftest.mjs`
- `node tests/folder_jobs_selftest.mjs` (ścieżki `webkitRelativePath` / Firefox)

### Dokumentacja operacyjna
- [`README.md`](README.md), [`HOSTING.md`](HOSTING.md).

---

## TODO / dalsza praca

### Wymaga prawdziwych skanów (priorytet)
- [x] **Przykładowe skany** w `dane testowe/` (m.in. wąska strona ~578 pt, wielostronicowe bez tekstu) — pod kątem ROI i wydajności.
- [ ] **Próbki skanów bitowych** (kontrast, skos, zagięcia, dopiski odręczne) — dalsze edge case’y.
- [ ] **Dopasowanie ROI** do skanów (marginesy, ewentualnie deskew / kontrast przed OCR); pierwsza iteracja: `regions_norm` / `regions_norm_narrow` + próg szerokości w pt.
- [ ] **Ostateczna długość** `numer_zlecenia` — POC: `ZLECENIE_LEN_MIN` / `ZLECENIE_LEN_MAX` + `zlecenie_format` w [`protocol_parse.mjs`](protocol_parse.mjs) (do potwierdzenia po próbkach); **`numer_plomby`:** `PLOMBA_LEN_EXCEL` / `PLOMBA_RAW_LEN_*`.
- [x] **Progi confidence per pole (ROI str. 1):** opcjonalne pola w UI + `confidenceMinRoi` w [`protocol_parse.mjs`](protocol_parse.mjs) (`protocolReadoutQuality`); puste pole ROI = próg ogólny z „Próg OCR”.
- [x] **Dopiski odręczne / szum ROI (POC):** heurystyka na surowym OCR wycinków str. 1 (`podejrzenie_odreczne_roi_*`); **nie** wykrywa pisma odręcznego wprost — wymaga weryfikacji człowiekiem (§4).

### Excel / audyt (doprecyzowanie vs §3.2)
- [x] Częściowy sukces plomb (część numerów odrzucona z powodu formatu): wiersze z **poprawnymi** 15 cyframi mają czytelną adnotację (`excelUwagiForSealRow` w [`export_xlsx.mjs`](export_xlsx.mjs)); łączenie z innymi problemami pliku (np. niski OCR) nadal w jednej kolumnie.
- [x] Wiersze Excel dla numerów **12–18 cyfr** z listy, które **nie są** docelowym **15** cyfr: kolumna `numer_plomby` = odczyt, `Uwagi_odczyt` z adnotacją; wiersze z poprawnymi 15 cyframi bez zmian.

### Produkt / techniczne
- [x] **Lokalny serwer offline (minimalnie):** [`tools/serve_local.sh`](tools/serve_local.sh), [`tools/start_local.bat`](tools/start_local.bat) + [`README.md`](README.md) / [`HOSTING.md`](HOSTING.md) (pełna paczka ZIP nadal ręczna).
- [x] **CSP (szablon):** sekcja w [`HOSTING.md`](HOSTING.md) — przykładowa polityka + uwagi o CDN / SRI (pełne SRI przy `import()` z CDN bez buildu — opcjonalnie).
- [x] **Terminacja workera OCR** przy `pagehide` (oszczędność zasobów).

### Spec — otwarte punkty (skrót)
Pełna lista checkboxów: **§8** w [`OCR_protokoly_skan_spec.md`](OCR_protokoly_skan_spec.md). Nadal m.in.: **skany bitowe**, **dopasowanie ROI**, **ostateczne długości zlecenia**; dopiski — **heurystyka POC**, nie pełny detektor odręcznego.

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
| `folder_jobs.mjs` | PDF z wyboru folderu (Firefox / `webkitdirectory`) |
| `calibration/roi_default.json` | Domyślne ROI dla str. 1 |
| `tools/calibrate_layout.py` | Generowanie `roi_hints.json` z PDF z tekstem |

---

*Ostatnia aktualizacja dokumentu: 2026-04-10 — m.in. usunięty filtr nazwy pliku (uproszczenie UI, m.in. Firefox); heurystyka ROI odręczne/szum.*
