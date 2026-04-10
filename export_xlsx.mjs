/**
 * Daily workbook merge/write (spec §3.3) + row model.
 */

import { isPlombaFormatSample } from "./protocol_parse.mjs";

/** @typedef {import('./protocol_parse.mjs').ProtocolFields} ProtocolFields */

let xlsxModulePromise = null;

export function loadXlsx() {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
  }
  return xlsxModulePromise;
}

/**
 * @param {string} fileName
 * @param {ProtocolFields} parsed
 * @param {{ ok: boolean, uwagi_excel: string }} quality
 * @returns {Record<string, string>[]}
 */
export function buildExcelRows(fileName, parsed, quality) {
  const uw = quality.uwagi_excel;
  const pl = parsed.plomby.filter((p) => isPlombaFormatSample(p));
  const rows = [];
  if (pl.length === 0) {
    rows.push({
      nazwa_pliku: fileName,
      numer_zlecenia: parsed.numer_zlecenia,
      przewoznik: parsed.przewoznik,
      numer_plomby: "",
      Uwagi_odczyt: uw,
    });
    return rows;
  }
  for (const numer_plomby of pl) {
    rows.push({
      nazwa_pliku: fileName,
      numer_zlecenia: parsed.numer_zlecenia,
      przewoznik: parsed.przewoznik,
      numer_plomby,
      Uwagi_odczyt: uw,
    });
  }
  return rows;
}

/** @param {ProtocolFields} parsed */
export function buildRowsForError(fileName, message) {
  return [
    {
      nazwa_pliku: fileName,
      numer_zlecenia: "",
      przewoznik: "",
      numer_plomby: "",
      Uwagi_odczyt: message,
    },
  ];
}

/**
 * @param {FileSystemDirectoryHandle | null} dirHandle
 * @param {string} dateYmd YYYY-MM-DD
 * @param {Record<string, string>[]} newRows
 * @returns {Promise<Blob>}
 */
export async function mergeAndBuildWorkbookBlob(dirHandle, dateYmd, newRows) {
  const XLSX = await loadXlsx();
  const name = `wynik_${dateYmd}.xlsx`;
  let existing = [];
  if (dirHandle) {
    try {
      const fh = await dirHandle.getFileHandle(name);
      const buf = await (await fh.getFile()).arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      existing = XLSX.utils.sheet_to_json(ws, { defval: "" });
    } catch {
      existing = [];
    }
  }
  const merged = existing.concat(newRows);
  const ws = XLSX.utils.json_to_sheet(merged, {
    header: ["nazwa_pliku", "numer_zlecenia", "przewoznik", "numer_plomby", "Uwagi_odczyt"],
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Wynik");
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/**
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} dateYmd
 * @param {Blob} blob
 */
export async function writeWorkbookToDirectory(dirHandle, dateYmd, blob) {
  const name = `wynik_${dateYmd}.xlsx`;
  try {
    await dirHandle.removeEntry(name);
  } catch {
    /* not present */
  }
  const fh = await dirHandle.getFileHandle(name, { create: true });
  const writable = await fh.createWritable();
  await writable.write(blob);
  await writable.close();
}
