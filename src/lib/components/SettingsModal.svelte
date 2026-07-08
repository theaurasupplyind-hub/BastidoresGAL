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
  });

  let loading = $state(true);

  onMount(async () => {
    try {
      config = await invoke<AppConfig>('get_config');
    } catch { }
    loading = false;
  });

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
        <label>Tema Visual</label>
        <select bind:value={config.theme}>
          <option value="flatly">Flatly</option>
          <option value="darkly">Darkly</option>
          <option value="minty">Minty</option>
          <option value="cosmo">Cosmo</option>
          <option value="superhero">Superhero</option>
        </select>

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
          <option value="juli">Juli (sin materiales)</option>
        </select>
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
    background: white; border-radius: 0.857rem; padding: 1.714rem;
    width: 28.571rem; max-height: 80vh; overflow-y: auto;
    box-shadow: 0 0.571rem 2.286rem rgba(0,0,0,0.2);
  }
  .modal-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 1.429rem;
  }
  .modal-header h2 { margin: 0; font-size: 1.286rem; }
  .close { background: none; border: none; font-size: 1.429rem; cursor: pointer; color: #999; }
  .form-grid {
    display: grid; grid-template-columns: 1fr 1fr; gap: 0.857rem;
  }
  label { font-size: 0.929rem; color: #555; align-self: center; }
  select, input {
    padding: 0.571rem; border: 1px solid #ddd; border-radius: 0.429rem; font-size: 0.929rem;
  }
  .modal-actions {
    display: flex; gap: 0.571rem; justify-content: flex-end; margin-top: 1.429rem;
  }
  .btn-primary {
    padding: 0.571rem 1.429rem; background: #007bff; color: white; border: none;
    border-radius: 0.429rem; cursor: pointer; font-weight: 500;
  }
  .btn-secondary {
    padding: 0.571rem 1.429rem; background: #ecf0f1; color: #555; border: none;
    border-radius: 0.429rem; cursor: pointer;
  }
  .loading { text-align: center; color: #999; padding: 1.429rem; }
</style>
