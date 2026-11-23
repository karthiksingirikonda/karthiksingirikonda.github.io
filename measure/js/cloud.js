// Google sign-in, Firestore backup (Mumbai) and Drive files (one folder per job).
import { firebaseConfig, OWNER_EMAIL, DRIVE_ROOT_FOLDER } from './config.js';
import * as db from './db.js';
import { safeName } from './util.js';

let fb, app, auth, fs, user = null;
const state = { status: 'off', msg: '' }; // off | out | syncing | ok | waiting | error
const listeners = new Set();
export const onStatus = fn => { listeners.add(fn); fn(state); };
function setStatus(status, msg = '') { state.status = status; state.msg = msg; listeners.forEach(f => f(state)); }

export const configured = () => !!(firebaseConfig.apiKey && firebaseConfig.projectId);
export const currentUser = () => user;

export async function init() {
  if (!configured()) { setStatus('off', 'Cloud not connected yet – work is kept on this phone.'); return; }
  fb = await import('../vendor/firebase.js');
  app = fb.initializeApp(firebaseConfig);
  auth = fb.getAuth(app);
  fs = fb.getFirestore(app);
  try { const r = await fb.getRedirectResult(auth); if (r) keepToken(r); } catch (e) { /* ignore */ }
  fb.onAuthStateChanged(auth, async u => {
    if (u && u.email !== OWNER_EMAIL) { await fb.signOut(auth); setStatus('error', 'This app is only for ' + OWNER_EMAIL); return; }
    user = u;
    if (!u) { setStatus('out', 'Not signed in – work is kept on this phone.'); return; }
    await pull();
    flush();
  });
  window.addEventListener('online', () => flush());
  window.addEventListener('outbox', () => { clearTimeout(flush._t); flush._t = setTimeout(flush, 1500); });
}

function provider() {
  const p = new fb.GoogleAuthProvider();
  p.addScope('https://www.googleapis.com/auth/drive.file');
  p.setCustomParameters({ login_hint: OWNER_EMAIL, prompt: 'select_account' });
  return p;
}
function keepToken(result) {
  const cred = fb.GoogleAuthProvider.credentialFromResult(result);
  if (cred && cred.accessToken) sessionStorage.setItem('dtok', JSON.stringify({ t: cred.accessToken, exp: Date.now() + 55 * 60 * 1000 }));
}
export async function signIn() {
  if (!configured()) throw new Error('Cloud not connected yet. See Settings → Cloud setup.');
  try { keepToken(await fb.signInWithPopup(auth, provider())); }
  catch (e) {
    if (String(e.code).includes('popup')) await fb.signInWithRedirect(auth, provider());
    else throw e;
  }
}
export async function signOutNow() { if (auth) await fb.signOut(auth); sessionStorage.removeItem('dtok'); }

function driveToken() {
  try { const o = JSON.parse(sessionStorage.getItem('dtok')); if (o && o.exp > Date.now()) return o.t; } catch (e) { }
  return null;
}
export async function refreshDrive() { if (user) keepToken(await fb.reauthenticateWithPopup(user, provider())); }

// ---------- Firestore ----------
const STORES = ['jobs', 'drawings', 'points', 'sheets', 'rooms', 'files'];
const col = s => fb.collection(fs, 'users', user.uid, s);
const clean = o => { const c = { ...o }; delete c.blob; delete c.thumb; return JSON.parse(JSON.stringify(c)); };

async function pull() {
  setStatus('syncing', 'Getting your data…');
  try {
    for (const s of STORES) {
      const snap = await fb.getDocs(col(s));
      for (const d of snap.docs) {
        const remote = d.data();
        const local = await db.get(s, remote.id);
        if (!local || (remote.updatedAt || 0) > (local.updatedAt || 0)) {
          if (local && local.blob) remote.blob = local.blob;
          await db.put(s, remote, { silent: true });
        }
      }
    }
    window.dispatchEvent(new CustomEvent('pulled'));
  } catch (e) { setStatus('error', 'Could not get data: ' + e.message); }
}

let flushing = false;
export async function flush() {
  if (!user || flushing) { if (!user && configured()) setStatus('out', 'Not signed in – work is kept on this phone.'); return; }
  if (!navigator.onLine) { setStatus('waiting', 'No internet – will save when online.'); return; }
  flushing = true; setStatus('syncing', 'Saving…');
  let waitingFiles = 0;
  try {
    const box = (await db.all('outbox')).sort((a, b) => a.at - b.at);
    for (const e of box) {
      const ref = fb.doc(fs, 'users', user.uid, e.store, e.recId);
      if (e.op === 'del') { await fb.deleteDoc(ref); await db.clearOutbox(e.id); continue; }
      const rec = await db.get(e.store, e.recId);
      if (!rec) { await db.clearOutbox(e.id); continue; }
      if (e.store === 'files' && rec.trash) { // older version replaced – remove it from Drive too
        if (!driveToken()) { waitingFiles++; continue; }
        await driveFetch(`https://www.googleapis.com/drive/v3/files/${rec.driveId}`, { method: 'DELETE' }).catch(() => { });
        await fb.deleteDoc(ref); await db.del('files', rec.id, { silent: true }); await db.clearOutbox(e.id); continue;
      }
      if (e.store === 'files' && rec.blob && !rec.driveId) {
        if (!driveToken()) { waitingFiles++; continue; }
        rec.driveId = await uploadToDrive(rec);
        await db.put('files', rec, { silent: true });
      }
      await fb.setDoc(ref, clean(rec));
      await db.clearOutbox(e.id);
    }
    if (waitingFiles) setStatus('waiting', `${waitingFiles} file(s) waiting for Drive – tap the cloud dot and sign in again.`);
    else setStatus('ok', 'All saved.');
  } catch (e) { setStatus('error', 'Save problem: ' + e.message); }
  flushing = false;
}

// ---------- Drive ----------
async function driveFetch(url, opts = {}) {
  const t = driveToken(); if (!t) throw new Error('Drive sign-in expired');
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + t } });
  if (!r.ok) throw new Error('Drive ' + r.status);
  return r;
}
async function makeFolder(name, parent) {
  const r = await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) }),
  });
  return (await r.json()).id;
}
async function jobFolder(jobId) {
  let root = await db.getSetting('driveRoot', null);
  if (!root) { root = await makeFolder(DRIVE_ROOT_FOLDER); await db.setSetting('driveRoot', root); }
  const job = await db.get('jobs', jobId);
  if (!job.driveFolderId) { job.driveFolderId = await makeFolder(safeName(job.name), root); await db.put('jobs', job); }
  return job.driveFolderId;
}
async function uploadToDrive(rec) {
  const folder = await jobFolder(rec.jobId);
  const meta = { name: rec.name, parents: [folder] };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
  form.append('file', rec.blob, rec.name);
  const r = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', body: form });
  return (await r.json()).id;
}
export async function fetchFromDrive(driveId) {
  const r = await driveFetch(`https://www.googleapis.com/drive/v3/files/${driveId}?alt=media`);
  return r.blob();
}
export function driveFolderLink(job) { return job && job.driveFolderId ? `https://drive.google.com/drive/folders/${job.driveFolderId}` : null; }
