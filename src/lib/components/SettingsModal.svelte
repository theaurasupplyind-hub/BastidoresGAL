<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { zoomStore } from '$lib/stores/zoomStore.svelte';
  import type { AppConfig } from '$lib/types';

  let config = $state<AppConfig>({
    theme: 'flatly',
    font_size: 10,
    hotkey_save: 'F12',
    hotkey_new: 'F4',
    selected_template_name: 'Original',
    selected_template_file: 'invoice_template.html',
    selected_printer: null,
    sort_dims_enabled: true,
    moldura_merged: false,
  });

  let initialPercent = 100;
  let loading = $state(true);
  let printers = $state<string[]>([]);
  let loadingPrinters = $state(true);

  onMount(async () => {
    try {
      config = await invoke<AppConfig>('get_config');
    } catch { }
    loading = false;

    try {
      printers = await invoke<string[]>('list_printers');
    } catch {
      printers = [];
    }
    loadingPrinters = false;

    initialPercent = zoomStore.percent;
  });

  // El zoom se aplica al instante; si se cancela, se vuelve al valor de entrada.
  function cancel() {
    zoomStore.setPercent(initialPercent);
    appStore.showSettings = false;
  }

  async function save() {
    try {
      await invoke('save_config', { config });
      appStore.pdfStyle = config.selected_template_name;
      appStore.sortDimsEnabled = config.sort_dims_enabled ?? true;
      appStore.molduraMerged = config.moldura_merged ?? false;
      initialPercent = zoomStore.percent;
      appStore.showToast('Configuración guardada');
      appStore.showSettings = false;
    } catch (e) {
      appStore.showToast(String(e), 'error');
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="overlay" role="dialog" onclick={cancel}>
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()} role="document">
    <div class="modal-header">
      <h2>Configuración</h2>
      <button class="close" onclick={cancel}>✕</button>
    </div>

    {#if loading}
      <p class="loading">Cargando...</p>
    {:else}
      <div class="form-grid">
        <span class="zoom-label">Zoom de la interfaz</span>
        <div class="zoom-row">
          <button class="zoom-step-btn" onclick={() => zoomStore.zoomOut()} disabled={!zoomStore.canZoomOut} title="Alejar">A−</button>
          <span class="zoom-pct">{zoomStore.percent}%</span>
          <button class="zoom-step-btn" onclick={() => zoomStore.zoomIn()} disabled={!zoomStore.canZoomIn} title="Acercar">A+</button>
          <button class="zoom-reset-btn" onclick={() => zoomStore.reset()} disabled={zoomStore.percent === 100}>100%</button>
        </div>

        <span class="zoom-label">Lupa</span>
        <div class="zoom-row">
          <button class="zoom-toggle-btn" class:active={zoomStore.lupa} onclick={() => zoomStore.toggleLupa()}>
            {zoomStore.lupa ? 'Lupa activada' : 'Activar lupa'}
          </button>
          <span class="zoom-note">Mantené apretado el clic para ampliar.</span>
        </div>

        <label>Diseño Factura</label>
        <select bind:value={config.selected_template_name}>
          <option value="Original">Original</option>
          <option value="Original test">Original test</option>
          <option value="Moderno">Moderno</option>
          <option value="Clasico">Clásico</option>
        </select>

        <label>Tecla Guardar</label>
        <input type="text" bind:value={config.hotkey_save} />

        <label>Tecla Nueva Factura</label>
        <input type="text" bind:value={config.hotkey_new} />

        <label>Ordenar medidas</label>
        <label class="check-row">
          <input type="checkbox" bind:checked={config.sort_dims_enabled} />
          <span>Menor x mayor al pegar o salir del campo</span>
        </label>

        <label>Molduras V2</label>
        <label class="check-row">
          <input type="checkbox" bind:checked={config.moldura_merged} />
          <span>Consolidar varillas iguales de bastidores sin larguero/travesaño (2×45 + 2×45 → 4×45)</span>
        </label>

        <label>Impresora</label>
        {#if loadingPrinters}
          <select disabled><option>Cargando...</option></select>
        {:else if printers.length === 0}
          <select disabled><option>No se detectaron impresoras</option></select>
        {:else}
          <select bind:value={config.selected_printer}>
            <option value={null}>Usar default del sistema</option>
            {#each printers as p}
              <option value={p}>{p}</option>
            {/each}
          </select>
        {/if}
      </div>

      <div class="modal-actions">
        <button class="btn-primary" onclick={save}>Guardar</button>
        <button class="btn-secondary" onclick={cancel}>Cancelar</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.4);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: var(--bg-card); border-radius: 0.857rem; padding: 1.714rem;
    width: 28.571rem; max-height: 80vh; overflow-y: auto;
    box-shadow: 0 0.571rem 2.286rem rgba(0,0,0,0.2);
    color: var(--text-primary);
  }
  .modal-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 1.429rem;
  }
  .modal-header h2 { margin: 0; font-size: 1.286rem; }
  .close { background: none; border: none; font-size: 1.429rem; cursor: pointer; color: var(--text-muted); }
  .form-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 0.857rem;
  }
  label { font-size: 0.929rem; color: var(--text-secondary); align-self: center; }
  select, input {
    padding: 0.571rem; border: 1px solid var(--border); border-radius: 0.429rem; font-size: 0.929rem;
    background: var(--bg-card); color: var(--text-primary);
  }
  .modal-actions {
    display: flex; gap: 0.571rem; justify-content: flex-end; margin-top: 1.429rem;
  }
  .btn-primary {
    padding: 0.571rem 1.429rem; background: var(--accent); color: white; border: none;
    border-radius: 0.429rem; cursor: pointer; font-weight: 500;
  }
  .btn-secondary {
    padding: 0.571rem 1.429rem; background: var(--bg-hover); color: var(--text-secondary); border: none;
    border-radius: 0.429rem; cursor: pointer;
  }
  .loading { text-align: center; color: var(--text-muted); padding: 1.429rem; }

  .check-row {
    display: flex; align-items: center; gap: 0.5rem;
    font-size: 0.929rem; color: var(--text-secondary); cursor: pointer;
  }
  .check-row input { width: 1rem; height: 1rem; accent-color: var(--accent); cursor: pointer; }
  .zoom-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .zoom-step-btn {
    min-width: 2.4rem;
    height: 2.2rem;
    padding: 0 0.6rem;
    border: 1px solid var(--border);
    border-radius: 0.429rem;
    background: var(--bg-card);
    color: var(--text-primary);
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
  }
  .zoom-step-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .zoom-step-btn:disabled { opacity: 0.35; cursor: default; }
  .zoom-pct {
    min-width: 3rem;
    font-size: 0.929rem;
    font-weight: 700;
    color: var(--accent);
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .zoom-reset-btn {
    padding: 0 0.65rem;
    height: 2.2rem;
    border: 1px solid var(--border);
    border-radius: 0.429rem;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.8rem;
    cursor: pointer;
  }
  .zoom-reset-btn:disabled { opacity: 0.35; cursor: default; }
  .zoom-label {
    align-self: center;
    font-size: 0.929rem;
    color: var(--text-secondary);
  }  .zoom-toggle-btn {
    padding: 0 0.9rem;
    height: 2.2rem;
    border: 1px solid var(--border);
    border-radius: 0.429rem;
    background: var(--bg-card);
    color: var(--text-primary);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .zoom-toggle-btn.active { background: var(--accent); border-color: var(--accent); color: #fff; }
  .zoom-note {
    flex: 1;
    min-width: 0;
    font-size: 0.72rem;
    color: var(--text-muted);
    line-height: 1.35;
  }
</style>
