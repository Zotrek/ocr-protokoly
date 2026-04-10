import assert from "node:assert/strict";
import { humanizePdfError } from "../pdf_errors.mjs";

assert.match(humanizePdfError(new Error("x")), /x/);
assert.match(
  humanizePdfError(Object.assign(new Error("bad"), { name: "PasswordException" })),
  /hasłem/i
);
assert.match(
  humanizePdfError(Object.assign(new Error("Invalid PDF"), { name: "InvalidPDFException" })),
  /nie PDF|odczytać/i
);
assert.match(
  humanizePdfError(Object.assign(new Error(""), { name: "MissingPDFException" })),
  /pusty|Brak/i
);
assert.match(humanizePdfError("raw"), /raw/);

console.log("pdf_errors_selftest: OK");
