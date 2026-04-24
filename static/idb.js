// ══════════════════════════════════════════════════════════════════════
// IndexedDB — cache offline + fila de escritas pendentes
// ══════════════════════════════════════════════════════════════════════
const IDB_NAME    = 'solmaior';
const IDB_VERSION = 1;

let _db = null;

function openIDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('api_cache'))
        db.createObjectStore('api_cache');           // chave = URL da API
      if (!db.objectStoreNames.contains('pending'))
        db.createObjectStore('pending', { keyPath: 'qid', autoIncrement: true });
    };
    req.onsuccess = e => { _db = e.target.result; resolve(_db); };
    req.onerror   = e => reject(e.target.error);
  });
}

async function idbGet(store, key) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbPut(store, key, value) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

async function idbGetAll(store) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const items = [];
    const req = db.transaction(store, 'readonly').objectStore(store).openCursor();
    req.onsuccess = e => {
      const c = e.target.result;
      if (c) { items.push(c.value); c.continue(); }
      else resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

async function idbAdd(store, value) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).add(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbDelete(store, key) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

async function idbClear(store) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).clear();
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// Retorna todos os itens com suas chaves
async function idbGetAllWithKeys(store) {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const items = [];
    const req = db.transaction(store, 'readonly').objectStore(store).openCursor();
    req.onsuccess = e => {
      const c = e.target.result;
      if (c) { items.push({ key: c.key, value: c.value }); c.continue(); }
      else resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}
