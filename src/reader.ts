import type { Page } from './archive';
import { h } from './util';

export interface ReaderOptions {
  title: string;
  pages: Page[];
  startPage: number;
  onPageChange?: (page: number, total: number) => void;
  onClose?: () => void;
}

type FitMode = 'screen' | 'width';
interface Prefs {
  fit: FitMode;
  spread: boolean;
}

const PREFS_KEY = 'comicreader.readerPrefs';
function loadPrefs(): Prefs {
  try {
    return { fit: 'screen', spread: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return { fit: 'screen', spread: true };
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* negeren */
  }
}

const MAX_ZOOM = 6;
const TAP_MS = 300;
const DOUBLE_TAP_MS = 280;

/**
 * Volledig-scherm lezer met:
 * - tikken links/rechts of vegen om te bladeren, midden tikken voor de menubalk
 * - knijpen (pinch), dubbeltikken, Ctrl+scrollwiel of +/- om te zoomen
 * - slepen om te verschuiven als je ingezoomd bent
 * - "passend" of "volle breedte", en dubbele pagina's in liggende stand
 */
export function openReader(opts: ReaderOptions): { close: () => void } {
  const { pages } = opts;
  const total = pages.length;
  const prefs = loadPrefs();
  const urls = new Map<number, string>();
  const dims = new Map<number, { w: number; h: number }>();

  const urlOf = (i: number) => {
    let u = urls.get(i);
    if (!u) {
      u = URL.createObjectURL(pages[i].blob);
      urls.set(i, u);
    }
    return u;
  };

  async function loadImage(i: number): Promise<HTMLImageElement> {
    const img = new Image();
    img.decoding = 'async';
    img.draggable = false;
    img.alt = `Pagina ${i + 1}`;
    img.src = urlOf(i);
    try {
      await img.decode();
    } catch {
      /* toon toch */
    }
    dims.set(i, { w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    return img;
  }

  async function dimsOf(i: number) {
    if (!dims.has(i)) await loadImage(i);
    return dims.get(i)!;
  }
  const isPortrait = async (i: number) => {
    const d = await dimsOf(i);
    return d.h >= d.w;
  };

  // ---------- DOM ----------
  const canvas = h('div', { class: 'r-canvas' });
  const stage = h('div', { class: 'r-stage' }, canvas);
  const pageLabel = h('span', { class: 'r-pagelabel' });
  const slider = h('input', {
    type: 'range',
    min: '1',
    max: String(total),
    value: '1',
    class: 'r-slider',
    'aria-label': 'Ga naar pagina',
  }) as HTMLInputElement;
  const fitBtn = h('button', { class: 'icon-btn', title: 'Passend / volle breedte (W)' });
  const spreadBtn = h('button', { class: 'icon-btn', title: "Dubbele pagina's in liggende stand (D)" });
  const zoomOutBtn = h('button', { class: 'icon-btn zoom-btn', title: 'Uitzoomen (-)' }, '−');
  const zoomInBtn = h('button', { class: 'icon-btn zoom-btn', title: 'Inzoomen (+)' }, '+');
  const fsBtn = h('button', { class: 'icon-btn', title: 'Volledig scherm (F)' }, '⛶');
  const closeBtn = h('button', { class: 'icon-btn', title: 'Terug naar bibliotheek (Esc)' }, '←');
  const top = h(
    'div',
    { class: 'r-bar r-top' },
    closeBtn,
    h('div', { class: 'r-title' }, opts.title),
    h('div', { class: 'r-tools' }, zoomOutBtn, zoomInBtn, fitBtn, spreadBtn, document.fullscreenEnabled ? fsBtn : null),
  );
  const bottom = h('div', { class: 'r-bar r-bottom' }, slider, pageLabel);
  const root = h('div', { class: 'reader', tabindex: '-1' }, stage, top, bottom);
  document.body.append(root);
  document.body.classList.add('reading');
  root.focus();

  // ---------- state ----------
  let shown: number[] = [];
  let baseW = 0; // inhoud bij zoom 1 (px)
  let baseH = 0;
  let natW = 1; // inhoud in natuurlijke verhouding
  let natH = 1;
  let scale = 1;
  let tx = 0;
  let ty = 0;
  let renderToken = 0;
  let uiVisible = true;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const vw = () => stage.clientWidth;
  const vh = () => stage.clientHeight;
  const spreadActive = () => prefs.spread && prefs.fit === 'screen' && vw() > vh() * 1.1;

  function updateButtons() {
    fitBtn.textContent = prefs.fit === 'screen' ? '↔' : '⤢';
    fitBtn.title = prefs.fit === 'screen' ? 'Volle breedte (W)' : 'Passend op scherm (W)';
    spreadBtn.textContent = prefs.spread ? '▯▯' : '▯';
    spreadBtn.classList.toggle('active', prefs.spread);
  }

  function layout() {
    const fit = prefs.fit === 'width' ? vw() / natW : Math.min(vw() / natW, vh() / natH);
    baseW = natW * fit;
    baseH = natH * fit;
  }

  function clamp() {
    const w = baseW * scale;
    const hgt = baseH * scale;
    tx = w <= vw() ? (vw() - w) / 2 : Math.min(0, Math.max(vw() - w, tx));
    ty = hgt <= vh() ? (vh() - hgt) / 2 : Math.min(0, Math.max(vh() - hgt, ty));
  }

  function apply() {
    clamp();
    canvas.style.width = `${baseW * scale}px`;
    canvas.style.height = `${baseH * scale}px`;
    canvas.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    stage.classList.toggle('zoomed', scale > 1.01);
  }

  const overflowX = () => baseW * scale > vw() + 1;
  const overflowY = () => baseH * scale > vh() + 1;

  function zoomAt(newScale: number, px: number, py: number) {
    newScale = Math.min(MAX_ZOOM, Math.max(1, newScale));
    const cx = (px - tx) / scale;
    const cy = (py - ty) / scale;
    scale = newScale;
    tx = px - cx * scale;
    ty = py - cy * scale;
    apply();
  }

  async function show(indices: number[], align: 'top' | 'bottom' = 'top') {
    const token = ++renderToken;
    const imgs = await Promise.all(indices.map(loadImage));
    if (token !== renderToken) return;
    shown = indices;
    // alle pagina's op dezelfde hoogte naast elkaar
    const ds = indices.map((i) => dims.get(i)!);
    natH = Math.max(...ds.map((d) => d.h));
    natW = ds.reduce((sum, d) => sum + (d.w * natH) / d.h, 0);
    canvas.replaceChildren(...imgs);
    scale = 1;
    layout();
    tx = 0;
    ty = align === 'top' ? 0 : -Infinity;
    apply();
    const first = indices[0];
    const last = indices[indices.length - 1];
    pageLabel.textContent =
      indices.length > 1 ? `${first + 1}–${last + 1} / ${total}` : `${first + 1} / ${total}`;
    slider.value = String(first + 1);
    opts.onPageChange?.(last, total);
    // volgende pagina's alvast inladen
    for (const i of [last + 1, last + 2, first - 1]) if (i >= 0 && i < total && !dims.has(i)) void loadImage(i);
  }

  /** Dubbele pagina's: cover alleen, daarna vaste paren (2-3, 4-5, …); liggende pagina's alleen. */
  async function goTo(i: number, align: 'top' | 'bottom' = 'top') {
    i = Math.max(0, Math.min(total - 1, i));
    if (spreadActive() && i > 0) {
      const s = i % 2 === 1 ? i : i - 1;
      if (s + 1 < total && (await isPortrait(s)) && (await isPortrait(s + 1))) return show([s, s + 1], align);
    }
    return show([i], align);
  }

  async function next() {
    const last = shown[shown.length - 1] ?? -1;
    if (last >= total - 1) return flash('Laatste pagina');
    await goTo(last + 1);
  }

  async function prev() {
    const first = shown[0] ?? 0;
    if (first <= 0) return flash('Eerste pagina');
    await goTo(first - 1, prefs.fit === 'width' ? 'bottom' : 'top');
  }

  function flash(text: string) {
    const el = h('div', { class: 'r-flash' }, text);
    root.append(el);
    setTimeout(() => el.remove(), 900);
  }

  function setUi(visible: boolean) {
    uiVisible = visible;
    root.classList.toggle('ui-hidden', !visible);
    clearTimeout(hideTimer);
    if (visible) hideTimer = setTimeout(() => setUi(false), 4000);
  }

  /** Scroll of blader: eerst de pagina naar beneden schuiven, daarna volgende pagina. */
  function stepForward() {
    if (overflowY() && ty > vh() - baseH * scale + 1) {
      ty -= vh() * 0.85;
      apply();
    } else void next();
  }
  function stepBack() {
    if (overflowY() && ty < -1) {
      ty += vh() * 0.85;
      apply();
    } else void prev();
  }

  // ---------- aanraken / muis ----------
  const pointers = new Map<number, { x: number; y: number }>();
  let downAt = 0;
  let downPos = { x: 0, y: 0 };
  let moved = false;
  let pinch: { dist: number; scale: number; mid: { x: number; y: number } } | null = null;
  let wasPinch = false;
  let lastTap = { t: 0, x: 0, y: 0 };
  let tapTimer: ReturnType<typeof setTimeout> | undefined;

  const stagePoint = (e: { clientX: number; clientY: number }) => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pinchInfo = () => {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
  };

  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId);
    const p = stagePoint(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      downAt = performance.now();
      downPos = p;
      moved = false;
      wasPinch = false;
    } else if (pointers.size === 2) {
      const info = pinchInfo();
      pinch = { dist: info.dist, scale, mid: info.mid };
      moved = true;
      wasPinch = true;
    }
  });

  stage.addEventListener('pointermove', (e) => {
    const prevPos = pointers.get(e.pointerId);
    if (!prevPos) return;
    const p = stagePoint(e);
    pointers.set(e.pointerId, p);
    if (pinch && pointers.size >= 2) {
      const info = pinchInfo();
      // verschuiven met het midden + zoomen rond het midden
      tx += info.mid.x - pinch.mid.x;
      ty += info.mid.y - pinch.mid.y;
      pinch.mid = info.mid;
      zoomAt(pinch.scale * (info.dist / pinch.dist), info.mid.x, info.mid.y);
      return;
    }
    if (Math.hypot(p.x - downPos.x, p.y - downPos.y) > 8) moved = true;
    if (moved && (overflowX() || overflowY())) {
      tx += p.x - prevPos.x;
      ty += p.y - prevPos.y;
      apply();
    }
  });

  const endPointer = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    const p = stagePoint(e);
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      if (scale < 1.05) {
        scale = 1;
        apply();
      }
      return;
    }
    if (pointers.size > 0 || wasPinch) return;
    const dt = performance.now() - downAt;
    const dx = p.x - downPos.x;
    const dy = p.y - downPos.y;
    if (!moved && dt < TAP_MS && e.type === 'pointerup') return handleTap(p);
    // vegen om te bladeren (alleen als de pagina niet horizontaal uitsteekt)
    if (!overflowX() && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 800) {
      if (dx < 0) void next();
      else void prev();
    }
  };
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);

  function handleTap(p: { x: number; y: number }) {
    const now = performance.now();
    if (now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 40) {
      clearTimeout(tapTimer);
      lastTap.t = 0;
      if (scale > 1.01) {
        scale = 1;
        apply();
      } else zoomAt(2.5, p.x, p.y);
      return;
    }
    lastTap = { t: now, x: p.x, y: p.y };
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => {
      const zone = p.x / vw();
      if (zone < 0.3) stepBack();
      else if (zone > 0.7) stepForward();
      else setUi(!uiVisible);
    }, DOUBLE_TAP_MS);
  }

  // ---------- scrollwiel / trackpad ----------
  let wheelAcc = 0;
  let wheelCooldown = 0;
  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = stagePoint(e);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? vh() : 1;
      const dyPx = e.deltaY * unit;
      const dxPx = e.deltaX * unit;
      if (e.ctrlKey || e.metaKey) {
        // muiswiel geeft grote stappen, trackpad-knijpen kleine
        const k = Math.abs(dyPx) >= 50 ? 0.0025 : 0.01;
        zoomAt(scale * Math.exp(-dyPx * k), p.x, p.y);
        return;
      }
      if (overflowX() || overflowY()) {
        const beforeX = tx;
        const beforeY = ty;
        tx -= dxPx;
        ty -= dyPx;
        apply();
        if (tx !== beforeX || ty !== beforeY) {
          wheelAcc = 0;
          return;
        }
      }
      // aan de rand (of niets te scrollen): verder scrollen = bladeren
      const now = performance.now();
      if (now < wheelCooldown) return;
      wheelAcc += Math.abs(dyPx) > Math.abs(dxPx) ? dyPx : dxPx;
      const threshold = overflowY() ? 250 : 80;
      if (Math.abs(wheelAcc) > threshold) {
        if (wheelAcc > 0) void next();
        else void prev();
        wheelAcc = 0;
        wheelCooldown = now + 350;
      }
    },
    { passive: false },
  );

  // ---------- toetsenbord ----------
  function onKey(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement && e.target !== slider) return;
    const c = { x: vw() / 2, y: vh() / 2 };
    switch (e.key) {
      case 'ArrowRight':
      case 'PageDown':
        void next();
        break;
      case 'ArrowLeft':
      case 'PageUp':
        void prev();
        break;
      case ' ':
        if (e.shiftKey) stepBack();
        else stepForward();
        break;
      case 'ArrowDown':
        if (overflowY()) {
          ty -= vh() * 0.2;
          apply();
        } else void next();
        break;
      case 'ArrowUp':
        if (overflowY()) {
          ty += vh() * 0.2;
          apply();
        } else void prev();
        break;
      case 'Home':
        void goTo(0);
        break;
      case 'End':
        void goTo(total - 1);
        break;
      case '+':
      case '=':
        zoomAt(scale * 1.25, c.x, c.y);
        break;
      case '-':
        zoomAt(scale / 1.25, c.x, c.y);
        break;
      case '0':
        scale = 1;
        apply();
        break;
      case 'w':
      case 'W':
        toggleFit();
        break;
      case 'd':
      case 'D':
        toggleSpread();
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        break;
      case 'Escape':
        if (!document.fullscreenElement) close();
        break;
      default:
        return;
    }
    e.preventDefault();
  }
  window.addEventListener('keydown', onKey);

  // ---------- knoppen ----------
  function toggleFit() {
    prefs.fit = prefs.fit === 'screen' ? 'width' : 'screen';
    savePrefs(prefs);
    updateButtons();
    void goTo(shown[0] ?? 0);
  }
  function toggleSpread() {
    prefs.spread = !prefs.spread;
    savePrefs(prefs);
    updateButtons();
    void goTo(shown[0] ?? 0);
  }
  function toggleFullscreen() {
    if (!document.fullscreenEnabled) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.requestFullscreen().catch(() => {});
  }
  fitBtn.addEventListener('click', toggleFit);
  spreadBtn.addEventListener('click', toggleSpread);
  fsBtn.addEventListener('click', toggleFullscreen);
  zoomInBtn.addEventListener('click', () => zoomAt(scale * 1.5, vw() / 2, vh() / 2));
  zoomOutBtn.addEventListener('click', () => zoomAt(scale / 1.5, vw() / 2, vh() / 2));
  closeBtn.addEventListener('click', () => close());
  slider.addEventListener('input', () => {
    pageLabel.textContent = `${slider.value} / ${total}`;
  });
  slider.addEventListener('change', () => void goTo(Number(slider.value) - 1));
  for (const bar of [top, bottom]) {
    bar.addEventListener('pointerdown', () => setUi(true));
  }

  // ---------- schermgrootte ----------
  let lastSpread = spreadActive();
  const ro = new ResizeObserver(() => {
    if (spreadActive() !== lastSpread) {
      lastSpread = spreadActive();
      void goTo(shown[0] ?? 0);
      return;
    }
    const oldW = baseW * scale;
    const relX = oldW ? (vw() / 2 - tx) / oldW : 0.5;
    layout();
    tx = vw() / 2 - relX * baseW * scale;
    apply();
  });
  ro.observe(stage);

  // scherm niet laten uitgaan tijdens het lezen (tablet/gsm)
  let wakeLock: { release(): Promise<void> } | null = null;
  const requestWakeLock = async () => {
    try {
      wakeLock = (await (navigator as any).wakeLock?.request('screen')) ?? null;
    } catch {
      /* niet ondersteund of geweigerd */
    }
  };
  const onVisible = () => document.visibilityState === 'visible' && void requestWakeLock();
  void requestWakeLock();
  document.addEventListener('visibilitychange', onVisible);

  // terug-knop van browser/telefoon sluit de lezer
  history.pushState({ reader: true }, '');
  const onPop = () => close(true);
  window.addEventListener('popstate', onPop);

  let closed = false;
  function close(fromHistory = false) {
    if (closed) return;
    closed = true;
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('popstate', onPop);
    ro.disconnect();
    document.removeEventListener('visibilitychange', onVisible);
    void wakeLock?.release().catch(() => {});
    clearTimeout(hideTimer);
    clearTimeout(tapTimer);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    root.remove();
    document.body.classList.remove('reading');
    for (const u of urls.values()) URL.revokeObjectURL(u);
    if (!fromHistory && history.state?.reader) history.back();
    opts.onClose?.();
  }

  updateButtons();
  setUi(true);
  void goTo(Math.min(Math.max(0, opts.startPage), total - 1));
  return { close: () => close() };
}
