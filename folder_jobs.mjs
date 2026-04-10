/**
 * Budowa listy zadań PDF z wyniku `<input type="file" webkitdirectory>` (Firefox itd.).
 * `webkitRelativePath` ma postać `NazwaWybranegoFolderu/plik.pdf` — pierwszy segment to korzeń wyboru, nie podfolder.
 */

export const SKIP_DIR_NAMES = new Set(["done", "problematyczne"]);

/**
 * @typedef {{
 *   excelName: string,
 *   moveTargetName: string,
 *   handle: null,
 *   getFile: () => Promise<File>,
 * }} WebkitPdfJob
 */

/**
 * @param {File[]} list
 * @param {boolean} recurse
 * @returns {WebkitPdfJob[]}
 */
export function pdfJobsFromWebkitFileList(list, recurse) {
  /** @type {WebkitPdfJob[]} */
  const jobs = [];
  for (const f of list) {
    if (!f.name.toLowerCase().endsWith(".pdf")) continue;
    const relFull = (f.webkitRelativePath || f.name)
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "");
    if (!relFull) continue;
    const segments = relFull.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) continue;
    if (segments.slice(0, -1).some((dir) => SKIP_DIR_NAMES.has(dir))) continue;
    const inner = segments.length > 1 ? segments.slice(1) : segments;
    const rel = inner.join("/");
    if (!recurse && inner.length > 1) continue;
    const excelName = rel;
    const moveTargetName = excelName.includes("/") ? excelName.replace(/\//g, "__") : excelName;
    jobs.push({
      excelName,
      moveTargetName,
      handle: null,
      getFile: async () => f,
    });
  }
  return jobs;
}
