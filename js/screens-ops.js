// Screens of the main tabs: home, quick entry, operations, operation page,
// "À catégoriser" and expense reports. Same layout as the server app.

import * as db from "./db.js";
import { formatEur } from "./money.js";
import { TREE, BY_ID, topCategories, IMPORT_ID } from "./categories.js";
import { groupsToClassify, classifyGroup, isImported } from "./bank.js";
import {
  balancesByAccount, kindTotal, monthSummary, monthBounds, shiftMonth,
  projectSaved, projectProgress, unassignedCents, linkReimbursement,
} from "./ledger.js";
import {
  view, esc, isoDate, thisMonth, shortDate, frDate, monthLabel, flash, newId, loadAll, byId,
  catLabel, signedAmount, opRow, opsByDay, newestFirst, categoryOptions, accountOptions,
  progressBar, header, formCents, amountInput, MONTHS_SHORT,
} from "./ui.js";

const BACKUP_WARN_DAYS = 7;

async function daysSinceExport() {
  const last = await db.getMeta("lastExportAt");
  if (!last) return null;
  return Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
}

async function backupWarning(hasData) {
  const days = await daysSinceExport();
  if (!hasData || (days !== null && days < BACKUP_WARN_DAYS)) return "";
  return `<a class="tile warn backup-warn" href="#/backup">💾 ${
    days === null ? "Aucune sauvegarde" : `Dernière sauvegarde il y a ${days} jours`
  }. <u>Exporter maintenant</u></a>`;
}

// --- Home --------------------------------------------------------------------

export async function renderHome() {
  const data = await loadAll();
  const accounts = byId(data.accounts);
  const balances = balancesByAccount(data.accounts, data.operations);
  const ym = thisMonth();
  const summary = monthSummary(data.operations, ym);
  const previous = monthSummary(data.operations, shiftMonth(ym, -1));
  const pending = data.operations.filter((o) => o.reimbursementStatus === "pending");
  const pendingTotal = pending.reduce((s, o) => s + o.amountCents, 0);
  const recent = [...data.operations].sort(newestFirst).slice(0, 5);
  const projects = [...data.projects].sort((a, b) => a.name.localeCompare(b.name, "fr")).slice(0, 3);
  const diff = previous.expensesCents
    ? Math.round(((summary.expensesCents - previous.expensesCents) * 100) / previous.expensesCents)
    : null;

  view.innerHTML = `
    ${await backupWarning(data.operations.length > 0)}
    <header class="top"><h1>Bonjour</h1><span class="muted">${monthLabel(ym)}</span></header>
    <section class="hero">
      <small>Solde disponible</small>
      <strong>${formatEur(kindTotal(balances, "current"))}</strong>
      <small>Comptes courants</small>
    </section>
    <div class="grid2">
      <a class="tile expense" href="#/ops/${ym}">
        <small>Dépenses du mois</small><strong>${formatEur(summary.expensesCents)}</strong>
        ${diff !== null ? `<small>${diff > 0 ? "+" : ""}${diff} % vs mois dernier</small>` : ""}
      </a>
      <a class="tile income" href="#/ops/${ym}">
        <small>Revenus du mois</small><strong>${formatEur(summary.incomeCents)}</strong>
        ${summary.savingsRate !== null ? `<small>Épargne : ${summary.savingsRate} %</small>` : ""}
      </a>
      <a class="tile" href="#/accounts"><small>Épargne</small>
        <strong>${formatEur(kindTotal(balances, "savings"))}</strong><small>Livrets</small></a>
      <a class="tile" href="#/accounts"><small>Placements</small>
        <strong>${formatEur(kindTotal(balances, "investment"))}</strong><small>Investissements</small></a>
      <a class="tile ${pending.length ? "warn" : ""}" href="#/reports">
        <small>Notes de frais en attente</small><strong>${formatEur(pendingTotal)}</strong>
        <small>${pending.length} dépense${pending.length > 1 ? "s" : ""}</small>
      </a>
    </div>
    <a class="button primary block" href="#/add/expense">＋ Ajouter une dépense</a>
    <section>
      <div class="section-head"><h2>Dernières opérations</h2><a href="#/ops">Tout voir ›</a></div>
      ${recent.map((op) => opRow(op, accounts)).join("") || '<p class="muted">Aucune opération.</p>'}
    </section>
    ${projects.length ? `<section>
      <div class="section-head"><h2>Projets</h2><a href="#/projects">Tout voir ›</a></div>
      ${projects.map((p) => {
        const saved = projectSaved(p, data.contributions);
        const percent = projectProgress(p, saved);
        return `<a class="project-row" href="#/project/${p.id}">
          <span><strong>${esc(p.name)}</strong><small>${formatEur(saved)} / ${formatEur(p.targetCents)}</small></span>
          <span class="muted">${percent} %</span>${progressBar(percent)}</a>`;
      }).join("")}
    </section>` : ""}`;
}

// --- Quick entry -------------------------------------------------------------

function pendingChecklist(pending, checkedFor = null) {
  if (!pending.length) return "";
  return `<fieldset><legend>Rembourse ces dépenses</legend>
    ${pending.map((e) => `<label class="check"><input type="checkbox" name="reimburses" value="${e.id}"
      ${checkedFor && e.reimbursedById === checkedFor ? "checked" : ""}>
      ${shortDate(e.date)} · ${esc(catLabel(e).name)} · ${formatEur(e.amountCents)}</label>`).join("")}
  </fieldset>`;
}

export async function renderAdd(type) {
  const data = await loadAll();
  const accounts = data.accounts.filter((a) => !a.archived);
  const lastAccount = (await db.getMeta("lastAccountId")) || accounts[0]?.id;
  const pending = data.operations.filter((o) => o.reimbursementStatus === "pending").sort(newestFirst);
  const tabs = `<nav class="segmented" aria-label="Type">
    ${[["expense", "Dépense"], ["income", "Revenu"], ["transfer", "Transfert"]].map(([key, label]) =>
      `<a href="#/add/${key}" class="${type === key ? "active" : ""}">${label}</a>`).join("")}
  </nav>`;
  const amount = `<label class="amount ${type}"><span class="sr-only">Montant</span>
    <input name="amount" inputmode="decimal" placeholder="0" autocomplete="off" enterkeyhint="done"><span>€</span></label>`;

  if (type === "transfer") {
    const defaultTo = accounts.find((a) => a.kind !== "current") || accounts[1];
    view.innerHTML = `${tabs}
      <form class="quick" id="quick" novalidate>${amount}
        <div class="stack">
          <label>De <select name="accountId">${accountOptions(accounts, lastAccount)}</select></label>
          <label>Vers <select name="toAccountId">${accountOptions(accounts, defaultTo?.id)}</select></label>
          <label>Date <input type="date" name="date" value="${isoDate()}"></label>
          <label>Commentaire <input name="comment" maxlength="500"></label>
          <button class="primary">Enregistrer le transfert</button>
        </div>
      </form>`;
  } else {
    const top = topCategories(data.operations, type);
    view.innerHTML = `${tabs}
      <form class="quick" id="quick" novalidate>${amount}
        <label class="pro-toggle"><input type="checkbox" name="isPro">
          <span>💼 ${type === "expense" ? "Note de frais <small>pro, à rembourser</small>" : "Remboursement pro"}</span>
        </label>
        <p class="hint">Touche une catégorie pour enregistrer.</p>
        <div class="cat-grid">
          ${top.map((c) => `<button type="button" data-cat="${c.id}"><span>${c.icon || BY_ID.get(c.parentId)?.icon || "•"}</span>${esc(c.name)}</button>`).join("")}
        </div>
        <details class="more-cats"><summary>Toutes les catégories</summary>
          ${TREE[type].filter((p) => p.id !== IMPORT_ID[type]).map((p) => `<div class="cat-group">
            ${p.children.length
              ? `<p class="cat-group-title">${p.icon} ${esc(p.name)}</p>${p.children.map((c) =>
                `<button type="button" data-cat="${c.id}" class="chip">${c.icon} ${esc(c.name)}</button>`).join("")}`
              : `<button type="button" data-cat="${p.id}" class="chip strong">${p.icon} ${esc(p.name)}</button>`}
          </div>`).join("")}
          <button type="button" data-cat="" class="chip">Sans catégorie</button>
        </details>
        <details class="options"><summary>Options (compte, date, commentaire)</summary>
          <div class="stack">
            <label>Compte <select name="accountId">${accountOptions(accounts, lastAccount)}</select></label>
            <label>Date <input type="date" name="date" value="${isoDate()}"></label>
            ${type === "income" ? pendingChecklist(pending) : ""}
            <label>Commentaire <input name="comment" maxlength="500"></label>
          </div>
        </details>
      </form>`;
  }

  const form = view.querySelector("#quick");
  const amountInputEl = form.elements.amount;
  amountInputEl.focus();
  const readAmount = () => {
    try {
      return formCents(amountInputEl.value);
    } catch (error) {
      flash(error.message, true);
      amountInputEl.focus();
      return null;
    }
  };
  const base = () => ({
    id: newId(),
    date: form.elements.date.value || isoDate(),
    type,
    accountId: form.elements.accountId.value,
    toAccountId: null,
    categoryId: null,
    comment: form.elements.comment.value.trim(),
    label: "",
    importRef: null,
    isPro: false,
    reimbursementStatus: null,
    reimbursedById: null,
    createdAt: new Date().toISOString(),
  });

  if (type === "transfer") {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const amountCents = readAmount();
      if (amountCents === null) return;
      const op = { ...base(), amountCents, toAccountId: form.elements.toAccountId.value };
      if (op.accountId === op.toAccountId) {
        flash("Choisis deux comptes différents.", true);
        return;
      }
      await db.put("operations", op);
      await db.setMeta("lastAccountId", op.accountId);
      flash(`Transfert enregistré : ${formatEur(amountCents)}`);
      renderAdd(type);
    });
    return;
  }

  // Enter must not save with a random category.
  form.addEventListener("submit", (e) => e.preventDefault());
  form.addEventListener("click", async (e) => {
    const button = e.target.closest("button[data-cat]");
    if (!button) return;
    const amountCents = readAmount();
    if (amountCents === null) return;
    const isPro = form.elements.isPro.checked;
    const op = {
      ...base(),
      amountCents,
      categoryId: button.dataset.cat || null,
      isPro,
      reimbursementStatus: type === "expense" && isPro ? "pending" : null,
    };
    const ids = [...form.querySelectorAll("[name=reimburses]:checked")].map((c) => c.value);
    const linked = linkReimbursement(op, pending.filter((p) => ids.includes(p.id)));
    if (linked.length) op.isPro = true;
    await db.put("operations", [op, ...linked]);
    await db.setMeta("lastAccountId", op.accountId);
    const { icon, name } = catLabel(op);
    flash(`Enregistré : ${icon} ${name} ${signedAmount(op)}${isPro && type === "expense" ? " · note de frais" : ""}`);
    renderAdd(type);
  });
}

// --- Operations ----------------------------------------------------------------

// Filters stay while the app is open, like the query string of the server app.
const filters = { type: "", scope: "", cat: "", q: "" };

function opsTabs(active, toClassify) {
  return `<nav class="seg-tabs" aria-label="Vue des opérations">
    <a href="#/ops" class="${active === "ops" ? "active" : ""}">Toutes</a>
    <a href="#/classify" class="${active === "classify" ? "active" : ""}">À catégoriser${
      toClassify ? ` <span class="badge">${toClassify}</span>` : ""}</a>
  </nav>`;
}

/** Month grid per year, most recent year first. Future months are greyed. */
function monthPicker(ym, firstYear) {
  const now = thisMonth();
  let years = "";
  for (let year = Number(now.slice(0, 4)); year >= firstYear; year -= 1) {
    const cells = MONTHS_SHORT.map((label, i) => {
      const value = `${year}-${String(i + 1).padStart(2, "0")}`;
      if (value > now) return `<span class="future" aria-disabled="true">${label}</span>`;
      const cls = [value === ym ? "active" : "", value === now ? "now" : ""].join(" ").trim();
      return `<a href="#/ops/${value}" class="${cls}">${label}</a>`;
    }).join("");
    years += `<div class="month-year">${year}</div><div class="month-grid">${cells}</div>`;
  }
  return `<details class="month-picker" id="month-picker">
    <summary>${ym === "all" ? "Toutes les périodes" : monthLabel(ym)} ▾</summary>
    <div class="month-panel">${years}
      <a class="all-periods ${ym === "all" ? "active" : ""}" href="#/ops/all">Toutes les périodes</a></div>
  </details>`;
}

function fold(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function applyFilters(ops) {
  const children = (id) => new Set([id, ...(BY_ID.get(id)?.children || []).map((c) => c.id)]);
  const cats = filters.cat ? children(filters.cat) : null;
  const q = fold(filters.q.trim());
  return ops.filter((op) =>
    (!filters.type || op.type === filters.type)
    && (filters.scope !== "perso" || !op.isPro)
    && (filters.scope !== "pro" || op.isPro)
    && (!cats || cats.has(op.categoryId))
    && (!q || fold(`${op.label || ""} ${op.comment || ""} ${catLabel(op).name}`).includes(q)));
}

export async function renderOps(ym, scope = null) {
  const now = thisMonth();
  if (ym !== "all" && ym > now) ym = now;
  if (scope !== null) filters.scope = scope;
  const data = await loadAll();
  const accounts = byId(data.accounts);
  const firstYear = Math.min(Number((ym === "all" ? now : ym).slice(0, 4)),
    ...data.operations.map((o) => Number(o.date.slice(0, 4))));
  const toClassify = data.operations.filter(isImported).length;
  let periodOps = data.operations;
  if (ym !== "all") {
    const [start, end] = monthBounds(ym);
    periodOps = periodOps.filter((o) => o.date >= start && o.date <= end);
  }
  periodOps.sort(newestFirst);
  const next = ym === "all" ? null : shiftMonth(ym, 1);
  const catOptions = ["expense", "income"].map((k) => categoryOptions(k, filters.cat, "", true, true).replace('<option value=""></option>', "")).join("");

  view.innerHTML = `
    <header class="top"><h1>Dépenses et revenus</h1>
      <button type="button" class="icon-btn" id="search-toggle" aria-label="Rechercher"
        aria-controls="search" aria-expanded="${filters.q ? "true" : "false"}">🔍</button></header>
    ${opsTabs("ops", toClassify)}
    <form class="filters" id="filters">
      <input type="search" id="search" name="q" value="${esc(filters.q)}" placeholder="Rechercher…" aria-label="Rechercher" ${filters.q ? "" : "hidden"}>
      <div class="filter-row">
        <select name="type" aria-label="Type">
          <option value="">Tous types</option>
          ${[["expense", "Dépenses"], ["income", "Revenus"], ["transfer", "Transferts"]].map(([k, l]) =>
            `<option value="${k}" ${filters.type === k ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <select name="scope" aria-label="Perso ou pro">
          <option value="">Perso + pro</option>
          <option value="perso" ${filters.scope === "perso" ? "selected" : ""}>Perso</option>
          <option value="pro" ${filters.scope === "pro" ? "selected" : ""}>Pro</option>
        </select>
        <select name="cat" aria-label="Catégorie"><option value="">Toutes catégories</option>${catOptions}</select>
      </div>
    </form>
    <nav class="month-nav">
      ${ym !== "all" ? `<a href="#/ops/${shiftMonth(ym, -1)}" aria-label="Mois précédent">‹</a>` : ""}
      ${monthPicker(ym, firstYear)}
      ${next === null ? "" : next <= now ? `<a href="#/ops/${next}" aria-label="Mois suivant">›</a>`
        : '<span class="disabled" aria-hidden="true">›</span>'}
    </nav>
    <div class="grid2">
      <div class="tile expense"><small>Dépenses</small><strong id="sum-expense"></strong></div>
      <div class="tile income"><small>Revenus</small><strong id="sum-income"></strong></div>
    </div>
    <div id="list"></div>`;

  const form = view.querySelector("#filters");
  const search = form.elements.q;
  const toggle = view.querySelector("#search-toggle");
  const show = () => {
    Object.assign(filters, {
      q: search.value, type: form.elements.type.value, scope: form.elements.scope.value, cat: form.elements.cat.value,
    });
    const ops = applyFilters(periodOps);
    const sum = (type) => ops.filter((o) => o.type === type).reduce((t, o) => t + o.amountCents, 0);
    view.querySelector("#sum-expense").textContent = formatEur(sum("expense"));
    view.querySelector("#sum-income").textContent = formatEur(sum("income"));
    view.querySelector("#list").innerHTML = opsByDay(ops, accounts) || '<p class="muted">Aucune opération.</p>';
  };
  show();
  form.addEventListener("input", show);
  form.addEventListener("submit", (e) => e.preventDefault());
  toggle.addEventListener("click", () => {
    search.hidden = !search.hidden;
    toggle.setAttribute("aria-expanded", String(!search.hidden));
    if (search.hidden) {
      search.value = "";
      show();
    } else {
      search.focus();
    }
  });
}

// --- To categorise -------------------------------------------------------------

export async function renderClassify() {
  const all = await db.allOperations();
  const toClassify = all.filter(isImported).length;
  const groups = groupsToClassify(all).slice(0, 50);
  view.innerHTML = `
    <header class="top"><h1>Dépenses et revenus</h1></header>
    ${opsTabs("classify", toClassify)}
    ${groups.length ? `<p class="muted">Opérations importées, regroupées par libellé, les plus récentes d'abord.
      Le choix s'applique au groupe et devient une règle pour les prochains imports.</p>`
      : '<p class="card">Rien à catégoriser ✓</p>'}
    ${groups.map((g, i) => `<form class="card stack" data-index="${i}">
      <div class="classify-head"><span class="op-icon ${g.kind} unknown" aria-hidden="true">?</span>
        <div><strong>${esc(g.example)}</strong>
        <small class="muted">${shortDate(g.lastDate)} · ${g.count} opération${g.count > 1 ? "s" : ""} ·
        ${g.kind === "expense" ? formatEur(-g.totalCents) : formatEur(g.totalCents, true)}</small></div></div>
      <div class="inline-form">
        <select name="category" required aria-label="Catégorie">${categoryOptions(g.kind, null, "— Catégorie —", false)}</select>
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

// --- Operation page --------------------------------------------------------------

export async function renderOp(id) {
  const data = await loadAll();
  const op = data.operations.find((o) => o.id === id);
  if (!op) {
    view.innerHTML = `${header("Opération", ["#/ops", "Opérations"])}<p class="muted">Opération introuvable.</p>`;
    return;
  }
  const accounts = data.accounts.filter((a) => !a.archived || a.id === op.accountId || a.id === op.toAccountId);
  const opsById = byId(data.operations);
  const pending = data.operations.filter((o) => o.reimbursementStatus === "pending" || o.reimbursedById === op.id);
  const projects = data.projects;
  const contributions = data.contributions.filter((c) => c.operationId === op.id);
  const projectsById = byId(projects);
  const free = unassignedCents(op, data.contributions);
  const isTransfer = op.type === "transfer";
  const paidBy = op.reimbursedById ? opsById.get(op.reimbursedById) : null;

  view.innerHTML = `${header("Modifier", ["#/ops", "Opérations"])}
    <form id="op-form" class="stack card">
      ${isTransfer ? "" : `<label>Type <select name="type">
        <option value="expense" ${op.type === "expense" ? "selected" : ""}>Dépense</option>
        <option value="income" ${op.type === "income" ? "selected" : ""}>Revenu</option></select></label>
        <p class="hint">Si tu changes le type, choisis une catégorie du nouveau type.</p>`}
      <label>Montant (€) <input name="amount" inputmode="decimal" value="${amountInput(op.amountCents)}" required></label>
      <label>Date <input type="date" name="date" value="${op.date}" required></label>
      <label>Compte ${isTransfer ? "source" : ""} <select name="accountId">${accountOptions(accounts, op.accountId)}</select></label>
      ${isTransfer
        ? `<label>Compte destination <select name="toAccountId">${accountOptions(accounts, op.toAccountId)}</select></label>`
        : `<label>Catégorie <select name="categoryId" id="category">${categoryOptions(op.type, op.categoryId)}</select></label>
          <label class="check"><input type="checkbox" name="isPro" ${op.isPro ? "checked" : ""}>
            ${op.type === "expense" ? "Note de frais (pro, à rembourser)" : "Remboursement pro"}</label>`}
      ${op.type === "income" ? pendingChecklist(pending.filter((e) => e.id !== op.id && e.type === "expense"), op.id) : ""}
      ${paidBy ? `<p class="muted">Remboursée le ${frDate(paidBy.date)} (${formatEur(paidBy.amountCents)}).</p>` : ""}
      <label>Commentaire <input name="comment" value="${esc(op.comment)}" maxlength="500"></label>
      ${op.label ? `<p class="muted">Libellé bancaire : ${esc(op.label)}</p>` : ""}
      <button class="primary">Enregistrer</button>
    </form>
    ${op.type !== "expense" && projects.length ? `<section class="card"><h2>Affecter à un projet</h2>
      ${contributions.map((c) => `<p class="muted">${formatEur(c.amountCents)} → <a href="#/project/${c.projectId}">${esc(projectsById.get(c.projectId)?.name)}</a></p>`).join("")}
      ${free ? `<form id="assign" class="inline-form">
        <select name="projectId" aria-label="Projet">${projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select>
        <input name="amount" inputmode="decimal" value="${amountInput(free)}" aria-label="Montant" required>
        <button>Affecter</button></form>` : ""}
    </section>` : ""}
    <button class="danger block" id="delete">Supprimer l'opération</button>`;

  const form = view.querySelector("#op-form");
  form.elements.type?.addEventListener("change", () => {
    view.querySelector("#category").innerHTML = categoryOptions(form.elements.type.value);
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = form.elements;
    let amountCents;
    try {
      amountCents = formCents(f.amount.value);
    } catch (error) {
      flash(error.message, true);
      return;
    }
    const type = isTransfer ? "transfer" : f.type.value;
    const categoryId = isTransfer ? null : f.categoryId.value || null;
    if (categoryId && BY_ID.get(categoryId)?.kind !== type) {
      flash("Choisis une catégorie du bon type.", true);
      return;
    }
    const isPro = !isTransfer && f.isPro.checked;
    const updated = {
      ...op, type, amountCents, categoryId, isPro,
      date: f.date.value || op.date,
      accountId: f.accountId.value,
      toAccountId: isTransfer ? f.toAccountId.value : null,
      comment: f.comment.value.trim(),
    };
    if (isTransfer && updated.accountId === updated.toAccountId) {
      flash("Choisis deux comptes différents.", true);
      return;
    }
    // Same rules as the server: a pro expense waits for its reimbursement.
    if (type === "expense") {
      updated.reimbursementStatus = isPro ? (op.reimbursedById ? "reimbursed" : "pending") : null;
      if (!isPro) updated.reimbursedById = null;
    } else {
      updated.reimbursementStatus = null;
      updated.reimbursedById = null;
    }
    const changed = [updated];
    if (op.type === "income") {
      const checked = new Set([...form.querySelectorAll("[name=reimburses]:checked")].map((c) => c.value));
      for (const e2 of data.operations.filter((o) => o.reimbursedById === op.id && !checked.has(o.id))) {
        changed.push({ ...e2, reimbursedById: null, reimbursementStatus: "pending" });
      }
      if (type === "income") {
        changed.push(...linkReimbursement(updated, data.operations.filter((o) => checked.has(o.id) && o.reimbursedById !== op.id)));
        if (checked.size) updated.isPro = true;
      }
    }
    await db.put("operations", changed);
    flash("Opération modifiée.");
    history.back();
  });

  view.querySelector("#assign")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target.elements;
    let amountCents;
    try {
      amountCents = formCents(f.amount.value);
    } catch (error) {
      flash(error.message, true);
      return;
    }
    if (amountCents > free) {
      flash(`Au plus ${formatEur(free)}.`, true);
      return;
    }
    await db.put("contributions", {
      id: newId(), projectId: f.projectId.value, date: op.date, amountCents,
      accountId: op.toAccountId || op.accountId, operationId: op.id, comment: "",
    });
    flash(`${formatEur(amountCents)} affectés à ${projectsById.get(f.projectId.value).name}.`);
    renderOp(id);
  });

  view.querySelector("#delete").addEventListener("click", async () => {
    if (!confirm("Supprimer cette opération ?")) return;
    const freed = data.operations.filter((o) => o.reimbursedById === op.id)
      .map((o) => ({ ...o, reimbursedById: null, reimbursementStatus: "pending" }));
    await db.put("operations", freed);
    await db.remove("contributions", contributions.map((c) => c.id));
    await db.remove("operations", op.id);
    flash("Opération supprimée.");
    location.hash = "#/ops";
  });
}

// --- Expense reports ---------------------------------------------------------------

export async function renderReports() {
  const data = await loadAll();
  const accounts = byId(data.accounts);
  const ops = data.operations;
  const pending = ops.filter((o) => o.reimbursementStatus === "pending").sort(newestFirst);
  const reimbursed = ops.filter((o) => o.reimbursementStatus === "reimbursed").sort(newestFirst).slice(0, 10);
  const total = pending.reduce((s, o) => s + o.amountCents, 0);
  const row = (op, action) => `<div class="report-row">${opRow(op, accounts)}${action}</div>`;

  view.innerHTML = `${header("Notes de frais", ["#/more", "Plus"])}
    <div class="hero"><small>À rembourser</small><strong>${formatEur(total)}</strong>
      <small>${pending.length} dépense${pending.length > 1 ? "s" : ""}</small></div>
    ${pending.length > 1 ? '<button class="primary block" id="all">Tout marquer remboursé</button>' : ""}
    ${pending.map((op) => row(op, `<button class="chip" data-paid="${op.id}">Remboursé</button>`)).join("")
      || '<p class="muted">Rien à rembourser.</p>'}
    ${reimbursed.length ? `<h2>Remboursées récemment</h2>
      ${reimbursed.map((op) => row(op, `<button class="link" data-undo="${op.id}" aria-label="Annuler">↺</button>`)).join("")}` : ""}`;

  const setStatus = async (ids, status) => {
    const changed = ops.filter((o) => ids.includes(o.id))
      .map((o) => ({ ...o, reimbursementStatus: status, reimbursedById: status === "pending" ? null : o.reimbursedById }));
    await db.put("operations", changed);
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
