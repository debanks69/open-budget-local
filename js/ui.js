// Helpers shared by the screens: HTML escaping, dates, rows, form options.

import * as db from "./db.js";
import { formatEur, parseCents } from "./money.js";
import { BY_ID, TREE } from "./categories.js";
import { isImported } from "./bank.js";

export const view = document.getElementById("view");
const flashBox = document.getElementById("flash");

export const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
  "août", "septembre", "octobre", "novembre", "décembre"];
export const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.",
  "août", "sept.", "oct.", "nov.", "déc."];

export function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function isoDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const thisMonth = () => isoDate().slice(0, 7);

export function shortDate(iso) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

export function frDate(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function monthLabel(ym) {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`.replace(/^./, (c) => c.toUpperCase());
}

/** "Aujourd'hui", "Hier" or "12 novembre 2026", like the server app. */
export function dayLabel(iso) {
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (iso === isoDate(today)) return "Aujourd'hui";
  if (iso === isoDate(yesterday)) return "Hier";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function flash(message, isError = false) {
  flashBox.textContent = message;
  flashBox.classList.toggle("error-flash", isError);
  flashBox.hidden = false;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => { flashBox.hidden = true; }, 3500);
}

export const newId = () => crypto.randomUUID();

/** All data in memory: a few thousand records, cheap to read at each screen. */
export async function loadAll() {
  const [accounts, operations, projects, contributions, purchases] = await Promise.all(
    db.DATA_STORES.map((name) => db.all(name)));
  return { accounts, operations, projects, contributions, purchases };
}

export const byId = (list) => new Map(list.map((x) => [x.id, x]));

export function catLabel(op) {
  // Not classified yet: show the bank label and a "?".
  if (isImported(op)) return { icon: "?", name: op.label || "Sans libellé", unknown: true };
  const cat = BY_ID.get(op.categoryId);
  if (!cat) return { icon: "•", name: "Sans catégorie" };
  return { icon: cat.icon || BY_ID.get(cat.parentId)?.icon || "•", name: cat.name };
}

export function fullCategoryName(id) {
  const cat = BY_ID.get(id);
  if (!cat) return "Sans catégorie";
  return cat.parentId ? `${BY_ID.get(cat.parentId).name} › ${cat.name}` : cat.name;
}

export function signedAmount(op) {
  if (op.type === "expense") return formatEur(-op.amountCents);
  if (op.type === "income") return formatEur(op.amountCents, true);
  return formatEur(op.amountCents);
}

/** One operation, same markup as the server macro op_row. */
export function opRow(op, accounts) {
  const account = accounts.get(op.accountId);
  const tags = [
    op.isPro ? '<span class="tag pro">pro</span>' : "",
    op.reimbursementStatus === "pending" ? '<span class="tag warn">à rembourser</span>' : "",
    op.reimbursementStatus === "reimbursed" ? '<span class="tag ok">remboursé</span>' : "",
  ].join(" ");
  let icon;
  let title;
  let sub;
  let unknown = false;
  if (op.type === "transfer") {
    icon = "⇄";
    title = `${account?.name ?? "?"} → ${accounts.get(op.toAccountId)?.name ?? "?"}`;
    sub = op.comment || op.label || "";
  } else {
    ({ icon, name: title, unknown } = catLabel(op));
    sub = unknown ? account?.name : (op.comment || op.label || account?.name);
  }
  return `<a class="op-row" href="#/op/${op.id}">
    <span class="op-icon ${op.type}${unknown ? " unknown" : ""}"${unknown ? ' title="À catégoriser"' : ""}>${icon}</span>
    <span class="op-main"><strong>${esc(title)}</strong><small>${esc(sub)} ${tags}</small></span>
    <span class="op-amount ${op.type}">${signedAmount(op)}</span>
  </a>`;
}

/** Operations grouped under day headings, newest first. */
export function opsByDay(ops, accounts) {
  let lastDay = null;
  return ops.map((op) => {
    const day = op.date !== lastDay ? `<h3 class="day">${dayLabel(op.date)}</h3>` : "";
    lastDay = op.date;
    return day + opRow(op, accounts);
  }).join("");
}

export const newestFirst = (a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || "");

/**
 * A group (top-level category with sub-categories) is a heading, not a
 * choice. Filters pass `groupsSelectable` to select a whole group.
 */
export function categoryOptions(kind, selected = null, emptyLabel = "— Aucune —", withImport = true, groupsSelectable = false) {
  const tree = TREE[kind].filter((p) => withImport || p.name !== "Import");
  const option = (c, text) =>
    `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${text}</option>`;
  return `<option value="">${esc(emptyLabel)}</option>${tree.map((p) => {
    const children = p.children.map((c) => option(c, `${groupsSelectable ? "&nbsp;&nbsp;&nbsp;" : ""}${c.icon || p.icon} ${esc(c.name)}`)).join("");
    if (!p.children.length || groupsSelectable) return option(p, `${p.icon} ${esc(p.name)}`) + children;
    return `<optgroup label="${p.icon} ${esc(p.name)}">${children}</optgroup>`;
  }).join("")}`;
}

export function accountOptions(accounts, selected = null) {
  return accounts.map((a) =>
    `<option value="${a.id}" ${a.id === selected ? "selected" : ""}>${esc(a.name)}</option>`).join("");
}

export function progressBar(percent) {
  return `<div class="progress" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100">
    <div style="width: ${percent}%"></div></div>`;
}

/** Header with a back link, like the server pages under "Plus". */
export function header(title, back = null, extra = "") {
  const link = back ? `<a href="${back[0]}" class="back">‹ ${esc(back[1])}</a>` : "";
  return `<header class="top">${link}<h1>${esc(title)}</h1>${extra}</header>`;
}

/** Parse a form amount into cents. Raise an Error with a French message. */
export function formCents(value, { allowEmpty = false, allowNegative = false } = {}) {
  let text = String(value ?? "").trim();
  if (allowEmpty && !text) return 0;
  const negative = allowNegative && text.startsWith("-");
  if (negative) text = text.slice(1);
  const cents = parseCents(text);
  if (cents === 0 && !allowEmpty) throw new Error("Le montant doit être positif.");
  return negative ? -cents : cents;
}

/** Value for an amount input: "12,50" or "12". */
export function amountInput(cents) {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const rest = abs % 100;
  return `${sign}${Math.floor(abs / 100)}${rest ? `,${String(rest).padStart(2, "0")}` : ""}`;
}
