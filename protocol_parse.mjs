/**
 * Parsowanie tekstu protokołu (układ ze szablonu arkusz-mapa / Word).
 * Działa na tekście z warstwy PDF lub na wyniku OCR (z drobnymi odchyleniami).
 */

/** @typedef {{ numer_zlecenia: string, przewoznik: string, plomby: string[], uwagi_parse: string[] }} ProtocolFields */

const RE_ZLECENIE = /Zlecenie\s+transportowe\s+nr\s*:\s*(\d+)/i;
const RE_PRZEWOZ_START = /Przewoźnik\s*:\s*/i;
const RE_MIEJSCE_DOSTAWY = /Miejsce\s+dostawy\s*:/i;
const RE_LISTA_PLOMB = /Lista\s+odebranych\s+plomb\s*:/i;
const RE_UWAGI = /^Uwagi\s*:/im;
/** 15 cyfr jak w próbkach; na produkcji doprecyzować stałą długość */
const RE_PLOMBA_WIERSZ = /^\s*(\d+)\.\s*(\d{12,18})\s*$/;

/** Średnia pewność Tesseract (0–100); poniżej → problematyczne (spec §4). */
export const OCR_CONFIDENCE_MIN = 55;

/**
 * @param {string} raw
 * @returns {ProtocolFields}
 */
export function parseProtocolText(raw) {
  const uwagi = [];
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const z = normalized.match(RE_ZLECENIE);
  const numer_zlecenia = z ? z[1].trim() : "";

  let przewoznik = "";
  const pm = RE_PRZEWOZ_START.exec(normalized);
  if (pm) {
    const start = pm.index + pm[0].length;
    const rest = normalized.slice(start);
    const md = RE_MIEJSCE_DOSTAWY.exec(rest);
    const block = md ? rest.slice(0, md.index) : rest.split(/\n{2,}/)[0];
    przewoznik = block
      .replace(/\s+/g, " ")
      .replace(/(\d)-\s+(\d)/g, "$1-$2")
      .trim();
  }

  const plomby = [];
  const li = normalized.search(RE_LISTA_PLOMB);
  if (li !== -1) {
    let tail = normalized.slice(li);
    const u = tail.search(RE_UWAGI);
    if (u !== -1) tail = tail.slice(0, u);
    const lines = tail.split("\n");
    for (const line of lines) {
      const m = line.match(RE_PLOMBA_WIERSZ);
      if (m) plomby.push(m[2]);
    }
  }

  if (!numer_zlecenia) uwagi.push("brak_numeru_zlecenia");
  if (!przewoznik) uwagi.push("brak_przewoznika");
  if (plomby.length === 0) uwagi.push("brak_plomb");

  return {
    numer_zlecenia,
    przewoznik,
    plomby,
    uwagi_parse: uwagi,
  };
}

/**
 * @param {string} numer
 * @returns {boolean}
 */
export function isPlombaFormatSample(numer) {
  return /^\d{15}$/.test(numer);
}

/**
 * Poprawność pól (bez progu confidence OCR) — używane przy wyborze ROI vs pełna strona.
 * @param {ProtocolFields} parsed
 */
export function protocolStructuralOk(parsed) {
  if (!parsed.numer_zlecenia?.trim()) return false;
  if (!parsed.przewoznik?.trim()) return false;
  if (parsed.plomby.length === 0) return false;
  return parsed.plomby.every(isPlombaFormatSample);
}

/**
 * Kwalifikacja do folderu done / problematyczne i treść kolumny Uwagi_odczyt (spec §3–4).
 * @param {ProtocolFields} parsed
 * @param {{ ocrMinConfidence?: number | null, confidenceMin?: number }} [meta]
 */
export function protocolReadoutQuality(parsed, meta = {}) {
  const issues = [];
  if (!parsed.numer_zlecenia?.trim()) issues.push("brak_numeru_zlecenia");
  if (!parsed.przewoznik?.trim()) issues.push("brak_przewoznika");
  if (parsed.plomby.length === 0) issues.push("brak_plomb");
  const badPlomby = parsed.plomby.filter((p) => !isPlombaFormatSample(p));
  if (badPlomby.length) issues.push("plomba_format");
  const oc = meta.ocrMinConfidence;
  const threshold =
    typeof meta.confidenceMin === "number" && Number.isFinite(meta.confidenceMin)
      ? meta.confidenceMin
      : OCR_CONFIDENCE_MIN;
  if (oc != null && Number.isFinite(oc) && oc < threshold) {
    issues.push(`niski_confidence_ocr(${Math.round(oc)})`);
  }
  const ok = issues.length === 0;
  return {
    ok,
    destSubfolder: ok ? "done" : "problematyczne",
    uwagi_excel: ok ? "ok" : issues.join("; "),
  };
}

/**
 * @param {ProtocolFields} a
 * @param {ProtocolFields} b
 * @returns {"a" | "b"}
 */
export function pickBetterParsedKey(a, b) {
  const sa = protocolStructuralOk(a);
  const sb = protocolStructuralOk(b);
  if (sa && !sb) return "a";
  if (!sa && sb) return "b";
  const score = (p) =>
    (p.numer_zlecenia ? 4 : 0) +
    (p.przewoznik ? 4 : 0) +
    p.plomby.filter(isPlombaFormatSample).length * 2;
  return score(a) >= score(b) ? "a" : "b";
}
