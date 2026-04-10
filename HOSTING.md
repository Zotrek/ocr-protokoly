# Hosting statyczny — OCR_protokoly (`index.html`)

Aplikacja musi być serwowana przez **HTTPS** (albo `http://127.0.0.1` przy dev). Poniżej: **Cloudflare Pages** (zalecane) oraz **GitHub Pages**. Obie wersje są **darmowe** przy małym ruchu.

---

## Wariant A — Cloudflare Pages (bez Git, szybki start)

1. Załóż konto na [https://dash.cloudflare.com/](https://dash.cloudflare.com/) (darmowe).
2. W menu: **Workers & Pages** → **Create** → zakładka **Pages** → **Upload assets**.
3. Nazwa projektu (np. `ocr-protokoly`) → **Create project**.
4. Spakuj **cały** katalog aplikacji do ZIP: `index.html`, `app.mjs`, `protocol_parse.mjs`, `roi_ocr.mjs`, `export_xlsx.mjs`, `pdf_errors.mjs`, `folder_jobs.mjs`, folder `calibration/` (np. `roi_default.json`). W **katalogu głównym** archiwum musi być `index.html` jako strona główna.
5. Przeciągnij ZIP → **Deploy site**.
6. Po chwili dostaniesz adres `https://<nazwa>.pages.dev` — tego linku używa klient (w **Chrome / Edge** pełny zapis w folderze; w **Firefox** — pobieranie Excela).

**Aktualizacja:** ponownie **Upload** nowego ZIP (lub podłączenie **Git** w tym samym projekcie — wtedy deploy z pusha).

**Uwaga:** Pierwsze wejście na stronę pobierze z CDN modele językowe Tesseract (polski) — może potrwać; kolejne wizyty korzystają z cache przeglądarki.

---

## Wariant B — Cloudflare Pages z repozytorium Git

1. Repozytorium Git (GitHub/GitLab) z `OCR_protokoly/index.html` w root **albo** z `index.html` w podfolderze (wtedy w ustawieniach Pages ustaw **Root directory** na ten folder).
2. Cloudflare → **Workers & Pages** → **Create** → **Connect to Git** → wybór repo.
3. **Framework preset:** None / Static.
4. **Build command:** puste (brak buildu).
5. **Build output directory:** `/` lub katalog, w którym leży `index.html`.
6. **Save and Deploy**.

---

## Wariant C — GitHub Pages

1. Repozytorium na GitHub z `index.html` w gałęzi (np. `main`), w katalogu który Pages ma serwować.
2. **Settings** → **Pages** → **Source:** Deploy from a branch → Branch `main`, folder `/ (root)` lub `/docs`.
3. Po kilku minutach adres: `https://<user>.github.io/<repo>/` (dokładny URL GitHub poda w ustawieniach Pages).

**Limit:** rozmiar repo / pojedynczych plików — przy samym HTML z CDN zwykle bez problemu.

---

## Sprawdzenie lokalne (przed wdrożeniem)

Z katalogu `OCR_protokoly`:

```bash
python3 -m http.server 8765
```

Skrypt z katalogu projektu: `./tools/serve_local.sh` (Linux/macOS) lub `tools\start_local.bat` (Windows) — to samo co powyżej.

W przeglądarce: `http://127.0.0.1:8765` — **nie** otwieraj `index.html` przez `file://`. **Firefox:** ta sama strona; przy braku File System Access aplikacja sama przełączy się na pobieranie Excela (bez zapisu do wybranego folderu).

---

## Checklista dla klienta (Chrome / Edge / Firefox, Windows 11)

- [ ] Wejście na **HTTPS** (link `*.pages.dev`, `github.io` lub własna domena).
- [ ] **Wybór folderu** z PDF — w **bezpiecznym kontekście** (HTTPS / localhost). W Firefoxie: ten sam wybór katalogu, ale zapis wyniku jako **pobranie** pliku.
- [ ] Przy pierwszym uruchomieniu możliwy długi czas ładowania (model OCR z sieci).

---

## Opcjonalnie: Content-Security-Policy (CSP)

Jeśli hosting lub polityka firmy wymaga nagłówka **CSP**, poniżej **punkt wyjścia** (dostosuj do swojej domeny i audytu). Aplikacja ma **style inline** w `index.html` — bez wydzielenia CSS do osobnego pliku potrzebne jest `'unsafe-inline'` dla stylów (albo hash/nonce — wtedy zmiana HTML).

Przykład (nagłówek odpowiedzi HTTP; **nie** kopiuj ślepo na produkcję bez testów):

```http
Content-Security-Policy: default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' https://cdn.jsdelivr.net https://cdn.sheetjs.com 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' https://cdn.jsdelivr.net https://cdn.sheetjs.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:;
```

**Uwagi:** Tesseract.js i pdf.js ładują skrypty / WASM z **jsDelivr**; SheetJS — z **cdn.sheetjs.com** (zgodnie z `export_xlsx.mjs`). **Subresource Integrity (SRI)** na dynamicznych importach `import("https://…")` bywa utrudnione — często CSP + **szpilowanie wersji** URL-i w kodzie wystarcza zespołowi bezpieczeństwa; pełne SRI wymaga bundlera lub ręcznych hashy przy każdej aktualizacji CDN.

---

## Co dalej (wspólnie można przejść krok po kroku)

1. Wybór wariantu (A / B / C).
2. Pierwszy deploy i test linku (Chrome / Edge — pełny tryb; Firefox — tryb z pobraniem Excela).
3. (Opcjonalnie) własna domena w Cloudflare / GitHub.
4. Dopiero potem rozbudowa o Excel, `done` / `problematyczne` (File System Access — zapis).

Jeśli napiszesz, który wariant wybierasz (np. „Pages upload ZIP”), można rozwinąć tylko ten scenariusz z ewentualnymi zrzutami / komunikatami błędów.
