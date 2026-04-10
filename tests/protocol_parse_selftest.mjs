/**
 * Syntetyczny tekst protokołu (bez PDF) — regresja parsera i Excel row normalizacji.
 * Uruchom: node tests/protocol_parse_selftest.mjs (katalog roboczy: OCR_protokoly/)
 */
import assert from "node:assert/strict";
import {
  parseProtocolText,
  protocolStructuralOk,
  protocolReadoutQuality,
  pickBetterParsedKey,
  nativeTextLooksLikeProtocol,
  nativeTextHasListaPlomb,
  OCR_CONFIDENCE_MIN,
  PLOMBA_LEN_EXCEL,
  PLOMBA_RAW_LEN_MIN,
  PLOMBA_RAW_LEN_MAX,
} from "../protocol_parse.mjs";
import { normalizeExcelRow, buildExcelRows } from "../export_xlsx.mjs";

const LONG_NATIVE = `${"x".repeat(130)}\nZlecenie transportowe nr: 1\nPrzewoznik: ABC\nMiejsce dostawy: Y\nLista odebranych plomb:\n1. 700000000340087\n`;
assert.ok(nativeTextLooksLikeProtocol(LONG_NATIVE));
const LONG_NATIVE_OGONEK = LONG_NATIVE.replace("Przewoznik:", "Przewoźnik:");
assert.ok(nativeTextLooksLikeProtocol(LONG_NATIVE_OGONEK));
assert.ok(!nativeTextLooksLikeProtocol("Zlecenie transportowe nr: 1\nPrzewoznik: X\nLista odebranych plomb:\n1. 700000000340087\n"));

assert.ok(nativeTextHasListaPlomb("Lista odebranych plomb:\n1. x"));
assert.ok(!nativeTextHasListaPlomb("same random chars no header"));

const SYNTH = `Zlecenie transportowe nr: 42

Przewoźnik: ACME Transport Jan Kowalski ul. Testowa 1, 00-001 Warszawa

Miejsce dostawy: Odbiorca Sp. z o.o.

Lista odebranych plomb:
1. 700000000340087
2. 700000000340022

Uwagi: przykład
`;

const p = parseProtocolText(SYNTH);
assert.equal(p.numer_zlecenia, "42");
assert.ok(p.przewoznik.includes("ACME"));
assert.deepEqual(p.plomby, ["700000000340087", "700000000340022"]);
assert.equal(p.uwagi_parse.length, 0);
assert.ok(protocolStructuralOk(p));

const qOk = protocolReadoutQuality(p);
assert.ok(qOk.ok);
assert.equal(qOk.destSubfolder, "done");
assert.deepEqual(qOk.issues, []);

const qLowConf = protocolReadoutQuality(p, { ocrMinConfidence: 40, confidenceMin: 50 });
assert.ok(!qLowConf.ok);
assert.match(qLowConf.uwagi_excel, /niski_confidence_ocr\(40\)/);
assert.ok(qLowConf.issues.some((i) => i.startsWith("niski_confidence_ocr(")));

const qHighConf = protocolReadoutQuality(p, { ocrMinConfidence: 60, confidenceMin: 50 });
assert.ok(qHighConf.ok);

const qRoiLista = protocolReadoutQuality(p, {
  ocrRegionConfidence: { numer_zlecenia: 80, przewoznik: 80, lista_plomb: 40 },
  confidenceMin: 50,
  ocrMinConfidence: 40,
});
assert.ok(!qRoiLista.ok);
assert.ok(qRoiLista.issues.some((i) => /niski_confidence_ocr_roi_lista_plomb/.test(i)));
assert.ok(!qRoiLista.issues.some((i) => i.startsWith("niski_confidence_ocr(")));

const qRoiOk = protocolReadoutQuality(p, {
  ocrRegionConfidence: { numer_zlecenia: 80, przewoznik: 80, lista_plomb: 70 },
  confidenceMin: 50,
});
assert.ok(qRoiOk.ok);

const qRoiPerFieldOk = protocolReadoutQuality(p, {
  ocrRegionConfidence: { numer_zlecenia: 48, przewoznik: 80, lista_plomb: 80 },
  confidenceMin: 50,
  confidenceMinRoi: { numer_zlecenia: 45 },
});
assert.ok(qRoiPerFieldOk.ok);

const qRoiPerFieldBad = protocolReadoutQuality(p, {
  ocrRegionConfidence: { numer_zlecenia: 48, przewoznik: 80, lista_plomb: 80 },
  confidenceMin: 50,
  confidenceMinRoi: { numer_zlecenia: 52 },
});
assert.ok(!qRoiPerFieldBad.ok);
assert.ok(
  qRoiPerFieldBad.issues.some((i) => /niski_confidence_ocr_roi_numer_zlecenia\(48\)/.test(i))
);

const qRoiListaStrict = protocolReadoutQuality(p, {
  ocrRegionConfidence: { numer_zlecenia: 80, przewoznik: 80, lista_plomb: 65 },
  confidenceMin: 50,
  confidenceMinRoi: { lista_plomb: 70 },
});
assert.ok(!qRoiListaStrict.ok);
assert.ok(qRoiListaStrict.issues.some((i) => /niski_confidence_ocr_roi_lista_plomb/.test(i)));

assert.equal(OCR_CONFIDENCE_MIN, 55);
assert.equal(PLOMBA_LEN_EXCEL, 15);
assert.equal(PLOMBA_RAW_LEN_MIN, 12);
assert.equal(PLOMBA_RAW_LEN_MAX, 18);

const badPlomb = parseProtocolText(
  SYNTH.replace("700000000340022", "70000000034002")
);
assert.ok(!protocolStructuralOk(badPlomb));

const a = parseProtocolText("Zlecenie transportowe nr: 1\nPrzewoźnik: X\nMiejsce dostawy: Y\nLista odebranych plomb:\n1. 700000000340087\n");
const b = parseProtocolText("");
assert.equal(pickBetterParsedKey(a, b), "a");

const row = normalizeExcelRow({
  "Nazwa pliku": "x.pdf",
  "Numer zlecenia": "1",
  Przewoźnik: "P",
  numer_plomb: "700000000340087",
  "Uwagi odczyt": "ok",
});
assert.equal(row.nazwa_pliku, "x.pdf");
assert.equal(row.numer_zlecenia, "1");
assert.equal(row.numer_plomby, "700000000340087");
assert.equal(row.Uwagi_odczyt, "ok");

const ocrLike = parseProtocolText(`
Zlecenie  transportowe  nr:  99
Przewoźnik: Firma Test
Miejsce dostawy: X
Lista odebranych plomb:
1.  700000000340087  
`);
assert.equal(ocrLike.numer_zlecenia, "99");
assert.deepEqual(ocrLike.plomby, ["700000000340087"]);

const spacedPlomb = parseProtocolText(`
Zlecenie transportowe nr: 5
Przewoznik: Firma
Miejsce dostawy: X
Lista odebranych plomb:
1. 7000 0000 0340 087
`);
assert.equal(spacedPlomb.numer_zlecenia, "5");
assert.deepEqual(spacedPlomb.plomby, ["700000000340087"]);

const asciiCarrier = parseProtocolText(`
Zlecenie transportowe nr: 6
Przewoznik: ABC Sp. z o.o.
Miejsce dostawy: Y
Lista odebranych plomb:
1. 700000000340087
`);
assert.ok(asciiCarrier.przewoznik.includes("ABC"));
assert.deepEqual(asciiCarrier.plomby, ["700000000340087"]);

const listaPlomby = parseProtocolText(`
Zlecenie transportowe nr: 7
Przewoźnik: Z
Miejsce dostawy: W
Lista odebranych plomby:
1. 700000000340087
`);
assert.deepEqual(listaPlomby.plomby, ["700000000340087"]);

const twoCol = parseProtocolText(`
Zlecenie transportowe nr: 8
Przewoźnik: Sped
Miejsce dostawy: M
Lista odebranych plomb:
1. 700000000340087    2. 700000000340022
`);
assert.deepEqual(twoCol.plomby, ["700000000340087", "700000000340022"]);
assert.ok(!twoCol.segments);

const multi = parseProtocolText(`
Zlecenie transportowe nr: 10
Przewoźnik: Firma A
Miejsce dostawy: X
Lista odebranych plomb:
1. 700000000340087

Zlecenie transportowe nr: 11
Przewoźnik: Firma B
Miejsce dostawy: Y
Lista odebranych plomb:
1. 700000000340022
`);
assert.ok(multi.segments && multi.segments.length === 2);
assert.equal(multi.segments[0].numer_zlecenia, "10");
assert.equal(multi.segments[1].numer_zlecenia, "11");
assert.deepEqual(multi.plomby, ["700000000340087", "700000000340022"]);
const qMulti = protocolReadoutQuality(multi);
assert.ok(qMulti.ok);
const rowsMulti = buildExcelRows("x.pdf", multi, qMulti);
assert.equal(rowsMulti.length, 2);
assert.equal(rowsMulti[0].numer_zlecenia, "10");
assert.equal(rowsMulti[1].numer_zlecenia, "11");

console.log("protocol_parse_selftest: OK");
