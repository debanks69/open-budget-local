// Default categories, copied from src/open_budget/seed.py.
// Ids are stable slugs: exported files refer to them, so never rename an id.

const EXPENSE = [
  ["courses", "Courses", "🛒", []],
  ["restaurants", "Restaurants", "🍽️", []],
  ["logement", "Logement", "🏠", ["Loyer", "Énergie", "Internet & téléphone", "Assurance"]],
  ["transport", "Transport", "🚆", ["Carburant", "Transports en commun", "Train", "Voiture"]],
  ["loisirs", "Loisirs", "🎉", ["Sorties", "Sport", "Culture"]],
  ["abonnements", "Abonnements", "🔁", []],
  ["shopping", "Shopping", "🛍️", ["Vêtements", "High-tech", "Maison"]],
  ["sante", "Santé", "💊", []],
  ["voyages", "Voyages", "✈️", []],
  ["cadeaux", "Cadeaux", "🎁", []],
  ["impots-frais", "Impôts & frais", "🧾", ["Impôts", "Frais bancaires"]],
  ["divers", "Divers", "📦", []],
];

const INCOME = [
  ["salaire", "Salaire", "💼", []],
  ["remboursements", "Remboursements", "↩️", []],
  ["ventes", "Ventes", "🏷️", []],
  ["cadeaux-recus", "Cadeaux reçus", "🎁", []],
  ["autres-revenus", "Autres revenus", "➕", []],
];

function slug(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function build(kind, rows) {
  return rows.map(([id, name, icon, children], position) => ({
    id,
    name,
    icon,
    kind,
    position,
    children: children.map((child) => ({
      id: `${id}/${slug(child)}`,
      name: child,
      icon,
      kind,
      parentId: id,
    })),
  }));
}

export const TREE = { expense: build("expense", EXPENSE), income: build("income", INCOME) };

export const BY_ID = new Map();
for (const parent of [...TREE.expense, ...TREE.income]) {
  BY_ID.set(parent.id, parent);
  for (const child of parent.children) BY_ID.set(child.id, child);
}

/** Most used categories first, then the remaining top-level ones. */
export function topCategories(operations, kind, limit = 8) {
  const uses = new Map();
  for (const op of operations) {
    const cat = BY_ID.get(op.categoryId);
    if (op.type === kind && cat) uses.set(cat.id, (uses.get(cat.id) || 0) + 1);
  }
  const used = [...uses.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => BY_ID.get(id));
  const fill = TREE[kind].filter((c) => !uses.has(c.id));
  return [...used, ...fill].slice(0, limit);
}
