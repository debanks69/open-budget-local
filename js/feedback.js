// User feedback: a short text with the screen it is about, sent through
// the iOS share sheet (iMessage, Notes...). No data of the app goes in it:
// only the screen name, the month shown, the app version and the iOS version.
// No DOM access here, so Node tests can import this module.

/** Screens the feedback form offers, keyed by route page. */
export const SCREENS = {
  home: "Accueil",
  ops: "Opérations",
  op: "Détail d'une opération",
  classify: "À classer",
  add: "Ajout d'une opération",
  projects: "Projets",
  project: "Détail d'un projet",
  accounts: "Comptes et épargne",
  account: "Détail d'un compte",
  purchases: "Liste d'achats",
  purchase: "Détail d'un achat",
  categories: "Catégories",
  reports: "Notes de frais",
  import: "Import bancaire (OFX)",
  backup: "Sauvegarde",
  other: "Autre / général",
};

/** Pages that do not change the remembered screen. */
export const NOT_A_SCREEN = new Set(["more", "feedback"]);

/**
 * Screen of a route hash ("#/ops/2026-11") as a page key and an optional
 * detail. Ids of records are dropped: a project id says nothing to a reader,
 * and a name could be personal.
 */
export function screenOf(hash) {
  const [, page = "home", arg] = (hash || "").split("/");
  const key = Object.hasOwn(SCREENS, page || "home") ? (page || "home") : "other";
  let detail = "";
  if (key === "ops") detail = /^\d{4}-\d{2}$/.test(arg) ? arg : arg === "all" ? "tout" : "";
  if (key === "add" && ["expense", "income", "transfer"].includes(arg)) detail = arg;
  return { key, detail };
}

/** "iOS 18.1" from a user agent, or "" when it is not an iPhone or iPad. */
export function iosVersion(userAgent) {
  const match = /(?:iPhone|CPU) OS (\d+)_(\d+)/.exec(userAgent || "");
  return match ? `iOS ${match[1]}.${match[2]}` : "";
}

/** Text sent to the developer. */
export function feedbackText({ key, detail, message, version, userAgent, standalone }) {
  const screen = (SCREENS[key] || SCREENS.other) + (detail ? ` (${detail})` : "");
  const context = [version && `version ${version}`, iosVersion(userAgent), standalone ? "écran d'accueil" : "navigateur"]
    .filter(Boolean)
    .join(", ");
  return `Retour Open Budget\nÉcran : ${screen}\n\n${message.trim()}\n\n— ${context}`;
}
