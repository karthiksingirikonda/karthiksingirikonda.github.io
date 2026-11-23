// Photo + sketch floor plan: typed sizes → drawn plan → wall / floor / ceiling areas.
import * as db from './db.js';
import { parseSize, fmt } from './units.js';
import { esc, toast } from './util.js';
import { sheet as popup, mountTip, confirmBox } from './ui.js';
import { saveJobFile, getBlob } from './ui-drawing.js';
import { loadSheet } from './ui-sheet.js';

const SQFT = 92903.04; // mm² in one sqft
const letter = i => String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : '');

// canonical text for the measurement sheet
export function sizeText(raw, bare) {
  const p = parseSize(raw, bare); if (!p) return '';
  if (p.kind === 'ftin' || p.kind === 'in') return p.kind === 'ftin' ? p.text : `${Math.floor(p.mm / 25.4 / 12)}'${Math.round(p.mm / 25.4) % 12}"`;
  return p.kind === 'mm' ? `${Math.round(p.mm * 1000) / 1000} mm` : p.kind === 'cm' ? `${p.mm / 10} cm` : `${p.mm / 1000} m`;
}

export function roomGeometry(room, bare) {
  const mm = t => { const p = parseSize(t, bare); return p ? p.mm : NaN; };
  let walls;
  if (room.shape === 'rect') {
    const L = mm(room.length), W = mm(room.width);
    walls = [{ len: room.length, mm: L }, { len: room.width, mm: W }, { len: room.length, mm: L }, { len: room.width, mm: W }].map((w, i) => ({ ...w, turn: 'R', ...((room.walls || [])[i] || {}), len: w.len, mm: w.mm }));
  } else walls = (room.walls || []).map(w => ({ ...w, mm: mm(w.len) }));
  const pts = [[0, 0]]; let dir = 0; // 0 E,1 S,2 W,3 N (screen: y down)
  const D = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  for (const w of walls) {
    const [x, y] = pts[pts.length - 1];
    pts.push([x + D[dir][0] * (w.mm || 0), y + D[dir][1] * (w.mm || 0)]);
    dir = (dir + (w.turn === 'L' ? 3 : 1)) % 4;
  }
  const end = pts[pts.length - 1];
  const gap = Math.hypot(end[0], end[1]);
  let a = 0; for (let i = 0; i < pts.length - 1; i++) a += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  const area = Math.abs(a) / 2; // mm²
  const H = mm(room.height);
  const perim = walls.reduce((s, w) => s + (w.mm || 0), 0);
  const openings = (room.openings || []).map(o => ({ ...o, area: mm(o.w) * mm(o.h) * (Number(o.nos) || 1) }));
  const ded = openings.reduce((s, o) => s + (o.area || 0), 0);
  const ok = walls.length >= 3 && walls.every(w => w.mm > 0);
  return { walls, pts, gap, area, perim, H, gross: perim * H, ded, net: perim * H - ded, openings, ok };
}

export async function renderPlan(el, job) {
  const rooms = (await db.byJob('rooms', job.id)).sort((a, b) => a.createdAt - b.createdAt);
  const unit = await db.getSetting('unit', 'mm');
  const bare = unit === 'ftin' ? 'ftin' : 'mm';
  el.innerHTML = `<button class="btn big wide" id="add">＋ Room</button><div id="rl"></div>`;
  await mountTip(el, 'plan');
  const rl = el.querySelector('#rl');
  if (!rooms.length) rl.innerHTML = '<div class="empty">No rooms yet. Tap ＋ Room.</div>';
  for (const room of rooms) {
    const g = roomGeometry(room, bare);
    const c = document.createElement('div'); c.className = 'card';
    c.innerHTML = `<div class="row between"><b>${esc(room.name)}</b><span><button class="link" data-a="edit">✎ Edit</button> <button class="link r" data-a="del">🗑</button></span></div>
      ${g.ok ? planSvg(g, unit) : '<p class="muted">Type all wall sizes to see the plan.</p>'}
      ${g.ok && g.gap > 10 ? `<p class="r small">⚠ The walls don't close by ${Math.round(g.gap)} mm – check the sizes or the left/right turns.</p>` : ''}
      ${g.ok ? `<div class="areas">
        <div><span>Floor</span><b>${(g.area / SQFT).toFixed(2)} sqft</b><small>${(g.area / 1e6).toFixed(2)} m²</small></div>
        <div><span>Ceiling</span><b>${(g.area / SQFT).toFixed(2)} sqft</b><small>${(g.area / 1e6).toFixed(2)} m²</small></div>
        <div><span>Walls (net)</span><b>${isNaN(g.net) ? '—' : (g.net / SQFT).toFixed(2) + ' sqft'}</b><small>${isNaN(g.H) ? 'type the height' : `gross ${(g.gross / SQFT).toFixed(2)} − openings ${(g.ded / SQFT).toFixed(2)}`}</small></div>
        <div><span>Perimeter</span><b>${fmt(g.perim, unit)}</b><small>${(g.perim / 304.8).toFixed(2)} rft</small></div></div>` : ''}
      <div class="walls">${g.walls.map((w, i) => `<div class="wall"><b>Wall ${letter(i)}</b> <span>${esc(w.len || '—')}</span>
        ${w.photoId ? `<button class="link" data-ph="${w.photoId}">🖼 Photo</button>` : ''}<label class="link">📷 ${w.photoId ? 'Retake' : 'Photo'}<input type="file" accept="image/*" capture="environment" data-wall="${i}" hidden></label></div>`).join('')}</div>
      ${g.openings.length ? `<p class="small">Openings: ${g.openings.map(o => `${esc(o.type)} ${esc(o.w)}×${esc(o.h)}${Number(o.nos) > 1 ? ' ×' + o.nos : ''} (Wall ${letter(Number(o.wall) || 0)})`).join(', ')}</p>` : ''}
      <button class="btn ghost" data-a="send" ${g.ok ? '' : 'disabled'}>🧾 Send to measurement sheet</button>`;
    rl.appendChild(c);
    c.querySelector('[data-a="edit"]').onclick = () => roomForm(job, room, () => renderPlan(el, job));
    c.querySelector('[data-a="del"]').onclick = async () => { if (await confirmBox(`Delete room "${esc(room.name)}"?`, 'Delete')) { await db.del('rooms', room.id); renderPlan(el, job); } };
    c.querySelector('[data-a="send"]').onclick = () => sendToSheet(job, room, g, bare);
    c.querySelectorAll('[data-wall]').forEach(inp => inp.onchange = async e => {
      const f = e.target.files[0]; if (!f) return;
      const i = Number(inp.dataset.wall);
      const rec = await saveJobFile(job.id, `${room.name} – Wall ${letter(i)}.jpg`, f, 'photo', `photo-${room.id}-${i}`);
      room.walls = room.walls || [];
      while (room.walls.length <= i) room.walls.push({ len: '', turn: 'R' });
      room.walls[i].photoId = rec.id;
      await db.put('rooms', room); toast('Photo saved'); renderPlan(el, job);
    });
    c.querySelectorAll('[data-ph]').forEach(b => b.onclick = async () => {
      try { const blob = await getBlob(b.dataset.ph); popup(`<img class="photo" src="${URL.createObjectURL(blob)}" alt="">`); } catch (e) { toast(e.message); }
    });
  }
  el.querySelector('#add').onclick = () => roomForm(job, null, () => renderPlan(el, job));
}

function planSvg(g, unit) {
  const xs = g.pts.map(p => p[0]), ys = g.pts.map(p => p[1]);
  const minX = Math.min(...xs), minY = Math.min(...ys), w = Math.max(...xs) - minX || 1, h = Math.max(...ys) - minY || 1;
  const pad = Math.max(w, h) * 0.14;
  const vb = `${minX - pad} ${minY - pad} ${w + pad * 2} ${h + pad * 2}`;
  const fs = Math.max(w, h) * 0.05;
  const poly = g.pts.map(p => p.join(',')).join(' ');
  const labels = g.walls.map((wl, i) => {
    const [a, b] = [g.pts[i], g.pts[i + 1]];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const horiz = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]);
    return `<text x="${mx}" y="${my}" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" ${horiz ? '' : `transform="rotate(-90 ${mx} ${my})"`} class="wl"><tspan dy="${-fs * 0.6}">${letter(i)}</tspan><tspan x="${mx}" dy="${fs * 1.2}">${esc(wl.len)}</tspan></text>`;
  }).join('');
  return `<svg class="plan" viewBox="${vb}" preserveAspectRatio="xMidYMid meet"><polygon points="${poly}" class="room"/>${labels}</svg>`;
}

function roomForm(job, room, done) {
  const r = room || { id: db.uid(), jobId: job.id, name: '', shape: 'rect', length: '', width: '', height: '', walls: [], openings: [], createdAt: Date.now() };
  const s = popup(`<h2>${room ? 'Edit room' : 'New room'}</h2>
    <label>Room name<input id="r-n" value="${esc(r.name)}" placeholder="e.g. Shop floor, Trial room"></label>
    <div class="seg"><button data-sh="rect" class="${r.shape === 'rect' ? 'on' : ''}">Rectangle</button><button data-sh="walls" class="${r.shape === 'walls' ? 'on' : ''}">Wall by wall</button></div>
    <div id="r-rect"><div class="lgrid"><label>Length<input id="r-l" value="${esc(r.length)}"></label><label>Width<input id="r-w" value="${esc(r.width)}"></label></div></div>
    <div id="r-walls"><p class="muted small">Start in one corner. Measure each wall going round, and say where the next wall turns.</p><div id="wl"></div><button class="link" id="w-add">＋ Wall</button></div>
    <label>Height (floor to ceiling)<input id="r-h" value="${esc(r.height)}"></label>
    <h3>Doors / windows</h3><div id="ol"></div><button class="link" id="o-add">＋ Door / window</button>
    <button class="btn wide" id="r-ok">Save</button>`);
  const q = id => s.el.querySelector(id);
  const walls = r.shape === 'walls' ? [...(r.walls || [])] : [];
  if (r.shape === 'walls' && !walls.length) walls.push({ len: '', turn: 'R' }, { len: '', turn: 'R' }, { len: '', turn: 'R' }, { len: '', turn: 'R' });
  const ops = [...(r.openings || [])];
  let shape = r.shape;
  const showShape = () => { q('#r-rect').hidden = shape !== 'rect'; q('#r-walls').hidden = shape !== 'walls'; s.el.querySelectorAll('[data-sh]').forEach(b => b.classList.toggle('on', b.dataset.sh === shape)); };
  s.el.querySelectorAll('[data-sh]').forEach(b => b.onclick = () => { shape = b.dataset.sh; if (shape === 'walls' && !walls.length) walls.push({ len: '', turn: 'R' }, { len: '', turn: 'R' }, { len: '', turn: 'R' }, { len: '', turn: 'R' }); drawW(); showShape(); });
  const drawW = () => {
    q('#wl').innerHTML = walls.map((w, i) => `<div class="lgrid w3"><label>Wall ${letter(i)}<input data-wi="${i}" value="${esc(w.len)}"></label>
      <label>Then turn<select data-wt="${i}"><option value="R" ${w.turn !== 'L' ? 'selected' : ''}>Right</option><option value="L" ${w.turn === 'L' ? 'selected' : ''}>Left</option></select></label><button class="icon" data-wd="${i}">✕</button></div>`).join('');
    q('#wl').querySelectorAll('[data-wi]').forEach(i => i.oninput = () => { walls[i.dataset.wi].len = i.value; });
    q('#wl').querySelectorAll('[data-wt]').forEach(i => i.onchange = () => { walls[i.dataset.wt].turn = i.value; });
    q('#wl').querySelectorAll('[data-wd]').forEach(b => b.onclick = () => { walls.splice(Number(b.dataset.wd), 1); drawW(); });
  };
  const drawO = () => {
    q('#ol').innerHTML = ops.map((o, i) => `<div class="op"><select data-ot="${i}"><option ${o.type === 'Door' ? 'selected' : ''}>Door</option><option ${o.type === 'Window' ? 'selected' : ''}>Window</option><option ${o.type === 'Opening' ? 'selected' : ''}>Opening</option></select>
      <input data-ow="${i}" value="${esc(o.w)}" placeholder="Width"><input data-oh="${i}" value="${esc(o.h)}" placeholder="Height"><input data-on="${i}" value="${esc(o.nos || 1)}" inputmode="numeric" placeholder="Nos" class="nos">
      <label class="small">on Wall<input data-ol="${i}" value="${esc(letter(Number(o.wall) || 0))}" class="nos"></label><button class="icon" data-od="${i}">✕</button></div>`).join('');
    const bindO = (attr, key, map = v => v) => q('#ol').querySelectorAll(`[data-${attr}]`).forEach(i => { const ev = i.tagName === 'SELECT' ? 'onchange' : 'oninput'; i[ev] = () => { ops[i.dataset[attr]][key] = map(i.value); }; });
    bindO('ot', 'type'); bindO('ow', 'w'); bindO('oh', 'h'); bindO('on', 'nos');
    bindO('ol', 'wall', v => Math.max(0, v.trim().toUpperCase().charCodeAt(0) - 65) || 0);
    q('#ol').querySelectorAll('[data-od]').forEach(b => b.onclick = () => { ops.splice(Number(b.dataset.od), 1); drawO(); });
  };
  q('#w-add').onclick = () => { walls.push({ len: '', turn: 'R' }); drawW(); };
  q('#o-add').onclick = () => { ops.push({ type: 'Door', w: '', h: '', nos: 1, wall: 0 }); drawO(); };
  drawW(); drawO(); showShape();
  q('#r-ok').onclick = async () => {
    r.name = q('#r-n').value.trim() || 'Room'; r.shape = shape; r.height = q('#r-h').value.trim();
    if (shape === 'rect') { r.length = q('#r-l').value.trim(); r.width = q('#r-w').value.trim(); r.walls = (r.walls || []).slice(0, 4).map(w => ({ photoId: w.photoId })); }
    else r.walls = walls;
    r.openings = ops;
    await db.put('rooms', r); s.close(); done();
  };
}

async function sendToSheet(job, room, g, bare) {
  const s = await loadSheet(job);
  const H = sizeText(room.height, bare);
  const add = (heading, lines) => s.items.push({ id: db.uid(), no: String(s.items.length + 1), heading, lines: lines.map(l => ({ id: db.uid(), breadth: '', ...l })) });
  if (H) {
    const lines = g.walls.map((w, i) => ({ desc: `${room.name} – Wall ${letter(i)}`, unit: 'Sqft', nos: 1, length: sizeText(w.len, bare), width: H }));
    for (const o of g.openings) lines.push({ desc: `${o.type} on Wall ${letter(Number(o.wall) || 0)} minus (-)`, unit: 'Sqft', nos: -(Number(o.nos) || 1), length: sizeText(o.w, bare), width: sizeText(o.h, bare) });
    add(`${room.name} – Walls`, lines);
  }
  let note = '';
  if (room.shape === 'rect') {
    add(`${room.name} – Floor`, [{ desc: `${room.name} floor`, unit: 'Sqft', nos: 1, length: sizeText(room.length, bare), width: sizeText(room.width, bare) }]);
    add(`${room.name} – Ceiling`, [{ desc: `${room.name} ceiling`, unit: 'Sqft', nos: 1, length: sizeText(room.length, bare), width: sizeText(room.width, bare) }]);
  } else note = ` Floor/ceiling of this shape (${(g.area / SQFT).toFixed(2)} sqft) – add them as rectangles by hand.`;
  await db.put('sheets', s);
  toast(`Added to the measurement sheet.${H ? '' : ' (Walls skipped – no height.)'}${note}`, 5000);
}
