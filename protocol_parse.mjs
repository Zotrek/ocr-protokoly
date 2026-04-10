/**
 * Parsowanie tekstu protokołu (układ ze szablonu arkusz-mapa / Word).
 * Działa na tekście z warstwy PDF lub na wyniku OCR (z drobnymi odchyleniami).
 */

/**
 * @typedef {{
 *   numer_zlecenia: string,
 *   przewoznik: string,
 *   plomby: string[],
 *   uwagi_parse: string[],
 *   segments?: { numer_zlecenia: string, przewoznik: string, plomby: string[] }[],
 * }} ProtocolFields
 */
/** @typedef {{ numer_zlecenia: number, przewoznik: number, lista_plomb: number }} RoiOcrConfidences */

/** Docelowa liczba cyfr numeru zlecenia (POC — do skorygowania po próbkach). */
export const ZLECENIE_LEN_MIN = 1;
export const ZLECENIE_LEN_MAX = 12;
const RE_ZLECENIE_DIGITS = new RegExp(`^\\d{${ZLECENIE_LEN_MIN},${ZLECENIE_LEN_MAX}}$`);

const RE_ZLECENIE = /Zlecenie\s+transportowe\s+nr\s*:\s*(\d+)/i;
/** OCR często bez „ó” / „ź” */
const RE_PRZEWOZ_START = /(?:Przewoznik|Przewoźnik)\s*:\s*/i;
const RE_MIEJSCE_DOSTAWY = /Miejsce\s+dostawy\s*:/i;
/**
 * Nagłówek listy plomb (parser, `nativeTextHasListaPlomb`, ROI stitch) —
 * tolerancja na „plomby”, błędne końcówki oraz typowe pomyłki OCR („o debranych”, „oderbranych”).
 */
export const RE_LISTA_PLOMB =
  /(?:Lista\s+o\s*debranych|Lista\s+oderbranych|Lista\s+odebranych)\s+plom[a-z]*\s*:/i;
const RE_UWAGI = /^Uwagi\s*:/im;

/**
 * @param {string} s
 * @returns {boolean}
 */
export function isZlecenieFormatSample(s) {
  const t = typeof s === "string" ? s.trim() : "";
  if (!t) return false;
  return RE_ZLECENIE_DIGITS.test(t);
}

/**
 * Wiele pozycji „k. cyfry” w jednej linii (np. dwie kolumny); zatrzymanie przed następnym „k.”.
 * @param {string} line
 * @returns {string[]}
 */
function plombyFromListLine(line) {
  const out = [];
  const seen = new Set();
  let i = 0;
  while (i < line.length) {
    const sub = line.slice(i);
    const m = sub.match(/^(\s*)(\d+)\.\s*/);
    if (!m) {
      i++;
      continue;
    }
    i += m[0].length;
    let j = i;
    let buf = "";
    while (j < line.length) {
      const rest = line.slice(j);
      if (/^\s+\d+\.\s/.test(rest) && buf.replace(/\s/g, "").length >= 12) break;
      const c = line[j];
      if (c === " " || c === "\t") {
        buf += c;
        j++;
        continue;
      }
      if (/\d/.test(c)) {
        buf += c;
        j++;
        continue;
      }
      break;
    }
    const digits = buf.replace(/\s+/g, "");
    if (RE_PLOMBA_RAW_DIGITS.test(digits) && !seen.has(digits)) {
      seen.add(digits);
      out.push(digits);
    }
    i = j;
  }
  return out;
}

/** Średnia pewność Tesseract (0–100); poniżej → problematyczne (spec §4). */
export const OCR_CONFIDENCE_MIN = 55;

/** Docelowy format numeru plomby w Excelu (Word / arkusz-mapa). */
export const PLOMBA_LEN_EXCEL = 15;
/** Zakres długości surowego numeru z listy (OCR) przed walidacją docelową. */
export const PLOMBA_RAW_LEN_MIN = 12;
export const PLOMBA_RAW_LEN_MAX = 18;

const RE_PLOMBA_RAW_DIGITS = new RegExp(`^\\d{${PLOMBA_RAW_LEN_MIN},${PLOMBA_RAW_LEN_MAX}}$`);
const RE_PLOMBA_EXCEL_DIGITS = new RegExp(`^\\d{${PLOMBA_LEN_EXCEL}}$`);

/**
 * Czy warstwa tekstowa PDF wygląda na pełny protokół (unikamy zbędnego OCR str. 1).
 * Uwzględnia „Przewoznik” bez polskich znaków — częsty eksport PDF.
 * @param {string} s
 */
export function nativeTextLooksLikeProtocol(s) {
  const t = s.toLowerCase();
  const hasCarrier = t.includes("przewoznik") || t.includes("przewoźnik");
  return (
    s.trim().length > 120 &&
    t.includes("zlecenie") &&
    t.includes("transportowe") &&
    hasCarrier &&
    t.includes("lista") &&
    t.includes("plomb")
  );
}

/**
 * Czy warstwa tekstowa strony zawiera nagłówek listy plomb (wg tego samego wzorca co parser).
 * Używane przy decyzji OCR str. 2+ gdy skaner dopisuje bezużyteczny tekst zamiast treści z obrazu.
 * @param {string} s
 */
export function nativeTextHasListaPlomb(s) {
  return RE_LISTA_PLOMB.test(s);
}

/**
 * Wyciąga numery plomb z jednego lub wielu bloków „Lista odebranych…” (wielokolumnowe wiersze).
 * @param {string} segmentNormalized
 * @returns {string[]}
 */
function extractPlombyAllListas(segmentNormalized) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  let pos = 0;
  while (pos < segmentNormalized.length) {
    const rest = segmentNormalized.slice(pos);
    const li = rest.search(RE_LISTA_PLOMB);
    if (li === -1) break;
    const absStart = pos + li;
    const block = segmentNormalized.slice(absStart);
    const u = block.search(RE_UWAGI);
    const nz = block.slice(30).search(/Zlecenie\s+transportowe\s+nr\s*:/i);
    let len = block.length;
    if (u !== -1) len = Math.min(len, u);
    if (nz !== -1) len = Math.min(len, 30 + nz);
    const slice = block.slice(0, Math.max(len, 1));
    for (const line of slice.split("\n")) {
      for (const digits of plombyFromListLine(line)) {
        if (!seen.has(digits)) {
          seen.add(digits);
          out.push(digits);
        }
      }
    }
    pos = absStart + Math.max(slice.length, 1);
  }
  return out;
}

/**
 * Jeden fragment tekstu (jedno „Zlecenie transportowe…”).
 * @param {string} normalized
 * @returns {ProtocolFields}
 */
function parseProtocolSegment(normalized) {
  const uwagi = [];
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

  const plomby = extractPlombyAllListas(normalized);

  if (!numer_zlecenia) uwagi.push("brak_numeru_zlecenia");
  else if (!isZlecenieFormatSample(numer_zlecenia)) uwagi.push("zlecenie_format");
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
 * @param {string} raw
 * @returns {ProtocolFields}
 */
export function parseProtocolText(raw) {
  const normalized = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const chunks = normalized
    .split(/(?=Zlecenie\s+transportowe\s+nr\s*:)/gi)
    .map((c) => c.trim())
    .filter((c) => /Zlecenie\s+transportowe\s+nr\s*:/i.test(c));

  if (chunks.length <= 1) {
    const p = parseProtocolSegment(normalized);
    return { ...p, segments: undefined };
  }

  /** @type {{ numer_zlecenia: string, przewoznik: string, plomby: string[] }[]} */
  const segments = [];
  const uwagi = [];
  for (const ch of chunks) {
    const p = parseProtocolSegment(ch);
    segments.push({
      numer_zlecenia: p.numer_zlecenia,
      przewoznik: p.przewoznik,
      plomby: p.plomby,
    });
    for (const u of p.uwagi_parse) {
      if (!uwagi.includes(u)) uwagi.push(u);
    }
  }

  const plomby = segments.flatMap((s) => s.plomby);

  return {
    numer_zlecenia: segments[0]?.numer_zlecenia ?? "",
    przewoznik: segments[0]?.przewoznik ?? "",
    plomby,
    uwagi_parse: uwagi,
    segments,
  };
}

/**
 * @param {string} numer
 * @returns {boolean}
 */
export function isPlombaFormatSample(numer) {
  return RE_PLOMBA_EXCEL_DIGITS.test(numer);
}

/**
 * Poprawność pól (bez progu confidence OCR) — używane przy wyborze ROI vs pełna strona.
 * @param {ProtocolFields} parsed
 */
export function protocolStructuralOk(parsed) {
  if (parsed.segments?.length) {
    return parsed.segments.every(
      (s) =>
        s.numer_zlecenia?.trim() &&
        isZlecenieFormatSample(s.numer_zlecenia) &&
        s.przewoznik?.trim() &&
        s.plomby.length > 0 &&
        s.plomby.every(isPlombaFormatSample)
    );
  }
  if (!parsed.numer_zlecenia?.trim()) return false;
  if (!isZlecenieFormatSample(parsed.numer_zlecenia)) return false;
  if (!parsed.przewoznik?.trim()) return false;
  if (parsed.plomby.length === 0) return false;
  return parsed.plomby.every(isPlombaFormatSample);
}

/**
 * Kwalifikacja do folderu done / problematyczne i treść kolumny Uwagi_odczyt (spec §3–4).
 * Opcjonalnie `meta.confidenceMinRoi`: osobne progi 0–100 per region ROI (brak klucza → `confidenceMin` / domyślny).
 * @param {ProtocolFields} parsed
 * @param {{
 *   ocrMinConfidence?: number | null,
 *   confidenceMin?: number,
 *   confidenceMinRoi?: Partial<Record<keyof RoiOcrConfidences, number>> | null,
 *   ocrRegionConfidence?: RoiOcrConfidences | null,
 * }} [meta]
 */
export function protocolReadoutQuality(parsed, meta = {}) {
  const issues = [];
  if (parsed.segments?.length) {
    for (const s of parsed.segments) {
      if (!s.numer_zlecenia?.trim()) issues.push("brak_numeru_zlecenia");
      else if (!isZlecenieFormatSample(s.numer_zlecenia)) issues.push("zlecenie_format");
      if (!s.przewoznik?.trim()) issues.push("brak_przewoznika");
      if (s.plomby.length === 0) issues.push("brak_plomb");
    }
  } else {
    if (!parsed.numer_zlecenia?.trim()) issues.push("brak_numeru_zlecenia");
    else if (!isZlecenieFormatSample(parsed.numer_zlecenia)) issues.push("zlecenie_format");
    if (!parsed.przewoznik?.trim()) issues.push("brak_przewoznika");
    if (parsed.plomby.length === 0) issues.push("brak_plomb");
  }
  const badPlomby = parsed.plomby.filter((p) => !isPlombaFormatSample(p));
  if (badPlomby.length) issues.push("plomba_format");
  const defaultThreshold =
    typeof meta.confidenceMin === "number" && Number.isFinite(meta.confidenceMin)
      ? meta.confidenceMin
      : OCR_CONFIDENCE_MIN;
  const roiOverrides = meta.confidenceMinRoi && typeof meta.confidenceMinRoi === "object" ? meta.confidenceMinRoi : null;
  /** @param {keyof RoiOcrConfidences} k */
  function roiThreshold(k) {
    const o = roiOverrides?.[k];
    if (typeof o === "number" && Number.isFinite(o)) return o;
    return defaultThreshold;
  }
  const orc = meta.ocrRegionConfidence;
  if (orc && typeof orc === "object") {
    /** @type {(keyof RoiOcrConfidences)[]} */
    const keys = ["numer_zlecenia", "przewoznik", "lista_plomb"];
    for (const k of keys) {
      const c = orc[k];
      if (typeof c === "number" && Number.isFinite(c) && c < roiThreshold(k)) {
        issues.push(`niski_confidence_ocr_roi_${k}(${Math.round(c)})`);
      }
    }
  } else {
    const oc = meta.ocrMinConfidence;
    if (oc != null && Number.isFinite(oc) && oc < defaultThreshold) {
      issues.push(`niski_confidence_ocr(${Math.round(oc)})`);
    }
  }
  const issueList = [...new Set(issues)];
  const ok = issueList.length === 0;
  return {
    ok,
    destSubfolder: ok ? "done" : "problematyczne",
    uwagi_excel: ok ? "ok" : issueList.join("; "),
    /** Tokeny zgodne z `uwagi_excel` (split po `"; "`); do Excela i testów. */
    issues: issueList,
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
    (isZlecenieFormatSample(p.numer_zlecenia) ? 4 : p.numer_zlecenia?.trim() ? 1 : 0) +
    (p.przewoznik ? 4 : 0) +
    p.plomby.filter(isPlombaFormatSample).length * 2;
  return score(a) >= score(b) ? "a" : "b";
}
