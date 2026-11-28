// Exact sums for a task (photo-first / wall / room). All maths here – the app's own code, never guessed.
// Every line is worked out 2 independent ways:
//   Way A – the Pune sheet check (inch maths + the Excel formula itself + decimal feet, all must agree)
//   Way B – plain millimetre maths (mm × mm ÷ 92,903.04 for Sqft)
// Totals are added up twice (in order, and positives minus openings) and must agree too.
import { sheetSize, check, normUnit } from './sheet.js';
import { findCat } from './categories.js';
import { mmToFtIn } from './units.js';

export const MEASURES = { LxH: 'Sqft', LxW: 'Sqft', L: 'Rft', M: 'Mtr', N: 'Nos' };
const EPS = 1e-9;
const same = (a, b) => Math.abs(a - b) <= EPS * Math.max(1, Math.abs(a), Math.abs(b));

// What one numbered area measures: { heading, unit, measure }
export function areaKind(m) {
  if (m.cat === '__other') { const ms = m.measure || 'LxH'; return { heading: (m.heading || 'Other').trim() || 'Other', unit: MEASURES[ms], measure: ms }; }
  const c = findCat(m.cat);
  if (c) return { heading: c.name, unit: normUnit(c.unit), measure: c.measure };
  return { heading: m.cat || 'Other', unit: 'Sqft', measure: 'LxH' };
}

// millimetres of a typed size – done separately from the sheet parser's inch route (way B)
export function sizeMm(raw) {
  const s = sheetSize(raw);
  if (!s.ok || s.empty) return null;
  if (s.kind === 'ftin') return (s.ft * 12 + s.inch) * 25.4;
  if (s.kind === 'mm') return s.value;
  if (s.kind === 'cm') return s.value * 10;
  if (s.kind === 'm') return s.value * 1000;
  return null;
}

// The parent area a minus line is taken from
export function parentOf(marks, m) {
  if (!m.minus) return null;
  const byN = marks.find(x => x.n === m.of && !x.minus);
  if (byN) return byN;
  const before = marks.filter(x => !x.minus && x.n < m.n);
  return before[before.length - 1] || null;
}

const sizeText = raw => { const mm = sizeMm(raw); return mm == null ? String(raw || '') : mmToFtIn(mm); };

// Work out every numbered area. Returns { lines, groups, allOk, problems }
export function workOut(marks) {
  const out = { lines: [], groups: [], allOk: true, problems: 0 };
  const sorted = [...marks].sort((a, b) => a.n - b.n);
  if (!sorted.length) { out.allOk = false; out.problems = 1; return out; }
  for (const m of sorted) {
    const parent = parentOf(sorted, m);
    const kind = m.minus ? (parent ? areaKind(parent) : null) : areaKind(m);
    const row = { n: m.n, minus: !!m.minus, of: parent ? parent.n : null, warn: [], err: '', ok: false, A: null, B: null };
    row.desc = m.desc || (m.minus ? 'Opening' : (kind ? kind.heading : ''));
    try {
      if (m.minus && !parent) throw new Error('Minus line needs an area to take it from');
      row.heading = kind.heading; row.unit = kind.unit; row.measure = kind.measure;
      const nos = Number(m.nos === '' || m.nos == null ? 1 : m.nos);
      if (!Number.isFinite(nos) || nos <= 0 || !Number.isInteger(nos)) throw new Error('Nos must be a whole number 1 or more');
      const two = kind.measure === 'LxH' || kind.measure === 'LxW', one = kind.measure === 'L' || kind.measure === 'M';
      const L = sheetSize(m.L), H = sheetSize(m.H);
      if (!L.ok) throw new Error(L.msg); if (!H.ok) throw new Error(H.msg);
      // unit check: the unit decides which sizes must be there
      if (two && (L.empty || H.empty)) throw new Error(`${kind.unit} needs both sizes`);
      if (one && L.empty) throw new Error(`${kind.unit} needs a length`);
      if (kind.measure === 'N' && (!L.empty || !H.empty)) row.warn.push('Count only – sizes not used');
      const sign = m.minus ? -1 : 1;
      // way A – Pune sheet check (3 methods inside must agree)
      const ln = { unit: kind.unit, nos: sign * nos, length: (two || one) ? String(m.L) : '', width: two ? String(m.H) : '' };
      const c = check({ items: [{ heading: kind.heading, lines: [ln] }] }).lines[0];
      if (!c.ok) throw new Error(c.err || 'Sheet check failed');
      row.A = c.A;
      // way B – millimetre maths
      const lm = sizeMm(m.L), hm = sizeMm(m.H);
      row.B = kind.unit === 'Sqft' ? sign * nos * lm * hm / 92903.04 : kind.unit === 'Rft' ? sign * nos * lm / 304.8 : kind.unit === 'Mtr' ? sign * nos * lm / 1000 : sign * nos;
      if (!same(row.A, row.B)) throw new Error('The 2 ways do not match');
      row.nos = nos;
      row.size = two ? `${sizeText(m.L)} × ${sizeText(m.H)}` : one ? sizeText(m.L) : '';
      row.sizeMm = two ? `${Math.round(lm)} × ${Math.round(hm)}` : one ? `${Math.round(lm)}` : '';
      // odd sizes (warnings – they do not lock Share)
      for (const [mm, nm] of [[lm, 'Size'], [hm, 'Size']]) if (mm != null && (mm < 10 || mm > 50000)) row.warn.push(`${nm} ${Math.round(mm)} mm looks odd`);
      if (kind.measure === 'LxH' && !m.minus && hm != null && (hm < 2000 || hm > 6000)) row.warn.push(`Height ${Math.round(hm)} mm – outside 2–6 m, check`);
      if (m.camL || m.camH) row.warn.push('Camera size ±1 cm – check before sending');
      row.ok = true;
    } catch (e) { row.err = e.message; row.ok = false; out.allOk = false; out.problems++; }
    out.lines.push(row);
  }
  // groups (one per heading + unit), totals added twice
  const keys = [];
  for (const r of out.lines) if (r.ok && !keys.includes(r.heading + '|' + r.unit)) keys.push(r.heading + '|' + r.unit);
  for (const k of keys) {
    const [heading, unit] = k.split('|');
    const rows = out.lines.filter(r => r.ok && r.heading === heading && r.unit === unit);
    let t1 = 0; for (const r of rows) t1 += r.A;                       // in order, way A
    const plus = rows.filter(r => r.B > 0).reduce((s, r) => s + r.B, 0); // positives, way B
    const minus = rows.filter(r => r.B < 0).reduce((s, r) => s + -r.B, 0);
    const t2 = plus - minus;
    const g = { heading, unit, total: t1, check: t2, ok: same(t1, t2) && t1 >= -EPS, plus, minus, n: rows.map(r => r.n) };
    if (t1 < -EPS) g.err = 'Openings are bigger than the area';
    else if (!g.ok) g.err = 'Totals do not add back';
    if (!g.ok) { out.allOk = false; out.problems++; }
    out.groups.push(g);
  }
  // minus bigger than its own parent
  for (const r of out.lines.filter(x => x.ok && x.minus)) {
    const p = out.lines.find(x => x.n === r.of);
    if (p && p.ok) {
      const taken = out.lines.filter(x => x.ok && x.minus && x.of === r.of).reduce((s, x) => s - x.A, 0);
      if (taken > p.A + EPS) { r.ok = false; r.err = `Openings bigger than area ${p.n}`; out.allOk = false; out.problems++; }
    }
  }
  return out;
}

export const q2 = v => (Math.round(v * 100) / 100).toFixed(2);

// Pune sheet object from a task (for Excel / PDF / Add to sheet)
export function toSheet(task, res, header) {
  const items = [];
  for (const g of res.groups) {
    const it = { heading: g.heading, lines: [] };
    for (const r of res.lines.filter(x => x.ok && x.heading === g.heading && x.unit === g.unit)) {
      const m = task.marks.find(x => x.n === r.n);
      const two = r.measure === 'LxH' || r.measure === 'LxW', one = r.measure === 'L' || r.measure === 'M';
      it.lines.push({ desc: `${r.n}. ${r.desc}${r.minus ? ' (minus)' : ''}`, unit: r.unit, nos: r.minus ? -r.nos : r.nos, length: two || one ? String(m.L) : '', breadth: '', width: two ? String(m.H) : '', siteNote: r.warn.join(' · ') });
    }
    items.push(it);
  }
  items.forEach((it, i) => { it.no = String(i + 1); });
  return { ...header, items };
}

// WhatsApp text: max 28 characters a line, amounts right, dotted leaders
export function lineFit(left, right, w = 28) {
  left = String(left); right = String(right);
  const room = w - right.length - 1;
  const parts = [];
  let s = left;
  while (s.length > room) { let cut = s.lastIndexOf(' ', room); if (cut < 8) cut = room; parts.push(s.slice(0, cut).trimEnd()); s = s.slice(cut).trimStart(); }
  const dots = '.'.repeat(Math.max(1, w - s.length - right.length - 2));
  parts.push(`${s} ${dots} ${right}`.slice(0, Math.max(w, s.length + right.length + 2)));
  return parts.join('\n');
}
export function numbersText(task, res, stamp) {
  const out = [`${task.label || 'Measurement'}`, stamp, ''];
  for (const g of res.groups) {
    out.push(`${g.heading} (${g.unit})`);
    for (const r of res.lines.filter(x => x.ok && x.heading === g.heading && x.unit === g.unit)) {
      out.push(lineFit(`${r.n} ${r.minus ? '− ' : ''}${r.size || r.desc}${r.nos > 1 ? ' ×' + r.nos : ''}`, q2(r.A)));
    }
    out.push(lineFit('Total', q2(g.total)), '');
  }
  out.push(res.allOk ? '✓ all match' : '✗ not checked');
  return '```\n' + out.join('\n') + '\n```';
}
