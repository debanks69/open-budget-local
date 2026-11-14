// Bank import (OFX) and learned rules. Same logic as src/open_budget/ofx.py
// and the import services of the server app.
//
// Account identifiers (BANKACCTFROM) are never read.

import { parseCents } from "./money.js";
import { IMPORT_ID } from "./categories.js";

/** Decode the file bytes: French banks use Windows-1252. */
export function decodeOfx(bytes) {
  const head = new TextDecoder("ascii").decode(bytes.slice(0, 500));
  const encoding = /CHARSET:1252|windows-1252/i.test(head) ? "windows-1252" : "utf-8";
  return new TextDecoder(encoding).decode(bytes);
}

function value(block, tag) {
  // SGML: <TAG>value (no closing tag). XML: <TAG>value</TAG>.
  const match = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`));
  return match ? match[1].trim() : "";
}

/** Return one list of lines per account statement. Throw on a bad file. */
export function parseOfx(text) {
  if (!text.includes("<OFX>")) throw new Error("Ce fichier n'est pas un relevé OFX.");
  const statements = text.split("<STMTRS>").slice(1).map((block) =>
    block.split("<STMTTRN>").slice(1).map((trn) => {
      const posted = value(trn, "DTPOSTED");
      if (!/^\d{8}/.test(posted)) throw new Error("Date illisible dans le fichier.");
      const raw = value(trn, "TRNAMT");
      const negative = raw.startsWith("-");
      const cents = parseCents(raw.replace(/^[-+]/, ""));
      return {
        date: `${posted.slice(0, 4)}-${posted.slice(4, 6)}-${posted.slice(6, 8)}`,
        amountCents: negative ? -cents : cents,
        fitid: value(trn, "FITID"),
        label: [value(trn, "NAME"), value(trn, "MEMO")].filter(Boolean).join(" "),
      };
    }));
  if (!statements.length) throw new Error("Aucun relevé de compte dans le fichier.");
  return statements;
}

/** Same merchant, same key: upper case, no accents, digits or punctuation. */
export function labelKey(label) {
  return label
    .normalize("NFD")
    .replace(/[^\x00-\x7f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 1)
    .join(" ")
    .slice(0, 200);
}

const ruleKey = (kind, key) => `${kind}|${key}`;

/**
 * Turn bank lines into new operations. Skip lines already imported.
 * rules: { "expense|KEY": categoryId }. Return { operations, skipped, classified }.
 */
export function importLines(existing, lines, rules, now = new Date()) {
  const known = new Set(existing.map((op) => op.importRef).filter(Boolean));
  const operations = [];
  let skipped = 0;
  let classified = 0;
  for (const line of lines) {
    // FITID is unique per account only, and the app has no accounts.
    const ref = `${line.fitid}|${line.date}|${line.amountCents}`;
    if (known.has(ref) || line.amountCents === 0) {
      skipped += 1;
      continue;
    }
    known.add(ref);
    const type = line.amountCents < 0 ? "expense" : "income";
    const ruled = rules[ruleKey(type, labelKey(line.label))];
    if (ruled) classified += 1;
    operations.push({
      id: crypto.randomUUID(),
      date: line.date,
      type,
      amountCents: Math.abs(line.amountCents),
      categoryId: ruled || IMPORT_ID[type],
      comment: "",
      label: line.label.slice(0, 200),
      importRef: ref,
      isPro: false,
      reimbursementStatus: null,
      createdAt: now.toISOString(),
    });
  }
  return { operations, skipped, classified };
}

const isImported = (op) => op.categoryId === IMPORT_ID[op.type];

/** Operations in the import category, grouped by label key, biggest first. */
export function groupsToClassify(operations) {
  const groups = new Map();
  for (const op of operations.filter(isImported)) {
    const key = ruleKey(op.type, labelKey(op.label || ""));
    const group = groups.get(key) || { kind: op.type, key: labelKey(op.label || ""), example: op.label || "(sans libellé)", count: 0, totalCents: 0 };
    group.count += 1;
    group.totalCents += op.amountCents;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.totalCents - a.totalCents);
}

/** Classify a group: return the changed operations and the new rules. */
export function classifyGroup(operations, rules, kind, key, categoryId) {
  const changed = operations
    .filter((op) => op.type === kind && isImported(op) && labelKey(op.label || "") === key)
    .map((op) => ({ ...op, categoryId }));
  return { changed, rules: { ...rules, [ruleKey(kind, key)]: categoryId } };
}
