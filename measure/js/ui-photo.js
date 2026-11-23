// Size from photo: tap the 4 corners of an opening (shutter, door, hoarding) + one known size → width, height, sqft,
// and folding/sliding shutter panel sizes.
import * as db from './db.js';
import { parseSize, fmt } from './units.js';
import { esc, toast, fileDate, safeName } from './util.js';
import { mountTip, confirmBox } from './ui.js';
import { saveJobFile, getBlob } from './ui-drawing.js';
import { loadSheet } from './ui-sheet.js';

const SQFT = 92903.04;

// ---------- maths (pure, tested separately) ----------
// solve 8×8 for the homography mapping src[i] → dst[i]
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const n = 8;
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
    if (Math.abs(A[c][c]) < 1e-12) return null;
    for (let r = 0; r < n; r++) { if (r === c) continue; const f = A[r][c] / A[c][c]; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
  }
  const h = b.map((v, i) => v / A[i][i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}
export const applyH = (H, [x, y]) => { const w = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w]; };
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// real sizes of quad Q (TL,TR,BR,BL in photo px) using a reference rectangle R (TL,TR,BR,BL) of real size rw×rh (mm) on the same wall
export function sizeByReference(Q, R, rw, rh) {
  const H = homography(R, [[0, 0], [rw, 0], [rw, rh], [0, rh]]);
  if (!H) return null;
  const P = Q.map(p => applyH(H, p));
  return { w: (d2(P[0], P[1]) + d2(P[3], P[2])) / 2, h: (d2(P[0], P[3]) + d2(P[1], P[2])) / 2 };
}
// width ÷ height of a real rectangle seen at an angle (Zhang & He method), principal point at the photo centre
export function aspectRatio(Q, W, H, fGuess) {
  const u0 = W / 2, v0 = H / 2;
  const m1 = [...Q[0], 1], m2 = [...Q[1], 1], m3 = [...Q[3], 1], m4 = [...Q[2], 1]; // m1 TL, m2 TR, m3 BL, m4 BR
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3);
  const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
  const n2 = m2.map((v, i) => k2 * v - m1[i]), n3 = m3.map((v, i) => k3 * v - m1[i]);
  let f2 = -((n2[0] * n3[0] - (n2[0] * n3[2] + n2[2] * n3[0]) * u0 + n2[2] * n3[2] * u0 * u0) +
    (n2[1] * n3[1] - (n2[1] * n3[2] + n2[2] * n3[1]) * v0 + n2[2] * n3[2] * v0 * v0)) / (n2[2] * n3[2]);
  const maxD = Math.max(W, H);
  let f = f2 > 0 ? Math.sqrt(f2) : null;
  if (!f || f < 0.4 * maxD || f > 2.5 * maxD) f = fGuess || 0.78 * maxD; // nearly straight-on photo: use the usual phone lens
  const nn = n => ((n[0] - u0 * n[2]) ** 2 + (n[1] - v0 * n[2]) ** 2) / (f * f) + n[2] * n[2];
  return Math.sqrt(nn(n2) / nn(n3));
}
export function shutterCalc(wMm, hMm, opt) {
  const out = { sqft: wMm * hMm / SQFT, sqm: wMm * hMm / 1e6 };
  if (opt.panels > 0) { out.panelW = wMm / opt.panels; out.panels = opt.panels; }
  else if (opt.panelW > 0) { out.panels = Math.ceil(wMm / opt.panelW); out.panelW = wMm / out.panels; }
  if (out.panels && opt.stack > 0) out.stackW = out.panels * opt.stack;
  return out;
}

// ---------- screen ----------
export async function renderPhoto(el, job) {
  const saved = (await db.byJob('points', job.id)).filter(p => p.kind === 'photo').sort((a, b) => b.createdAt - a.createdAt);
  el.innerHTML = `<div class="card"><b>📐 Size from photo</b><p class="small">Shutter / door / hoarding opening: take a photo, tap its 4 corners, give one known size → width, height, sqft and panel sizes.</p>
    <div class="row"><label class="btn big">📷 Take photo<input type="file" id="p-cam" accept="image/*" capture="environment" hidden></label><label class="btn big ghost">🖼 From gallery<input type="file" id="p-gal" accept="image/*" hidden></label></div>
    <details><summary class="small">Photo tips</summary><p class="small">Get the whole opening in, all 4 corners visible. Best: hold a tape across the opening (or keep a known board/tile in the photo, flat on the same wall). Straight-on is best, but an angle is fine.</p></details></div>
    <div id="pw"></div><h3>Saved</h3><div id="psl">${saved.length ? '' : '<div class="empty">None yet.</div>'}</div>`;
  await mountTip(el, 'photo');
  const sl = el.querySelector('#psl');
  for (const r of saved) {
    const d = document.createElement('div'); d.className = 'prow g';
    d.innerHTML = `<span class="pin static g">▭</span><div><b>${esc(r.label)}</b><small>${fmt(r.widthMm, 'mm')} × ${fmt(r.heightMm, 'mm')} · ${r.sqft.toFixed(2)} sqft${r.panels ? ` · ${r.panels} panels × ${Math.round(r.panelW)} mm` : ''}${r.approx ? ' · approx' : ''}</small></div><button class="link r small">Delete</button>`;
    d.querySelector('button').onclick = async e => { e.stopPropagation(); if (await confirmBox('Delete this?', 'Delete')) { await db.del('points', r.id); renderPhoto(el, job); } };
    d.onclick = async () => { if (r.photoId) { try { const b = await getBlob(r.photoId); window.open(URL.createObjectURL(b)); } catch (e2) { toast(e2.message); } } };
    sl.appendChild(d);
  }
  const onFile = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) work(el.querySelector('#pw'), job, f, () => renderPhoto(el, job)); };
  el.querySelector('#p-cam').onchange = onFile; el.querySelector('#p-gal').onchange = onFile;
}

async function work(box, job, file, done) {
  const img = new Image(); img.src = URL.createObjectURL(file); await img.decode();
  const sc = Math.min(1, 1200 / img.naturalWidth);
  const W = Math.round(img.naturalWidth * sc), H = Math.round(img.naturalHeight * sc);
  const base = document.createElement('canvas'); base.width = W; base.height = H; base.getContext('2d').drawImage(img, 0, 0, W, H);
  let Q = [], R = [], stage = 'opening', drag = null, result = null;
  box.innerHTML = `<div class="card"><p id="pp-step"></p>
    <div class="count-stage"><canvas id="pp-view"></canvas></div>
    <div id="pp-ref" hidden>
      <p><b>One known size</b> (pick one):</p>
      <div class="seg"><button data-r="side" class="on">A side of the opening</button><button data-r="obj">A board / tile in photo</button></div>
      <div id="r-side"><div class="lgrid w3"><label>Which side<select id="r-which"><option value="w">Width (top/bottom)</option><option value="h">Height (left/right)</option></select></label><label>Its size<input id="r-val" placeholder="e.g. 3000 or 9'10&quot;"></label></div>
        <p class="small muted">From the tape, a drawing, or a camera reading. The other side is worked out from the photo angle (about ±3–5%).</p></div>
      <div id="r-obj" hidden><p class="small">Tap the 4 corners of the board/tile on the photo (it must be flat on the same wall).</p>
        <div class="lgrid"><label>Its width<input id="o-w" placeholder="e.g. 600"></label><label>Its height<input id="o-h" placeholder="e.g. 600"></label></div>
        <button class="btn ghost sm" id="o-redo">Tap its corners again</button></div>
      <div id="pp-out" class="card res-card"></div>
      <details open><summary><b>Folding / sliding shutter</b></summary>
        <div class="lgrid"><label>No. of panels<input id="s-n" inputmode="numeric" placeholder="e.g. 14"></label><label>or panel width<input id="s-pw" placeholder="e.g. 600"></label><label>Folded panel thickness<input id="s-t" placeholder="e.g. 50"></label></div>
        <p class="small muted">Count panels on a sample shutter with 🔢 Count from photo. Thickness = how much one folded panel takes (from the vendor).</p></details>
      <label>Name<input id="pp-name" placeholder="e.g. Vision Express – front shutter"></label>
      <div class="row wrap"><button class="btn ghost" id="pp-redo">↶ Corners again</button><button class="btn ghost" id="pp-sheet">🧾 Add to sheet</button><button class="btn" id="pp-save">💾 Save</button></div>
    </div></div>`;
  const view = box.querySelector('#pp-view'), v = view.getContext('2d'); view.width = W; view.height = H;
  const q = id => box.querySelector(id);
  let refMode = 'side';
  const NAMES = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
  function step() {
    if (stage === 'opening') q('#pp-step').innerHTML = `<b>Tap the ${NAMES[Q.length]} corner</b> of the opening (${Q.length + 1} of 4). You can drag a corner later.`;
    else if (stage === 'ref') q('#pp-step').innerHTML = `<b>Tap the ${NAMES[R.length]} corner of the board/tile</b> (${R.length + 1} of 4).`;
    else q('#pp-step').innerHTML = '<b>Drag any corner</b> to fine-tune. Fill the known size below.';
  }
  function quad(P, color) {
    if (!P.length) return;
    v.strokeStyle = color; v.lineWidth = Math.max(3, W / 300); v.beginPath(); v.moveTo(...P[0]); P.slice(1).forEach(p => v.lineTo(...p)); if (P.length === 4) v.closePath(); v.stroke();
    P.forEach((p, i) => { v.beginPath(); v.arc(p[0], p[1], Math.max(8, W / 90), 0, Math.PI * 2); v.fillStyle = color; v.globalAlpha = .8; v.fill(); v.globalAlpha = 1; v.fillStyle = '#fff'; v.font = `bold ${Math.max(10, W / 80)}px sans-serif`; v.textAlign = 'center'; v.textBaseline = 'middle'; v.fillText(String(i + 1), p[0], p[1]); });
  }
  function draw() {
    v.drawImage(base, 0, 0); quad(Q, '#d92d20'); quad(R, '#2563eb');
    if (result && Q.length === 4) {
      v.font = `bold ${Math.max(14, W / 45)}px sans-serif`; v.fillStyle = '#ffd400'; v.strokeStyle = '#000'; v.lineWidth = 4; v.textAlign = 'center';
      const top = [(Q[0][0] + Q[1][0]) / 2, (Q[0][1] + Q[1][1]) / 2 - 12], left = [(Q[0][0] + Q[3][0]) / 2 + 10, (Q[0][1] + Q[3][1]) / 2];
      const tw = `${Math.round(result.w)} mm`, th = `${Math.round(result.h)} mm`;
      v.strokeText(tw, ...top); v.fillText(tw, ...top); v.textAlign = 'left'; v.strokeText(th, ...left); v.fillText(th, ...left);
    }
  }
  function calc() {
    result = null;
    if (Q.length < 4) { q('#pp-out').innerHTML = ''; draw(); return; }
    if (refMode === 'side') {
      const p = parseSize(q('#r-val').value, 'mm');
      if (p) {
        const ar = aspectRatio(Q, W, H);
        result = q('#r-which').value === 'w' ? { w: p.mm, h: p.mm / ar, approx: true } : { h: p.mm, w: p.mm * ar, approx: true };
      }
    } else if (R.length === 4) {
      const a = parseSize(q('#o-w').value, 'mm'), b = parseSize(q('#o-h').value, 'mm');
      if (a && b) { const r = sizeByReference(Q, R, a.mm, b.mm); if (r) result = { ...r, approx: false }; }
    }
    if (!result) { q('#pp-out').innerHTML = '<p class="small muted">Fill the known size to see the result.</p>'; draw(); return; }
    const opt = { panels: Number(q('#s-n').value) || 0, panelW: (parseSize(q('#s-pw').value, 'mm') || {}).mm || 0, stack: (parseSize(q('#s-t').value, 'mm') || {}).mm || 0 };
    const s = shutterCalc(result.w, result.h, opt); result.calc = s;
    q('#pp-out').innerHTML = `<div class="areas"><div><span>Width</span><b>${fmt(result.w, 'mm')}</b><small>${fmt(result.w, 'ftin')}</small></div><div><span>Height</span><b>${fmt(result.h, 'mm')}</b><small>${fmt(result.h, 'ftin')}</small></div>
      <div><span>Shutter area</span><b>${s.sqft.toFixed(2)} sqft</b><small>${s.sqm.toFixed(2)} m²</small></div>
      ${s.panels ? `<div><span>Panels</span><b>${s.panels} × ${Math.round(s.panelW)} mm</b><small>${s.stackW ? `folded stack ≈ ${Math.round(s.stackW)} mm · clear opening ≈ ${Math.round(result.w - s.stackW)} mm` : 'type thickness for folded stack'}</small></div>` : '<div><span>Panels</span><b>—</b><small>type no. of panels or panel width</small></div>'}</div>
      <p class="small ${result.approx ? 'a' : 'g'}">${result.approx ? 'Approx (±3–5%) – one side from tape, other from photo angle. Check with the tape before ordering.' : 'Scaled from the board/tile on the same wall.'}</p>`;
    draw();
  }
  const toImg = e => { const r = view.getBoundingClientRect(); return [(e.clientX - r.left) * W / r.width, (e.clientY - r.top) * H / r.height]; };
  view.addEventListener('pointerdown', e => {
    const p = toImg(e), rad = W / 18;
    if (stage === 'done') {
      for (const [arr, name] of [[Q, 'Q'], [R, 'R']]) { const i = arr.findIndex(c => d2(c, p) < rad); if (i >= 0) { drag = { arr, i }; view.setPointerCapture(e.pointerId); return; } }
    }
  });
  view.addEventListener('pointermove', e => { if (!drag) return; drag.arr[drag.i] = toImg(e); calc(); });
  view.addEventListener('pointerup', e => {
    if (drag) { drag = null; calc(); return; }
    const p = toImg(e);
    if (stage === 'opening') { Q.push(p); if (Q.length === 4) { stage = 'done'; q('#pp-ref').hidden = false; } }
    else if (stage === 'ref') { R.push(p); if (R.length === 4) stage = 'done'; }
    step(); calc();
  });
  box.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
    refMode = b.dataset.r; box.querySelectorAll('[data-r]').forEach(x => x.classList.toggle('on', x === b));
    q('#r-side').hidden = refMode !== 'side'; q('#r-obj').hidden = refMode !== 'obj';
    if (refMode === 'obj' && R.length < 4) { R = []; stage = 'ref'; }
    step(); calc();
  });
  q('#o-redo').onclick = () => { R = []; stage = 'ref'; step(); calc(); };
  q('#pp-redo').onclick = () => { Q = []; stage = 'opening'; q('#pp-ref').hidden = true; step(); calc(); };
  ['#r-val', '#r-which', '#o-w', '#o-h', '#s-n', '#s-pw', '#s-t'].forEach(id => q(id).addEventListener('input', calc));
  const record = async () => {
    if (!result) { toast('Fill the known size first'); return null; }
    const label = q('#pp-name').value.trim() || `Opening ${fileDate()}`;
    const blob = await new Promise(r => view.toBlob(r, 'image/jpeg', 0.85));
    const f = await saveJobFile(job.id, `${safeName(job.name)} – ${safeName(label)}.jpg`, blob, 'photo-size');
    const s = result.calc;
    return db.put('points', { id: db.uid(), jobId: job.id, kind: 'photo', label, widthMm: Math.round(result.w), heightMm: Math.round(result.h), sqft: s.sqft, panels: s.panels || null, panelW: s.panelW || null, stackW: s.stackW || null, approx: result.approx, photoId: f.id, createdAt: Date.now() });
  };
  q('#pp-save').onclick = async () => { const r = await record(); if (r) { toast('Saved'); done(); } };
  q('#pp-sheet').onclick = async () => {
    const r = await record(); if (!r) return;
    const sh = await loadSheet(job);
    sh.items.push({ id: db.uid(), no: String(sh.items.length + 1), heading: r.label, lines: [{ id: db.uid(), desc: `${r.label}${r.approx ? ' (from photo – check with tape)' : ''}`, unit: 'Sqft', nos: 1, length: `${r.widthMm} mm`, breadth: '', width: `${r.heightMm} mm` }] });
    await db.put('sheets', sh); toast('Saved and added to the measurement sheet'); done();
  };
  step(); draw();
}
