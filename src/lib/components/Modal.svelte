<script lang="ts">
  import { tick, onDestroy, type Snippet } from 'svelte';

  interface Props {
    open: boolean;
    title: string;
    subtitle?: string;
    size?: 'sm' | 'md' | 'lg';
    busy?: boolean;
    closeOnBackdrop?: boolean;
    closeOnEscape?: boolean;
    onclose: () => void;
    children: Snippet;
    footer?: Snippet;
  }

  let {
    open,
    title,
    subtitle = '',
    size = 'md',
    busy = false,
    closeOnBackdrop = true,
    closeOnEscape = true,
    onclose,
    children,
    footer,
  }: Props = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;

  let dialogEl = $state<HTMLDivElement | null>(null);
  let previousFocus: HTMLElement | null = null;
  let previousOverflow = '';
  let restoreScroll = 0;

  const FOCUSABLE = [
    'a[href]',
    'area[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    'iframe',
    'object',
    'embed',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',');

  function focusables(): HTMLElement[] {
    if (!dialogEl) return [];
    return Array.from(dialogEl.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => {
      if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }

  function onKeydown(event: KeyboardEvent) {
    if (!open) return;

    if (event.key === 'Escape' && closeOnEscape && !busy) {
      event.preventDefault();
      onclose();
      return;
    }

    if (event.key !== 'Tab') return;

    const items = focusables();
    if (items.length === 0) {
      event.preventDefault();
      dialogEl?.focus({ preventScroll: true });
      return;
    }

    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const inside = active instanceof Node && dialogEl?.contains(active);

    if (event.shiftKey && (active === first || !inside)) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && (active === last || !inside)) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }

  function onBackdrop(event: MouseEvent) {
    if (!closeOnBackdrop || busy) return;
    if (event.target !== event.currentTarget) return;
    onclose();
  }

  $effect(() => {
    if (!open) return;

    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousOverflow = document.body.style.overflow;
    restoreScroll = window.scrollY;
    document.body.style.overflow = 'hidden';

    tick().then(() => {
      if (!dialogEl) return;
      const preferred = dialogEl.querySelector<HTMLElement>('[data-autofocus]');
      (preferred ?? focusables()[0] ?? dialogEl).focus({ preventScroll: true });
    });

    return () => {
      document.body.style.overflow = previousOverflow;
      if (restoreScroll) window.scrollTo(0, restoreScroll);
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      previousFocus = null;
    };
  });

  onDestroy(() => {
    if (document.body.style.overflow === 'hidden') document.body.style.overflow = previousOverflow;
  });

  function onDialogPointerDown(event: PointerEvent) {
    // Evita que un click en el fondo que empezó dentro del diálogo lo cierre.
    if (event.target === event.currentTarget) event.stopPropagation();
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal-overlay modal-base-overlay" role="presentation" onclick={onBackdrop}>
    <div
      class="modal-base modal-{size}"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabindex="-1"
      bind:this={dialogEl}
      onpointerdown={onDialogPointerDown}
      onclick={(e) => e.stopPropagation()}
    >
      <header class="modal-base-header">
        <div class="modal-base-heading">
          <h2 id={titleId}>{title}</h2>
          {#if subtitle}
            <p class="modal-base-subtitle">{subtitle}</p>
          {/if}
        </div>
        <button class="modal-base-close" type="button" onclick={onclose} aria-label="Cerrar" disabled={busy}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </header>

      <div class="modal-base-body">
        {@render children()}
      </div>

      {#if footer}
        <footer class="modal-base-footer">
          {@render footer()}
        </footer>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-base-overlay {
    z-index: 1300;
    padding: 1.5rem;
    animation: modal-base-fade 140ms ease-out;
  }

  .modal-base {
    display: flex;
    flex-direction: column;
    width: min(30rem, 100%);
    max-height: min(85vh, 46rem);
    min-height: 0;
    overflow: hidden;
    border-radius: 0.857rem;
    background: var(--bg-card);
    color: var(--text-primary);
    box-shadow: var(--shadow-lg);
    animation: modal-base-in 160ms ease-out;
  }

  .modal-base.modal-sm { width: min(24rem, 100%); }
  .modal-base.modal-lg { width: min(40rem, 100%); }

  .modal-base-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 1.143rem 1.429rem 0.571rem;
  }

  .modal-base-heading {
    min-width: 0;
  }

  .modal-base-heading h2 {
    margin: 0;
    font-size: 1.143rem;
    line-height: 1.3;
    color: var(--text-primary);
  }

  .modal-base-subtitle {
    margin: 0.214rem 0 0;
    font-size: 0.86rem;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }

  .modal-base-close {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 1.857rem;
    height: 1.857rem;
    padding: 0;
    border: none;
    border-radius: 0.429rem;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }

  .modal-base-close:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .modal-base-close:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .modal-base-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0.429rem 1.429rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.857rem;
  }

  .modal-base-footer {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 0.571rem;
    padding: 0.857rem 1.429rem 1.143rem;
    border-top: 1px solid var(--border-light);
  }

  @keyframes modal-base-fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes modal-base-in {
    from { opacity: 0; transform: translateY(0.429rem) scale(0.985); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }

  @media (prefers-reduced-motion: reduce) {
    .modal-base-overlay, .modal-base { animation: none; }
  }

  @media (max-width: 640px) {
    .modal-base-overlay { padding: 0.75rem; align-items: flex-end; }
    .modal-base { width: 100%; max-height: 92vh; }
  }
</style>
