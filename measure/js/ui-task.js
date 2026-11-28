// ＋ New task · Photo first (tap to number) · Result worked 2 ways · Share (locked until ✓ all match).
import * as db from './db.js';
import { esc, toast, download, dateText, fileDate, safeName, needPdfMaker } from './util.js';
import { sheet as popup, confirmBox } from './ui.js';
import { saveJobFile, getBlob } from './ui-drawing.js';
import { loadSheet } from './ui-sheet.js';
import { catOptions } from './categories.js';
import { HEADER, sheetExcel } from './sheet.js';
import { workOut, areaKind, q2, toSheet, numbersText, parentOf } from './calc.js';
import { mmToFtIn } from './units.js';
import { sizeMm } from './calc.js';

export const TASK_TYPES = [
  ['wall', '🧱 Wall to wall', 'One side: length × height, doors / windows minus.'],
  ['room', '🏠 Full room', 'All 4 walls + ceiling + floor in one go.'],
  ['height', '↕ Height / board', 'One height, a board, a shutter, a gap.'],
  ['sheet', '🧾 Item by item (sheet)', 'Pune-format sheet: item, size, unit, qty.'],
  ['photo', '📸 Not sure – photo first', 'Take a photo, tap each area, give sizes.'],
];
const TYPE_NAME = Object.fromEntries(TASK_TYPES.map(t => [t[0], t[1]]));
const DEF_CAT = { wall: 'Wall painting', room: 'Wall painting', height: '__other', photo: 'Wall painting' };

// ---------- ＋ New task ----------
export async function newTaskSheet(newJob) {
  const jobs = (await db.all('jobs')).sort((a, b) => b.updatedAt - a.updatedAt);
  const last = await db.getSetting('lastJob', jobs[0] && jobs[0].id);
  const s = popup(`<h2>＋ New task – what are you measuring?</h2>
    ${TASK_TYPES.map(t => `<button class="opt${t[0] === 'photo' ? ' hl' : ''}" data-t="${t[0]}"><b>${t[1]}</b><span>${t[2]}</span></button>`).join('')}
    <label>Job<select id="t-job">${jobs.map(j => `<option value="${j.id}" ${j.id === last ? 'selected' : ''}>${esc(j.name)}${j.site ? ' – ' + esc(j.site) : ''}</option>`).join('')}<option value="__new">＋ New job…</option></select></label>`);
  const sel = s.el.querySelector('#t-job');
  if (!jobs.length) sel.value = '__new';
  s.el.querySelectorAll('[data-t]').forEach(b => b.onclick = async () => {
    const type = b.dataset.t;
    const go = async jobId => {
      await db.setSetting('lastJob', jobId);
      if (type === 'sheet') { location.hash = `#/job/${jobId}/sheet`; return; }
      const t = await createTask(jobId, type);
      location.hash = `#/task/${t.id}`;
    };
    s.close();
    if (sel.value === '__new') newJob(null, go); else go(sel.value);
  });
}

export async function createTask(jobId, type) {
  const n0 = (await db.byJob('points', jobId)).filter(p => p.kind === 'task').length + 1;
  const t = { id: db.uid(), jobId, kind: 'task', type, label: `${({ wall: 'Wall to wall', room: 'Full room', height: 'Height / board', photo: 'Photo first' })[type] || 'Task'} ${n0}`, marks: [], shares: [], edited: Date.now(), createdAt: Date.now() };
  if (type === 'room') {
    t.marks = [1, 2, 3, 4].map(i => ({ n: i, cat: 'Wall painting', desc: `Wall ${i}`, nos: 1, L: '', H: '' }))
      .concat([{ n: 5, cat: 'Ceiling painting', desc: 'Ceiling', nos: 1, L: '', H: '' }, { n: 6, cat: 'Tile laying', desc: 'Floor', nos: 1, L: '', H: '' }]);
  }
  if (type === 'height') t.marks = [{ n: 1, cat: '__other', heading: 'Board', measure: 'LxH', desc: 'Board', nos: 1, L: '', H: '' }];
  return db.put('points', t);
}

// ---------- tasks list inside a job ----------
export async function renderTasks(el, job) {
  const tasks = (await db.byJob('points', job.id)).filter(p => p.kind === 'task').sort((a, b) => b.updatedAt - a.updatedAt);
  el.innerHTML = `<button class="btn big wide" id="tk-new">＋ New task in this job</button><div id="tl">${tasks.length ? '' : '<div class="empty">No tasks yet.</div>'}</div>`;
  const tl = el.querySelector('#tl');
  for (const t of tasks) {
    const r = workOut(t.marks);
    const v = t.shares.length;
    const a = document.createElement('a'); a.className = 'prow ' + (r.allOk ? 'g' : 'r'); a.href = `#/task/${t.id}`;
    a.innerHTML = `<span class="pin static ${r.allOk ? 'g' : 'r'}">${t.marks.length}</span><div><b>${esc(t.label)}</b><small>${esc(TYPE_NAME[t.type] || '')} · ${r.allOk ? '✓ all match' : r.problems + ' to fix'}${v ? ` · shared V${v}` : ''}</small></div><span class="small muted">${dateText(t.updatedAt)}</span>`;
    tl.appendChild(a);
  }
  el.querySelector('#tk-new').onclick = async () => {
    const s = popup(`<h2>＋ New task</h2>${TASK_TYPES.map(t => `<button class="opt" data-t="${t[0]}"><b>${t[1]}</b><span>${t[2]}</span></button>`).join('')}`);
    s.el.querySelectorAll('[data-t]').forEach(b => b.onclick = async () => { s.close(); if (b.dataset.t === 'sheet') { location.hash = `#/job/${job.id}/sheet`; return; } const t = await createTask(job.id, b.dataset.t); location.hash = `#/task/${t.id}`; });
  };
}

// ---------- the task screen ----------
export async function renderTask(view, id, { setTitle }) {
  const t = await db.get('points', id);
  if (!t) { location.hash = '#/'; return; }
  const job = await db.get('jobs', t.jobId);
  setTitle(t.label, `#/job/${t.jobId}/tasks`);
  let img = null, W = 0, H = 0, mode = 'add', moving = null, retap = null;
  if (t.photoId) { try { img = await loadImg(await getBlob(t.photoId)); } catch (e) { toast(e.message); } }
  let saveT;
  const save = () => { t.edited = Date.now(); clearTimeout(saveT); saveT = setTimeout(() => db.put('points', t), 400); };

  view.innerHTML = `<div class="card">
    <label>Task name<input id="tk-label" data-on value="${esc(t.label)}"></label>
    <div id="tk-photo"></div>
    <div id="tk-tools" class="tb4"></div>
    <p class="small muted" id="tk-step"></p></div>
    <div id="tk-cards"></div>
    <button class="btn ghost wide" id="tk-addnp">＋ Add a number without photo</button>
    <button class="btn wide" id="tk-res">✓ Work out & check</button>
    <div class="row foot"><button class="link r" id="tk-del">🗑 Delete task</button></div>`;
  const q = s => view.querySelector(s);
  q('#tk-label').oninput = e => { t.label = e.target.value; save(); };

  // photo area
  const canvas = document.createElement('canvas'); canvas.className = 'tk-cv';
  function photoBox() {
    const box = q('#tk-photo');
    if (!img) {
      box.innerHTML = `<div class="row"><label class="btn big">📷 Take photo<input type="file" id="tk-cam" accept="image/*" capture="environment" hidden></label><label class="btn big ghost">🖼 Gallery<input type="file" id="tk-gal" accept="image/*" hidden></label></div>${t.type === 'room' || t.type === 'height' ? '<p class="small muted">Photo is optional here – you can fill the sizes below straight away.</p>' : '<p class="small muted">Take a photo of the side, then tap each area on it.</p>'}`;
      const on = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; const rec = await saveJobFile(t.jobId, `${safeName(job ? job.name : 'Job')} – ${safeName(t.label)}.jpg`, f, 'task-photo', 'taskph-' + t.id); t.photoId = rec.id; img = await loadImg(f); await db.put('points', t); photoBox(); tools(); draw(); };
      box.querySelector('#tk-cam').onchange = on; box.querySelector('#tk-gal').onchange = on;
      return;
    }
    const sc = Math.min(1, 1400 / img.naturalWidth); W = Math.round(img.naturalWidth * sc); H = Math.round(img.naturalHeight * sc);
    canvas.width = W; canvas.height = H;
    box.innerHTML = ''; const st = document.createElement('div'); st.className = 'count-stage'; st.appendChild(canvas); box.appendChild(st);
    draw();
  }
  function tools() {
    const tb = q('#tk-tools');
    if (!img) { tb.innerHTML = ''; q('#tk-step').textContent = ''; return; }
    tb.innerHTML = [['add', '＋ Tap = next no.'], ['move', '✥ Move'], ['retap', '↺ Re-tap'], ['del', '🗑']].map(([k, l]) => `<button class="btn ${mode === k ? '' : 'ghost'} ${k === 'del' ? 'r' : ''}" data-m="${k}">${l}</button>`).join('');
    tb.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { mode = b.dataset.m; moving = null; retap = mode === 'retap' ? [] : null; tools(); draw(); });
    const next = nextN();
    q('#tk-step').innerHTML = mode === 'add' ? `Tap the next area on the photo – it gets number <b>${next}</b>.`
      : mode === 'move' ? (moving == null ? 'Tap the number you want to move.' : `Now tap where number <b>${moving}</b> should go.`)
        : mode === 'retap' ? `Tap the numbers in the new order (${retap.length} of ${placed().length} done).${retap.length ? ' <button class="link" id="tk-rt-ok">Done</button>' : ''}`
          : 'Tap a number to delete it.';
    const ok = q('#tk-rt-ok'); if (ok) ok.onclick = finishRetap;
  }
  const placed = () => t.marks.filter(m => m.x != null);
  const nextN = () => t.marks.reduce((s, m) => Math.max(s, m.n), 0) + 1;
  function labelOf(m) {
    const two = (() => { const k = m.minus ? (parentOf(t.marks, m) ? areaKind(parentOf(t.marks, m)) : null) : areaKind(m); return k ? k.measure : 'LxH'; })();
    const sz = v => { const mm = sizeMm(v); return mm == null ? '' : String(Math.round(mm)); };
    const L = sz(m.L), Hh = sz(m.H);
    let txt = two === 'LxH' || two === 'LxW' ? (L || Hh ? `${L || '?'} × ${Hh || '?'}` : '') : two === 'N' ? `${m.nos || 1} nos` : L ? `${L} ${two === 'M' ? 'm' : 'rft'}`.replace(/ rft$/, ' rft') : '';
    if (txt && m.minus) txt = '−' + txt;
    if (txt && (m.camL || m.camH)) txt += ' ≈';
    return txt ? `${m.n} · ${txt}` : '';
  }
  function draw() {
    if (!img) return;
    const v = canvas.getContext('2d');
    v.drawImage(img, 0, 0, W, H);
    paintMarks(v, t.marks, W, H, labelOf, retap);
  }
  const toImg = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  const hit = (p) => { const rad = Math.max(22, W / 30) / W * 1.4; let best = null, bd = 1e9; for (const m of placed()) { const d = Math.hypot((m.x - p[0]), (m.y - p[1]) * H / W); if (d < bd) { bd = d; best = m; } } return bd <= rad ? best : null; };
  canvas.addEventListener('click', async e => {
    const p = toImg(e);
    if (mode === 'add') {
      const prev = t.marks.filter(m => !m.minus).slice(-1)[0];
      const m = { n: nextN(), x: p[0], y: p[1], cat: prev ? prev.cat : (DEF_CAT[t.type] || 'Wall painting'), heading: prev ? prev.heading : '', measure: prev ? prev.measure : '', nos: 1, L: '', H: '', desc: '' };
      t.marks.push(m); save(); draw(); cards(); tools();
      return;
    }
    const m = hit(p);
    if (mode === 'move') {
      if (moving == null) { if (m) { moving = m.n; tools(); } return; }
      const mm = t.marks.find(x => x.n === moving); mm.x = p[0]; mm.y = p[1]; moving = null; save(); draw(); tools(); return;
    }
    if (!m) return;
    if (mode === 'del') { if (await confirmBox(`Delete number ${m.n} and its sizes?`, 'Delete')) delMark(m.n); return; }
    if (mode === 'retap') { if (!retap.includes(m.n)) retap.push(m.n); draw(); tools(); if (retap.length === placed().length) finishRetap(); }
  });
  function finishRetap() {
    const order = [...retap, ...t.marks.map(m => m.n).filter(n => !retap.includes(n)).sort((a, b) => a - b)];
    const map = Object.fromEntries(order.map((n, i) => [n, i + 1]));
    t.marks.forEach(m => { m.n = map[m.n]; if (m.of != null) m.of = map[m.of]; });
    t.marks.sort((a, b) => a.n - b.n);
    retap = null; mode = 'add'; save(); draw(); cards(); tools(); toast('Numbers changed');
  }
  function delMark(n) {
    t.marks = t.marks.filter(m => m.n !== n);
    t.marks.forEach(m => { if (m.of === n) m.of = null; });
    // close the gap so numbers stay 1, 2, 3…
    const map = {}; t.marks.sort((a, b) => a.n - b.n).forEach((m, i) => { map[m.n] = i + 1; });
    t.marks.forEach(m => { m.n = map[m.n]; if (m.of != null) m.of = map[m.of]; });
    save(); draw(); cards(); tools();
  }

  // number cards
  function cards() {
    const box = q('#tk-cards');
    box.innerHTML = t.marks.map(m => cardHtml(m)).join('') || (img ? '' : '<div class="empty">No numbers yet.</div>');
    box.querySelectorAll('.nr').forEach(c => bindCard(c));
  }
  function cardHtml(m) {
    const parents = t.marks.filter(x => !x.minus && x.n !== m.n && areaKind(x).unit === 'Sqft');
    const k = m.minus ? (parentOf(t.marks, m) ? areaKind(parentOf(t.marks, m)) : { measure: 'LxH', unit: 'Sqft' }) : areaKind(m);
    const two = k.measure === 'LxH' || k.measure === 'LxW', one = k.measure === 'L' || k.measure === 'M';
    const l1 = k.measure === 'LxW' ? 'L' : two ? 'L' : 'L', l2 = k.measure === 'LxW' ? 'W' : 'H';
    const sizeBox = (f, lab) => `<label>${m.minus ? (f === 'L' ? 'W' : 'H') : lab}<input data-s="${f}" value="${esc(m[f] || '')}" class="${m['cam' + f] ? 'cam-src' : m['las' + f] ? 'laser-src' : ''}" placeholder="mm or 12'4&quot;" ${m['cam' + f] ? 'data-src="Camera"' : m['las' + f] ? 'data-src="Laser"' : ''}>${m['cam' + f] ? '<span class="camn">📷 ±1 cm – check</span>' : ''}</label>`;
    return `<div class="nr ${m.minus ? 'm' : ''}" data-n="${m.n}">
      <div class="nr-h"><span class="pin static ${m.minus ? 'r' : 'g'}">${m.n}</span>
        ${m.minus ? `<b class="r">Minus</b><select data-k="of">${parents.map(p => `<option value="${p.n}" ${parentOf(t.marks, m) && parentOf(t.marks, m).n === p.n ? 'selected' : ''}>from ${p.n} · ${esc(areaKind(p).heading)}</option>`).join('') || '<option value="">no area to take from</option>'}</select>`
        : `<select data-k="cat">${catOptions(m.cat)}</select>`}
        <button class="icon" data-k="x" title="Delete">🗑</button></div>
      ${!m.minus && m.cat === '__other' ? `<div class="g3"><input data-k="heading" data-on placeholder="Heading" value="${esc(m.heading || '')}"><select data-k="measure">${[['LxH', 'Sqft (L × H)'], ['LxW', 'Sqft (L × W)'], ['L', 'Rft'], ['M', 'Mtr'], ['N', 'Nos']].map(o => `<option value="${o[0]}" ${(m.measure || 'LxH') === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></div>` : ''}
      <div class="g3"><input data-k="desc" data-on placeholder="${m.minus ? 'Door / window / column' : 'Description (optional)'}" value="${esc(m.desc || '')}"><label class="nos-l">Nos<input data-k="nos" data-on inputmode="numeric" value="${esc(m.nos ?? 1)}"></label></div>
      <div class="g3">${two ? sizeBox('L', l1) + sizeBox('H', l2) : one ? sizeBox('L', 'L') : ''}</div>
      <div class="lres" data-res></div>
      ${!m.minus && k.unit === 'Sqft' ? '<button class="link small" data-k="addminus">− Add a door / window (minus)</button>' : ''}
      ${m.minus ? '' : `<button class="link small" data-k="tominus">Make this a minus line</button>`}
    </div>`;
  }
  function bindCard(c) {
    const n = Number(c.dataset.n); const m = () => t.marks.find(x => x.n === n);
    const live = () => { const r = workOut(t.marks).lines.find(x => x.n === n); const el = c.querySelector('[data-res]'); if (!r) return; el.className = 'lres ' + (r.ok ? 'g' : 'r'); el.innerHTML = r.ok ? `${r.minus ? '−' : ''}${q2(Math.abs(r.A))} ${r.unit} ✓${r.warn.length ? ` <span class="a">⚠ ${esc(r.warn.join(' · '))}</span>` : ''}` : esc(r.err); };
    c.querySelectorAll('[data-s]').forEach(i => i.addEventListener('input', () => {
      const f = i.dataset.s; m()[f] = i.value.trim(); m()['cam' + f] = i.dataset.src === 'Camera'; m()['las' + f] = i.dataset.src === 'Laser';
      const note = i.parentElement.querySelector('.camn'); if (note && !m()['cam' + f]) note.remove();
      if (m()['cam' + f] && !note) i.insertAdjacentHTML('afterend', '<span class="camn">📷 ±1 cm – check</span>');
      save(); draw(); live();
    }));
    c.querySelectorAll('[data-k]').forEach(i => {
      const k = i.dataset.k;
      if (i.tagName === 'BUTTON') {
        i.onclick = async () => {
          if (k === 'x') { if (await confirmBox(`Delete number ${n}?`, 'Delete')) delMark(n); return; }
          if (k === 'addminus') { t.marks.push({ n: nextN(), minus: true, of: n, nos: 1, L: '', H: '', desc: '', x: null }); save(); cards(); tools(); toast(`Number ${nextN() - 1} added as minus from ${n}${img ? ' – Move it onto the photo if you like' : ''}`); if (img) { const nm = t.marks[t.marks.length - 1]; const pm = m(); if (pm.x != null) { nm.x = Math.min(.95, pm.x + .06); nm.y = Math.min(.95, pm.y + .06); } draw(); } return; }
          if (k === 'tominus') { const mm = m(); mm.minus = true; const ps = t.marks.filter(x => !x.minus && x.n < n); mm.of = ps.length ? ps[ps.length - 1].n : null; save(); cards(); draw(); return; }
        };
        return;
      }
      const ev = i.tagName === 'SELECT' ? 'change' : 'input';
      i.addEventListener(ev, () => {
        const mm = m();
        if (k === 'of') mm.of = Number(i.value) || null;
        else if (k === 'nos') mm.nos = i.value.trim();
        else mm[k] = i.value;
        save(); draw();
        if (i.tagName === 'SELECT') cards(); else live();
      });
    });
    live();
  }

  q('#tk-addnp').onclick = () => { const prev = t.marks.filter(m => !m.minus).slice(-1)[0]; t.marks.push({ n: nextN(), x: null, cat: prev ? prev.cat : (DEF_CAT[t.type] || 'Wall painting'), heading: prev ? prev.heading : '', measure: prev ? prev.measure : '', nos: 1, L: '', H: '', desc: '' }); save(); cards(); tools(); };
  q('#tk-res').onclick = async () => { clearTimeout(saveT); await db.put('points', t); location.hash = `#/task/${t.id}/result`; };
  q('#tk-del').onclick = async () => { if (await confirmBox(`Delete task "${esc(t.label)}"?`, 'Delete')) { await db.del('points', t.id); location.hash = `#/job/${t.jobId}/tasks`; } };
  photoBox(); tools(); cards();
}

// numbered circles + size labels on a photo
export function paintMarks(v, marks, W, H, labelOf, highlight) {
  const r = Math.max(16, W / 26), fs = Math.max(14, W / 30);
  for (const m of marks) {
    if (m.x == null) continue;
    const x = m.x * W, y = m.y * H;
    const lab = labelOf(m);
    if (lab) {
      v.font = `bold ${fs}px sans-serif`; const tw = v.measureText(lab).width;
      let lx = x + r + 4; if (lx + tw + 10 > W) lx = x - r - 4 - tw - 10;
      const ly = Math.min(H - fs - 6, Math.max(2, y - fs / 2 - 4));
      v.fillStyle = 'rgba(255,255,255,.88)'; v.fillRect(lx, ly, tw + 10, fs + 8);
      v.fillStyle = m.minus ? '#b42318' : '#0b3d49'; v.textBaseline = 'top'; v.fillText(lab, lx + 5, ly + 4);
    }
    v.beginPath(); v.arc(x, y, r, 0, Math.PI * 2); v.fillStyle = m.minus ? '#d92d20' : '#0f5c6e'; v.fill();
    v.lineWidth = Math.max(2, r / 6); v.strokeStyle = highlight && highlight.includes(m.n) ? '#ffd400' : '#fff'; v.stroke();
    v.fillStyle = '#fff'; v.font = `bold ${r * 1.05}px sans-serif`; v.textAlign = 'center'; v.textBaseline = 'middle'; v.fillText(String(m.n), x, y + 1); v.textAlign = 'left';
  }
}

async function loadImg(blob) { const im = new Image(); im.src = URL.createObjectURL(blob); await im.decode(); return im; }

// ---------- Result ----------
export async function renderResult(view, id, { setTitle }) {
  const t = await db.get('points', id);
  if (!t) { location.hash = '#/'; return; }
  setTitle('Result · ' + t.label, `#/task/${id}`);
  const res = workOut(t.marks);
  const rows = g => res.lines.filter(x => x.ok && x.heading === g.heading && x.unit === g.unit);
  const bad = res.lines.filter(x => !x.ok);
  view.innerHTML = `<div class="rt">
    <div class="rt-r rt-h"><span>Item</span><span>Size</span><span>Unit</span><span>Qty</span></div>
    ${res.groups.map(g => rows(g).map(r => `<div class="rt-r"><span>${r.n} ${esc(r.minus ? (r.desc || 'Opening') + ' (−)' : r.desc || r.heading)}${r.nos > 1 ? ' ×' + r.nos : ''}</span><span>${esc(r.size)}</span><span>${r.unit}</span><span class="${r.A < 0 ? 'r' : ''}">${q2(r.A)}</span>
      <em class="${r.warn.length ? 'a' : 'g'}">${r.warn.length ? '⚠ ' + esc(r.warn.join(' · ')) : `✓ way A ${q2(r.A)} = way B ${q2(r.B)} · unit ✓`}</em></div>`).join('')
      + `<div class="rt-r rt-t"><span>Total ${esc(g.heading)}</span><span></span><span>${g.unit}</span><span>${q2(g.total)}</span>${g.ok ? '' : `<em class="r">✗ ${esc(g.err)}</em>`}</div>`).join('')}
    ${bad.map(r => `<div class="rt-r rt-bad"><span>${r.n} ${esc(r.desc || '')}</span><span></span><span></span><span>✗</span><em class="r">✗ ${esc(r.err)} – fix it in the task</em></div>`).join('')}
  </div>
  <div class="ban ${res.allOk ? 'ok' : 'no'}">${res.allOk ? `✓ all match – totals added back: ${res.groups.map(g => `${q2(g.total)} ${g.unit}`).join(' · ')}` : `✗ ${res.problems} to fix – Share stays 🔒`}</div>
  <p class="small muted">Each line is worked out 2 ways (sheet maths and mm maths) and every total is added twice. Odd sizes and camera sizes are flagged in orange.</p>
  <div class="row"><button class="btn big" id="r-share" ${res.allOk ? '' : 'disabled'}>${res.allOk ? '📤 Share' : '🔒 Share'}</button><button class="btn big ghost" id="r-sheet" ${res.allOk ? '' : 'disabled'}>🧾 Add to sheet</button></div>
  ${t.shares.length ? `<h3>Shared versions</h3>${t.shares.slice().reverse().map(s => `<div class="prow g"><div><b>V${s.v}</b><small>${esc(s.stamp)} · ${esc(s.as)} → ${esc(s.to)}</small></div></div>`).join('')}` : ''}
  <button class="btn ghost wide" id="r-back">✎ Back to the task</button>`;
  view.querySelector('#r-back').onclick = () => { location.hash = `#/task/${id}`; };
  if (!res.allOk) return;
  view.querySelector('#r-share').onclick = () => shareSheet(t, res);
  view.querySelector('#r-sheet').onclick = async () => {
    const job = await db.get('jobs', t.jobId);
    const sh = await loadSheet(job);
    const ps = toSheet(t, res, {});
    for (const it of ps.items) {
      let x = sh.items.find(i => i.heading === it.heading);
      if (!x) { x = { id: db.uid(), no: String(sh.items.length + 1), heading: it.heading, lines: [] }; sh.items.push(x); }
      for (const ln of it.lines) x.lines.push({ id: db.uid(), ...ln, desc: `${t.label} – ${ln.desc}`, siteNote: [`Task: ${t.label}`, ln.siteNote].filter(Boolean).join(' · ') });
    }
    await db.put('sheets', sh); toast(`${res.lines.length} line(s) added to the measurement sheet`);
  };
}

// ---------- Share ----------
export const stampText = (v, d = new Date()) => { d = new Date(d); let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `V${v} · ${dateText(d)} ${h}:${String(d.getMinutes()).padStart(2, '0')} ${ap}`; };
// a new version only when something changed after the last share
export function versionFor(t) { const last = t.shares[t.shares.length - 1]; return last && last.at >= (t.edited || 0) ? last.v : (last ? last.v + 1 : 1); }

export function shareSheet(t, res) {
  const host = window.MEASURE_HOST || null; // set when Measure runs inside Q
  let as = 'image', to = 'phone';
  const v = versionFor(t);
  const s = popup(`<h2>📤 Share result · V${v}</h2>
    <p class="small muted">1 · As</p>
    <div class="pk">${[['image', '🖼 Image'], ['pdf', '📄 PDF'], ['text', '🔢 Numbers'], ['excel', '📊 Excel']].map(o => `<button class="pkb" data-as="${o[0]}">${o[1]}</button>`).join('')}</div>
    <p class="small muted" style="margin-top:12px">2 · To</p>
    <button class="opt" data-to="kartha" ${host && host.kartha ? '' : 'disabled'}><b>📁 KARTHA project</b><span>${host && host.kartha ? 'Pick the project → 📐 Measurements' : 'Opens when Measure runs inside Q'}</span></button>
    <button class="opt" data-to="q" ${host && host.q ? '' : 'disabled'}><b>💬 Q person or group</b><span>${host && host.q ? 'Pick from your Q chats' : 'Opens when Measure runs inside Q'}</span></button>
    <button class="opt" data-to="phone"><b>📱 WhatsApp / other phone apps</b><span>Opens the phone's share list</span></button>
    <button class="btn wide" id="sh-send">Send</button>
    <p class="small muted center">Nothing goes until you tap Send.</p>`);
  const paint = () => {
    s.el.querySelectorAll('[data-as]').forEach(b => b.classList.toggle('on', b.dataset.as === as));
    s.el.querySelectorAll('[data-to]').forEach(b => b.classList.toggle('hl', b.dataset.to === to));
    s.el.querySelector('#sh-send').textContent = `Send ${({ image: 'image', pdf: 'PDF', text: 'numbers', excel: 'Excel' })[as]} → ${({ kartha: 'KARTHA project', q: 'Q chat', phone: 'phone apps' })[to]}`;
  };
  s.el.querySelectorAll('[data-as]').forEach(b => b.onclick = () => { as = b.dataset.as; paint(); });
  s.el.querySelectorAll('[data-to]').forEach(b => b.onclick = () => { if (b.disabled) return; to = b.dataset.to; paint(); });
  s.el.querySelector('#sh-send').onclick = async () => {
    const at = Date.now(), stamp = stampText(v, at);
    try {
      const out = await makeOutput(t, res, as, stamp);
      let ok = false;
      if (to === 'phone') ok = await phoneShare(out);
      else if (host && to === 'kartha') ok = await host.kartha({ task: t, res, out, stamp, version: v });
      else if (host && to === 'q') ok = await host.q({ task: t, res, out, stamp, version: v });
      if (!ok) return;
      t.shares.push({ v, at, stamp, as: ({ image: 'Image', pdf: 'PDF', text: 'Numbers', excel: 'Excel' })[as], to: ({ kartha: 'KARTHA project', q: 'Q chat', phone: 'Phone apps' })[to] + (ok.where ? ' · ' + ok.where : '') });
      await db.put('points', t, { silent: false });
      s.close(); toast(`Shared ${stamp}`); window.dispatchEvent(new HashChangeEvent('hashchange'));
    } catch (e) { console.error(e); toast(e.message, 5000); }
  };
  paint();
}

async function phoneShare(out) {
  if (out.text && !out.blob) {
    if (navigator.share) { try { await navigator.share({ text: out.text }); return true; } catch (e) { if (e.name === 'AbortError') return false; } }
    try { await navigator.clipboard.writeText(out.text); toast('Copied – paste it in WhatsApp'); return true; } catch (e) { toast('Could not copy'); return false; }
  }
  const file = new File([out.blob], out.name, { type: out.blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: out.name }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  download(out.blob, out.name); toast('Saved to Downloads – attach it in WhatsApp'); return true;
}

// Image / PDF / Numbers / Excel – all from the same checked figures
export async function makeOutput(t, res, as, stamp) {
  if (!res.allOk) throw new Error('Not all matching – fix first');
  const job = await db.get('jobs', t.jobId) || {};
  const base = `${safeName(job.name || 'Job')} – ${safeName(t.label)} ${stamp.split(' · ')[0]} ${fileDate()}`;
  if (as === 'text') return { text: numbersText(t, res, stamp), name: base + '.txt' };
  const header = { project: job.name || '', client: job.client || '', location: job.site || '', measuredBy: await db.getSetting('measuredBy', 'Karthik S'), date: Date.now() };
  if (as === 'excel') return { blob: await sheetExcel(toSheet(t, res, header)), name: base + '.xlsx' };
  const photo = await markedPhoto(t);
  if (as === 'image') return { blob: await resultImage(t, res, stamp, photo, job), name: base + '.png' };
  return { blob: await resultPdf(t, res, stamp, photo, header), name: base + '.pdf' };
}

async function markedPhoto(t) {
  if (!t.photoId) return null;
  const im = await loadImg(await getBlob(t.photoId));
  const sc = Math.min(1, 1400 / im.naturalWidth), W = Math.round(im.naturalWidth * sc), H = Math.round(im.naturalHeight * sc);
  const c = document.createElement('canvas'); c.width = W; c.height = H; const v = c.getContext('2d'); v.drawImage(im, 0, 0, W, H);
  const lab = m => { const r = workOut(t.marks).lines.find(x => x.n === m.n); return r && r.ok ? `${m.n} · ${r.minus ? '−' : ''}${r.sizeMm ? r.sizeMm + (r.unit === 'Rft' ? ' rft' : r.unit === 'Mtr' ? ' m' : '') : r.nos + ' nos'}${m.camL || m.camH ? ' ≈' : ''}` : String(m.n); };
  paintMarks(v, t.marks, W, H, lab);
  return c;
}

export async function resultImage(t, res, stamp, photo, job) {
  const Wd = Math.max(900, photo ? photo.width : 900), pad = 28, fs = 24, lh = 36;
  const rowsN = res.lines.length + res.groups.length * 2 + 6;
  const ph = photo ? Math.round(photo.height * Wd / photo.width) : 0;
  const c = document.createElement('canvas'); c.width = Wd; c.height = ph + rowsN * lh + pad * 2;
  const v = c.getContext('2d'); v.fillStyle = '#fff'; v.fillRect(0, 0, c.width, c.height);
  if (photo) v.drawImage(photo, 0, 0, Wd, ph);
  let y = ph + pad;
  const text = (s, x, b, col = '#1d2730', al = 'left') => { v.font = `${b ? 'bold ' : ''}${fs}px sans-serif`; v.fillStyle = col; v.textAlign = al; v.textBaseline = 'top'; v.fillText(s, x, y); };
  text(`${job.name || ''} – ${t.label}`, pad, true); y += lh; text(stamp, pad, false, '#6b7783'); y += lh + 6;
  const cx = [pad, Wd * 0.46, Wd * 0.72, Wd - pad];
  for (const g of res.groups) {
    v.fillStyle = '#b3c6e7'; v.fillRect(pad - 8, y - 4, Wd - 2 * pad + 16, lh); text(`${g.heading} (${g.unit})`, pad, true); y += lh;
    for (const r of res.lines.filter(x => x.ok && x.heading === g.heading && x.unit === g.unit)) {
      text(`${r.n} ${r.minus ? (r.desc || 'Opening') + ' (−)' : r.desc || ''}${r.nos > 1 ? ' ×' + r.nos : ''}`.slice(0, 34), cx[0]); text(r.size, cx[1]); text(r.unit, cx[2]); text(q2(r.A), cx[3], false, r.A < 0 ? '#d92d20' : '#1d2730', 'right'); y += lh;
    }
    v.fillStyle = '#dadada'; v.fillRect(pad - 8, y - 4, Wd - 2 * pad + 16, lh); text('Total', cx[0], true); text(g.unit, cx[2], true); text(q2(g.total), cx[3], true, '#1d2730', 'right'); y += lh + 8;
  }
  text('✓ all match – worked 2 ways, totals added back', pad, true, '#1a9e4a');
  return new Promise(r => c.toBlob(r, 'image/png'));
}

export async function resultPdf(t, res, stamp, photo, header) {
  const jsPDF = await needPdfMaker();
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(HEADER.company, W / 2, 40, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text(HEADER.address, W / 2, 54, { align: 'center' });
  doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.text(`${header.project} – ${t.label}`, W / 2, 72, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(`${stamp.replace('·', '-')}   Measured by: ${header.measuredBy}`, W / 2, 86, { align: 'center' });
  let y = 100;
  if (photo) { const w = W - 80, h = Math.min(300, photo.height * w / photo.width), ww = h * photo.width / photo.height; doc.addImage(photo.toDataURL('image/jpeg', 0.85), 'JPEG', (W - ww) / 2, y, ww, h); y += h + 12; }
  const body = [];
  const ft = s => String(s).replace(/×/g, 'x').replace(/−/g, '-');
  for (const g of res.groups) {
    body.push([{ content: `${g.heading} (${g.unit})`, colSpan: 5, styles: { fillColor: [179, 198, 231], fontStyle: 'bold' } }]);
    for (const r of res.lines.filter(x => x.ok && x.heading === g.heading && x.unit === g.unit)) body.push([String(r.n), ft(`${r.minus ? (r.desc || 'Opening') + ' (minus)' : r.desc || ''}`), String(r.minus ? -r.nos : r.nos), ft(r.size), q2(r.A)]);
    body.push([{ content: `Total ${g.heading}`, colSpan: 4, styles: { fillColor: [218, 218, 218], fontStyle: 'bold', halign: 'right' } }, { content: q2(g.total), styles: { fillColor: [218, 218, 218], fontStyle: 'bold' } }]);
  }
  doc.autoTable({ startY: y, head: [['No', 'Item', 'Nos', 'Size', 'Qty']], body, styles: { fontSize: 9 }, headStyles: { fillColor: [15, 92, 110] }, columnStyles: { 4: { halign: 'right' } } });
  const fy = doc.lastAutoTable.finalY + 16;
  doc.setTextColor(26, 158, 74); doc.setFont('helvetica', 'bold'); doc.text('All match - every line worked out 2 ways, totals added back.', 40, fy);
  return doc.output('blob');
}

// ---------- move to Q: backup file of everything on this phone ----------
export async function exportAll() {
  const out = { app: 'measure', at: Date.now(), stores: {} };
  for (const s of ['jobs', 'drawings', 'points', 'sheets', 'rooms', 'files', 'settings']) {
    const rows = await db.all(s);
    for (const r of rows) if (r.blob instanceof Blob) { r.blob = { b64: await toB64(r.blob), type: r.blob.type }; }
    out.stores[s] = rows;
  }
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}
export async function importAll(file) {
  const data = JSON.parse(await file.text());
  if (data.app !== 'measure') throw new Error('This is not a Measure backup file');
  let n = 0;
  for (const [s, rows] of Object.entries(data.stores)) for (const r of rows) {
    if (r.blob && r.blob.b64) r.blob = fromB64(r.blob.b64, r.blob.type);
    if (s === 'settings') await db.setSetting(r.id, r.value); else await db.put(s, r, { silent: true });
    n++;
  }
  return n;
}
const toB64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(b); });
const fromB64 = (b64, type) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type }); };
