// Bluetooth laser meter (Bosch GLM …C / CG, Leica DISTO) + voice entry for sizes.
// A reading goes straight into the size box you last tapped. Two readings of the same size are compared (two-way check).
import { toast } from './util.js';

const BOSCH_SVC = '02a6c0d0-0451-4000-b000-fb3210111989';
const BOSCH_CHR = '02a6c0d1-0451-4000-b000-fb3210111989';
const LEICA_SVC = '3ab10100-f831-4395-b29d-570977d5bf94';
const LEICA_CHR = '3ab10101-f831-4395-b29d-570977d5bf94';

let device = null, lastInput = null;
const listeners = new Set();
export const laserState = { connected: false, name: '', last: [] };
export const onLaser = fn => { listeners.add(fn); fn(laserState); };
const emit = () => listeners.forEach(f => f(laserState));

// ---- which box gets the reading: the size box you tapped last ----
const NOT_SIZE_IDS = new Set(['j-name', 'j-site', 'j-client', 'e-n', 'e-s', 'e-c', 's-by', 's-tol', 'r-n', 'ni', 'c-l', 'p-l', 'p-n', 'k-name', 'l-name', 'o-name', 'c-name', 'pp-name', 'corr', 's-n', 'cal-len', 'b-bl', 'b-bh', 'b-j']);
export function isSizeInput(el) {
  if (!el || el.tagName !== 'INPUT') return false;
  if (['checkbox', 'range', 'file', 'radio'].includes(el.type)) return false;
  if (el.dataset.lf && ['desc', 'siteNote', 'myRemark', 'measurerRemark', 'nos'].includes(el.dataset.lf)) return false;
  if (el.dataset.f && el.dataset.f !== 'writtenTotal') return false;
  if (el.dataset.h) return false;
  if (el.id && NOT_SIZE_IDS.has(el.id)) return false;
  if (/nos/.test(el.className) || el.dataset.on != null) return false;
  return true;
}
document.addEventListener('focusin', e => { if (isSizeInput(e.target)) { lastInput = e.target; showMic(e.target); } });

export function fillSize(text, from) {
  const el = lastInput && document.body.contains(lastInput) ? lastInput : null;
  if (!el) { toast(`${from}: ${text} – tap a size box first`, 3500); return false; }
  el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  el.classList.add('filled'); setTimeout(() => el.classList.remove('filled'), 900);
  return true;
}

// ---- laser ----
export const laserSupported = () => !!navigator.bluetooth;
export async function connectLaser() {
  if (!navigator.bluetooth) throw new Error('Bluetooth not available in this browser – open the app in Chrome on Android');
  device = await navigator.bluetooth.requestDevice({
    filters: [{ namePrefix: 'GLM' }, { namePrefix: 'PLR' }, { namePrefix: 'DISTO' }, { services: [BOSCH_SVC] }, { services: [LEICA_SVC] }],
    optionalServices: [BOSCH_SVC, LEICA_SVC],
  });
  device.addEventListener('gattserverdisconnected', () => { laserState.connected = false; emit(); toast('Laser meter disconnected'); });
  const gatt = await device.gatt.connect();
  let chr = null, kind = '';
  try { chr = await (await gatt.getPrimaryService(BOSCH_SVC)).getCharacteristic(BOSCH_CHR); kind = 'bosch'; } catch (e) { /* not Bosch */ }
  if (!chr) { try { chr = await (await gatt.getPrimaryService(LEICA_SVC)).getCharacteristic(LEICA_CHR); kind = 'leica'; } catch (e) { /* not Leica */ } }
  if (!chr) throw new Error('This laser meter is not supported (Bosch GLM …C and Leica DISTO work)');
  chr.addEventListener('characteristicvaluechanged', e => {
    const dv = e.target.value; const mm = parseReading(dv, kind);
    if (mm != null) gotReading(mm);
  });
  await chr.startNotifications();
  if (kind === 'bosch') { try { await chr.writeValue(new Uint8Array([0xc0, 0x55, 0x02, 0x01, 0x00, 0x1a])); } catch (e) { /* older models send without it */ } }
  laserState.connected = true; laserState.name = device.name || 'Laser'; emit();
  toast(`${laserState.name} connected – tap a size box, then press the laser button`, 4000);
}
export function parseReading(dv, kind) {
  if (kind === 'bosch') {
    if (dv.byteLength < 11 || dv.getUint8(0) !== 0xc0 || dv.getUint8(1) !== 0x55 || dv.getUint8(2) !== 0x10 || dv.getUint8(3) !== 0x06) return null;
    const m = dv.getFloat32(7, true); return m > 0 && m < 300 ? Math.round(m * 1000) : null;
  }
  if (dv.byteLength >= 4) { const m = dv.getFloat32(0, true); return m > 0 && m < 300 ? Math.round(m * 1000) : null; }
  return null;
}
function gotReading(mm) {
  const prev = laserState.last[0];
  laserState.last.unshift({ mm, at: Date.now() }); laserState.last = laserState.last.slice(0, 5);
  let check = '';
  if (prev && Date.now() - prev.at < 60000) { const d = Math.abs(mm - prev.mm); check = d <= 3 ? ` ✔ matches last (${d} mm)` : ` ⚠ last was ${prev.mm} – differs ${d} mm, measure again`; }
  fillSize(`${mm} mm`, 'Laser');
  toast(`Laser: ${mm} mm${check}`, 3500); emit();
}
export function disconnectLaser() { if (device && device.gatt.connected) device.gatt.disconnect(); }

// ---- voice ----
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = () => !!SR;
const ONES = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, for: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function wordsToNumbers(s) {
  const toks = s.toLowerCase().replace(/-/g, ' ').replace(/(\d),(\d)/g, '$1$2').split(/\s+/).filter(Boolean);
  const out = []; let cur = null, total = 0, dec = null;
  const flush = () => { if (cur !== null || total) { let v = total + (cur || 0); if (dec !== null) v = Number(`${v}.${dec}`); out.push(String(v)); } cur = null; total = 0; dec = null; };
  for (const t of toks) {
    if (/^\d+(\.\d+)?$/.test(t)) { if (dec !== null) { dec += t; continue; } if (cur !== null) flush(); cur = Number(t); continue; }
    if (t in ONES) { if (dec !== null) { dec += String(ONES[t]); continue; } cur = (cur || 0) + ONES[t]; continue; }
    if (t in TENS) { cur = (cur || 0) + TENS[t]; continue; }
    if (t === 'hundred') { cur = (cur || 1) * 100; continue; }
    if (t === 'thousand') { total += (cur || 1) * 1000; cur = null; continue; }
    if (t === 'point' || t === 'dot') { dec = ''; continue; }
    if (t === 'and') continue;
    flush(); out.push(t);
  }
  flush();
  return out.join(' ');
}
// "twelve feet four inches" → 12'4"   "two thousand four hundred" → 2400 mm   "2.4 metres" → 2.4 m
export function spokenToSize(said) {
  const s = wordsToNumbers(said).replace(/\bfoot\b|\bfeet\b|\bft\b/g, 'ft').replace(/\binch(es)?\b|\bin\b/g, 'in')
    .replace(/\bmillimet(er|re)s?\b|\bmm\b/g, 'mm').replace(/\bcentimet(er|re)s?\b|\bcm\b/g, 'cm').replace(/\bmet(er|re)s?\b|\bmtrs?\b/g, 'm');
  let m = s.match(/(\d+(?:\.\d+)?)\s*ft\s*(\d+(?:\.\d+)?)?\s*(in)?/);
  if (m) return `${Number(m[1])}'${m[2] ? Number(m[2]) : 0}"`;
  m = s.match(/(\d+(?:\.\d+)?)\s*in\b/); if (m) { const i = Number(m[1]); return `${Math.floor(i / 12)}'${i % 12}"`; }
  m = s.match(/(\d+(?:\.\d+)?)\s*m\b\s*(\d+)?/); if (m) { const v = Number(m[1]) + (m[2] ? Number(m[2]) / (m[2].length <= 2 ? 100 : 1000) : 0); return `${Math.round(v * 1000)} mm`; }
  m = s.match(/(\d+(?:\.\d+)?)\s*cm\b/); if (m) return `${Math.round(Number(m[1]) * 10)} mm`;
  m = s.match(/(\d+(?:\.\d+)?)/); if (m) return `${Number(m[1])} mm`;
  return null;
}
let mic = null;
function showMic(el) {
  if (!SR) return;
  if (!mic) {
    mic = document.createElement('button'); mic.className = 'mic-chip'; mic.type = 'button'; mic.textContent = '🎤 Say size';
    mic.addEventListener('pointerdown', e => e.preventDefault()); // keep the box focused
    mic.onclick = listen; document.body.appendChild(mic);
    document.addEventListener('focusout', () => setTimeout(() => { if (!isSizeInput(document.activeElement) && mic) mic.hidden = true; }, 200));
  }
  mic.hidden = false;
}
function listen() {
  const r = new SR(); r.lang = 'en-IN'; r.interimResults = false; r.maxAlternatives = 3;
  mic.textContent = '🎙 Listening…';
  r.onresult = e => {
    const alts = [...e.results[0]].map(a => a.transcript);
    const size = alts.map(spokenToSize).find(Boolean);
    if (size) { fillSize(size, 'Voice'); toast(`Heard "${alts[0]}" → ${size}`, 3000); } else toast(`Heard "${alts[0]}" – say it like "twelve feet four" or "two thousand four hundred mm"`, 4000);
  };
  r.onerror = e => toast('Voice: ' + e.error);
  r.onend = () => { mic.textContent = '🎤 Say size'; };
  r.start();
}
