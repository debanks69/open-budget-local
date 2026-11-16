// Run: node --test local/tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCents, formatEur } from "../js/money.js";
import { validateImport, buildExport, DEFAULT_ACCOUNT } from "../js/backup.js";
import {
  accountBalance, balancesByAccount, kindTotal, monthSummary, shiftMonth,
  projectSaved, projectProgress, unassignedCents,
} from "../js/ledger.js";
import { topCategories, currentRules, LEGACY_IDS, BY_ID } from "../js/categories.js";

test("parseCents reads French and English input without floats", () => {
  assert.equal(parseCents("12"), 1200);
  assert.equal(parseCents("12,5"), 1250);
  assert.equal(parseCents("1 234.56 €"), 123456);
  assert.equal(parseCents("0,07"), 7);
  assert.throws(() => parseCents("1,234"));
  assert.throws(() => parseCents(""));
  assert.throws(() => parseCents("-3"));
});

test("formatEur uses French style", () => {
  assert.equal(formatEur(123456), "1 234,56 €");
  assert.equal(formatEur(-500), "-5 €");
  assert.equal(formatEur(1250, true), "+12,50 €");
});

const op = {
  id: "a", date: "2026-11-13", type: "expense", amountCents: 1250, accountId: "compte-courant",
  categoryId: "charges-fixes/electricite", isPro: true, reimbursementStatus: "pending", createdAt: "x",
};
const clean = { toAccountId: null, comment: "", label: "", importRef: null, reimbursedById: null };
const v2 = (operations, extra = {}) => buildExport({ accounts: [DEFAULT_ACCOUNT], operations, ...extra });
/** A file of the first format: operations only, no accounts. */
const v1 = (operations) => ({ format: "open-budget-local", version: 1, operations: operations.map(({ accountId, ...o }) => o) });

test("export round trip and import validation", () => {
  assert.deepEqual(validateImport(v2([op])).operations[0], { ...op, ...clean });
  assert.throws(() => validateImport({ ...v2([op]), format: "other" }));
  assert.throws(() => validateImport(v2([{ ...op, amountCents: 12.5 }])));
  assert.throws(() => validateImport(v2([op, op])), /Identifiant/);
  assert.throws(() => validateImport(v2([{ ...op, categoryId: "nope" }])));
  assert.throws(() => validateImport(v2([{ ...op, accountId: "nope" }])), /Compte inconnu/);
});

test("a version 1 file goes to the default account", () => {
  const data = validateImport(v1([op]));
  assert.deepEqual(data.accounts, [DEFAULT_ACCOUNT]);
  assert.equal(data.operations[0].accountId, DEFAULT_ACCOUNT.id);
  assert.deepEqual(data.projects, []);
});

test("projects, contributions and purchases survive the round trip", () => {
  const project = { id: "p", name: "Japon", description: "", targetCents: 300000, targetDate: null };
  const contribution = { id: "c", projectId: "p", date: "2026-11-01", amountCents: 5000, accountId: null, operationId: "a", comment: "" };
  const purchase = { id: "u", name: "Sac", categoryId: null, estimatedCents: 8000, priority: "high", comment: "", status: "planned", projectId: "p" };
  const data = validateImport(v2([op], { projects: [project], contributions: [contribution], purchases: [purchase] }));
  assert.deepEqual(data.projects, [project]);
  assert.deepEqual(data.contributions, [contribution]);
  assert.deepEqual(data.purchases, [purchase]);
  assert.throws(() => validateImport(v2([op], { projects: [], contributions: [contribution] })), /Projet inconnu/);
});

test("balances, kinds and the monthly summary follow the server rules", () => {
  const livret = { id: "l", name: "Livret", kind: "savings", initialBalanceCents: 1000, archived: false };
  const ops = [
    { ...op, type: "income", amountCents: 200000, isPro: false, categoryId: null },
    { ...op, id: "b", amountCents: 50000, isPro: false },
    { ...op, id: "c", amountCents: 3000 }, // pro: out of the summary, still in the balance
    { ...op, id: "d", type: "transfer", amountCents: 10000, toAccountId: "l", isPro: false },
  ];
  const balances = balancesByAccount([DEFAULT_ACCOUNT, livret], ops);
  assert.equal(accountBalance(DEFAULT_ACCOUNT, ops), 200000 - 50000 - 3000 - 10000);
  assert.equal(kindTotal(balances, "savings"), 11000);
  assert.deepEqual(monthSummary(ops, "2026-11"), { expensesCents: 50000, incomeCents: 200000, savingsRate: 75 });
  assert.equal(monthSummary(ops, "2026-10").savingsRate, null);
});

test("projects: saved amount, progress and free part of an operation", () => {
  const project = { id: "p", targetCents: 10000 };
  const contributions = [{ projectId: "p", operationId: "a", amountCents: 4000 }, { projectId: "q", amountCents: 1 }];
  assert.equal(projectSaved(project, contributions), 4000);
  assert.equal(projectProgress(project, 4000), 40);
  assert.equal(projectProgress(project, 20000), 100);
  assert.equal(unassignedCents({ id: "a", amountCents: 5000 }, contributions), 1000);
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
});

test("topCategories puts most used first, then fills with leaf categories", () => {
  const ops = ["perso/sport", "perso/sport", "essentiel/sante", "import-depense"]
    .map((categoryId) => ({ ...op, categoryId }));
  const top = topCategories(ops, "expense");
  assert.deepEqual(top.slice(0, 3).map((c) => c.id), ["perso/sport", "essentiel/sante", "charges-fixes/logement"]);
  assert.equal(top.length, 8);
  assert.ok(top.every((c) => !c.id.startsWith("import") && c.id !== "charges-fixes"));
});

test("old category ids are translated on import", () => {
  const old = v1([{ ...op, categoryId: "logement/energie" }, { ...op, id: "b", categoryId: "divers" }]);
  assert.deepEqual(validateImport(old).operations.map((o) => o.categoryId), ["charges-fixes/electricite", null]);
  for (const id of Object.values(LEGACY_IDS)) assert.ok(id === null || BY_ID.has(id), id);
});

test("old Charges goes back to categorise, and its rules are dropped", () => {
  const file = v1([{ ...op, categoryId: "charges-fixes/charges" }]);
  assert.equal(validateImport(file).operations[0].categoryId, "import-depense");
  const rules = { "expense|EDF": "charges-fixes/charges", "expense|SFR": "charges-fixes/internet-box" };
  assert.deepEqual(currentRules(rules), { "expense|SFR": "charges-fixes/internet-box" });
});
