// Screens of the "Projets" and "Plus" tabs. Same layout as the server app.
// Single user: no "Partagé avec le foyer" and no logout. "Sauvegarde" is
// local only.

import * as db from "./db.js";
import { formatEur } from "./money.js";
import { TREE } from "./categories.js";
import { decodeOfx, parseOfx, importLines } from "./bank.js";
import { buildExport, exportFileName, validateImport, validateRules } from "./backup.js";
import {
  ACCOUNT_KINDS, PURCHASE_STATUS, PRIORITY, balancesByAccount, projectSaved, projectProgress,
} from "./ledger.js";
import {
  view, esc, isoDate, frDate, flash, newId, loadAll, byId, fullCategoryName,
  categoryOptions, accountOptions, progressBar, header, formCents, amountInput,
} from "./ui.js";

/** Run a form handler; show its error message in French instead of failing. */
function onSubmit(form, handler) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await handler(form.elements);
    } catch (error) {
      flash(error.message, true);
    }
  });
}

const options = (map, selected, empty = null) =>
  (empty !== null ? `<option value="">${empty}</option>` : "")
  + Object.entries(map).map(([k, l]) => `<option value="${k}" ${k === selected ? "selected" : ""}>${l}</option>`).join("");

// --- Projects ------------------------------------------------------------------

function projectFields(p = {}) {
  return `<label>Nom <input name="name" value="${esc(p.name)}" placeholder="Voyage au Japon" required maxlength="100"></label>
    <label>Montant cible (€) <input name="target" inputmode="decimal" value="${p.targetCents != null ? amountInput(p.targetCents) : ""}" required></label>
    <label>Date cible <input type="date" name="targetDate" value="${p.targetDate || ""}"></label>
    <label>Description <textarea name="description" rows="2" maxlength="500">${esc(p.description)}</textarea></label>`;
}

function readProject(f) {
  return {
    name: f.name.value.trim(),
    targetCents: formCents(f.target.value, { allowEmpty: true }),
    targetDate: f.targetDate.value || null,
    description: f.description.value.trim(),
  };
}

export async function renderProjects() {
  const data = await loadAll();
  const projects = [...data.projects].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  view.innerHTML = `<header class="top"><h1>Mes projets</h1></header>
    ${projects.map((p) => {
      const saved = projectSaved(p, data.contributions);
      const percent = projectProgress(p, saved);
      return `<a class="project-row card" href="#/project/${p.id}">
        <span><strong>${esc(p.name)}</strong><small>${formatEur(saved)} / ${formatEur(p.targetCents)}${
          p.targetDate ? ` · d'ici le ${frDate(p.targetDate)}` : ""}</small></span>
        <span class="muted">${percent} %</span>${progressBar(percent)}</a>`;
    }).join("") || '<p class="muted">Aucun projet pour l\'instant.</p>'}
    <details class="card" ${projects.length ? "" : "open"}><summary>＋ Nouveau projet</summary>
      <form id="new" class="stack">${projectFields()}<button class="primary">Créer</button></form>
    </details>`;
  onSubmit(view.querySelector("#new"), async (f) => {
    const project = { id: newId(), ...readProject(f) };
    await db.put("projects", project);
    flash("Projet créé.");
    location.hash = `#/project/${project.id}`;
  });
}

export async function renderProject(id) {
  const data = await loadAll();
  const project = data.projects.find((p) => p.id === id);
  if (!project) {
    view.innerHTML = `${header("Projet", ["#/projects", "Projets"])}<p class="muted">Projet introuvable.</p>`;
    return;
  }
  const accounts = byId(data.accounts);
  const contributions = data.contributions.filter((c) => c.projectId === id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const purchases = data.purchases.filter((p) => p.projectId === id);
  const saved = projectSaved(project, data.contributions);
  const percent = projectProgress(project, saved);

  view.innerHTML = `${header(project.name, ["#/projects", "Projets"])}
    <section class="card">
      ${project.description ? `<p>${esc(project.description)}</p>` : ""}
      <div class="kpis">
        <div><small>Économisé</small><strong>${formatEur(saved)}</strong></div>
        <div><small>Cible</small><strong>${formatEur(project.targetCents)}</strong></div>
        <div><small>Reste</small><strong>${formatEur(Math.max(project.targetCents - saved, 0))}</strong></div>
      </div>
      ${progressBar(percent)}
      <p class="muted">${percent} %${project.targetDate ? ` · objectif le ${frDate(project.targetDate)}` : ""}</p>
    </section>
    <section><h2>Versements</h2>
      ${contributions.map((c) => `<div class="list-row">
        <span><strong>${formatEur(c.amountCents)}</strong>
          <small>${frDate(c.date)}${c.accountId && accounts.get(c.accountId) ? ` · ${esc(accounts.get(c.accountId).name)}` : ""}${
            c.comment ? ` · ${esc(c.comment)}` : ""}${c.operationId ? ` · <a href="#/op/${c.operationId}">opération</a>` : ""}</small></span>
        <button class="link danger" data-delete="${c.id}" aria-label="Supprimer">✕</button>
      </div>`).join("") || '<p class="muted">Aucun versement. Tu peux aussi affecter un transfert depuis sa fiche.</p>'}
      <form id="contribution" class="stack card">
        <label>Montant (€) <input name="amount" inputmode="decimal" required></label>
        <label>Date <input type="date" name="date" value="${isoDate()}"></label>
        <label>Compte d'épargne <select name="accountId"><option value="">—</option>${accountOptions(data.accounts.filter((a) => !a.archived))}</select></label>
        <label>Commentaire <input name="comment" maxlength="200"></label>
        <button class="primary">Ajouter un versement</button>
      </form>
    </section>
    ${purchases.length ? `<section><h2>Achats liés</h2>
      ${purchases.map((p) => `<a class="list-row" href="#/purchase/${p.id}"><span><strong>${esc(p.name)}</strong>
        <small>${PURCHASE_STATUS[p.status]}</small></span><span>${formatEur(p.estimatedCents)}</span></a>`).join("")}
    </section>` : ""}
    <details class="card"><summary>Modifier le projet</summary>
      <form id="edit" class="stack">${projectFields(project)}<button class="primary">Enregistrer</button></form>
      <button class="danger block" id="delete">Supprimer le projet</button>
    </details>`;

  onSubmit(view.querySelector("#contribution"), async (f) => {
    await db.put("contributions", {
      id: newId(), projectId: id, date: f.date.value || isoDate(), amountCents: formCents(f.amount.value),
      accountId: f.accountId.value || null, operationId: null, comment: f.comment.value.trim(),
    });
    flash("Versement ajouté.");
    renderProject(id);
  });
  view.querySelectorAll("[data-delete]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Supprimer ce versement ?")) return;
    await db.remove("contributions", b.dataset.delete);
    renderProject(id);
  }));
  onSubmit(view.querySelector("#edit"), async (f) => {
    await db.put("projects", { ...project, ...readProject(f) });
    flash("Projet enregistré.");
    renderProject(id);
  });
  view.querySelector("#delete").addEventListener("click", async () => {
    if (!confirm("Supprimer ce projet et ses versements ?")) return;
    await db.remove("contributions", contributions.map((c) => c.id));
    await db.put("purchases", purchases.map((p) => ({ ...p, projectId: null })));
    await db.remove("projects", id);
    flash("Projet supprimé.");
    location.hash = "#/projects";
  });
}

// --- "Plus" menu -----------------------------------------------------------------

export function renderMore() {
  view.innerHTML = `<header class="top"><h1>Plus</h1></header>
    <nav class="menu">
      <a href="#/accounts">🏦 Comptes et épargne</a>
      <a href="#/purchases">🛍️ Liste d'achats</a>
      <a href="#/categories">🏷️ Catégories</a>
      <a href="#/reports">🧾 Notes de frais</a>
      <a href="#/import">📥 Import bancaire (OFX)</a>
      <a href="#/backup">💾 Sauvegarde</a>
    </nav>
    <p class="muted">Bientôt : statistiques, budgets mensuels, récurrences.</p>
    <p class="hint">Les données restent sur ce téléphone. Exporte-les régulièrement depuis « Sauvegarde ».</p>`;
}

// --- Accounts ------------------------------------------------------------------------

function accountFields(a = {}) {
  return `<label>Nom <input name="name" value="${esc(a.name)}" placeholder="Compte courant CM" required maxlength="100"></label>
    <label>Type <select name="kind">${options(ACCOUNT_KINDS, a.kind)}</select></label>
    <label>Solde de départ (€) <input name="initial" inputmode="decimal" value="${a.initialBalanceCents ? amountInput(a.initialBalanceCents) : ""}" placeholder="0"></label>`;
}

function readAccount(f) {
  return {
    name: f.name.value.trim(),
    kind: f.kind.value,
    initialBalanceCents: formCents(f.initial.value, { allowEmpty: true, allowNegative: true }),
  };
}

export async function renderAccounts() {
  const data = await loadAll();
  const rows = balancesByAccount(data.accounts, data.operations, true);
  view.innerHTML = `${header("Comptes", ["#/more", "Plus"])}
    ${Object.entries(ACCOUNT_KINDS).map(([kind, label]) => {
      const group = rows.filter(([a]) => a.kind === kind);
      return group.length ? `<section><h2>${label}</h2>
        ${group.map(([a, balance]) => `<a class="list-row ${a.archived ? "archived" : ""}" href="#/account/${a.id}">
          <span><strong>${esc(a.name)}</strong><small>${a.archived ? "Archivé" : "Actif"}</small></span>
          <span class="amount-cell">${formatEur(balance)}</span></a>`).join("")}</section>` : "";
    }).join("")}
    <details class="card" ${rows.length ? "" : "open"}><summary>＋ Nouveau compte</summary>
      <form id="new" class="stack">${accountFields()}
        <p class="hint">Ne saisis jamais d'IBAN ni de numéro de compte : un nom suffit.</p>
        <button class="primary">Créer</button></form>
    </details>`;
  onSubmit(view.querySelector("#new"), async (f) => {
    await db.put("accounts", { id: newId(), archived: false, ...readAccount(f) });
    flash("Compte créé.");
    renderAccounts();
  });
}

export async function renderAccount(id) {
  const account = await db.get("accounts", id);
  if (!account) {
    view.innerHTML = `${header("Compte", ["#/accounts", "Comptes"])}<p class="muted">Compte introuvable.</p>`;
    return;
  }
  view.innerHTML = `${header(account.name, ["#/accounts", "Comptes"])}
    <form id="edit" class="stack card">${accountFields(account)}
      <label class="check"><input type="checkbox" name="archived" ${account.archived ? "checked" : ""}> Archivé (masqué de la saisie)</label>
      <button class="primary">Enregistrer</button></form>`;
  onSubmit(view.querySelector("#edit"), async (f) => {
    await db.put("accounts", { ...account, ...readAccount(f), archived: f.archived.checked });
    flash("Compte enregistré.");
    location.hash = "#/accounts";
  });
}

// --- Purchases ---------------------------------------------------------------------

const purchaseState = { status: "", sort: "priority" };
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

function purchaseFields(p, projects) {
  return `<label>Nom <input name="name" value="${esc(p.name)}" required maxlength="100"></label>
    <label>Prix estimé (€) <input name="estimated" inputmode="decimal" value="${p.estimatedCents ? amountInput(p.estimatedCents) : ""}"></label>
    <label>Catégorie <select name="categoryId">${categoryOptions("expense", p.categoryId)}</select></label>
    <label>Priorité <select name="priority">${options(PRIORITY, p.priority, "—")}</select></label>
    <label>Statut <select name="status">${options(PURCHASE_STATUS, p.status || "considered")}</select></label>
    ${projects.length ? `<label>Projet <select name="projectId"><option value="">—</option>${projects.map((pr) =>
      `<option value="${pr.id}" ${pr.id === p.projectId ? "selected" : ""}>${esc(pr.name)}</option>`).join("")}</select></label>` : ""}
    <label>Commentaire <input name="comment" value="${esc(p.comment)}" maxlength="500"></label>`;
}

function readPurchase(f) {
  return {
    name: f.name.value.trim(),
    estimatedCents: formCents(f.estimated.value, { allowEmpty: true }),
    categoryId: f.categoryId.value || null,
    priority: f.priority.value || null,
    status: f.status.value,
    projectId: f.projectId?.value || null,
    comment: f.comment.value.trim(),
  };
}

export async function renderPurchases(status = purchaseState.status, sort = purchaseState.sort) {
  Object.assign(purchaseState, { status, sort });
  const data = await loadAll();
  const projects = byId(data.projects);
  const order = {
    priority: (a, b) => (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3) || a.name.localeCompare(b.name, "fr"),
    price: (a, b) => b.estimatedCents - a.estimatedCents,
    category: (a, b) => fullCategoryName(a.categoryId).localeCompare(fullCategoryName(b.categoryId), "fr"),
  };
  const purchases = data.purchases.filter((p) => !status || p.status === status).sort(order[sort]);
  const activeTotal = data.purchases.filter((p) => p.status === "considered" || p.status === "planned")
    .reduce((s, p) => s + p.estimatedCents, 0);

  view.innerHTML = `${header("Liste d'achats", ["#/more", "Plus"])}
    <nav class="segmented small" aria-label="Statut">
      <a href="#" data-status="" class="${!status ? "active" : ""}">Tout</a>
      ${Object.entries(PURCHASE_STATUS).map(([k, l]) => `<a href="#" data-status="${k}" class="${status === k ? "active" : ""}">${l}</a>`).join("")}
    </nav>
    <p class="sort">Trier :
      ${[["priority", "priorité"], ["price", "prix"], ["category", "catégorie"]].map(([k, l]) =>
        `<a href="#" data-sort="${k}" class="${sort === k ? "active" : ""}">${l}</a>`).join(" ")}
    </p>
    <p class="muted">Envisagés et prévus : ${formatEur(activeTotal)}</p>
    ${purchases.map((p) => `<a class="list-row ${p.status === "bought" || p.status === "abandoned" ? "done" : ""}" href="#/purchase/${p.id}">
      <span><strong>${esc(p.name)}</strong><small>${esc(fullCategoryName(p.categoryId))} · ${PURCHASE_STATUS[p.status]}${
        p.projectId && projects.get(p.projectId) ? ` · ${esc(projects.get(p.projectId).name)}` : ""}</small></span>
      <span class="amount-cell">${p.priority ? `<span class="tag prio-${p.priority}">${PRIORITY[p.priority]}</span>` : ""}
        ${formatEur(p.estimatedCents)}</span></a>`).join("") || '<p class="muted">Aucun achat.</p>'}
    <details class="card" ${purchases.length || status ? "" : "open"}><summary>＋ Nouvel achat</summary>
      <form id="new" class="stack">${purchaseFields({}, data.projects)}<button class="primary">Ajouter</button></form>
    </details>`;

  view.querySelectorAll("[data-status]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    renderPurchases(a.dataset.status, sort);
  }));
  view.querySelectorAll("[data-sort]").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    renderPurchases(status, a.dataset.sort);
  }));
  onSubmit(view.querySelector("#new"), async (f) => {
    await db.put("purchases", { id: newId(), ...readPurchase(f) });
    flash("Achat ajouté.");
    renderPurchases();
  });
}

export async function renderPurchase(id) {
  const [purchase, projects] = await Promise.all([db.get("purchases", id), db.all("projects")]);
  if (!purchase) {
    view.innerHTML = `${header("Achat", ["#/purchases", "Achats"])}<p class="muted">Achat introuvable.</p>`;
    return;
  }
  view.innerHTML = `${header(purchase.name, ["#/purchases", "Achats"])}
    <form id="edit" class="stack card">${purchaseFields(purchase, projects)}<button class="primary">Enregistrer</button></form>
    <button class="danger block" id="delete">Supprimer</button>`;
  onSubmit(view.querySelector("#edit"), async (f) => {
    await db.put("purchases", { ...purchase, ...readPurchase(f) });
    flash("Achat enregistré.");
    location.hash = "#/purchases";
  });
  view.querySelector("#delete").addEventListener("click", async () => {
    if (!confirm("Supprimer cet achat ?")) return;
    await db.remove("purchases", id);
    location.hash = "#/purchases";
  });
}

// --- Categories (fixed list in the local app) ---------------------------------------

export function renderCategories() {
  view.innerHTML = `${header("Catégories", ["#/more", "Plus"])}
    <p class="hint">Dans l'app locale, la liste est fixe : les sauvegardes y font référence.</p>
    ${[["Dépenses", "expense"], ["Revenus", "income"]].map(([title, kind]) => `<section><h2>${title}</h2>
      ${TREE[kind].map((p) => `<details class="card"><summary>${p.icon} ${esc(p.name)}
        <small class="muted">${p.children.length || ""}</small></summary>
        ${p.children.map((c) => `<p>${c.icon || ""} ${esc(c.name)}</p>`).join("") || '<p class="muted">Pas de sous-catégorie.</p>'}
      </details>`).join("")}</section>`).join("")}`;
}

// --- Bank import -----------------------------------------------------------------------

export async function renderImport() {
  const accounts = (await db.all("accounts")).filter((a) => !a.archived);
  view.innerHTML = `${header("Import bancaire", ["#/more", "Plus"])}
    <div class="card stack" id="pick">
      <label>Fichier OFX de ta banque <input type="file" id="ofx" accept=".ofx,.qfx"></label>
      <p class="muted">Les numéros de compte du fichier ne sont pas lus. Les opérations déjà importées sont ignorées.</p>
    </div>
    <form id="confirm" class="stack" hidden></form>
    <p><a href="#/classify">❓ Opérations à catégoriser</a></p>`;

  view.querySelector("#ofx").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let statements;
    try {
      statements = parseOfx(decodeOfx(new Uint8Array(await file.arrayBuffer())));
    } catch (error) {
      flash(error.message, true);
      e.target.value = "";
      return;
    }
    const form = view.querySelector("#confirm");
    view.querySelector("#pick").hidden = true;
    form.hidden = false;
    form.innerHTML = `<p>Le fichier contient ${statements.length} relevé${statements.length > 1 ? "s" : ""}. Choisis le compte de chacun.</p>
      ${statements.map((lines, i) => {
        const dates = lines.map((l) => l.date).sort();
        return `<label class="card">Relevé ${i + 1} · ${lines.length} opérations
          ${dates.length ? `<small class="muted">du ${frDate(dates[0])} au ${frDate(dates.at(-1))}</small>` : ""}
          <select name="account_${i}"><option value="">— Ne pas importer —</option>
            ${accountOptions(accounts, statements.length === 1 && i === 0 ? accounts[0]?.id : null)}</select></label>`;
      }).join("")}
      <button class="primary block">Importer</button>`;
    onSubmit(form, async (f) => {
      const rules = (await db.getMeta("rules")) || {};
      let existing = await db.allOperations();
      const total = { created: 0, skipped: 0, classified: 0 };
      const created = [];
      statements.forEach((lines, i) => {
        const accountId = f[`account_${i}`].value;
        if (!accountId) return;
        const result = importLines(existing, lines, rules, accountId);
        existing = existing.concat(result.operations);
        created.push(...result.operations);
        total.created += result.operations.length;
        total.skipped += result.skipped;
        total.classified += result.classified;
      });
      await db.putOperations(created);
      flash(`${total.created} opérations importées, dont ${total.classified} classées par tes règles. ${total.skipped} déjà présentes.`);
      location.hash = "#/classify";
    });
  });
}

// --- Backup ------------------------------------------------------------------------------

async function storageStatus() {
  if (!navigator.storage?.persisted) return "Stockage persistant non pris en charge par ce navigateur.";
  const persisted = await navigator.storage.persisted();
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  return [
    persisted ? "✅ Stockage persistant accordé." : "⚠️ Stockage non persistant : le navigateur peut effacer les données.",
    standalone ? "✅ Ouverte depuis l'écran d'accueil." : "⚠️ Ouverte dans un onglet : installe-la sur l'écran d'accueil.",
  ].join("<br>");
}

export async function renderBackup() {
  const data = await loadAll();
  const last = await db.getMeta("lastExportAt");
  const count = data.operations.length;
  view.innerHTML = `${header("Sauvegarde", ["#/more", "Plus"])}
    <div class="card">
      <p><strong>Les données restent sur ce téléphone.</strong> Aucun serveur.
        Si l'app est supprimée ou si iOS efface ses données, elles sont perdues.
        Exporte un fichier régulièrement (iCloud Drive, Fichiers…).</p>
      <p class="muted">${count} opération${count > 1 ? "s" : ""}, ${data.accounts.length} compte${data.accounts.length > 1 ? "s" : ""},
        ${data.projects.length} projet${data.projects.length > 1 ? "s" : ""}, ${data.purchases.length} achat${data.purchases.length > 1 ? "s" : ""}.
        Dernier export : ${last ? new Date(last).toLocaleString("fr-FR") : "jamais"}.</p>
      <button class="primary block" id="export">Exporter (JSON)</button>
      <a href="#" id="download" class="hint">ou télécharger le fichier</a>
    </div>
    <div class="card">
      <h2>Restaurer</h2>
      <p class="hint">Remplace toutes les données par celles du fichier.</p>
      <input type="file" id="restore" accept="application/json,.json">
    </div>
    <div class="card"><h2>Stockage</h2><p class="hint" id="storage">…</p></div>`;

  storageStatus().then((html) => { view.querySelector("#storage").innerHTML = html; });

  const makeFile = async () => {
    const rules = (await db.getMeta("rules")) || {};
    const json = JSON.stringify(buildExport(await loadAll(), new Date(), rules), null, 1);
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

  view.querySelector("#restore").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let restored;
    let rules;
    try {
      const parsed = JSON.parse(await file.text());
      restored = validateImport(parsed);
      rules = validateRules(parsed);
    } catch (error) {
      flash(error instanceof SyntaxError ? "Fichier JSON illisible." : error.message, true);
      e.target.value = "";
      return;
    }
    if (!confirm(`Remplacer les ${count} opérations actuelles par les ${restored.operations.length} du fichier ?`)) {
      e.target.value = "";
      return;
    }
    await db.replaceAll(restored);
    await db.setMeta("rules", rules);
    flash(`${restored.operations.length} opérations restaurées.`);
    renderBackup();
  });
}
