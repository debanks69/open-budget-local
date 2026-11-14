// Small IndexedDB wrapper. All data of the app lives here, on the device.
//
// Stores:
//   operations: { id, date, type, amountCents, categoryId, comment, label,
//                 importRef, isPro, reimbursementStatus, createdAt }
//   meta:       key/value pairs (lastExportAt, rules)

const DB_NAME = "open-budget-local";
const DB_VERSION = 1;

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
    request.onupgradeneeded = () => {
      const db = request.result;
      const ops = db.createObjectStore("operations", { keyPath: "id" });
      ops.createIndex("date", "date");
      db.createObjectStore("meta");
    };
    dbPromise = promisify(request);
  }
  return dbPromise;
}

async function store(name, mode = "readonly") {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export async function allOperations() {
  return promisify((await store("operations")).getAll());
}

export async function operationsBetween(startDate, endDate) {
  // Dates are ISO strings 'YYYY-MM-DD', so string order is date order.
  const index = (await store("operations")).index("date");
  return promisify(index.getAll(IDBKeyRange.bound(startDate, endDate)));
}

export async function putOperation(op) {
  const s = await store("operations", "readwrite");
  await promisify(s.put(op));
  await done(s.transaction);
}

/** Write many operations in one transaction: all or nothing. */
export async function putOperations(operations) {
  const s = await store("operations", "readwrite");
  for (const op of operations) s.put(op);
  await done(s.transaction);
}

export async function getOperation(id) {
  return promisify((await store("operations")).get(id));
}

export async function deleteOperation(id) {
  const s = await store("operations", "readwrite");
  s.delete(id);
  await done(s.transaction);
}

/** Replace all operations in one transaction: all or nothing. */
export async function replaceOperations(operations) {
  const s = await store("operations", "readwrite");
  s.clear();
  for (const op of operations) s.put(op);
  await done(s.transaction);
}

export async function getMeta(key) {
  return promisify((await store("meta")).get(key));
}

export async function setMeta(key, value) {
  const s = await store("meta", "readwrite");
  s.put(value, key);
  await done(s.transaction);
}
