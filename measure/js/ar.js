// Tap-measure with the camera (Chrome WebXR + ARCore). Rough only (±1–2 cm).
import * as db from './db.js';
import { fmt, parseSize } from './units.js';
import { esc, toast } from './util.js';
import { mountTip, sheet as popup } from './ui.js';

export async function arSupported() {
  try { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch (e) { return false; }
}

export async function renderAR(el, job) {
  const unit = await db.getSetting('unit', 'mm');
  const ok = await arSupported();
  const rough = (await db.byJob('points', job.id)).filter(p => p.kind === 'ar').sort((a, b) => b.createdAt - a.createdAt);
  el.innerHTML = `<div class="card"><b>📱 Tap-measure</b><p class="small">Rough length between two points using the camera. <b class="a">Rough (±1–2 cm)</b> – never for billing without typing the real size.</p>
    ${ok ? '<button class="btn big wide" id="go">Start camera</button>' : '<p class="muted">This phone/browser can\'t do camera measuring. Open the app in Chrome on an ARCore phone (your S25 Ultra works in Chrome). Use the tape and type the size instead.</p>'}
    <details><summary class="small">How to hold the phone</summary><p class="small">Good light. Point at a floor or wall with some texture (plain white walls and shiny floors are hard). Move the phone slowly side to side until the white ring appears. Stay 1–3 m away. Hold steady and tap ● Mark at each end.</p></details></div>
    <h3>Rough readings</h3><div id="rl">${rough.length ? '' : '<div class="empty">None yet.</div>'}</div>`;
  await mountTip(el, 'ar');
  const rl = el.querySelector('#rl');
  for (const p of rough) {
    const d = document.createElement('div'); d.className = 'prow ' + (p.confirmedMm != null ? 'g' : 'n');
    d.innerHTML = `<span class="pin static ${p.confirmedMm != null ? 'g' : 'n'}">~</span><div><b>${esc(p.label || 'Rough reading')}</b><small>≈ ${fmt(p.roughMm, unit)} rough${p.confirmedMm != null ? ` · confirmed ${esc(p.confirmedText)}` : ' · not confirmed'}</small></div><span class="diff">${p.confirmedMm != null ? '✔' : 'Type real size'}</span>`;
    d.onclick = () => confirmForm(p, () => renderAR(el, job));
    rl.appendChild(d);
  }
  if (ok) el.querySelector('#go').onclick = () => startSession(job, () => renderAR(el, job));
}

function confirmForm(p, done) {
  const s = popup(`<h2>${esc(p.label || 'Rough reading')}</h2><p>Camera said about <b>${fmt(p.roughMm, 'mm')}</b> (rough ±1–2 cm).</p>
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

async function startSession(job, done) {
  const THREE = await import('../vendor/three.js');
  const overlay = document.createElement('div');
  overlay.className = 'ar-ov';
  overlay.innerHTML = `<div class="ar-top"><span id="ar-msg">Move the phone slowly until the ring appears…</span></div>
    <div class="ar-read" id="ar-read"></div>
    <div class="ar-bot"><button class="btn" id="ar-mark">● Mark</button><button class="btn ghost" id="ar-reset">Reset</button><button class="btn ghost" id="ar-save" disabled>Save</button><button class="btn ghost" id="ar-close">Close</button></div>`;
  document.body.appendChild(overlay);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xbbbbff, 1));
  const reticle = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.04, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  reticle.matrixAutoUpdate = false; reticle.visible = false; scene.add(reticle);
  const marks = []; let line = null, lengthMm = null;
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['hit-test'], optionalFeatures: ['dom-overlay'], domOverlay: { root: overlay } });
  } catch (e) { cleanup(); toast('Camera measuring could not start: ' + e.message, 5000); return; }
  renderer.xr.setReferenceSpaceType('local');
  await renderer.xr.setSession(session);
  const viewer = await session.requestReferenceSpace('viewer');
  const hitSource = await session.requestHitTestSource({ space: viewer });
  const msg = overlay.querySelector('#ar-msg'), read = overlay.querySelector('#ar-read');
  const mark = () => {
    if (!reticle.visible) { msg.textContent = 'No surface yet – move slowly over the floor/wall.'; return; }
    if (marks.length === 2) reset();
    const p = new THREE.Vector3().setFromMatrixPosition(reticle.matrix);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 16), new THREE.MeshBasicMaterial({ color: marks.length ? 0xd92d20 : 0x1a9e4a }));
    dot.position.copy(p); scene.add(dot); marks.push(dot);
    if (marks.length === 2) {
      const g = new THREE.BufferGeometry().setFromPoints([marks[0].position, marks[1].position]);
      line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffd400 })); scene.add(line);
      lengthMm = marks[0].position.distanceTo(marks[1].position) * 1000;
      read.innerHTML = `≈ ${fmt(lengthMm, 'mm')} <small>rough ±1–2 cm</small>`;
      msg.textContent = 'Save it, or Mark again for a new length.';
      overlay.querySelector('#ar-save').disabled = false;
    } else msg.textContent = 'Now go to the other end and tap ● Mark.';
  };
  const reset = () => { marks.forEach(m => scene.remove(m)); marks.length = 0; if (line) scene.remove(line); line = null; lengthMm = null; read.innerHTML = ''; overlay.querySelector('#ar-save').disabled = true; msg.textContent = 'Tap ● Mark at the first end.'; };
  overlay.querySelector('#ar-mark').onclick = e => { e.stopPropagation(); mark(); };
  overlay.querySelector('#ar-reset').onclick = e => { e.stopPropagation(); reset(); };
  overlay.querySelector('#ar-close').onclick = e => { e.stopPropagation(); session.end(); };
  overlay.querySelector('#ar-save').onclick = async e => {
    e.stopPropagation();
    if (lengthMm == null) return;
    const label = prompt('Name for this rough reading (e.g. Wall A length)', '') || '';
    await db.put('points', { id: db.uid(), jobId: job.id, kind: 'ar', rough: true, label, roughMm: lengthMm, confirmedMm: null, createdAt: Date.now() });
    msg.textContent = 'Saved as rough. Type the real size later to use it.'; reset();
  };
  renderer.setAnimationLoop((t, frame) => {
    if (!frame) return;
    const ref = renderer.xr.getReferenceSpace();
    const hits = frame.getHitTestResults(hitSource);
    if (hits.length) {
      const pose = hits[0].getPose(ref);
      reticle.visible = true; reticle.matrix.fromArray(pose.transform.matrix);
      if (!marks.length && msg.textContent.startsWith('Move')) msg.textContent = 'Ring found. Tap ● Mark at the first end.';
    } else reticle.visible = false;
    renderer.render(scene, camera);
  });
  session.addEventListener('end', () => { cleanup(); done(); });
  function cleanup() { renderer.setAnimationLoop(null); renderer.domElement.remove(); overlay.remove(); }
}
