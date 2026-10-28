<script lang="ts">
  import { zoomStore } from '$lib/stores/zoomStore.svelte';

  let cx = $state(-999);
  let cy = $state(-999);
  let seen = $state(false);

  // Mientras se mantiene la lupa, se anulan los eventos de mouse para que el
  // gesto de ampliar no dispare clicks, selección de texto ni drag.
  let blocking = false;

  // La barra superior queda fuera de la lupa para poder apagarla.
  function ignored(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    return !!el?.closest?.('.titlebar, [data-lupa-ignore]');
  }

  function onPointerDown(e: PointerEvent) {
    if (!zoomStore.lupa || e.button !== 0 || ignored(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    blocking = true;
    try {
      (e.target as Element | null)?.setPointerCapture?.(e.pointerId);
    } catch { }
    zoomStore.startHold(e.clientX, e.clientY);
  }

  function onPointerMove(e: PointerEvent) {
    if (!zoomStore.lupa) return;
    seen = true;
    cx = e.clientX;
    cy = e.clientY;
    zoomStore.moveHold(e.clientX, e.clientY);
  }

  function onPointerUp() {
    if (!zoomStore.holding) return;
    zoomStore.endHold();
    setTimeout(() => { blocking = false; }, 80);
  }

  function swallow(e: Event) {
    if (!blocking) return;
    e.preventDefault();
    e.stopPropagation();
  }

  // Los eventos de compatibilidad se cortan en captura: el elemento de abajo
  // nunca los ve.
  function onSwallow(e: Event) {
    if (!blocking) return;
    swallow(e);
    if (e.type === 'click') blocking = false;
  }
</script>

<svelte:window
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  onblur={onPointerUp}
  onmousedowncapture={onSwallow}
  onclickcapture={onSwallow}
  ondblclickcapture={onSwallow}
  oncontextmenucapture={onSwallow}
/>

{#if zoomStore.lupa}
  {#if seen && !zoomStore.holding}
    <div class="lupa-lens" style="left:{cx}px; top:{cy}px" aria-hidden="true"></div>
  {/if}
  <div class="lupa-hint" data-lupa-ignore role="status">
    {#if zoomStore.holding}
      Lupa {zoomStore.effectivePercent}%
    {:else}
      Mantené apretado para ampliar · Esc para salir
    {/if}
  </div>
{/if}

<style>
  .lupa-lens {
    position: fixed;
    width: 190px;
    height: 190px;
    margin-left: -95px;
    margin-top: -95px;
    border-radius: 50%;
    border: 2px solid rgba(37, 99, 235, 0.85);
    box-shadow:
      0 0 0 1px rgba(255, 255, 255, 0.75) inset,
      0 6px 20px rgba(0, 0, 0, 0.18);
    pointer-events: none;
    z-index: 99998;
  }
  .lupa-hint {
    position: fixed;
    left: 50%;
    bottom: 1.25rem;
    transform: translateX(-50%);
    padding: 0.55rem 1.1rem;
    border-radius: 999px;
    background: rgba(17, 24, 39, 0.92);
    color: #fff;
    font-family: system-ui, sans-serif;
    font-size: 0.95rem;
    font-weight: 600;
    letter-spacing: 0.01em;
    white-space: nowrap;
    pointer-events: none;
    z-index: 99999;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
  }
</style>
