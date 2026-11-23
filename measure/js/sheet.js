// Measurement sheet – Pune format, Excel formulas, mandatory 3-way check.
import { parseSize, ftinText } from './units.js';
import { needExcelJS, needPdfMaker, dateText } from './util.js';

export const HEADER = {
  company: 'DESIGN INTERIO',
  address: 'HD-140, WeWork Galaxy, 43 Residency Road, Ashok Nagar, MG Road, Bengaluru, Karnataka - 560025',
};
export const UNITS = ['Sqft', 'Rft', 'Nos', 'Set'];
const BLUE = 'FFB3C6E7', GREY = 'FFDADADA';
const QTY_FMT = '_ * #,##0.00_ ;_ * \\-#,##0.00_ ;_ * "-"??_ ;_ @_ ';

// Turn a typed size into what the sheet stores. Returns { ok, cellValue, kind, inches, ft, msg }
export function sheetSize(raw) {
  if (raw == null || String(raw).trim() === '') return { ok: true, empty: true };
  const p = parseSize(raw, 'ftin');
  if (!p) return { ok: false, msg: `Can't read "${raw}". Type like 12'10" or 2400 mm.` };
  if (p.kind === 'ftin' || p.kind === 'in') {
    const totalIn = p.kind === 'in' ? p.ft * 12 + p.inch : p.ft * 12 + p.inch;
    if (!Number.isInteger(p.ft) || !Number.isInteger(p.inch)) return { ok: false, msg: `"${raw}": use whole inches (0–11) in feet-inch sizes, or type it in mm.` };
    return { ok: true, kind: 'ftin', ft: p.ft, inch: p.inch, inches: totalIn, cellValue: ftinText(p.ft, p.inch) };
  }
  const n = p.kind === 'm' ? p.mm / 1000 : p.kind === 'cm' ? p.mm / 10 : p.mm;
  return { ok: true, kind: p.kind, value: n, inches: p.mm / 25.4, cellValue: n };
}

// Excel expression giving feet for one size cell (Pune formula).
export function feetExpr(ref, s) {
  if (s.kind === 'ftin') {
    const left = `(LEFT(${ref},FIND("'",${ref})-1))`;
    if (s.inch === 10) return `(${left}+(10/12))`;
    if (s.inch === 11) return `(${left}+(11/12))`;
    return `(${left}+(MID(${ref},FIND("'",${ref},1)+1,1)/12))`;
  }
  if (s.kind === 'mm') return `(${ref}/304.8)`;
  if (s.kind === 'cm') return `(${ref}/30.48)`;
  if (s.kind === 'm') return `(${ref}/0.3048)`;
  throw new Error('size kind');
}

// Build the Qty formula for one line (row r). Columns: E Nos, F Length, G Breath, H Width.
export function lineFormula(line, r) {
  const L = sheetSize(line.length), W = sheetSize(line.width);
  const unit = normUnit(line.unit);
  if (unit === 'Sqft') {
    if (L.empty || W.empty) return null;
    return `E${r}*${feetExpr('F' + r, L)}*${feetExpr('H' + r, W)}`;
  }
  if (unit === 'Rft') { if (L.empty) return null; return `E${r}*${feetExpr('F' + r, L)}`; }
  return `E${r}`;
}
export const normUnit = u => { const x = String(u || '').trim().toLowerCase(); return x === 'sqft' ? 'Sqft' : x === 'rft' ? 'Rft' : x === 'set' ? 'Set' : 'Nos'; };

// ---------- Tiny formula evaluator (method B: the real formula text, worked out) ----------
export function evalFormula(f, cells) {
  const toks = []; let i = 0;
  while (i < f.length) {
    const c = f[i];
    if (c === ' ') { i++; continue; }
    if (c === '"') { let j = i + 1, s = ''; while (j < f.length) { if (f[j] === '"') { if (f[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += f[j++]; } toks.push({ t: 'str', v: s }); i = j + 1; continue; }
    const num = f.slice(i).match(/^\d+(\.\d+)?/); if (num) { toks.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = f.slice(i).match(/^[A-Z]+\d*/); if (id) { toks.push({ t: 'id', v: id[0] }); i += id[0].length; continue; }
    toks.push({ t: 'op', v: c }); i++;
  }
  let p = 0;
  const peek = () => toks[p], next = () => toks[p++];
  const num = v => { if (typeof v === 'number') return v; const n = Number(String(v).trim()); if (String(v).trim() === '' || isNaN(n)) throw new Error('#VALUE!'); return n; };
  function expr() { let v = term(); while (peek() && (peek().v === '+' || peek().v === '-') && peek().t === 'op') { const o = next().v; const r = term(); v = o === '+' ? num(v) + num(r) : num(v) - num(r); } return v; }
  function term() { let v = unary(); while (peek() && peek().t === 'op' && (peek().v === '*' || peek().v === '/')) { const o = next().v; const r = unary(); v = o === '*' ? num(v) * num(r) : num(v) / num(r); } return v; }
  function unary() { if (peek() && peek().t === 'op' && peek().v === '-') { next(); return -num(unary()); } return atom(); }
  function args() { const a = []; next(); if (peek().v !== ')') { a.push(expr()); while (peek().v === ',') { next(); a.push(expr()); } } next(); return a; }
  function atom() {
    const t = next();
    if (!t) throw new Error('end');
    if (t.t === 'num' || t.t === 'str') return t.v;
    if (t.t === 'op' && t.v === '(') { const v = expr(); next(); return v; }
    if (t.t === 'id') {
      if (peek() && peek().v === '(') {
        const a = args();
        if (t.v === 'LEFT') return String(a[0]).slice(0, num(a[1]));
        if (t.v === 'MID') { const s = String(a[0]); return s.substr(num(a[1]) - 1, num(a[2])); }
        if (t.v === 'FIND') { const k = String(a[1]).indexOf(String(a[0]), (a[2] ? num(a[2]) : 1) - 1); if (k < 0) throw new Error('#VALUE!'); return k + 1; }
        if (t.v === 'SUM') return a.reduce((s, x) => s + num(x), 0);
        throw new Error('fn ' + t.v);
      }
      return cells[t.v] ?? '';
    }
    throw new Error('bad token ' + t.v);
  }
  const v = expr();
  return num(v);
}

// ---------- 3-way check ----------
// Returns { lines: [{itemIdx, lineIdx, A, B, C, ok, err}], items: [{A,B,C,ok}], allOk }
export function check(sheet) {
  const res = { lines: [], items: [], allOk: true };
  sheet.items.forEach((it, ii) => {
    const tot = { A: 0, B: 0, C: 0 };
    it.lines.forEach((ln, li) => {
      const row = { itemIdx: ii, lineIdx: li, A: null, B: null, C: null, ok: false, err: '' };
      try {
        const unit = normUnit(ln.unit);
        const nos = Number(ln.nos);
        if (ln.nos === '' || ln.nos == null || isNaN(nos)) throw new Error('Nos missing');
        const L = sheetSize(ln.length), W = sheetSize(ln.width);
        if (!L.ok) throw new Error(L.msg); if (!W.ok) throw new Error(W.msg);
        if (unit === 'Sqft' && (L.empty || W.empty)) throw new Error('Sqft needs Length and Width');
        if (unit === 'Rft' && L.empty) throw new Error('Rft needs Length');
        // A: exact inch maths
        if (unit === 'Sqft') row.A = nos * L.inches * W.inches / 144;
        else if (unit === 'Rft') row.A = nos * L.inches / 12;
        else row.A = nos;
        // C: decimal feet
        const ftOf = s => s.kind === 'ftin' ? s.ft + s.inch / 12 : s.kind === 'mm' ? s.value / 304.8 : s.kind === 'cm' ? s.value / 30.48 : s.value / 0.3048;
        if (unit === 'Sqft') row.C = nos * ftOf(L) * ftOf(W);
        else if (unit === 'Rft') row.C = nos * ftOf(L);
        else row.C = nos;
        // B: the Excel formula itself
        const r = 10; const f = lineFormula(ln, r);
        row.B = evalFormula(f, { ['E' + r]: nos, ['F' + r]: L.empty ? '' : L.cellValue, ['H' + r]: W.empty ? '' : W.cellValue });
        row.formula = f;
        row.ok = close(row.A, row.B) && close(row.A, row.C);
        if (!row.ok) row.err = 'Methods do not match';
      } catch (e) { row.err = e.message; row.ok = false; }
      if (row.ok) { tot.A += row.A; tot.B += row.B; tot.C += row.C; }
      if (!row.ok) res.allOk = false;
      res.lines.push(row);
    });
    const itOk = it.lines.length > 0 && close(tot.A, tot.B) && close(tot.A, tot.C) && res.lines.filter(l => l.itemIdx === ii).every(l => l.ok);
    const written = it.writtenTotal !== '' && it.writtenTotal != null && !isNaN(Number(it.writtenTotal)) ? Number(it.writtenTotal) : null;
    res.items.push({ ...tot, ok: itOk, written, writtenDiff: written != null ? written - tot.A : null });
    if (!itOk) res.allOk = false;
  });
  return res;
}
const close = (a, b) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(a));
export const r2 = v => v == null ? '' : (Math.round(v * 100) / 100).toFixed(2);

// ---------- Excel (Pune format) ----------
export async function sheetExcel(sheet, { recheck = false } = {}) {
  const ExcelJS = await needExcelJS();
  const chk = check(sheet);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Measurements', { views: [{ showGridLines: false }] });
  const lastCol = recheck ? 'L' : 'I';
  const widths = { A: 3.6, B: 8.5, C: 36.4, D: 8.9, E: 8.3, F: 8.2, G: 7.2, H: 8.5, I: 11.2, J: 22, K: 26, L: 22 };
  for (const [k, w] of Object.entries(widths)) if (k <= lastCol) ws.getColumn(k).width = w;
  const font = (b = false, extra = {}) => ({ name: 'Gill Sans MT', size: 9, bold: b, ...extra });
  const thin = { style: 'thin', color: { argb: 'FF000000' } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const cols = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', ...(recheck ? ['J', 'K', 'L'] : [])];
  let r = 1;
  const headLine = (text, bold = false, size = 9) => {
    ws.mergeCells(`B${r}:${lastCol}${r}`);
    const c = ws.getCell(`B${r}`); c.value = text; c.font = font(bold, { size }); c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    r++;
  };
  headLine(HEADER.company, true, 14);
  headLine(HEADER.address);
  headLine(`Project: ${sheet.project || ''}    Client: ${sheet.client || ''}`, true);
  headLine(`Location: ${sheet.location || ''}`);
  headLine(`Measured by: ${sheet.measuredBy || ''}    Date: ${dateText(sheet.date || Date.now())}`);
  if (recheck) headLine('RECHECK VERSION – please check the sizes and write your remarks', true);
  r++;
  const hdr = ['S.No', 'Description ', 'Unit ', 'Nos ', 'Length ', 'Breath', 'Width', 'Qty', ...(recheck ? ['Site note', 'My remarks', "Measurer's remarks"] : [])];
  cols.forEach((c, i) => {
    const cell = ws.getCell(`${c}${r}`); cell.value = hdr[i]; cell.font = font(true);
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = { top: { style: 'medium' }, left: { style: 'medium' }, bottom: { style: 'medium' }, right: { style: 'medium' } };
  });
  r++;
  sheet.items.forEach((it, ii) => {
    const ci = chk.items[ii];
    // head row
    const hr = r;
    ws.getCell(`C${hr}`).value = it.heading || '';
    cols.forEach(c => { const cell = ws.getCell(`${c}${hr}`); cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } }; cell.font = font(true); cell.border = box; });
    ws.getCell(`C${hr}`).alignment = { horizontal: 'center' };
    r++;
    const first = r;
    it.lines.forEach((ln, li) => {
      const lc = chk.lines.find(x => x.itemIdx === ii && x.lineIdx === li);
      const L = sheetSize(ln.length), W = sheetSize(ln.width), G = sheetSize(ln.breadth);
      ws.getCell(`B${r}`).value = li === 0 ? (it.no || String(ii + 1)) : '';
      ws.getCell(`C${r}`).value = ln.desc || '';
      ws.getCell(`D${r}`).value = normUnit(ln.unit);
      ws.getCell(`E${r}`).value = Number(ln.nos);
      const setSize = (col, s, raw) => {
        if (s.empty) return;
        const cell = ws.getCell(`${col}${r}`);
        if (!s.ok) { cell.value = String(raw); return; }
        cell.value = s.cellValue;
        if (s.kind !== 'ftin') cell.numFmt = `0.###" ${s.kind}"`;
      };
      setSize('F', L, ln.length); setSize('G', G, ln.breadth); setSize('H', W, ln.width);
      const formula = lc && lc.formula ? lineFormula(ln, r) : null;
      if (formula) ws.getCell(`I${r}`).value = { formula, result: lc.A };
      else ws.getCell(`I${r}`).value = '';
      ws.getCell(`I${r}`).numFmt = QTY_FMT;
      if (recheck) {
        ws.getCell(`J${r}`).value = ln.siteNote || '';
        const remark = [ln.myRemark, lc && !lc.ok ? lc.err : ''].filter(Boolean).join(' · ');
        ws.getCell(`K${r}`).value = remark; ws.getCell(`K${r}`).font = font(false, { color: { argb: 'FFFF0000' } });
        ws.getCell(`L${r}`).value = ln.measurerRemark || '';
      }
      cols.forEach(c => { const cell = ws.getCell(`${c}${r}`); if (!(recheck && c === 'K')) cell.font = font(); cell.border = box; });
      ws.getCell(`C${r}`).alignment = { horizontal: 'right', wrapText: true };
      ['B', 'D', 'E', 'F', 'G', 'H', 'I'].forEach(c => ws.getCell(`${c}${r}`).alignment = { horizontal: 'center' });
      r++;
    });
    const last = r - 1;
    ws.getCell(`C${r}`).value = `Total of ${it.heading || ''}`;
    ws.getCell(`I${r}`).value = it.lines.length ? { formula: `SUM(I${first}:I${last})`, result: ci.A } : 0;
    ws.getCell(`I${r}`).numFmt = QTY_FMT;
    cols.forEach(c => { const cell = ws.getCell(`${c}${r}`); cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } }; cell.font = font(true); cell.border = box; });
    ws.getCell(`C${r}`).alignment = { horizontal: 'right' };
    if (recheck && ci.written != null && Math.abs(ci.writtenDiff) > 0.005) {
      ws.getCell(`K${r}`).value = `Measurer's written total ${ci.written} vs correct ${r2(ci.A)}`;
      ws.getCell(`K${r}`).font = font(true, { color: { argb: 'FFFF0000' } });
    }
    r++;
  });
  r += 2;
  ws.getCell(`C${r}`).value = `For ${sheet.client || 'Client'}`; ws.getCell(`C${r}`).font = font(true);
  ws.mergeCells(`F${r}:I${r}`); ws.getCell(`F${r}`).value = 'For Design Interio'; ws.getCell(`F${r}`).font = font(true); ws.getCell(`F${r}`).alignment = { horizontal: 'center' };
  r += 3;
  ws.mergeCells(`F${r}:I${r}`); ws.getCell(`F${r}`).value = 'Authorised Signatory'; ws.getCell(`F${r}`).font = font(true); ws.getCell(`F${r}`).alignment = { horizontal: 'center' };
  ws.pageSetup = { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } };
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ---------- PDF of the sheet (same layout; sub-lines numbered 3.1, 3.2 …) ----------
export async function sheetPdf(sheet) {
  const jsPDF = await needPdfMaker();
  const chk = check(sheet);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.text(HEADER.company, W / 2, 40, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text(HEADER.address, W / 2, 54, { align: 'center' });
  doc.setFontSize(9);
  doc.text(`Project: ${sheet.project || ''}    Client: ${sheet.client || ''}`, W / 2, 70, { align: 'center' });
  doc.text(`Location: ${sheet.location || ''}`, W / 2, 82, { align: 'center' });
  doc.text(`Measured by: ${sheet.measuredBy || ''}    Date: ${dateText(sheet.date || Date.now())}`, W / 2, 94, { align: 'center' });
  const body = [];
  sheet.items.forEach((it, ii) => {
    const no = it.no || String(ii + 1);
    body.push([{ content: `${no}  ${it.heading || ''}`, colSpan: 8, styles: { fillColor: [179, 198, 231], fontStyle: 'bold', halign: 'center' } }]);
    it.lines.forEach((ln, li) => {
      const lc = chk.lines.find(x => x.itemIdx === ii && x.lineIdx === li);
      const sz = v => { const s = sheetSize(v); return s.empty ? '' : s.ok ? (s.kind === 'ftin' ? s.cellValue : `${s.cellValue} ${s.kind}`) : String(v); };
      body.push([`${no}.${li + 1}`, ln.desc || '', normUnit(ln.unit), String(ln.nos), sz(ln.length), sz(ln.breadth), sz(ln.width), lc && lc.ok ? r2(lc.A) : 'X']);
    });
    body.push([{ content: `Total of ${it.heading || ''}`, colSpan: 7, styles: { halign: 'right', fontStyle: 'bold', fillColor: [218, 218, 218] } }, { content: r2(chk.items[ii].A), styles: { fontStyle: 'bold', fillColor: [218, 218, 218], halign: 'right' } }]);
  });
  doc.autoTable({
    startY: 106, head: [['S.No', 'Description', 'Unit', 'Nos', 'Length', 'Breath', 'Width', 'Qty']], body,
    styles: { fontSize: 8, lineColor: 0, lineWidth: 0.4, textColor: 0 }, headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: 'bold', halign: 'center' },
    columnStyles: { 0: { cellWidth: 38 }, 1: { cellWidth: 170, halign: 'right' }, 7: { halign: 'right' } }, theme: 'grid',
  });
  let y = doc.lastAutoTable.finalY + 40;
  if (y > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); y = 60; }
  doc.setFont('helvetica', 'bold');
  doc.text(`For ${sheet.client || 'Client'}`, 50, y); doc.text('For Design Interio', W - 160, y);
  doc.text('Authorised Signatory', W - 160, y + 40);
  return doc.output('blob');
}

// ---------- Check list PDF (A | B | C | ✔/✘) ----------
export async function checkPdf(sheet) {
  const jsPDF = await needPdfMaker();
  const chk = check(sheet);
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
  doc.text(`Check list – ${sheet.project || ''}`, 40, 40);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text('A = exact inch maths   B = sheet formula worked out   C = decimal feet   (all three must match)', 40, 54);
  const body = [];
  sheet.items.forEach((it, ii) => {
    const no = it.no || String(ii + 1);
    it.lines.forEach((ln, li) => {
      const lc = chk.lines.find(x => x.itemIdx === ii && x.lineIdx === li);
      body.push([`${no}.${li + 1}`, ln.desc || it.heading || '', lc.A == null ? '' : lc.A.toFixed(4), lc.B == null ? '' : lc.B.toFixed(4), lc.C == null ? '' : lc.C.toFixed(4), lc.ok ? 'OK' : 'X  ' + lc.err]);
    });
    const ci = chk.items[ii];
    body.push([{ content: `Total of ${it.heading || ''}`, colSpan: 2, styles: { fontStyle: 'bold' } }, ci.A.toFixed(4), ci.B.toFixed(4), ci.C.toFixed(4), ci.ok ? 'OK' : 'X']);
    if (ci.written != null && Math.abs(ci.writtenDiff) > 0.005) body.push([{ content: `Measurer's written total ${ci.written} differs from correct ${r2(ci.A)} by ${r2(ci.writtenDiff)}`, colSpan: 6, styles: { textColor: [200, 0, 0] } }]);
  });
  doc.autoTable({ startY: 64, head: [['No', 'Description', 'A', 'B', 'C', 'Result']], body, styles: { fontSize: 8 }, theme: 'grid', headStyles: { fillColor: [60, 60, 60] },
    didParseCell: d => { if (d.section === 'body' && d.column.index === 5) d.cell.styles.textColor = String(d.cell.raw).startsWith('OK') ? [0, 130, 0] : [200, 0, 0]; } });
  const y = doc.lastAutoTable.finalY + 20;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  doc.text(chk.allOk ? 'Result: all lines and totals match in all 3 methods.' : 'Result: NOT CLEAR – fix the lines marked X before this sheet goes out.', 40, y);
  if ((sheet.corrections || []).length) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text('Corrections made:', 40, y + 18);
    sheet.corrections.forEach((c, i) => doc.text(`${i + 1}. ${c}`, 50, y + 32 + i * 12));
  }
  return doc.output('blob');
}
