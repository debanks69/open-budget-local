// Run: node --test local/tests/*.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeOfx, parseOfx, labelKey, importLines, groupsToClassify, classifyGroup } from "../js/bank.js";

const OFX = `OFXHEADER:100
DATA:OFXSGML
CHARSET:1252

<OFX><BANKMSGSRSV1>
<STMTTRNRS><STMTRS><BANKACCTFROM><ACCTTYPE>CHECKING</BANKACCTFROM><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261102<TRNAMT>-12.50<FITID>A1<NAME>CARREFOUR 1234 PARIS
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261105<TRNAMT>-30.00<FITID>A2<NAME>CARREFOUR 5678 PARIS
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261101<TRNAMT>1800.00<FITID>A3<NAME>VIR SALAIRE ACME
</BANKTRANLIST></STMTRS></STMTTRNRS>
<STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261103<TRNAMT>-4.20<FITID>B1<NAME>BOULANGERIE ÉTOILE
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

// Windows-1252 bytes, as French banks send them.
const BYTES = Uint8Array.from(OFX, (ch) => ch.charCodeAt(0));

test("parseOfx reads both statements and the 1252 encoding", () => {
  const statements = parseOfx(decodeOfx(BYTES));
  assert.deepEqual(statements.map((s) => s.length), [3, 1]);
  assert.deepEqual(statements[0][0], { date: "2026-11-02", amountCents: -1250, fitid: "A1", label: "CARREFOUR 1234 PARIS" });
  assert.equal(statements[1][0].label, "BOULANGERIE ÉTOILE");
  assert.throws(() => parseOfx("hello"), /pas un relevé OFX/);
});

test("labelKey matches the Python version", () => {
  assert.equal(labelKey("CARREFOUR 1234 PARIS"), "CARREFOUR PARIS");
  assert.equal(labelKey("Boulangerie Étoile"), "BOULANGERIE ETOILE");
});

test("import skips duplicates, classify learns a rule", () => {
  const lines = parseOfx(decodeOfx(BYTES)).flat();
  const first = importLines([], lines, {});
  assert.equal(first.operations.length, 4);
  assert.ok(first.operations.every((op) => op.categoryId.startsWith("import-")));
  assert.equal(importLines(first.operations, lines, {}).skipped, 4);

  const groups = groupsToClassify(first.operations);
  assert.deepEqual(groups[0], { kind: "expense", key: "CARREFOUR PARIS", example: "CARREFOUR 1234 PARIS", count: 2, totalCents: 4250 });

  const { changed, rules } = classifyGroup(first.operations, {}, "expense", "CARREFOUR PARIS", "essentiel/courses");
  assert.equal(changed.length, 2);
  const next = importLines([], lines, rules);
  assert.equal(next.classified, 2);
});
