// In-app help: ⓘ text for every screen, first-time tips, the "How to measure" guide.
import { getSetting, setSetting } from './db.js';
import { esc } from './util.js';

export const SCREEN_HELP = {
  jobs: {
    title: 'Jobs',
    body: [
      ['What this screen is', 'Every site is one job. A job keeps its drawings, site sizes, measurement sheet, room plans and reports together.'],
      ['＋ New job', 'Tap it, type the job name and site (e.g. "RR Anna Nagar", "Chennai"). A folder with the same name is made in your Drive the first time you save a file.'],
      ['Quick measure', 'Want just one quick size? Tap ⚡ Quick measure. It asks what you want to measure and takes you to the right screen with tips.'],
      ['Cloud dot', 'Top right: green = saved to your account, amber = waiting (no internet or not signed in). Your work is always kept on the phone first.'],
    ],
  },
  job: {
    title: 'Inside a job',
    body: [
      ['📄 Drawing check', 'Upload the drawing (PDF from AutoCAD, or a photo of a printed drawing). The app reads the sizes printed on it.'],
      ['⚖ Drawing vs Site', 'Every point you measured: drawing size, site size and the difference. Green = within tolerance, red = beyond. Make the mismatch report here.'],
      ['🧾 Measurement sheet', 'The measurement sheet in the Pune format with the 3-way check. Export Excel / PDF / recheck version / check list.'],
      ['🏠 Room sizes (type)', 'Room plan from typed wall sizes + a photo per wall. Works out wall, floor and ceiling areas with door/window deductions.'],
      ['📷 Measure with camera', 'Length, height, on wall, full room, pillar. Rough (±1–2 cm) – type the tape size before billing.'],
      ['🔢 Count from photo', 'Photo → box round one item → the app counts all similar ones.'],
    ],
  },
  drawing: {
    title: 'Drawing screen',
    body: [
      ['Blue / amber chips', 'Sizes read from the drawing. Blue = read clearly. Amber = not sure – tap it and check the number before you use it.'],
      ['Measure a size', 'Tap a chip → type the site size you measured → Save. The pin turns green (OK) or red (mismatch).'],
      ['Measure anywhere', 'Tap any empty spot on the drawing → type the drawing size yourself and the site size.'],
      ['Zoom', 'Pinch with two fingers to zoom, drag with one finger to move. Tap without moving to place a point.'],
      ['Voice', 'In any size box, tap the microphone on your keyboard and say "twelve feet ten inches" or "two thousand four hundred".'],
      ['Page', 'For PDFs with many pages, use ◀ ▶ at the top.'],
    ],
  },
  compare: {
    title: 'Compare',
    body: [
      ['Colours', 'Green = difference within tolerance. Red = beyond tolerance (shows by how much). Grey = site size not typed yet.'],
      ['Tolerance', 'Default ±10 mm. Change it in Settings.'],
      ['Mismatch report', 'Makes a PDF (drawing with coloured pins + list) and an Excel. Saved in the job\'s Drive folder and ready to download. Nothing is sent to anyone.'],
    ],
  },
  sheet: {
    title: 'Measurement sheet',
    body: [
      ['Format', 'Pune format: S.No | Description | Unit | Nos | Length | Breath | Width | Qty. Blue head row per item, grey total row.'],
      ['Sizes', 'Type exactly as measured: 12\'10" or 2400 mm. Feet-inch sizes need whole inches (0–11).'],
      ['Units', 'Sqft = Nos × Length × Width. Rft = Nos × Length (beading, pattas, skirting). Nos / Set = the count.'],
      ['Minus lines', 'For windows, doors, columns: Nos = −1 and write "… minus (-)" in the description.'],
      ['3-way check', 'Every line is worked out 3 ways (exact inches, the sheet formula, decimal feet). All must match. Final Excel/PDF is blocked while any line shows ✘.'],
      ['Recheck version', 'For the person who measured: adds Site note | My remarks (red) | Measurer\'s remarks. Use it before the final.'],
      ['Written total', 'If the measurer wrote his own total on paper, type it in the item. Any difference is shown and printed in the check list.'],
    ],
  },
  plan: {
    title: 'Room plan',
    body: [
      ['Rectangle room', 'Type length, width and height. Done.'],
      ['Other shapes', 'Choose "Wall by wall". Stand in one corner, measure each wall going round the room, and say if the next corner turns left or right. The app draws the room and tells you if the walls don\'t close.'],
      ['Photos', 'Tap a wall in the list → 📷 to add its photo. Helpful to remember switches, windows and damage.'],
      ['Doors / windows', 'Add each opening with width × height and which wall. It is deducted from the wall area.'],
      ['Send to sheet', 'Adds the walls (with minus lines for openings), floor and ceiling as items in the measurement sheet.'],
    ],
  },
  ar: {
    title: 'Camera measuring',
    body: [
      ['Only rough', 'Readings are ±1–2 cm. Confirm with the tape before billing.'],
      ['Start', 'Pick a mode. Point at the floor 1–2 m ahead and move slowly until the white ring appears. Tap ● Mark or tap anywhere on the screen.'],
      ['↔ Length', 'Ring at one end → Mark, other end → Mark. Wall to wall: use the floor line at the base of each wall.'],
      ['↕ Height', 'Ring on the floor at the wall base → Mark. Then just aim at the top (ceiling line, beam, top of door) – a yellow dot follows straight up – Mark.'],
      ['▭ On wall', 'Two floor marks along the base of one wall. After that, aim anywhere on that wall (even plain paint) and Mark two points: window width, height, sill, switch height.'],
      ['⬚ Room', 'Mark every floor corner going round, then ✔ Finish (or tap the first corner again). All walls, corner angles and area go to Plan.'],
      ['▣ Pillar', 'Three floor corners: two of the front face, one round the side. Gives face × side.'],
      ['Undo', 'Removes the last mark.'],
    ],
  },
  photo: {
    title: 'Size from photo',
    body: [
      ['Corners', 'Tap the 4 corners of the opening: top-left, top-right, bottom-right, bottom-left. Drag any corner to fine-tune.'],
      ['Known size', 'Best: a board/tile on the same wall – tap its 4 corners and type its size. Or type one side of the opening (from tape/camera); the other side is worked out from the photo angle (±3–5%).'],
      ['Shutter', 'Type the no. of panels (or panel width) and folded thickness – you get panel size, folded stack and clear opening.'],
      ['Sheet', 'Add to sheet puts the opening as a Sqft line in the measurement sheet.'],
    ],
  },
  count: {
    title: 'Count from photo',
    body: [
      ['Photo', 'Stand straight in front, all items in the picture, good light. Items must look about the same size.'],
      ['Tap one', 'Tap ONE of the things you want counted. The app works out how: loose items, layers/slats, or same-looking items.'],
      ['Fix', 'Tap a wrong mark to remove it, tap a missed item to add it. Strictness slider: lower finds more.'],
      ['Bricks', 'Type wall length/height and brick size to cross-check the count by area.'],
      ['Save', 'Saves the count and the marked photo into the job (and its Drive folder).'],
    ],
  },
  settings: {
    title: 'Settings',
    body: [
      ['Tolerance', 'How much difference is still OK (default 10 mm).'],
      ['Show sizes in', 'mm, metres or feet-inch.'],
      ['Tips', 'Turn the 💡 tips back on if you hid them.'],
      ['Account', 'Sign in with Google so work is backed up and files go to your Drive. Only your own account can open the data.'],
    ],
  },
};

// The full "How to measure" guide – also where the camera angles live.
export const GUIDE = [
  { id: 'quick', icon: '⚡', title: 'Quick measure – I want to…', items: [
    ['…check one wall or one size against the drawing', 'Open the job → 📄 Drawing check → tap the size chip on the drawing → type what the tape shows → Save.'],
    ['…type the sizes of a room by hand', 'Open the job → 🏠 Room sizes → ＋ Room → type length, width, height (or wall by wall) → take a photo of each wall.'],
    ['…make the measurement sheet for billing', 'Open the job → 🧾 Measurement sheet → add items and lines → watch for ✔ on every line → Export Excel / PDF.'],
    ['…get a length / height / room size with the camera', 'Open the job → 📷 Measure with camera → pick the mode. Rough only.'],
    ['…count bricks, pillars, tiles from a photo', 'Open the job → 🔢 Count from photo → take photo → box round one item.'],
    ['…show the client/vendor what doesn\'t match', 'Open the job → ⚖ Drawing vs Site → Mismatch report.'],
  ] },
  { id: 'camera', icon: '📷', title: 'How to hold the camera', items: [
    ['Photo of a printed drawing', 'Lay the sheet flat on a table. Hold the phone straight above it, parallel to the paper (not tilted). Fill the screen with the part you need. Good light, no shadow of your hand or phone. Avoid glare – turn the sheet if the light reflects. Tap the screen to focus on the numbers.'],
    ['Big drawing', 'Don\'t shoot the whole A1 in one photo – the numbers become too small to read. Take 2–4 photos, one per area, each upload as its own drawing page.'],
    ['Photo of a wall', 'Stand back far enough to get the full wall, floor line to ceiling line. Hold the phone at chest height, straight and level (use the grid lines in your camera app). Face the middle of the wall, not from a corner.'],
    ['Photo of a detail (switch, niche, crack)', 'Come close, keep the tape in the photo showing the size, phone straight on to the surface.'],
    ['Measure with camera', 'Good light. Point at a surface with some texture (plain white walls and shiny floors are hard). Move the phone slowly left-right until the ring appears. Keep 1–3 m away. Hold steady when you tap Mark.'],
  ] },
  { id: 'tape', icon: '📏', title: 'Measuring tips (tape)', items: [
    ['Wall length', 'Measure at 3 heights (bottom, middle, top) – walls are rarely perfectly straight. Write the smallest for fitting work, note the difference.'],
    ['Height', 'Measure in two corners and the middle. Ceilings sag; floors slope.'],
    ['Openings', 'Door/window: width × height of the opening (not the frame), and the sill height from the floor.'],
    ['Feet-inch', 'Type as 12\'10". For 10 and 11 inches the sheet uses the special formula – the app handles it.'],
    ['Square check', 'For a rectangle room, measure both diagonals. If they differ a lot, the room is not square – use Wall by wall in the Plan.'],
  ] },
  { id: 'drawings', icon: '📄', title: 'Drawings', items: [
    ['Best file', 'From AutoCAD, Plot → "DWG to PDF". The app reads the printed sizes directly – most accurate.'],
    ['DWG file', 'A phone can\'t open DWG. Save it as PDF on the laptop (Plot → DWG to PDF) and upload the PDF.'],
    ['Amber sizes', 'Amber means the app is not sure of the number. Tap it and correct it before measuring.'],
    ['No sizes found', 'Some PDFs have the text as lines. The app then reads the picture of the page instead – it takes a little longer.'],
  ] },
];

export function helpSheet(key) {
  const h = SCREEN_HELP[key]; if (!h) return '';
  return `<h2>ⓘ ${esc(h.title)}</h2>` + h.body.map(([t, b]) => `<div class="help-row"><b>${esc(t)}</b><p>${esc(b)}</p></div>`).join('') +
    `<p class="muted">More: <a href="#/guide">How to measure – full guide</a></p>`;
}

export function guideHtml() {
  return GUIDE.map(sec => `<details class="guide" ${sec.id === 'quick' ? 'open' : ''}><summary>${sec.icon} ${esc(sec.title)}</summary>` +
    sec.items.map(([t, b]) => `<div class="help-row"><b>${esc(t)}</b><p>${esc(b)}</p></div>`).join('') + '</details>').join('');
}

// First-time tip per feature. Shown once, can be turned back on in Settings.
export const TIPS = {
  jobs: 'Start with ＋ New job. Not sure where to start? Tap ⓘ on any screen.',
  drawing: 'Tap a size chip on the drawing, then type what your tape shows. Pinch to zoom.',
  sheet: 'Each line is checked 3 ways. A ✘ means something to fix – tap it to see why.',
  plan: 'Rectangle room? Just type L, W, H. Odd shape? Use Wall by wall.',
  ar: 'Pick a mode. Start on the floor – Height and On wall need no ring on the wall.',
  count: 'Take the photo, then tap ONE of the things you want counted.',
  photo: 'Tap the 4 corners of the opening, then give one known size.',
  compare: 'Red rows are mismatches. Tap Mismatch report to make the PDF and Excel.',
};
export async function tipHtml(key) {
  if (!(await getSetting('tipsOn', true))) return '';
  const seen = await getSetting('tipSeen:' + key, false);
  if (seen || !TIPS[key]) return '';
  return `<div class="tip" data-tip="${key}">💡 ${esc(TIPS[key])} <button class="link" data-tipclose="${key}">Got it</button></div>`;
}
export async function closeTip(key) { await setSetting('tipSeen:' + key, true); }
export async function resetTips() { for (const k of Object.keys(TIPS)) await setSetting('tipSeen:' + k, false); await setSetting('tipsOn', true); }
