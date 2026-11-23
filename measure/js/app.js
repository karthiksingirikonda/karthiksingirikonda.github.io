// Measure – app shell, jobs, settings, guide.
import * as db from './db.js';
import * as cloud from './cloud.js';
import { esc, toast, dateText } from './util.js';
import { sheet, showHelp, confirmBox, mountTip } from './ui.js';
import { guideHtml, resetTips } from './help.js';
import { renderDrawings, renderDrawingView, renderCompare } from './ui-drawing.js';
import { renderSheet } from './ui-sheet.js';
import { renderPlan } from './ui-plan.js';
import { renderAR } from './ar.js';
import { renderCount } from './ui-count.js';

const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('back');
let helpKey = 'jobs';
export const setHelp = k => { helpKey = k; };
document.getElementById('info').onclick = () => showHelp(helpKey);

// cloud status dot
const dot = document.getElementById('cloud');
cloud.onStatus(s => {
  dot.className = 'cloud ' + ({ ok: 'g', syncing: 'a', waiting: 'a', out: 'a', off: 'x', error: 'r' }[s.status] || 'x');
  dot.title = s.msg;
});
dot.onclick = async () => {
  const u = cloud.currentUser();
  const st = dot.title || '';
  const s = sheet(`<h2>Backup</h2><p>${esc(st)}</p>${!cloud.configured() ? '<p class="muted">Setup steps are in Settings → Cloud setup.</p>' :
    u ? `<p>Signed in as <b>${esc(u.email)}</b></p><div class="row"><button class="btn" id="c-now">Save now</button><button class="btn ghost" id="c-drive">Sign in again for Drive</button></div>` :
      '<button class="btn" id="c-in">Sign in with Google</button>'}`);
  const q = id => s.el.querySelector(id);
  if (q('#c-in')) q('#c-in').onclick = async () => { try { await cloud.signIn(); s.close(); } catch (e) { toast(e.message); } };
  if (q('#c-now')) q('#c-now').onclick = () => { cloud.flush(); s.close(); };
  if (q('#c-drive')) q('#c-drive').onclick = async () => { try { await cloud.refreshDrive(); cloud.flush(); s.close(); } catch (e) { toast(e.message); } };
};

export function setTitle(t, back) {
  titleEl.textContent = t;
  backBtn.hidden = !back;
  backBtn.onclick = () => { location.hash = back; };
}

async function route() {
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/');
  view.innerHTML = '';
  window.scrollTo(0, 0);
  try {
    if (parts[0] === 'job' && parts[1]) return await jobScreen(parts[1], parts[2] || 'ar');
    if (parts[0] === 'drawing' && parts[1]) { setHelp('drawing'); return await renderDrawingView(view, parts[1], { setTitle }); }
    if (parts[0] === 'guide') return guideScreen();
    if (parts[0] === 'settings') return await settingsScreen();
    return await jobsScreen();
  } catch (e) { console.error(e); view.innerHTML = `<div class="card r">Something went wrong: ${esc(e.message)}</div>`; }
}
window.addEventListener('hashchange', route);
window.addEventListener('pulled', () => { if (!document.querySelector('.sheet-wrap') && !document.querySelector('.drawing-stage')) route(); });

// ---------- Jobs ----------
async function jobsScreen() {
  setHelp('jobs'); setTitle('Measure');
  const jobs = (await db.all('jobs')).sort((a, b) => b.updatedAt - a.updatedAt);
  const pts = await db.all('points');
  view.innerHTML = `
    <div class="row">
      <button class="btn big" id="new">＋ New job</button>
      <button class="btn big ghost" id="quick">⚡ Quick measure</button>
    </div>
    <div id="list">${jobs.length ? '' : '<div class="empty">No jobs yet. Tap ＋ New job to start.</div>'}</div>
    <div class="row foot"><a class="link" href="#/guide">📘 How to measure</a><a class="link" href="#/settings">⚙ Settings</a></div>`;
  await mountTip(view, 'jobs');
  const list = view.querySelector('#list');
  for (const j of jobs) {
    const jp = pts.filter(p => p.jobId === j.id);
    const tol = await db.getSetting('tolerance', 10);
    const bad = jp.filter(p => p.siteMm != null && p.drawingMm != null && Math.abs(p.siteMm - p.drawingMm) > tol).length;
    const a = document.createElement('a');
    a.className = 'card job'; a.href = `#/job/${j.id}`;
    a.innerHTML = `<b>${esc(j.name)}</b><span class="muted">${esc(j.site || '')}</span>
      <span class="chips"><i>${jp.length} points</i>${bad ? `<i class="r">${bad} mismatch</i>` : ''}<i>${dateText(j.updatedAt)}</i></span>`;
    list.appendChild(a);
  }
  view.querySelector('#new').onclick = () => newJob();
  view.querySelector('#quick').onclick = () => quickMeasure();
}

function newJob(after) {
  const s = sheet(`<h2>New job</h2>
    <label>Job name<input id="j-name" placeholder="e.g. RR Anna Nagar"></label>
    <label>Site / location<input id="j-site" placeholder="e.g. Chennai"></label>
    <label>Client<input id="j-client" placeholder="optional"></label>
    <button class="btn wide" id="j-save">Create</button>`);
  s.el.querySelector('#j-save').onclick = async () => {
    const name = s.el.querySelector('#j-name').value.trim();
    if (!name) return toast('Type the job name');
    const job = await db.put('jobs', { id: db.uid(), name, site: s.el.querySelector('#j-site').value.trim(), client: s.el.querySelector('#j-client').value.trim(), createdAt: Date.now() });
    s.close();
    location.hash = after ? `#/job/${job.id}/${after}` : `#/job/${job.id}`;
  };
}

async function quickMeasure() {
  const opts = [
    ['ar', '📷 Measure with camera', 'Length, height, on wall, full room, pillar (rough ±1–2 cm).'],
    ['count', '🔢 Count from photo', 'Bricks, pillars, tiles, lights – photo + tap one item.'],
    ['drawings', '📄 Check a size against the drawing', 'Upload / open the drawing, tap the size, type the tape reading.'],
    ['plan', '🏠 Room sizes (type by hand)', 'Type L × W × H or wall by wall, photo per wall, areas worked out.'],
    ['sheet', '🧾 Measurement sheet for billing', 'Pune format with the 3-way check.'],
  ];
  const jobs = (await db.all('jobs')).sort((a, b) => b.updatedAt - a.updatedAt);
  const s = sheet(`<h2>⚡ Quick measure</h2><p class="muted">What do you want to do?</p>
    ${opts.map(o => `<button class="opt" data-k="${o[0]}"><b>${o[1]}</b><span>${o[2]}</span></button>`).join('')}`);
  s.el.querySelectorAll('.opt').forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    s.el.innerHTML = `<button class="sheet-x" data-close>✕</button><h2>Which job?</h2>
      ${jobs.slice(0, 8).map(j => `<button class="opt" data-j="${j.id}"><b>${esc(j.name)}</b><span>${esc(j.site || '')}</span></button>`).join('')}
      <button class="btn wide" id="q-new">＋ New job</button>`;
    s.el.querySelectorAll('[data-j]').forEach(x => x.onclick = () => { s.close(); location.hash = `#/job/${x.dataset.j}/${k}`; });
    s.el.querySelector('#q-new').onclick = () => { s.close(); newJob(k); };
  });
}

// ---------- One job ----------
const TABS = [['ar', '📷 Measure with camera', 'ar'], ['count', '🔢 Count from photo', 'count'], ['drawings', '📄 Drawing check', 'job'], ['compare', '⚖ Drawing vs Site', 'compare'], ['sheet', '🧾 Measurement sheet', 'sheet'], ['plan', '🏠 Room sizes (type)', 'plan']];
async function jobScreen(jobId, tab) {
  tab = tab || 'ar';
  const job = await db.get('jobs', jobId);
  if (!job) { location.hash = '#/'; return; }
  setTitle(job.name, '#/');
  view.innerHTML = `<nav class="tabs">${TABS.map(t => `<a href="#/job/${jobId}/${t[0]}" class="${t[0] === tab ? 'on' : ''}">${t[1]}</a>`).join('')}</nav>
    <div id="tab"></div>
    <div class="row foot"><button class="link" id="j-edit">✎ Edit job</button><button class="link r" id="j-del">🗑 Delete job</button></div>`;
  const el = view.querySelector('#tab');
  const on = view.querySelector('.tabs a.on'); if (on) on.scrollIntoView({ inline: 'center', block: 'nearest' });
  const t = TABS.find(x => x[0] === tab) || TABS[0];
  setHelp(t[2] === 'job' ? 'job' : t[2]);
  if (tab === 'compare') await renderCompare(el, job);
  else if (tab === 'sheet') await renderSheet(el, job);
  else if (tab === 'plan') await renderPlan(el, job);
  else if (tab === 'ar') await renderAR(el, job);
  else if (tab === 'count') await renderCount(el, job);
  else await renderDrawings(el, job);
  view.querySelector('#j-del').onclick = async () => {
    if (await confirmBox(`Delete job "${esc(job.name)}" and everything in it from the app? (Files already in Drive stay there.)`, 'Delete')) { await db.deleteJob(jobId); location.hash = '#/'; }
  };
  view.querySelector('#j-edit').onclick = () => {
    const s = sheet(`<h2>Edit job</h2><label>Job name<input id="e-n" value="${esc(job.name)}"></label><label>Site<input id="e-s" value="${esc(job.site || '')}"></label><label>Client<input id="e-c" value="${esc(job.client || '')}"></label><button class="btn wide" id="e-ok">Save</button>`);
    s.el.querySelector('#e-ok').onclick = async () => { job.name = s.el.querySelector('#e-n').value.trim() || job.name; job.site = s.el.querySelector('#e-s').value.trim(); job.client = s.el.querySelector('#e-c').value.trim(); await db.put('jobs', job); s.close(); route(); };
  };
}

// ---------- Guide ----------
function guideScreen() {
  setHelp('jobs'); setTitle('How to measure', '#/');
  view.innerHTML = `<div class="guide-wrap">${guideHtml()}</div>`;
}

// ---------- Settings ----------
async function settingsScreen() {
  setHelp('settings'); setTitle('Settings', '#/');
  const tol = await db.getSetting('tolerance', 10);
  const unit = await db.getSetting('unit', 'mm');
  const by = await db.getSetting('measuredBy', 'Karthik S');
  const tips = await db.getSetting('tipsOn', true);
  const u = cloud.currentUser();
  view.innerHTML = `
    <div class="card"><label>Tolerance (mm) – difference still OK<input id="s-tol" type="number" inputmode="decimal" value="${tol}"></label>
    <label>Show sizes in<select id="s-unit"><option value="mm">mm</option><option value="m">metres</option><option value="ftin">feet-inch</option></select></label>
    <label>"Measured by" name on sheets<input id="s-by" value="${esc(by)}"></label>
    <label class="check"><input type="checkbox" id="s-tips" ${tips ? 'checked' : ''}> Show 💡 tips</label>
    <button class="btn ghost" id="s-reset">Show all tips again</button></div>
    <div class="card"><h3>Account & backup</h3>
      ${!cloud.configured() ? `<p>Cloud not connected yet. Everything is kept on this phone.</p>` :
      u ? `<p>Signed in as <b>${esc(u.email)}</b></p><button class="btn ghost" id="s-out">Sign out</button>` : `<button class="btn" id="s-in">Sign in with Google</button>`}
    </div>
    <details class="card"><summary>Cloud setup (one time)</summary>
      <ol class="small"><li>Firebase project "Karthik Apps" with Firestore in Mumbai.</li><li>Google sign-in turned on.</li><li>Drive permission allowed when you sign in.</li><li>The web settings pasted into the app.</li></ol>
      <p class="muted small">These steps are done once on the laptop. After that, sign in here.</p></details>
    <p class="muted small center">Measure · version 1.0</p>`;
  view.querySelector('#s-unit').value = unit;
  const q = id => view.querySelector(id);
  q('#s-tol').onchange = async e => { const v = Number(e.target.value); if (v >= 0) { await db.setSetting('tolerance', v); toast('Saved'); } };
  q('#s-unit').onchange = async e => { await db.setSetting('unit', e.target.value); toast('Saved'); };
  q('#s-by').onchange = async e => { await db.setSetting('measuredBy', e.target.value.trim()); toast('Saved'); };
  q('#s-tips').onchange = async e => { await db.setSetting('tipsOn', e.target.checked); };
  q('#s-reset').onclick = async () => { await resetTips(); q('#s-tips').checked = true; toast('Tips will show again'); };
  if (q('#s-in')) q('#s-in').onclick = async () => { try { await cloud.signIn(); } catch (e) { toast(e.message); } };
  if (q('#s-out')) q('#s-out').onclick = async () => { await cloud.signOutNow(); route(); };
}

// ---------- start ----------
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
cloud.init().catch(e => console.warn(e));
route();
