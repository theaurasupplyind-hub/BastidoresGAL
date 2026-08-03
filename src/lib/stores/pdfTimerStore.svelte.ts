let _visible = $state(false);
let _active = $state(false);
let _label = $state('');
let _fallback = $state(false);
let _startedAt = $state(0);
let _elapsedMs = $state(0);
let _finalMs = $state<number | null>(null);
let _ok = $state<boolean | null>(null);

export const pdfTimer = {
  get visible() { return _visible; },
  get active() { return _active; },
  get label() { return _label; },
  get fallback() { return _fallback; },
  get elapsedMs() { return _elapsedMs; },
  get finalMs() { return _finalMs; },
  get ok() { return _ok; },
};

export function startPdfTimer(label: string) {
  _visible = true;
  _active = true;
  _label = label;
  _fallback = false;
  _startedAt = performance.now();
  _elapsedMs = 0;
  _finalMs = null;
  _ok = null;
}

export function setPdfTimerFallback(fallback: boolean) {
  _fallback = fallback;
}

export function tickPdfTimer() {
  _elapsedMs = performance.now() - _startedAt;
}

export function endPdfTimer(ok: boolean) {
  _active = false;
  _finalMs = performance.now() - _startedAt;
  _ok = ok;
  setTimeout(() => {
    if (!_active) {
      _visible = false;
    }
  }, 1200);
}

export function hidePdfTimer() {
  _visible = false;
}
