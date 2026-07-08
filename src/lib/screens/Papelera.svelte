<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import type { Factura } from '$lib/types';

  let loading = $state(false);
  let facturas = $state<Factura[]>([]);
  let selectedIds = $state<Set<number>>(new Set());

  function formatDate(d: string): string {
    if (!d) return '';
    const parts = d.split('/');
    if (parts.length === 3) return `${parts[0]}/${parts[1]}/${parts[2]}`;
    return d;
  }

  async function loadTrash() {
    loading = true;
    selectedIds = new Set();
    try {
      facturas = await api.listTrash();
    } catch (e: any) {
      appStore.showToast('Error al cargar: ' + (e?.message || e), 'error');
      facturas = [];
    } finally {
      loading = false;
    }
  }

  function toggleSelect(id: number, ctrl = false) {
    const s = new Set(selectedIds);
    if (ctrl) {
      if (s.has(id)) s.delete(id); else s.add(id);
    } else {
      if (s.has(id) && s.size === 1) { s.delete(id); }
      else { s.clear(); s.add(id); }
    }
    selectedIds = s;
  }

  async function restoreSelected() {
    if (selectedIds.size === 0) return;
    if (!confirm(`¿Restaurar ${selectedIds.size} factura(s)?`)) return;
    try {
      await Promise.all(Array.from(selectedIds).map(id => api.restoreInvoice(id)));
      appStore.showToast(`${selectedIds.size} factura(s) restaurada(s)`, 'success');
      await loadTrash();
    } catch (e: any) {
      appStore.showToast('Error al restaurar: ' + (e?.message || e), 'error');
    }
  }

  async function permanentDeleteSelected() {
    if (selectedIds.size === 0) return;
    if (!confirm(`¿Eliminar DEFINITIVAMENTE ${selectedIds.size} factura(s)? Esta acción no se puede deshacer.`)) return;
    try {
      await Promise.all(Array.from(selectedIds).map(id => api.permanentDeleteInvoice(id)));
      appStore.showToast(`${selectedIds.size} factura(s) eliminadas definitivamente`, 'success');
      await loadTrash();
    } catch (e: any) {
      appStore.showToast('Error al eliminar: ' + (e?.message || e), 'error');
    }
  }

  onMount(() => { loadTrash(); });
</script>

<div class="papelera">
  <div class="trash-header">
    <h2>Papelera</h2>
    <div class="trash-actions">
      <span class="selected-count">{selectedIds.size > 0 ? `${selectedIds.size} selec.` : ''}</span>
      <button class="btn btn-sm btn-primary" onclick={restoreSelected} disabled={selectedIds.size === 0}>🔄 Restaurar</button>
      <button class="btn btn-sm btn-danger" onclick={permanentDeleteSelected} disabled={selectedIds.size === 0}>🗑 Eliminar Definitivo</button>
      <button class="btn btn-sm btn-secondary" onclick={loadTrash} disabled={loading}>
        {loading ? 'Cargando...' : '🔄 Refrescar'}
      </button>
    </div>
  </div>

  {#if loading}
    <div class="trash-loading">Cargando papelera...</div>
  {:else if facturas.length === 0}
    <div class="trash-empty">
      <p>La papelera está vacía.</p>
      <p class="trash-hint">Las facturas eliminadas desde el historial aparecen aquí.</p>
    </div>
  {:else}
    <div class="trash-table-wrap">
      <table class="trash-table">
        <thead>
          <tr>
            <th class="col-date">Fecha</th>
            <th class="col-num">N° Factura</th>
            <th class="col-cliente">Cliente</th>
            <th class="col-total">Total</th>
          </tr>
        </thead>
        <tbody>
          {#each facturas as f (f.id)}
            <tr
              class="trash-row"
              class:selected={selectedIds.has(f.id)}
              onclick={(e) => toggleSelect(f.id, e.ctrlKey)}
            >
              <td class="col-date">{formatDate(f.fecha)}</td>
              <td class="col-num">{f.numero_factura || f.numero_presupuesto || `#${f.id}`}</td>
              <td class="col-cliente">{f.cliente_nombre || 'Sin cliente'}</td>
              <td class="col-total">${(f.total || 0).toFixed(0)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .papelera {
    padding: 1.143rem;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.857rem;
    background: var(--bg-page);
  }

  .trash-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .trash-header h2 { margin: 0; font-size: 1.3rem; color: #2c3e50; }
  .trash-actions { display: flex; align-items: center; gap: 0.571rem; }
  .selected-count { font-size: 0.8rem; color: #3498db; font-weight: 600; min-width: 6rem; text-align: right; }

  .trash-table-wrap {
    flex: 1;
    overflow: auto;
    background: white;
    border-radius: 0.571rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }
  .trash-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }
  .trash-table th {
    background: #f8f9fa;
    padding: 0.571rem 0.857rem;
    text-align: left;
    font-weight: 600;
    color: #555;
    font-size: 0.78rem;
    text-transform: uppercase;
    position: sticky;
    top: 0;
    border-bottom: 0.143rem solid #e9ecef;
  }
  .trash-table td {
    padding: 0.5rem 0.857rem;
    border-bottom: 0.071rem solid #f0f0f0;
  }
  .trash-row { cursor: pointer; transition: background 0.1s; }
  .trash-row:hover { background: #f8f9ff; }
  .trash-row.selected { background: #eef2ff; outline: 0.071rem solid #6366f1; outline-offset: -0.071rem; }
  .col-date { min-width: 6rem; color: var(--text-secondary); }
  .col-num { font-family: monospace; min-width: 6rem; font-weight: 600; }
  .col-cliente { min-width: 10rem; }
  .col-total { text-align: right; font-family: monospace; font-weight: 600; min-width: 5rem; }

  .trash-loading, .trash-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #999;
    gap: 0.857rem;
  }
  .trash-hint { font-size: 0.82rem; color: #bbb; }
</style>
