// Count from photo: draw a box round ONE sample item → the app finds all similar items and counts them.
import * as db from './db.js';
import { esc, toast, download, fileDate, safeName } from './util.js';
import { mountTip, busy, confirmBox } from './ui.js';
import { saveJobFile, getBlob } from './ui-drawing.js';

const WORK_W = 640; // photo is worked on at this width (fast on the phone)

// ---------- matching (pure functions, tested separately) ----------
export function toGray(data, w, h) {
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  return g;
}
// normalised match score (-1..1) of template T (tw×th) at every position, step 1
export function matchMap(g, w, h, T, tw, th) {
  const n = tw * th;
  let tm = 0; for (let i = 0; i < n; i++) tm += T[i]; tm /= n;
  const Tz = new Float32Array(n); let ts = 0;
  for (let i = 0; i < n; i++) { Tz[i] = T[i] - tm; ts += Tz[i] * Tz[i]; }
  ts = Math.sqrt(ts) || 1;
  // integral images for fast mean / variance of each window
  const W1 = w + 1, I = new Float64Array(W1 * (h + 1)), I2 = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) { let r = 0, r2 = 0; for (let x = 0; x < w; x++) { const v = g[y * w + x]; r += v; r2 += v * v; I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + r; I2[(y + 1) * W1 + x + 1] = I2[y * W1 + x + 1] + r2; } }
  const ow = w - tw + 1, oh = h - th + 1;
  const out = new Float32Array(Math.max(0, ow * oh));
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const a = y * W1 + x, b = a + tw, c = (y + th) * W1 + x, d = c + tw;
      const sum = I[d] - I[b] - I[c] + I[a], sum2 = I2[d] - I2[b] - I2[c] + I2[a];
      const varW = sum2 - sum * sum / n;
      if (varW < 1e-3) { out[y * ow + x] = 0; continue; }
      let dot = 0;
      for (let ty = 0; ty < th; ty++) { const row = (y + ty) * w + x, tr = ty * tw; for (let tx = 0; tx < tw; tx++) dot += g[row + tx] * Tz[tr + tx]; }
      out[y * ow + x] = dot / (Math.sqrt(varW) * ts);
    }
  }
  return { map: out, ow, oh };
}
// peaks above threshold, at least (minD) apart
export function peaks(map, ow, oh, thr, minDx, minDy) {
  const cand = [];
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) { const v = map[y * ow + x]; if (v >= thr) cand.push([v, x, y]); }
  cand.sort((a, b) => b[0] - a[0]);
  const keep = [];
  for (const c of cand) {
    if (keep.some(k => Math.abs(k[1] - c[1]) < minDx && Math.abs(k[2] - c[2]) < minDy)) continue;
    keep.push(c);
    if (keep.length > 3000) break;
  }
  return keep;
}

// ---------- screen ----------
export async function renderCount(el, job) {
  const saved = (await db.byJob('points', job.id)).filter(p => p.kind === 'count').sort((a, b) => b.createdAt - a.createdAt);
  el.innerHTML = `<div class="card"><b>🔢 Count from photo</b><p class="small">Bricks, pillars, tiles, lights, boxes… Take a photo, draw a box round ONE item, and the app counts all the similar ones.</p>
    <div class="row"><label class="btn big">📷 Take photo<input type="file" id="c-cam" accept="image/*" capture="environment" hidden></label><label class="btn big ghost">🖼 From gallery<input type="file" id="c-gal" accept="image/*" hidden></label></div>
    <details><summary class="small">Photo tips</summary><p class="small">Stand straight in front (not at an angle) so all items look the same size. Get all the items in, with good light and no shadows across them. For a long wall, take it in 2–3 parts and add the counts.</p></details></div>
    <div id="work"></div>
    <h3>Saved counts</h3><div id="sl">${saved.length ? '' : '<div class="empty">None yet.</div>'}</div>`;
  await mountTip(el, 'count');
  const sl = el.querySelector('#sl');
  for (const c of saved) {
    const d = document.createElement('div'); d.className = 'prow g';
    d.innerHTML = `<span class="pin static g">#</span><div><b>${esc(c.label)}</b><small>${c.count} counted${c.estimate ? ` · area check ≈ ${c.estimate}` : ''}</small></div><button class="link r small">Delete</button>`;
    d.querySelector('button').onclick = async e => { e.stopPropagation(); if (await confirmBox('Delete this count?', 'Delete')) { await db.del('points', c.id); renderCount(el, job); } };
    d.onclick = async () => { if (c.photoId) { try { const b = await getBlob(c.photoId); const w = window.open(URL.createObjectURL(b)); if (!w) download(b, c.label + '.jpg'); } catch (e2) { toast(e2.message); } } };
    sl.appendChild(d);
  }
  const onFile = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) countWork(el.querySelector('#work'), job, f, () => renderCount(el, job)); };
  el.querySelector('#c-cam').onchange = onFile; el.querySelector('#c-gal').onchange = onFile;
}

async function countWork(box, job, file, done) {
  const img = new Image(); img.src = URL.createObjectURL(file);
  await new Promise((r, j) => { img.onload = r; img.onerror = j; });
  const sc = Math.min(1, WORK_W / img.naturalWidth);
  const w = Math.round(img.naturalWidth * sc), h = Math.round(img.naturalHeight * sc);
  const work = document.createElement('canvas'); work.width = w; work.height = h;
  const wctx = work.getContext('2d'); wctx.drawImage(img, 0, 0, w, h);
  const gray = toGray(wctx.getImageData(0, 0, w, h).data, w, h);
  let sample = null, marks = [], thr = 0.6, map = null, ms = 1, sgray = null;

  box.innerHTML = `<div class="card"><p id="c-step"><b>Step 1:</b> Draw a box round ONE item with your finger.</p>
    <div class="count-stage"><canvas id="c-view"></canvas></div>
    <div id="c-tools" hidden>
      <div class="count-big"><span id="c-n">0</span> found</div>
      <label class="small">Match strictness <input type="range" id="c-thr" min="40" max="90" value="60"> <span id="c-tv">60</span>%</label>
      <p class="small muted">Lower = finds more (may add wrong ones). Higher = only very similar. Tap a wrong mark to remove it, tap an empty item to add it.</p>
      <details class="small"><summary>Brick wall check (optional)</summary>
        <div class="lgrid"><label>Wall length mm<input id="b-l" inputmode="numeric"></label><label>Wall height mm<input id="b-h" inputmode="numeric"></label><label>Brick L mm<input id="b-bl" value="230" inputmode="numeric"></label><label>Brick H mm<input id="b-bh" value="75" inputmode="numeric"></label></div>
        <label>Joint mm<input id="b-j" value="10" inputmode="numeric"></label><p id="b-out" class="small"></p></details>
      <label>Name<input id="c-name" placeholder="e.g. Bricks – front wall, Pillars – ground floor"></label>
      <div class="row"><button class="btn ghost" id="c-redo">↶ New box</button><button class="btn" id="c-save">💾 Save count</button></div>
    </div></div>`;
  const view = box.querySelector('#c-view'), vctx = view.getContext('2d');
  view.width = w; view.height = h;
  const q = id => box.querySelector(id);
  let estimate = null;

  function draw(drag) {
    vctx.drawImage(work, 0, 0);
    if (drag) { vctx.strokeStyle = '#ffd400'; vctx.lineWidth = 3; vctx.strokeRect(drag.x, drag.y, drag.w, drag.h); }
    if (sample) { vctx.strokeStyle = '#2563eb'; vctx.lineWidth = 3; vctx.strokeRect(sample.x, sample.y, sample.w, sample.h); }
    const r = Math.max(6, Math.min(sample ? Math.min(sample.w, sample.h) / 3 : 10, 18));
    vctx.font = `bold ${Math.max(9, r)}px sans-serif`; vctx.textAlign = 'center'; vctx.textBaseline = 'middle';
    marks.forEach((m, i) => {
      vctx.beginPath(); vctx.arc(m.x, m.y, r, 0, Math.PI * 2); vctx.fillStyle = m.added ? 'rgba(37,99,235,.85)' : 'rgba(217,45,32,.85)'; vctx.fill();
      vctx.fillStyle = '#fff'; vctx.fillText(String(i + 1), m.x, m.y + 1);
    });
    q('#c-n').textContent = marks.length;
  }
  function find() {
    const pk = peaks(map.map, map.ow, map.oh, thr, map.tw * 0.6, map.th * 0.6);
    const manual = marks.filter(m => m.added);
    marks = pk.map(([v, x, y]) => ({ x: (x + map.tw / 2) / ms, y: (y + map.th / 2) / ms, v })).concat(manual);
    draw(); brick();
  }
  function brick() {
    const n = k => Number(q(k).value) || 0;
    const L = n('#b-l'), H = n('#b-h'), bl = n('#b-bl'), bh = n('#b-bh'), j = n('#b-j');
    if (L && H && bl && bh) { estimate = Math.round((L * H) / ((bl + j) * (bh + j))); q('#b-out').innerHTML = `By area: about <b>${estimate}</b> bricks · photo count <b>${marks.length}</b>${Math.abs(estimate - marks.length) > estimate * 0.1 ? ' <span class="r">(more than 10% apart – check the photo)</span>' : ' ✔'}`; }
    else { estimate = null; q('#b-out').textContent = ''; }
  }
  // finger on the picture
  const toImg = e => { const r = view.getBoundingClientRect(); return { x: (e.clientX - r.left) * w / r.width, y: (e.clientY - r.top) * h / r.height }; };
  let start = null;
  view.addEventListener('pointerdown', e => { view.setPointerCapture(e.pointerId); start = { ...toImg(e), t: Date.now() }; });
  view.addEventListener('pointermove', e => { if (!start || sample) return; const p = toImg(e); draw({ x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) }); });
  view.addEventListener('pointerup', async e => {
    if (!start) return; const p = toImg(e); const s0 = start; start = null;
    const bw = Math.abs(p.x - s0.x), bh = Math.abs(p.y - s0.y);
    if (!sample) {
      if (bw < 6 || bh < 6) { toast('Drag a box round one item'); draw(); return; }
      if (bw * bh > w * h * 0.25) { toast('Box too big – draw round ONE item only'); draw(); return; }
      sample = { x: Math.round(Math.min(s0.x, p.x)), y: Math.round(Math.min(s0.y, p.y)), w: Math.round(bw), h: Math.round(bh) };
      // keep the sample small for speed (shrink picture work if needed)
      const b = busy('Finding similar items…');
      await new Promise(r => setTimeout(r, 30));
      // big samples are matched on a smaller copy so it stays fast
      ms = Math.min(1, Math.sqrt(500 / (sample.w * sample.h)));
      const sw = Math.max(8, Math.round(w * ms)), sh = Math.max(8, Math.round(h * ms));
      const small = document.createElement('canvas'); small.width = sw; small.height = sh;
      small.getContext('2d').drawImage(work, 0, 0, sw, sh);
      sgray = ms === 1 ? gray : toGray(small.getContext('2d').getImageData(0, 0, sw, sh).data, sw, sh);
      const tx0 = Math.round(sample.x * ms), ty0 = Math.round(sample.y * ms), tw = Math.max(3, Math.round(sample.w * ms)), th = Math.max(3, Math.round(sample.h * ms));
      const T = new Float32Array(tw * th);
      for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) T[y * tw + x] = sgray[(ty0 + y) * sw + tx0 + x];
      map = matchMap(sgray, sw, sh, T, tw, th); map.tw = tw; map.th = th;
      b.done();
      q('#c-tools').hidden = false; q('#c-step').innerHTML = '<b>Step 2:</b> Check the marks. Tap to remove wrong ones / add missed ones.';
      find();
      return;
    }
    // tap: remove a mark or add one
    if (bw > 10 || bh > 10) return;
    const rr = Math.max(8, Math.min(sample.w, sample.h) / 2);
    const i = marks.findIndex(m => Math.hypot(m.x - p.x, m.y - p.y) < rr);
    if (i >= 0) marks.splice(i, 1); else marks.push({ x: p.x, y: p.y, added: true });
    draw(); brick();
  });
  q('#c-thr').oninput = e => { thr = Number(e.target.value) / 100; q('#c-tv').textContent = e.target.value; if (map) find(); };
  ['#b-l', '#b-h', '#b-bl', '#b-bh', '#b-j'].forEach(id => q(id).oninput = brick);
  q('#c-redo').onclick = () => { sample = null; marks = []; map = null; q('#c-tools').hidden = true; q('#c-step').innerHTML = '<b>Step 1:</b> Draw a box round ONE item with your finger.'; draw(); };
  q('#c-save').onclick = async () => {
    const label = q('#c-name').value.trim() || `Count ${fileDate()}`;
    // save the marked photo into the job (and its Drive folder)
    const out = document.createElement('canvas'); out.width = w; out.height = h + 40;
    const o = out.getContext('2d'); o.drawImage(view, 0, 0); o.fillStyle = '#fff'; o.fillRect(0, h, w, 40); o.fillStyle = '#000'; o.font = 'bold 18px sans-serif'; o.fillText(`${label}: ${marks.length}`, 10, h + 26);
    const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.85));
    const f = await saveJobFile(job.id, `${safeName(job.name)} – ${safeName(label)}.jpg`, blob, 'count');
    await db.put('points', { id: db.uid(), jobId: job.id, kind: 'count', label, count: marks.length, estimate, photoId: f.id, createdAt: Date.now() });
    toast(`Saved: ${label} = ${marks.length}`); done();
  };
  draw();
}
