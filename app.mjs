import Tesseract from "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/+esm";
import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/+esm";
import {
  parseProtocolText,
  protocolReadoutQuality,
  pickBetterParsedKey,
  protocolStructuralOk,
  nativeTextLooksLikeProtocol,
  OCR_CONFIDENCE_MIN,
} from "./protocol_parse.mjs";
import { loadRoiDefault, ocrPage1RoiStitched, ocrFullPageText } from "./roi_ocr.mjs";
import {
  buildExcelRows,
  buildRowsForError,
  mergeAndBuildWorkbookBlob,
  writeWorkbookToDirectory,
} from "./export_xlsx.mjs";
import { humanizePdfError } from "./pdf_errors.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const el = {
  status: document.getElementById("status"),
  prog: document.getElementById("prog"),
  log: document.getElementById("log"),
  btnDir: document.getElementById("btnDir"),
  btnStop: document.getElementById("btnStop"),
  btnLogDownload: document.getElementById("btnLogDownload"),
  btnLogClear: document.getElementById("btnLogClear"),
  chkRecurse: document.getElementById("chkRecurse"),
  inpOcrMin: document.getElementById("inpOcrMin"),
  inpNameFilter: document.getElementById("inpNameFilter"),
  inputDir: document.getElementById("inputDir"),
  hintBrowserMode: document.getElementById("hintBrowserMode"),
};

/** Czy pełny tryb: zapis Excela w folderze + przenoszenie PDF (File System Access). */
function hasFileSystemAccessFolderPicker() {
  return typeof window.showDirectoryPicker === "function";
}

function initBrowserModeHint() {
  const p = el.hintBrowserMode;
  if (!p) return;
  const mono = 'style="font-family: var(--mono); font-size: 0.85em"';
  if (hasFileSystemAccessFolderPicker()) {
    p.innerHTML = `<strong>Chrome / Edge:</strong> wybór folderu z zapisem — powstanie <code ${mono}>wynik_YYYY-MM-DD.xlsx</code> w tym folderze, PDF trafią do <code ${mono}>done</code> / <code ${mono}>problematyczne</code>. Bez zaznaczenia „Szukaj w podfolderach” przetwarzane są tylko <code ${mono}>.pdf</code> z katalogu głównego.`;
  } else {
    p.innerHTML = `<strong>Firefox (i inne bez File System Access):</strong> wybór folderu działa przez okno systemowe; <strong>OCR i parser</strong> są takie same. Plik <code ${mono}>wynik_YYYY-MM-DD.xlsx</code> zostanie <strong>pobrany</strong> — przeglądarka nie udostępnia zapisu do wybranego katalogu ani automatycznego przenoszenia PDF do <code ${mono}>done</code> / <code ${mono}>problematyczne</code> (ta funkcja jest w Chrome / Edge na HTTPS lub <code ${mono}>localhost</code>).`;
  }
}

initBrowserModeHint();

function setBatchFormDisabled(disabled) {
  if (el.chkRecurse) el.chkRecurse.disabled = disabled;
  if (el.inpOcrMin) el.inpOcrMin.disabled = disabled;
  if (el.inpNameFilter) el.inpNameFilter.disabled = disabled;
  if (el.btnLogClear) el.btnLogClear.disabled = disabled;
}

const STATUS_IDLE = "Oczekuję na start.";
const SKIP_DIR_NAMES = new Set(["done", "problematyczne"]);
const LS_OCR_CONF_MIN = "ocr_proto_conf_min";
const LS_NAME_FILTER = "ocr_proto_name_filter";

(function initNameFilterUi() {
  const inp = el.inpNameFilter;
  if (!inp) return;
  try {
    const s = localStorage.getItem(LS_NAME_FILTER);
    if (s != null) inp.value = s;
  } catch {
    /* ignore */
  }
  inp.addEventListener("change", () => {
    try {
      localStorage.setItem(LS_NAME_FILTER, inp.value);
    } catch {
      /* ignore */
    }
  });
})();

/** Czy nazwa pliku (bez ścieżki) zawiera filtr — puste pole = wszystkie. */
function pdfFileNameMatchesFilter(excelName) {
  const raw = el.inpNameFilter?.value?.trim().toLowerCase() ?? "";
  if (!raw) return true;
  const base = excelName.includes("/") ? excelName.split("/").pop() || excelName : excelName;
  return base.toLowerCase().includes(raw);
}

(function initOcrThresholdUi() {
  const inp = el.inpOcrMin;
  if (!inp) return;
  try {
    const s = localStorage.getItem(LS_OCR_CONF_MIN);
    if (s != null) {
      const n = Number(s);
      if (Number.isFinite(n) && n >= 0 && n <= 100) inp.value = String(Math.round(n));
    }
  } catch {
    /* ignore */
  }
  inp.addEventListener("change", () => {
    try {
      localStorage.setItem(LS_OCR_CONF_MIN, inp.value);
    } catch {
      /* ignore */
    }
  });
})();

function readConfidenceMinFromUi() {
  const n = Number(el.inpOcrMin?.value);
  if (Number.isFinite(n) && n >= 0 && n <= 100) return Math.round(n);
  return OCR_CONFIDENCE_MIN;
}

/** @type {import('tesseract.js').Worker | null} */
let ocrWorker = null;
let busy = false;
let batchAborted = false;

async function terminateOcrWorker() {
  if (!ocrWorker) return;
  try {
    await ocrWorker.terminate();
  } catch {
    /* ignore */
  }
  ocrWorker = null;
}

window.addEventListener("pagehide", () => {
  void terminateOcrWorker();
});

function setStatus(text) {
  el.status.textContent = text;
}

function appendLog(chunk) {
  el.log.textContent += chunk;
  el.log.scrollTop = el.log.scrollHeight;
}

async function ensureOcrWorker() {
  if (ocrWorker) return ocrWorker;
  setStatus("Inicjalizacja OCR (pierwsze uruchomienie może trwać dłużej — pobierany jest model języka)…");
  ocrWorker = await Tesseract.createWorker("pol", 1, {
    logger(m) {
      if (m.status === "recognizing text" && typeof m.progress === "number") {
        setStatus(`OCR strony… ${Math.round(m.progress * 100)}%`);
      }
    },
  });
  return ocrWorker;
}

/**
 * Tekst z warstwy PDF (np. eksport Word) — bez OCR. Na skanach zwykle pusty → wtedy pełnostronicowy OCR.
 * @param {import('pdfjs-dist').PDFPageProxy} page
 */
async function extractTextNative(page) {
  const tc = await page.getTextContent();
  const items = tc.items
    .filter((it) => "str" in it && it.str.trim())
    .map((it) => {
      const ty = it.transform[5];
      const tx = it.transform[4];
      return { str: it.str, tx, ty };
    });
  items.sort((a, b) => {
    if (Math.abs(a.ty - b.ty) < 2.5) return a.tx - b.tx;
    return b.ty - a.ty;
  });
  const lines = [];
  let line = [];
  let lastTy = /** @type {number | null} */ (null);
  for (const it of items) {
    if (lastTy !== null && Math.abs(it.ty - lastTy) > 2.5) {
      lines.push(line.join(" "));
      line = [];
    }
    line.push(it.str);
    lastTy = it.ty;
  }
  if (line.length) lines.push(line.join(" "));
  return lines.join("\n");
}

/**
 * @param {import('pdfjs-dist').PDFPageProxy} page
 * @param {import('tesseract.js').Worker} worker
 * @param {import('./roi_ocr.mjs').RoiConfig} roiCfg
 */
async function extractPage1WithOcr(page, worker, roiCfg) {
  const r1 = await ocrPage1RoiStitched(page, worker, roiCfg);
  const pRoi = parseProtocolText(r1.text);
  if (protocolStructuralOk(pRoi)) {
    return {
      text: r1.text,
      ocrMinConfidence: r1.roiMinConfidence,
      ocrRegionConfidence: r1.roiConfidences,
    };
  }
  const r2 = await ocrFullPageText(page, worker);
  const pFull = parseProtocolText(r2.text);
  const key = pickBetterParsedKey(pRoi, pFull);
  return {
    text: key === "a" ? r1.text : r2.text,
    ocrMinConfidence: key === "a" ? r1.roiMinConfidence : r2.confidence,
    ocrRegionConfidence: key === "a" ? r1.roiConfidences : null,
  };
}

/**
 * @param {File} file
 * @param {import('tesseract.js').Worker} worker
 * @param {import('./roi_ocr.mjs').RoiConfig} roiCfg
 * @returns {Promise<{
 *   text: string,
 *   pageSources: string[],
 *   ocrMinConfidence: number | null,
 *   ocrRegionConfidence: import('./protocol_parse.mjs').RoiOcrConfidences | null,
 * }>}
 */
async function ocrPdfFile(file, worker, roiCfg) {
  const data = new Uint8Array(await file.arrayBuffer());
  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ data }).promise;
  } catch (e) {
    throw new Error(humanizePdfError(e));
  }
  const parts = [];
  /** @type {string[]} */
  const pageSources = [];
  /** @type {number | null} */
  let ocrMinConfidence = null;
  /** @type {import('./protocol_parse.mjs').RoiOcrConfidences | null} */
  let ocrRegionConfidence = null;
  function noteOcrConf(c) {
    if (c == null || !Number.isFinite(c)) return;
    ocrMinConfidence = ocrMinConfidence == null ? c : Math.min(ocrMinConfidence, c);
  }
  for (let p = 1; p <= pdf.numPages; p++) {
    setStatus(`${file.name}: strona ${p}/${pdf.numPages}`);
    const page = await pdf.getPage(p);
    let text = await extractTextNative(page);
    let source = "warstwa PDF";
    const nativeLen = text.trim().length;
    const ocrNeeded =
      nativeLen === 0 || (p === 1 && !nativeTextLooksLikeProtocol(text));
    if (ocrNeeded) {
      if (p === 1) {
        const r = await extractPage1WithOcr(page, worker, roiCfg);
        text = r.text;
        noteOcrConf(r.ocrMinConfidence);
        if (r.ocrRegionConfidence) ocrRegionConfidence = r.ocrRegionConfidence;
        source = "OCR str.1 (ROI, ewentualnie pełna strona)";
      } else {
        const r = await ocrFullPageText(page, worker);
        text = r.text;
        noteOcrConf(r.confidence);
        source = `OCR str.${p} (pełna strona)`;
      }
    }
    parts.push(text);
    pageSources.push(source);
  }
  const fullText = parts.join("\n\n");
  return { text: fullText, pageSources, ocrMinConfidence, ocrRegionConfidence };
}

function localDateYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function downloadBlob(blob, name) {
  const a = document.createElement("a");
  const u = URL.createObjectURL(blob);
  a.href = u;
  a.download = name;
  a.click();
  URL.revokeObjectURL(u);
}

/**
 * @typedef {{
 *   excelName: string,
 *   moveTargetName: string,
 *   getFile: () => Promise<File>,
 *   handle?: FileSystemFileHandle | null
 * }} PdfJob
 */

/**
 * @param {FileSystemDirectoryHandle} root
 * @param {boolean} recurse
 * @returns {Promise<PdfJob[]>}
 */
async function collectJobsFromDirectoryHandle(root, recurse) {
  /** @type {PdfJob[]} */
  const jobs = [];

  /**
   * @param {FileSystemDirectoryHandle} dh
   * @param {string} prefix
   */
  async function walk(dh, prefix) {
    for await (const [entName, handle] of dh.entries()) {
      const rel = prefix ? `${prefix}/${entName}` : entName;
      if (handle.kind === "directory") {
        if (!recurse) continue;
        if (SKIP_DIR_NAMES.has(entName)) continue;
        await walk(handle, rel);
      } else if (handle.kind === "file" && entName.toLowerCase().endsWith(".pdf")) {
        const excelName = rel.replace(/\\/g, "/");
        const moveTargetName = excelName.includes("/")
          ? excelName.replace(/\//g, "__")
          : excelName;
        jobs.push({
          excelName,
          moveTargetName,
          handle,
          getFile: () => handle.getFile(),
        });
      }
    }
  }

  if (recurse) {
    await walk(root, "");
  } else {
    for await (const [entName, handle] of root.entries()) {
      if (handle.kind !== "file" || !entName.toLowerCase().endsWith(".pdf")) continue;
      jobs.push({
        excelName: entName,
        moveTargetName: entName,
        handle,
        getFile: () => handle.getFile(),
      });
    }
  }
  jobs.sort((a, b) => a.excelName.localeCompare(b.excelName, "pl"));
  return jobs;
}

/**
 * @param {PdfJob[]} jobs
 * @param {FileSystemDirectoryHandle | null} dirHandle
 */
async function runQueue(rawJobs, dirHandle) {
  if (busy) return;
  const jobs = rawJobs.filter((j) => pdfFileNameMatchesFilter(j.excelName));
  if (rawJobs.length > 0 && jobs.length === 0) {
    setStatus("Żaden plik PDF nie pasuje do filtra nazwy — wyczyść lub zmień pole „Filtr nazwy”.");
    return;
  }
  if (jobs.length === 0) {
    setStatus("Brak plików PDF do obróbki.");
    return;
  }
  busy = true;
  batchAborted = false;
  el.btnDir.disabled = true;
  el.btnStop.disabled = false;
  setBatchFormDisabled(true);
  el.log.textContent = "";
  el.prog.max = jobs.length;
  el.prog.value = 0;
  const batchDate = localDateYmd();
  const confidenceMin = readConfidenceMinFromUi();
  try {
    localStorage.setItem(LS_OCR_CONF_MIN, String(confidenceMin));
    if (el.inpNameFilter) localStorage.setItem(LS_NAME_FILTER, el.inpNameFilter.value);
  } catch {
    /* ignore */
  }
  setStatus(`Znaleziono ${jobs.length} plik(ów). Start…`);

  if (dirHandle) {
    try {
      const perm = await dirHandle.requestPermission({ mode: "readwrite" });
      if (perm !== "granted") {
        setStatus("Wymagana zgoda na zapis w folderze (read/write).");
        busy = false;
        el.btnDir.disabled = false;
        el.btnStop.disabled = true;
        setBatchFormDisabled(false);
        return;
      }
    } catch {
      setStatus("Nie udało się uzyskać zgody na zapis do folderu.");
      busy = false;
      el.btnDir.disabled = false;
      el.btnStop.disabled = true;
      setBatchFormDisabled(false);
      return;
    }
  }

  const roiCfg = await loadRoiDefault("");
  /** @type {Record<string, string>[]} */
  const batchRows = [];
  /** @type {{ handle: FileSystemFileHandle, dest: string, targetName: string }[]} */
  const pendingMoves = [];

  try {
    const worker = await ensureOcrWorker();
    for (let i = 0; i < jobs.length; i++) {
      if (batchAborted) {
        appendLog("\n── Przerwano przez użytkownika ──\n");
        break;
      }
      const job = jobs[i];
      try {
        const file = await job.getFile();
        const { text: fullText, pageSources, ocrMinConfidence, ocrRegionConfidence } =
          await ocrPdfFile(file, worker, roiCfg);
        appendLog(`═══ ${job.excelName} ═══\n`);
        pageSources.forEach((src, idx) => {
          appendLog(`  strona ${idx + 1}: ${src}\n`);
        });
        if (ocrMinConfidence != null) {
          appendLog(
            `  OCR min. pewność (Tesseract): ${Math.round(ocrMinConfidence)} (próg ${confidenceMin})\n`
          );
        }
        const parsed = parseProtocolText(fullText);
        const quality = protocolReadoutQuality(parsed, {
          ocrMinConfidence: ocrMinConfidence ?? undefined,
          ocrRegionConfidence: ocrRegionConfidence ?? undefined,
          confidenceMin,
        });
        appendLog(
          `── Pola (parser) ──\n` +
            `zlecenie: ${parsed.numer_zlecenia || "—"}\n` +
            `przewoźnik: ${parsed.przewoznik ? parsed.przewoznik.slice(0, 200) + (parsed.przewoznik.length > 200 ? "…" : "") : "—"}\n` +
            `plomby (${parsed.plomby.length}): ${parsed.plomby.join(", ") || "—"}\n` +
            `kwalifikacja: ${quality.destSubfolder} (${quality.uwagi_excel})\n` +
            (parsed.uwagi_parse.length ? `uwagi parsera: ${parsed.uwagi_parse.join(", ")}\n` : "")
        );
        const preview = fullText.slice(0, 2500);
        appendLog(`── Pełny tekst (fragment) ──\n${preview}${fullText.length > 2500 ? "\n… [ucięto]\n" : "\n"}\n`);
        batchRows.push(...buildExcelRows(job.excelName, parsed, quality));
        if (job.handle && dirHandle) {
          pendingMoves.push({
            handle: job.handle,
            dest: quality.destSubfolder,
            targetName: job.moveTargetName,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        appendLog(`═══ ${job.excelName} ═══\nBŁĄD: ${msg}\n\n`);
        batchRows.push(...buildRowsForError(job.excelName, `blad_przetwarzania: ${msg}`));
        if (job.handle && dirHandle) {
          pendingMoves.push({
            handle: job.handle,
            dest: "problematyczne",
            targetName: job.moveTargetName,
          });
        }
      }
      el.prog.value = i + 1;
      setStatus(`Przetworzono ${i + 1} / ${jobs.length}`);
    }

    const blob = await mergeAndBuildWorkbookBlob(dirHandle, batchDate, batchRows);
    if (dirHandle) {
      await writeWorkbookToDirectory(dirHandle, batchDate, blob);
      for (const m of pendingMoves) {
        try {
          const sub = await dirHandle.getDirectoryHandle(m.dest, { create: true });
          await m.handle.move(sub, m.targetName);
        } catch (e) {
          const em = e instanceof Error ? e.message : String(e);
          appendLog(`Przeniesienie ${m.targetName} → ${m.dest}: ${em}\n`);
        }
      }
      setStatus(
        batchAborted
          ? `Przerwano. Zapisano częściowy wynik_${batchDate}.xlsx (jeśli były przetworzone pliki).`
          : `Gotowe. Zapisano wynik_${batchDate}.xlsx; PDF przeniesione do done / problematyczne.`
      );
    } else {
      downloadBlob(blob, `wynik_${batchDate}.xlsx`);
      setStatus(
        batchAborted
          ? `Przerwano. Pobrano częściowy wynik_${batchDate}.xlsx.`
          : `Gotowe. Pobrano wynik_${batchDate}.xlsx (brak przenoszenia PDF w tym trybie).`
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const excelReadFail = /wczytać istniejącego pliku|nie zostały przeniesione/i.test(msg);
    setStatus(excelReadFail ? msg : `Błąd zapisu Excel: ${msg}`);
    appendLog(`\n── Błąd wsadowy ──\n${msg}\n`);
  } finally {
    busy = false;
    el.btnDir.disabled = false;
    el.btnStop.disabled = true;
    setBatchFormDisabled(false);
  }
}

el.btnStop.addEventListener("click", () => {
  if (busy) batchAborted = true;
});

el.btnLogDownload?.addEventListener("click", () => {
  const t = el.log.textContent || "";
  const blob = new Blob([t], { type: "text/plain;charset=utf-8" });
  downloadBlob(blob, `ocr_protokoly_log_${localDateYmd()}.txt`);
});

el.btnLogClear?.addEventListener("click", () => {
  if (busy) return;
  el.log.textContent = "";
});

window.addEventListener("keydown", (e) => {
  if (!busy || e.key !== "Escape") return;
  batchAborted = true;
  e.preventDefault();
});

el.btnDir.addEventListener("click", async () => {
  if (hasFileSystemAccessFolderPicker()) {
    try {
      /** @type {FileSystemDirectoryHandle} */
      const dir = await window.showDirectoryPicker({ mode: "readwrite" });
      const recurse = el.chkRecurse.checked;
      const jobs = await collectJobsFromDirectoryHandle(dir, recurse);
      await runQueue(jobs, dir);
      return;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        setStatus(STATUS_IDLE);
        return;
      }
      console.warn(e);
      setStatus("Wybór folderu (File System Access) nie zadziałał — otwieram okno folderu…");
    }
  }
  el.inputDir.click();
});

el.inputDir.addEventListener("change", async () => {
  const list = el.inputDir.files ? Array.from(el.inputDir.files) : [];
  el.inputDir.value = "";
  const recurse = el.chkRecurse.checked;
  /** @type {PdfJob[]} */
  const jobs = [];
  for (const f of list) {
    if (!f.name.toLowerCase().endsWith(".pdf")) continue;
    const rel = (f.webkitRelativePath || f.name).replace(/\\/g, "/");
    const segments = rel.split("/");
    if (SKIP_DIR_NAMES.has(segments[0])) continue;
    if (!recurse && segments.length > 1) continue;
    const excelName = rel;
    const moveTargetName = excelName.includes("/") ? excelName.replace(/\//g, "__") : excelName;
    jobs.push({
      excelName,
      moveTargetName,
      handle: null,
      getFile: async () => f,
    });
  }
  if (list.length > 0 && jobs.length === 0) {
    setStatus("Brak plików .pdf (sprawdź podfoldery lub opcję „Szukaj w podfolderach”).");
    return;
  }
  jobs.sort((a, b) => a.excelName.localeCompare(b.excelName, "pl"));
  await runQueue(jobs, null);
});
