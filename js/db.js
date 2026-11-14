// Small IndexedDB wrapper. All data of the app lives here, on the device.
//
// Stores (same model as the server app, single user, no sharing):
//   accounts:      { id, name, kind, initialBalanceCents, archived }
//   operations:    { id, date, type, amountCents, accountId, toAccountId,
//                    categoryId, comment, label, importRef, isPro,
//                    reimbursementStatus, reimbursedById, createdAt }
//   projects:      { id, name, description, targetCents, targetDate }
//   contributions: { id, projectId, date, amountCents, accountId,
//                    operationId, comment }
//   purchases:     { id, name, categoryId, estimatedCents, priority,
//                    comment, status, projectId }
//   meta:          key/value pairs (lastExportAt, rules, lastAccountId)

const DB_NAME = "open-budget-local";
const DB_VERSION = 2;

/** Stores saved in the export file, in restore order. */
export const DATA_STORES = ["accounts", "operations", "projects", "contributions", "purchases"];

let dbPromise = null;

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
  });
}

export function openDb() {
  if (!dbPromise) {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) {
        const ops = db.createObjectStore("operations", { keyPath: "id" });
        ops.createIndex("date", "date");
        db.createObjectStore("meta");
      }
      if (event.oldVersion < 2) {
        for (const name of ["accounts", "projects", "contributions", "purchases"]) {
          db.createObjectStore(name, { keyPath: "id" });
        }
      }
    };
    dbPromise = promisify(request);
  }
  return dbPromise;
}

async function store(name, mode = "readonly") {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export async function all(name) {
  return promisify((await store(name)).getAll());
}

export async function get(name, id) {
  return promisify((await store(name)).get(id));
}

/** Write one or many records in one transaction: all or nothing. */
export async function put(name, records) {
  const s = await store(name, "readwrite");
  for (const record of Array.isArray(records) ? records : [records]) s.put(record);
  await done(s.transaction);
}

export async function remove(name, ids) {
  const s = await store(name, "readwrite");
  for (const id of Array.isArray(ids) ? ids : [ids]) s.delete(id);
  await done(s.transaction);
}

/** Replace all data stores in one transaction (restore of a backup). */
export async function replaceAll(data) {
  const db = await openDb();
  const tx = db.transaction(DATA_STORES, "readwrite");
  for (const name of DATA_STORES) {
    const s = tx.objectStore(name);
    s.clear();
    for (const record of data[name] || []) s.put(record);
  }
  await done(tx);
}

export async function getMeta(key) {
  return promisify((await store("meta")).get(key));
}

export async function setMeta(key, value) {
  const s = await store("meta", "readwrite");
  s.put(value, key);
  await done(s.transaction);
}

// Short names used by the screens.
export const allOperations = () => all("operations");
export const getOperation = (id) => get("operations", id);
export const putOperations = (ops) => put("operations", ops);
