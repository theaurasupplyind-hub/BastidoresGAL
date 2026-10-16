<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api } from '$lib/api/client';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import { facturasActivas, diasDemoraEntrega, diaEntregaFactura, normalizarProducto, mediana, percentil, clasificarTipoPedido, baseAgrupada, TIPOS_PEDIDO } from '$lib/utils/facturas';
  import type { TipoPedido } from '$lib/utils/facturas';
  import { formatEntregadoAt } from '$lib/types';
  import type { Factura, Cliente } from '$lib/types';
  import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend, LineController, LineElement, PointElement } from 'chart.js';
  import ChartDataLabels from 'chartjs-plugin-datalabels';
  Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend, LineController, LineElement, PointElement, ChartDataLabels);

  const monthSectionPlugin = {
    id: 'monthSection',
    afterDraw(chart: Chart) {
      const sections = chart.options.plugins?.monthSection?.sections;
      if (!sections?.length) return;
      const { ctx, data, chartArea: { top, bottom }, scales: { x } } = chart;
      if (!x) return;
      ctx.save();
      ctx.font = '600 13px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#2c3e50';
      ctx.textAlign = 'center';
      for (const sec of sections) {
        const { label, start, end } = sec;
        if (start == null || end == null || !label) continue;
        const x1 = x.getPixelForValue(start);
        const lastIdx = Math.min(end, (data?.labels?.length || 1) - 1);
        const x2 = x.getPixelForValue(lastIdx);
        const w = (x2 || x1) - x1;
        if (w > 0) {
          ctx.fillStyle = '#f0f1f5';
          ctx.fillRect(x1 - 4, top - 26, w + 8, 22);
          ctx.fillStyle = '#2c3e50';
        }
        ctx.fillText(label, x1 + w / 2, top - 10);
        if (end < (data?.labels?.length || 0) - 1) {
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
  type EstTab = 'ventas' | 'entregas';
  let activeTab = $state<EstTab>('ventas');

  let startDate = $state('');
  let endDate = $state('');
  let viewType = $state('Mensual');

  let facturas = $state<Factura[]>([]);
  let facturasRec = $state<Factura[]>([]);
  let filteredFacturas = $state<Factura[]>([]);

  let kpis = $state<{ label: string; value: string; change: string; arrow: string; color: string }[]>([]);
  let kpiDefs = $state<{ current: number; previous: number }[]>([{ current: 0, previous: 0 }, { current: 0, previous: 0 }, { current: 0, previous: 0 }, { current: 0, previous: 0 }]);

  interface ChartBar { label: string; value: number; }
  let chartData = $state<ChartBar[]>([]);
  let chartSections = $state<{ label: string; start: number; end: number }[]>([]);
  let chartTitle = $state('');

  let topClientes = $state<{ cliente: string; total: number; unidades: number }[]>([]);
  let topProductos = $state<{ producto: string; total: number; unidades: number }[]>([]);

  // ── Tiempos de entrega (tab Entregas) ──
  // Nota perf: el dataset crudo vive en $state.raw (sin proxy profundo) y el
  // cálculo es single-pass O(n). La key de caché NO empieza con 'facturas' para
  // que los invalidate('facturas') del resto de la app no la borren.
  interface EntregaRow { id: number; numero: string; cliente: string; fecha: string; entregado: string; dias: number | null; itemsN: number; valida: boolean; }
  interface ProdDemora { producto: string; display: string; facturas: number; unidades: number; prom: number; med: number | null; p90: number | null; }
  interface TipoDemoraDetalle { key: string; display: string; facturas: number; unidades: number; prom: number | null; med: number | null; quitado: boolean; manual: boolean; auto: TipoPedido; }
  interface TipoDemora { key: TipoPedido; label: string; hint: string; facturas: number; solo: number; unidades: number; prom: number | null; med: number | null; p90: number | null; detalle: TipoDemoraDetalle[]; }
  interface MesEntrega { key: string; label: string; n: number; prom: number | null; med: number | null; }
  const ENTREGAS_CACHE_KEY = 'entregas-anual-v1';
  const ENTREGAS_LIMIT = 3000;
  let entregasCache = $state.raw<Factura[]>([]);
  let entregasLoaded = $state(false);
  let entregasLoading = $state(false);
  let entregasError = $state('');
  let entregasTruncada = $state(false);
  let entregasRows = $state<EntregaRow[]>([]);
  let entregasKpi = $state({ n: 0, prom: null as number | null, med: null as number | null, p90: null as number | null, le7: 0, le15: 0, gt30: 0, pendientes: 0, invalidas: 0, pctLe7: 0 });
  let entregasBuckets = $state<{ label: string; n: number; pct: number }[]>([]);
  let entregasMensual = $state<MesEntrega[]>([]);
  let entregasProductos = $state<ProdDemora[]>([]);
  let entregasTipos = $state<TipoDemora[]>([]);
  let tiposExpand = $state<Record<string, boolean>>({});
  // Ajustes manuales por subgrupo: base-key → tipo destino o '__quitar' (excluir).
  // Persisten en localStorage de esta máquina.
  const TIPOS_OV_KEY = 'ent_tipos_overrides_v1';
  function loadTiposOverrides(): Record<string, TipoPedido | '__quitar'> {
    try { return JSON.parse(localStorage.getItem(TIPOS_OV_KEY) || '{}'); } catch { return {}; }
  }
  let tiposOverrides = $state<Record<string, TipoPedido | '__quitar'>>(loadTiposOverrides());
  function saveTiposOverrides() {
    try { localStorage.setItem(TIPOS_OV_KEY, JSON.stringify(tiposOverrides)); } catch {}
  }
  function moverSubgrupo(key: string, v: string, auto: TipoPedido) {
    if (v === auto) delete tiposOverrides[key];
    else tiposOverrides[key] = v as TipoPedido | '__quitar';
    saveTiposOverrides();
    buildEntregasView();
  }
  function revertirSubgrupo(key: string) {
    delete tiposOverrides[key];
    saveTiposOverrides();
    buildEntregasView();
  }
  let entregasMinN = $state(3);
  let entregasSort = $state<'prom' | 'facturas'>('prom');
  let entregasMinNTimer: ReturnType<typeof setTimeout> | null = null;

  let clientes = $state<Cliente[]>([]);
  let totalClientes = $state(0);
  let clientesActivos = $state(0);

  // ── Recurrencia de clientes ──
  type RecPeriod = '6m' | '12m' | '24m' | 'all';
  type RecCountMode = 'ocasiones' | 'facturas';

  let recPeriod = $state<RecPeriod>('12m');
  let recCountMode = $state<RecCountMode>('ocasiones');

  const REC_GAP_DIAS = 90;

  interface RecSegmento { label: string; clientes: number; pct: number; }
  interface RecTopRow {
    cliente: string;
    compras: number;
    facturas: number;
    facturacion: number;
    ticketProm: number;
    primera: number;
    ultima: number;
    diasProm: number | null;
  }
  interface RecAltaRow {
    cliente: string;
    compras: number;
    facturacion: number;
    ultima: number;
    diasProm: number | null;
  }
  interface RecurrenciaData {
    periodoLabel: string;
    totalFacturasPeriodo: number;
    totalOcasionesPeriodo: number;
    totalFacturacion: number;
    facturasSinCliente: number;
    activos: number;
    recurrentes: number;
    unicos: number;
    tasaRecurrencia: number;
    tasaUnica: number;
    comprasPromedio: number;
    totalCompras: number;
    facturacionRecurrentes: number;
    pctFacturacionRecurrentes: number;
    nuevos: number;
    facturacionNuevos: number;
    pctFacturacionNuevos: number;
    nuevosAplica: boolean;
    recuperados: number;
    recuperadosAplica: boolean;
    intervaloPromedio: number | null;
    intervalosCount: number;
    segmentos: RecSegmento[];
    topRecurrentes: RecTopRow[];
    altaFrecuencia: RecAltaRow[];
    interpretacion: string;
  }

  let recurrencia = $state<RecurrenciaData>({
    periodoLabel: '', totalFacturasPeriodo: 0, totalOcasionesPeriodo: 0, totalFacturacion: 0,
    facturasSinCliente: 0, activos: 0, recurrentes: 0, unicos: 0, tasaRecurrencia: 0, tasaUnica: 0,
    comprasPromedio: 0, totalCompras: 0, facturacionRecurrentes: 0, pctFacturacionRecurrentes: 0,
    nuevos: 0, facturacionNuevos: 0, pctFacturacionNuevos: 0, nuevosAplica: true,
    recuperados: 0, recuperadosAplica: true, intervaloPromedio: null, intervalosCount: 0,
    segmentos: [], topRecurrentes: [], altaFrecuencia: [], interpretacion: '',
  });

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

  function toLocalDateStr(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function getDefaultDates(): { start: string; end: string } {
    const now = new Date();
    const end = toLocalDateStr(now);
    const start = toLocalDateStr(new Date(now.getFullYear() - 1, now.getMonth(), 1));
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
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
      const p = s.split('-');
      const d = new Date(+p[0], +p[1] - 1, +p[2]);
      if (!isNaN(d.getTime())) return d;
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
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function setPreset(p: string) {
    const now = new Date();
    const end = toLocalDateStr(now);
    let start: string;
    if (p === '7days') start = toLocalDateStr(new Date(now.getTime() - 7 * 864e5));
    else if (p === 'month') start = toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
    else if (p === '3months') start = toLocalDateStr(new Date(now.getFullYear(), now.getMonth() - 2, 1));
    else start = toLocalDateStr(new Date(now.getFullYear(), 0, 1));
    startDate = start; endDate = end; applyFilters();
  }

  let rangeDays = $derived(startDate && endDate
    ? Math.round((parseDate(endDate).getTime() - parseDate(startDate).getTime()) / 864e5) + 1
    : 0);

  async function loadData() {
    loading = true;
    try {
      cacheStore.invalidate('facturas');
      facturas = facturasActivas(await cacheStore.fetch('facturas', () => api.listFacturas({ limit: 2000 }), 300000));
      facturasRec = facturasActivas(await cacheStore.fetch('facturas:recurrencia', () => api.listFacturas({ limit: 20000, with_items: false }), 300000));
      clientes = await cacheStore.fetch('clientes', () => api.listClientes(), 1800000);
      totalClientes = clientes.length;
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
    if (!facturas.length) {
      filteredFacturas = [];
      clientesActivos = 0;
      return;
    }

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
    clientesActivos = new Set(
      filteredFacturas.map(f => f.cliente_id).filter((x): x is number => x != null)
    ).size;
    // En tab entregas el dataset ya está en memoria: solo refiltrar (sin fetch).
    if (activeTab === 'entregas' && entregasLoaded) buildEntregasView();
  }

  async function switchTab(t: EstTab) {
    activeTab = t;
    if (t !== 'entregas') return;
    if (!entregasLoaded && !entregasLoading) await loadEntregas();
    else if (entregasLoaded) buildEntregasView();
  }

  async function loadEntregas(force = false) {
    if (entregasLoading) return;
    entregasLoading = true;
    entregasError = '';
    try {
      if (force) cacheStore.invalidate(ENTREGAS_CACHE_KEY);
      // 3000 con items (antes 10000): suficiente para el anual y no cuelga Render.
      // Sin filtro de fechas en backend: la cohorte es por entregado_at y se filtra en cliente.
      const all = await cacheStore.fetch(ENTREGAS_CACHE_KEY, () => api.listFacturas({ limit: ENTREGAS_LIMIT, with_items: true }), 300000);
      entregasCache = facturasActivas(all);
      entregasTruncada = all.length >= ENTREGAS_LIMIT;
      entregasLoaded = true;
      buildEntregasView();
    } catch (e) {
      console.error('Error cargando entregas:', e);
      entregasError = (e as Error)?.message || 'Error al cargar entregas';
    } finally {
      entregasLoading = false;
    }
  }

  function onMinNInput() {
    if (entregasMinNTimer) clearTimeout(entregasMinNTimer);
    entregasMinNTimer = setTimeout(() => { if (entregasLoaded) buildEntregasView(); }, 400);
  }

  function setEntregasSort(s: 'prom' | 'facturas') {
    if (entregasSort === s) return;
    entregasSort = s;
    if (entregasLoaded) buildEntregasView();
  }

  // Single-pass O(n): una sola recorrida calcula filas + mensual + productos.
  // Sin base.find() (era O(n²)) y sin re-parsear la misma factura 3 veces.
  function buildEntregasView() {
    const base = entregasCache.length ? entregasCache : facturas;
    const s = parseDate(startDate);
    const e = parseDate(endDate);
    e.setHours(23, 59, 59);
    s.setHours(0, 0, 0, 0);

    const rows: EntregaRow[] = [];
    const vals: number[] = [];
    const mMap = new Map<string, number[]>();
    const pMap = new Map<string, { display: string; facturas: Set<number>; unidades: number; dias: number[] }>();
    const tMap = new Map<TipoPedido, { facturas: Set<number>; solo: number; unidades: number; dias: number[]; det: Map<string, { display: string; facturas: Set<number>; unidades: number; dias: number[]; quitado?: boolean; auto?: TipoPedido }> }>();
    let pendientes = 0;
    let invalidas = 0;

    for (const f of base) {
      const isEnt = (f.estado_entrega || 'PENDIENTE') === 'ENTREGADO';
      if (!isEnt) {
        const fd = parseDate(f.fecha);
        if (fd >= s && fd <= e) pendientes++;
        continue;
      }
      // Cohorte por fecha de ENTREGA real
      const dEnt = diaEntregaFactura(f);
      if (!dEnt) { invalidas++; continue; }
      if (dEnt < s || dEnt > e) continue;
      const dias = diasDemoraEntrega(f);
      if (dias === null) { invalidas++; continue; }
      vals.push(dias);
      const mKey = `${dEnt.getFullYear()}-${String(dEnt.getMonth() + 1).padStart(2, '0')}`;
      let marr = mMap.get(mKey);
      if (!marr) { marr = []; mMap.set(mKey, marr); }
      marr.push(dias);
      const items = f.items || [];
      const tiposEnFactura = new Set<TipoPedido>();
      for (const it of items) {
        const key = normalizarProducto(it.descripcion);
        let g = pMap.get(key);
        if (!g) { g = { display: (it.descripcion || 'Sin descripción').trim(), facturas: new Set(), unidades: 0, dias: [] }; pMap.set(key, g); }
        g.facturas.add(f.id);
        g.unidades += it.cantidad || 0;
        g.dias.push(dias);
        // Tipo híbrido por item (variante detectada + fallback keywords),
        // con override manual por subgrupo (mover de grupo o quitar del cálculo)
        const bg = baseAgrupada(it.descripcion);
        const ov = tiposOverrides[bg.key];
        const auto = clasificarTipoPedido(it.descripcion);
        if (ov === '__quitar') {
          // Quitado: no suma a ningún promedio, pero queda visible para restaurar
          let tm0 = tMap.get(auto);
          if (!tm0) { tm0 = { facturas: new Set(), solo: 0, unidades: 0, dias: [], det: new Map() }; tMap.set(auto, tm0); }
          let dd0 = tm0.det.get(bg.key);
          if (!dd0) {
            const nd0 = { display: bg.display, facturas: new Set<number>(), unidades: 0, dias: [] as number[], quitado: true as boolean, auto };
            tm0.det.set(bg.key, nd0);
            dd0 = nd0;
          }
          dd0.quitado = true;
          dd0.facturas.add(f.id);
          dd0.unidades += it.cantidad || 0;
        } else {
          const tipo = ov ?? auto;
          tiposEnFactura.add(tipo);
          let tm = tMap.get(tipo);
          if (!tm) { tm = { facturas: new Set(), solo: 0, unidades: 0, dias: [], det: new Map() }; tMap.set(tipo, tm); }
          tm.facturas.add(f.id);
          tm.unidades += it.cantidad || 0;
          tm.dias.push(dias);
          // Coincidencia: sub-grupo sin medidas ("Bastidor 50x70 Lienzo Profesional" → "Lienzo Profesional")
          let dd = tm.det.get(bg.key);
          if (!dd) {
            const nd = { display: bg.display, facturas: new Set<number>(), unidades: 0, dias: [] as number[], quitado: false as boolean, auto };
            tm.det.set(bg.key, nd);
            dd = nd;
          }
          dd.facturas.add(f.id);
          dd.unidades += it.cantidad || 0;
          dd.dias.push(dias);
        }
      }
      // Factura exclusiva de un solo tipo → no contaminada por mixtas
      if (tiposEnFactura.size === 1) {
        const unico = [...tiposEnFactura][0];
        if (unico !== undefined) {
          const tmU = tMap.get(unico);
          if (tmU) tmU.solo++;
        }
      }
      rows.push({
        id: f.id,
        numero: f.numero_factura || f.numero_presupuesto || `#${f.id}`,
        cliente: f.cliente_nombre || 'Desconocido',
        fecha: f.fecha || '',
        entregado: formatEntregadoAt(f.entregado_at) || '',
        dias,
        itemsN: items.length,
        valida: true,
      });
    }
    rows.sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1));
    entregasRows = rows;
    const prom = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    const med = mediana(vals);
    const p90v = percentil(vals, 90);
    const le7 = vals.filter(v => v <= 7).length;
    const le15 = vals.filter(v => v <= 15).length;
    const gt30 = vals.filter(v => v > 30).length;
    entregasKpi = {
      n: vals.length, prom, med, p90: p90v, le7, le15, gt30,
      pendientes, invalidas,
      pctLe7: vals.length ? (le7 / vals.length) * 100 : 0,
    };

    // Histograma en una pasada sobre vals ya calculado (6 buckets chicos)
    const bCounts = [0, 0, 0, 0, 0, 0];
    for (const v of vals) {
      if (v <= 3) bCounts[0]++;
      else if (v <= 7) bCounts[1]++;
      else if (v <= 15) bCounts[2]++;
      else if (v <= 30) bCounts[3]++;
      else if (v <= 60) bCounts[4]++;
      else bCounts[5]++;
    }
    const bLabels = ['0–3 días', '4–7 días', '8–15 días', '16–30 días', '31–60 días', '60+ días'];
    entregasBuckets = bLabels.map((label, i) => ({ label, n: bCounts[i], pct: vals.length ? (bCounts[i] / vals.length) * 100 : 0 }));

    entregasMensual = Array.from(mMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, arr]) => {
        const [y, m] = key.split('-');
        const d = new Date(parseInt(y), parseInt(m) - 1, 1);
        return {
          key,
          label: `${monthName(d)} ${y.slice(2)}`,
          n: arr.length,
          prom: arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null,
          med: mediana(arr),
        };
      });

    const minN = Math.max(1, entregasMinN || 1);
    const prods: ProdDemora[] = [];
    for (const [producto, g] of pMap) {
      if (g.facturas.size < minN) continue;
      const promP = g.dias.reduce((a, b) => a + b, 0) / g.dias.length;
      prods.push({ producto, display: g.display, facturas: g.facturas.size, unidades: g.unidades, prom: promP, med: mediana(g.dias), p90: percentil(g.dias, 90) });
    }
    prods.sort((a, b) => entregasSort === 'prom' ? b.prom - a.prom : b.facturas - a.facturas);
    entregasProductos = prods.slice(0, 50);

    // Promedio por tipo (orden fijo: entelado, sin tela, pintura, rollo, otros)
    entregasTipos = TIPOS_PEDIDO.map(t => {
      const g = tMap.get(t.key);
      if (!g || g.facturas.size === 0) {
        return { key: t.key, label: t.label, hint: t.hint, facturas: 0, solo: 0, unidades: 0, prom: null, med: null, p90: null, detalle: [] };
      }
      const detalle: TipoDemoraDetalle[] = [...g.det.entries()]
        .map(([key, d]) => ({
          key, display: d.display, facturas: d.facturas.size, unidades: d.unidades,
          prom: d.dias.length ? d.dias.reduce((a, b) => a + b, 0) / d.dias.length : null,
          med: mediana(d.dias),
          quitado: d.quitado === true,
          manual: (tiposOverrides[key] ?? null) !== null && tiposOverrides[key] !== '__quitar',
          auto: d.auto ?? 'otros' as TipoPedido,
        }))
        .sort((a, b) => Number(a.quitado) - Number(b.quitado) || b.facturas - a.facturas)
        .slice(0, 30);
      return {
        key: t.key, label: t.label, hint: t.hint,
        facturas: g.facturas.size, solo: g.solo, unidades: g.unidades,
        prom: g.dias.reduce((a, b) => a + b, 0) / g.dias.length,
        med: mediana(g.dias), p90: percentil(g.dias, 90),
        detalle,
      };
    });
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

  function formatFechaMs(ms: number): string {
    if (!ms) return '—';
    const d = new Date(ms);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }

  function toDayMs(fecha: string): number {
    const d = parseDate(fecha);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function addMonths(d: Date, n: number): Date {
    return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
  }

  function buildInterpretacion(r: Omit<RecurrenciaData, 'interpretacion'>): string {
    if (r.activos === 0) return 'No hay compras con cliente identificado en el período seleccionado.';
    const parts: string[] = [];
    parts.push(`Durante el período analizado (${r.periodoLabel}) hubo ${r.activos} clientes activos.`);
    parts.push(`${r.recurrentes} realizaron dos o más compras, por lo que la tasa de recurrencia fue del ${r.tasaRecurrencia.toFixed(1)}%.`);
    parts.push(`Los clientes recurrentes representaron el ${r.pctFacturacionRecurrentes.toFixed(1)}% de la facturación (${formatCurrency(r.facturacionRecurrentes)} de ${formatCurrency(r.totalFacturacion)}).`);
    parts.push(`${r.unicos} clientes (${r.tasaUnica.toFixed(1)}%) compraron una sola vez.`);
    if (r.nuevosAplica) parts.push(`Se sumaron ${r.nuevos} clientes nuevos, que generaron ${formatCurrency(r.facturacionNuevos)} (${r.pctFacturacionNuevos.toFixed(1)}% de la facturación).`);
    if (r.recuperadosAplica) parts.push(`Se recuperaron ${r.recuperados} clientes (más de ${REC_GAP_DIAS} días sin comprar).`);
    if (r.intervaloPromedio != null) parts.push(`El intervalo promedio entre compras consecutivas fue de ${r.intervaloPromedio.toFixed(1)} días (sobre ${r.intervalosCount} intervalos).`);
    if (r.facturasSinCliente > 0) parts.push(`Se omitieron ${r.facturasSinCliente} facturas sin cliente identificado.`);
    return parts.join(' ');
  }

  function computeRecurrencia() {
    const now = new Date();
    const periodEnd = now.getTime();
    let periodStart: number | null = null;
    if (recPeriod === '6m') periodStart = addMonths(now, -6).getTime();
    else if (recPeriod === '12m') periodStart = addMonths(now, -12).getTime();
    else if (recPeriod === '24m') periodStart = addMonths(now, -24).getTime();

    const inPeriod = (t: number) => periodStart == null || (t >= periodStart && t <= periodEnd);

    const clients = new Map<number, { nombre: string; facturas: { date: number; total: number }[] }>();
    let facturasSinCliente = 0;
    for (const f of facturasRec) {
      if (f.cliente_id == null) { facturasSinCliente++; continue; }
      const g = clients.get(f.cliente_id) || { nombre: f.cliente_nombre || `Cliente ${f.cliente_id}`, facturas: [] };
      if (f.cliente_nombre) g.nombre = f.cliente_nombre;
      g.facturas.push({ date: toDayMs(f.fecha), total: f.total || 0 });
      clients.set(f.cliente_id, g);
    }

    let activos = 0, recurrentes = 0, unicos = 0;
    let totalCompras = 0, totalFacturasPeriodo = 0, totalOcasionesPeriodo = 0, totalFacturacion = 0;
    let facturacionRecurrentes = 0, nuevos = 0, facturacionNuevos = 0, recuperados = 0;
    const intervalos: number[] = [];
    const segCounts = [0, 0, 0, 0, 0];
    const topRows: RecTopRow[] = [];
    const altaRows: RecAltaRow[] = [];
    const last12Start = addMonths(now, -12).getTime();

    for (const g of clients.values()) {
      const all = [...new Set(g.facturas.map(x => x.date))].sort((a, b) => a - b);
      const periodFacturas = g.facturas.filter(x => inPeriod(x.date));
      if (periodFacturas.length === 0) continue;

      const days = [...new Set(periodFacturas.map(x => x.date))].sort((a, b) => a - b);
      const invoices = periodFacturas.length;
      const occasions = days.length;
      const facturacion = periodFacturas.reduce((s, x) => s + x.total, 0);
      const compras = recCountMode === 'ocasiones' ? occasions : invoices;

      activos++;
      if (compras >= 2) { recurrentes++; facturacionRecurrentes += facturacion; } else unicos++;

      totalCompras += compras;
      totalFacturasPeriodo += invoices;
      totalOcasionesPeriodo += occasions;
      totalFacturacion += facturacion;

      if (compras === 1) segCounts[0]++;
      else if (compras === 2) segCounts[1]++;
      else if (compras <= 5) segCounts[2]++;
      else if (compras <= 11) segCounts[3]++;
      else segCounts[4]++;

      let diasProm: number | null = null;
      if (days.length >= 2) {
        let sum = 0;
        for (let i = 1; i < days.length; i++) {
          const gap = (days[i] - days[i - 1]) / 864e5;
          sum += gap;
          intervalos.push(gap);
        }
        diasProm = sum / (days.length - 1);
      }

      const firstEver = all[0];
      if (periodStart != null && firstEver != null && inPeriod(firstEver)) { nuevos++; facturacionNuevos += facturacion; }

      if (periodStart != null) {
        const before = all.filter(t => t < periodStart);
        if (before.length > 0 && days.length > 0 && (days[0] - before[before.length - 1]) / 864e5 > REC_GAP_DIAS) recuperados++;
      }

      topRows.push({
        cliente: g.nombre, compras, facturas: invoices, facturacion,
        ticketProm: invoices > 0 ? facturacion / invoices : 0,
        primera: days[0], ultima: days[days.length - 1], diasProm,
      });

      const last12days = all.filter(t => t >= last12Start);
      const last12Facturas = g.facturas.filter(x => x.date >= last12Start);
      const compras12 = recCountMode === 'ocasiones' ? last12days.length : last12Facturas.length;
      if (compras12 >= 6) {
        let dp: number | null = null;
        if (last12days.length >= 2) {
          let s = 0;
          for (let i = 1; i < last12days.length; i++) s += (last12days[i] - last12days[i - 1]) / 864e5;
          dp = s / (last12days.length - 1);
        }
        altaRows.push({
          cliente: g.nombre,
          compras: compras12,
          facturacion: last12Facturas.reduce((s, x) => s + x.total, 0),
          ultima: last12days[last12days.length - 1] ?? 0,
          diasProm: dp,
        });
      }
    }

    const intervaloPromedio = intervalos.length > 0 ? intervalos.reduce((a, b) => a + b, 0) / intervalos.length : null;

    const segLabels = ['1 compra', '2 compras', '3 a 5', '6 a 11', '12 o más'];
    const segmentos = segCounts.map((c, i) => ({ label: segLabels[i], clientes: c, pct: activos > 0 ? (c / activos) * 100 : 0 }));

    const topRecurrentes = topRows
      .filter(r => r.compras >= 2)
      .sort((a, b) => b.compras - a.compras || b.facturacion - a.facturacion)
      .slice(0, 10);

    const altaFrecuencia = altaRows
      .sort((a, b) => b.compras - a.compras || b.facturacion - a.facturacion)
      .slice(0, 20);

    const periodoLabel = periodStart != null ? `${formatFechaMs(periodStart)} – ${formatFechaMs(periodEnd)}` : 'Toda la historia';

    const base: Omit<RecurrenciaData, 'interpretacion'> = {
      periodoLabel,
      totalFacturasPeriodo,
      totalOcasionesPeriodo,
      totalFacturacion,
      facturasSinCliente,
      activos,
      recurrentes,
      unicos,
      tasaRecurrencia: activos > 0 ? (recurrentes / activos) * 100 : 0,
      tasaUnica: activos > 0 ? (unicos / activos) * 100 : 0,
      comprasPromedio: activos > 0 ? totalCompras / activos : 0,
      totalCompras,
      facturacionRecurrentes,
      pctFacturacionRecurrentes: totalFacturacion > 0 ? (facturacionRecurrentes / totalFacturacion) * 100 : 0,
      nuevos,
      facturacionNuevos,
      pctFacturacionNuevos: totalFacturacion > 0 ? (facturacionNuevos / totalFacturacion) * 100 : 0,
      nuevosAplica: recPeriod !== 'all',
      recuperados,
      recuperadosAplica: recPeriod !== 'all',
      intervaloPromedio,
      intervalosCount: intervalos.length,
      segmentos,
      topRecurrentes,
      altaFrecuencia,
    };

    recurrencia = { ...base, interpretacion: buildInterpretacion(base) };
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
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

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

  let canvasEl = $state<HTMLCanvasElement | undefined>(undefined);
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
            titleFont: { size: 12, weight: 600 },
            bodyFont: { size: 12 },
            displayColors: false,
            callbacks: { label: (ctx: any) => '$' + ctx.parsed.y.toLocaleString('es-AR') }
          },
          // display:false equivale a `false` (desactiva el plugin) pero es tipado.
          datalabels: isLine ? { display: false } : {
            anchor: 'end',
            align: 'top',
            color: '#2c3e50',
            font: { size: 10, weight: 600 },
            formatter: (v: number) => { if (v <= 0) return ''; if (v >= 1000000) return '$' + (v / 1000000).toFixed(1) + 'M'; if (v >= 1000) return '$' + (v / 1000).toFixed(0) + 'k'; return '$' + v; }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: '#f0f1f5' },
            ticks: { color: '#999', font: { size: 11 }, callback: (val: any) => '$' + Number(val).toLocaleString('es-AR') }
          },
          x: {
            grid: { display: false },
            ticks: { color: '#666', font: { size: 11, weight: 600 }, maxRotation: 45, autoSkip: true, maxTicksLimit: isLine ? 15 : 30 }
          }
        }
      }
    });
  }

  $effect(() => { chartData; canvasEl; buildChart(); });

  $effect(() => {
    facturasRec;
    recPeriod;
    recCountMode;
    computeRecurrencia();
  });

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

  <div class="est-tabs" role="tablist" aria-label="Secciones de estadísticas">
    <button role="tab" aria-selected={activeTab === 'ventas'} class="est-tab" class:active={activeTab === 'ventas'} onclick={() => switchTab('ventas')}>📊 Ventas</button>
    <button role="tab" aria-selected={activeTab === 'entregas'} class="est-tab" class:active={activeTab === 'entregas'} onclick={() => switchTab('entregas')}>🚚 Tiempos de entrega</button>
    {#if rangeDays > 0}
      <span class="range-info">{rangeDays}d · cohorte por entrega real</span>
    {/if}
  </div>

  {#if activeTab === 'ventas'}
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
    <div class="kpi-card">
      <span class="kpi-label">Clientes</span>
      <span class="kpi-value">{totalClientes}</span>
      <span class="kpi-sub">Activos en período: {clientesActivos}</span>
    </div>
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

      <div class="est-recurrencia">
        <div class="rec-head">
          <h3>Recurrencia de clientes</h3>
          <div class="rec-controls">
            <div class="rec-seg" role="group" aria-label="Período de análisis">
              <button class:active={recPeriod === '6m'} onclick={() => recPeriod = '6m'}>6m</button>
              <button class:active={recPeriod === '12m'} onclick={() => recPeriod = '12m'}>12m</button>
              <button class:active={recPeriod === '24m'} onclick={() => recPeriod = '24m'}>24m</button>
              <button class:active={recPeriod === 'all'} onclick={() => recPeriod = 'all'}>Toda</button>
            </div>
            <div class="rec-seg" role="group" aria-label="Modo de conteo">
              <button class:active={recCountMode === 'ocasiones'} onclick={() => recCountMode = 'ocasiones'} title="Cuenta días únicos de compra">Ocasiones</button>
              <button class:active={recCountMode === 'facturas'} onclick={() => recCountMode = 'facturas'} title="Cuenta cada factura">Facturas</button>
            </div>
          </div>
        </div>

        <div class="rec-periodo">
          Período analizado: <strong>{recurrencia.periodoLabel}</strong>
          &middot; {recurrencia.totalFacturasPeriodo} facturas
          &middot; {recurrencia.totalOcasionesPeriodo} ocasiones de compra
          {#if recurrencia.facturasSinCliente > 0}
            &middot; <span class="rec-warn">{recurrencia.facturasSinCliente} facturas sin cliente identificado (omitidas)</span>
          {/if}
        </div>

        <div class="rec-kpis">
          <div class="rec-kpi">
            <span class="rec-kpi-label">Clientes activos</span>
            <span class="rec-kpi-value">{recurrencia.activos}</span>
            <span class="rec-kpi-sub">únicos con ≥1 compra</span>
          </div>
          <div class="rec-kpi">
            <span class="rec-kpi-label">Clientes recurrentes</span>
            <span class="rec-kpi-value">{recurrencia.recurrentes}</span>
            <span class="rec-kpi-sub">≥2 compras</span>
          </div>
          <div class="rec-kpi">
            <span class="rec-kpi-label">Tasa de recurrencia</span>
            <span class="rec-kpi-value">{recurrencia.tasaRecurrencia.toFixed(1)}%</span>
            <span class="rec-kpi-sub">{recurrencia.recurrentes} / {recurrencia.activos}</span>
          </div>
          <div class="rec-kpi">
            <span class="rec-kpi-label">Compras prom. / cliente</span>
            <span class="rec-kpi-value">{recurrencia.comprasPromedio.toFixed(2)}</span>
            <span class="rec-kpi-sub">{recurrencia.totalCompras} / {recurrencia.activos}</span>
          </div>
          <div class="rec-kpi">
            <span class="rec-kpi-label">% facturación recurrentes</span>
            <span class="rec-kpi-value">{recurrencia.pctFacturacionRecurrentes.toFixed(1)}%</span>
            <span class="rec-kpi-sub">{formatCurrency(recurrencia.facturacionRecurrentes)} de {formatCurrency(recurrencia.totalFacturacion)}</span>
          </div>
        </div>

        <div class="rec-grid">
          <div class="rec-block">
            <h4>Distribución por cantidad de compras</h4>
            <table class="est-table">
              <thead><tr><th>Segmento</th><th class="td-r">Clientes</th><th class="td-r">% de activos</th></tr></thead>
              <tbody>
                {#each recurrencia.segmentos as s}
                  <tr>
                    <td>{s.label}</td>
                    <td class="td-r">{s.clientes}</td>
                    <td class="td-r">{s.pct.toFixed(1)}%</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>

          <div class="rec-block">
            <h4>Nuevos vs recurrentes</h4>
            <table class="est-table">
              <tbody>
                <tr><td>Clientes nuevos</td><td class="td-r">{recurrencia.nuevosAplica ? recurrencia.nuevos : '—'}</td></tr>
                <tr><td>Facturación de nuevos</td><td class="td-r">{recurrencia.nuevosAplica ? formatCurrency(recurrencia.facturacionNuevos) : '—'}</td></tr>
                <tr><td>% de facturación</td><td class="td-r">{recurrencia.nuevosAplica ? recurrencia.pctFacturacionNuevos.toFixed(1) + '%' : '—'}</td></tr>
                <tr><td>Clientes recuperados</td><td class="td-r">{recurrencia.recuperadosAplica ? recurrencia.recuperados : '—'}</td></tr>
              </tbody>
            </table>
            {#if !recurrencia.nuevosAplica}
              <p class="rec-note">Con "Toda la historia" no hay historia previa fuera del período: nuevos y recuperados no aplican.</p>
            {/if}
          </div>

          <div class="rec-block">
            <h4>Intervalo promedio entre compras</h4>
            <div class="rec-big">{recurrencia.intervaloPromedio != null ? recurrencia.intervaloPromedio.toFixed(1) + ' días' : '—'}</div>
            <p class="rec-note">Promedio de {recurrencia.intervalosCount} intervalos consecutivos (clientes con ≥2 compras en el período).</p>
          </div>

          <div class="rec-block">
            <h4>Facturación de clientes recurrentes</h4>
            <div class="rec-big">{formatCurrency(recurrencia.facturacionRecurrentes)}</div>
            <p class="rec-note">{recurrencia.pctFacturacionRecurrentes.toFixed(1)}% de {formatCurrency(recurrencia.totalFacturacion)} facturado en el período.</p>
          </div>
        </div>

        <div class="rec-block">
          <h4>Top 10 clientes recurrentes</h4>
          {#if recurrencia.topRecurrentes.length === 0}
            <div class="chart-empty">Sin clientes con 2 o más compras en el período</div>
          {:else}
            <div class="est-table-wrap">
              <table class="est-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th class="td-r">Compras</th>
                    <th class="td-r">Facturación</th>
                    <th class="td-r">Ticket prom.</th>
                    <th class="td-r">Primera compra</th>
                    <th class="td-r">Última compra</th>
                    <th class="td-r">Días prom.</th>
                  </tr>
                </thead>
                <tbody>
                  {#each recurrencia.topRecurrentes as r}
                    <tr>
                      <td>{r.cliente}</td>
                      <td class="td-r">{r.compras}</td>
                      <td class="td-r">{formatCurrency(r.facturacion)}</td>
                      <td class="td-r">{formatCurrency(r.ticketProm)}</td>
                      <td class="td-r">{formatFechaMs(r.primera)}</td>
                      <td class="td-r">{formatFechaMs(r.ultima)}</td>
                      <td class="td-r">{r.diasProm != null ? r.diasProm.toFixed(1) : '—'}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>

        <div class="rec-block">
          <h4>Clientes de alta frecuencia (≥6 compras en 12 meses)</h4>
          {#if recurrencia.altaFrecuencia.length === 0}
            <div class="chart-empty">Sin clientes con 6 o más compras en los últimos 12 meses</div>
          {:else}
            <div class="est-table-wrap">
              <table class="est-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th class="td-r">Compras</th>
                    <th class="td-r">Facturación</th>
                    <th class="td-r">Última compra</th>
                    <th class="td-r">Días prom.</th>
                  </tr>
                </thead>
                <tbody>
                  {#each recurrencia.altaFrecuencia as r}
                    <tr>
                      <td>{r.cliente}</td>
                      <td class="td-r">{r.compras}</td>
                      <td class="td-r">{formatCurrency(r.facturacion)}</td>
                      <td class="td-r">{formatFechaMs(r.ultima)}</td>
                      <td class="td-r">{r.diasProm != null ? r.diasProm.toFixed(1) : '—'}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>

        <div class="rec-interpretacion">
          <strong>Interpretación:</strong> {recurrencia.interpretacion}
        </div>
      </div>
    </div>
  </div>
  {:else}
  <!-- ── TAB ENTREGAS: reemplaza la pantalla ── -->
  <div class="ent-kpis">
    <div class="kpi-card kpi-main" title="Suma de todas las demoras dividida por la cantidad de entregas">
      <span class="kpi-label">Promedio de entrega</span>
      <span class="kpi-value">{entregasKpi.prom != null ? entregasKpi.prom.toFixed(1) + ' d' : '—'}</span>
      <span class="kpi-sub">{entregasKpi.n} entregadas · media aritmética</span>
    </div>
    <div class="kpi-card" title="Si ordenás todas las demoras de menor a mayor, es el valor del medio: la mitad de los pedidos se entregó en menos tiempo que este">
      <span class="kpi-label">Pedido típico (mediana)</span>
      <span class="kpi-value">{entregasKpi.med != null ? entregasKpi.med.toFixed(1) + ' d' : '—'}</span>
      <span class="kpi-sub">la mitad tardó menos que esto</span>
    </div>
    <div class="kpi-card" title="Solo 1 de cada 10 pedidos tarda más que este valor">
      <span class="kpi-label">Peor 10% (más de)</span>
      <span class="kpi-value">{entregasKpi.p90 != null ? entregasKpi.p90.toFixed(0) + ' d' : '—'}</span>
      <span class="kpi-sub">9 de cada 10 se entregan antes</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Entregadas ≤ 7 días</span>
      <span class="kpi-value">{entregasKpi.pctLe7.toFixed(1)}%</span>
      <span class="kpi-sub">{entregasKpi.le7} de {entregasKpi.n} · ≤15d: {entregasKpi.le15}</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">Lentas &gt; 30 días</span>
      <span class="kpi-value">{entregasKpi.gt30}</span>
      <span class="kpi-sub">Pendientes: {entregasKpi.pendientes} · Inválidas: {entregasKpi.invalidas}</span>
    </div>
  </div>
  <p class="rec-note">Cómo leerlo: <strong>Promedio</strong> = media de todas las demoras (es la cifra de referencia). <strong>Pedido típico</strong> = la mitad de los pedidos se entregó en menos tiempo que ese valor (no lo mueven los casos extremos). <strong>Peor 10%</strong> = solo 1 de cada 10 pedidos tarda más que eso.</p>

  {#if entregasLoading}
    <div class="chart-empty">Cargando tiempos de entrega…</div>
  {:else if entregasError && !entregasLoaded}
    <div class="chart-empty">⚠️ {entregasError} <button class="btn btn-sm btn-primary" onclick={() => loadEntregas(true)}>Reintentar</button></div>
  {:else if !entregasLoaded}
    <div class="chart-empty">Cargando…</div>
  {:else}
  {#if entregasTruncada}
    <p class="rec-note">⚠️ Se alcanzó el tope de {ENTREGAS_LIMIT} facturas: el anual puede estar incompleto. Achicá el rango de fechas.</p>
  {/if}
  <div class="ent-grid">
    <div class="est-monthly">
      <h3>Distribución de demoras</h3>
      {#if entregasBuckets.length === 0 || entregasKpi.n === 0}
        <div class="chart-empty">Sin entregas en el período</div>
      {:else}
        <div class="bucket-list">
          {#each entregasBuckets as b}
            <div class="bucket-row">
              <span class="bucket-label">{b.label}</span>
              <div class="bucket-bar"><div class="bucket-fill" style="width: {b.pct}%"></div></div>
              <span class="bucket-n">{b.n} · {b.pct.toFixed(1)}%</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="est-monthly">
      <h3>Promedio mensual (por fecha de entrega)</h3>
      {#if entregasMensual.length === 0}
        <div class="chart-empty">Sin datos</div>
      {:else}
        <div class="est-table-wrap">
          <table class="est-table">
            <thead><tr><th>Mes</th><th class="td-r">Entregadas</th><th class="td-r" title="Media aritmética del mes">Promedio</th><th class="td-r" title="La mitad de los pedidos del mes se entregó en menos tiempo que este valor">Típico</th></tr></thead>
            <tbody>
              {#each entregasMensual as m}
                <tr>
                  <td class="monthly-month">{m.label}</td>
                  <td class="td-r">{m.n}</td>
                  <td class="td-r">{m.prom != null ? m.prom.toFixed(1) + ' d' : '—'}</td>
                  <td class="td-r">{m.med != null ? m.med.toFixed(1) + ' d' : '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </div>

  <div class="est-monthly">
    <div class="rec-head">
      <h3>Promedio por tipo de pedido</h3>
    </div>
    <p class="rec-note">Cada item se clasifica por su variante (lienzo/lona/doble/sin tela…) y si no hay variante por palabras clave (rollo, pintura, bastidor). Una factura mixta suma su demora a cada tipo presente; <strong>Solo</strong> = facturas exclusivas de ese tipo. ▸ en <strong>cada tipo despliega sus subgrupos sin medidas (ej. Lienzo Profesional, Doble 4cm). En <strong>Ajuste</strong> podés mover un subgrupo a otro grupo o quitarlo del cálculo (↩ vuelve al automático); los cambios se guardan en esta máquina.</p>
    {#if entregasTipos.every(t => t.facturas === 0)}
      <div class="chart-empty">Sin entregas en el período</div>
    {:else}
      <div class="est-table-wrap">
        <table class="est-table">
          <thead><tr><th>Tipo</th><th class="td-r">Facturas</th><th class="td-r" title="Facturas que traen solo este tipo">Solo</th><th class="td-r">Unid.</th><th class="td-r" title="Media aritmética: la cifra de referencia">Promedio</th><th class="td-r" title="La mitad de los pedidos de este tipo se entregó en menos tiempo">Típico</th><th class="td-r" title="Solo 1 de cada 10 pedidos de este tipo tarda más que esto">Peor 10%</th><th>Ajuste</th></tr></thead>
          <tbody>
            {#each entregasTipos as t}
              <tr>
                <td title={t.hint}>
                  {#if t.detalle.length > 0}
                    <button class="mini-toggle" onclick={() => tiposExpand[t.key] = !tiposExpand[t.key]} title="Ver subgrupos">{tiposExpand[t.key] ? '▾' : '▸'}</button>
                  {/if}
                  {t.label}
                </td>
                <td class="td-r">{t.facturas}</td>
                <td class="td-r">{t.solo}</td>
                <td class="td-r">{t.unidades}</td>
                <td class="td-r"><strong>{t.prom != null ? t.prom.toFixed(1) + ' d' : '—'}</strong></td>
                <td class="td-r">{t.med != null ? t.med.toFixed(1) + ' d' : '—'}</td>
                <td class="td-r">{t.p90 != null ? t.p90.toFixed(0) + ' d' : '—'}</td>
                <td></td>
              </tr>
              {#if tiposExpand[t.key] && t.detalle.length > 0}
                {#each t.detalle as d}
                  <tr class="tipo-detalle-row">
                    <td class="tipo-sub">↳ {d.display}{#if d.manual} <span class="man-tag">manual</span>{/if}{#if d.quitado} <span class="man-tag quit">quitado</span>{/if}</td>
                    <td class="td-r">{d.facturas}</td>
                    <td class="td-r"></td>
                    <td class="td-r">{d.unidades}</td>
                    <td class="td-r">{d.prom != null ? d.prom.toFixed(1) + ' d' : '—'}</td>
                    <td class="td-r">{d.med != null ? d.med.toFixed(1) + ' d' : '—'}</td>
                    <td class="td-r"></td>
                    <td>
                      <div class="ajuste-ctl">
                        <select class="mini-sel" value={tiposOverrides[d.key] ?? d.auto} onchange={(e) => moverSubgrupo(d.key, e.currentTarget.value, d.auto)} title="Mover subgrupo a otro grupo">
                          {#each TIPOS_PEDIDO as opt}
                            <option value={opt.key}>{opt.label}</option>
                          {/each}
                          <option value="__quitar">Quitar del cálculo</option>
                        </select>
                        {#if (tiposOverrides[d.key] ?? null) !== null}
                          <button class="mini-toggle" onclick={() => revertirSubgrupo(d.key)} title="Volver a clasificación automática">↩</button>
                        {/if}
                      </div>
                    </td>
                  </tr>
                {/each}
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <div class="est-monthly">
    <div class="rec-head">
      <h3>Promedio por producto (hereda demora de su factura)</h3>
      <div class="rec-controls">
        <label class="mini-label">Mín. facturas <input type="number" min="1" max="20" bind:value={entregasMinN} oninput={onMinNInput} onchange={() => buildEntregasView()} class="mini-input" /></label>
        <div class="rec-seg" role="group" aria-label="Orden">
          <button class:active={entregasSort === 'prom'} onclick={() => setEntregasSort('prom')}>Más lentos</button>
          <button class:active={entregasSort === 'facturas'} onclick={() => setEntregasSort('facturas')}>Más vendidos</button>
        </div>
        <button class="btn btn-sm btn-icon" onclick={() => loadEntregas(true)} title="Recargar entregas">🔄</button>
      </div>
    </div>
    <p class="rec-note">Origen = <code>created_at</code> (o <code>fecha</code> si falta) → entrega = <code>entregado_at</code> (UTC→AR, truncado a día). Se excluyen pendientes, negativos y &gt;365d. <strong>Promedio</strong> ordena la tabla por defecto; <strong>Típico</strong> = mediana (mitad por debajo); <strong>Peor 10%</strong> = solo 1 de cada 10 tarda más.</p>
    {#if entregasProductos.length === 0}
      <div class="chart-empty">Sin productos con ≥{entregasMinN} facturas entregadas en el período</div>
    {:else}
      <div class="est-table-wrap">
        <table class="est-table">
          <thead><tr><th>Producto</th><th class="td-r">Facturas</th><th class="td-r">Unid.</th><th class="td-r" title="Media aritmética: la cifra de referencia">Promedio</th><th class="td-r" title="La mitad de los pedidos de este producto se entregó en menos tiempo">Típico</th><th class="td-r" title="Solo 1 de cada 10 pedidos de este producto tarda más que esto">Peor 10%</th></tr></thead>
          <tbody>
            {#each entregasProductos as p}
              <tr>
                <td>{p.display}</td>
                <td class="td-r">{p.facturas}</td>
                <td class="td-r">{p.unidades}</td>
                <td class="td-r"><strong>{p.prom.toFixed(1)} d</strong></td>
                <td class="td-r">{p.med != null ? p.med.toFixed(1) + ' d' : '—'}</td>
                <td class="td-r">{p.p90 != null ? p.p90.toFixed(0) + ' d' : '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>

  <div class="est-monthly">
    <h3>Detalle por factura ({entregasRows.length})</h3>
    {#if entregasRows.length === 0}
      <div class="chart-empty">Sin entregas en el período</div>
    {:else}
      <div class="est-table-wrap ent-detalle">
        <table class="est-table">
          <thead><tr><th>Factura</th><th>Cliente</th><th class="td-r">Creada</th><th class="td-r">Entregada</th><th class="td-r">Demora</th></tr></thead>
          <tbody>
            {#each entregasRows.slice(0, 200) as r}
              <tr>
                <td>{r.numero}</td>
                <td>{r.cliente}</td>
                <td class="td-r">{r.fecha}</td>
                <td class="td-r">{r.entregado}</td>
                <td class="td-r">{r.valida && r.dias !== null ? r.dias + ' d' : '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        {#if entregasRows.length > 200}
          <p class="rec-note">Mostrando 200 de {entregasRows.length} (las más lentas primero).</p>
        {/if}
      </div>
    {/if}
  </div>
  {/if}
  {/if}
</div>

<style>
  .estadisticas {
    padding: 1.143rem;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.714rem;
    background: var(--bg-page);
    overflow: auto;
  }

  .est-toolbar {
    display: flex;
    gap: 0.571rem;
    align-items: center;
    flex-wrap: wrap;
    background: var(--bg-card);
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
    border: 1px solid var(--border);
    border-radius: 0.357rem;
    font-size: 0.85rem;
    min-width: 7.143rem;
  }

  .preset-row { display: flex; gap: 0.357rem; flex-wrap: wrap; }
  .preset-btn {
    padding: 0.286rem 0.714rem;
    border: 1px solid var(--border);
    background: var(--bg-card);
    border-radius: 1.143rem;
    font-size: 0.78rem;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
    font-family: inherit;
    transition: all 0.15s;
  }
  .preset-btn:hover { border-color: var(--accent); color: var(--accent); background: var(--accent-light); }
  .preset-active { background: var(--accent); color: white; border-color: var(--accent); }
  .preset-active:hover { background: var(--accent-hover); color: white; }
  .range-info { font-size: 0.72rem; color: var(--text-muted); white-space: nowrap; font-weight: 500; }

  .btn { cursor: pointer; border-radius: 0.357rem; border: none; font-weight: 600; font-family: inherit; font-size: 0.82rem; padding: 0.429rem 0.857rem; }
  .btn-sm { font-size: 0.78rem; padding: 0.357rem 0.714rem; }
  .btn-icon { background: none; padding: 0.357rem; font-size: 1rem; }
  .btn-icon:hover { background: #f0f1f5; }
  .btn-primary { background: var(--accent); color: white; }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .est-kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
    gap: 0.714rem;
  }
  .kpi-card {
    background: var(--bg-card);
    border-radius: 0.571rem;
    padding: 1rem 1.143rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .kpi-label { font-size: 0.75rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; letter-spacing: 0.036rem; }
  .kpi-value { font-size: 1.5rem; font-weight: 700; color: var(--text-primary); margin-top: 0.286rem; line-height: 1.2; }
  .kpi-sub { font-size: 0.68rem; color: var(--text-muted); margin-top: 0.214rem; }
  .kpi-card-forecast {
    border-left: 0.214rem solid #4361ee;
  }
  .kpi-main {
    border-left: 0.214rem solid #4361ee;
  }

  .est-meta {
    display: flex;
    gap: 1rem;
    background: var(--bg-card);
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
  .meta-title { font-size: 0.78rem; font-weight: 600; color: var(--text-primary); }
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
    color: var(--text-secondary);
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
  .meta-btn-edit { color: var(--text-muted); }
  .meta-btn-edit:hover { color: var(--text-secondary); background: #f5f5f5; }

  .meta-progress-wrap {
    display: flex;
    align-items: center;
    gap: 0.571rem;
  }
  .meta-progress-bar {
    flex: 1;
    height: 0.5rem;
    background: var(--bg-hover);
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
    color: var(--text-muted);
  }
  .meta-stats strong { color: var(--text-secondary); }
  .meta-restante { color: #e67e22; }
  .meta-right { flex-shrink: 0; }
  .meta-helper-text {
    font-size: 0.72rem;
    color: var(--text-muted);
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
    background: var(--bg-card);
    border-radius: 0.571rem;
    padding: 1rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }
  .est-chart-container h3 {
    margin: 0 0 0.714rem;
    font-size: 0.9rem;
    color: var(--text-primary);
  }
  .chart-empty { text-align: center; padding: 1.429rem; color: var(--text-muted); }
  .chart-wrap { position: relative; height: 300px; width: 100%; }
  @media (max-width: 600px) { .chart-wrap { height: 220px; } }

  .est-monthly {
    background: var(--bg-card);
    border-radius: 0.571rem;
    padding: 1rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }
  .est-monthly h3 {
    margin: 0 0 0.714rem;
    font-size: 1rem;
    color: var(--text-primary);
  }
  .monthly-wrap { max-height: none; }
  .monthly-month { font-weight: 700; font-size: 0.92rem; color: var(--text-primary); }

  .est-tables-row {
    display: flex;
    gap: 0.714rem;
  }
  .est-table-section {
    flex: 1;
    background: var(--bg-card);
    border-radius: 0.571rem;
    padding: 0.714rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }
  .est-table-section h3 {
    margin: 0 0 0.429rem;
    font-size: 0.82rem;
    color: var(--text-primary);
  }

  /* ── Recurrencia de clientes ── */
  .est-recurrencia {
    background: var(--bg-card);
    border-radius: 0.571rem;
    padding: 1rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
    display: flex;
    flex-direction: column;
    gap: 0.857rem;
  }
  .rec-head { display: flex; justify-content: space-between; align-items: center; gap: 0.714rem; flex-wrap: wrap; }
  .rec-head h3 { margin: 0; font-size: 1rem; color: var(--text-primary); }
  .rec-controls { display: flex; gap: 0.571rem; flex-wrap: wrap; }
  .rec-seg { display: inline-flex; background: var(--bg-page); border-radius: 0.429rem; padding: 0.143rem; gap: 0.143rem; }
  .rec-seg button {
    border: none;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.78rem;
    font-weight: 600;
    padding: 0.286rem 0.643rem;
    border-radius: 0.357rem;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.12s, color 0.12s;
  }
  .rec-seg button:hover { color: var(--text-primary); }
  .rec-seg button.active { background: var(--accent); color: #fff; }
  .rec-periodo { font-size: 0.8rem; color: var(--text-secondary); }
  .rec-warn { color: #e67e22; }

  .rec-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: 0.714rem; }
  .rec-kpi {
    background: var(--bg-page);
    border-radius: 0.429rem;
    padding: 0.714rem 0.857rem;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .rec-kpi-label { font-size: 0.68rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; letter-spacing: 0.02rem; }
  .rec-kpi-value { font-size: 1.35rem; font-weight: 700; color: var(--text-primary); margin-top: 0.214rem; }
  .rec-kpi-sub { font-size: 0.68rem; color: var(--text-muted); margin-top: 0.143rem; }

  .rec-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); gap: 0.714rem; }
  .rec-block { background: var(--bg-page); border-radius: 0.429rem; padding: 0.714rem; }
  .rec-block h4 { margin: 0 0 0.429rem; font-size: 0.82rem; color: var(--text-primary); }
  .rec-block .est-table { background: var(--bg-card); }
  .rec-big { font-size: 1.6rem; font-weight: 700; color: var(--text-primary); }
  .rec-note { margin: 0.286rem 0 0; font-size: 0.72rem; color: var(--text-muted); }
  .rec-interpretacion {
    background: var(--accent-light);
    border-left: 0.214rem solid var(--accent);
    border-radius: 0.357rem;
    padding: 0.714rem 0.857rem;
    font-size: 0.82rem;
    color: var(--text-secondary);
    line-height: 1.5;
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
    background: var(--bg-page);
    padding: 0.571rem 0.714rem;
    text-align: left;
    font-weight: 600;
    color: var(--text-secondary);
    font-size: 0.82rem;
    text-transform: uppercase;
    position: sticky;
    top: 0;
    border-bottom: 1px solid var(--border);
  }
  .est-table td {
    padding: 0.5rem 0.714rem;
    border-bottom: 1px solid #f0f1f5;
  }
  .est-table th.td-r { text-align: right; }
  .est-table th:first-child,
  .est-table td:first-child { width: 100%; }
  .est-table th.td-r,
  .est-table td.td-r { white-space: nowrap; }
  .td-r { text-align: right; font-family: monospace; }

  /* ── Tabs internos ── */
  .est-tabs {
    display: flex;
    gap: 0.357rem;
    align-items: center;
    background: var(--bg-card);
    padding: 0.429rem 0.571rem;
    border-radius: 0.571rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }
  .est-tab {
    border: 1px solid var(--border);
    background: transparent;
    border-radius: 1.143rem;
    padding: 0.429rem 1rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-secondary);
    cursor: pointer;
    font-family: inherit;
  }
  .est-tab:hover { border-color: var(--accent); color: var(--accent); }
  .est-tab.active { background: var(--accent); border-color: var(--accent); color: #fff; }

  /* ── Tab entregas ── */
  .ent-kpis {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
    gap: 0.714rem;
  }
  .ent-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr));
    gap: 0.714rem;
  }
  .bucket-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .bucket-row { display: flex; align-items: center; gap: 0.571rem; font-size: 0.82rem; }
  .bucket-label { min-width: 6.5rem; font-weight: 600; color: var(--text-secondary); }
  .bucket-bar { flex: 1; height: 0.643rem; background: var(--bg-hover); border-radius: 0.357rem; overflow: hidden; }
  .bucket-fill { height: 100%; background: linear-gradient(90deg, #4361ee, #7c94f5); border-radius: 0.357rem; min-width: 0.143rem; }
  .bucket-n { min-width: 7rem; text-align: right; font-family: monospace; color: var(--text-secondary); }
  .mini-label { font-size: 0.75rem; color: var(--text-secondary); display: flex; align-items: center; gap: 0.357rem; }
  .mini-input { width: 3.5rem; padding: 0.214rem 0.429rem; border: 1px solid var(--border); border-radius: 0.357rem; font-size: 0.8rem; }
  .ent-detalle { max-height: 22rem; }
  .mini-toggle { border: none; background: none; cursor: pointer; color: var(--accent); font-size: 0.8rem; padding: 0 0.214rem 0 0; }
  .tipo-detalle-row td { background: var(--bg-page); font-size: 0.85rem; }
  .tipo-sub { padding-left: 1.714rem !important; color: var(--text-secondary); }
  .man-tag { font-size: 0.62rem; font-weight: 700; text-transform: uppercase; background: var(--accent-light); color: var(--accent); border-radius: 0.714rem; padding: 0.071rem 0.429rem; letter-spacing: 0.02rem; }
  .man-tag.quit { background: #fef2f2; color: #e74c3c; }
  .ajuste-ctl { display: flex; align-items: center; gap: 0.214rem; }
  .mini-sel { font-size: 0.72rem; padding: 0.143rem 0.286rem; border: 1px solid var(--border); border-radius: 0.357rem; max-width: 8.5rem; background: var(--bg-card); color: var(--text-secondary); }
</style>
