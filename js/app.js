// Open Budget local: single page app, no backend. Routes are URL hashes.
// Screens mirror the server app: Accueil, Opérations, ＋, Projets, Plus.

import * as db from "./db.js";
import { currentCategoryId, currentRules } from "./categories.js";
import { DEFAULT_ACCOUNT } from "./backup.js";
import { view, esc, thisMonth } from "./ui.js";
import {
  renderHome, renderAdd, renderOps, renderClassify, renderOp, renderReports,
} from "./screens-ops.js";
import {
  renderProjects, renderProject, renderMore, renderAccounts, renderAccount,
  renderPurchases, renderPurchase, renderCategories, renderImport, renderBackup, renderFeedback,
} from "./screens-more.js";
import { NOT_A_SCREEN } from "./feedback.js";

const MORE_PAGES = ["more", "accounts", "account", "purchases", "purchase", "categories", "import", "backup", "feedback"];

// Last screen seen outside the "Plus" menu, for the feedback form.
let lastHash = "";

function activeTab(page) {
  if (page === "home" || page === "reports") return "home";
  if (["ops", "op", "classify"].includes(page)) return "ops";
  if (["projects", "project"].includes(page)) return "projects";
  if (MORE_PAGES.includes(page)) return "more";
  return "";
}

async function route() {
  const [, page = "home", arg] = location.hash.split("/");
  const current = page || "home";
  if (!NOT_A_SCREEN.has(current)) lastHash = location.hash;
  document.querySelectorAll(".tabbar a").forEach((a) =>
    a.classList.toggle("active", a.dataset.tab === activeTab(current)));
  window.scrollTo(0, 0);
  try {
    switch (current) {
      case "add": await renderAdd(["income", "transfer"].includes(arg) ? arg : "expense"); break;
      case "ops": await renderOps(arg === "all" || /^\d{4}-\d{2}$/.test(arg) ? arg : thisMonth()); break;
      case "classify": await renderClassify(); break;
      case "op": await renderOp(arg); break;
      case "reports": await renderReports(); break;
      case "projects": await renderProjects(); break;
      case "project": await renderProject(arg); break;
      case "more": await renderMore(); break;
      case "accounts": await renderAccounts(); break;
      case "account": await renderAccount(arg); break;
      case "purchases": await renderPurchases(); break;
      case "purchase": await renderPurchase(arg); break;
      case "categories": renderCategories(); break;
      case "import": await renderImport(); break;
      case "backup": await renderBackup(); break;
      case "feedback": renderFeedback(lastHash); break;
      default: await renderHome();
    }
  } catch (error) {
    view.innerHTML = `<p class="error">Erreur : ${esc(error.message)}</p>`;
    console.error(error);
  }
}

/**
 * Bring stored data to the current model. Runs at each start, cheap:
 * - translate old category ids, in operations and learned rules;
 * - create the default current account (the app had no accounts before);
 * - put operations without an account in the first account.
 */
async function migrate() {
  let accounts = await db.all("accounts");
  if (!accounts.length) {
    await db.put("accounts", DEFAULT_ACCOUNT);
    accounts = [DEFAULT_ACCOUNT];
  }
  const changed = [];
  for (const op of await db.allOperations()) {
    const categoryId = op.categoryId == null ? null : currentCategoryId(op.categoryId);
    if (categoryId !== op.categoryId || !op.accountId) {
      changed.push({
        ...op, categoryId, accountId: op.accountId || accounts[0].id,
        toAccountId: op.toAccountId ?? null, reimbursedById: op.reimbursedById ?? null,
      });
    }
  }
  if (changed.length) await db.putOperations(changed);
  const rules = await db.getMeta("rules");
  if (rules) {
    const current = currentRules(rules);
    if (JSON.stringify(current) !== JSON.stringify(rules)) await db.setMeta("rules", current);
  }
}

window.addEventListener("hashchange", route);
migrate().catch((error) => console.error(error)).finally(route);

// Ask the browser not to evict our data. Safari grants it more easily
// to a Home Screen web app.
navigator.storage?.persist?.().catch(() => {});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("SW", error));
}
