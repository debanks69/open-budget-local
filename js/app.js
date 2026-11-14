// Open Budget local: single page app, no backend. Routes are URL hashes.

import * as db from "./db.js";
import { parseCents, formatEur } from "./money.js";
import { TREE, BY_ID, topCategories, currentCategoryId } from "./categories.js";
import { buildExport, exportFileName, validateImport, validateRules } from "./backup.js";
import { decodeOfx, parseOfx, importLines, groupsToClassify, classifyGroup } from "./bank.js";

const view = document.getElementById("view");
const flashBox = document.getElementById("flash");
const BACKUP_WARN_DAYS = 7;
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
  "août", "septembre", "octobre", "novembre", "décembre"];

// --- Helpers -----------------------------------------------------------------

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function isoDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shortDate(iso) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function flash(message, isError = false) {
  flashBox.textContent = message;
  flashBox.classList.toggle("error-flash", isError);
  flashBox.hidden = false;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => { flashBox.hidden = true; }, 3500);
}

function catLabel(op) {
  const cat = BY_ID.get(op.categoryId);
  return cat ? { icon: cat.icon, name: cat.name } : { icon: "•", name: "Sans catégorie" };
}

function signedAmount(op) {
  return op.type === "expense" ? formatEur(-op.amountCents) : formatEur(op.amountCents, true);
}

function opRow(op, actions = "") {
  const { icon, name } = catLabel(op);
  const tags = [
    op.isPro ? '<span class="tag pro">pro</span>' : "",
    op.reimbursementStatus === "pending" ? '<span class="tag warn">à rembourser</span>' : "",
    op.reimbursementStatus === "reimbursed" ? '<span class="tag ok">remboursé</span>' : "",
  ].join("");
  return `<div class="op-row">
    <span class="op-icon ${op.type}">${icon}</span>
    <span class="op-main"><strong>${esc(name)}</strong>
      <small>${esc(op.comment || op.label || "") || shortDate(op.date)} ${tags}</small></span>
    <span class="op-amount ${op.type}">${signedAmount(op)}</span>
    ${actions}
  </div>`;
}

async function daysSinceExport() {
  const last = await db.getMeta("lastExportAt");
  if (!last) return null;
  return Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
}

// --- Quick entry -------------------------------------------------------------

async function renderAdd(type) {
  const ops = await db.allOperations();
  const top = topCategories(ops, type);
  const days = await daysSinceExport();
  const needBackup = ops.length > 0 && (days === null || days >= BACKUP_WARN_DAYS);
  const tree = TREE[type];

  view.innerHTML = `
    ${needBackup ? `<a class="tile warn backup-warn" href="#/backup">💾 ${
      days === null ? "Aucune sauvegarde" : `Dernière sauvegarde il y a ${days} jours`
    }. <u>Exporter maintenant</u></a>` : ""}
    <nav class="segmented" aria-label="Type">
      <a href="#/add/expense" class="${type === "expense" ? "active" : ""}">Dépense</a>
      <a href="#/add/income" class="${type === "income" ? "active" : ""}">Revenu</a>
    </nav>
    <form class="quick" id="quick" novalidate>
      <label class="amount ${type}">
        <span class="sr-only">Montant</span>
        <input name="amount" inputmode="decimal" placeholder="0" autocomplete="off" enterkeyhint="done">
        <span>€</span>
      </label>
      <label class="pro-toggle"><input type="checkbox" name="isPro">
        <span>💼 ${type === "expense" ? "Note de frais <small>pro, à rembourser</small>" : "Remboursement pro"}</span>
      </label>
      <p class="hint">Touche une catégorie pour enregistrer.</p>
      <div class="cat-grid">
        ${top.map((c) => `<button type="button" data-cat="${c.id}"><span>${c.icon}</span>${esc(c.name)}</button>`).join("")}
      </div>
      <details class="more-cats">
        <summary>Toutes les catégories</summary>
        ${tree.map((p) => `<div class="cat-group">
          <button type="button" data-cat="${p.id}" class="chip strong">${p.icon} ${esc(p.name)}</button>
          ${p.children.map((c) => `<button type="button" data-cat="${c.id}" class="chip">${esc(c.name)}</button>`).join("")}
        </div>`).join("")}
        <button type="button" data-cat="" class="chip">Sans catégorie</button>
      </details>
      <details class="options">
        <summary>Options (date, commentaire)</summary>
        <div class="stack">
          <label>Date <input type="date" name="date" value="${isoDate()}"></label>
          <label>Commentaire <input name="comment" maxlength="500"></label>
        </div>
      </details>
    </form>`;

  const form = view.querySelector("#quick");
  const amountInput = form.elements.amount;
  amountInput.focus();
  // Enter must not save with a random category.
  form.addEventListener("submit", (e) => e.preventDefault());
  form.addEventListener("click", async (e) => {
    const button = e.target.closest("button[data-cat]");
    if (!button) return;
    let amountCents;
    try {
      amountCents = parseCents(amountInput.value);
      if (amountCents <= 0) throw new Error("Le montant doit être positif.");
    } catch (error) {
      flash(error.message, true);
      amountInput.focus();
      return;
    }
    const isPro = form.elements.isPro.checked;
    const op = {
      id: crypto.randomUUID(),
      date: form.elements.date.value || isoDate(),
      type,
      amountCents,
      categoryId: button.dataset.cat || null,
      comment: form.elements.comment.value.trim(),
      isPro,
      reimbursementStatus: type === "expense" && isPro ? "pending" : null,
      createdAt: new Date().toISOString(),
    };
    await db.putOperation(op);
    const { icon, name } = catLabel(op);
    flash(`Enregistré : ${icon} ${name} ${signedAmount(op)}${isPro && type === "expense" ? " · note de frais" : ""}`);
    renderAdd(type);
  });
}

// --- Operations of the month -------------------------------------------------

function monthBounds(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return [`${ym}-01`, `${ym}-${String(last).padStart(2, "0")}`];
}

function shiftMonth(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function renderOps(ym) {
  const [start, end] = monthBounds(ym);
  const ops = (await db.operationsBetween(start, end))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  // Pro operations stay out of personal totals.
  const personal = ops.filter((o) => !o.isPro);
  const sum = (type) => personal.filter((o) => o.type === type).reduce((s, o) => s + o.amountCents, 0);
  const [y, m] = ym.split("-").map(Number);

  let lastDay = null;
  const rows = ops.map((op) => {
    const day = op.date !== lastDay ? `<p class="day">${shortDate(op.date)}</p>` : "";
    lastDay = op.date;
    return day + opRow(op, `<button class="link danger" data-delete="${op.id}" aria-label="Supprimer">🗑</button>`);
  }).join("");

  view.innerHTML = `
    <div class="top"><h1>Opérations</h1></div>
    <div class="month-nav">
      <a href="#/ops/${shiftMonth(ym, -1)}" aria-label="Mois précédent">‹</a>
      <strong>${MONTHS[m - 1]} ${y}</strong>
      <a href="#/ops/${shiftMonth(ym, 1)}" aria-label="Mois suivant">›</a>
    </div>
    <div class="grid2">
      <div class="tile expense"><small>Dépenses</small><strong>${formatEur(sum("expense"))}</strong></div>
      <div class="tile income"><small>Revenus</small><strong>${formatEur(sum("income"))}</strong></div>
    </div>
    <p class="hint">Les opérations pro sont exclues des totaux.</p>
    ${rows || '<p class="muted">Aucune opération ce mois-ci.</p>'}`;

  view.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const op = await db.getOperation(button.dataset.delete);
      if (!op || !confirm(`Supprimer ${catLabel(op).name} ${signedAmount(op)} du ${shortDate(op.date)} ?`)) return;
      await db.deleteOperation(op.id);
      flash("Opération supprimée.");
      renderOps(ym);
    });
  });
}

// --- Expense reports ---------------------------------------------------------

async function renderReports() {
  const ops = await db.allOperations();
  const byDate = (a, b) => b.date.localeCompare(a.date);
  const pending = ops.filter((o) => o.reimbursementStatus === "pending").sort(byDate);
  const reimbursed = ops.filter((o) => o.reimbursementStatus === "reimbursed").sort(byDate).slice(0, 10);
  const total = pending.reduce((s, o) => s + o.amountCents, 0);

  view.innerHTML = `
    <div class="top"><h1>Notes de frais</h1></div>
    <div class="hero"><small>À rembourser</small><strong>${formatEur(total)}</strong>
      <small>${pending.length} dépense${pending.length > 1 ? "s" : ""}</small></div>
    ${pending.length > 1 ? '<button class="primary block" id="all">Tout marquer remboursé</button>' : ""}
    ${pending.map((op) => opRow(op, `<button class="chip" data-paid="${op.id}">Remboursé</button>`)).join("")
      || '<p class="muted">Rien à rembourser.</p>'}
    ${reimbursed.length ? `<h2>Remboursées récemment</h2>
      ${reimbursed.map((op) => opRow(op, `<button class="link" data-undo="${op.id}" aria-label="Annuler">↺</button>`)).join("")}` : ""}`;

  const setStatus = async (ids, status) => {
    for (const id of ids) {
      const op = await db.getOperation(id);
      if (op) await db.putOperation({ ...op, reimbursementStatus: status });
    }
    renderReports();
  };
  view.querySelectorAll("[data-paid]").forEach((b) =>
    b.addEventListener("click", () => setStatus([b.dataset.paid], "reimbursed")));
  view.querySelectorAll("[data-undo]").forEach((b) =>
    b.addEventListener("click", () => setStatus([b.dataset.undo], "pending")));
  view.querySelector("#all")?.addEventListener("click", () => {
    if (confirm(`Marquer ${pending.length} dépenses (${formatEur(total)}) comme remboursées ?`)) {
      setStatus(pending.map((o) => o.id), "reimbursed");
    }
  });
}

// --- Backup ------------------------------------------------------------------

async function storageStatus() {
  if (!navigator.storage?.persisted) return "Stockage persistant non pris en charge par ce navigateur.";
  const persisted = await navigator.storage.persisted();
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  return [
    persisted ? "✅ Stockage persistant accordé." : "⚠️ Stockage non persistant : le navigateur peut effacer les données.",
    standalone ? "✅ Ouverte depuis l'écran d'accueil." : "⚠️ Ouverte dans un onglet : installe-la sur l'écran d'accueil.",
  ].join("<br>");
}

async function renderBackup() {
  const ops = await db.allOperations();
  const last = await db.getMeta("lastExportAt");
  view.innerHTML = `
    <div class="top"><h1>Sauvegarde</h1></div>
    <div class="card">
      <p><strong>Les données restent sur ce téléphone.</strong> Aucun serveur.
        Si l'app est supprimée ou si iOS efface ses données, elles sont perdues.
        Exporte un fichier régulièrement (iCloud Drive, Fichiers…).</p>
      <p class="muted">${ops.length} opération${ops.length > 1 ? "s" : ""}.
        Dernier export : ${last ? new Date(last).toLocaleString("fr-FR") : "jamais"}.</p>
      <button class="primary block" id="export">Exporter (JSON)</button>
      <a href="#" id="download" class="hint">ou télécharger le fichier</a>
    </div>
    <div class="card">
      <h2>Restaurer</h2>
      <p class="hint">Remplace toutes les données par celles du fichier.</p>
      <input type="file" id="import" accept="application/json,.json">
    </div>
    <div class="card">
      <h2>Import bancaire (OFX)</h2>
      <p class="hint">Ajoute les opérations du relevé de ta banque. Les numéros de compte ne sont pas lus,
        les opérations déjà importées sont ignorées.</p>
      <input type="file" id="ofx" accept=".ofx,.qfx">
      <p><a href="#/classify">📥 Opérations à classer</a></p>
    </div>
    <div class="card"><h2>Stockage</h2><p class="hint" id="storage">…</p></div>`;

  storageStatus().then((html) => { view.querySelector("#storage").innerHTML = html; });

  const makeFile = async () => {
    const rules = (await db.getMeta("rules")) || {};
    const json = JSON.stringify(buildExport(await db.allOperations(), new Date(), rules), null, 1);
    return new File([json], exportFileName(), { type: "application/json" });
  };
  const markExported = async () => {
    await db.setMeta("lastExportAt", new Date().toISOString());
    flash("Export prêt.");
    renderBackup();
  };
  const download = async () => {
    const file = await makeFile();
    const url = URL.createObjectURL(file);
    const a = Object.assign(document.createElement("a"), { href: url, download: file.name });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    await markExported();
  };

  view.querySelector("#export").addEventListener("click", async () => {
    const file = await makeFile();
    // iOS: the share sheet offers "Enregistrer dans Fichiers".
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: file.name });
        await markExported();
      } catch (error) {
        if (error.name !== "AbortError") flash(`Export impossible : ${error.message}`, true);
      }
    } else {
      await download();
    }
  });
  view.querySelector("#download").addEventListener("click", (e) => {
    e.preventDefault();
    download();
  });

  view.querySelector("#import").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let operations;
    let rules;
    try {
      const data = JSON.parse(await file.text());
      operations = validateImport(data);
      rules = validateRules(data);
    } catch (error) {
      flash(error instanceof SyntaxError ? "Fichier JSON illisible." : error.message, true);
      e.target.value = "";
      return;
    }
    const current = (await db.allOperations()).length;
    if (!confirm(`Remplacer les ${current} opérations actuelles par les ${operations.length} du fichier ?`)) {
      e.target.value = "";
      return;
    }
    await db.replaceOperations(operations);
    await db.setMeta("rules", rules);
    flash(`${operations.length} opérations restaurées.`);
    renderBackup();
  });

  view.querySelector("#ofx").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const { operations, skipped, classified } = await importOfx(file);
      flash(`${operations.length} opérations importées, dont ${classified} classées par tes règles. ${skipped} déjà présentes.`);
      location.hash = "#/classify";
    } catch (error) {
      flash(error.message, true);
      e.target.value = "";
    }
  });
}

async function importOfx(file) {
  const statements = parseOfx(decodeOfx(new Uint8Array(await file.arrayBuffer())));
  const lines = statements.flat();
  const rules = (await db.getMeta("rules")) || {};
  const result = importLines(await db.allOperations(), lines, rules);
  await db.putOperations(result.operations);
  return result;
}

// --- Bank import: classify ---------------------------------------------------

async function renderClassify() {
  const groups = groupsToClassify(await db.allOperations()).slice(0, 50);
  const options = (kind) => TREE[kind]
    .filter((p) => p.name !== "Import")
    .map((p) => `<option value="${p.id}">${p.icon} ${esc(p.name)}</option>${
      p.children.map((c) => `<option value="${c.id}">&nbsp;&nbsp;&nbsp;${esc(c.name)}</option>`).join("")}`)
    .join("");
  view.innerHTML = `
    <div class="top"><h1>À classer</h1></div>
    ${groups.length ? `<p class="hint">Opérations importées, regroupées par libellé. Le choix s'applique
      au groupe et sert de règle pour les prochains imports.</p>` : '<p class="card">Rien à classer ✓</p>'}
    ${groups.map((g, i) => `<form class="card stack" data-index="${i}">
      <div><strong>${esc(g.example)}</strong>
        <small class="muted">${g.count} opération${g.count > 1 ? "s" : ""} ·
        ${g.kind === "expense" ? formatEur(-g.totalCents) : formatEur(g.totalCents, true)}</small></div>
      <div class="inline-form">
        <select name="category" required aria-label="Catégorie">
          <option value="">— Catégorie —</option>${options(g.kind)}</select>
        <button>OK</button>
      </div>
    </form>`).join("")}`;

  view.querySelectorAll("form[data-index]").forEach((form) => form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const group = groups[Number(form.dataset.index)];
    const categoryId = form.elements.category.value;
    if (!categoryId) return;
    const rules = (await db.getMeta("rules")) || {};
    const result = classifyGroup(await db.allOperations(), rules, group.kind, group.key, categoryId);
    await db.putOperations(result.changed);
    await db.setMeta("rules", result.rules);
    flash(`${result.changed.length} opérations classées dans ${BY_ID.get(categoryId).name} ✓`);
    renderClassify();
  }));
}

// --- Router ------------------------------------------------------------------

async function route() {
  const [, page = "add", arg] = location.hash.split("/");
  document.querySelectorAll(".tabbar a").forEach((a) =>
    a.classList.toggle("active", a.dataset.tab === (page === "classify" ? "backup" : page)));
  try {
    if (page === "ops") await renderOps(/^\d{4}-\d{2}$/.test(arg) ? arg : isoDate().slice(0, 7));
    else if (page === "reports") await renderReports();
    else if (page === "backup") await renderBackup();
    else if (page === "classify") await renderClassify();
    else await renderAdd(arg === "income" ? "income" : "expense");
  } catch (error) {
    view.innerHTML = `<p class="error">Erreur : ${esc(error.message)}</p>`;
    console.error(error);
  }
}

/** Translate category ids of the first list. Runs at each start, cheap. */
async function migrateCategories() {
  for (const op of await db.allOperations()) {
    const id = op.categoryId == null ? null : currentCategoryId(op.categoryId);
    if (id !== op.categoryId) await db.putOperation({ ...op, categoryId: id });
  }
}

window.addEventListener("hashchange", route);
migrateCategories().catch((error) => console.error(error)).finally(route);

// Ask the browser not to evict our data. Safari grants it more easily
// to a Home Screen web app.
navigator.storage?.persist?.().catch(() => {});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("SW", error));
}
