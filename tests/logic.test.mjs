// Run: node --test local/tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCents, formatEur } from "../js/money.js";
import { validateImport, buildExport } from "../js/backup.js";
import { topCategories, LEGACY_IDS, BY_ID } from "../js/categories.js";

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
  id: "a", date: "2026-11-13", type: "expense", amountCents: 1250,
  categoryId: "charges-fixes/charges", isPro: true, reimbursementStatus: "pending", createdAt: "x",
};

test("export round trip and import validation", () => {
  assert.deepEqual(validateImport(buildExport([op]))[0], { ...op, comment: "", label: "", importRef: null });
  assert.throws(() => validateImport({ ...buildExport([op]), format: "other" }));
  assert.throws(() => validateImport(buildExport([{ ...op, amountCents: 12.5 }])));
  assert.throws(() => validateImport(buildExport([op, op])), /Identifiant/);
  assert.throws(() => validateImport(buildExport([{ ...op, categoryId: "nope" }])));
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
  const old = buildExport([{ ...op, categoryId: "logement/energie" }, { ...op, id: "b", categoryId: "divers" }]);
  assert.deepEqual(validateImport(old).map((o) => o.categoryId), ["charges-fixes/charges", null]);
  for (const id of Object.values(LEGACY_IDS)) assert.ok(id === null || BY_ID.has(id), id);
});
