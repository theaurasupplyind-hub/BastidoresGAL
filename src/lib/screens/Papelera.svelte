<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { DIAS_PURGA_NO_CONFIRMADO, NO_CONFIRMADO } from '$lib/utils/facturas';
  import type { Factura } from '$lib/types';

  const LIMIT = 1000;

  let loading = $state(false);
  let allFacturas = $state<Factura[]>([]);
  let ncServer = $state<Factura[] | null>(null);
  let selectedIds = $state<Set<number>>(new Set());
  let filter = $state<'todos' | 'no_confirmado'>('todos');
  let search = $state('');

  let noConfirmadas = $derived(ncServer ?? allFacturas.filter(f => f.estado_kanban === NO_CONFIRMADO));
  let todosCount = $derived(allFacturas.length);
  let ncCount = $derived(noConfirmadas.length);

  let visible = $derived.by(() => {
    const base = filter === 'no_confirmado' ? noConfirmadas : allFacturas;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter(f =>
      (f.numero_factura || '').toLowerCase().includes(q) ||
      (f.numero_presupuesto || '').toLowerCase().includes(q) ||
      (f.cliente_nombre || '').toLowerCase().includes(q)
    );
  });

  function formatDate(d: string): string {
    if (!d) return '';
    const parts = d.split('/');
    if (parts.length === 3) return `${parts[0]}/${parts[1]}/${parts[2]}`;
    return d;
  }

  function formatDateTime(iso?: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function loadTrash() {
    loading = true;
    selectedIds = new Set();
    try {
      const data = await api.listTrash({ limit: LIMIT });
      allFacturas = data;
      ncServer = null;
      // Si el listado completo se truncó, traer el bucket NO_CONFIRMADO por
      // separado (filtro server-side) para no perder los archivados.
      if (data.length >= LIMIT) {
        try { ncServer = await api.listTrash({ estado_kanban: NO_CONFIRMADO, limit: LIMIT }); } catch {}
      }
    } catch (e: any) {
      appStore.showToast('Error al cargar: ' + (e?.message || e), 'error');
      allFacturas = [];
      ncServer = null;
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

  <div class="trash-filters">
    <div class="trash-tabs" role="tablist">
      <button class="trash-tab" class:active={filter === 'todos'} onclick={() => filter = 'todos'} role="tab" aria-selected={filter === 'todos'}>
        Todos <span class="tab-count">{todosCount}</span>
      </button>
      <button class="trash-tab" class:active={filter === 'no_confirmado'} onclick={() => filter = 'no_confirmado'} role="tab" aria-selected={filter === 'no_confirmado'}>
        ⏳ No Confirmados <span class="tab-count">{ncCount}</span>
      </button>
    </div>
    <div class="trash-search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <input type="text" bind:value={search} placeholder="Buscar por N° o cliente..." />
      {#if search}
        <button class="trash-search-clear" onclick={() => search = ''} title="Limpiar" aria-label="Limpiar búsqueda">×</button>
      {/if}
    </div>
  </div>

  {#if filter === 'no_confirmado'}
    <p class="trash-note">Los presupuestos no confirmados sin pagos con más de {DIAS_PURGA_NO_CONFIRMADO} días se archivan aquí automáticamente.</p>
  {/if}

  {#if loading}
    <div class="trash-loading">Cargando papelera...</div>
  {:else if visible.length === 0}
    <div class="trash-empty">
      {#if search}
        <p>Sin resultados para “{search}”.</p>
      {:else if filter === 'no_confirmado'}
        <p>No hay no confirmados archivados.</p>
      {:else}
        <p>La papelera está vacía.</p>
        <p class="trash-hint">Las facturas eliminadas desde el historial aparecen aquí.</p>
      {/if}
    </div>
  {:else}
    <div class="trash-table-wrap">
      <table class="trash-table">
        <thead>
          <tr>
            <th class="col-date">Fecha</th>
            <th class="col-num">N° Factura</th>
            <th class="col-cliente">Cliente</th>
            <th class="col-estado">Estado</th>
            <th class="col-deleted">Eliminado el</th>
            <th class="col-total">Total</th>
          </tr>
        </thead>
        <tbody>
          {#each visible as f (f.id)}
            <tr
              class="trash-row"
              class:selected={selectedIds.has(f.id)}
              onclick={(e) => toggleSelect(f.id, e.ctrlKey)}
            >
              <td class="col-date">{formatDate(f.fecha)}</td>
              <td class="col-num">{f.numero_factura || f.numero_presupuesto || `#${f.id}`}</td>
              <td class="col-cliente">{f.cliente_nombre || 'Sin cliente'}</td>
              <td class="col-estado">
                <span class="estado-badge" class:nc={f.estado_kanban === NO_CONFIRMADO}>{f.estado_kanban || '—'}</span>
              </td>
              <td class="col-deleted">{formatDateTime(f.deleted_at)}</td>
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
  .trash-header h2 { margin: 0; font-size: 1.3rem; color: var(--text-primary); }
  .trash-actions { display: flex; align-items: center; gap: 0.571rem; }
  .selected-count { font-size: 0.8rem; color: var(--accent); font-weight: 600; min-width: 6rem; text-align: right; }

  .trash-filters {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .trash-tabs {
    display: inline-flex;
    background: var(--bg-card);
    border: 0.071rem solid var(--border-light);
    border-radius: var(--radius-sm);
    padding: 0.143rem;
    gap: 0.143rem;
  }
  .trash-tab {
    display: inline-flex;
    align-items: center;
    gap: 0.429rem;
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.84rem;
    font-weight: 600;
    padding: 0.4rem 0.857rem;
    border-radius: calc(var(--radius-sm) - 0.071rem);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .trash-tab:hover { background: var(--accent-light); color: var(--text-primary); }
  .trash-tab.active { background: var(--accent); color: #fff; }
  .tab-count {
    font-size: 0.72rem;
    font-weight: 700;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    background: color-mix(in srgb, currentColor 15%, transparent);
    min-width: 1.1rem;
    text-align: center;
  }
  .trash-tab.active .tab-count { background: rgba(255,255,255,0.25); }

  .trash-search {
    display: flex;
    align-items: center;
    gap: 0.429rem;
    background: var(--bg-card);
    border: 0.071rem solid var(--border-light);
    border-radius: var(--radius-sm);
    padding: 0.35rem 0.643rem;
    min-width: 15rem;
    color: var(--text-muted);
  }
  .trash-search input {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    color: var(--text-primary);
    font-size: 0.85rem;
  }
  .trash-search-clear {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 1.05rem;
    line-height: 1;
    cursor: pointer;
    padding: 0 0.2rem;
  }
  .trash-search-clear:hover { color: var(--text-primary); }

  .trash-note { margin: 0; font-size: 0.78rem; color: var(--text-muted); }

  .trash-table-wrap {
    flex: 1;
    overflow: auto;
     background: var(--bg-card);
   }
   .trash-table {
     width: 100%;
     border-collapse: collapse;
     font-size: var(--text-sm);
   }
  .trash-table th {
    background: var(--bg-page);
    padding: 0.571rem 0.857rem;
    text-align: left;
    font-weight: 600;
    color: var(--text-secondary);
    font-size: 0.78rem;
    text-transform: uppercase;
    position: sticky;
    top: 0;
    border-bottom: 0.143rem solid var(--border-light);
  }
  .trash-table td {
    padding: 0.5rem 0.857rem;
    border-bottom: 0.071rem solid #f0f0f0;
  }
  .trash-row { cursor: pointer; transition: background 0.1s; }
  .trash-row:hover { background: var(--accent-light); }
  .trash-row.selected { background: var(--accent-light); outline: 0.071rem solid var(--accent); outline-offset: -0.071rem; }
  .col-date { min-width: 6rem; color: var(--text-secondary); }
  .col-num { font-family: monospace; min-width: 6rem; font-weight: 600; }
  .col-cliente { min-width: 10rem; }
  .col-estado { min-width: 8rem; }
  .col-deleted { min-width: 9rem; color: var(--text-secondary); white-space: nowrap; }
  .col-total { text-align: right; font-family: monospace; font-weight: 600; min-width: 5rem; }

  .estado-badge {
    display: inline-block;
    font-size: 0.72rem;
    font-weight: 600;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    background: var(--bg-page);
    color: var(--text-secondary);
    border: 0.071rem solid var(--border-light);
  }
  .estado-badge.nc { background: #fef3c7; color: #92400e; border-color: #fde68a; }

  .trash-loading, .trash-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    gap: 0.857rem;
  }
  .trash-hint { font-size: 0.82rem; color: var(--text-muted); }
</style>
