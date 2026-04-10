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
- **Warstwa tekstowa PDF** (eksport Word): odczyt bez OCR, jeśli heurystyka uzna tekst za pełny protokół (`nativeTextLooksLikeProtocol` — wzorce `RE_ZLECENIE`, `RE_PRZEWOZ_START`, `RE_LISTA_PLOMB`).
- **Skany / brak tekstu na str. 1**: OCR strony 1 przez **ROI** (`calibration/roi_default.json` + [`roi_ocr.mjs`](roi_ocr.mjs)), przy słabej strukturze — drugi przebieg **cała strona 1**; przed OCR — **adaptacyjny kontrast** (`enhanceCanvasForOcr` w [`roi_ocr.mjs`](roi_ocr.mjs)) dobierany na podstawie odchylenia std. jasności (1.7× dla wyblakłych 150 DPI, 1.22× dla ostrych CCF 300 DPI).
- **Tryb segmentacji Tesseract (PSM)** per region ROI: PSM 6 (jednorodny blok) dla numeru zlecenia i przewoźnika; PSM AUTO dla listy plomb (obsługuje jedno- i dwukolumnowy układ). Skala renderowania ROI: **3×** (~216 DPI na wąskich skanach A4 vs 144 DPI przy 2×).
- **Strony 2+** przy skanie (brak warstwy tekstowej): **OCR pełnej strony** dla każdej takiej strony (teksty łączone `\n\n` → parser). Str. 1 nadal **ROI** (+ ewentualnie pełna str. 1). Gdy strona ma **warstwę tekstową**, używany jest on zamiast OCR.
- **Wiele protokołów w jednym PDF:** `parseProtocolText` dzieli po nagłówku `Zlecenie transportowe nr:` i zwraca **`segments`** — Excel: osobne wiersze z **numerem zlecenia / przewoźnikiem** per segment.
- **Lista w dwóch kolumnach** (wiele `1. … 2. …` w jednym wierszu): wyciąganie plomb po **pozycjach `k.`** z zatrzymaniem przed następnym `k.` (funkcja `plombyFromListLine` w [`protocol_parse.mjs`](protocol_parse.mjs)).
- **ROI wąska vs A4**: w `roi_default.json` jest **`narrow_page_width_pt_max: 585`** pt: strona węższa niż próg (np. CCF ~578 pt) używa **`regions_norm_narrow`**, szersza — **`regions_norm`**.
- **Str. 2+:** jeśli warstwa PDF jest **niepusta**, ale **bez** nagłówka listy plomb (`RE_LISTA_PLOMB`) — **wymuszany OCR** pełnej strony.
- **Pewność Tesseract**: per region ROI → `niski_confidence_ocr_roi_*`; pełna strona / str. 2+ → `niski_confidence_ocr(min)`. Próg ogólny z pola „Próg OCR" (zapisywany w `localStorage`).
- **Podejrzenie dopisku / szumu OCR (POC):** heurystyka `roiOcrTextSuggestsHandwritingNoise` → token `podejrzenie_odreczne_roi_*` → `problematyczne`.
- **Zamknięcie karty**: `pagehide` → `terminate()` workera Tesseract.
- Czytelne błędy **pdf.js**: [`pdf_errors.mjs`](pdf_errors.mjs) (hasło, uszkodzony plik itd.).

### Parser — wzorce dopasowane do rzeczywistych skanów CCF (kwiecień 2026)
- **`RE_ZLECENIE`**: przechwytuje format `NNNN/YYYY` (np. `1460/2026`) oraz same cyfry; OCR-owe spacje wewnątrz numeru usuwane.
- **`RE_LISTA_PLOMB`**: obsługuje `„Lista obsługiwanych plomb:"` (CCF), `„Lista odebranych plomb:"` i warianty z błędami OCR.
- **`RE_PRZEWOZ_START`**: tolerancja na OCR-owe spacje i brak polskich znaków (`Przewoznik`, `Przew oznik`).
- `isZlecenieFormatSample`: akceptuje `NNNN/YYYY` lub same cyfry.

### Kalibracja ROI (na podstawie skanów CCF 300 DPI — 2409×3437 px)
- `regions_norm` / `regions_norm_narrow`: skalibrowane na podstawie rzeczywistych pomiarów:
  - `numer_zlecenia`: `top=3%`, `height=4%` (linia „Zlecenie transportowe nr:" na ~3.6%)
  - `przewoznik`: `top=6.5%`, `height=5.5%` (linia „Przewoźnik:" na ~8.3%) — poprzednie wartości (11.5%) całkowicie mijały się z polem
  - `lista_plomb`: `top=44%`, `width=63%` — pokrywa obie kolumny list (dwukolumnowy układ na dużych partiach)

### Kalibracja (dev, bez przeglądarki)
- [`tools/calibrate_layout.py`](tools/calibrate_layout.py) — `argparse` z `--dir`, `--output`, pozycyjnymi `PDF`; obsługa `Przewoznik` bez ogonka.

### UX
- Pasek postępu + **nazwa bieżącego pliku** w statusie podczas przetwarzania.
- **Przerwij** batch + **Esc**; po przerwaniu: częściowy Excel (jeśli były wiersze).
- **Podsumowanie wyników** po batchu: liczniki Done / Problematyczne / Błędy OCR / Błędy przenoszenia (chipy kolorowe).
- **Baner folderu** z nazwą i liczbą PDF-ów; `localStorage` dla progu OCR i checkboxa „szukaj w podfolderach".
- **Czytelne polskie etykiety** dla wszystkich tokenów `Uwagi_odczyt` (brak plomb, niski confidence, format zlecenia, itp.).

### Testy (Node, bez PDF)
- `node tests/protocol_parse_selftest.mjs` — m.in. format `1460/2026`, `Lista obsługiwanych plomb:`
- `node tests/roi_pick_selftest.mjs`
- `node tests/pdf_errors_selftest.mjs`
- `node tests/excel_export_selftest.mjs`
- `node tests/folder_jobs_selftest.mjs`
- `bash tools/run_selftests.sh` — wszystkie 5 testów

### Dokumentacja operacyjna
- [`README.md`](README.md), [`HOSTING.md`](HOSTING.md).

---

## TODO / dalsza praca

### Wymaga dalszych próbek i testów na żywych danych
- [ ] **Weryfikacja ROI** na większym zbiorze skanów — ewentualne drobne korekty `top` / `height` per dokument.
- [ ] **Deskew** (prostowanie przekrzywionych skanów) — nie wykryto w próbkach CCF, ale może wystąpić.
- [ ] **Dokumenty bez listy plomb** (`Łączna ilość odebranych worków`) — obecne zachowanie: `brak_plomb` → `problematyczne`. Rozważyć dedykowany komunikat.
- [ ] **Ostateczna długość `numer_zlecenia`** — potwierdzono format `NNNN/YYYY` na próbkach; może wystąpić inny zakres.

### Spec — otwarte punkty
Pełna lista checkboxów: **§8** w [`OCR_protokoly_skan_spec.md`](OCR_protokoly_skan_spec.md).

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
| `calibration/roi_default.json` | Domyślne ROI dla str. 1 (skalibrowane na CCF 300 DPI) |
| `tools/calibrate_layout.py` | Generowanie `roi_hints.json` z PDF z tekstem |

---

*Ostatnia aktualizacja: 2026-04-11 — kalibracja ROI na skanach CCF (format `NNNN/YYYY`, `Lista obsługiwanych plomb:`); adaptacyjny kontrast; PSM per region; skala 3×; czytelne etykiety Uwagi_odczyt; argparse w calibrate_layout.py.*
