<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import type { Provider, ProviderMovement, Employee, Attendance } from '$lib/types';

  let providers = $state<Provider[]>([]);
  let employees = $state<Employee[]>([]);
  let providerMoves = $state<ProviderMovement[]>([]);
  let attendanceRecords = $state<Attendance[]>([]);
  let providerDebt = $state(0);
  let providerCount = $state(0);
  let empPayTotal = $state(0);
  let activeEmpCount = $state(0);
  let attAvg = $state(0);
  let loading = $state(true);

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
      const currMonth = new Date().toISOString().slice(0, 7);
      const recentPays = await api.listEmployeePaymentsRecent(1000);
      empPayTotal = recentPays
        .filter((p: any) => (p.date || '').startsWith(currMonth))
        .reduce((s: number, p: any) => s + (p.amount || 0), 0);

      const attRecords = await api.listAttendance(undefined, currMonth);
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
    </div>
    <div class="g-dash-actions">
      <button class="btn btn-sm btn-secondary" onclick={loadDashboard}>🔄 Refrescar</button>
    </div>
  {/if}
</div>

<style>
  .g-dashboard { display: flex; flex-direction: column; gap: 0.857rem; }
  .g-loading { padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.9rem; }
  .g-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.714rem; }
  .g-kpi-card { background: var(--bg-card); border-radius: 0.571rem; padding: 1rem; box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06); }
  .g-kpi-label { font-size: 0.7rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; }
  .g-kpi-value { font-size: 1.3rem; font-weight: 700; color: var(--text-primary); }
  .g-kpi-sub { font-size: 0.75rem; color: var(--text-muted); }
  .g-dash-actions { display: flex; gap: 0.571rem; }
</style>
