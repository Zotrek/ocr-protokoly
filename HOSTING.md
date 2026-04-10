# Hosting statyczny — OCR_protokoly (`index.html`)

Aplikacja musi być serwowana przez **HTTPS** (albo `http://127.0.0.1` przy dev). Poniżej: **Cloudflare Pages** (zalecane) oraz **GitHub Pages**. Obie wersje są **darmowe** przy małym ruchu.

---

## Wariant A — Cloudflare Pages (bez Git, szybki start)

1. Załóż konto na [https://dash.cloudflare.com/](https://dash.cloudflare.com/) (darmowe).
2. W menu: **Workers & Pages** → **Create** → zakładka **Pages** → **Upload assets**.
3. Nazwa projektu (np. `ocr-protokoly`) → **Create project**.
4. Spakuj **cały** katalog aplikacji do ZIP: `index.html`, `app.mjs`, `protocol_parse.mjs`, `roi_ocr.mjs`, `export_xlsx.mjs`, `pdf_errors.mjs`, folder `calibration/` (np. `roi_default.json`). W **katalogu głównym** archiwum musi być `index.html` jako strona główna.
5. Przeciągnij ZIP → **Deploy site**.
6. Po chwili dostaniesz adres `https://<nazwa>.pages.dev` — tego linku używa klient w **Chrome**.

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

W Chrome: `http://127.0.0.1:8765` — **nie** otwieraj `index.html` przez `file://`.

---

## Checklista dla klienta (Chrome, Windows 11)

- [ ] Wejście na **HTTPS** (link `*.pages.dev`, `github.io` lub własna domena).
- [ ] **Wybór folderu** z PDF — działa tylko w **bezpiecznym kontekście** (HTTPS / localhost).
- [ ] Przy pierwszym uruchomieniu możliwy długi czas ładowania (model OCR z sieci).

---

## Co dalej (wspólnie można przejść krok po kroku)

1. Wybór wariantu (A / B / C).
2. Pierwszy deploy i test linku w Chrome.
3. (Opcjonalnie) własna domena w Cloudflare / GitHub.
4. Dopiero potem rozbudowa o Excel, `done` / `problematyczne` (File System Access — zapis).

Jeśli napiszesz, który wariant wybierasz (np. „Pages upload ZIP”), można rozwinąć tylko ten scenariusz z ewentualnymi zrzutami / komunikatami błędów.
