/**
 * Uruchom: node tests/roi_pick_selftest.mjs (katalog roboczy: OCR_protokoly/)
 */
import assert from "node:assert/strict";
import { pickRegionsNormForViewport, ROI_DEFAULT_FALLBACK } from "../roi_ocr.mjs";

const cfg = {
  ...ROI_DEFAULT_FALLBACK,
  regions_norm: { ...ROI_DEFAULT_FALLBACK.regions_norm },
  regions_norm_narrow: { ...ROI_DEFAULT_FALLBACK.regions_norm_narrow },
};

const narrow = cfg.regions_norm_narrow;
const normal = cfg.regions_norm;

assert.equal(
  pickRegionsNormForViewport(cfg, 578, 824),
  narrow,
  "skan ~578 pt szerokości → regions_norm_narrow"
);
assert.equal(
  pickRegionsNormForViewport(cfg, 595, 842),
  normal,
  "A4 ~595 pt → regions_norm"
);

console.log("roi_pick_selftest: OK");
