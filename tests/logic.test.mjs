// Run: node --test local/tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCents, formatEur } from "../js/money.js";
import { validateImport, buildExport } from "../js/backup.js";
import { topCategories } from "../js/categories.js";

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
  categoryId: "logement/energie", isPro: true, reimbursementStatus: "pending", createdAt: "x",
};

test("export round trip and import validation", () => {
  assert.deepEqual(validateImport(buildExport([op]))[0], { ...op, comment: "" });
  assert.throws(() => validateImport({ ...buildExport([op]), format: "other" }));
  assert.throws(() => validateImport(buildExport([{ ...op, amountCents: 12.5 }])));
  assert.throws(() => validateImport(buildExport([op, op])), /Identifiant/);
  assert.throws(() => validateImport(buildExport([{ ...op, categoryId: "nope" }])));
});

test("topCategories puts most used first, then fills with defaults", () => {
  const ops = ["divers", "divers", "sante"].map((categoryId) => ({ ...op, categoryId }));
  const top = topCategories(ops, "expense");
  assert.deepEqual(top.slice(0, 3).map((c) => c.id), ["divers", "sante", "courses"]);
  assert.equal(top.length, 8);
});
