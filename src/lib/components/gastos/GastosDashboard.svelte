<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import type { Provider, Employee, Attendance, ExpenseCategory } from '$lib/types';
  import ExpensesTab from './ExpensesTab.svelte';
  import GIcon from './GIcon.svelte';

  let providers = $state<Provider[]>([]);
  let employees = $state<Employee[]>([]);
  let attendanceRecords = $state<Attendance[]>([]);
  let providerDebt = $state(0);
  let providerCount = $state(0);
  let empPayTotal = $state(0);
  let activeEmpCount = $state(0);
  let attAvg = $state(0);
  let gastoTotal = $state(0);
  let loading = $state(true);

  let categories = $state<ExpenseCategory[]>([]);
  let summaryGroups = $state<Record<string, number>>({});

  function fmt(n: number): string {
    return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2 });
  }

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

  function toIso(d: string): string {
    if (!d) return '';
    if (d.includes('/')) {
      const p = d.split('/');
      return `${p[2]}-${p[1]}-${p[0]}`;
    }
    return d;
  }

  const PRESETS = [
    {
      label: 'Este mes',
      apply: () => {
        const n = new Date();
        fromDate = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`;
        toDate = defaultTo();
        loadDashboard();
      },
    },
    {
      label: 'Últimos 30 días',
      apply: () => { fromDate = defaultFrom(); toDate = defaultTo(); loadDashboard(); },
    },
    {
      label: 'Trimestre',
      apply: () => {
        const n = new Date(); n.setMonth(n.getMonth() - 3);
        fromDate = n.toISOString().slice(0, 10); toDate = defaultTo();
        loadDashboard();
      },
    },
  ];

  const KPIS = [
    { key: 'debt', label: 'Deuda Proveedores', color: '#f59e0b', icon: 'box' },
    { key: 'sueldos', label: 'Sueldos del período', color: '#8b5cf6', icon: 'users' },
    { key: 'personal', label: 'Personal Activo', color: '#3b82f6', icon: 'user' },
    { key: 'asistencia', label: 'Asistencia', color: '#10b981', icon: 'check-circle' },
    { key: 'gastos', label: 'Gastos del período', color: '#ef4444', icon: 'wallet' },
  ];

  let dist = $derived(
    Object.entries(summaryGroups).sort((a, b) => b[1] - a[1]).slice(0, 6)
  );

  function catColor(name: string): string {
    return categories.find(c => c.name === name)?.color || '#94a3b8';
  }

  function catSlug(name: string): string {
    const c = categories.find(x => x.name === name);
    return c ? c.slug : 'varios';
  }

  const CAT_ICON_SLUG: Record<string, string> = {
    luz: 'zap', agua: 'droplet', internet: 'wifi', alquiler: 'home', gas: 'zap',
    limpieza: 'box', seguro: 'check-circle', impuestos: 'file-text', contabilidad: 'bar-chart',
    proveedor: 'box', materia: 'box', herramientas: 'box', mantenimiento: 'activity',
    sueldos: 'users', viáticos: 'truck', flete: 'truck', envío: 'truck', transporte: 'truck',
    combustible: 'zap', comida: 'cart', marketing: 'zap', subscripciones: 'credit-card',
    varios: 'folder',
  };

  function catIconName(name: string): string {
    const slug = catSlug(name);
    if (CAT_ICON_SLUG[slug]) return CAT_ICON_SLUG[slug];
    if (slug.includes('proveedor')) return 'box';
    if (slug.includes('sueldo') || slug.includes('personal')) return 'users';
    return 'folder';
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

      providerDebt = provs.reduce((s, p) => s + (p.balance || 0), 0);
      providerCount = provs.filter(p => (p.balance || 0) > 0).length;
      activeEmpCount = emps.filter(e => e.active).length;

      const filterFrom = fromDate || defaultTo();
      const filterTo = toDate || defaultTo();
      const recentPays = await api.listEmployeePaymentsRecent(2000);
      const ownerIds = new Set(emps.filter(e => e.is_owner === 1).map(e => e.id));
      empPayTotal = recentPays
        .filter((p: any) => {
          const iso = toIso(p.date);
          return iso && iso >= filterFrom && iso <= filterTo && !ownerIds.has(p.employee_id);
        })
        .reduce((s: number, p: any) => s + (p.amount || 0), 0);

      categories = await api.listExpenseCategories();
      const summary = await api.getExpensesSummary(filterFrom, filterTo, 'category', true, categoryId);
      gastoTotal = summary.total;
      summaryGroups = summary.groups;

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

  function kpiValue(key: string): string {
    switch (key) {
      case 'debt': return fmt(providerDebt);
      case 'sueldos': return fmt(empPayTotal);
      case 'personal': return String(activeEmpCount);
      case 'asistencia': return `${attAvg.toFixed(0)}%`;
      case 'gastos': return fmt(gastoTotal);
      default: return '';
    }
  }

  function kpiSub(key: string): string {
    switch (key) {
      case 'debt': return `${providerCount} con deuda`;
      case 'sueldos': return `${fromDate} a ${toDate}`;
      case 'personal': return 'empleados';
      case 'asistencia': return `${attendanceRecords.length} registros`;
      case 'gastos': return `${fromDate} a ${toDate}`;
      default: return '';
    }
  }
</script>

<div class="g-dashboard">
  {#if loading}
    <div class="g-loading">Cargando panel…</div>
  {:else}
    <header class="g-head">
      <div class="g-head-top">
        <div class="g-head-title">
          <span class="g-head-icon"><GIcon name="wallet" size={18} /></span>
          <h2>Panel de Gastos</h2>
        </div>
        <div class="g-presets">
          {#each PRESETS as p}
            <button class="g-preset" onclick={p.apply}>{p.label}</button>
          {/each}
        </div>
      </div>
      <div class="g-filters">
        <div class="g-filter-field">
          <GIcon name="calendar" size={15} />
          <input type="date" bind:value={fromDate} onchange={loadDashboard} aria-label="Desde" />
        </div>
        <div class="g-filter-field">
          <GIcon name="calendar" size={15} />
          <input type="date" bind:value={toDate} onchange={loadDashboard} aria-label="Hasta" />
        </div>
        <select class="g-cat" bind:value={categoryId} onchange={loadDashboard}>
          <option value={null}>Todas las categorías</option>
          {#each categories as cat}
            <option value={cat.id}>{cat.name}</option>
          {/each}
        </select>
        <button class="g-buscar" onclick={loadDashboard}>Buscar</button>
      </div>
    </header>

    <div class="g-kpis">
      {#each KPIS as kpi}
        <div class="g-kpi-card" style={`--kpi: ${kpi.color}`}>
          <span class="g-kpi-icon" style={`background: ${kpi.color}1a; color: ${kpi.color}`}>
            <GIcon name={kpi.icon} size={18} />
          </span>
          <div class="g-kpi-body">
            <span class="g-kpi-label">{kpi.label}</span>
            <span class="g-kpi-value">{kpiValue(kpi.key)}</span>
            <span class="g-kpi-sub">{kpiSub(kpi.key)}</span>
          </div>
        </div>
      {/each}
    </div>

    {#if dist.length > 0}
      <section class="g-dist">
        <div class="g-dist-head">
          <h3><GIcon name="bar-chart" size={15} /> Gastos por categoría</h3>
          <span class="g-dist-total">{fmt(gastoTotal)}</span>
        </div>
        <div class="g-dist-list">
          {#each dist as [name, value]}
            {@const color = catColor(name)}
            {@const pct = gastoTotal > 0 ? Math.round((value / gastoTotal) * 100) : 0}
            <div class="g-dist-row">
              <span class="g-dist-name" style={`color: ${color}`}>
                <GIcon name={catIconName(name)} size={14} />
                <span>{name}</span>
              </span>
              <div class="g-dist-track">
                <div class="g-dist-bar" style={`width: ${pct}%; background: ${color}`}></div>
              </div>
              <span class="g-dist-amount">{fmt(value)}</span>
              <span class="g-dist-pct">{pct}%</span>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <ExpensesTab {fromDate} {toDate} {categoryId} onChanged={loadDashboard} />
  {/if}
</div>

<style>
  .g-dashboard { display: flex; flex-direction: column; gap: 0.857rem; }
  .g-loading { padding: 2rem; text-align: center; color: var(--text-muted); font-size: 0.9rem; }

  .g-head {
    background: var(--bg-card);
    border-radius: 0.714rem;
    padding: 0.857rem 1rem;
    box-shadow: var(--shadow-sm);
    display: flex;
    flex-direction: column;
    gap: 0.714rem;
  }
  .g-head-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.571rem;
  }
  .g-head-title { display: flex; align-items: center; gap: 0.571rem; }
  .g-head-title h2 { margin: 0; font-size: 1.15rem; color: var(--text-primary); }
  .g-head-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 0.5rem;
    background: var(--accent-light);
    color: var(--accent);
  }
  .g-presets { display: flex; gap: 0.286rem; }
  .g-preset {
    padding: 0.286rem 0.714rem;
    border: 1px solid var(--border);
    background: var(--bg-card);
    color: var(--text-secondary);
    border-radius: 0.357rem;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
  }
  .g-preset:hover { background: var(--bg-hover); color: var(--text-primary); }

  .g-filters { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
  .g-filter-field {
    position: relative;
    display: flex;
    align-items: center;
  }
  .g-filter-field svg {
    position: absolute;
    left: 0.571rem;
    color: var(--text-muted);
    pointer-events: none;
  }
  .g-filter-field input {
    padding: 0.429rem 0.571rem 0.429rem 1.9rem;
    border: 1px solid var(--border);
    border-radius: 0.357rem;
    font-size: 0.85rem;
    background: var(--bg-page);
    color: var(--text-primary);
  }
  .g-cat {
    padding: 0.429rem 0.571rem;
    border: 1px solid var(--border);
    border-radius: 0.357rem;
    font-size: 0.85rem;
    background: var(--bg-page);
    color: var(--text-primary);
  }
  .g-buscar {
    padding: 0.429rem 1rem;
    border: none;
    background: var(--accent);
    color: white;
    border-radius: 0.357rem;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .g-buscar:hover { background: var(--accent-hover); }

  .g-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.714rem; }
  .g-kpi-card {
    background: var(--bg-card);
    border-radius: 0.714rem;
    padding: 1rem;
    box-shadow: var(--shadow-sm);
    border-left: 0.214rem solid var(--kpi);
    display: flex;
    gap: 0.714rem;
    align-items: flex-start;
  }
  .g-kpi-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.4rem;
    height: 2.4rem;
    border-radius: 0.571rem;
    flex-shrink: 0;
  }
  .g-kpi-body { display: flex; flex-direction: column; min-width: 0; }
  .g-kpi-label { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.02em; color: var(--text-muted); font-weight: 700; }
  .g-kpi-value { font-size: 1.35rem; font-weight: 800; color: var(--text-primary); line-height: 1.25; word-break: break-word; }
  .g-kpi-sub { font-size: 0.75rem; color: var(--text-muted); }

  .g-dist {
    background: var(--bg-card);
    border-radius: 0.714rem;
    padding: 0.857rem 1rem;
    box-shadow: var(--shadow-sm);
  }
  .g-dist-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.714rem;
  }
  .g-dist-head h3 {
    margin: 0;
    font-size: 0.85rem;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 0.429rem;
  }
  .g-dist-total { font-family: var(--font-mono); font-weight: 700; font-size: 0.9rem; color: var(--text-secondary); }
  .g-dist-list { display: flex; flex-direction: column; gap: 0.571rem; }
  .g-dist-row {
    display: grid;
    grid-template-columns: 9rem 1fr 6.5rem 2.5rem;
    gap: 0.714rem;
    align-items: center;
  }
  .g-dist-name {
    display: flex;
    align-items: center;
    gap: 0.357rem;
    font-size: 0.82rem;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .g-dist-track {
    height: 0.429rem;
    background: var(--bg-hover);
    border-radius: 0.357rem;
    overflow: hidden;
  }
  .g-dist-bar { height: 100%; border-radius: 0.357rem; transition: width 0.3s ease; }
  .g-dist-amount { font-family: var(--font-mono); font-size: 0.82rem; font-weight: 600; text-align: right; color: var(--text-primary); }
  .g-dist-pct { font-size: 0.78rem; text-align: right; color: var(--text-muted); }
</style>
