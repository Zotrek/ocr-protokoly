import assert from "node:assert/strict";
import {
  normalizeExcelRow,
  excelExistingReadErrorMessage,
  EXCEL_HEADER,
  buildExcelRows,
  excelUwagiForSealRow,
} from "../export_xlsx.mjs";
import { ZLECENIE_LEN_MIN, ZLECENIE_LEN_MAX } from "../protocol_parse.mjs";
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
assert.match(rowsFile[0].Uwagi_odczyt, /niski confidence OCR/);
assert.match(rowsFile[0].Uwagi_odczyt, /część numerów plomb pominięta/);
assert.match(rowsFile[1].Uwagi_odczyt, /15 cyfr/);

const qZlecFormat = {
  ok: false,
  uwagi_excel: "zlecenie_format; plomba_format",
  issues: ["zlecenie_format", "plomba_format"],
};
const uwZ = excelUwagiForSealRow(qZlecFormat);
assert.match(uwZ, /numer zlecenia: nieprawidłowy format/);
assert.match(uwZ, /część numerów plomb pominięta/);

const uwHand = excelUwagiForSealRow({
  ok: false,
  issues: ["podejrzenie_odreczne_roi_lista_plomb"],
  uwagi_excel: "podejrzenie_odreczne_roi_lista_plomb",
});
assert.match(uwHand, /ROI lista plomb: podejrzenie/);

// niski_confidence_ocr_roi_*(N) → czytelna etykieta
const uwRoiConf = excelUwagiForSealRow({
  ok: false,
  issues: ["niski_confidence_ocr_roi_numer_zlecenia(42)"],
  uwagi_excel: "niski_confidence_ocr_roi_numer_zlecenia(42)",
});
assert.match(uwRoiConf, /ROI numer zlecenia: niski confidence OCR \(42%\)/);

const uwRoiConf2 = excelUwagiForSealRow({
  ok: false,
  issues: ["niski_confidence_ocr_roi_przewoznik(30)"],
  uwagi_excel: "niski_confidence_ocr_roi_przewoznik(30)",
});
assert.match(uwRoiConf2, /ROI przewoźnik: niski confidence OCR \(30%\)/);

// niski_confidence_ocr(N) (pełna strona / str. 2+) → czytelna etykieta
const uwFullConf = excelUwagiForSealRow({
  ok: false,
  issues: ["niski_confidence_ocr(38)"],
  uwagi_excel: "niski_confidence_ocr(38)",
});
assert.match(uwFullConf, /niski confidence OCR \(38%\)/);

// brak_* → czytelne etykiety
const uwBrak = excelUwagiForSealRow({
  ok: false,
  issues: ["brak_numeru_zlecenia", "brak_przewoznika"],
  uwagi_excel: "brak_numeru_zlecenia; brak_przewoznika",
});
assert.match(uwBrak, /brak numeru zlecenia/);
assert.match(uwBrak, /brak przewoźnika/);

console.log("excel_export_selftest: OK");
