#!/usr/bin/env python3
"""
Analiza układu strony 1 protokołu (PDF z warstwą tekstową — np. eksport Word).
Wyjście: calibration/roi_hints.json — wskazówki ROI znormalizowane 0–1 pod przyszłe skany
(OCR na wycinkach zamiast całej strony).

Wymaga w PATH: pdftotext (poppler-utils).
"""
from __future__ import annotations

import csv
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Word:
    left: float
    top: float
    width: float
    height: float
    text: str


def page_size_from_tsv(rows: list[list[str]]) -> tuple[float, float]:
    for row in rows:
        if len(row) >= 10 and row[9] == "###PAGE###":
            return float(row[6]), float(row[7])
    return 595.0, 842.0


def load_words_tsv(pdf_path: Path) -> tuple[list[Word], tuple[float, float]]:
    r = subprocess.run(
        ["pdftotext", "-tsv", "-f", "1", "-l", "1", str(pdf_path), "-"],
        capture_output=True,
        text=True,
        check=True,
    )
    rows = list(csv.reader(r.stdout.splitlines(), delimiter="\t"))
    w_pt, h_pt = page_size_from_tsv(rows)
    words: list[Word] = []
    for row in rows:
        if len(row) < 12:
            continue
        if not row[11] or row[11].startswith("###"):
            continue
        try:
            level = int(row[0])
        except ValueError:
            continue
        if level != 5:
            continue
        words.append(
            Word(
                left=float(row[6]),
                top=float(row[7]),
                width=float(row[8]),
                height=float(row[9]),
                text=row[11],
            )
        )
    return words, (w_pt, h_pt)


def bbox_union(ws: list[Word]) -> tuple[float, float, float, float]:
    if not ws:
        return 0, 0, 0, 0
    left = min(w.left for w in ws)
    top = min(w.top for w in ws)
    right = max(w.left + w.width for w in ws)
    bottom = max(w.top + w.height for w in ws)
    return left, top, right, bottom


def norm_rect(
    left: float, top: float, right: float, bottom: float, pw: float, ph: float, pad: float
) -> dict[str, float]:
    ml = max(0, left - pad * pw)
    mt = max(0, top - pad * ph)
    mr = min(pw, right + pad * pw)
    mb = min(ph, bottom + pad * ph)
    return {
        "left": round(ml / pw, 4),
        "top": round(mt / ph, 4),
        "width": round((mr - ml) / pw, 4),
        "height": round((mb - mt) / ph, 4),
    }


def index_containing(words: list[Word], substr: str) -> int:
    s = substr.lower()
    for i, w in enumerate(words):
        if s in w.text.lower():
            return i
    return -1


def analyze_pdf(pdf_path: Path, pad: float = 0.015) -> dict:
    words, (pw, ph) = load_words_tsv(pdf_path)
    if not words:
        return {"file": pdf_path.name, "error": "brak słów (strona 1 pusta lub skan bez warstwy tekstu)"}

    # --- numer zlecenia: linia ze "Zlecenie" / "nr:" ---
    zlec_words: list[Word] = []
    iz = index_containing(words, "Zlecenie")
    if iz >= 0:
        y0 = words[iz].top
        zlec_words = [w for w in words if abs(w.top - y0) < 3 and w.left >= words[iz].left - 5]
    zlec_box = bbox_union(zlec_words)

    # --- przewoźnik: od "Przewoźnik:" do przed "Miejsce dostawy:" ---
    ip = index_containing(words, "Przewoźnik")
    idost2 = -1
    for i, w in enumerate(words):
        if "dostawy" in w.text.lower():
            idost2 = i
            break
    przew_words: list[Word] = []
    if ip >= 0:
        y_end = words[idost2].top if idost2 >= 0 else ph
        for w in words:
            if w.top >= words[ip].top - 2 and w.top < y_end - 2:
                przew_words.append(w)
    przew_box = bbox_union(przew_words)

    # --- lista plomb: od nagłówka "Lista" / "plomb" do przed "Uwagi" lub koniec strony ---
    ilist = index_containing(words, "Lista")
    iuw = index_containing(words, "Uwagi")
    plomb_words: list[Word] = []
    if ilist >= 0:
        y_start = words[ilist].top - 2
        y_stop = words[iuw].top - 2 if iuw >= 0 else ph
        for w in words:
            if y_start <= w.top < y_stop:
                plomb_words.append(w)
    plomb_box = bbox_union(plomb_words)

    def nbox(box: tuple[float, float, float, float]) -> dict[str, float] | None:
        if box[2] <= box[0] or box[3] <= box[1]:
            return None
        return norm_rect(box[0], box[1], box[2], box[3], pw, ph, pad)

    return {
        "file": pdf_path.name,
        "page_size_pt": {"width": pw, "height": ph},
        "regions_norm": {
            "numer_zlecenia": nbox(zlec_box),
            "przewoznik": nbox(przew_box),
            "lista_plomb": nbox(plomb_box),
        },
    }


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    data_dir = root / "dane testowe"
    out_dir = root / "calibration"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "roi_hints.json"

    pdfs = sorted(data_dir.glob("*.pdf"))
    if not pdfs:
        print(f"Brak PDF w {data_dir}", file=sys.stderr)
        return 1

    meta = {
        "source": "pdftotext -tsv, strona 1",
        "note_pl": (
            "Współrzędne 0–1 względem prostokąta strony (jak w mediabox). "
            "Na skanach rozważyć powiększenie ROI o margines i/lub preprocess (deskew, kontrast). "
            "Gdy PDF nie ma warstwy tekstu, ten plik służy jako szablon z ostatniej kalibracji; "
            "ROI trzeba wtedy ustalić ręcznie lub z szablonu graficznego."
        ),
        "files": [],
    }

    for p in pdfs:
        meta["files"].append(analyze_pdf(p))

    out_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Zapisano {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
