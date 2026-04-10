/**
 * Lista PDF z webkitdirectory — ścieżki względne i pomijanie done/problematyczne.
 * Uruchom: node tests/folder_jobs_selftest.mjs (katalog roboczy: OCR_protokoly/)
 */
import assert from "node:assert/strict";
import { pdfJobsFromWebkitFileList } from "../folder_jobs.mjs";

/** @param {string} name @param {string} relPath */
function pdfFile(name, relPath) {
  const f = new File([], name, { type: "application/pdf" });
  Object.defineProperty(f, "webkitRelativePath", { value: relPath, enumerable: true, configurable: true });
  return f;
}

const rootA = pdfFile("a.pdf", "Scan/a.pdf");
const nestedB = pdfFile("b.pdf", "Scan/sub/b.pdf");
const txt = new File([], "readme.txt", { type: "text/plain" });
Object.defineProperty(txt, "webkitRelativePath", { value: "Scan/readme.txt", enumerable: true, configurable: true });

let jobs = pdfJobsFromWebkitFileList([rootA, nestedB, txt], false);
assert.equal(jobs.length, 1);
assert.equal(jobs[0].excelName, "a.pdf");
assert.equal(jobs[0].moveTargetName, "a.pdf");

jobs = pdfJobsFromWebkitFileList([rootA, nestedB], true);
assert.equal(jobs.length, 2);
const names = jobs.map((j) => j.excelName).sort();
assert.deepEqual(names, ["a.pdf", "sub/b.pdf"]);

const inDone = pdfFile("x.pdf", "Scan/done/x.pdf");
assert.equal(pdfJobsFromWebkitFileList([inDone], true).length, 0);

const onlyTxt = pdfJobsFromWebkitFileList([txt], false);
assert.equal(onlyTxt.length, 0);

console.log("folder_jobs_selftest: OK");
