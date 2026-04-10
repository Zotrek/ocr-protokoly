import assert from "node:assert/strict";
import {
  normalizeExcelRow,
  excelExistingReadErrorMessage,
  EXCEL_HEADER,
} from "../export_xlsx.mjs";

assert.equal(EXCEL_HEADER.length, 5);

const m = excelExistingReadErrorMessage("wynik_2026-04-10.xlsx", new Error("bad"));
assert.match(m, /wynik_2026-04-10\.xlsx/);
assert.match(m, /bad/);
assert.match(m, /nie zostały przeniesione/i);

const row = normalizeExcelRow({ UWAGI_ODCZYT: "x" });
assert.equal(row.Uwagi_odczyt, "x");

console.log("excel_export_selftest: OK");
