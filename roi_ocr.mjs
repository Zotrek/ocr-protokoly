/**
 * ROI-based OCR for protocol page 1 (scans). Stitches crops into text the parser understands.
 */

/** @typedef {{ left: number, top: number, width: number, height: number }} NormRect */
/** @typedef {{ margin?: number, regions_norm: Record<string, NormRect> }} RoiConfig */

export const ROI_DEFAULT_FALLBACK = /** @type {RoiConfig} */ ({
  margin: 0.02,
  regions_norm: {
    numer_zlecenia: { left: 0.1, top: 0.06, width: 0.34, height: 0.055 },
    przewoznik: { left: 0.1, top: 0.13, width: 0.82, height: 0.095 },
    lista_plomb: { left: 0.1, top: 0.43, width: 0.32, height: 0.49 },
  },
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
    return { ...ROI_DEFAULT_FALLBACK, regions_norm: { ...ROI_DEFAULT_FALLBACK.regions_norm } };
  }
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

  const margin = cfg.margin ?? 0.02;
  const { regions_norm } = cfg;
  const w = canvas.width;
  const h = canvas.height;

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

  const zRaw = z.text;
  const pRaw = p.text;
  const lRaw = l.text;

  const zLine = /zlecenie/i.test(zRaw) ? zRaw : `Zlecenie transportowe nr: ${zRaw}`;
  const pLine = /przewoźnik/i.test(pRaw) ? pRaw : `Przewoźnik: ${pRaw}`;
  const listBlock = /lista\s+odebranych\s+plomb/i.test(lRaw) ? lRaw : `Lista odebranych plomb:\n${lRaw}`;

  const text = [zLine, "", pLine, "", listBlock].join("\n");
  return { text, roiMinConfidence };
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
  return recognizeCanvasWithConfidence(worker, canvas);
}
