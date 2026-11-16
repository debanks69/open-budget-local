// JSON export and import. The export file is the only backup of the data.
//
// Version 2 (2026-11-14) adds accounts, projects, contributions and
// purchases. A version 1 file has operations only: they go to the default
// current account.

import { BY_ID, currentCategoryId, currentRules } from "./categories.js";
import { ACCOUNT_KINDS, PURCHASE_STATUS, PRIORITY } from "./ledger.js";

export const FORMAT = "open-budget-local";
export const FORMAT_VERSION = 2;

/** Created at first start, and for the operations of a version 1 file. */
export const DEFAULT_ACCOUNT = {
  id: "compte-courant", name: "Compte courant", kind: "current", initialBalanceCents: 0, archived: false,
};

const TYPES = new Set(["expense", "income", "transfer"]);
const STATUSES = new Set([null, "pending", "reimbursed"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function buildExport(data, now = new Date(), rules = {}) {
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    exportedAt: now.toISOString(),
    accounts: data.accounts || [],
    operations: data.operations || [],
    projects: data.projects || [],
    contributions: data.contributions || [],
    purchases: data.purchases || [],
    rules,
  };
}

export function exportFileName(now = new Date()) {
  // Local time, so the name matches the clock of the phone.
  const pad = (n) => String(n).padStart(2, "0");
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `open-budget-${day}-${pad(now.getHours())}h${pad(now.getMinutes())}.json`;
}

const str = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");
const optDate = (value) => (typeof value === "string" && DATE_RE.test(value) ? value : null);

function checkCents(value, where, allowZero = false, allowNegative = false) {
  const ok = Number.isSafeInteger(value) && (allowNegative || value > 0 || (allowZero && value === 0));
  if (!ok) throw new Error(`Montant invalide (${where}).`);
  return value;
}

function uniqueIds(list, label) {
  if (!Array.isArray(list)) throw new Error(`Sauvegarde invalide : ${label} manquants.`);
  const ids = new Set();
  for (const [i, item] of list.entries()) {
    if (typeof item?.id !== "string" || !item.id || ids.has(item.id)) {
      throw new Error(`Identifiant invalide (${label} n° ${i + 1}).`);
    }
    ids.add(item.id);
  }
  return ids;
}

function category(id, where) {
  const categoryId = id == null ? null : currentCategoryId(id);
  if (categoryId != null && !BY_ID.has(categoryId)) throw new Error(`Catégorie inconnue (${where}).`);
  return categoryId;
}

/** Check a parsed export file. Return clean data for each store, or throw. */
export function validateImport(data) {
  if (!data || data.format !== FORMAT) throw new Error("Ce fichier n'est pas une sauvegarde Open Budget.");
  if (data.version !== 1 && data.version !== FORMAT_VERSION) {
    throw new Error(`Version de sauvegarde inconnue : ${data.version}`);
  }
  const v1 = data.version === 1;
  const rawAccounts = v1 ? [DEFAULT_ACCOUNT] : data.accounts;
  const accountIds = uniqueIds(rawAccounts, "comptes");
  const accounts = rawAccounts.map((a, i) => {
    if (!Object.hasOwn(ACCOUNT_KINDS, a.kind)) throw new Error(`Type de compte invalide (compte n° ${i + 1}).`);
    return {
      id: a.id,
      name: str(a.name, 100) || "Compte",
      kind: a.kind,
      initialBalanceCents: checkCents(a.initialBalanceCents ?? 0, `compte n° ${i + 1}`, true, true),
      archived: Boolean(a.archived),
    };
  });

  const opIds = uniqueIds(data.operations, "opérations");
  const operations = data.operations.map((op, i) => {
    const where = `opération n° ${i + 1}`;
    if (!TYPES.has(op.type)) throw new Error(`Type invalide (${where}).`);
    checkCents(op.amountCents, where);
    if (typeof op.date !== "string" || !DATE_RE.test(op.date)) throw new Error(`Date invalide (${where}).`);
    const accountId = v1 ? DEFAULT_ACCOUNT.id : op.accountId;
    if (!accountIds.has(accountId)) throw new Error(`Compte inconnu (${where}).`);
    const toAccountId = op.type === "transfer" ? op.toAccountId : null;
    if (op.type === "transfer" && (!accountIds.has(toAccountId) || toAccountId === accountId)) {
      throw new Error(`Compte destination invalide (${where}).`);
    }
    const status = op.type === "transfer" ? null : (op.reimbursementStatus ?? null);
    if (!STATUSES.has(status)) throw new Error(`Statut de remboursement invalide (${where}).`);
    // Keep known fields only.
    return {
      id: op.id,
      date: op.date,
      type: op.type,
      amountCents: op.amountCents,
      accountId,
      toAccountId,
      categoryId: op.type === "transfer" ? null : category(op.categoryId, where),
      comment: str(op.comment, 500),
      label: str(op.label, 200),
      importRef: typeof op.importRef === "string" ? op.importRef.slice(0, 200) : null,
      isPro: op.type !== "transfer" && Boolean(op.isPro),
      reimbursementStatus: status,
      reimbursedById: opIds.has(op.reimbursedById) ? op.reimbursedById : null,
      createdAt: typeof op.createdAt === "string" ? op.createdAt : new Date().toISOString(),
    };
  });

  const rawProjects = v1 ? [] : data.projects;
  const projectIds = uniqueIds(rawProjects, "projets");
  const projects = rawProjects.map((p, i) => ({
    id: p.id,
    name: str(p.name, 100) || "Projet",
    description: str(p.description, 500),
    targetCents: checkCents(p.targetCents, `projet n° ${i + 1}`, true),
    targetDate: optDate(p.targetDate),
  }));

  const rawContributions = v1 ? [] : data.contributions;
  uniqueIds(rawContributions, "versements");
  const contributions = rawContributions.map((c, i) => {
    const where = `versement n° ${i + 1}`;
    if (!projectIds.has(c.projectId)) throw new Error(`Projet inconnu (${where}).`);
    if (!optDate(c.date)) throw new Error(`Date invalide (${where}).`);
    return {
      id: c.id,
      projectId: c.projectId,
      date: c.date,
      amountCents: checkCents(c.amountCents, where),
      accountId: accountIds.has(c.accountId) ? c.accountId : null,
      operationId: opIds.has(c.operationId) ? c.operationId : null,
      comment: str(c.comment, 200),
    };
  });

  const rawPurchases = v1 ? [] : data.purchases;
  uniqueIds(rawPurchases, "achats");
  const purchases = rawPurchases.map((p, i) => {
    const where = `achat n° ${i + 1}`;
    if (!Object.hasOwn(PURCHASE_STATUS, p.status)) throw new Error(`Statut invalide (${where}).`);
    return {
      id: p.id,
      name: str(p.name, 100) || "Achat",
      categoryId: category(p.categoryId, where),
      estimatedCents: checkCents(p.estimatedCents ?? 0, where, true),
      priority: Object.hasOwn(PRIORITY, p.priority) ? p.priority : null,
      comment: str(p.comment, 500),
      status: p.status,
      projectId: projectIds.has(p.projectId) ? p.projectId : null,
    };
  });

  return { accounts, operations, projects, contributions, purchases };
}

/** Check the learned rules of an export file. Files of the first version have none. */
export function validateRules(data) {
  const rules = currentRules(data.rules);
  for (const key of Object.keys(rules)) if (!/^(expense|income)\|/.test(key)) delete rules[key];
  return rules;
}
