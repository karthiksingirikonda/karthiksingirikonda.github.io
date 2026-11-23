// Count from photo: draw a box round ONE sample item → the app finds all similar items and counts them.
import * as db from './db.js';
import { esc, toast, download, fileDate, safeName } from './util.js';
import { mountTip, busy, confirmBox } from './ui.js';
import { saveJobFile, getBlob } from './ui-drawing.js';

const WORK_W = 640; // photo is worked on at this width (fast on the phone)
const LINE_W = 1400; // layers are read on a sharper copy

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

async function similarWork(box, job, img, done) {
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
      <div class="row"><button class="btn ghost" id="c-back">← Other way</button><button class="btn ghost" id="c-redo">↶ New box</button><button class="btn" id="c-save">💾 Save count</button></div>
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
  q('#c-back').onclick = () => chooser(box, job, img, done);
  q('#c-save').onclick = () => saveCount(job, view, q('#c-name').value, marks.length, { estimate, method: 'similar' }, done);
  draw();
}

// ---------- shared ----------
async function saveCount(job, view, name, count, extra, done) {
  const label = (name || '').trim() || `Count ${fileDate()}`;
  const w = view.width, h = view.height;
  const out = document.createElement('canvas'); out.width = w; out.height = h + 40;
  const o = out.getContext('2d'); o.drawImage(view, 0, 0); o.fillStyle = '#fff'; o.fillRect(0, h, w, 40); o.fillStyle = '#000'; o.font = 'bold 18px sans-serif'; o.fillText(`${label}: ${count}`, 10, h + 26);
  const blob = await new Promise(r => out.toBlob(r, 'image/jpeg', 0.85));
  const f = await saveJobFile(job.id, `${safeName(job.name)} – ${safeName(label)}.jpg`, blob, 'count');
  await db.put('points', { id: db.uid(), jobId: job.id, kind: 'count', label, count, photoId: f.id, createdAt: Date.now(), ...extra });
  toast(`Saved: ${label} = ${count}`); done();
}
function scaled(img, maxW) {
  const sc = Math.min(1, maxW / img.naturalWidth);
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}
const grayOf = c => toGray(c.getContext('2d').getImageData(0, 0, c.width, c.height).data, c.width, c.height);

async function countWork(box, job, file, done) {
  const img = new Image(); img.src = URL.createObjectURL(file);
  await new Promise((r, j) => { img.onload = r; img.onerror = j; });
  chooser(box, job, img, done);
}

// ---------- step 1: which way to count (best one highlighted) ----------
function chooser(box, job, img, done) {
  const c = scaled(img, LINE_W), g = grayOf(c);
  const lay = bestLayers(g, c.width, c.height);
  const small = scaled(img, 700), sg = grayOf(small);
  const loose = looseAnalyse(sg, small.width, small.height, 0);
  let best = 'similar';
  const looseOk = loose.items >= 5 && loose.estimate <= 1500 && loose.estimate < loose.items * 2 && loose.cv < 0.5 && loose.fgShare < 0.45;
  if (looseOk) best = 'loose';
  else if (lay && lay.strength > 0.25 && lay.count >= 4) best = 'layers';
  const opt = (k, icon, title, desc) => `<button class="opt ${k === best ? 'best' : ''}" data-way="${k}"><b>${icon} ${title}${k === best ? ' – suggested' : ''}</b><span>${desc}</span></button>`;
  box.innerHTML = `<div class="card"><img class="photo" src="${img.src}" alt=""><p><b>What do you want to count?</b></p>
    ${opt('loose', '🔩', 'Loose items', `Screws, nuts, seeds spread on a sheet${loose.items ? ` – about ${loose.estimate} seen` : ''}`)}
    ${opt('layers', '☰', 'Stack / layers', `Boards, ply, laminates, bags, shutter slats, grill rods${lay ? ` – about ${lay.count} ${lay.dir === 'v' ? 'layers' : 'bars'} seen` : ''}`)}
    ${opt('similar', '▢', 'Same item spread around', 'Butterflies, lights, pillars – box one, the app counts the rest')}</div>`;
  box.querySelectorAll('[data-way]').forEach(b => b.onclick = () => {
    const k = b.dataset.way;
    if (k === 'loose') looseWork(box, job, img, done);
    else if (k === 'layers') layersWork(box, job, img, done, lay);
    else similarWork(box, job, img, done);
  });
}

// ---------- LAYERS: count along a line ----------
export function lineProfile(g, w, h, x0, y0, x1, y1, half = 10) {
  const L = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0)));
  const ux = (x1 - x0) / L, uy = (y1 - y0) / L, px = -uy, py = ux;
  const out = new Float32Array(L + 1);
  for (let t = 0; t <= L; t++) {
    let s = 0, n = 0;
    for (let o = -half; o <= half; o += 2) {
      const x = Math.round(x0 + ux * t + px * o), y = Math.round(y0 + uy * t + py * o);
      if (x >= 0 && y >= 0 && x < w && y < h) { s += g[y * w + x]; n++; }
    }
    out[t] = n ? s / n : 0;
  }
  return out;
}
function detrend(p) {
  const n = p.length, k = 25, out = new Float32Array(n);
  const pre = new Float64Array(n + 1); for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + p[i];
  for (let i = 0; i < n; i++) { const a = Math.max(0, i - k), b = Math.min(n, i + k + 1); out[i] = p[i] - (pre[b] - pre[a]) / (b - a); }
  const sm = new Float32Array(n); for (let i = 0; i < n; i++) sm[i] = (out[Math.max(0, i - 1)] + out[i] + out[Math.min(n - 1, i + 1)]) / 3;
  return sm;
}
export function periodOf(sm, a = 0, b = sm.length - 1) {
  const n = b - a + 1; if (n < 20) return null;
  let mean = 0; for (let i = a; i <= b; i++) mean += sm[i]; mean /= n;
  let z0 = 0; for (let i = a; i <= b; i++) z0 += (sm[i] - mean) ** 2; if (!z0) return null;
  const maxLag = Math.min(250, Math.floor(n / 3)), r = new Float32Array(maxLag + 1);
  for (let lag = 1; lag <= maxLag; lag++) { let s = 0; for (let i = a; i + lag <= b; i++) s += (sm[i] - mean) * (sm[i + lag] - mean); r[lag] = s / z0; }
  // skip the first hump (neighbouring pixels always look alike), then take the highest repeat
  let lag0 = 1; while (lag0 < maxLag && r[lag0] > 0) lag0++;
  if (lag0 >= maxLag) return null;
  // all repeat peaks
  const pk = [];
  for (let lag = Math.max(2, lag0); lag < maxLag; lag++) if (r[lag] > 0.08 && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) pk.push(lag);
  if (!pk.length) return null;
  // candidate spacings: each peak and the gaps between peaks (photos at an angle blur the first peak)
  const cands = new Set(pk);
  for (let i = 1; i < pk.length; i++) cands.add(pk[i] - pk[i - 1]);
  let bestB = null, bestScore = 0;
  const scoreOf = bb => { let sc = 0; for (const l of pk) { const k = l / bb, kr = Math.round(k); if (kr >= 1 && Math.abs(k - kr) < 0.12 * Math.max(1, kr / 2)) sc += r[l]; } return sc; };
  const scored = [...cands].filter(c => c >= Math.max(6, 0.4 * pk[0])).map(c => [c, scoreOf(c)]);
  const top = Math.max(...scored.map(x => x[1]));
  for (const [c, sc] of scored.sort((x, y) => x[0] - y[0])) if (sc >= 0.8 * top) { bestB = c; bestScore = sc; break; }
  if (!bestB) return null;
  const strength = Math.max(...pk.map(l => r[l]));
  return strength > 0.1 ? { p: bestB, strength } : null;
}
// strongest run of evenly spaced peaks → its two ends
export function autoEnds(sm, p) {
  const n = sm.length, cand = [];
  for (let i = 1; i < n - 1; i++) if (sm[i] >= sm[i - 1] && sm[i] >= sm[i + 1] && sm[i] > 0) cand.push(i);
  cand.sort((x, y) => sm[y] - sm[x]);
  let keep = [];
  for (const c of cand) if (keep.every(q => Math.abs(c - q) >= 0.7 * p)) keep.push(c);
  keep.sort((x, y) => x - y);
  if (keep.length < 3) return null;
  const med = keep.map(i => sm[i]).sort((x, y) => x - y)[Math.floor(keep.length / 2)];
  keep = keep.filter(i => sm[i] > 0.3 * med);
  let bs = 0, be = 0, s = 0;
  for (let i = 1; i < keep.length; i++) {
    const gap = keep[i] - keep[i - 1];
    if (gap > 2.4 * p) s = i;
    if (keep[i] - keep[s] > keep[be] - keep[bs]) { bs = s; be = i; }
  }
  if (be <= bs) return null;
  // trim weak ends (frames, reflections) – layers in the run are about equally strong
  const run = keep.slice(bs, be + 1), rm = run.map(i => sm[i]).sort((x, y) => x - y)[Math.floor(run.length / 2)];
  let i0 = 0, i1 = run.length - 1;
  while (i1 - i0 > 2 && sm[run[i0]] < 0.5 * rm) i0++;
  while (i1 - i0 > 2 && sm[run[i1]] < 0.5 * rm) i1--;
  return [run[i0], run[i1]];
}
export function gridMarks(sm, s, e, p) {
  const cnt = Math.max(1, Math.round((e - s) / p)), pp = (e - s) / cnt, out = [];
  for (let i = 0; i <= cnt; i++) {
    const c = s + i * pp, r = Math.max(1, Math.floor(0.2 * pp));
    let bi = Math.round(c), bv = -Infinity;
    for (let j = Math.max(0, Math.round(c) - r); j <= Math.min(sm.length - 1, Math.round(c) + r); j++) if (sm[j] > bv) { bv = sm[j]; bi = j; }
    out.push(bi);
  }
  return out;
}
function bestLayers(g, w, h) {
  const tries = [];
  for (const fx of [0.35, 0.5, 0.65]) tries.push({ dir: 'v', x0: w * fx, y0: h * 0.05, x1: w * fx, y1: h * 0.95 });
  for (const fy of [0.35, 0.5, 0.65]) tries.push({ dir: 'h', x0: w * 0.05, y0: h * fy, x1: w * 0.95, y1: h * fy });
  let best = null;
  for (const t of tries) {
    const sm = detrend(lineProfile(g, w, h, t.x0, t.y0, t.x1, t.y1));
    const per = periodOf(sm); if (!per) continue;
    const ends = autoEnds(sm, per.p); if (!ends) continue;
    const L = sm.length - 1, f = a => [t.x0 + (t.x1 - t.x0) * a / L, t.y0 + (t.y1 - t.y0) * a / L];
    const count = Math.round((ends[1] - ends[0]) / per.p) + 1;
    const score = per.strength * Math.min(1, count / 8) * Math.min(1, 1.5 * (ends[1] - ends[0]) / L);
    if (!best || score > best.score) best = { ...t, strength: per.strength, score, count, a: f(ends[0]), b: f(ends[1]) };
  }
  return best;
}

function layersWork(box, job, img, done, sug) {
  const c = scaled(img, LINE_W), w = c.width, h = c.height, g = grayOf(c);
  let A = sug ? sug.a.slice() : [w * 0.5, h * 0.2], B = sug ? sug.b.slice() : [w * 0.5, h * 0.8];
  let marks = [], drag = null, extra = 0;
  box.innerHTML = `<div class="card"><p><b>☰ Stack / layers</b> – drag the two round ends so the line goes from the FIRST layer to the LAST layer, across all of them.</p>
    <div class="count-stage"><canvas id="l-view"></canvas></div>
    <div class="count-big"><span id="l-n">0</span> layers</div>
    <label class="small">Layer spacing <input type="range" id="l-sp" min="4" max="160" value="20"> <span class="muted">slide until each yellow tick sits on one layer</span></label>
    <div class="row"><button class="btn ghost sm" id="l-minus">− 1</button><button class="btn ghost sm" id="l-plus">+ 1</button><span class="small muted">if the count is off by one at an end</span></div>
    <p class="small muted">Tip: the line must cross every layer (tilt it with the layers if the photo is at an angle). Each yellow tick is one layer.</p>
    <label>Name<input id="l-name" placeholder="e.g. Gypsum boards – load 1"></label>
    <div class="row"><button class="btn ghost" id="l-back">← Other way</button><button class="btn" id="l-save">💾 Save count</button></div></div>`;
  const view = box.querySelector('#l-view'), v = view.getContext('2d'); view.width = w; view.height = h;
  const q = id => box.querySelector(id);
  let sm = null, sp = null;
  function compute(keepSpacing) {
    sm = detrend(lineProfile(g, w, h, A[0], A[1], B[0], B[1]));
    if (!keepSpacing || !sp) { const per = periodOf(sm, 0, sm.length - 1); sp = per ? per.p : Math.max(8, sm.length / 10); }
    const sl = q('#l-sp'); sl.max = Math.max(20, Math.round(sm.length / 2)); sl.value = Math.round(sp);
    marks = gridMarks(sm, 0, sm.length - 1, sp);
    draw();
  }
  function draw() {
    v.drawImage(c, 0, 0);
    const R = Math.max(10, w / 70);
    v.lineWidth = Math.max(3, w / 400); v.strokeStyle = '#2563eb'; v.beginPath(); v.moveTo(...A); v.lineTo(...B); v.stroke();
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, ux = (B[0] - A[0]) / L, uy = (B[1] - A[1]) / L;
    v.strokeStyle = '#ffd400'; v.lineWidth = Math.max(3, w / 300); v.font = `bold ${Math.round(R)}px sans-serif`; v.fillStyle = '#ffd400';
    marks.forEach((t, i) => { const x = A[0] + ux * t, y = A[1] + uy * t; v.beginPath(); v.moveTo(x - uy * R, y + ux * R); v.lineTo(x + uy * R, y - ux * R); v.stroke(); if ((i + 1) % 5 === 0 || i === 0 || i === marks.length - 1) v.fillText(String(i + 1), x + uy * R * 1.3 + 4, y - ux * R * 1.3); });
    for (const P of [A, B]) { v.beginPath(); v.arc(P[0], P[1], R, 0, Math.PI * 2); v.fillStyle = 'rgba(37,99,235,.85)'; v.fill(); v.lineWidth = 3; v.strokeStyle = '#fff'; v.stroke(); }
    q('#l-n').textContent = Math.max(0, marks.length + extra);
  }
  const toImg = e => { const r = view.getBoundingClientRect(); return [(e.clientX - r.left) * w / r.width, (e.clientY - r.top) * h / r.height]; };
  view.addEventListener('pointerdown', e => { const p = toImg(e); const r = w / 15; drag = Math.hypot(p[0] - A[0], p[1] - A[1]) < r ? 'A' : Math.hypot(p[0] - B[0], p[1] - B[1]) < r ? 'B' : null; if (drag) view.setPointerCapture(e.pointerId); });
  view.addEventListener('pointermove', e => { if (!drag) return; const p = toImg(e); if (drag === 'A') A = p; else B = p; draw(); });
  view.addEventListener('pointerup', () => { if (drag) { drag = null; extra = 0; compute(true); } });
  q('#l-sp').oninput = e => { sp = Number(e.target.value); extra = 0; marks = gridMarks(sm, 0, sm.length - 1, sp); draw(); };
  q('#l-minus').onclick = () => { extra--; draw(); };
  q('#l-plus').onclick = () => { extra++; draw(); };
  q('#l-back').onclick = () => chooser(box, job, img, done);
  q('#l-save').onclick = () => saveCount(job, view, q('#l-name').value, Math.max(0, marks.length + extra), { method: 'layers' }, done);
  compute();
}

// ---------- LOOSE ITEMS: separate items from the plain background, split touching ones by size ----------
export function otsu(g) {
  const hist = new Array(256).fill(0); for (let i = 0; i < g.length; i++) hist[Math.max(0, Math.min(255, g[i] | 0))]++;
  const N = g.length; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = N - wB; if (!wF) break; sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; t = i; } }
  return t;
}
// mask: 1 = item. Items are the smaller share (background is the big plain area).
export function itemMask(g, w, h, shift = 0) {
  const t = otsu(g) + shift;
  let dark = 0; for (let i = 0; i < g.length; i++) if (g[i] < t) dark++;
  const itemsDark = dark < g.length / 2;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) m[i] = itemsDark ? (g[i] < t ? 1 : 0) : (g[i] > t ? 1 : 0);
  // open: remove specks
  const e = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; e[i] = m[i] & m[i - 1] & m[i + 1] & m[i - w] & m[i + w]; }
  const o = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; o[i] = e[i] | e[i - 1] | e[i + 1] | e[i - w] | e[i + w]; }
  return o;
}
export function components(m, w, h) {
  const lab = new Int32Array(w * h), comps = [], st = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || lab[i]) continue;
    const id = comps.length + 1; let sp = 0; st[sp++] = i; lab[i] = id;
    let area = 0, sx = 0, sy = 0, minx = w, miny = h, maxx = 0, maxy = 0;
    while (sp) {
      const k = st[--sp], x = k % w, y = (k / w) | 0; area++; sx += x; sy += y;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      for (const nb of [k - 1, k + 1, k - w, k + w]) {
        if (nb < 0 || nb >= w * h) continue;
        if ((nb === k - 1 && x === 0) || (nb === k + 1 && x === w - 1)) continue;
        if (m[nb] && !lab[nb]) { lab[nb] = id; st[sp++] = nb; }
      }
    }
    comps.push({ id, area, cx: sx / area, cy: sy / area, minx, miny, maxx, maxy });
  }
  return { comps, lab };
}
export function looseCount(comps, unit) {
  let total = 0;
  for (const c of comps) { c.n = c.area < unit * 0.35 ? 0 : Math.max(1, Math.round(c.area / unit)); total += c.n; }
  return total;
}
function looseAnalyse(g, w, h, shift) {
  const m = itemMask(g, w, h, shift);
  let fg = 0; for (let i = 0; i < m.length; i++) fg += m[i];
  const { comps, lab } = components(m, w, h);
  const minA = w * h * 0.00005;
  const real = comps.filter(c => c.area >= minA && !(c.minx === 0 || c.miny === 0 || c.maxx === w - 1 || c.maxy === h - 1) || c.area >= minA * 40);
  const areas = real.map(c => c.area).sort((a, b) => a - b);
  const unit = areas.length ? areas[Math.floor(areas.length * 0.4)] : 1;
  const singles = areas.filter(a => a < unit * 1.5);
  const mean = singles.reduce((s, a) => s + a, 0) / (singles.length || 1);
  const cv = singles.length ? Math.sqrt(singles.reduce((s, a) => s + (a - mean) ** 2, 0) / singles.length) / mean : 9;
  const estimate = looseCount(real, unit);
  return { comps: real, lab, unit, items: real.length, cv, estimate, fgShare: fg / (w * h) };
}

function looseWork(box, job, img, done) {
  const c = scaled(img, 1000), w = c.width, h = c.height, g = grayOf(c);
  let shift = 0, an = looseAnalyse(g, w, h, shift), unit = an.unit, manual = [];
  box.innerHTML = `<div class="card"><p><b>🔩 Loose items</b> – tap ONE single item (not a touching pair). The app uses its size to count all, including ones touching each other.</p>
    <div class="count-stage"><canvas id="o-view"></canvas></div>
    <div class="count-big"><span id="o-n">0</span> items</div>
    <label class="small">Separation <input type="range" id="o-sh" min="-40" max="40" value="0"> <span class="muted">move if items are missed or the floor is counted</span></label>
    <p class="small muted">Red = one item. Blue with ×N = touching items counted by size. Tap a mark to change it; tap an empty spot to add one.</p>
    <label>Name<input id="o-name" placeholder="e.g. 3 mm screws – box 1"></label>
    <div class="row"><button class="btn ghost" id="o-back">← Other way</button><button class="btn" id="o-save">💾 Save count</button></div></div>`;
  const view = box.querySelector('#o-view'), v = view.getContext('2d'); view.width = w; view.height = h;
  const q = id => box.querySelector(id);
  const total = () => an.comps.reduce((s, k) => s + (k.n || 0), 0) + manual.length;
  function draw() {
    v.drawImage(c, 0, 0);
    const R = Math.max(7, Math.sqrt(unit) / 2.2);
    v.font = `bold ${Math.round(R)}px sans-serif`; v.textAlign = 'center'; v.textBaseline = 'middle';
    let k = 0;
    for (const cp of an.comps) {
      if (!cp.n) continue;
      v.beginPath(); v.arc(cp.cx, cp.cy, R, 0, Math.PI * 2); v.fillStyle = cp.n > 1 ? 'rgba(37,99,235,.9)' : 'rgba(217,45,32,.85)'; v.fill();
      v.fillStyle = '#fff'; v.fillText(cp.n > 1 ? '×' + cp.n : String(++k), cp.cx, cp.cy + 1); if (cp.n > 1) k += cp.n;
    }
    for (const p of manual) { v.beginPath(); v.arc(p[0], p[1], R, 0, Math.PI * 2); v.fillStyle = 'rgba(26,158,74,.9)'; v.fill(); v.fillStyle = '#fff'; v.fillText('+', p[0], p[1] + 1); }
    q('#o-n').textContent = total();
  }
  const toImg = e => { const r = view.getBoundingClientRect(); return [(e.clientX - r.left) * w / r.width, (e.clientY - r.top) * h / r.height]; };
  let picked = false;
  view.addEventListener('click', e => {
    const [x, y] = toImg(e);
    const id = an.lab[Math.round(y) * w + Math.round(x)];
    const cp = id ? an.comps.find(k => k.id === id) : null;
    if (!picked && cp) { unit = cp.area; picked = true; looseCount(an.comps, unit); draw(); toast('Size taken from this item'); return; }
    const mi = manual.findIndex(p => Math.hypot(p[0] - x, p[1] - y) < 15); if (mi >= 0) { manual.splice(mi, 1); draw(); return; }
    if (cp) {
      const s = popupCount(cp.n, n => { cp.n = n; draw(); }); void s;
    } else { manual.push([x, y]); draw(); }
  });
  q('#o-sh').oninput = e => { shift = Number(e.target.value); an = looseAnalyse(g, w, h, shift); looseCount(an.comps, unit); draw(); };
  q('#o-back').onclick = () => chooser(box, job, img, done);
  q('#o-save').onclick = () => saveCount(job, view, q('#o-name').value, total(), { method: 'loose' }, done);
  looseCount(an.comps, unit); draw();
}
function popupCount(n, set) {
  const wrap = document.createElement('div'); wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet"><h2>How many here?</h2><div class="row"><button class="btn ghost" data-d="-1">−</button><b id="pc" style="font-size:26px;min-width:50px;text-align:center">${n}</b><button class="btn ghost" data-d="1">＋</button><button class="btn" id="pc-ok">OK</button></div></div>`;
  document.body.appendChild(wrap);
  let v = n; wrap.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { v = Math.max(0, v + Number(b.dataset.d)); wrap.querySelector('#pc').textContent = v; });
  wrap.querySelector('#pc-ok').onclick = () => { set(v); wrap.remove(); };
  wrap.onclick = e => { if (e.target === wrap) wrap.remove(); };
}
