import assert from "node:assert/strict";
import {
  normalizeExcelRow,
  excelExistingReadErrorMessage,
  EXCEL_HEADER,
  buildExcelRows,
  excelUwagiForSealRow,
} from "../export_xlsx.mjs";
import { parseProtocolText, protocolReadoutQuality } from "../protocol_parse.mjs";

assert.equal(EXCEL_HEADER.length, 5);

const m = excelExistingReadErrorMessage("wynik_2026-04-10.xlsx", new Error("bad"));
assert.match(m, /wynik_2026-04-10\.xlsx/);
assert.match(m, /bad/);
assert.match(m, /nie zostały przeniesione/i);

const row = normalizeExcelRow({ UWAGI_ODCZYT: "x" });
assert.equal(row.Uwagi_odczyt, "x");

const mixedPlomb = parseProtocolText(`
Zlecenie transportowe nr: 1
Przewoźnik: X
Miejsce dostawy: Y
Lista odebranych plomb:
1. 700000000340087
2. 70000000034002
`);
const qMix = protocolReadoutQuality(mixedPlomb);
assert.ok(!qMix.ok);
const rowsMix = buildExcelRows("t.pdf", mixedPlomb, qMix);
assert.equal(rowsMix.length, 2);
assert.equal(rowsMix[0].numer_plomby, "700000000340087");
assert.equal(rowsMix[1].numer_plomby, "70000000034002");
assert.match(excelUwagiForSealRow(qMix), /ok — w dokumencie odrzucono część numerów/);
assert.match(rowsMix[0].Uwagi_odczyt, /ok — w dokumencie odrzucono część numerów/);
assert.match(rowsMix[1].Uwagi_odczyt, /15 cyfr/);

const qFile = protocolReadoutQuality(mixedPlomb, { ocrMinConfidence: 40, confidenceMin: 50 });
const rowsFile = buildExcelRows("t.pdf", mixedPlomb, qFile);
assert.equal(rowsFile.length, 2);
assert.match(rowsFile[0].Uwagi_odczyt, /niski_confidence_ocr/);
assert.match(rowsFile[0].Uwagi_odczyt, /część numerów plomb pominięta/);
assert.match(rowsFile[1].Uwagi_odczyt, /15 cyfr/);

console.log("excel_export_selftest: OK");
