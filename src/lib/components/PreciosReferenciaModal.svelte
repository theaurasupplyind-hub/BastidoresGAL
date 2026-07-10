<script lang="ts">
  import { onMount } from 'svelte';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { api } from '$lib/api/client';
  import type { PrecioReferencia } from '$lib/types';

  let rows: PrecioReferencia[] = $state([]);
  let csvText: string = $state('');
  let preview: PrecioReferencia[] = $state([]);
  let importing = $state(false);
  let message = $state('');
  let error = $state('');

  onMount(() => {
    loadCurrent();
  });

  async function loadCurrent() {
    try {
      rows = await api.getPreciosReferencia();
    } catch {
      rows = [];
    }
  }

  function handleFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    error = '';
    message = '';
    const reader = new FileReader();
    reader.onload = () => {
      csvText = reader.result as string;
      parseCSV(csvText);
    };
    reader.readAsText(file, 'UTF-8');
  }

  function parseCSV(text: string) {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) {
      error = 'El archivo debe tener al menos 2 lineas (header + datos)';
      return;
    }
    const header = lines[0].trim();
    const delimiter = header.includes(';') ? ';' : ',';
    const parsed: PrecioReferencia[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(delimiter);
      if (parts.length < 4) continue;
      const precio = parseFloat(parts[3].trim());
      if (isNaN(precio) || precio <= 0) continue;
      parsed.push({
        categoria: parts[0].trim().toUpperCase(),
        medida: (parts[1] || '').trim(),
        variante: (parts[2] || '').trim(),
        precio,
      });
    }
    if (parsed.length === 0) {
      error = 'No se encontraron filas validas (CATEGORIA;MEDIDA;VARIANTE;PRECIO)';
      return;
    }
    preview = parsed;
    message = `${parsed.length} registros listos para importar`;
  }

  async function doImport() {
    if (preview.length === 0) return;
    importing = true;
    error = '';
    message = '';
    try {
      const result = await api.importPreciosReferencia(preview);
      message = `Importados: ${result.imported} registros`;
      preview = [];
      csvText = '';
      await loadCurrent();
    } catch (e) {
      error = String(e);
    }
    importing = false;
  }
</script>

{#if appStore.showPreciosRef}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="overlay" onclick={() => appStore.showPreciosRef = false} role="dialog">
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="modal" onclick={(e) => e.stopPropagation()} role="document">
      <div class="modal-header">
        <h2>Precios de Referencia</h2>
        <button class="close" onclick={() => appStore.showPreciosRef = false}>X</button>
      </div>

      <div class="modal-body">
        <p class="help-text">
          Selecciona un archivo CSV con columnas: <b>CATEGORIA;MEDIDA;VARIANTE;PRECIO</b><br/>
          Categorias: BASTIDOR, ACRILICOS, CIRCULARES<br/>
          Medida bastidor: 60x80 | Acrilico: 60cc | Circular: 60<br/>
          Variante bastidor: Lienzo Profesional, Sin tela, Lona Preparada, Doble 4cm
        </p>

        <div class="file-area">
          <input type="file" accept=".csv" onchange={handleFile} class="file-input" id="csvFile" />
          <label for="csvFile" class="file-label">Seleccionar archivo CSV</label>
        </div>

        {#if error}
          <p class="err">{error}</p>
        {/if}
        {#if message && !error}
          <p class="ok">{message}</p>
        {/if}

        {#if preview.length > 0}
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Categoria</th>
                  <th>Medida</th>
                  <th>Variante</th>
                  <th>Precio</th>
                </tr>
              </thead>
              <tbody>
                {#each preview.slice(0, 50) as r}
                  <tr>
                    <td>{r.categoria}</td>
                    <td>{r.medida}</td>
                    <td>{r.variante || '-'}</td>
                    <td class="num">${r.precio.toLocaleString('es-AR')}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
            {#if preview.length > 50}
              <p class="more">... y {preview.length - 50} mas</p>
            {/if}
          </div>

          <button class="btn btn-primary" onclick={doImport} disabled={importing}>
            {importing ? 'Importando...' : `Importar ${preview.length} registros`}
          </button>
        {/if}

        {#if rows.length > 0}
          <hr />
          <p class="status">Actualmente: <b>{rows.length}</b> precios cargados</p>
          <div class="table-wrap mini">
            <table>
              <thead>
                <tr>
                  <th>Categoria</th>
                  <th>Medida</th>
                  <th>Variante</th>
                  <th>Precio</th>
                </tr>
              </thead>
              <tbody>
                {#each rows.slice(0, 20) as r}
                  <tr>
                    <td>{r.categoria}</td>
                    <td>{r.medida}</td>
                    <td>{r.variante || '-'}</td>
                    <td class="num">${r.precio?.toLocaleString('es-AR')}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
            {#if rows.length > 20}
              <p class="more">... y {rows.length - 20} mas</p>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.45);
    display: flex; align-items: center; justify-content: center; z-index: 9999;
  }
  .modal {
    background: #ffffff; border-radius: 0.571rem; box-shadow: 0 0.286rem 1.143rem rgba(0,0,0,0.25);
    min-width: 34rem; max-width: 92vw; max-height: 85vh; display: flex; flex-direction: column;
  }
  .modal-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 0.857rem 1.143rem; border-bottom: 0.071rem solid #e0e0e0;
  }
  .modal-header h2 { margin: 0; font-size: 1.143rem; color: #2c3e50; }
  .close {
    background: none; border: none; font-size: 1.143rem; cursor: pointer;
    color: #999; padding: 0.286rem 0.571rem; border-radius: 0.286rem;
  }
  .close:hover { background: #f0f0f0; color: #333; }
  .modal-body { padding: 1.143rem; overflow-y: auto; }
  .help-text { font-size: 0.857rem; color: #666; margin-bottom: 0.857rem; line-height: 1.5; }
  .file-area { margin-bottom: 0.857rem; }
  .file-input { display: none; }
  .file-label {
    display: inline-block; padding: 0.571rem 1.143rem; background: #007bff; color: #fff;
    border-radius: 0.357rem; cursor: pointer; font-size: 0.929rem;
  }
  .file-label:hover { opacity: 0.9; }
  .err { color: #c0392b; font-size: 0.857rem; margin: 0.571rem 0; }
  .ok { color: #27ae60; font-size: 0.857rem; margin: 0.571rem 0; }
  .status { font-size: 0.857rem; color: #555; margin: 0.571rem 0; }
  .table-wrap { max-height: 21rem; overflow-y: auto; margin: 0.571rem 0; border: 0.071rem solid #e0e0e0; border-radius: 0.286rem; }
  .table-wrap.mini { max-height: 14rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.857rem; }
  th { background: #f8f9fa; padding: 0.5rem 0.571rem; text-align: left; position: sticky; top: 0; font-weight: 600; color: #555; }
  td { padding: 0.357rem 0.571rem; border-bottom: 0.071rem solid #eee; }
  .num { text-align: right; white-space: nowrap; }
  .more { font-size: 0.786rem; color: #999; text-align: center; margin: 0.286rem 0; }
  hr { border: none; border-top: 0.071rem solid #eee; margin: 0.857rem 0; }
  .btn { padding: 0.571rem 1.143rem; border-radius: 0.357rem; border: none; cursor: pointer; font-size: 0.929rem; font-weight: 600; }
  .btn-primary { background: #007bff; color: #fff; }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary { padding: 0.571rem 1.286rem; background: #ecf0f1; color: #555; border: none; border-radius: 0.429rem; cursor: pointer; font-size: 0.929rem; }
</style>
