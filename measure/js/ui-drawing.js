// Drawings: upload + reading, measuring on the drawing, compare, mismatch report.
import * as db from './db.js';
import * as cloud from './cloud.js';
import { parseSize, fmt, fmtDiff } from './units.js';
import { openPdf, renderPdfPage, readPdfPage, readImage, prepareForReading, blobToImage, LOW_CONF } from './drawing.js';
import { esc, toast, download, dateText, fileDate, safeName, needPdfMaker, needSheetJS } from './util.js';
import { sheet, confirmBox, mountTip, busy } from './ui.js';

export async function getBlob(fileId) {
  const rec = await db.get('files', fileId);
  if (!rec) throw new Error('File missing');
  if (rec.blob) return rec.blob;
  if (rec.driveId) { const b = await cloud.fetchFromDrive(rec.driveId); rec.blob = b; await db.put('files', rec, { silent: true }); return b; }
  throw new Error('File not on this phone yet – sign in to get it from Drive');
}

// Saves a file into the job (and so into the job's Drive folder when signed in)
// slot: files with the same slot are versions of one file – only the latest is kept (older one removed, also from Drive).
export async function saveJobFile(jobId, name, blob, kind, slot) {
  if (slot) {
    for (const old of (await db.byJob('files', jobId)).filter(f => f.slot === slot && !f.trash)) {
      if (old.driveId) { old.trash = true; delete old.blob; await db.put('files', old); }
      else await db.del('files', old.id);
    }
  }
  return db.put('files', { id: db.uid(), jobId, name, type: blob.type, blob, kind, slot: slot || null, createdAt: Date.now() });
}

const settings = async () => ({ tol: await db.getSetting('tolerance', 10), unit: await db.getSetting('unit', 'mm') });
export function status(p, tol) {
  if (p.siteMm == null || p.drawingMm == null) return 'n';
  return Math.abs(p.siteMm - p.drawingMm) <= tol ? 'g' : 'r';
}

// ---------- Drawings tab ----------
export async function renderDrawings(el, job) {
  const drawings = (await db.byJob('drawings', job.id)).sort((a, b) => a.createdAt - b.createdAt);
  const points = await db.byJob('points', job.id);
  el.innerHTML = `
    <div class="row">
      <label class="btn big">⬆ Upload drawing<input type="file" id="up" accept="application/pdf,image/*,.dwg,.dxf" hidden></label>
      <label class="btn big ghost">📷 Photo of drawing<input type="file" id="cam" accept="image/*" capture="environment" hidden></label>
    </div>
    <p class="muted small">PDF from AutoCAD reads best. DWG? Save it as PDF first. Photo tips: ⓘ → How to measure.</p>
    <div id="dl">${drawings.length ? '' : '<div class="empty">No drawing yet. You can still measure in Plan or Sheet.</div>'}</div>`;
  const list = el.querySelector('#dl');
  for (const d of drawings) {
    const n = points.filter(p => p.drawingId === d.id).length;
    const amber = (d.dims || []).filter(x => x.conf < LOW_CONF).length;
    const c = document.createElement('div'); c.className = 'card job';
    c.innerHTML = `<a href="#/drawing/${d.id}"><b>${esc(d.name)}</b><span class="chips"><i>${d.kind === 'pdf' ? d.pages + ' page(s)' : 'photo'}</i><i>${(d.dims || []).length} sizes read</i>${amber ? `<i class="a">${amber} to check</i>` : ''}<i>${n} points</i></span></a>
      <button class="link r small" data-del="${d.id}">Delete</button>`;
    list.appendChild(c);
  }
  list.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!(await confirmBox('Delete this drawing and its points?', 'Delete'))) return;
    const d = drawings.find(x => x.id === b.dataset.del);
    for (const p of points.filter(p => p.drawingId === d.id)) await db.del('points', p.id);
    await db.del('drawings', d.id); await db.del('files', d.fileId);
    renderDrawings(el, job);
  });
  const onFile = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (/\.(dwg|dxf)$/i.test(f.name)) {
      sheet(`<h2>DWG can't open on a phone</h2><p>Save the drawing as PDF and upload it.</p><p class="muted">On the laptop in AutoCAD: Plot → printer "DWG To PDF.pc3" → choose the area → OK. Then upload that PDF here.</p>`);
      return;
    }
    const d = await addDrawing(job, f);
    if (d) location.hash = `#/drawing/${d.id}`;
  };
  el.querySelector('#up').onchange = onFile;
  el.querySelector('#cam').onchange = onFile;
}

export async function addDrawing(job, file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImg = /^image\//.test(file.type);
  if (!isPdf && !isImg) { toast('Please upload a PDF or a photo'); return null; }
  const b = busy('Reading the drawing…');
  try {
    const name = file.name || `Drawing ${dateText()}`;
    const fileRec = await saveJobFile(job.id, name, file, 'drawing');
    const d = { id: db.uid(), jobId: job.id, name, fileId: fileRec.id, kind: isPdf ? 'pdf' : 'image', pages: 1, dims: [], createdAt: Date.now() };
    if (isPdf) {
      const pdf = await openPdf(file);
      d.pages = pdf.numPages;
      for (let p = 1; p <= pdf.numPages; p++) {
        b.set(`Reading page ${p} of ${pdf.numPages}…`, (p - 1) / pdf.numPages);
        const r = await readPdfPage(pdf, p);
        d.dims.push(...r.dims);
      }
      if (!d.dims.length) { // sizes drawn as lines – read the picture instead
        for (let p = 1; p <= pdf.numPages; p++) {
          b.set(`No size text in the PDF – reading the picture of page ${p}…`, 0);
          const c = document.createElement('canvas');
          await renderPdfPage(pdf, p, c, 2200);
          d.dims.push(...await readImage(prepareForReading(c, c.width, c.height), p, (s, pr) => b.set(`Reading page ${p}: ${Math.round(pr * 100)}%`, pr)));
        }
        d.readBy = 'picture';
      } else d.readBy = 'text';
    } else {
      const img = await blobToImage(file);
      b.set('Reading the numbers in the photo…', 0);
      d.dims = await readImage(prepareForReading(img, img.naturalWidth, img.naturalHeight), 1, (s, pr) => b.set(`Reading the numbers: ${Math.round(pr * 100)}%`, pr));
      d.readBy = 'picture'; d.ratio = img.naturalHeight / img.naturalWidth;
    }
    d.dims.forEach(x => { x.id = db.uid(); });
    await db.put('drawings', d);
    const amber = d.dims.filter(x => x.conf < LOW_CONF).length;
    toast(`${d.dims.length} sizes read${amber ? `, ${amber} to check (amber)` : ''}`, 4000);
    return d;
  } catch (e) { toast('Could not read: ' + e.message, 5000); return null; }
  finally { b.done(); }
}

// ---------- Drawing view ----------
export async function renderDrawingView(view, drawingId, { setTitle }) {
  const d = await db.get('drawings', drawingId);
  if (!d) { location.hash = '#/'; return; }
  const job = await db.get('jobs', d.jobId);
  setTitle(d.name, `#/job/${d.jobId}/drawings`);
  const st = await settings();
  let page = 1, showDims = true, onlyAmber = false;
  view.innerHTML = `
    <div class="row tools">
      <span id="pg" ${d.pages > 1 ? '' : 'hidden'}><button class="btn sm ghost" id="prev">◀</button> <b id="pgn">1</b>/${d.pages} <button class="btn sm ghost" id="next">▶</button></span>
      <label class="check sm"><input type="checkbox" id="sd" checked> Read sizes</label>
      <label class="check sm"><input type="checkbox" id="oa"> Only amber</label>
      <button class="btn sm ghost" id="fit">Fit</button>
    </div>
    <div class="drawing-stage" id="stage"><div class="zoom" id="zoom"><div class="paper" id="paper"></div><div class="ov" id="ov"></div></div></div>
    <p class="muted small">Tap a chip or any spot to measure. Pinch to zoom.</p>
    <div id="plist"></div>`;
  await mountTip(view, 'drawing');
  const stage = view.querySelector('#stage'), zoom = view.querySelector('#zoom'), paper = view.querySelector('#paper'), ov = view.querySelector('#ov');
  let pdf = null, z = 1, tx = 0, ty = 0;
  const blob = await getBlob(d.fileId);
  if (d.kind === 'pdf') pdf = await openPdf(blob);

  const apply = () => { zoom.style.transform = `translate(${tx}px,${ty}px) scale(${z})`; zoom.style.setProperty('--z', z); };
  const fit = () => { z = 1; tx = 0; ty = 0; apply(); };

  async function drawPage() {
    paper.innerHTML = '';
    const w = stage.clientWidth || 360;
    if (pdf) {
      const c = document.createElement('canvas');
      await renderPdfPage(pdf, page, c, Math.min(2400, w * 3));
      c.style.width = '100%'; paper.appendChild(c);
    } else {
      const img = document.createElement('img'); img.src = URL.createObjectURL(blob); img.style.width = '100%';
      await new Promise(r => { img.onload = r; img.onerror = r; }); paper.appendChild(img);
    }
    stage.style.height = Math.min(window.innerHeight * 0.62, paper.offsetHeight || 400) + 'px';
    fit(); await drawOverlay();
  }
  async function drawOverlay() {
    const pts = (await db.byJob('points', d.jobId)).filter(p => p.drawingId === d.id && (p.page || 1) === page);
    ov.innerHTML = '';
    if (showDims) for (const x of d.dims.filter(x => x.page === page && (!onlyAmber || x.conf < LOW_CONF) && !pts.some(p => Math.hypot(p.x - x.x, p.y - x.y) < 0.004))) {
      const b = document.createElement('button');
      b.className = 'chip ' + (x.conf < LOW_CONF ? 'a' : 'b');
      b.style.left = x.x * 100 + '%'; b.style.top = x.y * 100 + '%';
      b.textContent = x.text;
      b.onclick = e => { e.stopPropagation(); pointForm(job, d, { page, x: x.x, y: x.y, dim: x }, refresh); };
      ov.appendChild(b);
    }
    for (const p of pts) {
      const b = document.createElement('button');
      b.className = 'pin ' + status(p, st.tol);
      b.style.left = p.x * 100 + '%'; b.style.top = p.y * 100 + '%';
      b.textContent = p.no;
      b.onclick = e => { e.stopPropagation(); pointForm(job, d, { point: p }, refresh); };
      ov.appendChild(b);
    }
    renderPointList(view.querySelector('#plist'), job, d, pts, st, refresh);
  }
  const refresh = () => drawOverlay();

  // gestures: one finger pans, two fingers zoom, a tap places a point
  const ptrs = new Map(); let start = null, pinch = null;
  stage.addEventListener('pointerdown', e => {
    if (e.target.closest('.chip,.pin') && ptrs.size === 0) return; // let the chip/pin take the tap
    stage.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 1) start = { x: e.clientX, y: e.clientY, tx, ty, t: Date.now(), moved: false };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), z, tx, ty, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; if (start) start.moved = true; }
  });
  stage.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = stage.getBoundingClientRect();
    if (ptrs.size === 2 && pinch) {
      const [a, b] = [...ptrs.values()];
      const nz = Math.max(1, Math.min(8, pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist));
      const mx = pinch.mx - r.left, my = pinch.my - r.top;
      tx = mx - (mx - pinch.tx) * nz / pinch.z; ty = my - (my - pinch.ty) * nz / pinch.z; z = nz; apply();
    } else if (ptrs.size === 1 && start) {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > 8) start.moved = true;
      if (start.moved && z > 1) { tx = start.tx + dx; ty = start.ty + dy; apply(); }
    }
  });
  const end = e => {
    const wasTap = ptrs.size === 1 && start && !start.moved && Date.now() - start.t < 500;
    ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
    if (wasTap && (e.target === stage || paper.contains(e.target) || e.target === ov)) {
      const r = paper.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      if (x >= 0 && x <= 1 && y >= 0 && y <= 1) pointForm(job, d, { page, x, y }, refresh);
    }
    if (!ptrs.size) start = null;
  };
  stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', e => { ptrs.delete(e.pointerId); start = null; pinch = null; });
  stage.addEventListener('wheel', e => { e.preventDefault(); const r = stage.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; const nz = Math.max(1, Math.min(8, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); tx = mx - (mx - tx) * nz / z; ty = my - (my - ty) * nz / z; z = nz; apply(); }, { passive: false });

  view.querySelector('#sd').onchange = e => { showDims = e.target.checked; drawOverlay(); };
  view.querySelector('#oa').onchange = e => { onlyAmber = e.target.checked; drawOverlay(); };
  view.querySelector('#fit').onclick = fit;
  view.querySelector('#prev').onclick = () => { if (page > 1) { page--; view.querySelector('#pgn').textContent = page; drawPage(); } };
  view.querySelector('#next').onclick = () => { if (page < d.pages) { page++; view.querySelector('#pgn').textContent = page; drawPage(); } };
  await drawPage();
}

function renderPointList(el, job, d, pts, st, refresh) {
  pts = [...pts].sort((a, b) => a.no - b.no);
  el.innerHTML = pts.length ? pts.map(p => pointRow(p, st)).join('') : '';
  el.querySelectorAll('[data-p]').forEach(r => r.onclick = () => pointForm(job, d, { point: pts.find(p => p.id === r.dataset.p) }, refresh));
}
export function pointRow(p, st) {
  const s = status(p, st.tol);
  const diff = s === 'n' ? (p.siteMm == null ? 'site size not typed' : 'no drawing size') : fmtDiff(p.siteMm - p.drawingMm, st.unit);
  return `<div class="prow ${s}" data-p="${p.id}"><span class="pin ${s} static">${p.no}</span>
    <div><b>${esc(p.label || 'Point ' + p.no)}</b><small>Drawing ${esc(p.drawingText || fmt(p.drawingMm, st.unit))} · Site ${esc(p.siteText || fmt(p.siteMm, st.unit))}</small></div>
    <span class="diff">${s === 'r' ? '✘ ' : s === 'g' ? '✔ ' : ''}${diff}</span></div>`;
}

async function nextNo(jobId) { const pts = await db.byJob('points', jobId); return pts.reduce((m, p) => Math.max(m, p.no || 0), 0) + 1; }

// The form to type the site size for a point
export async function pointForm(job, d, { page, x, y, dim, point }, done) {
  const st = await settings();
  const p = point || { id: db.uid(), jobId: job.id, drawingId: d ? d.id : null, page, x, y, no: await nextNo(job.id), drawingMm: dim ? dim.mm : null, drawingText: dim ? dim.text : '', drawingConf: dim ? dim.conf : null };
  const amber = p.drawingConf != null && p.drawingConf < LOW_CONF && !p.drawingConfirmed;
  const s = sheet(`<h2>${point ? 'Point ' + p.no : 'New point ' + p.no}</h2>
    <label>Name of this point (wall / opening)<input id="p-l" value="${esc(p.label || '')}" placeholder="e.g. Wall A, Door D1, Column C2" data-nofocus></label>
    <label>Drawing size ${amber ? '<span class="a">– please check: read as "' + esc(p.drawingText) + '"</span>' : ''}<input id="p-d" class="${amber ? 'amber' : ''}" value="${esc(p.drawingText || '')}" placeholder="e.g. 2400 or 12'10&quot;"></label>
    <label>Site size (tape)<input id="p-s" value="${esc(p.siteText || '')}" placeholder="e.g. 2390 or 12'9&quot;" autocomplete="off"></label>
    <p class="muted small">🎤 Use the keyboard mic to speak the size. Bare numbers are taken as ${st.unit === 'ftin' ? 'feet' : 'mm'}.</p>
    <label>Note<input id="p-n" value="${esc(p.note || '')}" placeholder="optional"></label>
    <div id="p-res" class="res"></div>
    <div class="row end">${point ? '<button class="btn ghost r" id="p-del">Delete</button>' : ''}<button class="btn" id="p-ok">Save</button></div>`);
  setTimeout(() => s.el.querySelector(p.drawingText ? '#p-s' : '#p-d').focus(), 60);
  const q = id => s.el.querySelector(id);
  const bare = st.unit === 'ftin' ? 'ftin' : 'mm';
  const preview = () => {
    const a = parseSize(q('#p-d').value, bare), b = parseSize(q('#p-s').value, bare);
    if (!a || !b) { q('#p-res').innerHTML = ''; return; }
    const diff = b.mm - a.mm, ok = Math.abs(diff) <= st.tol;
    q('#p-res').innerHTML = `<span class="${ok ? 'g' : 'r'}">${ok ? '✔ Within tolerance' : '✘ Mismatch'} · ${fmtDiff(diff, st.unit)}</span>`;
  };
  q('#p-d').oninput = preview; q('#p-s').oninput = preview; preview();
  q('#p-ok').onclick = async () => {
    const dv = q('#p-d').value.trim(), sv = q('#p-s').value.trim();
    const a = dv ? parseSize(dv, bare) : null, b = sv ? parseSize(sv, bare) : null;
    if (dv && !a) return toast(`Can't read drawing size "${dv}"`);
    if (sv && !b) return toast(`Can't read site size "${sv}"`);
    p.label = q('#p-l').value.trim(); p.note = q('#p-n').value.trim();
    if (dv !== (p.drawingText || '')) p.drawingConfirmed = true;
    if (amber && dv) p.drawingConfirmed = true;
    p.drawingText = a ? (a.kind === 'ftin' ? a.text : dv) : ''; p.drawingMm = a ? a.mm : null;
    p.siteText = b ? (b.kind === 'ftin' ? b.text : sv) : ''; p.siteMm = b ? b.mm : null;
    await db.put('points', p); s.close(); done && done();
  };
  if (q('#p-del')) q('#p-del').onclick = async () => { await db.del('points', p.id); s.close(); done && done(); };
}

// ---------- Compare tab ----------
export async function renderCompare(el, job) {
  const st = await settings();
  const pts = (await db.byJob('points', job.id)).filter(p => !p.kind).sort((a, b) => a.no - b.no);
  const rough = (await db.byJob('points', job.id)).filter(p => p.kind === 'ar');
  const drawings = await db.byJob('drawings', job.id);
  const g = pts.filter(p => status(p, st.tol) === 'g').length, r = pts.filter(p => status(p, st.tol) === 'r').length;
  let only = false;
  el.innerHTML = `<div class="sum"><span class="g">✔ ${g} OK</span><span class="r">✘ ${r} mismatch</span><span class="n">${pts.length - g - r} not typed</span><span class="muted">Tolerance ±${st.tol} mm</span></div>
    <label class="check"><input type="checkbox" id="only"> Show only mismatches</label>
    <div id="cl"></div>
    ${rough.length ? `<h3>Rough readings (camera) – not used until you type the real size</h3>${rough.map(p => `<div class="prow n"><span class="pin n static">~</span><div><b>${esc(p.label || 'Rough reading')}</b><small>≈ ${fmt(p.roughMm, st.unit)} (rough ±1–2 cm)</small></div></div>`).join('')}` : ''}
    <div class="row"><button class="btn big" id="rep" ${pts.length ? '' : 'disabled'}>📄 Mismatch report</button></div>
    <div id="out"></div>`;
  await mountTip(el, 'compare');
  const draw = () => {
    const list = only ? pts.filter(p => status(p, st.tol) === 'r') : pts;
    el.querySelector('#cl').innerHTML = list.length ? list.map(p => {
      const dn = drawings.find(x => x.id === p.drawingId);
      return pointRow(p, st).replace('</small>', ` · ${esc(dn ? dn.name : 'no drawing')}</small>`);
    }).join('') : '<div class="empty">Nothing here yet. Measure on a drawing first.</div>';
    el.querySelectorAll('[data-p]').forEach(row => row.onclick = () => {
      const p = pts.find(x => x.id === row.dataset.p);
      pointForm(job, drawings.find(x => x.id === p.drawingId), { point: p }, () => renderCompare(el, job));
    });
  };
  el.querySelector('#only').onchange = e => { only = e.target.checked; draw(); };
  draw();
  el.querySelector('#rep').onclick = async () => {
    const b = busy('Making the report…');
    try {
      const { pdf, xlsx } = await mismatchReport(job, pts, drawings, st);
      const base = `${safeName(job.name)} – Mismatch report ${fileDate()}`;
      await saveJobFile(job.id, base + '.pdf', pdf, 'report', 'mm-pdf');
      await saveJobFile(job.id, base + '.xlsx', xlsx, 'report', 'mm-xl');
      el.querySelector('#out').innerHTML = `<div class="card"><b>Report ready</b><p class="small muted">${cloud.currentUser() ? 'Saved in the job\'s Drive folder.' : 'Kept on this phone; goes to the job\'s Drive folder when you sign in.'}</p>
        <div class="row"><button class="btn" id="dp">⬇ PDF</button><button class="btn ghost" id="dx">⬇ Excel</button></div></div>`;
      el.querySelector('#dp').onclick = () => download(pdf, base + '.pdf');
      el.querySelector('#dx').onclick = () => download(xlsx, base + '.xlsx');
    } catch (e) { toast('Report problem: ' + e.message, 5000); }
    finally { b.done(); }
  };
}

// Draw a drawing page with coloured numbered pins (for the report)
async function pageWithPins(d, page, pts, tol) {
  const blob = await getBlob(d.fileId);
  const c = document.createElement('canvas');
  if (d.kind === 'pdf') { const pdf = await openPdf(blob); await renderPdfPage(pdf, page, c, 1800); }
  else { const img = await blobToImage(blob); const sc = Math.min(1, 1800 / img.naturalWidth); c.width = img.naturalWidth * sc; c.height = img.naturalHeight * sc; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); }
  const ctx = c.getContext('2d'); const R = Math.max(14, c.width / 90);
  for (const p of pts) {
    const s = status(p, tol);
    ctx.beginPath(); ctx.arc(p.x * c.width, p.y * c.height, R, 0, Math.PI * 2);
    ctx.fillStyle = s === 'g' ? '#1a9e4a' : s === 'r' ? '#d92d20' : '#8a8f98'; ctx.fill();
    ctx.lineWidth = R / 5; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `bold ${R}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(p.no), p.x * c.width, p.y * c.height + 1);
  }
  return c;
}

const pdfText = t => String(t).replace(/−/g, '-').replace(/±/g, '+/-');
export async function mismatchReport(job, pts, drawings, st) {
  const jsPDF = await needPdfMaker();
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const bad = pts.filter(p => status(p, st.tol) === 'r'), ok = pts.filter(p => status(p, st.tol) === 'g'), open = pts.filter(p => status(p, st.tol) === 'n');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text('Drawing vs site – mismatch report', 40, 44);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text(`Job: ${job.name}${job.site ? ' · ' + job.site : ''}`, 40, 62);
  doc.text(`Date: ${dateText()}    Tolerance: +/-${st.tol} mm`, 40, 76);
  doc.text(`Mismatch: ${bad.length}    Within tolerance: ${ok.length}    Site size not typed: ${open.length}`, 40, 90);
  const row = p => { const dn = drawings.find(x => x.id === p.drawingId); return [p.no, p.label || '', dn ? dn.name + (dn.pages > 1 ? ' p' + (p.page || 1) : '') : '', p.drawingText || fmt(p.drawingMm, st.unit), p.siteText || fmt(p.siteMm, st.unit), status(p, st.tol) === 'n' ? '' : pdfText(fmtDiff(p.siteMm - p.drawingMm, st.unit))]; };
  doc.autoTable({ startY: 104, head: [['No', 'Where', 'Drawing', 'Drawing size', 'Site size', 'Difference']], body: bad.length ? bad.map(row) : [[{ content: 'No mismatches – all measured points are within tolerance.', colSpan: 6 }]],
    styles: { fontSize: 9 }, headStyles: { fillColor: [217, 45, 32] }, theme: 'grid' });
  // drawings with pins
  for (const d of drawings) {
    for (let pg = 1; pg <= (d.pages || 1); pg++) {
      const pp = pts.filter(p => p.drawingId === d.id && (p.page || 1) === pg);
      if (!pp.length) continue;
      const c = await pageWithPins(d, pg, pp, st.tol);
      const land = c.width > c.height;
      doc.addPage('a4', land ? 'landscape' : 'portrait');
      const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight();
      doc.setFontSize(10); doc.text(`${d.name}${d.pages > 1 ? ' – page ' + pg : ''}   (green = OK, red = mismatch, grey = not typed)`, 30, 24);
      const sc = Math.min((pw - 60) / c.width, (ph - 60) / c.height);
      doc.addImage(c.toDataURL('image/jpeg', 0.85), 'JPEG', 30, 36, c.width * sc, c.height * sc);
    }
  }
  doc.addPage('a4', 'portrait');
  doc.setFontSize(11); doc.text('All points', 40, 40);
  doc.autoTable({ startY: 50, head: [['No', 'Where', 'Drawing', 'Drawing size', 'Site size', 'Difference']], body: pts.map(row), styles: { fontSize: 8 }, theme: 'grid',
    didParseCell: x => { if (x.section === 'body') { const p = pts[x.row.index]; const s = status(p, st.tol); if (x.column.index === 5) x.cell.styles.textColor = s === 'r' ? [217, 45, 32] : [26, 158, 74]; } } });
  const pdf = doc.output('blob');
  void W; void H;
  // Excel
  const XLSX = await needSheetJS();
  const wb = XLSX.utils.book_new();
  const hdr = ['No', 'Where', 'Drawing', 'Drawing size', 'Drawing mm', 'Site size', 'Site mm', 'Difference mm', 'Result', 'Note'];
  const rows = list => list.map(p => { const r = row(p); const s = status(p, st.tol); return [r[0], r[1], r[2], r[3], p.drawingMm != null ? Math.round(p.drawingMm) : '', r[4], p.siteMm != null ? Math.round(p.siteMm) : '', s === 'n' ? '' : Math.round(p.siteMm - p.drawingMm), s === 'g' ? 'OK' : s === 'r' ? 'Mismatch' : 'Not typed', p.note || '']; });
  const ws1 = XLSX.utils.aoa_to_sheet([[`Mismatch report – ${job.name} – ${dateText()} – tolerance +/-${st.tol} mm`], [], hdr, ...rows(bad)]);
  const ws2 = XLSX.utils.aoa_to_sheet([hdr, ...rows(pts)]);
  ws1['!cols'] = ws2['!cols'] = [6, 22, 22, 12, 10, 12, 10, 12, 10, 24].map(w => ({ wch: w }));
  XLSX.utils.book_append_sheet(wb, ws1, 'Mismatches'); XLSX.utils.book_append_sheet(wb, ws2, 'All points');
  const xlsx = new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return { pdf, xlsx };
}
