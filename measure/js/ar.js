// Camera measuring (Chrome WebXR + ARCore). Everything is rough (±1–2 cm) until confirmed with the tape.
// Modes: Length · Height · On wall · Room · Pillar
import * as db from './db.js';
import { fmt, parseSize } from './units.js';
import { esc, toast } from './util.js';
import { mountTip, sheet as popup } from './ui.js';

let THREE = null, threeP = null;
const loadThree = () => (threeP = threeP || import('../vendor/three.js').then(m => (THREE = m)));

export async function arSupported() {
  try { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch (e) { return false; }
}

export const MODES = {
  length: { name: 'Length', icon: '↔', hint: ['Put the ring on the first end → Mark', 'Go to the other end → Mark'] },
  height: { name: 'Height', icon: '↕', hint: ['Put the ring on the floor at the wall base → Mark', 'Aim at the top (ceiling line / beam / top of door) → Mark'] },
  wall: { name: 'On wall', icon: '▭', hint: ['Ring on the floor at one end of the wall base → Mark', 'Ring on the floor further along the same wall → Mark', 'Now aim anywhere on that wall → Mark two points (window, switch, beam…)'] },
  room: { name: 'Full room', icon: '⬚', hint: ['Ring on the floor in one corner → Mark', 'Next corner → Mark … go round the room, then tap Finish'] },
  pillar: { name: 'Pillar', icon: '▣', hint: ['Ring at one floor corner of the pillar → Mark', 'Next corner of the same face → Mark', 'Corner round the side → Mark'] },
  calib: { name: 'Calibrate', icon: '📏', hint: ['Lay the tape flat on the floor. Ring exactly on the 0 → Mark', 'Ring exactly on the tape length mark → Mark'] },
};
const PICK = ['length', 'height', 'wall', 'room', 'pillar'];

export async function renderAR(el, job) {
  const unit = await db.getSetting('unit', 'mm');
  const ok = await arSupported();
  if (ok) loadThree(); // load early so the camera opens fast
  const rough = (await db.byJob('points', job.id)).filter(p => p.kind === 'ar').sort((a, b) => b.createdAt - a.createdAt);
  const k = await db.getSetting('arScale', 1), calLen = await db.getSetting('arCalLen', 1000);
  el.innerHTML = `<div class="card"><b>📷 Measure with camera</b><p class="small">Every reading is <b class="a">rough (±1–2 cm)</b> – confirm with the tape before billing.</p>
    ${ok ? `<p class="small"><b>Tap what you want to measure – the camera opens:</b></p><div class="modes">${PICK.map(k => `<button class="opt sm" data-mode="${k}"><b>📷 ${MODES[k].icon} ${MODES[k].name}</b><span>${modeUse(k)}</span></button>`).join('')}</div>
      <div class="calib"><b>📏 Calibrate (one time)</b><p class="small">${k === 1 ? 'Not done yet. Do it once: lay a tape on the floor and mark its 0 and its length.' : `Done – correction ${((k - 1) * 100).toFixed(1)}% saved on this phone. Redo only if readings look wrong or after a phone update.`}</p>
        <div class="row"><label class="small" style="flex:1;margin:0">Tape length to mark (mm)<input id="cal-len" type="number" inputmode="numeric" value="${calLen}"></label><button class="btn" id="cal-go">📷 Calibrate</button>${k !== 1 ? '<button class="btn ghost sm" id="cal-reset">Reset</button>' : ''}</div></div>`
      : '<p class="muted">This phone/browser can\'t do camera measuring. Open the app in Chrome on an ARCore phone. Use the tape and type the size instead.</p>'}
    <details><summary class="small">How to hold the phone</summary><p class="small">Good light. Start by pointing at the floor 1–2 m ahead and move the phone slowly side to side until the ring appears. Plain walls are hard to catch – that is why Height and On wall start from the floor. Hold steady when you tap.</p></details></div>
    <h3>Readings</h3><div id="rl">${rough.length ? '' : '<div class="empty">None yet.</div>'}</div>`;
  await mountTip(el, 'ar');
  const rl = el.querySelector('#rl');
  for (const p of rough) {
    const d = document.createElement('div'); d.className = 'prow ' + (p.confirmedMm != null ? 'g' : 'n');
    d.innerHTML = `<span class="pin static ${p.confirmedMm != null ? 'g' : 'n'}">~</span><div><b>${esc(p.label || 'Reading')}</b><small>≈ ${fmt(p.roughMm, unit)} rough${p.confirmedMm != null ? ` · confirmed ${esc(p.confirmedText)}` : ' · not confirmed'}</small></div><span class="diff">${p.confirmedMm != null ? '✔' : 'Type real size'}</span>`;
    d.onclick = () => confirmForm(p, () => renderAR(el, job));
    rl.appendChild(d);
  }
  // Start the camera straight from the tap (the browser only allows it right after a tap)
  el.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => startSession(job, b.dataset.mode, () => renderAR(el, job), k, calLen));
  if (el.querySelector('#cal-go')) el.querySelector('#cal-go').onclick = () => {
    const v = Number(el.querySelector('#cal-len').value) || 1000;
    db.setSetting('arCalLen', v);
    startSession(job, 'calib', () => renderAR(el, job), 1, v);
  };
  if (el.querySelector('#cal-reset')) el.querySelector('#cal-reset').onclick = async () => { await db.setSetting('arScale', 1); toast('Calibration cleared'); renderAR(el, job); };
}
function modeUse(k) {
  return { length: 'Wall to wall, room length/width, any straight run on floor', height: 'Floor to ceiling, beam, bulkhead, door top', wall: 'Window/door width & height, sill, anything up on a wall', room: 'Whole room: all walls + area → goes to Plan', pillar: 'Column width × depth' }[k];
}

function confirmForm(p, done) {
  const s = popup(`<h2>${esc(p.label || 'Reading')}</h2><p>Camera said about <b>${fmt(p.roughMm, 'mm')}</b> (rough ±1–2 cm).</p>
    <label>Name<input id="c-l" value="${esc(p.label || '')}"></label>
    <label>Real size (from tape) – needed before use<input id="c-s" value="${esc(p.confirmedText || '')}" placeholder="type the real size"></label>
    <div class="row end"><button class="btn ghost r" id="c-d">Delete</button><button class="btn" id="c-ok">Save</button></div>`);
  s.el.querySelector('#c-ok').onclick = async () => {
    const v = s.el.querySelector('#c-s').value.trim();
    const parsed = v ? parseSize(v, 'mm') : null;
    if (v && !parsed) return toast(`Can't read "${v}"`);
    p.label = s.el.querySelector('#c-l').value.trim();
    p.confirmedMm = parsed ? parsed.mm : null; p.confirmedText = parsed ? (parsed.kind === 'ftin' ? parsed.text : v) : '';
    await db.put('points', p); s.close(); done();
  };
  s.el.querySelector('#c-d').onclick = async () => { await db.del('points', p.id); s.close(); done(); };
}

// ---------- geometry (pure, tested separately) ----------
export const G = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  dist: (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
  // point on the vertical line through P closest to the ray (C, d)
  vertical(P, C, d) {
    const u = [0, 1, 0], w0 = G.sub(P, C), b = G.dot(u, d), dd = G.dot(u, w0), e = G.dot(d, w0);
    const den = 1 - b * b; if (den < 1e-4) return null;
    const t = (b * e - dd) / den;
    return [P[0], P[1] + t, P[2]];
  },
  // ray hits the vertical plane through A,B
  wallHit(A, B, C, d) {
    const n = G.norm(G.cross(G.sub(B, A), [0, 1, 0]));
    const den = G.dot(n, d); if (Math.abs(den) < 1e-3) return null;
    const s = G.dot(n, G.sub(A, C)) / den; if (s <= 0 || s > 30) return null;
    return G.add(C, G.mul(d, s));
  },
  // floor-plane distance (ignores small height differences between floor marks)
  flat: (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]),
  cornerAngle(prev, cur, next) {
    const v1 = G.norm([prev[0] - cur[0], 0, prev[2] - cur[2]]), v2 = G.norm([next[0] - cur[0], 0, next[2] - cur[2]]);
    return Math.acos(Math.max(-1, Math.min(1, G.dot(v1, v2)))) * 180 / Math.PI;
  },
  turn(a, b, c) { const c1 = G.cross([b[0] - a[0], 0, b[2] - a[2]], [c[0] - b[0], 0, c[2] - b[2]]); return c1[1] < 0 ? 'R' : 'L'; },
  area(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p[0] * q[2] - q[0] * p[2]; } return Math.abs(s) / 2; },
};
const mm0 = m => Math.round(m * 1000);

// ---------- the camera session ----------
async function startSession(job, mode, done, k = 1, calLen = 1000) {
  if (!navigator.xr) return toast('Camera measuring not available here');
  const overlay = document.createElement('div');
  overlay.className = 'ar-ov';
  overlay.innerHTML = `<div class="ar-top"><div class="ar-modes" ${mode === 'calib' ? 'hidden' : ''}>${PICK.map(key => `<button data-m="${key}">${MODES[key].icon} ${MODES[key].name}</button>`).join('')}</div><div id="ar-msg">Starting camera…</div></div>
    <div class="ar-mid"><div class="ar-cross"></div><div class="ar-read" id="ar-read"></div><div class="ar-list" id="ar-list"></div></div>
    <div class="ar-bot"><button class="btn ghost" id="ar-undo">↶ Undo</button><button class="btn ar-mark" id="ar-mark">● Mark</button><button class="btn ghost" id="ar-fin" hidden>✔ Finish</button><button class="btn ghost" id="ar-close">✕ Close</button></div>`;
  document.body.appendChild(overlay);
  // taps on our buttons must not also count as a screen tap
  overlay.querySelectorAll('.ar-top,.ar-bot').forEach(x => x.addEventListener('beforexrselect', e => e.preventDefault()));
  const msg = overlay.querySelector('#ar-msg'), read = overlay.querySelector('#ar-read'), list = overlay.querySelector('#ar-list');

  let session;
  try {
    // ask for the camera FIRST, while the tap is still fresh
    session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay', 'anchors'], domOverlay: { root: overlay } });
  } catch (e) {
    overlay.remove();
    popup(`<h2>Camera could not start</h2><p class="small">${esc(e.message)}</p><ol class="small"><li>Open the app in <b>Chrome</b> (not Samsung Internet).</li><li>Install / update <b>Google Play Services for AR</b> from the Play Store.</li><li>Chrome ⋮ → Settings → Site settings → Camera → allow this site.</li><li>Try again.</li></ol>`);
    return;
  }
  msg.textContent = 'Loading…';
  await loadThree();
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.domElement.style.display = 'none';
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 30);
  const reticle = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.05, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  reticle.matrixAutoUpdate = false; reticle.visible = false; scene.add(reticle);
  const aim = new THREE.Mesh(new THREE.SphereGeometry(0.02, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffd400 }));
  aim.visible = false; scene.add(aim);
  const drawn = new THREE.Group(); scene.add(drawn);
  // thick, easy-to-see bars (normal lines are only 1 pixel wide)
  const BAR = new THREE.CylinderGeometry(0.006, 0.006, 1, 10);
  const UP = new THREE.Vector3(0, 1, 0);
  const placeBar = (m, a, b) => {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), dir = vb.clone().sub(va), len = dir.length();
    m.position.copy(va).add(vb).multiplyScalar(0.5); m.scale.set(1, Math.max(len, 0.001), 1);
    if (len > 1e-6) m.quaternion.setFromUnitVectors(UP, dir.normalize());
  };
  const liveLine = new THREE.Mesh(BAR, new THREE.MeshBasicMaterial({ color: 0xffd400, depthTest: false }));
  liveLine.renderOrder = 2; liveLine.visible = false; scene.add(liveLine);

  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);
  const viewer = await session.requestReferenceSpace('viewer');
  const hitSource = await session.requestHitTestSource({ space: viewer });

  const mm = m => Math.round(m * 1000 * k); // calibrated
  // ---- state ----
  let cur = mode;
  let pts = [];          // marked points [x,y,z]
  let wallBase = null;   // [A,B] for On wall
  let results = [];      // readings in this session {label, mm, mode}
  let live = null;       // current aim point
  let hitOk = false, lastHit = null, lastLiveAt = 0, lastGood = null, busyMark = false;
  const recent = []; // last few aim points – averaged when you tap Mark
  const anchorQueue = [];
  const counts = {};

  const dot = (p, color) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.02, 16, 16), new THREE.MeshBasicMaterial({ color, depthTest: false })); m.renderOrder = 3; m.position.set(...p); drawn.add(m); };
  const seg = (a, b, color = 0xffd400) => { const m = new THREE.Mesh(BAR, new THREE.MeshBasicMaterial({ color, depthTest: false })); m.renderOrder = 2; placeBar(m, a, b); drawn.add(m); };
  const redraw = () => {
    drawn.clear();
    if (wallBase) { dot(wallBase[0], 0x2563eb); dot(wallBase[1], 0x2563eb); seg(wallBase[0], wallBase[1], 0x2563eb); }
    pts.forEach((p, i) => { dot(p, i ? 0xd92d20 : 0x1a9e4a); if (i) seg(pts[i - 1], p); });
  };
  const hint = () => {
    const h = MODES[cur].hint;
    let step = 0;
    if (cur === 'wall') step = !wallBase ? Math.min(pts.length, 1) : 2;
    else if (cur === 'room') step = pts.length ? 1 : 0;
    else step = Math.min(pts.length, h.length - 1);
    msg.textContent = (!hitOk && needsHit() ? 'Move slowly over the floor until the ring appears. ' : '') + h[step];
    overlay.querySelectorAll('[data-m]').forEach(b => b.classList.toggle('on', b.dataset.m === cur));
    overlay.querySelector('#ar-fin').hidden = !(cur === 'room' && pts.length >= 3);
  };
  const needsHit = () => cur === 'length' || cur === 'calib' || cur === 'room' || cur === 'pillar' || (cur === 'height' && !pts.length) || (cur === 'wall' && !wallBase);
  const showList = () => { list.innerHTML = results.slice(-4).map(r => `<div>${esc(r.label)}: <b>${fmt(r.mm, 'mm')}</b></div>`).join(''); };
  const label = (base) => { counts[base] = (counts[base] || 0) + 1; return `${base} ${counts[base]}`; };
  const vibrate = () => { try { navigator.vibrate && navigator.vibrate(25); } catch (e) { } };

  async function saveReading(lbl, valueMm, extra = {}) {
    const r = { id: db.uid(), jobId: job.id, kind: 'ar', rough: true, label: lbl, roughMm: valueMm, mode: cur, confirmedMm: null, createdAt: Date.now(), ...extra };
    await db.put('points', r); results.push({ label: lbl, mm: valueMm }); showList();
  }

  // Mark works on the first tap: uses the last steady readings (no waiting)
  let lastMarkAt = 0;
  function mark() {
    if (busyMark || Date.now() - lastMarkAt < 400) return; // one tap = one mark (button + screen tap together)
    const fresh = Date.now() - lastLiveAt < 600 ? lastGood : null; // ring may flicker – use the last good spot
    if (!fresh) { msg.textContent = needsHit() ? 'No floor found yet – move slowly over the floor until the ring shows.' : 'Aim a little differently and try again.'; return; }
    busyMark = true; lastMarkAt = Date.now();
    const near = recent.filter(r => G.dist(r, fresh) < 0.03);
    commit(near.length ? near : [fresh], needsHit() ? lastHit : null).finally(() => { busyMark = false; });
  }
  function median(arr) { const a = [...arr].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; }
  async function commit(samples, hit) {
    const p = [0, 1, 2].map(i => median(samples.map(s => s[i])));
    vibrate();
    anchorQueue.push({ p, hit });
    if (cur === 'length') {
      pts.push(p);
      if (pts.length === 2) { const d = mm(G.dist(pts[0], pts[1])); await saveReading(label('Length'), d); read.innerHTML = `≈ ${fmt(d, 'mm')}<small>saved · rough ±1–2 cm</small>`; pts = []; }
    } else if (cur === 'height') {
      pts.push(p);
      if (pts.length === 2) { const d = mm(Math.abs(pts[1][1] - pts[0][1])); await saveReading(label('Height'), d); read.innerHTML = `≈ ${fmt(d, 'mm')}<small>saved · rough</small>`; pts = []; }
    } else if (cur === 'wall') {
      if (!wallBase) {
        pts.push(p);
        if (pts.length === 2) {
          if (G.flat(pts[0], pts[1]) < 0.3) { msg.textContent = 'Keep the two floor marks at least 30 cm apart along the wall.'; pts = []; redraw(); return; }
          wallBase = [pts[0], pts[1]]; pts = [];
        }
      } else {
        pts.push(p);
        if (pts.length === 2) {
          const d = mm(G.dist(pts[0], pts[1]));
          const up = mm(Math.min(pts[0][1], pts[1][1]) - Math.min(wallBase[0][1], wallBase[1][1]));
          await saveReading(label('On wall'), d, { fromFloorMm: up });
          read.innerHTML = `≈ ${fmt(d, 'mm')}<small>lowest point ${fmt(up, 'mm')} above floor · saved</small>`;
          pts = [];
        }
      }
    } else if (cur === 'pillar') {
      pts.push(p);
      if (pts.length === 3) {
        const w = mm(G.flat(pts[0], pts[1])), dp = mm(G.flat(pts[1], pts[2]));
        const n = label('Pillar');
        await saveReading(`${n} – face`, w); await saveReading(`${n} – side`, dp);
        read.innerHTML = `≈ ${fmt(w, 'mm')} × ${fmt(dp, 'mm')}<small>${n} saved · rough</small>`;
        pts = [];
      }
    } else if (cur === 'room') {
      if (pts.length >= 3 && G.flat(p, pts[0]) < 0.15) return finishRoom(); // tapped the first corner again
      pts.push(p);
    } else if (cur === 'calib') {
      pts.push(p);
      if (pts.length === 2) {
        const raw = G.flat(pts[0], pts[1]) * 1000;
        const factor = calLen / raw;
        if (factor < 0.85 || factor > 1.15) { read.innerHTML = `Read ${Math.round(raw)} mm for ${calLen} mm<small>too far off – try again slowly</small>`; pts = []; redraw(); return; }
        await db.setSetting('arScale', factor);
        read.innerHTML = `Calibrated ✔<small>read ${Math.round(raw)} mm for ${calLen} mm · correction ${((factor - 1) * 100).toFixed(1)}% saved</small>`;
        msg.textContent = 'Done. Close and start measuring.';
        pts = [];
      }
    }
    redraw(); hint();
  }

  async function finishRoom() {
    if (pts.length < 3) return;
    const n = pts.length;
    const walls = pts.map((p, i) => {
      const q = pts[(i + 1) % n], r = pts[(i + 2) % n];
      return { len: `${mm(G.flat(p, q))} mm`, turn: G.turn(p, q, r) };
    });
    const angles = pts.map((p, i) => Math.round(G.cornerAngle(pts[(i - 1 + n) % n], p, pts[(i + 1) % n])));
    const area = G.area(pts);
    const rooms = await db.byJob('rooms', job.id);
    const name = `Room ${rooms.length + 1} (camera)`;
    await db.put('rooms', { id: db.uid(), jobId: job.id, name, shape: 'walls', walls, height: '', openings: [], rough: true, angles, createdAt: Date.now() });
    walls.forEach((w, i) => saveReading(`${name} – Wall ${String.fromCharCode(65 + i)}`, parseInt(w.len, 10)));
    read.innerHTML = `${n} walls · ${(area / 0.092903).toFixed(1)} sqft<small>corners: ${angles.map(a => a + '°').join(', ')} · saved to Plan</small>`;
    pts = []; redraw(); hint();
    msg.textContent = 'Room saved to Plan. Now take the height: tap ↕ Height.';
  }

  const markBtn = overlay.querySelector('#ar-mark');
  markBtn.onclick = e => { e.stopPropagation(); mark(); };
  overlay.querySelector('#ar-fin').onclick = e => { e.stopPropagation(); finishRoom(); };
  overlay.querySelector('#ar-undo').onclick = e => {
    e.stopPropagation();
    if (pts.length) pts.pop(); else if (wallBase) { pts = [wallBase[0]]; wallBase = null; }
    read.innerHTML = ''; redraw(); hint();
  };
  overlay.querySelector('#ar-close').onclick = e => { e.stopPropagation(); session.end(); };
  overlay.querySelectorAll('[data-m]').forEach(b => b.onclick = e => { e.stopPropagation(); cur = b.dataset.m; pts = []; if (cur !== 'wall') wallBase = null; read.innerHTML = ''; redraw(); hint(); });
  session.addEventListener('select', () => mark()); // tap anywhere on the screen = Mark

  const tmp = new THREE.Matrix4(), pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), fwd = new THREE.Vector3();
  renderer.domElement.style.display = '';
  hint();
  renderer.setAnimationLoop((t, frame) => {
    if (!frame) return;
    const ref = renderer.xr.getReferenceSpace();
    const vp = frame.getViewerPose(ref);
    if (!vp) return;
    tmp.fromArray(vp.transform.matrix); tmp.decompose(pos, q, sc);
    fwd.set(0, 0, -1).applyQuaternion(q);
    const C = [pos.x, pos.y, pos.z], d = [fwd.x, fwd.y, fwd.z];
    const hits = frame.getHitTestResults(hitSource);
    let hp = null;
    lastHit = null;
    if (hits.length) { const pose = hits[0].getPose(ref); if (pose) { reticle.matrix.fromArray(pose.transform.matrix); const p = pose.transform.position; hp = [p.x, p.y, p.z]; lastHit = hits[0]; } }
    // keep marked dots locked to the real spot while you walk
    let moved = false;
    for (const p of [...pts, ...(wallBase || [])]) {
      if (!p.anchor || !frame.trackedAnchors || !frame.trackedAnchors.has(p.anchor)) continue;
      const ap = frame.getPose(p.anchor.anchorSpace, ref); if (!ap) continue;
      const t = ap.transform.position;
      if (Math.abs(t.x - p[0]) + Math.abs(t.y - p[1]) + Math.abs(t.z - p[2]) > 0.002) { p[0] = t.x; p[1] = t.y; p[2] = t.z; moved = true; }
    }
    if (moved) redraw();
    while (anchorQueue.length) {
      const { p, hit } = anchorQueue.shift();
      const target = pts.concat(wallBase || []).find(x => x === p || (x[0] === p[0] && x[1] === p[1] && x[2] === p[2]));
      if (!target) continue;
      try {
        const make = hit && hit.createAnchor ? hit.createAnchor() : frame.createAnchor ? frame.createAnchor(new XRRigidTransform({ x: p[0], y: p[1], z: p[2] }), ref) : null;
        if (make) make.then(a => { target.anchor = a; }).catch(() => { });
      } catch (e) { /* anchors not supported – dots stay where marked */ }
    }
    const wasOk = hitOk; hitOk = !!hp;
    // where the next Mark will land
    live = null;
    if (cur === 'height' && pts.length === 1) live = G.vertical(pts[0], C, d);
    else if (cur === 'wall' && wallBase) live = G.wallHit(wallBase[0], wallBase[1], C, d);
    else live = hp;
    if (live) { lastGood = live.slice(); lastLiveAt = Date.now(); recent.push(lastGood); if (recent.length > 10) recent.shift(); }
    reticle.visible = !!hp && needsHit();
    aim.visible = !!live && !needsHit();
    if (aim.visible) aim.position.set(...live);
    // live reading
    const last = pts[pts.length - 1];
    if (last && live) {
      placeBar(liveLine, last, live); liveLine.visible = true;
      let v = cur === 'height' ? Math.abs(live[1] - last[1]) : (cur === 'room' || cur === 'pillar') ? G.flat(last, live) : G.dist(last, live);
      read.innerHTML = `${fmt(mm(v), 'mm')}<small>live · rough</small>`;
    } else liveLine.visible = false;
    if (wasOk !== hitOk) hint();
    renderer.render(scene, camera);
  });
  session.addEventListener('end', () => { renderer.setAnimationLoop(null); renderer.dispose(); renderer.domElement.remove(); overlay.remove(); if (results.length) toast(`${results.length} reading(s) saved`); done(); });
}
