// Measure on photo: photo of one side of the site → draw a dimension line for each length / height / gap,
// fill its size (laser by voice, tape, typed), pick the category → lines go to the measurement sheet.
import * as db from './db.js';
import { esc, toast, fileDate, safeName } from './util.js';
import { mountTip, confirmBox, sheet as popup } from './ui.js';
import { saveJobFile, getBlob } from './ui-drawing.js';
import { loadSheet } from './ui-sheet.js';
import { catOptions, findCat, MEASURE_HINT } from './categories.js';
import { sheetSize, check, r2, normUnit } from './sheet.js';

export async function renderNotes(el, job) {
  const notes = (await db.byJob('points', job.id)).filter(p => p.kind === 'photonote').sort((a, b) => b.createdAt - a.createdAt);
  el.innerHTML = `<div class="card"><b>📸 Measure on photo</b><p class="small">Take a photo of one side of the site. For each item (wall, partition, ceiling, gap, skirting…): pick its category, draw a line on the photo, give the size (laser by voice 🎤, tape or typing). Everything goes to the measurement sheet with the marked photo as proof.</p>
    <div class="row"><label class="btn big">📷 Take photo<input type="file" id="n-cam" accept="image/*" capture="environment" hidden></label><label class="btn big ghost">🖼 From gallery<input type="file" id="n-gal" accept="image/*" hidden></label></div></div>
    <div id="nw"></div><h3>Marked photos</h3><div id="nl">${notes.length ? '' : '<div class="empty">None yet.</div>'}</div>`;
  await mountTip(el, 'notes');
  const nl = el.querySelector('#nl');
  for (const n of notes) {
    const d = document.createElement('div'); d.className = 'prow g';
    d.innerHTML = `<span class="pin static g">📸</span><div><b>${esc(n.label)}</b><small>${n.lines.length} line(s)${n.sent ? ' · in sheet' : ''}</small></div><button class="link small">Open</button>`;
    d.querySelector('button').onclick = async e => { e.stopPropagation(); try { const b = await getBlob(n.photoId); work(el.querySelector('#nw'), job, b, () => renderNotes(el, job), n); } catch (er) { toast(er.message); } };
    nl.appendChild(d);
  }
  const onFile = e => { const f = e.target.files[0]; e.target.value = ''; if (f) work(el.querySelector('#nw'), job, f, () => renderNotes(el, job)); };
  el.querySelector('#n-cam').onchange = onFile; el.querySelector('#n-gal').onchange = onFile;
}

async function work(box, job, file, done, existing) {
  const img = new Image(); img.src = URL.createObjectURL(file); await img.decode();
  const sc = Math.min(1, 1400 / img.naturalWidth), W = Math.round(img.naturalWidth * sc), H = Math.round(img.naturalHeight * sc);
  const base = document.createElement('canvas'); base.width = W; base.height = H; base.getContext('2d').drawImage(img, 0, 0, W, H);
  const rec = existing || { id: db.uid(), jobId: job.id, kind: 'photonote', label: '', lines: [], marks: [], createdAt: Date.now() };
  let lastCat = (rec.lines[rec.lines.length - 1] || {}).cat || 'Wall painting';
  let draft = null, drawing = null, pend = null;
  box.innerHTML = `<div class="card">
    <div class="count-stage"><canvas id="nv"></canvas></div>
    <p class="small muted" id="n-step">Pick the category below, then tap ✏ next to a size to draw its line on the photo.</p>
    <div class="note-form">
      <label>Category<select id="n-cat">${catOptions(lastCat)}</select></label>
      <input id="n-other" placeholder="Heading" hidden>
      <p class="small muted" id="n-hint"></p>
      <label>Description<input id="n-desc" placeholder="e.g. Front wall left of door"></label>
      <div class="lgrid w3n"><label>Nos<input id="n-nos" value="1" inputmode="numeric" class="nos"></label>
        <label><span id="n-l-lbl">Length</span><span class="inl"><input id="n-len" placeholder="tap ✏ or type"><button class="icon" data-draw="len">✏</button></span></label>
        <label id="n-h-wrap"><span id="n-h-lbl">Height</span><span class="inl"><input id="n-h" placeholder="tap ✏ or type"><button class="icon" data-draw="h">✏</button></span></label></div>
      <div class="row wrap"><button class="btn ghost sm" id="n-minus">− Make it a minus line (door/window/column)</button></div>
      <div id="n-q" class="lres"></div>
      <button class="btn wide" id="n-add">＋ Add this line</button>
    </div>
    <div id="n-lines"></div>
    <label>Photo name<input id="n-label" value="${esc(rec.label)}" placeholder="e.g. Front side / Wall A"></label>
    <div class="row wrap"><button class="btn ghost" id="n-save">💾 Save photo</button><button class="btn" id="n-send">🧾 Send to measurement sheet</button></div></div>`;
  const q = id => box.querySelector(id), view = q('#nv'), v = view.getContext('2d'); view.width = W; view.height = H;
  const cat = () => q('#n-cat').value === '__other' ? { name: q('#n-other').value.trim() || 'Other', unit: 'Sqft', measure: 'LxH' } : findCat(q('#n-cat').value);
  function setCatUI() {
    const c = cat(); q('#n-other').hidden = q('#n-cat').value !== '__other';
    q('#n-hint').textContent = MEASURE_HINT[c.measure] || '';
    const two = c.measure === 'LxH' || c.measure === 'LxW';
    q('#n-h-wrap').style.visibility = two ? 'visible' : 'hidden';
    q('#n-h-lbl').textContent = c.measure === 'LxW' ? 'Width' : 'Height';
    q('#n-l-lbl').textContent = c.measure === 'N' ? 'Length (optional)' : 'Length';
    calc();
  }
  function lineObj() {
    const c = cat(); const unit = normUnit(c.unit);
    return { cat: c.name, desc: q('#n-desc').value.trim() || c.name, unit, nos: q('#n-nos').value.trim() || '1', length: q('#n-len').value.trim(), breadth: '', width: (c.measure === 'LxH' || c.measure === 'LxW') ? q('#n-h').value.trim() : '', cam: q('#n-len').dataset.src === 'Camera' || q('#n-h').dataset.src === 'Camera' };
  }
  function calc() {
    const ln = lineObj(); const ch = check({ items: [{ heading: ln.cat, lines: [ln] }] }).lines[0];
    q('#n-q').className = 'lres ' + (ch.ok ? 'g' : 'r'); q('#n-q').innerHTML = ch.ok ? `Qty <b>${r2(ch.A)}</b> ${ln.unit} ✔` : esc(ch.err);
  }
  function arrow(x1, y1, x2, y2, color, text) {
    const ang = Math.atan2(y2 - y1, x2 - x1), hl = Math.max(10, W / 90);
    v.strokeStyle = color; v.fillStyle = color; v.lineWidth = Math.max(3, W / 350);
    v.beginPath(); v.moveTo(x1, y1); v.lineTo(x2, y2); v.stroke();
    for (const [x, y, a] of [[x1, y1, ang], [x2, y2, ang + Math.PI]]) { v.beginPath(); v.moveTo(x, y); v.lineTo(x + hl * Math.cos(a + 0.4), y + hl * Math.sin(a + 0.4)); v.lineTo(x + hl * Math.cos(a - 0.4), y + hl * Math.sin(a - 0.4)); v.closePath(); v.fill(); }
    if (text) {
      const fs = Math.max(14, W / 50); v.font = `bold ${fs}px sans-serif`; const tw = v.measureText(text).width;
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      v.save(); v.translate(mx, my); let a = ang; if (a > Math.PI / 2 || a < -Math.PI / 2) a += Math.PI; v.rotate(a);
      v.fillStyle = 'rgba(0,0,0,.7)'; v.fillRect(-tw / 2 - 6, -fs - 6, tw + 12, fs + 8); v.fillStyle = '#ffd400'; v.textAlign = 'center'; v.fillText(text, 0, -6); v.restore();
    }
  }
  function draw() {
    v.drawImage(base, 0, 0);
    rec.marks.forEach(m => arrow(m.x1 * W, m.y1 * H, m.x2 * W, m.y2 * H, m.minus ? '#ff6b6b' : '#3ad16b', m.text));
    if (draft) for (const k of ['len', 'h']) if (draft[k]) { const m = draft[k]; arrow(m.x1 * W, m.y1 * H, m.x2 * W, m.y2 * H, '#ffd400', q(k === 'len' ? '#n-len' : '#n-h').value); }
    if (pend) { v.fillStyle = '#ffd400'; v.beginPath(); v.arc(pend[0] * W, pend[1] * H, Math.max(6, W / 120), 0, Math.PI * 2); v.fill(); }
  }
  function renderLines() {
    const c = check({ items: [{ heading: 'x', lines: rec.lines }] });
    q('#n-lines').innerHTML = rec.lines.length ? '<h3>Lines on this photo</h3>' + rec.lines.map((l, i) => `<div class="prow ${c.lines[i].ok ? 'g' : 'r'}"><div><b>${esc(l.cat)}</b><small>${esc(l.desc)}${l.cam ? ' · 📷 camera ±1 cm' : ''} · ${l.nos} × ${esc(l.length || '')}${l.width ? ' × ' + esc(l.width) : ''}</small></div><span class="diff">${c.lines[i].ok ? r2(c.lines[i].A) + ' ' + l.unit : '✘'}</span><button class="link r small" data-del="${i}">✕</button></div>`).join('') : '';
    q('#n-lines').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { const i = Number(b.dataset.del); rec.lines.splice(i, 1); rec.marks = rec.marks.filter(m => m.line !== i).map(m => ({ ...m, line: m.line > i ? m.line - 1 : m.line })); renderLines(); draw(); });
  }
  const toImg = e => { const r = view.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  view.addEventListener('click', e => {
    if (!drawing) return;
    const p = toImg(e);
    if (!pend) { pend = p; q('#n-step').innerHTML = '<b>Now tap the other end</b> of this size.'; draw(); return; }
    draft = draft || {}; draft[drawing] = { x1: pend[0], y1: pend[1], x2: p[0], y2: p[1] };
    const input = q(drawing === 'len' ? '#n-len' : '#n-h'); pend = null; drawing = null;
    q('#n-step').innerHTML = 'Line drawn. Now give its size: 🎤 Say, ⌨ Type, 📷 Camera (straight runs) or press the laser.';
    draw(); input.focus();
  });
  box.querySelectorAll('[data-draw]').forEach(b => b.onclick = () => { drawing = b.dataset.draw; pend = null; q('#n-step').innerHTML = `<b>Tap one end</b> of the ${drawing === 'len' ? q('#n-l-lbl').textContent.toLowerCase() : q('#n-h-lbl').textContent.toLowerCase()} on the photo.`; view.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
  ['#n-desc', '#n-nos', '#n-len', '#n-h', '#n-other'].forEach(id => q(id).addEventListener('input', () => { calc(); draw(); }));
  q('#n-cat').onchange = setCatUI;
  q('#n-minus').onclick = () => { const n = q('#n-nos'); n.value = String(-Math.abs(Number(n.value) || 1)); if (!/minus/.test(q('#n-desc').value)) q('#n-desc').value = (q('#n-desc').value || 'Opening') + ' minus (-)'; calc(); };
  q('#n-add').onclick = () => {
    const ln = lineObj(); const ch = check({ items: [{ heading: ln.cat, lines: [ln] }] }).lines[0];
    if (!ch.ok) return toast(ch.err);
    const i = rec.lines.length; rec.lines.push(ln);
    const minus = Number(ln.nos) < 0;
    const shown = t => { const z = sheetSize(t); return z.ok && !z.empty && z.kind !== 'ftin' ? `${z.cellValue} ${z.kind}` : t; };
    const camL = q('#n-len').dataset.src === 'Camera', camH = q('#n-h').dataset.src === 'Camera';
    if (draft && draft.len) rec.marks.push({ ...draft.len, text: (camL ? '≈ ' : '') + shown(ln.length), line: i, minus });
    if (draft && draft.h) rec.marks.push({ ...draft.h, text: (camH ? '≈ ' : '') + shown(ln.width), line: i, minus });
    draft = null;
    for (const id of ['#n-len', '#n-h']) { const x = q(id); x.value = ''; delete x.dataset.src; x.classList.remove('cam-src'); } q('#n-nos').value = '1'; q('#n-desc').value = '';
    renderLines(); draw(); calc(); toast('Line added');
  };
  async function save() {
    rec.label = q('#n-label').value.trim() || rec.label || `Photo ${fileDate()}`;
    const blob = await new Promise(r => view.toBlob(r, 'image/jpeg', 0.85));
    const f = await saveJobFile(job.id, `${safeName(job.name)} – ${safeName(rec.label)} (marked).jpg`, blob, 'photonote', 'note-' + rec.id);
    if (!rec.photoId) { const orig = await saveJobFile(job.id, `${safeName(job.name)} – ${safeName(rec.label)}.jpg`, file instanceof Blob ? file : blob, 'photonote-orig', 'noteorig-' + rec.id); rec.photoId = orig.id; }
    rec.markedId = f.id; await db.put('points', rec); return rec;
  }
  q('#n-save').onclick = async () => { await save(); toast('Saved'); done(); };
  q('#n-send').onclick = async () => {
    if (!rec.lines.length) return toast('Add at least one line');
    await save();
    const sh = await loadSheet(job);
    for (const ln of rec.lines) {
      let it = sh.items.find(x => x.heading === ln.cat);
      if (!it) { it = { id: db.uid(), no: String(sh.items.length + 1), heading: ln.cat, lines: [] }; sh.items.push(it); }
      it.lines.push({ id: db.uid(), desc: ln.desc, unit: ln.unit, nos: ln.nos, length: ln.length, breadth: '', width: ln.width, siteNote: `Photo: ${rec.label}${ln.cam ? ' · camera size ±1 cm – check' : ''}` });
    }
    rec.sent = true; await db.put('points', rec); await db.put('sheets', sh);
    toast(`${rec.lines.length} line(s) added to the measurement sheet`); done();
  };
  setCatUI(); renderLines(); draw();
}
