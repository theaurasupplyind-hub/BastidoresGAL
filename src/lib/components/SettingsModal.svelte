<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { appStore } from '$lib/stores/appStore.svelte';
  import type { AppConfig } from '$lib/types';

  let config = $state<AppConfig>({
    theme: 'flatly',
    font_size: 10,
    hotkey_save: 'F12',
    hotkey_new: 'F4',
    selected_template_name: 'Original',
    selected_template_file: 'invoice_template.html',
    moldura_template: 'clasico',
    selected_printer: null,
  });

  let darkMode = $state(false);
  let zoomLevel = $state(1);
  let zoomPercent = $state(100);
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

    const saved = localStorage.getItem('theme-dark');
    darkMode = saved === 'true';
    applyTheme();
    const savedZoom = localStorage.getItem('zoom-level');
    if (savedZoom) {
      const f = parseFloat(savedZoom);
      if (f) {
        zoomLevel = f;
        zoomPercent = Math.round(f * 100);
      }
    }
  });

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }

  function toggleDark() {
    darkMode = !darkMode;
    localStorage.setItem('theme-dark', String(darkMode));
    applyTheme();
  }

  function applyZoom() {
    const factor = zoomPercent / 100;
    zoomLevel = factor;
    document.documentElement.style.setProperty('--zoom', String(factor));
    if (factor === 1) {
      document.documentElement.removeAttribute('data-zoom');
    } else {
      document.documentElement.setAttribute('data-zoom', 'true');
    }
    localStorage.setItem('zoom-level', String(factor));
  }

  function handleZoom(e: Event) {
    zoomPercent = parseInt((e.target as HTMLInputElement).value);
    applyZoom();
  }

  async function save() {
    try {
      await invoke('save_config', { config });
      appStore.pdfStyle = config.selected_template_name;
      appStore.molduraTemplate = config.moldura_template;
      appStore.showToast('Configuración guardada');
    } catch (e) {
      appStore.showToast(String(e), 'error');
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="overlay" onclick={() => appStore.showSettings = false} role="dialog">
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal" onclick={(e) => e.stopPropagation()} role="document">
    <div class="modal-header">
      <h2>Configuración</h2>
      <button class="close" onclick={() => appStore.showSettings = false}>✕</button>
    </div>

    {#if loading}
      <p class="loading">Cargando...</p>
    {:else}
      <div class="form-grid">
        <label>Tema Oscuro</label>
        <button class="toggle-btn" class:active={darkMode} onclick={toggleDark} type="button">
          <span class="toggle-track">
            <span class="toggle-thumb"></span>
          </span>
          <span class="toggle-label">{darkMode ? 'On' : 'Off'}</span>
        </button>

        <label>Zoom</label>
        <div class="zoom-row">
          <input type="range" min="100" max="250" value={zoomPercent} oninput={handleZoom} class="zoom-slider" />
          <span class="zoom-pct">{zoomPercent}%</span>
        </div>

<label>Diseño Factura</label>
        <select bind:value={config.selected_template_name}>
          <option value="Original">Original</option>
          <option value="Moderno">Moderno</option>
          <option value="Clasico">Clásico</option>
        </select>

        <label>Tecla Guardar</label>
        <input type="text" bind:value={config.hotkey_save} />

        <label>Tecla Nueva Factura</label>
        <input type="text" bind:value={config.hotkey_new} />

        <label>Estilo Molduras</label>
        <select bind:value={config.moldura_template}>
          <option value="clasico">Clásico (con materiales)</option>
          <option value="clasico-modificado">Clásico (Modificado)</option>
          <option value="juli">Juli (sin materiales)</option>
        </select>

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
        <button class="btn-secondary" onclick={() => appStore.showSettings = false}>Cancelar</button>
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

  .toggle-btn {
    display: flex; align-items: center; gap: 0.5rem; background: none; border: none;
    cursor: pointer; padding: 0; font-size: 0.85rem; color: var(--text-secondary);
  }
  .toggle-track {
    width: 2.4rem; height: 1.3rem; background: var(--border); border-radius: 0.65rem;
    position: relative; transition: background 0.2s;
  }
  .toggle-btn.active .toggle-track { background: var(--accent); }
  .toggle-thumb {
    position: absolute; top: 0.15rem; left: 0.15rem;
    width: 1rem; height: 1rem; background: white; border-radius: 50%;
    transition: transform 0.2s;
  }
  .toggle-btn.active .toggle-thumb { transform: translateX(1.1rem); }
  .toggle-label { font-weight: 500; }
  .zoom-row {
    display: flex;
    align-items: center;
    gap: 0.714rem;
  }
  .zoom-slider {
    flex: 1;
    accent-color: var(--accent);
    height: 1.5rem;
    cursor: pointer;
  }
  .zoom-pct {
    font-size: 0.929rem;
    font-weight: 600;
    color: var(--accent);
    min-width: 3rem;
    text-align: right;
  }
</style>
