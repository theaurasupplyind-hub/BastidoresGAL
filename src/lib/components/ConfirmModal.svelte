<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    open?: boolean;
    title?: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    danger?: boolean;
    busy?: boolean;
    onconfirm: () => void | Promise<void>;
    oncancel: () => void;
    children?: Snippet;
  }

  let {
    open = true,
    title = 'Confirmar',
    message = '',
    confirmText = 'Aceptar',
    cancelText = 'Cancelar',
    danger = false,
    busy = false,
    onconfirm,
    oncancel,
    children,
  }: Props = $props();

  let modalEl = $state<HTMLDivElement | null>(null);
  let working = $state(false);

  $effect(() => {
    if (open) modalEl?.focus();
  });

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') oncancel();
  }

  async function confirm() {
    if (working || busy) return;
    working = true;
    try {
      await onconfirm();
    } finally {
      working = false;
    }
  }
</script>

{#if open}
  <div class="confirm-overlay" role="presentation" onclick={oncancel}>
    <div
      class="confirm-modal"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      bind:this={modalEl}
      onclick={(e) => e.stopPropagation()}
      onkeydown={handleKey}
    >
      <div class="confirm-header">
        <h3>{title}</h3>
        <button class="confirm-close" type="button" onclick={oncancel} aria-label="Cerrar">✕</button>
      </div>
      <div class="confirm-body">
        {#if children}
          {@render children()}
        {:else if message}
          <p>{message}</p>
        {/if}
      </div>
      <div class="confirm-actions">
        <button class="btn btn-secondary" type="button" onclick={oncancel} disabled={working || busy}>{cancelText}</button>
        <button class="btn {danger ? 'btn-danger' : 'btn-primary'}" type="button" onclick={confirm} disabled={working || busy}>
          {confirmText}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .confirm-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    z-index: 1200;
  }
  .confirm-modal {
    background: var(--bg-card, #fff);
    color: var(--text-primary, #111827);
    border-radius: 0.857rem;
    width: min(28rem, 92vw);
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    box-shadow: 0 0.571rem 2.143rem rgba(0, 0, 0, 0.22);
  }
  .confirm-modal:focus { outline: none; }
  .confirm-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }
  .confirm-header h3 {
    margin: 0;
    font-size: 1.1rem;
    color: var(--text-primary, #111827);
  }
  .confirm-close {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted, #9ca3af);
    font-size: 1.143rem;
    padding: 0.286rem;
    border-radius: 0.286rem;
  }
  .confirm-close:hover { background: var(--bg-hover, #f0f2f5); color: var(--text-primary, #111827); }
  .confirm-body {
    color: var(--text-secondary, #4b5563);
    font-size: 0.95rem;
    line-height: 1.5;
  }
  .confirm-body :global(p) { margin: 0; }
  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.571rem;
    margin-top: 1.25rem;
  }
  .btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 0.429rem;
    font-size: 0.92rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: filter 0.15s, opacity 0.15s;
  }
  .btn:hover:not(:disabled) { filter: brightness(0.95); }
  .btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn-primary { background: var(--accent, #2563eb); color: #fff; }
  .btn-danger { background: var(--danger, #dc2626); color: #fff; }
  .btn-secondary { background: var(--bg-hover, #f0f2f5); color: var(--text-secondary, #4b5563); }
</style>
