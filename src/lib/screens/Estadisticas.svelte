<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api } from '$lib/api/client';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import type { Factura } from '$lib/types';
  import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend, LineController, LineElement, PointElement } from 'chart.js';
  import ChartDataLabels from 'chartjs-plugin-datalabels';
  Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend, LineController, LineElement, PointElement, ChartDataLabels);

  const monthSectionPlugin = {
    id: 'monthSection',
    afterDraw(chart: Chart) {
      const opts = (chart as any).options?.plugins?.monthSection as { sections: { label: string; start: number; end: number }[] } | undefined;
      if (!opts?.sections?.length) return;
      const { ctx, data, chartArea: { top, bottom }, scales: { x } } = chart;
      if (!x) return;
      ctx.save();
      ctx.font = '600 13px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#2c3e50';
      ctx.textAlign = 'center';
      for (const sec of opts.sections) {
        const x1 = x.getPixelForValue(sec.start);
        const lastIdx = Math.min(sec.end, (data?.labels?.length || 1) - 1);
        const x2 = x.getPixelForValue(lastIdx);
        const w = (x2 || x1) - x1;
        if (w > 0) {
          ctx.fillStyle = '#f0f1f5';
          ctx.fillRect(x1 - 4, top - 26, w + 8, 22);
          ctx.fillStyle = '#2c3e50';
        }
        ctx.fillText(sec.label, x1 + w / 2, top - 10);
        if (sec.end < (data?.labels?.length || 0) - 1) {
          ctx.strokeStyle = '#e0e0e0';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(x2, top - 26);
          ctx.lineTo(x2, bottom);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      ctx.restore();
    }
  };
  Chart.register(monthSectionPlugin);

  let loading = $state(false);

  let startDate = $state('');
  let endDate = $state('');
  let viewType = $state('Mensual');

  let facturas = $state<Factura[]>([]);
  let filteredFacturas = $state<Factura[]>([]);

  let kpis = $state<{ label: string; value: string; change: string; arrow: string; color: string }[]>([]);
  let kpiDefs = $state<{ current: number; previous: number }[]>([{ current: 0, previous: 0 }, { current: 0, previous: 0 }, { current: 0, previous: 0 }, { current: 0, previous: 0 }]);

  interface ChartBar { label: string; value: number; }
  let chartData = $state<ChartBar[]>([]);
  let chartSections = $state<{ label: string; start: number; end: number }[]>([]);
  let chartTitle = $state('');

  let topClientes = $state<{ cliente: string; total: number; unidades: number }[]>([]);
  let topProductos = $state<{ producto: string; total: number; unidades: number }[]>([]);

  let globalVentasTotal = $state(0);
  let globalUnidadesTotal = $state(0);
  let globalCantidad = $derived(facturas.length);
  let globalTicketProm = $derived(facturas.length > 0 ? Math.round(globalVentasTotal / facturas.length) : 0);

  interface MonthlyRow {
    label: string;
    sortKey: string;
    total: number;
    count: number;
    avg: number;
    prevTotal: number;
    change: number;
  }
  let monthlyTable = $state<MonthlyRow[]>([]);

  let forecastDiasTranscurridos = $state(0);
  let forecastDiasTotales = $state(0);
  let forecastPromedioDiario = $state(0);
  let forecastProyeccion = $state(0);
  let forecastVentasActuales = $state(0);

  let metaMensual = $state(0);
  let metaInputValue = $state('');
  let metaEditable = $state(false);

  const STORAGE_PREFIX = 'est_meta_';

  function getMetaKey(): string {
    const now = new Date();
    return `${STORAGE_PREFIX}${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  function loadMeta() {
    const key = getMetaKey();
    const stored = localStorage.getItem(key);
    if (stored) {
      metaMensual = parseFloat(stored) || 0;
    } else {
      metaMensual = Math.round(forecastProyeccion * 1.1);
    }
    metaInputValue = metaMensual > 0 ? metaMensual.toString() : '';
  }

  function saveMeta() {
    const val = parseFloat(metaInputValue) || 0;
    metaMensual = val;
    localStorage.setItem(getMetaKey(), String(val));
    metaEditable = false;
  }

  function startEditMeta() {
    metaInputValue = metaMensual > 0 ? metaMensual.toString() : '';
    metaEditable = true;
  }

  let metaPorcentaje = $derived(metaMensual > 0 ? Math.min((forecastVentasActuales / metaMensual) * 100, 100) : 0);
  let metaRestante = $derived(Math.max(metaMensual - forecastVentasActuales, 0));

  function getDefaultDates(): { start: string; end: string } {
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    const start = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString().slice(0, 10);
    return { start, end };
  }

  function parseDate(s: string): Date {
    if (!s) return new Date();
    if (s.includes('/')) {
      const p = s.split('/');
      if (p.length === 3) {
        const d = new Date(+p[2], +p[1] - 1, +p[0]);
        if (!isNaN(d.getTime())) return d;
      }
    }
    const d = new Date(s);
    return isNaN(d.getTime()) ? new Date() : d;
  }

  function formatCurrency(n: number): string {
    return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function getWeekNumber(d: Date): number {
    const start = new Date(d.getFullYear(), 0, 1);
    return Math.ceil(((+d - +start) / 86400000 + start.getDay() + 1) / 7);
  }

  function getWeekOfMonth(d: Date): number {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    return Math.ceil((d.getDate() + start.getDay()) / 7);
  }

  function monthName(d: Date): string {
    return ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][d.getMonth()];
  }

  function fullMonthName(d: Date): string {
    return ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'][d.getMonth()];
  }

  function groupKey(d: Date): string {
    if (viewType === 'Diario') return `${d.getDate()}/${d.getMonth()+1}`;
    if (viewType === 'Semanal') return `S${getWeekNumber(d)} ${monthName(d)}`;
    if (viewType === 'Mensual') return `${monthName(d)} ${String(d.getFullYear()).slice(2)}`;
    return String(d.getFullYear());
  }

  function groupSortKey(d: Date): string {
    return d.toISOString().slice(0, 7);
  }

  function setPreset(p: string) {
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    let start: string;
    if (p === '7days') start = new Date(now.getTime() - 7 * 864e5).toISOString().slice(0, 10);
    else if (p === 'month') start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    else if (p === '3months') start = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 10);
    else start = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10);
    startDate = start; endDate = end; applyFilters();
  }

  let rangeDays = $derived(startDate && endDate
    ? Math.round((parseDate(endDate).getTime() - parseDate(startDate).getTime()) / 864e5) + 1
    : 0);

  async function loadData() {
    loading = true;
    try {
      cacheStore.invalidate('facturas:estadisticas');
      facturas = await cacheStore.fetch('facturas:estadisticas', () => api.listFacturas({ limit: 2000 }), 60000);
      globalVentasTotal = facturas.reduce((s, f) => s + (f.total || 0), 0);
      globalUnidadesTotal = facturas.reduce((s, f) => s + (f.items || []).reduce((si, it) => si + (it.cantidad || 0), 0), 0);
      computeMonthlyTable();
      computeForecast();
      loadMeta();
      applyFilters();
    } catch (e) {
      console.error(e);
    } finally {
      loading = false;
    }
  }

  function applyFilters() {
    if (!facturas.length) return;

    const s = parseDate(startDate);
    const e = parseDate(endDate);
    e.setHours(23, 59, 59);

    filteredFacturas = facturas.filter(f => {
      const fd = parseDate(f.fecha);
      return fd >= s && fd <= e;
    });

    computeKpis(filteredFacturas);
    computeChart(filteredFacturas);
    computeTopClientes(filteredFacturas);
    computeTopProductos(filteredFacturas);
  }

  function computeKpis(current: Factura[]) {
    const total = current.reduce((s, f) => s + (f.total || 0), 0);
    const cant = current.length;
    const prom = cant > 0 ? total / cant : 0;
    const units = current.reduce((s, f) => s + (f.items || []).reduce((si, it) => si + (it.cantidad || 0), 0), 0);

    const labels = ['Ventas brutas', 'Cantidad de ventas', 'Ticket promedio', 'Unidades vendidas'];
    const formatters = [
      (v: number) => formatCurrency(v),
      (v: number) => String(v),
      (v: number) => formatCurrency(v),
      (v: number) => String(v),
    ];

    const rawKpis = [total, cant, prom, units];
    kpiDefs = [{ current: total, previous: 0 }, { current: cant, previous: 0 }, { current: prom, previous: 0 }, { current: units, previous: 0 }];

    kpis = rawKpis.map((k, i) => ({
      label: labels[i],
      value: formatters[i](k),
      change: '',
      arrow: '—',
      color: '#888',
    }));
  }

  function computeChart(current: Factura[]) {
    if (viewType === 'Semanal') {
      const monthMap = new Map<string, Map<number, { total: number }>>();
      for (const f of current) {
        const d = parseDate(f.fecha);
        const monthKey = d.toISOString().slice(0, 7);
        const week = getWeekOfMonth(d);
        let weeks = monthMap.get(monthKey);
        if (!weeks) { weeks = new Map(); monthMap.set(monthKey, weeks); }
        const g = weeks.get(week) || { total: 0 };
        g.total += f.total || 0;
        weeks.set(week, g);
      }
      const sortedMonths = Array.from(monthMap.keys()).sort();
      const labels: string[] = [];
      const values: number[] = [];
      const sections: { label: string; start: number; end: number }[] = [];
      let idx = 0;
      for (const monthKey of sortedMonths) {
        const weeks = monthMap.get(monthKey)!;
        const sortedWeeks = Array.from(weeks.keys()).sort((a, b) => a - b);
        const d = new Date(parseInt(monthKey), parseInt(monthKey.slice(5)) - 1, 1);
        sections.push({ label: fullMonthName(d), start: idx, end: idx + sortedWeeks.length - 1 });
        for (const week of sortedWeeks) {
          const w = weeks.get(week)!;
          labels.push(`S${week}`);
          values.push(w.total);
          idx++;
        }
      }
      chartData = labels.map((l, i) => ({ label: l, value: values[i] }));
      chartTitle = 'Evolución semanal';
      chartSections = sections;
      return;
    }

    const groups = new Map<string, { total: number; sortKey: string }>();
    for (const f of current) {
      const d = parseDate(f.fecha);
      const key = groupKey(d);
      const sk = groupSortKey(d);
      const g = groups.get(key) || { total: 0, sortKey: sk };
      g.total += f.total || 0;
      groups.set(key, g);
    }

    const sorted = Array.from(groups.entries())
      .map(([label, g]) => ({ label, value: g.total, sortKey: g.sortKey }))
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    chartData = sorted.map(s => ({ label: s.label, value: s.value }));
    chartTitle = `Evolución ${viewType.toLowerCase()}`;
    chartSections = [];
  }

  function computeTopClientes(current: Factura[]) {
    const agg = new Map<string, { total: number; units: number }>();
    for (const f of current) {
      const name = f.cliente_nombre || 'Desconocido';
      const g = agg.get(name) || { total: 0, units: 0 };
      g.total += f.total || 0;
      g.units += (f.items || []).reduce((s, it) => s + (it.cantidad || 0), 0);
      agg.set(name, g);
    }
    topClientes = Array.from(agg.entries())
      .map(([cliente, v]) => ({ cliente, total: v.total, unidades: v.units }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 50);
  }

  function computeTopProductos(current: Factura[]) {
    const agg = new Map<string, { total: number; units: number }>();
    for (const f of current) {
      for (const it of (f.items || [])) {
        const desc = it.descripcion || 'Sin descripción';
        const g = agg.get(desc) || { total: 0, units: 0 };
        g.total += it.total || 0;
        g.units += it.cantidad || 0;
        agg.set(desc, g);
      }
    }
    topProductos = Array.from(agg.entries())
      .map(([producto, v]) => ({ producto, total: v.total, unidades: v.units }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 50);
  }

  function fechaToKey(s: string): string | null {
    if (!s) return null;
    if (s.includes('/')) {
      const p = s.split('/');
      if (p.length === 3) {
        const y = p[2], m = p[1].padStart(2, '0');
        return `${y}-${m}`;
      }
    }
    if (s.length >= 7 && s.includes('-')) {
      return s.slice(0, 7);
    }
    return null;
  }

  function computeMonthlyTable() {
    if (!facturas.length) { monthlyTable = []; return; }

    const agg = new Map<string, { total: number; count: number }>();
    for (const f of facturas) {
      const key = fechaToKey(f.fecha);
      if (!key) continue;
      const g = agg.get(key) || { total: 0, count: 0 };
      g.total += f.total || 0;
      g.count += 1;
      agg.set(key, g);
    }

    const sorted = Array.from(agg.entries()).sort((a, b) => b[0].localeCompare(a[0]));

    monthlyTable = sorted.map(([key, v], i) => {
      const [y, m] = key.split('-');
      const d = new Date(parseInt(y), parseInt(m) - 1, 1);
      const label = `${monthName(d)} ${y.slice(2)}`;
      const avg = v.count > 0 ? v.total / v.count : 0;
      const prev = i < sorted.length - 1 ? sorted[i + 1][1].total : 0;
      const change = prev > 0 ? ((v.total - prev) / prev) * 100 : (v.total > 0 ? 100 : 0);
      return { label, sortKey: key, total: v.total, count: v.count, avg, prevTotal: prev, change };
    });
  }

  function computeForecast() {
    if (!facturas.length) return;

    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const monthKey = now.toISOString().slice(0, 7);

    forecastDiasTranscurridos = now.getDate();
    forecastDiasTotales = new Date(year, month + 1, 0).getDate();

    forecastVentasActuales = facturas
      .filter(f => fechaToKey(f.fecha) === monthKey)
      .reduce((s, f) => s + (f.total || 0), 0);

    forecastPromedioDiario = forecastDiasTranscurridos > 0
      ? forecastVentasActuales / forecastDiasTranscurridos
      : 0;

    forecastProyeccion = Math.round(forecastPromedioDiario * forecastDiasTotales);
  }

  let monthlyTableSum = $derived(monthlyTable.reduce((s, r) => s + r.total, 0));

  let canvasEl: HTMLCanvasElement;
  let chartInstance: Chart | null = null;

  function buildChart() {
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }
    if (!canvasEl || chartData.length === 0) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    const isLine = viewType === 'Diario';

    const grad = ctx.createLinearGradient(0, 0, 0, 300);
    grad.addColorStop(0, '#4361ee');
    grad.addColorStop(1, isLine ? '#a0b4ff' : '#7c94f5');

    const dataset: any = {
      label: '',
      data: chartData.map(d => d.value),
    };
    if (isLine) {
      dataset.borderColor = '#4361ee';
      dataset.backgroundColor = grad;
      dataset.fill = true;
      dataset.tension = 0.3;
      dataset.pointRadius = 3;
      dataset.pointBackgroundColor = '#4361ee';
      dataset.pointBorderColor = '#fff';
      dataset.pointBorderWidth = 2;
      dataset.pointHoverRadius = 5;
    } else {
      dataset.backgroundColor = grad;
      dataset.borderRadius = 6;
      dataset.borderSkipped = false;
      dataset.maxBarThickness = 48;
    }

    chartInstance = new Chart(canvasEl, {
      type: isLine ? 'line' : 'bar',
      data: { labels: chartData.map(d => d.label), datasets: [dataset] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800, easing: 'easeOutQuart' },
        layout: { padding: { bottom: 10, top: chartSections.length > 0 ? 36 : 10 } },
        plugins: {
          monthSection: { sections: chartSections },
          legend: { display: false },
          tooltip: {
            backgroundColor: '#2c3e50',
            padding: 10,
            cornerRadius: 8,
            titleFont: { size: 12, weight: '600' },
            bodyFont: { size: 12 },
            displayColors: false,
            callbacks: { label: (ctx: any) => '$' + ctx.parsed.y.toLocaleString('es-AR') }
          },
          datalabels: isLine ? false : {
            anchor: 'end',
            align: 'top',
            color: '#2c3e50',
            font: { size: 10, weight: '600' },
            formatter: (v: number) => { if (v <= 0) return ''; if (v >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'M'; if (v >= 1000) return '$' + (v / 1000).toFixed(0) + 'k'; return '$' + v; }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: '#f0f1f5', drawBorder: false },
            ticks: { color: '#999', font: { size: 11 }, callback: (val: any) => '$' + Number(val).toLocaleString('es-AR') }
          },
          x: {
            grid: { display: false },
            ticks: { color: '#666', font: { size: 11, weight: '600' }, maxRotation: 45, autoSkip: true, maxTicksLimit: isLine ? 15 : 30 }
          }
        }
      }
    });
  }

  $effect(() => { chartData; canvasEl; buildChart(); });

  onDestroy(() => { if (chartInstance) chartInstance.destroy(); });

  onMount(() => {
    const d = getDefaultDates();
    startDate = d.start;
    endDate = d.end;
    loadData();
  });
</script>

<div class="estadisticas">
  <div class="est-toolbar">
    <div class="preset-row">
      <button class="preset-btn" onclick={() => setPreset('7days')} class:preset-active={rangeDays === 7}>7d</button>
      <button class="preset-btn" onclick={() => setPreset('month')} class:preset-active={rangeDays >= 28 && rangeDays <= 31}>Mes</button>
      <button class="preset-btn" onclick={() => setPreset('3months')} class:preset-active={rangeDays >= 85 && rangeDays <= 95}>3 meses</button>
      <button class="preset-btn" onclick={() => setPreset('year')} class:preset-active={rangeDays >= 360}>Año</button>
    </div>
    <div class="filter-group">
      <input type="date" bind:value={startDate} aria-label="Desde" />
    </div>
    <div class="filter-group">
      <input type="date" bind:value={endDate} aria-label="Hasta" />
    </div>
    <div class="filter-group">
      <select bind:value={viewType}>
        <option value="Diario">Diario</option>
        <option value="Semanal">Semanal</option>
        <option value="Mensual">Mensual</option>
        <option value="Anual">Anual</option>
      </select>
    </div>
    <button class="btn btn-sm btn-primary" onclick={applyFilters}>Aplicar</button>
    {#if rangeDays > 0}
      <span class="range-info">{rangeDays}d &middot; {chartData.length}b</span>
    {/if}
    <button class="btn btn-sm btn-icon" onclick={loadData} disabled={loading} title="Refrescar">
      {loading ? '⏳' : '🔄'}
    </button>
  </div>

  <div class="est-kpis">
    {#if kpis.length > 0}
      <div class="kpi-card">
        <span class="kpi-label">Ventas brutas</span>
        <span class="kpi-value">{kpis[0].value}</span>
        <span class="kpi-sub">Global: {formatCurrency(globalVentasTotal)} &middot; Tabla: {formatCurrency(monthlyTableSum)}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Cantidad de ventas</span>
        <span class="kpi-value">{kpis[1].value}</span>
        <span class="kpi-sub">Global: {globalCantidad}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Ticket promedio</span>
        <span class="kpi-value">{kpis[2].value}</span>
        <span class="kpi-sub">Global: {formatCurrency(globalTicketProm)}</span>
      </div>
      <div class="kpi-card">
        <span class="kpi-label">Unidades vendidas</span>
        <span class="kpi-value">{kpis[3].value}</span>
        <span class="kpi-sub">Global: {globalUnidadesTotal}</span>
      </div>
    {/if}
    <div class="kpi-card kpi-card-forecast">
      <span class="kpi-label">Pronóstico del mes</span>
      <span class="kpi-value">{formatCurrency(forecastProyeccion)}</span>
      <span class="kpi-sub">
        Prom. diario: {formatCurrency(forecastPromedioDiario)}
        &middot; Día {forecastDiasTranscurridos}/{forecastDiasTotales}
      </span>
    </div>
  </div>

  <div class="est-meta">
    <div class="meta-left">
      <div class="meta-header">
        <span class="meta-title">Meta mensual: {fullMonthName(new Date())}</span>
        {#if metaEditable}
          <div class="meta-edit-group">
            <span class="meta-currency">$</span>
            <input
              type="number"
              class="meta-input"
              bind:value={metaInputValue}
              placeholder="Ingresar meta..."
              onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter') saveMeta(); if (e.key === 'Escape') { metaEditable = false; metaInputValue = metaMensual > 0 ? String(metaMensual) : ''; } }}
            />
            <button class="meta-btn meta-btn-save" onclick={saveMeta}>✓</button>
            <button class="meta-btn meta-btn-cancel" onclick={() => { metaEditable = false; metaInputValue = metaMensual > 0 ? String(metaMensual) : ''; }}>✕</button>
          </div>
        {:else}
          <div class="meta-display-group">
            <span class="meta-amount">{formatCurrency(metaMensual > 0 ? metaMensual : (forecastProyeccion > 0 ? Math.round(forecastProyeccion * 1.1) : 0))}</span>
            <button class="meta-btn meta-btn-edit" onclick={startEditMeta} title="Editar meta">✏️</button>
          </div>
        {/if}
      </div>
      {#if metaMensual > 0}
        <div class="meta-progress-wrap">
          <div class="meta-progress-bar">
            <div class="meta-progress-fill" style="width: {metaPorcentaje}%"></div>
          </div>
          <span class="meta-progress-text">{metaPorcentaje.toFixed(1)}%</span>
        </div>
        <div class="meta-stats">
          <span>Ventas actuales: <strong>{formatCurrency(forecastVentasActuales)}</strong></span>
          <span>Faltante: <strong class="meta-restante">{formatCurrency(metaRestante)}</strong></span>
        </div>
      {/if}
    </div>
    <div class="meta-right">
      <span class="meta-helper-text">
        {metaMensual === 0
          ? 'Definí una meta para hacer seguimiento mensual.'
          : metaPorcentaje >= 100
            ? '¡Meta alcanzada!'
            : `Te faltan ${formatCurrency(metaRestante)} para llegar a la meta.`}
      </span>
    </div>
  </div>

  <div class="est-body">
    <div class="est-main">
      <div class="est-chart-container">
        <h3>{chartTitle}</h3>
        {#if chartData.length === 0}
          <div class="chart-empty">Sin datos para el período</div>
        {:else}
          <div class="chart-wrap">
            <canvas bind:this={canvasEl}></canvas>
          </div>
        {/if}
      </div>

      <div class="est-monthly">
        <h3>Análisis mensual</h3>
        {#if monthlyTable.length === 0}
          <div class="chart-empty">Sin datos</div>
        {:else}
          <div class="est-table-wrap monthly-wrap">
            <table class="est-table">
              <thead>
                <tr>
                  <th>Mes</th>
                  <th class="td-r">Ventas</th>
                  <th class="td-r"># Ventas</th>
                  <th class="td-r">Ticket prom.</th>
                  <th class="td-r">Δ vs anterior</th>
                </tr>
              </thead>
              <tbody>
                {#each monthlyTable as row}
                  <tr>
                    <td class="monthly-month">{row.label}</td>
                    <td class="td-r">{formatCurrency(row.total)}</td>
                    <td class="td-r">{row.count}</td>
                    <td class="td-r">{formatCurrency(row.avg)}</td>
                    <td class="td-r" style="color: {row.change > 0 ? '#27ae60' : row.change < 0 ? '#e74c3c' : '#888'}">
                      {row.change > 0 ? '+' : ''}{row.change.toFixed(1)}%
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>

      <div class="est-tables-row">
        <div class="est-table-section">
          <h3>Top Clientes</h3>
          <div class="est-table-wrap">
            <table class="est-table">
              <thead>
                <tr><th>Cliente</th><th class="td-r">Total</th><th class="td-r">Unid.</th></tr>
              </thead>
              <tbody>
                {#each topClientes.slice(0, 10) as c}
                  <tr>
                    <td>{c.cliente}</td>
                    <td class="td-r">{formatCurrency(c.total)}</td>
                    <td class="td-r">{c.unidades}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
        <div class="est-table-section">
          <h3>Top Productos</h3>
          <div class="est-table-wrap">
            <table class="est-table">
              <thead>
                <tr><th>Producto</th><th class="td-r">Total</th><th class="td-r">Unid.</th></tr>
              </thead>
              <tbody>
                {#each topProductos.slice(0, 10) as p}
                  <tr>
                    <td>{p.producto}</td>
                    <td class="td-r">{formatCurrency(p.total)}</td>
                    <td class="td-r">{p.unidades}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .estadisticas {
    padding: 1.143rem;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.714rem;
    background: #f5f6fa;
    overflow: auto;
  }

  .est-toolbar {
    display: flex;
    gap: 0.571rem;
    align-items: center;
    flex-wrap: wrap;
    background: white;
    padding: 0.571rem 1rem;
    border-radius: 0.571rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }
  .est-toolbar .filter-group {
    display: flex;
    align-items: center;
  }
  .est-toolbar .filter-group input,
  .est-toolbar .filter-group select {
    padding: 0.357rem 0.571rem;
    border: 1px solid #ddd;
    border-radius: 0.357rem;
    font-size: 0.85rem;
    min-width: 7.143rem;
  }

  .preset-row { display: flex; gap: 0.357rem; flex-wrap: wrap; }
  .preset-btn {
    padding: 0.286rem 0.714rem;
    border: 1px solid #ddd;
    background: white;
    border-radius: 1.143rem;
    font-size: 0.78rem;
    font-weight: 500;
    color: #666;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.15s;
  }
  .preset-btn:hover { border-color: #4361ee; color: #4361ee; background: #f0f3ff; }
  .preset-active { background: #4361ee; color: white; border-color: #4361ee; }
  .preset-active:hover { background: #3a56d4; color: white; }
  .range-info { font-size: 0.72rem; color: #888; white-space: nowrap; font-weight: 500; }

  .btn { cursor: pointer; border-radius: 0.357rem; border: none; font-weight: 600; font-family: inherit; font-size: 0.82rem; padding: 0.429rem 0.857rem; }
  .btn-sm { font-size: 0.78rem; padding: 0.357rem 0.714rem; }
  .btn-icon { background: none; padding: 0.357rem; font-size: 1rem; }
  .btn-icon:hover { background: #f0f1f5; }
  .btn-primary { background: #4361ee; color: white; }
  .btn-primary:hover { background: #3a56d4; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .est-kpis {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.714rem;
  }
  .kpi-card {
    background: white;
    border-radius: 0.571rem;
    padding: 1rem 1.143rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .kpi-label { font-size: 0.75rem; text-transform: uppercase; color: #888; font-weight: 600; letter-spacing: 0.036rem; }
  .kpi-value { font-size: 1.5rem; font-weight: 700; color: #2c3e50; margin-top: 0.286rem; line-height: 1.2; }
  .kpi-sub { font-size: 0.68rem; color: #999; margin-top: 0.214rem; }
  .kpi-card-forecast {
    border-left: 0.214rem solid #4361ee;
  }

  .est-meta {
    display: flex;
    gap: 1rem;
    background: white;
    border-radius: 0.571rem;
    padding: 0.857rem 1rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
    align-items: center;
  }
  .meta-left { flex: 1; }
  .meta-header {
    display: flex;
    align-items: center;
    gap: 0.571rem;
    margin-bottom: 0.357rem;
  }
  .meta-title { font-size: 0.78rem; font-weight: 600; color: #2c3e50; }
  .meta-display-group {
    display: flex;
    align-items: center;
    gap: 0.357rem;
  }
  .meta-amount { font-size: 1.1rem; font-weight: 700; color: #4361ee; }
  .meta-edit-group {
    display: flex;
    align-items: center;
    gap: 0.214rem;
  }
  .meta-currency {
    font-size: 0.95rem;
    font-weight: 600;
    color: #555;
  }
  .meta-input {
    width: 7.857rem;
    padding: 0.286rem 0.429rem;
    border: 1px solid #4361ee;
    border-radius: 0.357rem;
    font-size: 0.9rem;
    font-family: monospace;
    outline: none;
  }
  .meta-input:focus { border-color: #3a56d4; box-shadow: 0 0 0 0.143rem rgba(67, 97, 238, 0.15); }
  .meta-btn {
    border: none;
    cursor: pointer;
    border-radius: 0.286rem;
    font-size: 0.78rem;
    padding: 0.214rem 0.429rem;
    background: none;
  }
  .meta-btn-save { color: #27ae60; }
  .meta-btn-save:hover { background: #f0fdf4; }
  .meta-btn-cancel { color: #e74c3c; }
  .meta-btn-cancel:hover { background: #fef2f2; }
  .meta-btn-edit { color: #888; }
  .meta-btn-edit:hover { color: #555; background: #f5f5f5; }

  .meta-progress-wrap {
    display: flex;
    align-items: center;
    gap: 0.571rem;
  }
  .meta-progress-bar {
    flex: 1;
    height: 0.5rem;
    background: #e9ecef;
    border-radius: 0.286rem;
    overflow: hidden;
  }
  .meta-progress-fill {
    height: 100%;
    background: linear-gradient(90deg, #4361ee, #3a56d4);
    border-radius: 0.286rem;
    transition: width 0.5s ease;
    min-width: 0.143rem;
  }
  .meta-progress-text {
    font-size: 0.78rem;
    font-weight: 700;
    color: #4361ee;
    min-width: 3.571rem;
    text-align: right;
  }
  .meta-stats {
    display: flex;
    gap: 1.429rem;
    margin-top: 0.286rem;
    font-size: 0.72rem;
    color: #888;
  }
  .meta-stats strong { color: #555; }
  .meta-restante { color: #e67e22; }
  .meta-right { flex-shrink: 0; }
  .meta-helper-text {
    font-size: 0.72rem;
    color: #aaa;
    font-style: italic;
  }

  .est-body {
    display: flex;
    gap: 0.714rem;
    flex: 1;
    min-height: 0;
  }

  .est-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.714rem;
    min-width: 0;
  }

  .est-chart-container {
    background: white;
    border-radius: 0.571rem;
    padding: 1rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }
  .est-chart-container h3 {
    margin: 0 0 0.714rem;
    font-size: 0.9rem;
    color: #2c3e50;
  }
  .chart-empty { text-align: center; padding: 1.429rem; color: #bbb; }
  .chart-wrap { position: relative; height: 300px; width: 100%; }
  @media (max-width: 600px) { .chart-wrap { height: 220px; } }

  .est-monthly {
    background: white;
    border-radius: 0.571rem;
    padding: 1rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }
  .est-monthly h3 {
    margin: 0 0 0.714rem;
    font-size: 1rem;
    color: #2c3e50;
  }
  .monthly-wrap { max-height: none; }
  .monthly-month { font-weight: 700; font-size: 0.92rem; color: #2c3e50; }

  .est-tables-row {
    display: flex;
    gap: 0.714rem;
  }
  .est-table-section {
    flex: 1;
    background: white;
    border-radius: 0.571rem;
    padding: 0.714rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }
  .est-table-section h3 {
    margin: 0 0 0.429rem;
    font-size: 0.82rem;
    color: #2c3e50;
  }

  .est-table-wrap {
    max-height: none;
    overflow: auto;
  }
  .est-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.92rem;
  }
  .est-table th {
    background: #f8f9fa;
    padding: 0.571rem 0.714rem;
    text-align: left;
    font-weight: 600;
    color: #555;
    font-size: 0.82rem;
    text-transform: uppercase;
    position: sticky;
    top: 0;
    border-bottom: 1px solid #ddd;
  }
  .est-table td {
    padding: 0.5rem 0.714rem;
    border-bottom: 1px solid #f0f1f5;
  }
  .td-r { text-align: right; font-family: monospace; }
  .td-date { font-family: monospace; font-size: 0.72rem; }
  .td-num { font-family: monospace; font-size: 0.72rem; }
</style>
