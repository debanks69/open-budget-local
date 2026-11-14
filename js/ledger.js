// Business rules shared by the screens: balances, monthly totals, projects.
// Same rules as src/open_budget/services.py. Pure functions, tested in Node.

export const ACCOUNT_KINDS = { current: "Compte courant", savings: "Épargne", investment: "Investissement" };
export const PURCHASE_STATUS = { considered: "Envisagé", planned: "Prévu", bought: "Acheté", abandoned: "Abandonné" };
export const PRIORITY = { low: "Basse", medium: "Moyenne", high: "Haute" };

/** Initial balance + income - expenses - outgoing + incoming transfers. */
export function accountBalance(account, operations) {
  let balance = account.initialBalanceCents || 0;
  for (const op of operations) {
    if (op.accountId === account.id) {
      balance += op.type === "income" ? op.amountCents : -op.amountCents;
    }
    if (op.type === "transfer" && op.toAccountId === account.id) balance += op.amountCents;
  }
  return balance;
}

/** [account, balance] pairs of the active accounts, by kind then name. */
export function balancesByAccount(accounts, operations, includeArchived = false) {
  const order = Object.keys(ACCOUNT_KINDS);
  return accounts
    .filter((a) => includeArchived || !a.archived)
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.name.localeCompare(b.name, "fr"))
    .map((a) => [a, accountBalance(a, operations)]);
}

export function kindTotal(balances, kind) {
  return balances.filter(([a]) => a.kind === kind).reduce((sum, [, b]) => sum + b, 0);
}

export function monthBounds(ym) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return [`${ym}-01`, `${ym}-${String(last).padStart(2, "0")}`];
}

export function shiftMonth(ym, delta) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Personal expenses and income of a month. Transfers and pro operations are out. */
export function monthSummary(operations, ym) {
  const [start, end] = monthBounds(ym);
  let expensesCents = 0;
  let incomeCents = 0;
  for (const op of operations) {
    if (op.isPro || op.date < start || op.date > end) continue;
    if (op.type === "expense") expensesCents += op.amountCents;
    if (op.type === "income") incomeCents += op.amountCents;
  }
  const savingsRate = incomeCents > 0 ? Math.round((100 * (incomeCents - expensesCents)) / incomeCents) : null;
  return { expensesCents, incomeCents, savingsRate };
}

export function projectSaved(project, contributions) {
  return contributions.filter((c) => c.projectId === project.id).reduce((sum, c) => sum + c.amountCents, 0);
}

export function projectProgress(project, saved) {
  if (project.targetCents <= 0) return 100;
  return Math.min(Math.round((100 * saved) / project.targetCents), 100);
}

/** Part of an operation not yet given to a project. */
export function unassignedCents(op, contributions) {
  const given = contributions.filter((c) => c.operationId === op.id).reduce((s, c) => s + c.amountCents, 0);
  return Math.max(op.amountCents - given, 0);
}

/** Mark pending pro expenses as paid back by this pro income. Return changed records. */
export function linkReimbursement(income, expenses) {
  return expenses.map((e) => ({ ...e, reimbursedById: income.id, reimbursementStatus: "reimbursed" }));
}
