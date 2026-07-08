<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import type { AnalisisPeriodo } from '$lib/types';

  let loading = $state(false);
  let mensual = $state<AnalisisPeriodo | null>(null);
  let semanal = $state<AnalisisPeriodo | null>(null);
  let historial = $state<AnalisisPeriodo[]>([]);

  function formatCurrency(n: number): string {
    return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function formatPct(n: number): string {
    const s = n.toFixed(1);
    return (n >= 0 ? '+' : '') + s + '%';
  }

  function formatDateRange(inicio: string, fin: string): string {
    const [iy, im, id] = inicio.split('-').map(Number);
    const [fy, fm, fd] = fin.split('-').map(Number);
    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    if (iy === fy && im === fm) {
      return `${meses[im - 1]} ${id}-${fd}, ${iy}`;
    }
    return `${meses[im - 1]} ${id} → ${meses[fm - 1]} ${fd}`;
  }

  function formatMonth(inicio: string): string {
    const [y, m] = inicio.split('-').map(Number);
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
    return `${meses[m - 1]} ${y}`;
  }

  function formatShortMonth(inicio: string): string {
    const [y, m] = inicio.split('-').map(Number);
    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    return `${meses[m - 1]} ${String(y).slice(2)}`;
  }

  let usuarioId = $derived(appStore.user?.user_id || 1);

  async function loadData() {
    loading = true;
    try {
      const [m, s, h] = await Promise.all([
        api.getAnalisisMensual(usuarioId),
        api.getAnalisisSemanal(usuarioId),
        api.getAnalisisHistorial(usuarioId),
      ]);
      mensual = m;
      semanal = s;
      historial = h;
    } catch (e) {
      console.error(e);
    } finally {
      loading = false;
    }
  }

  onMount(() => { loadData(); });
</script>

<div class="analisis-usd">
  <div class="au-toolbar">
    <h2>Análisis USD</h2>
    <button class="btn btn-sm btn-secondary" onclick={loadData} disabled={loading}>
      {loading ? 'Cargando...' : '🔄 Refrescar'}
    </button>
  </div>

  <div class="au-cards">
    <div class="au-card">
      <div class="au-card-header">
        <span class="au-card-badge mensual">Mensual</span>
        <span class="au-card-period">{mensual ? formatMonth(mensual.periodo_inicio) : '—'}</span>
      </div>
      {#if mensual}
        <div class="au-card-body">
          <div class="au-stat">
            <span class="au-stat-value">{formatCurrency(mensual.facturacion_pesos)}</span>
            <span class="au-stat-label">en pesos</span>
          </div>
          <div class="au-stat-row">
            <span>Dólar prom.</span>
            <span>{formatCurrency(mensual.dolar_promedio)}</span>
          </div>
          <div class="au-stat-row">
            <span>Facturación USD</span>
            <span class="au-stat-bold">{formatCurrency(mensual.facturacion_usd)}</span>
          </div>
          <div class="au-var-row">
            <span class="au-var" class:positive={mensual.variacion_pct_pesos >= 0} class:negative={mensual.variacion_pct_pesos < 0}>
              {mensual.variacion_pct_pesos >= 0 ? '▲' : '▼'} Pesos: {formatPct(mensual.variacion_pct_pesos)}
            </span>
            <span class="au-var" class:positive={mensual.variacion_pct_usd >= 0} class:negative={mensual.variacion_pct_usd < 0}>
              {mensual.variacion_pct_usd >= 0 ? '▲' : '▼'} USD: {formatPct(mensual.variacion_pct_usd)}
            </span>
          </div>
          <div class="au-msg">{mensual.mensaje}</div>
        </div>
      {:else}
        <div class="au-empty">Sin datos mensuales</div>
      {/if}
    </div>

    <div class="au-card">
      <div class="au-card-header">
        <span class="au-card-badge semanal">Semanal</span>
        <span class="au-card-period">{semanal ? formatDateRange(semanal.periodo_inicio, semanal.periodo_fin) : '—'}</span>
      </div>
      {#if semanal}
        <div class="au-card-body">
          <div class="au-stat">
            <span class="au-stat-value">{formatCurrency(semanal.facturacion_pesos)}</span>
            <span class="au-stat-label">en pesos</span>
          </div>
          <div class="au-stat-row">
            <span>Dólar prom.</span>
            <span>{formatCurrency(semanal.dolar_promedio)}</span>
          </div>
          <div class="au-stat-row">
            <span>Facturación USD</span>
            <span class="au-stat-bold">{formatCurrency(semanal.facturacion_usd)}</span>
          </div>
          <div class="au-var-row">
            <span class="au-var" class:positive={semanal.variacion_pct_pesos >= 0} class:negative={semanal.variacion_pct_pesos < 0}>
              {semanal.variacion_pct_pesos >= 0 ? '▲' : '▼'} Pesos: {formatPct(semanal.variacion_pct_pesos)}
            </span>
            <span class="au-var" class:positive={semanal.variacion_pct_usd >= 0} class:negative={semanal.variacion_pct_usd < 0}>
              {semanal.variacion_pct_usd >= 0 ? '▲' : '▼'} USD: {formatPct(semanal.variacion_pct_usd)}
            </span>
          </div>
          <div class="au-msg">{semanal.mensaje}</div>
        </div>
      {:else}
        <div class="au-empty">Sin datos semanales</div>
      {/if}
    </div>
  </div>

  <div class="au-historial">
    <h3>Historial mensual</h3>
    {#if historial.length === 0}
      <div class="au-empty">Sin datos históricos</div>
    {:else}
      <div class="au-table-wrap">
        <table class="au-table">
          <thead>
            <tr>
              <th>Mes</th>
              <th class="td-r">Pesos</th>
              <th class="td-r">Dólar promedio</th>
              <th class="td-r">USD</th>
              <th class="td-r">Var. USD</th>
            </tr>
          </thead>
          <tbody>
            {#each historial as row}
              <tr>
                <td class="month-name">{formatShortMonth(row.periodo_inicio)}</td>
                <td class="td-r">{formatCurrency(row.facturacion_pesos)}</td>
                <td class="td-r">{formatCurrency(row.dolar_promedio)}</td>
                <td class="td-r">{formatCurrency(row.facturacion_usd)}</td>
                <td class="td-r" style="color: {row.variacion_pct_usd >= 0 ? '#27ae60' : '#e74c3c'}">
                  {formatPct(row.variacion_pct_usd)}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>

<style>
  .analisis-usd {
    padding: 1.143rem;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.714rem;
    background: #f5f6fa;
    overflow: auto;
  }

  .au-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .au-toolbar h2 { margin: 0; font-size: 1.3rem; color: #2c3e50; }

  .btn { cursor: pointer; border-radius: 0.357rem; border: none; font-weight: 600; font-family: inherit; }
  .btn-sm { font-size: 0.78rem; padding: 0.357rem 0.714rem; }
  .btn-secondary { background: #e9ecef; color: #555; }
  .btn-secondary:hover { background: #dee2e6; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .au-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.714rem;
  }

  .au-card {
    background: white;
    border-radius: 0.571rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
    overflow: hidden;
  }
  .au-card-header {
    display: flex;
    align-items: center;
    gap: 0.571rem;
    padding: 0.714rem 1rem;
    border-bottom: 1px solid #f0f1f5;
  }
  .au-card-badge {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    padding: 0.143rem 0.571rem;
    border-radius: 0.286rem;
    letter-spacing: 0.036rem;
  }
  .au-card-badge.mensual { background: #e8f0fe; color: #4361ee; }
  .au-card-badge.semanal { background: #fef3e8; color: #e67e22; }
  .au-card-period { font-size: 0.82rem; font-weight: 600; color: #2c3e50; }

  .au-card-body { padding: 0.857rem 1rem; display: flex; flex-direction: column; gap: 0.571rem; }
  .au-stat { text-align: center; padding: 0.429rem 0; }
  .au-stat-value { font-size: 1.4rem; font-weight: 700; color: #2c3e50; }
  .au-stat-label { font-size: 0.72rem; color: #999; text-transform: uppercase; font-weight: 600; }

  .au-stat-row { display: flex; justify-content: space-between; font-size: 0.85rem; padding: 0.143rem 0; }
  .au-stat-row span:first-child { color: #888; }
  .au-stat-bold { font-weight: 700; color: #2c3e50; font-family: monospace; }

  .au-var-row { display: flex; justify-content: space-between; margin-top: 0.286rem; }
  .au-var { font-size: 0.82rem; font-weight: 600; padding: 0.214rem 0.429rem; border-radius: 0.286rem; }
  .au-var.positive { color: #27ae60; }
  .au-var.negative { color: #e74c3c; }

  .au-msg { font-size: 0.78rem; color: #666; font-style: italic; padding: 0.571rem; background: #f8f9fa; border-radius: 0.357rem; line-height: 1.4; margin-top: 0.286rem; }

  .au-empty { text-align: center; padding: 1.429rem; color: #bbb; }

  .au-historial {
    background: white;
    border-radius: 0.571rem;
    padding: 0.857rem 1rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }
  .au-historial h3 {
    margin: 0 0 0.571rem;
    font-size: 0.9rem;
    color: #2c3e50;
  }
  .au-table-wrap { overflow-x: auto; }
  .au-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.92rem;
  }
  .au-table th {
    background: #f8f9fa;
    padding: 0.5rem 0.714rem;
    text-align: left;
    font-weight: 600;
    color: #555;
    font-size: 0.78rem;
    text-transform: uppercase;
    border-bottom: 1px solid #ddd;
  }
  .au-table td {
    padding: 0.429rem 0.714rem;
    border-bottom: 1px solid #f0f1f5;
  }
  .au-table th:first-child, .au-table td:first-child { width: 16%; }
  .au-table th:last-child, .au-table td:last-child { width: 18%; }
  .au-table th:nth-child(2), .au-table td:nth-child(2),
  .au-table th:nth-child(3), .au-table td:nth-child(3),
  .au-table th:nth-child(4), .au-table td:nth-child(4) { width: 22%; }
  .au-table .month-name { font-weight: 600; color: #2c3e50; font-size: 0.92rem; }
  .au-table th.td-r { text-align: right; }
  .td-r { text-align: right; font-family: monospace; font-size: 0.85rem; }
</style>
