// Shared UI pieces: bottom sheets (pop-ups), help button, tips.
import { helpSheet, tipHtml, closeTip } from './help.js';

export function sheet(html, { onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet" role="dialog"><button class="sheet-x" aria-label="Close">✕</button>${html}</div>`;
  document.body.appendChild(wrap);
  const close = () => { wrap.remove(); onClose && onClose(); };
  wrap.addEventListener('click', e => { if (e.target === wrap || e.target.classList.contains('sheet-x') || e.target.dataset.close != null) close(); });
  const first = wrap.querySelector('input,select,textarea'); if (first && first.dataset.nofocus == null) setTimeout(() => first.focus(), 50);
  return { el: wrap.querySelector('.sheet'), close };
}

export function showHelp(key) { sheet(helpSheet(key)); }

export function confirmBox(text, okText = 'Yes') {
  return new Promise(res => {
    const s = sheet(`<p>${text}</p><div class="row end"><button class="btn ghost" data-close>Cancel</button><button class="btn" id="cb-ok">${okText}</button></div>`, { onClose: () => res(false) });
    s.el.querySelector('#cb-ok').onclick = () => { res(true); s.el.parentElement.remove(); };
  });
}

export async function mountTip(container, key) {
  const html = await tipHtml(key);
  if (!html) return;
  container.insertAdjacentHTML('afterbegin', html);
  const btn = container.querySelector(`[data-tipclose="${key}"]`);
  if (btn) btn.onclick = async () => { await closeTip(key); btn.closest('.tip').remove(); };
}

export function busy(text) {
  const d = document.createElement('div'); d.className = 'busy';
  d.innerHTML = `<div class="busy-box"><div class="spin"></div><p>${text}</p><div class="bar"><i></i></div></div>`;
  document.body.appendChild(d);
  return {
    set(t, p) { d.querySelector('p').textContent = t; if (p != null) d.querySelector('.bar i').style.width = Math.round(p * 100) + '%'; },
    done() { d.remove(); },
  };
}
