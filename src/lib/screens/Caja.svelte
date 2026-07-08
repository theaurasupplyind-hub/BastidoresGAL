<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';

  interface CajaEntry {
    id: string;
    fecha: string;
    tipo: 'INGRESO' | 'EGRESO';
    categoria: string;
    descripcion: string;
    monto: number;
    entidad: string;
  }

  let allEntries: CajaEntry[] = $state([]);
  let loading = $state(true);
  let filterDesde = $state('');
  let filterHasta = $state('');
  let filterTipo = $state<'ALL' | 'INGRESO' | 'EGRESO'>('ALL');

  let ingresos = $derived(allEntries.filter(e => e.tipo === 'INGRESO'));
  let egresos = $derived(allEntries.filter(e => e.tipo === 'EGRESO'));
  let totalIngresos = $derived(ingresos.reduce((s, e) => s + e.monto, 0));
  let totalEgresos = $derived(egresos.reduce((s, e) => s + e.monto, 0));
  let saldo = $derived(totalIngresos - totalEgresos);

  let filteredEntries = $derived.by(() => {
    let result = allEntries;
    if (filterTipo !== 'ALL') {
      result = result.filter(e => e.tipo === filterTipo);
    }
    if (filterDesde) {
      result = result.filter(e => e.fecha >= filterDesde);
    }
    if (filterHasta) {
      result = result.filter(e => e.fecha <= filterHasta);
    }
    return result;
  });

  const CATEGORY_ICONS: Record<string, string> = {
    'Venta': '🟢',
    'Compra': '🟡',
    'Pago Proveedor': '🔴',
    'Sueldo': '🔵',
    'General': '🟣',
  };

  function formatCurrency(n: number): string {
    return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2 });
  }

  function formatDate(d: string): string {
    if (!d) return '';
    const p = d.split('-');
    if (p.length === 3) return `${p[2]}/${p[1]}`;
    return d;
  }

  onMount(async () => {
    try {
      const cacheKey = 'caja:all';

      allEntries = await cacheStore.fetch(cacheKey, async () => {
        const [pagos, providers, empPays] = await Promise.all([
          api.listPagos(),
          api.listProviders(),
          api.listEmployeePaymentsRecent(10000),
        ]);

        const entries: CajaEntry[] = [];

        for (const p of pagos) {
          entries.push({
            id: `pago-${p.id}`,
            fecha: p.date || '',
            tipo: 'INGRESO',
            categoria: 'Venta',
            descripcion: p.method ? `Pago ${p.method}` : 'Pago',
            monto: p.amount || 0,
            entidad: p.username || `Factura #${p.invoice_id}`,
          });
        }

        const providerPromises = providers.map(p =>
          api.getProvider(p.id)
            .then(d => ({ name: p.name, movements: d?.movements || [] }))
            .catch(() => ({ name: p.name, movements: [] }))
        );
        const providerResults = await Promise.all(providerPromises);

        for (const pr of providerResults) {
          for (const m of pr.movements) {
            if (m.type === 'PAYMENT') {
              entries.push({
                id: `prov-mov-${m.id}`,
                fecha: m.date || '',
                tipo: 'EGRESO',
                categoria: 'Pago Proveedor',
                descripcion: m.description || 'Pago',
                monto: m.amount || 0,
                entidad: pr.name,
              });
            } else if (m.type === 'PURCHASE') {
              entries.push({
                id: `prov-mov-${m.id}`,
                fecha: m.date || '',
                tipo: 'EGRESO',
                categoria: 'Compra',
                descripcion: m.description || 'Compra',
                monto: m.amount || 0,
                entidad: pr.name,
              });
            }
          }
        }

        const employees = await cacheStore.fetch('employees:all', () => api.listEmployees(false), 900000);
        const empMap = new Map(employees.map(e => [e.id, e.name]));

        for (const ep of empPays) {
          entries.push({
            id: `emp-pay-${ep.id}`,
            fecha: ep.date || '',
            tipo: 'EGRESO',
            categoria: 'Sueldo',
            descripcion: ep.concept || ep.detail || 'Sueldo',
            monto: ep.amount || 0,
            entidad: empMap.get(ep.employee_id) || `Empleado #${ep.employee_id}`,
          });
        }

        entries.sort((a, b) => b.fecha.localeCompare(a.fecha));
        return entries;
      }, 120000);

    } catch (e) {
      console.error('Error loading Caja:', e);
    } finally {
      loading = false;
    }
  });
</script>

<div class="caja">
  <div class="caja-header">
    <h2>💰 Caja</h2>
  </div>

  {#if loading}
    <div class="caja-loading">Cargando datos financieros...</div>
  {:else}
    <div class="caja-resumen">
      <div class="caja-card caja-card-ingresos">
        <span class="caja-card-label">Ingresos</span>
        <span class="caja-card-value caja-value-positive">{formatCurrency(totalIngresos)}</span>
      </div>
      <div class="caja-card caja-card-egresos">
        <span class="caja-card-label">Egresos</span>
        <span class="caja-card-value caja-value-negative">{formatCurrency(totalEgresos)}</span>
      </div>
      <div class="caja-card caja-card-saldo" class:positive={saldo >= 0} class:negative={saldo < 0}>
        <span class="caja-card-label">Saldo</span>
        <span class="caja-card-value">{formatCurrency(saldo)}</span>
      </div>
    </div>

    <div class="caja-filters">
      <div class="caja-filter-group">
        <label class="caja-filter-label">Desde</label>
        <input type="date" bind:value={filterDesde} class="caja-filter-input" />
      </div>
      <div class="caja-filter-group">
        <label class="caja-filter-label">Hasta</label>
        <input type="date" bind:value={filterHasta} class="caja-filter-input" />
      </div>
      <div class="caja-filter-group">
        <label class="caja-filter-label">Tipo</label>
        <select bind:value={filterTipo} class="caja-filter-select">
          <option value="ALL">Todos</option>
          <option value="INGRESO">Ingresos</option>
          <option value="EGRESO">Egresos</option>
        </select>
      </div>
      <span class="caja-filter-count">{filteredEntries.length} registros</span>
    </div>

    <div class="caja-table-wrap">
      <table class="caja-table">
        <thead>
          <tr>
            <th class="caja-th-date">Fecha</th>
            <th class="caja-th-type">Tipo</th>
            <th class="caja-th-cat">Categoría</th>
            <th class="caja-th-desc">Descripción</th>
            <th class="caja-th-entity">Entidad</th>
            <th class="caja-th-amount">Monto</th>
          </tr>
        </thead>
        <tbody>
          {#each filteredEntries as e (e.id)}
            <tr>
              <td class="caja-td-date">{formatDate(e.fecha)}</td>
              <td class="caja-td-type">
                <span class="caja-type-badge" class:ingreso={e.tipo === 'INGRESO'} class:egreso={e.tipo === 'EGRESO'}>
                  {e.tipo === 'INGRESO' ? '🟢' : '🔴'} {e.tipo === 'INGRESO' ? 'Ingreso' : 'Egreso'}
                </span>
              </td>
              <td class="caja-td-cat">
                <span class="caja-cat-badge">{CATEGORY_ICONS[e.categoria] || '•'} {e.categoria}</span>
              </td>
              <td class="caja-td-desc">{e.descripcion || '—'}</td>
              <td class="caja-td-entity">{e.entidad || '—'}</td>
              <td class="caja-td-amount" class:ingreso={e.tipo === 'INGRESO'} class:egreso={e.tipo === 'EGRESO'}>
                {e.tipo === 'INGRESO' ? '+' : '-'}{formatCurrency(e.monto)}
              </td>
            </tr>
          {:else}
            <tr>
              <td colspan="6" class="caja-empty">Sin registros para los filtros seleccionados</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .caja {
    padding: 1.143rem;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.714rem;
    background: #f5f6fa;
    overflow: auto;
  }

  .caja-header h2 {
    margin: 0;
    font-size: 1.3rem;
    color: #2c3e50;
  }

  .caja-loading {
    padding: 2rem;
    text-align: center;
    color: #999;
    font-size: 0.9rem;
  }

  .caja-resumen {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.714rem;
  }

  .caja-card {
    background: white;
    border-radius: 0.571rem;
    padding: 1rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
    display: flex;
    flex-direction: column;
    gap: 0.286rem;
  }

  .caja-card-label {
    font-size: 0.72rem;
    text-transform: uppercase;
    color: #888;
    font-weight: 600;
  }

  .caja-card-value {
    font-size: 1.3rem;
    font-weight: 700;
    color: #2c3e50;
  }

  .caja-value-positive { color: #27ae60; }
  .caja-value-negative { color: #e74c3c; }
  .caja-card-saldo.positive { border-left: 0.286rem solid #27ae60; }
  .caja-card-saldo.negative { border-left: 0.286rem solid #e74c3c; }

  .caja-filters {
    display: flex;
    align-items: flex-end;
    gap: 0.714rem;
    background: white;
    padding: 0.571rem 0.857rem;
    border-radius: 0.571rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
    flex-wrap: wrap;
  }

  .caja-filter-group {
    display: flex;
    flex-direction: column;
    gap: 0.143rem;
  }

  .caja-filter-label {
    font-size: 0.68rem;
    color: #999;
    font-weight: 600;
    text-transform: uppercase;
  }

  .caja-filter-input,
  .caja-filter-select {
    padding: 0.357rem 0.571rem;
    border: 1px solid #ddd;
    border-radius: 0.357rem;
    font-size: 0.82rem;
    font-family: inherit;
    background: white;
  }

  .caja-filter-count {
    margin-left: auto;
    font-size: 0.78rem;
    color: #999;
    padding: 0.357rem 0;
  }

  .caja-table-wrap {
    flex: 1;
    overflow: auto;
    background: white;
    border-radius: 0.571rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }

  .caja-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
  }

  .caja-table th {
    background: #f8f9fa;
    padding: 0.5rem 0.714rem;
    font-weight: 600;
    color: #666;
    font-size: 0.72rem;
    text-transform: uppercase;
    position: sticky;
    top: 0;
    z-index: 1;
    border-bottom: 2px solid #e9ecef;
    white-space: nowrap;
  }

  .caja-table td {
    padding: 0.429rem 0.714rem;
    border-bottom: 1px solid #f0f0f0;
    vertical-align: middle;
  }

  .caja-table tr:hover td {
    background: #fafbfc;
  }

  .caja-th-date { min-width: 5.714rem; }
  .caja-th-type { min-width: 5.714rem; }
  .caja-th-cat { min-width: 7.143rem; }
  .caja-th-desc { min-width: 10rem; }
  .caja-th-entity { min-width: 7.143rem; }
  .caja-th-amount { min-width: 7.143rem; text-align: right; }

  .caja-td-date {
    font-family: monospace;
    font-size: 0.78rem;
    color: #888;
  }

  .caja-type-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.286rem;
    padding: 0.143rem 0.5rem;
    border-radius: 0.286rem;
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .caja-type-badge.ingreso {
    background: #d4edda;
    color: #155724;
  }

  .caja-type-badge.egreso {
    background: #f8d7da;
    color: #721c24;
  }

  .caja-cat-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.286rem;
    font-size: 0.78rem;
    color: #555;
  }

  .caja-td-desc {
    color: #2c3e50;
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .caja-td-entity {
    color: #888;
    font-size: 0.78rem;
  }

  .caja-td-amount {
    font-family: monospace;
    font-weight: 700;
    font-size: 0.88rem;
    text-align: right;
    white-space: nowrap;
  }

  .caja-td-amount.ingreso { color: #27ae60; }
  .caja-td-amount.egreso { color: #e74c3c; }

  .caja-empty {
    text-align: center;
    padding: 2rem !important;
    color: #bbb;
    font-size: 0.85rem;
  }
</style>
