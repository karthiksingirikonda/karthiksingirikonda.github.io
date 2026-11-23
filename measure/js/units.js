// Size parsing and formatting. Internal unit: millimetres.
export const MM_PER_INCH = 25.4;
export const MM_PER_FOOT = 304.8;

// Returns { mm, kind, ft, inch, text } or null.
// kind: 'ftin' | 'in' | 'mm' | 'cm' | 'm'
export function parseSize(raw, defaultUnit = 'mm') {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[’‘`´]/g, "'").replace(/[”“″]/g, '"').replace(/′/g, "'").replace(/''/g, '"');
  s = s.replace(/,/g, '').replace(/\s+/g, ' ').toLowerCase();
  if (!s) return null;
  let m;
  // feet-inch: 12'10" / 12'-10" / 12' 10 / 12ft 10in / 12 ft / 12'
  m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*-?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?)?$/);
  if (m) {
    const ft = Number(m[1]);
    const inch = m[2] != null ? Number(m[2]) : 0;
    if (inch >= 12) return null;
    return { mm: ft * MM_PER_FOOT + inch * MM_PER_INCH, kind: 'ftin', ft, inch, text: ftinText(ft, inch) };
  }
  m = s.match(/^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/);
  if (m) { const i = Number(m[1]); return { mm: i * MM_PER_INCH, kind: 'in', ft: Math.floor(i / 12), inch: i % 12, text: `${m[1]}"` }; }
  m = s.match(/^(\d+(?:\.\d+)?)\s*(mm|cm|m|mtr|metre|meter)?$/);
  if (m) {
    const v = Number(m[1]);
    let u = m[2] || defaultUnit;
    if (u === 'mtr' || u === 'metre' || u === 'meter') u = 'm';
    if (u === 'ftin') { // bare number while feet mode: treat as feet
      return { mm: v * MM_PER_FOOT, kind: 'ftin', ft: v, inch: 0, text: ftinText(v, 0) };
    }
    const mul = u === 'm' ? 1000 : u === 'cm' ? 10 : 1;
    return { mm: v * mul, kind: u, text: `${m[1]}${u === 'mm' ? ' mm' : ' ' + u}` };
  }
  return null;
}

export function ftinText(ft, inch) { return `${ft}'${inch}"`; }

export function mmToFtIn(mm) {
  const totalIn = Math.round(Math.abs(mm) / MM_PER_INCH);
  const sign = mm < 0 ? '-' : '';
  return `${sign}${Math.floor(totalIn / 12)}'${totalIn % 12}"`;
}

export function fmt(mm, unit = 'mm') {
  if (mm == null || isNaN(mm)) return '—';
  if (unit === 'ftin') return mmToFtIn(mm);
  if (unit === 'm') return (mm / 1000).toFixed(3) + ' m';
  return Math.round(mm) + ' mm';
}

// Difference in the user's unit, signed, with +/−
export function fmtDiff(mm, unit = 'mm') {
  if (mm == null || isNaN(mm)) return '—';
  const sign = mm > 0 ? '+' : mm < 0 ? '−' : '±';
  if (unit === 'ftin') {
    const inch = Math.abs(mm) / MM_PER_INCH;
    return `${sign}${Math.round(Math.abs(mm))} mm (${inch.toFixed(1)}")`;
  }
  return `${sign}${Math.round(Math.abs(mm))} mm`;
}

// Find dimension-like strings inside a piece of drawing text.
// Returns [{ text, mm, kind }]
export function findDimensions(text) {
  const out = [];
  if (!text) return out;
  const t = String(text).replace(/[’‘`´′]/g, "'").replace(/[”“″]/g, '"').replace(/''/g, '"');
  const re = /(\d{1,3})\s*'\s*-?\s*(\d{1,2}(?:\.\d+)?)?\s*"?|(\d+(?:\.\d+)?)\s*(mm|m)\b|(?<![:\d.\/])\b(\d{3,5})\b(?![:\/])/gi;
  let m;
  while ((m = re.exec(t))) {
    if (m[1] != null) {
      const ft = Number(m[1]); const inch = m[2] != null ? Number(m[2]) : 0;
      if (inch < 12) out.push({ text: ftinText(ft, inch), mm: ft * MM_PER_FOOT + inch * MM_PER_INCH, kind: 'ftin' });
    } else if (m[3] != null) {
      const v = Number(m[3]); const u = m[4].toLowerCase();
      out.push({ text: `${m[3]} ${u}`, mm: u === 'm' ? v * 1000 : v, kind: u });
    } else if (m[5] != null) {
      const v = Number(m[5]);
      if (v >= 100 && v <= 99999) out.push({ text: `${m[5]}`, mm: v, kind: 'mm' });
    }
  }
  return out;
}
