// Default categories, copied from src/open_budget/seed.py.
// Ids are stable slugs: exported files refer to them, so never rename an id.
// Old ids of the first list stay readable through LEGACY_IDS.

const EXPENSE = [
  ["charges-fixes", "Loyer & charges fixes", "🏠", [
    ["Logement", "🔑"], ["Électricité", "⚡"], ["Internet & box", "🌐"], ["Assurances", "🛡️"],
    ["Impôts & frais bancaires", "🧾"],
  ]],
  ["essentiel", "Dépenses essentielles & quotidien", "🧺", [
    ["Courses", "🛒"], ["Cantine", "🥪"], ["Transport", "🚆"], ["Santé", "💊"],
    ["Abonnements & télécoms", "📱"], ["Animaux", "🐾"], ["Maison & bricolage", "🛠️"], ["Coiffure & soins", "💇"],
  ]],
  ["perso", "Loisirs & dépenses personnelles", "🎉", [
    ["Restaurants", "🍽️"], ["Cafés & bars", "☕"], ["Alcool", "🍷"], ["Tabac", "🚬"], ["Sport", "🥊"],
    ["Cinéma", "🎬"], ["Concerts & spectacles", "🎭"], ["Livres & jeux", "📚"], ["Loisirs & sorties", "🎟️"],
    ["Shopping", "🛍️"], ["Voyages", "✈️"], ["Cadeaux & dons", "🎁"],
  ]],
  ["virements", "Virements à des proches", "💸", [["Famille", "👨‍👩‍👧"], ["Amis", "🧑‍🤝‍🧑"], ["Autres personnes", "🤝"]]],
  ["epargne", "Épargne & investissements", "💰", []],
  ["pro", "Dépenses pro", "💼", [["Hôtels", "🏨"], ["Repas", "🍴"], ["Autres", "📎"]]],
  ["import-depense", "Import", "📥", []],
];

const INCOME = [
  ["revenus", "Revenus", "💶", [
    ["Salaire", "💵"], ["Revenus d'investissement", "📈"], ["Remboursements", "↩️"],
    ["Ventes", "🏷️"], ["Cadeaux reçus", "🎀"], ["Virements de proches", "🤲"], ["Autres revenus", "➕"],
  ]],
  ["import-revenu", "Import", "📥", []],
];

/** Category that receives imported operations no rule could classify. */
export const IMPORT_ID = { expense: "import-depense", income: "import-revenu" };

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
    children: children.map(([child, childIcon]) => ({
      id: `${id}/${slug(child)}`,
      name: child,
      icon: childIcon,
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

// Ids of the first category list (before 2026-11-14) and their new id,
// then ids removed later. null means "no category".
export const LEGACY_IDS = {
  "courses": "essentiel/courses",
  "restaurants": "perso/restaurants",
  "logement": "charges-fixes/logement",
  "logement/loyer": "charges-fixes/logement",
  "logement/energie": "charges-fixes/electricite",
  "logement/internet-telephone": "essentiel/abonnements-telecoms",
  "logement/assurance": "charges-fixes/assurances",
  "transport": "essentiel/transport",
  "transport/carburant": "essentiel/transport",
  "transport/transports-en-commun": "essentiel/transport",
  "transport/train": "essentiel/transport",
  "transport/voiture": "essentiel/transport",
  "loisirs": "perso/loisirs-sorties",
  "loisirs/sorties": "perso/loisirs-sorties",
  "loisirs/sport": "perso/sport",
  "loisirs/culture": "perso/loisirs-sorties",
  "abonnements": "essentiel/abonnements-telecoms",
  "shopping": "perso/shopping",
  "shopping/vetements": "perso/shopping",
  "shopping/high-tech": "perso/shopping",
  "shopping/maison": "perso/shopping",
  "sante": "essentiel/sante",
  "voyages": "perso/voyages",
  "cadeaux": "perso/cadeaux-dons",
  "impots-frais": "charges-fixes/impots-frais-bancaires",
  "impots-frais/impots": "charges-fixes/impots-frais-bancaires",
  "impots-frais/frais-bancaires": "charges-fixes/impots-frais-bancaires",
  "divers": null,
  "salaire": "revenus/salaire",
  "remboursements": "revenus/remboursements",
  "ventes": "revenus/ventes",
  "cadeaux-recus": "revenus/cadeaux-recus",
  "autres-revenus": "revenus/autres-revenus",
  // "Charges" split into Électricité and Internet & box (2026-11-16): its
  // operations go back to "À catégoriser".
  "charges-fixes/charges": "import-depense",
};

/** Current id for a stored id: legacy ids are translated. */
export function currentCategoryId(id) {
  return Object.hasOwn(LEGACY_IDS, id) ? LEGACY_IDS[id] : id;
}

/** Rules with current ids. A rule that now gives "Import" or no category is dropped. */
export function currentRules(rules) {
  const out = {};
  for (const [key, id] of Object.entries(rules || {})) {
    const categoryId = currentCategoryId(id);
    if (BY_ID.has(categoryId) && !Object.values(IMPORT_ID).includes(categoryId)) out[key] = categoryId;
  }
  return out;
}

/** Most used categories first, then the remaining leaf categories. */
export function topCategories(operations, kind, limit = 8) {
  const uses = new Map();
  for (const op of operations) {
    const cat = BY_ID.get(op.categoryId);
    if (op.type === kind && cat && cat.id !== IMPORT_ID[kind]) uses.set(cat.id, (uses.get(cat.id) || 0) + 1);
  }
  const used = [...uses.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => BY_ID.get(id));
  const leaves = TREE[kind]
    .filter((p) => p.id !== IMPORT_ID[kind])
    .flatMap((p) => (p.children.length ? p.children : [p]));
  const fill = leaves.filter((c) => !uses.has(c.id));
  return [...used, ...fill].slice(0, limit);
}
