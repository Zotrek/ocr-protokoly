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
  ZLECENIE_LEN_MIN,
  ZLECENIE_LEN_MAX,
  isZlecenieFormatSample,
  roiOcrTextSuggestsHandwritingNoise,
} from "../protocol_parse.mjs";
import { normalizeExcelRow, buildExcelRows } from "../export_xlsx.mjs";

const LONG_NATIVE = `${"x".repeat(130)}\nZlecenie transportowe nr: 1\nPrzewoznik: ABC\nMiejsce dostawy: Y\nLista odebranych plomb:\n1. 700000000340087\n`;
assert.ok(nativeTextLooksLikeProtocol(LONG_NATIVE));
const LONG_NATIVE_OGONEK = LONG_NATIVE.replace("Przewoznik:", "Przewoźnik:");
assert.ok(nativeTextLooksLikeProtocol(LONG_NATIVE_OGONEK));
assert.ok(!nativeTextLooksLikeProtocol("Zlecenie transportowe nr: 1\nPrzewoznik: X\nLista odebranych plomb:\n1. 700000000340087\n"));
// luźne słowa kluczowe bez poprawnego wzorca "Zlecenie transportowe nr: NNN" → odrzuć
const FAKE_KW = `${"x".repeat(130)}\nzlecenie transportowe Przewoznik: X Lista odebranych plomb: brak numeru\n`;
assert.ok(!nativeTextLooksLikeProtocol(FAKE_KW), "brak RE_ZLECENIE — nie powinno przejść");

assert.ok(nativeTextHasListaPlomb("Lista odebranych plomb:\n1. x"));
assert.ok(nativeTextHasListaPlomb("Lista o debranych plomb:\n1. x"));
assert.ok(nativeTextHasListaPlomb("Lista oderbranych plomby:\n1. x"));
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

assert.ok(!roiOcrTextSuggestsHandwritingNoise("12345678"));
assert.ok(!roiOcrTextSuggestsHandwritingNoise("Lista 1."));
assert.ok(roiOcrTextSuggestsHandwritingNoise(`ACME ${"#".repeat(25)}`));
const qHand = protocolReadoutQuality(p, {
  ocrRegionConfidence: { numer_zlecenia: 90, przewoznik: 90, lista_plomb: 90 },
  roiOcrRawTexts: {
    numer_zlecenia: "42",
    przewoznik: "Firma OK Sp z oo",
    lista_plomb: `Lista odebranych plomb:\n1. 700000000340087\n${"§".repeat(20)}`,
  },
});
assert.ok(!qHand.ok);
assert.ok(qHand.issues.some((i) => i === "podejrzenie_odreczne_roi_lista_plomb"));
const qRawNoRoi = protocolReadoutQuality(p, {
  ocrMinConfidence: 90,
  confidenceMin: 50,
  roiOcrRawTexts: { lista_plomb: `1. 700000000340087\n${"§".repeat(40)}` },
});
assert.ok(!qRawNoRoi.issues.some((i) => /podejrzenie_odreczne/.test(i)));

assert.equal(OCR_CONFIDENCE_MIN, 55);
assert.equal(PLOMBA_LEN_EXCEL, 15);
assert.equal(PLOMBA_RAW_LEN_MIN, 12);
assert.equal(PLOMBA_RAW_LEN_MAX, 18);
assert.equal(ZLECENIE_LEN_MIN, 1);
assert.equal(ZLECENIE_LEN_MAX, 12);
assert.ok(isZlecenieFormatSample("42"));
assert.ok(isZlecenieFormatSample("123456"));         // 6 cyfr — maksimum bez roku
assert.ok(isZlecenieFormatSample("1460/2026"));      // format NNNN/RRRR (rzeczywiste skany)
assert.ok(!isZlecenieFormatSample("9".repeat(7)));   // >6 cyfr bez roku — za długi
assert.ok(!isZlecenieFormatSample("1460/202"));      // rok za krótki (3 cyfry)
assert.ok(!isZlecenieFormatSample(""));

const badZlec = parseProtocolText(SYNTH.replace("nr: 42", `nr: ${"9".repeat(7)}`));
assert.ok(badZlec.uwagi_parse.includes("zlecenie_format"));
assert.ok(!protocolStructuralOk(badZlec));
const qBadZlec = protocolReadoutQuality(badZlec);
assert.ok(!qBadZlec.ok);
assert.ok(qBadZlec.issues.includes("zlecenie_format"));

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

const listaOcrSpace = parseProtocolText(`
Zlecenie transportowe nr: 21
Przewoźnik: Z
Miejsce dostawy: W
Lista o debranych plomb:
1. 700000000340087
`);
assert.deepEqual(listaOcrSpace.plomby, ["700000000340087"]);

const listaOcrTypo = parseProtocolText(`
Zlecenie transportowe nr: 22
Przewoźnik: Z
Miejsce dostawy: W
Lista oderbranych plomb:
1. 700000000340087
`);
assert.deepEqual(listaOcrTypo.plomby, ["700000000340087"]);

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

// RE_PRZEWOZ_START: OCR spacja w słowie „Przewoźnik" (np. „Przew oznik")
const ocrSpaceCarrier = parseProtocolText(`
Zlecenie transportowe nr: 99
Przew oznik: Spedycja X Sp z oo
Miejsce dostawy: Y
Lista odebranych plomb:
1. 700000000340087
`);
assert.ok(ocrSpaceCarrier.przewoznik.includes("Spedycja"), "OCR spacja w Przewoźnik");

// RE_PRZEWOZ_START: bez ogonka „ó" (Przewoznik)
const asciiCarrier2 = parseProtocolText(`
Zlecenie transportowe nr: 100
Przewoznik: Transport ABC
Miejsce dostawy: Y
Lista odebranych plomb:
1. 700000000340087
`);
assert.ok(asciiCarrier2.przewoznik.includes("Transport ABC"));

// RE_ZLECENIE: numer z OCR spacją wewnątrz (np. „12 345" → „12345")
const ocrSpaceNr = parseProtocolText(`
Zlecenie transportowe nr: 12 345
Przewoznik: Firma
Miejsce dostawy: X
Lista odebranych plomb:
1. 700000000340087
`);
assert.equal(ocrSpaceNr.numer_zlecenia, "12345", "OCR spacja w numerze zlecenia");
assert.ok(isZlecenieFormatSample(ocrSpaceNr.numer_zlecenia));

// RE_ZLECENIE: numer z wieloma spacjami (np. „1 2 3")
const ocrSpaceNr2 = parseProtocolText(`
Zlecenie transportowe nr: 1 2 3
Przewoznik: Firma
Miejsce dostawy: X
Lista odebranych plomb:
1. 700000000340087
`);
assert.equal(ocrSpaceNr2.numer_zlecenia, "123");

// === Rzeczywiste skany CCF (kwiecień 2026) ===

// Format "NNNN/RRRR" — rzeczywisty format ze skanów (np. „1460/2026")
const ccrFormat = parseProtocolText(`
Zlecenie transportowe nr: 1460/2026
Przewoźnik: GPW Logistics S.A. ul. Książęca 4, 00-498 Warszawa
Miejsce dostawy: ZK SOKOŁÓW MŁP.
Lista obsługiwanych plomb:
1. 700000000258679
2. 700000000258304
3. 700000000258290
`);
assert.equal(ccrFormat.numer_zlecenia, "1460/2026", "numer zlecenia format NNNN/RRRR");
assert.ok(isZlecenieFormatSample(ccrFormat.numer_zlecenia), "isZlecenieFormatSample dla 1460/2026");
assert.ok(ccrFormat.przewoznik.includes("GPW Logistics"), "przewoźnik ze skanu CCF");
assert.equal(ccrFormat.plomby.length, 3, "plomby z 'Lista obsługiwanych plomb:'");
assert.ok(ccrFormat.uwagi_parse.length === 0, "brak błędów parsowania");

// RE_LISTA_PLOMB: "Lista obsługiwanych plomb:" — format ze skanów CCF
assert.ok(nativeTextHasListaPlomb("Lista obsługiwanych plomb:\n1. 700000000258679"));
assert.ok(nativeTextHasListaPlomb("Lista obslugiwanych plomb:"), "bez ogonka ł");
assert.ok(nativeTextHasListaPlomb("Lista obstugiwanych plomby:"), "błąd OCR 'l→t'");

// Format NNNN/RRRR z błędną spacją OCR: „1 460/2026" → „1460/2026"
const ccrSpaceNr = parseProtocolText(`
Zlecenie transportowe nr: 1 460/2026
Przewoznik: Firma X
Miejsce dostawy: Y
Lista obsługiwanych plomb:
1. 700000000340087
`);
assert.equal(ccrSpaceNr.numer_zlecenia, "1460/2026", "OCR spacja w numerze NNNN/RRRR");

console.log("protocol_parse_selftest: OK");
