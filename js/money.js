// Convert between user text and integer cents. Same rules as
// src/open_budget/money.py. No floats: the text is split on the
// decimal separator.

/** Parse '12', '12,5', '1 234.56' or '12 €' into cents. Throw on bad input. */
export function parseCents(text) {
  const cleaned = String(text).replace(/[€\s  ]/g, "").replace(",", ".");
  if (!cleaned) throw new Error("Montant vide");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) throw new Error(`Montant invalide : ${text}`);
  const euros = Number(match[1]);
  const cents = Number((match[2] || "").padEnd(2, "0"));
  const total = euros * 100 + cents;
  if (!Number.isSafeInteger(total)) throw new Error(`Montant invalide : ${text}`);
  return total;
}

/** Format cents as '1 234,56 €' (French style). */
export function formatEur(cents, sign = false) {
  const prefix = cents < 0 ? "-" : sign && cents > 0 ? "+" : "";
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100);
  const rest = abs % 100;
  const grouped = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return rest
    ? `${prefix}${grouped},${String(rest).padStart(2, "0")} €`
    : `${prefix}${grouped} €`;
}
