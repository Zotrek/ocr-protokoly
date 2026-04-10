/**
 * Zrozumiałe komunikaty błędów pdf.js / przeglądarki (bez skanów — czysta logika).
 * @param {unknown} err
 */
export function humanizePdfError(err) {
  if (err instanceof Error) {
    const name = err.name;
    const msg = err.message || "";
    if (name === "PasswordException" || /password|encrypted/i.test(msg)) {
      return "PDF zabezpieczony hasłem (nieobsługiwane w tym POC).";
    }
    if (name === "InvalidPDFException" || /invalid pdf|invalidPDF/i.test(msg)) {
      return "Nie można odczytać pliku jako PDF (uszkodzony plik lub to nie PDF).";
    }
    if (name === "MissingPDFException" || /missing pdf/i.test(msg)) {
      return "Brak lub pusty dokument PDF.";
    }
    if (name === "UnexpectedResponseException") {
      return "Błąd przy wczytywaniu PDF (sieć lub odpowiedź serwera).";
    }
    if (name === "AbortException") {
      return "Przerwano wczytywanie PDF.";
    }
    return msg || name || "Błąd PDF.";
  }
  return String(err);
}
