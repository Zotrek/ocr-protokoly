# Specyfikacja: odczyt skanów protokołów (OCR) → Excel + sortowanie plików

**Projekt:** `OCR_protokoly` (osobny od `arkusz-mapa`).  
**Status:** szkic do dopracowania po dostarczeniu przykładowych skanów  
**Powiązanie:** protokoły generowane ze szablonu w projekcie **arkusz-mapa** — opis znaczników: [`../arkusz-mapa/docs/SZABLON_WORD_tagi.txt`](../arkusz-mapa/docs/SZABLON_WORD_tagi.txt) (szablon Word `pusty.docx`: m.in. `{{przewoznik}}`, `{{lista_plomb}}` itd.).  
**Skala:** kilkadziesiąt plików PDF dziennie.

---

## 1. Cel

Aplikacja uruchamiana przez klienta w **Google Chrome (Windows 11)**:

1. Klient wskazuje **folder roboczy** zawierający skany PDF uzupełnionych i podpisanych protokołów.
2. Dla każdego pliku PDF (kolejno, jeden po drugim) wykonywany jest **OCR** (stały layout strony).
3. Wyciągane są pola: **numer zlecenia**, **numery plomb (PLB)** — każda plomba **osobny wiersz** w Excelu, **nazwa przewoźnika** (transportującego).
4. Wynik zapisywany jest do pliku Excel (.xlsx) wg **§3.3** (nazwa, lokalizacja, wielokrotne uruchomienia tego samego dnia).
5. Pliki PDF po przetworzeniu trafiają do:
   - **`done`** — gdy odczyt uznany za w pełni poprawny (bez problemów wg reguł poniżej);
   - **`problematyczne`** — gdy wystąpiły problemy z odczytem (niska pewność, brak zgodności z formatem, podejrzenie dopisków odręcznych w obszarze pola itp.).

Szczegóły technologiczne (hosting vs. paczka lokalna) — sekcja 6.

---

## 2. Założenia wejściowe

| # | Założenie | Uwagi |
|---|-----------|--------|
| 1 | **Skany PDF** (nie wektorowy tekst z Worda) | Wymagany pipeline OCR + ewentualnie preprocess obrazu strony. |
| 2 | **Stały layout** strony | Możliwe wycięcie ROI (regionów) pod zlecenie, listę plomb, przewoźnika. |
| 3 | **Format numerów** | Zlecenie i plomby: **stała długość**, **tylko cyfry** — dokładne długości i ewentualne prefiksy **do uzupełnienia** po próbkach rzeczywistych skanów. |
| 4 | **Przykładowe pliki** | Folder `dane testowe/`: PDF z warstwą tekstową (eksport Word) — ten sam układ co na skanach; kalibracja ROI: `tools/calibrate_layout.py` → `calibration/roi_hints.json`. Skany bitowe — do dalszej kalibracji progów OCR. |

---

## 3. Model danych w Excelu (długi format)

Jeden arkusz roboczy z ustalonymi kolumnami (§3.1). **Plik wynikowy jest wspólny dla całego dnia kalendarzowego** użytkownika — patrz §3.3.

### 3.1. Kolumny

| Kolumna | Opis |
|---------|------|
| `nazwa_pliku` | Nazwa pliku źródłowego PDF (np. `Janex 12.03.25 Adres.pdf`). |
| `numer_zlecenia` | Powtórzony w **każdym** wierszu należącym do tego samego PDF. |
| `przewoznik` | Powtórzony w **każdym** wierszu dla danego PDF. |
| `numer_plomby` | Pojedynczy numer plomby (jeden wiersz = jedna plomba). |
| `Uwagi_odczyt` | Zob. sekcja 3.2. |

Kolejność kolumn może być ustalona przy implementacji; powyższa lista jest **wymaganiem merytorycznym**.

### 3.2. Kolumna `Uwagi_odczyt`

- Gdy **cały plik PDF** kwalifikuje się do **`done`** (brak problemów wg sekcji 4): we **wszystkich** wierszach Excela należących do tego pliku wpisać literalnie **`ok`**.
- Gdy są problemy: **zapisać to, co udało się odczytać** w polach `numer_zlecenia`, `przewoznik`, `numer_plomby`, a w `Uwagi_odczyt` opisać:
  - które pole jest **podejrzane** lub puste mimo oczekiwania;
  - przyczyny typu: **niski confidence** OCR, **brak zgodności z regexem** (zlecenie / plomba), **obszar objęty dopiskiem odręcznym** (heurystyka / flaga z silnika — do dopracowania po przykładach).

**Zasada uzgodniona:** wiersz (lub cały plik) wymagający weryfikacji człowieka → plik PDF do folderu **`problematyczne`**, nawet jeśli część pól jest poprawna.

**Doprecyzowanie do implementacji:** czy przy częściowym sukcesie (np. 3 plomby OK, 1 niepewna) jeden wiersz ma `Uwagi_odczyt` z adnotacją tylko przy problematycznej plombie, a plik i tak idzie do `problematyczne` — **tak**, spójnie z audytem: folder `problematyczne` + adnotacje w wierszach dotkniętych problemem.

### 3.3. Nazwa pliku Excel, lokalizacja, drugie uruchomienie tego samego dnia

- **Wzorzec nazwy:** `wynik_YYYY-MM-DD.xlsx`  
  Przykład: `wynik_2026-04-10.xlsx`.  
  Data **YYYY-MM-DD** = **lokalna data kalendarzowa** u klienta (strefa czasowa przeglądarki) w momencie **rozpoczęcia** danego uruchomienia batcha (lub ustalonego punktu startu przetwarzania — do jednej linii w kodzie).
- **Lokalizacja:** **wybrany folder roboczy** (ten sam, w którym są / były PDF-y do obróbki), chyba że później uzgodnimy osobny podfolder (np. `wynik`).
- **Pierwsze uruchomienie danego dnia:** jeśli pliku `wynik_YYYY-MM-DD.xlsx` **nie ma** — tworzymy **nowy** plik z wierszami z bieżącego batcha.
- **Kolejne uruchomienie tego samego dnia**, gdy plik **już istnieje** w wybranym folderze:
  1. **Wczytać** istniejący skoroszyt (dotychczasowe wiersze).
  2. **Dopisać** na końcu tabeli wiersze z **bieżącego** uruchomienia (nowe PDF-y z tej sesji).
  3. **Usunąć** stary plik z dysku.
  4. **Zapisać** nowy plik o **tej samej nazwie** `wynik_YYYY-MM-DD.xlsx` zawierający **połączoną** treść (stare + nowe wiersze).

Cel kroku 3–4: jedna spójna nazwa dziennie i atomowa zamiana pliku (bez pozostawiania dwóch wersji). Przy błędzie odczytu istniejącego pliku (uszkodzony .xlsx) — **komunikat błędu** i **przerwanie zapisu** lub reguła awaryjna do ustalenia przy implementacji.

---

## 4. Logika kwalifikacji pliku: `done` vs `problematyczne`

Plik trafia do **`problematyczne`**, gdy wystąpi **którykolwiek** z warunków (lista robocza, do ostrego doprecyzowania po skanach):

- brak lub pusty `numer_zlecenia` po OCR + walidacji;
- brak co najmniej jednej oczekiwanej plomby lub **jakakolwiek** plomba nie przechodzi regexu / ma niski próg confidence;
- `przewoznik` pusty lub bardzo niski confidence;
- wykrycie **dopisku odręcznego** w ROI pola (jeśli silnik / heurystyka to sygnalizuje) — **traktować jako wymóg weryfikacji** → `problematyczne`;
- inne ustalone progi jakościowe po testach na próbkach.

Plik trafia do **`done`** tylko wtedy, gdy **wszystkie** pola krytyczne spełniają walidację i progi confidence **oraz** brak flag „podejrzany odręczny” w obszarach pól.

---

## 5. UX: progress

1. **Krok startowy:** po wybraniu folderu — **policzenie plików PDF** (np. tylko `*.pdf`, ewentualnie filtr nazwy — do ustalenia).
2. Wyświetlenie **liczby plików** do obróbki (np. „Znaleziono N plików PDF”).
3. W trakcie przetwarzania: **pasek postępu** (np. `przetworzono k z N`) aktualizowany **po zakończeniu obróbki każdego pliku** (nie tylko na końcu całego batcha).
4. Opcjonalnie (później): możliwość przerwania; log błędów przy uszkodzonym PDF — do rozszerzenia specyfikacji.

---

## 6. Technologia i uruchomienie: czy bez plików `.bat`?

### 6.1. Same przeglądarka — tak, **bez `.bat`**, jeśli aplikacja jest **dostarczona przez HTTPS**

- Klient otwiera **adres URL** (np. hosting statyczny: Cloudflare Pages, GitHub Pages itd.).
- Strona to **HTML + JS + WebAssembly** (OCR w przeglądarce); **przetwarzanie odbywa się lokalnie** na komputerze klienta — pliki PDF **nie muszą** być wysyłane na serwer (dopóki tak zaprojektujesz produkt).
- **File System Access API** w Chrome (folder z PDF, zapis Excela, przenoszenie do `done` / `problematyczne`) wymaga **bezpiecznego kontekstu** — **`https://`** lub `http://localhost` — **nie** typowego otwarcia pojedynczego pliku jako `file://`.
- W tym modelu **nie trzeba** `start.bat` ani lokalnego serwera po stronie klienta.

### 6.2. Kiedy `.bat` + mały serwer lokalny ma sens

- Gdy **nie chcesz** publicznego hosta (np. polityka firmy: tylko paczka ZIP).
- Wtedy lokalny `http://127.0.0.1` uruchamiany z paczki (`.bat` + lekki serwer statyków) nadal jest praktycznym obejściem ograniczeń `file://`.

### 6.3. Podsumowanie decyzji produktowej

| Sposób dostarczenia | `.bat` | Chrome + folder + Excel + podfoldery |
|---------------------|--------|--------------------------------------|
| Hosting **HTTPS** (statyczna aplikacja) | **Nie** | **Tak** (przy założeniu wsparcia FSA i implementacji) |
| Tylko ZIP, bez internetu / bez hosta | Zwykle **tak** (lub inny launcher localhost) | **Tak**, po uruchomieniu lokalnego serwera |

**Rekomendacja:** jeśli priorytetem jest **brak jakichkolwiek plików uruchamiających po stronie klienta**, wybrać **wdrożenie na HTTPS** i traktować aplikację jako SPA/WASM hostowane statycznie.

---

## 7. Implementacja — faza początkowa (uzgodniona)

- **Jeden plik wejściowy aplikacji:** `index.html` (logika w module `<script type="module">`, style inline; zależności z **CDN** — bez `npm` po stronie klienta).
- **Kolejka:** pliki PDF przetwarzane **sekwencyjnie** (jeden po drugim), bez równoległego OCR wielu dokumentów.
- **Jeden worker OCR:** pojedyncza instancja Tesseract.js (`createWorker`), ponowne użycie dla całej kolejki w danym uruchomieniu — mniejsze szczytowe zużycie CPU/RAM niż wiele workerów.
- **Dalsze etapy** (Excel, `done` / `problematyczne`, ROI, walidacja regexów) — po próbkach skanów; patrz sekcja 8.

**Hosting:** krok po kroku — [`HOSTING.md`](HOSTING.md).

---

## 8. Otwarte punkty (przed implementacją)

- [x] Przykładowe PDF w `dane testowe/` (layout jak produkcyjny dokument; bez warstwy tekstowej w docelowych skanach).
- [ ] Przykładowe skany bitowe (kilka reprezentatywnych + edge cases: niski kontrast, skos, dopiski odręczne).
- [ ] Dokładna **długość** (i ewentualnie prefiks) dla `numer_zlecenia` i `numer_plomby` (regexy).
- [ ] Definicja ROI na stronie (współrzędne lub proporcje względem strony A4) — po próbkach.
- [ ] Progi **confidence** (globalne vs. per pole).
- [x] Nazwa i lokalizacja pliku Excel — **§3.3** (`wynik_YYYY-MM-DD.xlsx`, folder roboczy; drugie uruchomienie: dopisanie wierszy, usunięcie starego pliku, zapis nowego).
- [ ] Czy tworzyć `done` / `problematyczne` automatycznie, jeśli nie istnieją (zakładamy **tak**).
- [ ] Zachowanie przy **duplikatach** nazw plików w podfolderach.

---

## 9. Historia zmian dokumentu

| Data | Zmiana |
|------|--------|
| 2026-04-10 | Pierwsza wersja specyfikacji po uzgodnieniach (Excel: powtórzenia zlecenie/przewoźnik, `Uwagi_odczyt` z `ok`, `nazwa_pliku`, progress, done/problematyczne, skany + stały layout + cyfry). |
| 2026-04-10 | Przeniesienie do osobnego folderu projektu `OCR_protokoly/`; link do `arkusz-mapa/docs/SZABLON_WORD_tagi.txt`. |
| 2026-04-10 | Sekcja 7: faza początkowa — jeden `index.html`, kolejka, jeden worker OCR; link do `HOSTING.md`. |
| 2026-04-10 | §3.3: nazwa `wynik_YYYY-MM-DD.xlsx`, dopisywanie przy kolejnym uruchomieniu tego samego dnia (po wczytaniu: usunięcie starego pliku, zapis nowego z pełną treścią). |
