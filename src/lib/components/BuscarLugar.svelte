<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { appStore } from '$lib/stores/appStore.svelte';

  let {
    query = '',
    label = 'Buscar en Maps',
    className = '',
  }: {
    query?: string;
    label?: string;
    className?: string;
  } = $props();

  let opening = $state(false);

  async function open() {
    const raw = (query || '').trim();
    const q = raw; // label solo es texto del botón, no fallback de query
    console.log('[BuscarLugar] click', { query, label, q, rawEmpty: !raw });
    opening = true;
    const t = setTimeout(() => {
      if (opening) {
        console.warn('[BuscarLugar] timeout 5s sin respuesta de Rust');
        appStore.showToast('Maps no respondió (timeout). Revisá la consola.', 'error');
        opening = false;
      }
    }, 5000);
    try {
      console.log('[BuscarLugar] invoking open_maps_picker', { q });
      await invoke('open_maps_picker', { query: q });
      console.log('[BuscarLugar] open_maps_picker OK');
    } catch (e: any) {
      const msg = e?.message || (typeof e === 'string' ? e : JSON.stringify(e));
      console.error('[BuscarLugar] open_maps_picker FAILED', e);
      appStore.showToast('Error al abrir Google Maps: ' + msg, 'error');
    } finally {
      clearTimeout(t);
      console.log('[BuscarLugar] opening -> false');
      opening = false;
    }
  }
</script>

<button
  type="button"
  class="btn-buscar-lugar {className}"
  onclick={open}
  disabled={opening}
  title="Abrir Google Maps en una ventana hija a la derecha con la búsqueda precargada"
>
  {#if opening}
    ⏳ Abriendo...
  {:else}
    🔍 {label}
  {/if}
</button>

<style>
  .btn-buscar-lugar {
    padding: 0.5rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-primary);
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
  }
  .btn-buscar-lugar:hover {
    border-color: var(--accent);
    background: var(--accent-light);
    color: var(--accent);
  }
  .btn-buscar-lugar:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
