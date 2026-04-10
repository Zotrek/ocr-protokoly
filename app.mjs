import Tesseract from "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/+esm";
import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/+esm";
import {
  parseProtocolText,
  protocolReadoutQuality,
  pickBetterParsedKey,
  protocolStructuralOk,
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
  inputDir: document.getElementById("inputDir"),
};

function setBatchFormDisabled(disabled) {
  if (el.chkRecurse) el.chkRecurse.disabled = disabled;
  if (el.inpOcrMin) el.inpOcrMin.disabled = disabled;
  if (el.btnLogClear) el.btnLogClear.disabled = disabled;
}

const STATUS_IDLE = "Oczekuję na start.";
const SKIP_DIR_NAMES = new Set(["done", "problematyczne"]);
const LS_OCR_CONF_MIN = "ocr_proto_conf_min";

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

/** Heurystyka: czy wygląda na treść protokołu z szablonu (nie pusty / nie „śmieciowy” fragment). */
function looksLikeProtocolText(s) {
  const t = s.toLowerCase();
  return (
    s.trim().length > 120 &&
    t.includes("zlecenie") &&
    t.includes("transportowe") &&
    t.includes("przewoźnik") &&
    t.includes("lista") &&
    t.includes("plomb")
  );
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
    return { text: r1.text, ocrMinConfidence: r1.roiMinConfidence };
  }
  const r2 = await ocrFullPageText(page, worker);
  const pFull = parseProtocolText(r2.text);
  const key = pickBetterParsedKey(pRoi, pFull);
  return {
    text: key === "a" ? r1.text : r2.text,
    ocrMinConfidence: key === "a" ? r1.roiMinConfidence : r2.confidence,
  };
}

/**
 * @param {File} file
 * @param {import('tesseract.js').Worker} worker
 * @param {import('./roi_ocr.mjs').RoiConfig} roiCfg
 * @returns {Promise<{ text: string, pageSources: string[], ocrMinConfidence: number | null }>}
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
      nativeLen === 0 || (p === 1 && !looksLikeProtocolText(text));
    if (ocrNeeded) {
      if (p === 1) {
        const r = await extractPage1WithOcr(page, worker, roiCfg);
        text = r.text;
        noteOcrConf(r.ocrMinConfidence);
        source = "OCR str.1 (ROI, ewentualnie pełna strona)";
      } else {
        const r = await ocrFullPageText(page, worker);
        text = r.text;
        noteOcrConf(r.confidence);
        source = "OCR (skan lub brak tekstu)";
      }
    }
    parts.push(text);
    pageSources.push(source);
  }
  return { text: parts.join("\n\n"), pageSources, ocrMinConfidence };
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
async function runQueue(jobs, dirHandle) {
  if (busy) return;
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
        const { text: fullText, pageSources, ocrMinConfidence } = await ocrPdfFile(
          file,
          worker,
          roiCfg
        );
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
  const fsa = typeof window.showDirectoryPicker === "function";
  if (fsa) {
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
