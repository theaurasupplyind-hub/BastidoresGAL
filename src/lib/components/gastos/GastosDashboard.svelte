<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import type { Provider, ProviderMovement, Employee, Attendance, ExpenseCategory } from '$lib/types';
  import ExpensesTab from './ExpensesTab.svelte';

  let providers = $state<Provider[]>([]);
  let employees = $state<Employee[]>([]);
  let providerMoves = $state<ProviderMovement[]>([]);
  let attendanceRecords = $state<Attendance[]>([]);
  let providerDebt = $state(0);
  let providerCount = $state(0);
  let empPayTotal = $state(0);
  let activeEmpCount = $state(0);
  let attAvg = $state(0);
  let gastoTotal = $state(0);
  let loading = $state(true);

  let categories = $state<ExpenseCategory[]>([]);

  function defaultFrom(): string {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  }
  function defaultTo(): string {
    return new Date().toISOString().slice(0, 10);
  }

  let fromDate = $state(defaultFrom());
  let toDate = $state(defaultTo());
  let categoryId = $state<number | null>(null);

  function formatCurrency(n: number): string {
    return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2 });
  }

  onMount(() => { loadDashboard(); });

  async function loadDashboard() {
    loading = true;
    try {
      const [provs, emps] = await Promise.all([
        cacheStore.fetch('providers', () => api.listProviders(), 900000),
        cacheStore.fetch('employees:active', () => api.listEmployees(true), 900000),
      ]);
      providers = provs;
      employees = emps;

      const allMoves: ProviderMovement[] = [];
      for (const p of provs) {
        try {
          const detail = await api.getProvider(p.id);
          if (detail?.movements) allMoves.push(...detail.movements);
        } catch {}
      }
      providerMoves = allMoves;

      const purchases = allMoves.filter(m => m.type === 'PURCHASE');
      const payments = allMoves.filter(m => m.type === 'PAYMENT');
      const totalPurchases = purchases.reduce((s, m) => s + (m.amount || 0), 0);
      const totalPayments = payments.reduce((s, m) => s + (m.amount || 0), 0);
      providerDebt = totalPurchases - totalPayments;
      providerCount = provs.filter(p => {
        const pMoves = allMoves.filter(m => m.provider_id === p.id);
        const pPurchases = pMoves.filter(m => m.type === 'PURCHASE').reduce((s, m) => s + (m.amount || 0), 0);
        const pPayments = pMoves.filter(m => m.type === 'PAYMENT').reduce((s, m) => s + (m.amount || 0), 0);
        return (pPurchases - pPayments) > 0;
      }).length;

      activeEmpCount = emps.filter(e => e.active).length;
      const filterFrom = fromDate || new Date().toISOString().slice(0, 10);
      const filterTo = toDate || new Date().toISOString().slice(0, 10);
      const recentPays = await api.listEmployeePaymentsRecent(1000);
      empPayTotal = recentPays
        .filter((p: any) => p.date && p.date >= filterFrom && p.date <= filterTo)
        .reduce((s: number, p: any) => s + (p.amount || 0), 0);

      categories = await api.listExpenseCategories();
      const summary = await api.listExpenses({ from_date: filterFrom, to_date: filterTo, limit: 200, exclude_owners: true });
      gastoTotal = summary.reduce((s: number, e: any) => s + e.amount, 0);
      const month = filterFrom.slice(0, 7);
      const attRecords = await api.listAttendance(undefined, month);
      attendanceRecords = attRecords;
      const empDays = new Map<number, { total: number; present: number }>();
      for (const r of attRecords) {
        const g = empDays.get(r.employee_id) || { total: 0, present: 0 };
        g.total++;
        if (r.status === 'PRESENTE' || r.status?.startsWith('PRESENTE')) g.present++;
        empDays.set(r.employee_id, g);
      }
      const vals = Array.from(empDays.values());
      attAvg = vals.length > 0 ? vals.reduce((s, v) => s + (v.present / v.total * 100), 0) / vals.length : 0;
    } catch (e) {
      console.error('Dashboard error:', e);
    } finally {
      loading = false;
    }
  }
</script>

<div class="g-dashboard">
  {#if loading}
    <div class="g-loading">Cargando dashboard...</div>
  {:else}
    <div class="g-filters">
      <input type="date" bind:value={fromDate} />
      <input type="date" bind:value={toDate} />
      <select bind:value={categoryId}>
        <option value={null}>Todas las categorías</option>
        {#each categories as cat}
          <option value={cat.id}>{cat.icon} {cat.name}</option>
        {/each}
      </select>
      <button onclick={loadDashboard}>Buscar</button>
    </div>
    <div class="g-kpis">
      <div class="g-kpi-card">
        <span class="g-kpi-label">Deuda Proveedores</span>
        <span class="g-kpi-value">{formatCurrency(providerDebt)}</span>
        <span class="g-kpi-sub">{providerCount} con deuda</span>
      </div>
      <div class="g-kpi-card">
        <span class="g-kpi-label">Sueldos del Mes</span>
        <span class="g-kpi-value">{formatCurrency(empPayTotal)}</span>
      </div>
      <div class="g-kpi-card">
        <span class="g-kpi-label">Personal Activo</span>
        <span class="g-kpi-value">{activeEmpCount}</span>
        <span class="g-kpi-sub">empleados</span>
      </div>
      <div class="g-kpi-card">
        <span class="g-kpi-label">Asistencia</span>
        <span class="g-kpi-value">{attAvg.toFixed(0)}%</span>
        <span class="g-kpi-sub">{attendanceRecords.length} registros</span>
      </div>
      <div class="g-kpi-card">
        <span class="g-kpi-label">Gastos del período</span>
        <span class="g-kpi-value">{formatCurrency(gastoTotal)}</span>
        <span class="g-kpi-sub">{fromDate} a {toDate}</span>
      </div>
    </div>
    <ExpensesTab {fromDate} {toDate} {categoryId} />
  {/if}
</div>

<style>
  .g-dashboard { display: flex; flex-direction: column; gap: 0.857rem; }
  .g-loading { padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.9rem; }
  .g-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 0.714rem; }
  .g-kpi-card {
    background: var(--bg-card);
    border-radius: 0.571rem;
    padding: 1.2rem 1rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    min-height: 110px;
  }
  .g-kpi-label { font-size: 0.7rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; }
  .g-kpi-value { font-size: 1.4rem; font-weight: 700; color: var(--text-primary); margin: 0.4rem 0; }
  .g-kpi-sub { font-size: 0.75rem; color: var(--text-muted); }
  .g-filters {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .g-filters input, .g-filters select {
    padding: 0.4rem 0.6rem;
    border: 1px solid #ddd;
    border-radius: 0.3rem;
    font-size: 0.85rem;
  }
  .g-filters button {
    padding: 0.4rem 0.8rem;
    border: none;
    background: var(--accent, #3498db);
    color: white;
    border-radius: 0.3rem;
    cursor: pointer;
  }
</style>
