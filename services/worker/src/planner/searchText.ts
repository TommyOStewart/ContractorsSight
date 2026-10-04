// Turns free text (a capture, or a lookup query) into search terms. Shared by the Postgres search
// and the eval fixture so both behave the same way.

const STOP_WORDS = new Set([
  "st", "ave", "rd", "ln", "ct", "dr", "the", "and", "job", "jobs", "for", "new", "need", "needs",
  "with", "from", "that", "this", "his", "her", "him", "she", "they", "them", "about", "today", "tomorrow",
  "said", "called", "wants", "want", "add", "get", "put", "make", "also", "just", "like", "yeah", "okay",
]);

/** Lowercased words worth matching on: 3+ letters, not a stop word, not a bare number, possessives removed. */
export function searchWords(text: string): string[] {
  const words = text
    .toLowerCase()
    // "Maria's" should match "Maria"; keep inner apostrophes ("O'Neil").
    .replace(/['’]s\b/g, "")
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w) && !/^\d+$/.test(w));
  return [...new Set(words)];
}

/** Phone-number-like runs of 7+ digits (dashes allowed), as bare digits. */
export function phoneDigits(text: string): string[] {
  return (text.match(/[\d-]{7,}/g) ?? []).map((p) => p.replace(/\D/g, "")).filter((d) => d.length >= 7);
}
