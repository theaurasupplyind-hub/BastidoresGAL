<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import type { Pago } from '$lib/types';
  import { byDateDesc } from '$lib/types';
  import {
    buildMetodoResumen,
    destinoLabel,
    filterPagos,
    formatFechaHora,
    formatFechaPago,
    normalizeMetodo,
    normalizeTexto,
  } from '$lib/utils/pagos';

  const LIMIT = 20000;
  const PER_PAGE = 50;
  const CACHE_KEY = 'pagos:historial';

  let loading = $state(false);
  let error = $state('');
  let pagos = $state<Pago[]>([]);

  let q = $state('');
  let metodo = $state('');
  let destino = $state<'' | 'PROVIDER' | 'EMPLOYEE' | 'NONE'>('');
  let startDate = $state('');
  let endDate = $state('');
  let sortBy = $state<'fecha' | 'monto'>('fecha');
  let sortDir = $state<'desc' | 'asc'>('desc');
  let page = $state(0);

  let metodosDisponibles = $derived.by(() => {
    const set = new Set<string>();
    for (const p of pagos) set.add(normalizeMetodo(p.method));
    return [...set].sort((a, b) => a.localeCompare(b));
  });

  let filtrados = $derived.by(() => {
    const base = filterPagos(pagos, { q, metodo, destino, start: startDate, end: endDate });
    base.sort((a, b) => {
      const fecha = sortDir === 'desc'
        ? byDateDesc(a.date, b.date, a.id, b.id)
        : byDateDesc(b.date, a.date, b.id, a.id);
      if (sortBy !== 'monto') return fecha;
      const monto = (Number(a.amount) || 0) - (Number(b.amount) || 0);
      return sortDir === 'desc' ? (-monto || fecha) : (monto || fecha);
    });
    return base;
  });

  let totalPages = $derived(Math.max(1, Math.ceil(filtrados.length / PER_PAGE)));
  let pageSafe = $derived(Math.min(page, totalPages - 1));
  let pageRows = $derived(filtrados.slice(pageSafe * PER_PAGE, (pageSafe + 1) * PER_PAGE));

  let resumen = $derived(buildMetodoResumen(filtrados));
  let totalFiltrado = $derived(filtrados.reduce((s, p) => s + (Number(p.amount) || 0), 0));
  let clientesCount = $derived(
    new Set(filtrados.map((p) => normalizeTexto(p.extra_client_name || 'Desconocido'))).size
  );
  let promedio = $derived(filtrados.length ? totalFiltrado / filtrados.length : 0);

  async function load(force = false) {
    if (loading) return;
    loading = true;
    error = '';
    try {
      if (force) cacheStore.invalidate(CACHE_KEY);
      pagos = await cacheStore.fetch(CACHE_KEY, () => api.listPagos(LIMIT), 120000);
    } catch (e: any) {
      error = e?.message || 'No se pudieron cargar los pagos';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    load();
  });

  function resetPage() {
    page = 0;
  }

  function clearFilters() {
    q = '';
    metodo = '';
    destino = '';
    startDate = '';
    endDate = '';
    page = 0;
  }

  function setSort(next: 'fecha' | 'monto') {
    if (sortBy === next) {
      sortDir = sortDir === 'desc' ? 'asc' : 'desc';
    } else {
      sortBy = next;
      sortDir = 'desc';
    }
    page = 0;
  }

  function formatCurrency(n: number): string {
    return '$' + (Number(n) || 0).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function metodoColor(metodo: string): string {
    if (metodo === 'Efectivo') return '#27ae60';
    if (metodo === 'Transferencia') return '#2563eb';
    return '#9ca3af';
  }

  let hayFiltros = $derived(!!(q || metodo || destino || startDate || endDate));
</script>

<div class="pagos-screen">
  <div class="pagos-head">
    <div>
      <h2>Historial de pagos</h2>
      <p class="pagos-sub">Todos los cobros registrados por factura. Solo consulta.</p>
    </div>
    <button class="btn btn-secondary" onclick={() => load(true)} disabled={loading} title="Refrescar">
      {loading ? '⏳ Cargando…' : '🔄 Refrescar'}
    </button>
  </div>

  <div class="pagos-toolbar">
    <input
      class="search"
      type="search"
      placeholder="Buscar cliente o factura…"
      aria-label="Buscar cliente o factura"
      bind:value={q}
      oninput={resetPage}
    />
    <label class="filter-label">
      Desde
      <input type="date" bind:value={startDate} onchange={resetPage} />
    </label>
    <label class="filter-label">
      Hasta
      <input type="date" bind:value={endDate} onchange={resetPage} />
    </label>
    <select bind:value={metodo} onchange={resetPage} aria-label="Método de pago">
      <option value="">Todos los métodos</option>
      {#each metodosDisponibles as m}
        <option value={m}>{m}</option>
      {/each}
    </select>
    <select bind:value={destino} onchange={resetPage} aria-label="Destino del pago">
      <option value="">Todos los destinos</option>
      <option value="NONE">Sin destino</option>
      <option value="PROVIDER">Proveedor</option>
      <option value="EMPLOYEE">Empleado</option>
    </select>
    {#if hayFiltros}
      <button class="btn btn-link" onclick={clearFilters}>Limpiar</button>
    {/if}
  </div>

  <div class="pagos-kpis">
    <div class="kpi-card">
      <span class="kpi-label">Total cobrado</span>
      <span class="kpi-value">{formatCurrency(totalFiltrado)}</span>
      <span class="kpi-sub">{filtrados.length} pago{filtrados.length === 1 ? '' : 's'} en el filtro</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Pagos</span>
      <span class="kpi-value">{filtrados.length}</span>
      <span class="kpi-sub">de {pagos.length} registrados</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Clientes</span>
      <span class="kpi-value">{clientesCount}</span>
      <span class="kpi-sub">con pagos en el filtro</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Promedio por pago</span>
      <span class="kpi-value">{formatCurrency(promedio)}</span>
      <span class="kpi-sub">ticket medio</span>
    </div>
  </div>

  {#if resumen.length > 0}
    <div class="pagos-mix">
      {#each resumen as m}
        <div class="mix-item">
          <span class="mix-dot" style="background: {metodoColor(m.metodo)}"></span>
          <span class="mix-label">{m.metodo}</span>
          <span class="mix-count">{m.count} pago{m.count === 1 ? '' : 's'}</span>
          <span class="mix-pct">{m.pctCount.toFixed(1)}%</span>
          <span class="mix-amount">{formatCurrency(m.total)}</span>
        </div>
      {/each}
    </div>
  {/if}

  <div class="pagos-card">
    {#if loading && pagos.length === 0}
      <div class="pagos-empty">Cargando pagos…</div>
    {:else if error}
      <div class="pagos-empty">
        No se pudieron cargar los pagos: {error}
        <button class="btn btn-secondary" onclick={() => load(true)}>Reintentar</button>
      </div>
    {:else if filtrados.length === 0}
      <div class="pagos-empty">No hay pagos que coincidan con los filtros.</div>
    {:else}
      <div class="pagos-table-wrap">
        <table class="pagos-table">
          <thead>
            <tr>
              <th>
                <button class="th-sort" onclick={() => setSort('fecha')}>
                  Fecha {sortBy === 'fecha' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                </button>
              </th>
              <th>Cliente</th>
              <th>Factura</th>
              <th class="td-r">
                <button class="th-sort" onclick={() => setSort('monto')}>
                  Monto {sortBy === 'monto' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                </button>
              </th>
              <th>Método</th>
              <th>Destino</th>
              <th>Registrado</th>
            </tr>
          </thead>
          <tbody>
            {#each pageRows as p (p.id)}
              <tr>
                <td class="nowrap">{formatFechaPago(p.date)}</td>
                <td class="cliente" title={p.extra_client_name || 'Desconocido'}>
                  {p.extra_client_name || 'Desconocido'}
                </td>
                <td class="nowrap">{p.extra_invoice_num || '—'}</td>
                <td class="td-r monto">{formatCurrency(p.amount || 0)}</td>
                <td>
                  <span
                    class="metodo-badge"
                    class:efectivo={normalizeMetodo(p.method) === 'Efectivo'}
                    class:transferencia={normalizeMetodo(p.method) === 'Transferencia'}
                  >
                    {normalizeMetodo(p.method)}
                  </span>
                </td>
                <td class="nowrap">{destinoLabel(p)}</td>
                <td class="nowrap muted">{formatFechaHora(p.created_at)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <div class="pagos-footer">
        <span class="muted">
          Mostrando {pageSafe * PER_PAGE + 1}–{Math.min((pageSafe + 1) * PER_PAGE, filtrados.length)}
          de {filtrados.length}
        </span>
        <div class="pager">
          <button class="btn btn-secondary btn-xs" disabled={pageSafe === 0} onclick={() => (page = pageSafe - 1)}>
            ◀
          </button>
          <span>{pageSafe + 1} / {totalPages}</span>
          <button
            class="btn btn-secondary btn-xs"
            disabled={pageSafe >= totalPages - 1}
            onclick={() => (page = pageSafe + 1)}
          >
            ▶
          </button>
        </div>
      </div>
    {/if}
  </div>

  <p class="pagos-note">
    Se consultan hasta {LIMIT.toLocaleString('es-AR')} pagos (los más recientes). Los pagos
    deshechos o de facturas eliminadas no aparecen.
  </p>
</div>

<style>
  .pagos-screen {
    padding: 1.143rem;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.714rem;
    background: var(--bg-page);
    overflow: auto;
  }

  .pagos-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .pagos-head h2 {
    margin: 0;
    font-size: 1.15rem;
    color: var(--text-primary);
  }
  .pagos-sub {
    margin: 0.214rem 0 0;
    font-size: 0.82rem;
    color: var(--text-muted);
  }

  .pagos-toolbar {
    display: flex;
    gap: 0.571rem;
    align-items: center;
    flex-wrap: wrap;
    background: var(--bg-card);
    padding: 0.571rem 1rem;
    border-radius: 0.571rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0, 0, 0, 0.06);
  }
  .pagos-toolbar .search {
    flex: 1 1 16rem;
    min-width: 12rem;
  }
  .pagos-toolbar input,
  .pagos-toolbar select {
    padding: 0.357rem 0.571rem;
    border: 1px solid var(--border);
    border-radius: 0.357rem;
    font-size: 0.85rem;
    background: var(--bg-card);
    color: var(--text-primary);
    font-family: inherit;
  }
  .filter-label {
    display: flex;
    align-items: center;
    gap: 0.357rem;
    font-size: 0.78rem;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .btn {
    cursor: pointer;
    border-radius: 0.357rem;
    border: none;
    font-weight: 600;
    font-family: inherit;
    font-size: 0.82rem;
    padding: 0.429rem 0.857rem;
  }
  .btn-secondary {
    background: var(--bg-page);
    color: var(--text-secondary);
    border: 1px solid var(--border);
  }
  .btn-secondary:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .btn-xs {
    padding: 0.214rem 0.5rem;
    font-size: 0.78rem;
  }
  .btn-link {
    background: none;
    color: var(--accent);
    padding: 0.357rem 0.429rem;
  }
  .btn-link:hover {
    text-decoration: underline;
  }

  .pagos-kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.714rem;
  }
  .kpi-card {
    background: var(--bg-card);
    border-radius: 0.571rem;
    padding: 0.714rem 0.857rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0, 0, 0, 0.06);
    display: flex;
    flex-direction: column;
    gap: 0.143rem;
  }
  .kpi-label {
    font-size: 0.68rem;
    text-transform: uppercase;
    color: var(--text-muted);
    font-weight: 600;
    letter-spacing: 0.02rem;
  }
  .kpi-value {
    font-size: 1.35rem;
    font-weight: 700;
    color: var(--text-primary);
  }
  .kpi-sub {
    font-size: 0.72rem;
    color: var(--text-muted);
  }

  .pagos-mix {
    display: flex;
    gap: 0.571rem;
    flex-wrap: wrap;
    background: var(--bg-card);
    border-radius: 0.571rem;
    padding: 0.571rem 1rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0, 0, 0, 0.06);
  }
  .mix-item {
    display: flex;
    align-items: center;
    gap: 0.429rem;
    font-size: 0.82rem;
    padding: 0.214rem 0.571rem;
    border-radius: 1rem;
    background: var(--bg-page);
  }
  .mix-dot {
    width: 0.571rem;
    height: 0.571rem;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .mix-label {
    font-weight: 600;
    color: var(--text-primary);
  }
  .mix-count,
  .mix-pct {
    color: var(--text-muted);
  }
  .mix-amount {
    font-family: monospace;
    color: var(--text-secondary);
  }

  .pagos-card {
    background: var(--bg-card);
    border-radius: 0.571rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0, 0, 0, 0.06);
    overflow: hidden;
  }
  .pagos-table-wrap {
    overflow: auto;
    max-height: calc(100vh - 22rem);
  }
  .pagos-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.88rem;
  }
  .pagos-table th {
    background: var(--bg-page);
    padding: 0.571rem 0.714rem;
    text-align: left;
    font-weight: 600;
    color: var(--text-secondary);
    font-size: 0.78rem;
    text-transform: uppercase;
    position: sticky;
    top: 0;
    z-index: 1;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }
  .pagos-table td {
    padding: 0.5rem 0.714rem;
    border-bottom: 1px solid var(--border-light, #f0f1f5);
    color: var(--text-primary);
  }
  .pagos-table tbody tr:hover {
    background: var(--accent-light);
  }
  .pagos-table .td-r {
    text-align: right;
  }
  .th-sort {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    text-transform: inherit;
    cursor: pointer;
  }
  .th-sort:hover {
    color: var(--accent);
  }
  .cliente {
    max-width: 22rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .monto {
    font-family: monospace;
    font-weight: 600;
    white-space: nowrap;
  }
  .nowrap {
    white-space: nowrap;
  }
  .muted {
    color: var(--text-muted);
  }
  .metodo-badge {
    display: inline-block;
    padding: 0.071rem 0.5rem;
    border-radius: 1rem;
    font-size: 0.75rem;
    font-weight: 600;
    background: var(--bg-page);
    color: var(--text-secondary);
  }
  .metodo-badge.efectivo {
    background: color-mix(in srgb, #27ae60 12%, var(--bg-card));
    color: #1e8449;
  }
  .metodo-badge.transferencia {
    background: color-mix(in srgb, #2563eb 12%, var(--bg-card));
    color: #1d4ed8;
  }

  .pagos-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.714rem;
    padding: 0.571rem 0.857rem;
    flex-wrap: wrap;
  }
  .pager {
    display: flex;
    align-items: center;
    gap: 0.571rem;
    font-size: 0.82rem;
  }

  .pagos-empty {
    padding: 2.857rem;
    text-align: center;
    color: var(--text-muted);
    display: flex;
    flex-direction: column;
    gap: 0.714rem;
    align-items: center;
  }
  .pagos-note {
    margin: 0;
    font-size: 0.72rem;
    color: var(--text-muted);
  }
</style>
