// JSON export and import. The export file is the only backup of the data.

import { BY_ID } from "./categories.js";

export const FORMAT = "open-budget-local";
export const FORMAT_VERSION = 1;

const TYPES = new Set(["expense", "income"]);
const STATUSES = new Set([null, "pending", "reimbursed"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function buildExport(operations, now = new Date()) {
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: now.toISOString(),
    operations,
  };
}

export function exportFileName(now = new Date()) {
  // Local time, so the name matches the clock of the phone.
  const pad = (n) => String(n).padStart(2, "0");
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `open-budget-${day}-${pad(now.getHours())}h${pad(now.getMinutes())}.json`;
}

/** Check a parsed export file. Return the clean operation list or throw. */
export function validateImport(data) {
  if (!data || data.format !== FORMAT) throw new Error("Ce fichier n'est pas une sauvegarde Open Budget.");
  if (data.version !== FORMAT_VERSION) throw new Error(`Version de sauvegarde inconnue : ${data.version}`);
  if (!Array.isArray(data.operations)) throw new Error("Sauvegarde invalide : opérations manquantes.");
  const ids = new Set();
  return data.operations.map((op, i) => {
    const where = `opération n° ${i + 1}`;
    if (typeof op.id !== "string" || !op.id || ids.has(op.id)) throw new Error(`Identifiant invalide (${where}).`);
    ids.add(op.id);
    if (!TYPES.has(op.type)) throw new Error(`Type invalide (${where}).`);
    if (!Number.isSafeInteger(op.amountCents) || op.amountCents <= 0) throw new Error(`Montant invalide (${where}).`);
    if (typeof op.date !== "string" || !DATE_RE.test(op.date)) throw new Error(`Date invalide (${where}).`);
    if (op.categoryId != null && !BY_ID.has(op.categoryId)) throw new Error(`Catégorie inconnue (${where}).`);
    const status = op.reimbursementStatus ?? null;
    if (!STATUSES.has(status)) throw new Error(`Statut de remboursement invalide (${where}).`);
    // Keep known fields only.
    return {
      id: op.id,
      date: op.date,
      type: op.type,
      amountCents: op.amountCents,
      categoryId: op.categoryId ?? null,
      comment: typeof op.comment === "string" ? op.comment.slice(0, 500) : "",
      isPro: Boolean(op.isPro),
      reimbursementStatus: status,
      createdAt: typeof op.createdAt === "string" ? op.createdAt : new Date().toISOString(),
    };
  });
}
