// Local storage on the phone (IndexedDB). Everything works offline.
const DB_NAME = 'measure';
const DB_VER = 1;
export const STORES = ['jobs', 'drawings', 'points', 'sheets', 'rooms', 'files', 'settings', 'outbox'];
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          const os = db.createObjectStore(s, { keyPath: 'id' });
          if (!['settings', 'outbox', 'jobs'].includes(s)) os.createIndex('jobId', 'jobId');
        }
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const os = t.objectStore(store);
    let out;
    Promise.resolve(fn(os)).then(v => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
  }));
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function get(store, id) { return tx(store, 'readonly', os => req(os.get(id))); }
export async function all(store) { return tx(store, 'readonly', os => req(os.getAll())); }
export async function byJob(store, jobId) { return tx(store, 'readonly', os => req(os.index('jobId').getAll(jobId))); }

// Save a record. Synced stores are queued for the cloud.
const SYNCED = ['jobs', 'drawings', 'points', 'sheets', 'rooms', 'files'];
export async function put(store, obj, { silent = false } = {}) {
  obj.updatedAt = obj.updatedAt && silent ? obj.updatedAt : Date.now();
  await tx(store, 'readwrite', os => req(os.put(obj)));
  if (!silent && SYNCED.includes(store)) await queue(store, obj.id, 'put');
  return obj;
}
export async function del(store, id, { silent = false } = {}) {
  await tx(store, 'readwrite', os => req(os.delete(id)));
  if (!silent && SYNCED.includes(store)) await queue(store, id, 'del');
}
async function queue(store, id, op) {
  await tx('outbox', 'readwrite', os => req(os.put({ id: store + ':' + id, store, recId: id, op, at: Date.now() })));
  window.dispatchEvent(new CustomEvent('outbox'));
}
export async function clearOutbox(key) { return tx('outbox', 'readwrite', os => req(os.delete(key))); }

export async function getSetting(key, def) { const r = await get('settings', key); return r ? r.value : def; }
export async function setSetting(key, value) { return tx('settings', 'readwrite', os => req(os.put({ id: key, value }))); }

export async function deleteJob(jobId) {
  for (const s of ['drawings', 'points', 'sheets', 'rooms', 'files']) {
    for (const r of await byJob(s, jobId)) await del(s, r.id);
  }
  await del('jobs', jobId);
}
