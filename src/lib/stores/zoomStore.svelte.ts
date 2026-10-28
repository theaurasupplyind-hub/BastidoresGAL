import { getCurrentWebview } from '@tauri-apps/api/webview';

/**
 * Zoom de accesibilidad.
 *
 * El zoom global usa el factor nativo del WebView2 (`setZoom`), así escala TODO
 * (px, rem, imágenes, canvas) y reflowea como el navegador. El `--zoom` viejo
 * sólo agrandaba rem, por eso no servía.
 *
 * La lupa es un "peek": manteniendo el clic izquierdo se aplica un transform
 * sobre la superficie de la app con origen en el cursor, sin reflow y sin
 * capturar el puntero.
 */

const STORAGE_KEY = 'zoom-level';
const LUPA_TARGET = 2; // zoom total objetivo mientras se mantiene apretado

export const ZOOM_STEPS = [1, 1.1, 1.25, 1.5];
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

let _factor = $state(1);
let _lupa = $state(false);
let _holding = $state(false);
let _lupaScale = $state(1.8);
let installed = false;
let wheelLock = 0;
let nativeZoom = false;

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function clampZoom(v: number): number {
  if (!Number.isFinite(v)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v));
}

async function applyScale(factor: number) {
  if (isTauri()) {
    try {
      await getCurrentWebview().setZoom(factor);
      nativeZoom = true;
      return;
    } catch {
      // sin permiso o webview sin soporte: cae al fallback
    }
  }
  nativeZoom = false;
  // Fallback para `npm run dev` en un navegador normal.
  document.documentElement.style.zoom = factor === 1 ? '' : String(factor);
}

function syncAttributes(factor: number) {
  document.documentElement.toggleAttribute('data-zoom', factor > 1);
}

/**
 * La base tipográfica histórica dependía de `vw`, y al hacer zoom real el
 * viewport CSS se achica: el texto terminaba creciendo apenas ~14% a 150%.
 * Acá se calcula con el ancho *físico* de la ventana, así el zoom sí agranda
 * de verdad y de paso se mantiene la adaptación al tamaño de pantalla.
 */
function syncBaseFont() {
  const width = window.innerWidth || 1366;
  // Con el zoom nativo el viewport CSS se achica (innerWidth baja); con el
  // fallback de CSS `zoom` no. En ambos casos el ancho físico es el mismo.
  const physical = (nativeZoom ? _factor : 1) * width;
  const base = Math.min(18, Math.max(12, 4 + 0.0073 * physical));
  document.documentElement.style.fontSize = `${base.toFixed(2)}px`;
}

async function setZoom(value: number, persist = true) {
  const factor = clampZoom(value);
  _factor = factor;
  syncAttributes(factor);
  await applyScale(factor);
  if (persist) localStorage.setItem(STORAGE_KEY, String(factor));
  // Chart.js y Leaflet recalculan tamaño al recibir resize.
  requestAnimationFrame(() => {
    syncBaseFont();
    window.dispatchEvent(new Event('resize'));
    // El viewport nativo puede tardar un frame en reflejar el nuevo zoom.
    setTimeout(syncBaseFont, 150);
  });
}

function setLupa(on: boolean) {
  _lupa = on;
  document.documentElement.toggleAttribute('data-lupa-on', on);
  if (!on) endHold();
}

function updateOrigin(x: number, y: number) {
  document.documentElement.style.setProperty('--lupa-x', `${x}px`);
  document.documentElement.style.setProperty('--lupa-y', `${y}px`);
}

function startHold(x: number, y: number) {
  if (!_lupa) return;
  _lupaScale = Math.min(1.8, Math.max(1.25, LUPA_TARGET / _factor));
  _holding = true;
  document.documentElement.style.setProperty('--lupa-scale', String(_lupaScale));
  updateOrigin(x, y);
  document.documentElement.setAttribute('data-lupa-hold', '');
}

function moveHold(x: number, y: number) {
  if (!_holding) return;
  updateOrigin(x, y);
}

function endHold() {
  if (!_holding) return;
  _holding = false;
  document.documentElement.removeAttribute('data-lupa-hold');
}

function stepTo(direction: 1 | -1) {
  const idx = ZOOM_STEPS.findIndex((s) => s >= _factor - 0.001);
  const current = idx === -1 ? ZOOM_STEPS.length - 1 : idx;
  const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, current + direction))];
  if (next !== _factor) void setZoom(next);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && _lupa) {
    setLupa(false);
    return;
  }
  if (!e.ctrlKey || e.altKey) return;
  if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') {
    e.preventDefault();
    stepTo(1);
  } else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
    e.preventDefault();
    stepTo(-1);
  } else if (e.key === '0') {
    e.preventDefault();
    void setZoom(1);
  }
}

function onWheel(e: WheelEvent) {
  if (!e.ctrlKey) return;
  const target = e.target as HTMLElement | null;
  // Zonas con zoom propio: lista de precios y mapa.
  if (target?.closest?.('.image-area, .leaflet-container')) return;
  e.preventDefault();
  const now = Date.now();
  if (now < wheelLock) return;
  wheelLock = now + 140;
  stepTo(e.deltaY < 0 ? 1 : -1);
}

function installShortcuts() {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', onKeydown, true);
  window.addEventListener('wheel', onWheel, { passive: false, capture: true });
  window.addEventListener('resize', syncBaseFont);
}

export const zoomStore = {
  get factor() { return _factor; },
  get percent() { return Math.round(_factor * 100); },
  get lupa() { return _lupa; },
  get holding() { return _holding; },
  get lupaScale() { return _lupaScale; },
  get effectivePercent() { return Math.round(_factor * _lupaScale * 100); },
  get canZoomIn() { return _factor < MAX_ZOOM - 0.001; },
  get canZoomOut() { return _factor > MIN_ZOOM + 0.001; },

  async init() {
    installShortcuts();
    const saved = parseFloat(localStorage.getItem(STORAGE_KEY) ?? '');
    const factor = Number.isFinite(saved) ? clampZoom(saved) : MIN_ZOOM;
    // Si el valor guardado quedó fuera del rango nuevo, lo reescribimos.
    await setZoom(factor, Number.isFinite(saved) && saved !== factor);
  },

  zoomIn() { stepTo(1); },
  zoomOut() { stepTo(-1); },
  reset() { void setZoom(1); },
  setPercent(percent: number) { void setZoom(percent / 100); },

  toggleLupa() { setLupa(!_lupa); },
  enableLupa() { setLupa(true); },
  disableLupa() { setLupa(false); },

  startHold,
  moveHold,
  endHold,
};
