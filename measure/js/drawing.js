// Reading drawings: PDF text (pdf.js) and photos (Tesseract.js) – both run on the phone.
import { findDimensions } from './units.js';
import { loadScript } from './util.js';

let pdfjs;
async function needPdf() {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', location.href).href;
  }
  return pdfjs;
}

export async function openPdf(blob) {
  const lib = await needPdf();
  const data = new Uint8Array(await blob.arrayBuffer());
  return lib.getDocument({ data, isEvalSupported: false, standardFontDataUrl: new URL('vendor/pdf-fonts/', location.href).href }).promise;
}

// Render one page to a canvas, width in CSS px * scale
export async function renderPdfPage(pdf, pageNo, canvas, targetWidth) {
  const page = await pdf.getPage(pageNo);
  const v1 = page.getViewport({ scale: 1 });
  const scale = targetWidth / v1.width;
  const vp = page.getViewport({ scale });
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return { w: canvas.width, h: canvas.height, ratio: vp.height / vp.width };
}

// Read printed size text from one PDF page. Returns [{page,x,y,text,mm,kind,conf,src}] with x,y in 0..1
export async function readPdfPage(pdf, pageNo) {
  const page = await pdf.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = tc.items.filter(i => i.str && i.str.trim()).map(i => {
    const [x, y] = vp.convertToViewportPoint(i.transform[4], i.transform[5]);
    const h = Math.hypot(i.transform[2], i.transform[3]) || 8;
    const rot = Math.abs(i.transform[1]) > Math.abs(i.transform[0]);
    return { str: i.str, x, y, w: i.width || i.str.length * h * 0.5, h, rot };
  });
  // join pieces on the same line that sit close together (e.g. "12'" + "-6\"")
  items.sort((a, b) => (a.rot - b.rot) || (Math.round(a.y / 3) - Math.round(b.y / 3)) || (a.x - b.x));
  const groups = [];
  for (const it of items) {
    const g = groups[groups.length - 1];
    if (g && !it.rot && !g.rot && Math.abs(g.y - it.y) < it.h * 0.5 && it.x - (g.x + g.w) < it.h * 0.8 && it.x >= g.x) {
      g.str += (it.x - (g.x + g.w) > it.h * 0.25 ? ' ' : '') + it.str; g.w = it.x + it.w - g.x;
    } else groups.push({ ...it });
  }
  const out = [];
  for (const g of groups) {
    for (const d of findDimensions(g.str)) {
      const cx = g.rot ? g.x - g.h / 2 : g.x + g.w / 2;
      const cy = g.rot ? g.y - g.w / 2 : g.y - g.h / 2;
      out.push({ page: pageNo, x: clamp(cx / vp.width), y: clamp(cy / vp.height), text: d.text, mm: d.mm, kind: d.kind, conf: 100, src: 'pdf' });
    }
  }
  return { dims: dedupe(out), textCount: items.length };
}
const clamp = v => Math.min(1, Math.max(0, v));
function dedupe(list) {
  const seen = new Set();
  return list.filter(d => { const k = `${d.page}|${d.text}|${d.x.toFixed(3)}|${d.y.toFixed(3)}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---------- Photo / scanned drawing ----------
let worker;
async function needOcr(onProgress) {
  if (!worker) {
    await loadScript('vendor/tess/tesseract.min.js');
    const base = new URL('vendor/tess/', location.href).href;
    worker = await window.Tesseract.createWorker('eng', 1, {
      workerPath: base + 'worker.min.js', corePath: base, langPath: base.replace(/\/$/, ''), gzip: true,
      logger: m => onProgress && m.progress != null && onProgress(m.status, m.progress),
    });
    await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: "0123456789'\"-.mM ", preserve_interword_spaces: '1' });
  }
  return worker;
}

// Make the picture easier to read: grey, stronger contrast, at least ~2000 px wide.
export function prepareForReading(source, w, h) {
  const scale = Math.max(1, Math.min(3, 2000 / w));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const ctx = c.getContext('2d');
  ctx.drawImage(source, 0, 0, c.width, c.height);
  const img = ctx.getImageData(0, 0, c.width, c.height); const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    g = g < 140 ? Math.max(0, (g - 40) * 1.4) : 255; // dark text stays dark, paper turns white
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Returns [{page,x,y,text,mm,kind,conf,src:'ocr'}]
export async function readImage(canvas, pageNo = 1, onProgress) {
  const w = await needOcr(onProgress);
  // two passes (scattered text + normal page) – drawings have numbers everywhere
  const all = [];
  for (const psm of ['11', '3']) {
    await w.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await w.recognize(canvas);
    all.push(...wordsToDims(data, canvas.width, canvas.height, pageNo));
  }
  const merged = [];
  for (const d of all.sort((a, b) => b.conf - a.conf)) {
    if (!merged.some(m => m.text === d.text && Math.hypot(m.x - d.x, m.y - d.y) < 0.03)) merged.push(d);
  }
  return merged;
}
function wordsToDims(data, W, H, pageNo) {
  const out = [];
  const words = (data.words || []).filter(x => x.text && x.text.trim());
  const used = new Set();
  // pairs first (feet + inches split into two words)
  for (let i = 0; i < words.length - 1; i++) {
    const a = words[i], b = words[i + 1];
    if (a.line !== b.line && a.bbox.y0 !== b.bbox.y0 && Math.abs(a.bbox.y0 - b.bbox.y0) > (a.bbox.y1 - a.bbox.y0)) continue;
    if (!/'\s*-?$/.test(a.text) || !/^\d/.test(b.text)) continue;
    const ds = findDimensions(a.text + b.text);
    if (ds.length === 1 && ds[0].kind === 'ftin') {
      out.push(mk(ds[0], { x0: a.bbox.x0, y0: Math.min(a.bbox.y0, b.bbox.y0), x1: b.bbox.x1, y1: Math.max(a.bbox.y1, b.bbox.y1) }, Math.min(a.confidence, b.confidence)));
      used.add(i); used.add(i + 1);
    }
  }
  words.forEach((wd, i) => {
    if (used.has(i)) return;
    for (const d of findDimensions(wd.text)) out.push(mk(d, wd.bbox, wd.confidence));
  });
  function mk(d, bb, conf) {
    return { page: pageNo, x: clamp((bb.x0 + bb.x1) / 2 / W), y: clamp((bb.y0 + bb.y1) / 2 / H), text: d.text, mm: d.mm, kind: d.kind, conf: Math.round(conf), src: 'ocr' };
  }
  return out;
}

export async function blobToImage(blob) {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('Not a picture')); img.src = url; });
  return img;
}

export const LOW_CONF = 75;
