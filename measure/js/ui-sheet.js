// Measurement sheet editor (Pune format) with the live 3-way check.
import * as db from './db.js';
import * as cloud from './cloud.js';
import { check, UNITS, normUnit, r2, sheetExcel, sheetPdf, checkPdf } from './sheet.js';
import { esc, toast, download, fileDate, safeName } from './util.js';
import { mountTip, busy, confirmBox, sheet as popup } from './ui.js';
import { saveJobFile } from './ui-drawing.js';

export async function loadSheet(job) {
  let s = await db.get('sheets', 'sheet-' + job.id);
  if (!s) s = { id: 'sheet-' + job.id, jobId: job.id, project: job.name, client: job.client || '', location: job.site || '', measuredBy: await db.getSetting('measuredBy', 'Karthik S'), date: Date.now(), items: [], corrections: [] };
  return s;
}
const newLine = () => ({ id: db.uid(), desc: '', unit: 'Sqft', nos: 1, length: '', breadth: '', width: '' });

export async function renderSheet(el, job) {
  const s = await loadSheet(job);
  let saveT;
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => db.put('sheets', s), 500); };

  el.innerHTML = `<details class="card"><summary><b>Sheet details</b> <span class="muted small">project, client, measured by</span></summary>
      <label>Project<input data-h="project" value="${esc(s.project)}"></label>
      <label>Client<input data-h="client" value="${esc(s.client)}"></label>
      <label>Location<input data-h="location" value="${esc(s.location)}"></label>
      <label>Measured by<input data-h="measuredBy" value="${esc(s.measuredBy)}"></label>
      <label>Corrections made (one per line, printed in the check list)<textarea id="corr" rows="3">${esc((s.corrections || []).join('\n'))}</textarea></label>
    </details>
    <div id="chk" class="sum"></div>
    <div id="items"></div>
    <button class="btn wide ghost" id="add-item">＋ Add item</button>
    <div class="card"><b>Export</b>
      <div class="row wrap"><button class="btn" id="x-xl">⬇ Excel</button><button class="btn" id="x-pdf">⬇ PDF</button>
      <button class="btn ghost" id="x-re">Recheck version</button><button class="btn ghost" id="x-ck">Check list PDF</button></div>
      <p class="muted small" id="x-note"></p></div>`;
  await mountTip(el, 'sheet');
  el.querySelectorAll('[data-h]').forEach(i => i.oninput = () => { s[i.dataset.h] = i.value; save(); });
  el.querySelector('#corr').oninput = e => { s.corrections = e.target.value.split('\n').map(x => x.trim()).filter(Boolean); save(); };

  const itemsEl = el.querySelector('#items');
  function drawAll() {
    itemsEl.innerHTML = s.items.map((it, ii) => itemHtml(it, ii)).join('') || '<div class="empty">No items yet. Tap ＋ Add item (e.g. "Wall painting", "Flooring").</div>';
    bind(); refreshCheck();
  }
  function itemHtml(it, ii) {
    return `<div class="item" data-i="${ii}">
      <div class="item-head"><input class="no" data-f="no" value="${esc(it.no || String(ii + 1))}" aria-label="Item no"><input class="hd" data-f="heading" value="${esc(it.heading || '')}" placeholder="Item heading">
        <button class="icon" data-act="up" title="Move up">▲</button><button class="icon" data-act="delitem" title="Delete item">🗑</button></div>
      ${it.lines.map((ln, li) => lineHtml(ln, ii, li)).join('')}
      <div class="item-foot"><button class="link" data-act="addline">＋ Line</button><button class="link" data-act="addminus">− Minus line</button>
        <span class="tot" data-tot="${ii}"></span></div>
      <label class="small">Measurer's own written total (if any)<input data-f="writtenTotal" inputmode="decimal" value="${esc(it.writtenTotal ?? '')}"></label>
    </div>`;
  }
  function lineHtml(ln, ii, li) {
    return `<div class="line" data-l="${li}">
      <div class="lrow"><span class="lno">${esc(s.items[ii].no || ii + 1)}.${li + 1}</span><input data-lf="desc" value="${esc(ln.desc)}" placeholder="Description">
        <select data-lf="unit">${UNITS.map(u => `<option ${normUnit(ln.unit) === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
      <div class="lgrid"><label>Nos<input data-lf="nos" inputmode="numeric" value="${esc(ln.nos)}"></label><label>Length<input data-lf="length" value="${esc(ln.length)}"></label>
        <label>Breath<input data-lf="breadth" value="${esc(ln.breadth || '')}"></label><label>Width<input data-lf="width" value="${esc(ln.width)}"></label></div>
      <div class="lres" data-res="${ii}-${li}"></div>
      <details class="more"><summary>Notes for recheck</summary>
        <label>Site note<input data-lf="siteNote" value="${esc(ln.siteNote || '')}"></label>
        <label>My remarks (shows in red)<input data-lf="myRemark" value="${esc(ln.myRemark || '')}"></label>
        <label>Measurer's remarks<input data-lf="measurerRemark" value="${esc(ln.measurerRemark || '')}"></label>
        <button class="link r" data-act="delline">Delete this line</button></details>
    </div>`;
  }
  function bind() {
    itemsEl.querySelectorAll('.item').forEach(iEl => {
      const ii = Number(iEl.dataset.i), it = s.items[ii];
      iEl.querySelectorAll('[data-f]').forEach(inp => inp.oninput = () => { it[inp.dataset.f] = inp.value; save(); refreshCheck(); });
      iEl.querySelectorAll('.line').forEach(lEl => {
        const li = Number(lEl.dataset.l), ln = it.lines[li];
        lEl.querySelectorAll('[data-lf]').forEach(inp => {
          const ev = inp.tagName === 'SELECT' ? 'onchange' : 'oninput';
          inp[ev] = () => { ln[inp.dataset.lf] = inp.dataset.lf === 'nos' ? inp.value.trim() : inp.value; save(); refreshCheck(); };
        });
        lEl.querySelector('[data-act="delline"]').onclick = () => { it.lines.splice(li, 1); save(); drawAll(); };
      });
      iEl.querySelector('[data-act="addline"]').onclick = () => { it.lines.push(newLine()); save(); drawAll(); };
      iEl.querySelector('[data-act="addminus"]').onclick = () => { const l = newLine(); l.nos = -1; l.desc = ' minus (-)'; it.lines.push(l); save(); drawAll(); };
      iEl.querySelector('[data-act="up"]').onclick = () => { if (ii > 0) { [s.items[ii - 1], s.items[ii]] = [s.items[ii], s.items[ii - 1]]; save(); drawAll(); } };
      iEl.querySelector('[data-act="delitem"]').onclick = async () => { if (await confirmBox(`Delete item "${esc(it.heading || ii + 1)}"?`, 'Delete')) { s.items.splice(ii, 1); save(); drawAll(); } };
    });
  }
  function refreshCheck() {
    const c = check(s);
    c.lines.forEach(l => {
      const r = itemsEl.querySelector(`[data-res="${l.itemIdx}-${l.lineIdx}"]`); if (!r) return;
      r.className = 'lres ' + (l.ok ? 'g' : 'r');
      r.innerHTML = l.ok ? `Qty <b>${r2(l.A)}</b> ✔ <span class="muted">A ${l.A.toFixed(3)} · B ${l.B.toFixed(3)} · C ${l.C.toFixed(3)}</span>` : `✘ ${esc(l.err)}`;
    });
    c.items.forEach((ci, ii) => {
      const t = itemsEl.querySelector(`[data-tot="${ii}"]`); if (!t) return;
      t.className = 'tot ' + (ci.ok ? 'g' : 'r');
      t.innerHTML = `Total ${r2(ci.A)} ${ci.ok ? '✔' : '✘'}${ci.written != null && Math.abs(ci.writtenDiff) > 0.005 ? ` <span class="r">(written ${ci.written}, diff ${r2(ci.writtenDiff)})</span>` : ''}`;
    });
    const bad = c.lines.filter(l => !l.ok).length;
    el.querySelector('#chk').innerHTML = s.items.length ? (c.allOk ? `<span class="g">✔ 3-way check clear – ${c.lines.length} lines</span>` : `<span class="r">✘ ${bad} line(s) to fix before the final sheet</span>`) : '';
    el.querySelector('#x-xl').disabled = el.querySelector('#x-pdf').disabled = !c.allOk || !s.items.length;
    el.querySelector('#x-note').textContent = c.allOk ? 'Files are saved in the job\'s Drive folder and ready to download. Nothing is sent to anyone.' : 'Excel and PDF unlock when every line shows ✔. Recheck version and check list are always available.';
  }
  el.querySelector('#add-item').onclick = () => {
    const p = popup(`<h2>New item</h2><label>Heading<input id="ni" placeholder="e.g. Wall painting"></label><button class="btn wide" id="ni-ok">Add</button>`);
    p.el.querySelector('#ni-ok').onclick = () => {
      const h = p.el.querySelector('#ni').value.trim(); if (!h) return toast('Type the heading');
      s.items.push({ id: db.uid(), no: String(s.items.length + 1), heading: h, lines: [{ ...newLine(), desc: h }] });
      save(); p.close(); drawAll();
    };
  };
  const exp = async (kind) => {
    await db.put('sheets', s);
    const b = busy('Making the file…');
    try {
      const base = `${safeName(job.name)} – Measurement sheet`;
      let blob, name;
      if (kind === 'xl') { blob = await sheetExcel(s); name = `${base} ${fileDate()}.xlsx`; }
      if (kind === 'pdf') { blob = await sheetPdf(s); name = `${base} ${fileDate()}.pdf`; }
      if (kind === 're') { blob = await sheetExcel(s, { recheck: true }); name = `${base} – recheck ${fileDate()}.xlsx`; }
      if (kind === 'ck') { blob = await checkPdf(s); name = `${base} – check list ${fileDate()}.pdf`; }
      await saveJobFile(job.id, name, blob, 'sheet', 'sheet-' + kind);
      download(blob, name);
      toast(cloud.currentUser() ? 'Saved to Drive and downloaded' : 'Downloaded (goes to Drive when you sign in)');
    } catch (e) { toast('Problem: ' + e.message, 5000); }
    finally { b.done(); }
  };
  el.querySelector('#x-xl').onclick = () => exp('xl');
  el.querySelector('#x-pdf').onclick = () => exp('pdf');
  el.querySelector('#x-re').onclick = () => exp('re');
  el.querySelector('#x-ck').onclick = () => exp('ck');
  drawAll();
}
