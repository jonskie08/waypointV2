/* ------------------------------------------------------------------ *
 *  Waypoint — IndexedDB data layer (schema v2)
 *  Everything here is local to this device. Nothing is sent anywhere.
 *
 *  v1 stores: transactions, buckets, bills, settings
 *  v2 adds:   tuitionCharges, savingsAccounts, savingsGoals
 *             (buckets/legacy settings fields are kept, untouched,
 *              as a safety net — v2 stores are the source of truth
 *              once migration has run)
 * ------------------------------------------------------------------ */
const WaypointDB = (() => {
  const DB_NAME = "waypointDB";
  const DB_VERSION = 2;
  const STORES = [
    "transactions", "buckets", "bills", "settings",
    "tuitionCharges", "savingsAccounts", "savingsGoals",
  ];

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains("transactions")) {
          const s = db.createObjectStore("transactions", { keyPath: "id" });
          s.createIndex("date", "date");
          s.createIndex("type", "type");
        }
        if (!db.objectStoreNames.contains("buckets")) {
          db.createObjectStore("buckets", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("bills")) {
          db.createObjectStore("bills", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("tuitionCharges")) {
          const s = db.createObjectStore("tuitionCharges", { keyPath: "id" });
          s.createIndex("date", "date");
        }
        if (!db.objectStoreNames.contains("savingsAccounts")) {
          db.createObjectStore("savingsAccounts", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("savingsGoals")) {
          db.createObjectStore("savingsGoals", { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
  }

  async function getAll(store) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function get(store, id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function put(store, obj) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(obj);
      tx.oncomplete = () => resolve(obj);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function remove(store, id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clearStore(store) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function exportAll() {
    const data = {};
    for (const store of STORES) data[store] = await getAll(store);
    data.exportedAt = new Date().toISOString();
    data.appVersion = 2;
    return data;
  }

  async function importAll(data) {
    for (const store of STORES) {
      await clearStore(store);
      const rows = Array.isArray(data[store]) ? data[store] : [];
      for (const row of rows) await put(store, row);
    }
    return true;
  }

  /* ---------------------------------------------------------------- *
   *  Migration: v1 flat model -> v2 model
   *  Non-destructive: original stores/fields are left in place.
   *  Runs once; guarded by settings.schemaVersion.
   * ---------------------------------------------------------------- */
  async function migrateToV2IfNeeded() {
    const settings = await get("settings", "profile");
    if (!settings) return; // nothing to migrate yet (fresh install)
    if (settings.schemaVersion >= 2) return; // already migrated

    const transactions = await getAll("transactions");
    const buckets = await getAll("buckets");

    // --- Tuition: turn settings.tuitionDue into an initial charge,
    //     and rename old 'tuition' transactions to 'tuitionPayment'. ---
    const existingCharges = await getAll("tuitionCharges");
    if (existingCharges.length === 0 && (settings.tuitionDue || 0) > 0) {
      const earliestTuitionTx = transactions
        .filter(t => t.type === "tuition")
        .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
      await put("tuitionCharges", {
        id: uid(),
        amount: Number(settings.tuitionDue) || 0,
        date: (earliestTuitionTx && earliestTuitionTx.date) || settings.tuitionDueDate || todayISOForMigration(),
        note: "Starting balance (migrated from V1)",
        createdAt: Date.now(),
      });
    }
    for (const t of transactions) {
      if (t.type === "tuition") {
        t.type = "tuitionPayment";
        await put("transactions", t);
      }
    }

    // --- Savings: turn each old bucket into a savingsAccount, and,
    //     if it had a target, a linked savingsGoal. ---
    const existingAccounts = await getAll("savingsAccounts");
    if (existingAccounts.length === 0 && buckets.length > 0) {
      for (const b of buckets) {
        const account = {
          id: b.id, // keep same id so existing 'savings' transactions still line up
          name: b.name,
          balance: Number(b.current) || 0,
          interestRate: 0, // "No interest" by default; user can turn it on
          monthlyGrowthTarget: null,
          balanceHistory: [{ date: todayISOForMigration(), balance: Number(b.current) || 0 }],
          createdAt: Date.now(),
        };
        await put("savingsAccounts", account);

        if (b.target && Number(b.target) > 0) {
          await put("savingsGoals", {
            id: uid(),
            name: b.name,
            target: Number(b.target) || 0,
            current: Number(b.current) || 0,
            linkedAccountId: account.id,
            monthlyContribution: 0,
            createdAt: Date.now(),
          });
        }
      }
    }
    // Tag old 'savings' transactions with accountId matching the bucket id
    for (const t of transactions) {
      if (t.type === "savings" && !t.accountId && t.bucketId) {
        t.accountId = t.bucketId;
        await put("transactions", t);
      }
    }

    settings.schemaVersion = 2;
    if (!settings.theme) settings.theme = "system";
    await put("settings", settings);
  }

  function todayISOForMigration() {
    return new Date().toISOString().slice(0, 10);
  }

  return {
    open, uid, getAll, get, put, remove, clearStore,
    exportAll, importAll, migrateToV2IfNeeded, STORES,
  };
})();
