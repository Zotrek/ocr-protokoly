/**
 * ROI-based OCR for protocol page 1 (scans). Stitches crops into text the parser understands.
 */

/** @typedef {{ left: number, top: number, width: number, height: number }} NormRect */
/**
 * @typedef {{
 *   margin?: number,
 *   narrow_page_width_pt_max?: number,
 *   aspect_ratio_narrow_max?: number,
 *   regions_norm: Record<string, NormRect>,
 *   regions_norm_narrow?: Record<string, NormRect>,
 * }} RoiConfig
 */

const FALLBACK_NARROW = {
  numer_zlecenia: { left: 0.065, top: 0.048, width: 0.4, height: 0.068 },
  przewoznik: { left: 0.065, top: 0.115, width: 0.9, height: 0.115 },
  lista_plomb: { left: 0.065, top: 0.395, width: 0.4, height: 0.54 },
};

export const ROI_DEFAULT_FALLBACK = /** @type {RoiConfig} */ ({
  margin: 0.028,
  narrow_page_width_pt_max: 585,
  aspect_ratio_narrow_max: 0.72,
  regions_norm: {
    numer_zlecenia: { left: 0.09, top: 0.055, width: 0.36, height: 0.06 },
    przewoznik: { left: 0.09, top: 0.125, width: 0.84, height: 0.1 },
    lista_plomb: { left: 0.09, top: 0.415, width: 0.34, height: 0.52 },
  },
  regions_norm_narrow: { ...FALLBACK_NARROW },
});

/**
 * @param {string} [baseUrl]
 * @returns {Promise<RoiConfig>}
 */
export async function loadRoiDefault(baseUrl = "") {
  const url = `${baseUrl.replace(/\/$/, "")}/calibration/roi_default.json`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } catch {
    return {
      ...ROI_DEFAULT_FALLBACK,
      regions_norm: { ...ROI_DEFAULT_FALLBACK.regions_norm },
      regions_norm_narrow: { ...ROI_DEFAULT_FALLBACK.regions_norm_narrow },
    };
  }
}

/**
 * Węższa strona (np. skan ~578×824) — inne ROI niż A4 (~595×842).
 * @param {RoiConfig} cfg
 * @param {number} viewportWidth
 * @param {number} viewportHeight
 * @returns {Record<string, NormRect>}
 */
export function pickRegionsNormForViewport(cfg, viewportWidth, viewportHeight) {
  const narrow = cfg.regions_norm_narrow;
  if (!narrow || !Object.keys(narrow).length) return cfg.regions_norm;

  const wMax = cfg.narrow_page_width_pt_max;
  if (typeof wMax === "number" && Number.isFinite(wMax)) {
    return viewportWidth < wMax ? narrow : cfg.regions_norm;
  }

  const ar = viewportWidth / viewportHeight;
  const arMax =
    typeof cfg.aspect_ratio_narrow_max === "number" && Number.isFinite(cfg.aspect_ratio_narrow_max)
      ? cfg.aspect_ratio_narrow_max
      : 0.72;
  if (ar < arMax) {
    return narrow;
  }
  return cfg.regions_norm;
}

/**
 * @param {NormRect} r
 * @param {number} margin
 * @param {number} w
 * @param {number} h
 */
export function normRectToCanvasPixels(r, margin, w, h) {
  const left = Math.max(0, r.left - margin);
  const top = Math.max(0, r.top - margin);
  const right = Math.min(1, r.left + r.width + margin);
  const bottom = Math.min(1, r.top + r.height + margin);
  return {
    sx: left * w,
    sy: top * h,
    sw: Math.max(1, (right - left) * w),
    sh: Math.max(1, (bottom - top) * h),
  };
}

/**
 * @param {HTMLCanvasElement} source
 * @param {number} sx
 * @param {number} sy
 * @param {number} sw
 * @param {number} sh
 */
function cropCanvas(source, sx, sy, sw, sh) {
  const c = document.createElement("canvas");
  c.width = Math.ceil(sw);
  c.height = Math.ceil(sh);
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D context");
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return c;
}

/**
 * Szarość + lekki kontrast na pełnym rastrze strony (skany) — przed wycinkami ROI i przed pełnostronicowym OCR.
 * @param {HTMLCanvasElement} canvas
 */
export function enhanceCanvasForOcr(canvas) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  if (w < 1 || h < 1) return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const contrast = 1.22;
  const mid = 128;
  for (let i = 0; i < d.length; i += 4) {
    let v = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    v = (v - mid) * contrast + mid;
    v = Math.max(0, Math.min(255, v));
    d[i] = v;
    d[i + 1] = v;
    d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * @param {import('tesseract.js').Worker} worker
 * @param {HTMLCanvasElement | OffscreenCanvas} canvas
 * @returns {Promise<{ text: string, confidence: number }>}
 */
export async function recognizeCanvasWithConfidence(worker, canvas) {
  const r = await worker.recognize(canvas);
  const raw = typeof r.data.confidence === "number" ? r.data.confidence : NaN;
  const confidence = Number.isFinite(raw) && raw >= 0 ? raw : 0;
  const text = (r.data.text || "").trim();
  return { text, confidence };
}

/**
 * @param {import('pdfjs-dist').PDFPageProxy} page
 * @param {import('tesseract.js').Worker} worker
 * @param {RoiConfig} cfg
 * @returns {Promise<{ text: string, roiMinConfidence: number }>}
 */
export async function ocrPage1RoiStitched(page, worker, cfg) {
  const scale = 2;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Brak kontekstu 2D canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
  enhanceCanvasForOcr(canvas);

  const margin = cfg.margin ?? 0.02;
  const w = canvas.width;
  const h = canvas.height;
  const vp1 = page.getViewport({ scale: 1 });
  const regions_norm = pickRegionsNormForViewport(cfg, vp1.width, vp1.height);

  /** @param {string} key */
  async function ocrRegion(key) {
    const r = regions_norm[key];
    if (!r) return { text: "", confidence: 100 };
    const { sx, sy, sw, sh } = normRectToCanvasPixels(r, margin, w, h);
    const crop = cropCanvas(canvas, sx, sy, sw, sh);
    return recognizeCanvasWithConfidence(worker, crop);
  }

  const z = await ocrRegion("numer_zlecenia");
  const p = await ocrRegion("przewoznik");
  const l = await ocrRegion("lista_plomb");
  const roiMinConfidence = Math.min(z.confidence, p.confidence, l.confidence);
  /** Pewność Tesseract per wycinek ROI (str. 1) — do progów w `protocolReadoutQuality`. */
  const roiConfidences = {
    numer_zlecenia: z.confidence,
    przewoznik: p.confidence,
    lista_plomb: l.confidence,
  };

  const zRaw = z.text;
  const pRaw = p.text;
  const lRaw = l.text;

  const zLine = /zlecenie/i.test(zRaw) ? zRaw : `Zlecenie transportowe nr: ${zRaw}`;
  const pLine = /przewoźnik/i.test(pRaw) ? pRaw : `Przewoźnik: ${pRaw}`;
  const listBlock = /lista\s+odebranych\s+plomb/i.test(lRaw) ? lRaw : `Lista odebranych plomb:\n${lRaw}`;

  const text = [zLine, "", pLine, "", listBlock].join("\n");
  return { text, roiMinConfidence, roiConfidences };
}

/**
 * @param {import('pdfjs-dist').PDFPageProxy} page
 * @param {import('tesseract.js').Worker} worker
 * @returns {Promise<{ text: string, confidence: number }>}
 */
export async function ocrFullPageText(page, worker) {
  const scale = 2;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Brak kontekstu 2D canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({ canvasContext: ctx, viewport }).promise;
  enhanceCanvasForOcr(canvas);
  return recognizeCanvasWithConfidence(worker, canvas);
}
