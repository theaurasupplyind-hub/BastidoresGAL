<script lang="ts">
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import type { Cliente } from '$lib/types';

  let { show, clientes, onclose, onsaved }: {
    show: boolean;
    clientes: Cliente[];
    onclose: () => void;
    onsaved?: () => void;
  } = $props();

  let targetId = $state<number | null>(null);
  let sourceIds = $state<number[]>([]);

  let targetSearch = $state('');
  let sourceSearch = $state('');

  let merging = $state(false);
  let stepText = $state('');

  const filteredDestino = $derived(
    targetSearch
      ? clientes.filter(c =>
          c.nombre.toLowerCase().includes(targetSearch.toLowerCase()) ||
          c.telefono.includes(targetSearch)
        )
      : []
  );

  const filteredOrigen = $derived(
    sourceSearch
      ? clientes.filter(c =>
          c.id !== targetId &&
          !sourceIds.includes(c.id) &&
          (c.nombre.toLowerCase().includes(sourceSearch.toLowerCase()) ||
           c.telefono.includes(sourceSearch))
        )
      : []
  );

  const targetCliente = $derived(clientes.find(c => c.id === targetId) ?? null);
  const sourceClientes = $derived(clientes.filter(c => sourceIds.includes(c.id)));

  function selectTarget(c: Cliente) {
    targetId = c.id;
    targetSearch = '';
  }

  function addSource(c: Cliente) {
    sourceIds = [...sourceIds, c.id];
    sourceSearch = '';
  }

  function removeSource(id: number) {
    sourceIds = sourceIds.filter(s => s !== id);
  }

  async function doMerge() {
    if (!targetId || sourceIds.length === 0) return;
    if (!confirm(`¿Fusionar ${sourceIds.length} cliente(s) en "${targetCliente?.nombre}"?\n\nSe transferirán todas sus facturas y direcciones.\nLos clientes origen serán eliminados.`)) return;
    merging = true;
    stepText = 'Buscando facturas...';
    try {
      await api.mergeClients(sourceIds, targetId);
      appStore.showToast(`Fusionados ${sourceIds.length} cliente(s) en "${targetCliente?.nombre}"`, 'success');
      sourceIds = [];
      targetId = null;
      onsaved?.();
    } catch (e) {
      appStore.showToast(String(e), 'error');
    } finally {
      merging = false;
      stepText = '';
    }
  }

  function handleClose() {
    targetId = null;
    sourceIds = [];
    targetSearch = '';
    sourceSearch = '';
    onclose();
  }
</script>

{#if show}
  <div class="overlay" onclick={handleClose} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Fusionar clientes">
      <div class="modal-header">
        <h3>Fusionar Clientes</h3>
        <button class="close-btn" onclick={handleClose} aria-label="Cerrar">&times;</button>
      </div>

      <div class="modal-body">
        <!-- Cliente destino -->
        <div class="field-group">
          <label>Cliente destino (se conserva)</label>
          {#if targetCliente}
            <div class="selected-tag destino">
              <span><strong>{targetCliente.nombre}</strong> &mdash; {targetCliente.telefono}</span>
              <button class="remove-btn" onclick={() => { targetId = null; }} aria-label="Quitar destino">&times;</button>
            </div>
          {:else}
            <input type="text" placeholder="Buscar cliente destino..." bind:value={targetSearch} />
            {#if targetSearch && filteredDestino.length > 0}
              <div class="dropdown">
                {#each filteredDestino as c (c.id)}
                  <button class="drop-item" onclick={() => selectTarget(c)}>
                    <span class="drop-name">{c.nombre}</span>
                    <span class="drop-info">{c.telefono} &middot; {c.domicilio}</span>
                  </button>
                {/each}
              </div>
            {/if}
          {/if}
        </div>

        <!-- Clientes a fusionar -->
        <div class="field-group">
          <label>Clientes a fusionar (se eliminarán)</label>
          <input type="text" placeholder="Buscar y agregar cliente..." bind:value={sourceSearch} />
          {#if sourceSearch && filteredOrigen.length > 0}
            <div class="dropdown">
              {#each filteredOrigen as c (c.id)}
                <button class="drop-item" onclick={() => addSource(c)}>
                  <span class="drop-name">{c.nombre}</span>
                  <span class="drop-info">{c.telefono} &middot; {c.domicilio}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Lista de origenes seleccionados -->
        {#if sourceClientes.length > 0}
          <div class="source-list">
            <label>Clientes a fusionar ({sourceClientes.length})</label>
            {#each sourceClientes as c (c.id)}
              <div class="selected-tag origen">
                <span><strong>{c.nombre}</strong> &mdash; {c.telefono}</span>
                <button class="remove-btn" onclick={() => removeSource(c.id)} aria-label="Quitar">&times;</button>
              </div>
            {/each}
          </div>
        {/if}

        <!-- Resumen -->
        {#if targetCliente && sourceClientes.length > 0}
          <div class="summary">
            <p><strong>Destino:</strong> {targetCliente.nombre}</p>
            <p><strong>Orígenes:</strong> {sourceClientes.length} cliente(s)</p>
          </div>
        {/if}
      </div>

      <div class="modal-footer">
        <button class="btn-cancel" onclick={handleClose} disabled={merging}>Cancelar</button>
        <button class="btn-primary" onclick={doMerge} disabled={!targetId || sourceIds.length === 0 || merging}>
          {merging ? stepText || 'Fusionando...' : 'Fusionar'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.4);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: var(--bg-card, #fff); border-radius: 0.714rem;
    width: 520px; max-width: 95vw; max-height: 85vh;
    display: flex; flex-direction: column;
    box-shadow: 0 0.571rem 1.429rem rgba(0,0,0,0.2);
  }
  .modal-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 1rem 1.286rem; border-bottom: 1px solid var(--border, #ddd);
  }
  .modal-header h3 { margin: 0; font-size: 1.143rem; }
  .close-btn {
    background: none; border: none; font-size: 1.429rem; cursor: pointer;
    line-height: 1; padding: 0 0.286rem;
  }
  .modal-body {
    padding: 1.286rem; overflow-y: auto; flex: 1;
  }
  .field-group {
    margin-bottom: 1rem;
  }
  .field-group label {
    display: block; font-size: 0.857rem; font-weight: 600;
    color: var(--text-secondary, #666); margin-bottom: 0.429rem;
  }
  .field-group input {
    width: 100%; padding: 0.571rem 0.857rem;
    border: 1px solid var(--border, #ddd); border-radius: 0.429rem;
    font-size: 0.929rem; box-sizing: border-box;
  }
  .dropdown {
    border: 1px solid var(--border, #ddd); border-radius: 0.429rem;
    max-height: 200px; overflow-y: auto; margin-top: 0.286rem;
  }
  .drop-item {
    display: flex; flex-direction: column; align-items: flex-start;
    width: 100%; padding: 0.571rem 0.857rem;
    border: none; border-bottom: 1px solid var(--border-light, #eee);
    background: var(--bg-card, #fff); cursor: pointer; text-align: left;
    font-size: 0.929rem;
  }
  .drop-item:last-child { border-bottom: none; }
  .drop-item:hover { background: var(--bg-hover, #f5f5f5); }
  .drop-name { font-weight: 500; }
  .drop-info { font-size: 0.786rem; color: var(--text-muted, #999); }
  .selected-tag {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.571rem 0.857rem;
    border-radius: 0.429rem; font-size: 0.929rem;
  }
  .selected-tag.destino { background: #e8f5e9; border: 1px solid #c8e6c9; }
  .selected-tag.origen { background: #fff3e0; border: 1px solid #ffe0b2; }
  .remove-btn {
    background: none; border: none; font-size: 1.143rem;
    cursor: pointer; line-height: 1; padding: 0 0.286rem;
    color: var(--text-muted, #999);
  }
  .remove-btn:hover { color: #c00; }
  .source-list { margin-bottom: 1rem; }
  .source-list label {
    display: block; font-size: 0.857rem; font-weight: 600;
    color: var(--text-secondary, #666); margin-bottom: 0.429rem;
  }
  .source-list .selected-tag { margin-bottom: 0.286rem; }
  .summary {
    background: var(--bg-page, #f9f9f9); border-radius: 0.429rem;
    padding: 0.857rem; font-size: 0.929rem;
  }
  .summary p { margin: 0.286rem 0; }
  .modal-footer {
    display: flex; justify-content: flex-end; gap: 0.571rem;
    padding: 1rem 1.286rem; border-top: 1px solid var(--border, #ddd);
  }
  .btn-cancel {
    padding: 0.571rem 1.286rem; border: 1px solid var(--border, #ddd);
    border-radius: 0.429rem; background: var(--bg-card, #fff);
    cursor: pointer; font-size: 0.929rem;
  }
  .btn-primary {
    padding: 0.571rem 1.286rem; background: var(--accent, #1976d2);
    color: white; border: none; border-radius: 0.429rem;
    cursor: pointer; font-size: 0.929rem; font-weight: 500;
  }
  .btn-primary:disabled { opacity: 0.5; cursor: default; }
  .btn-cancel:disabled { opacity: 0.5; cursor: default; }
</style>
