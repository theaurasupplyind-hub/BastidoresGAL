<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import { facturasActivas } from '$lib/utils/facturas';
  import PagoDialog from '$lib/components/PagoDialog.svelte';
  import type { Factura, Pago, FichaSemanalRow, Kpis, Cliente } from '$lib/types';
  import { parseFechasEntrega, formatFechasEntregaDisplay } from '$lib/types';

  let loading = $state(false);
  let rows = $state<FichaSemanalRow[]>([]);
  let facturas = $state<Factura[]>([]);
  let resumen = $state<{ count: number; facturado: number; deuda: number; cobrado: number }>({ count: 0, facturado: 0, deuda: 0, cobrado: 0 });
  let pagos = $state<Pago[]>([]);
  let clientes = $state<Cliente[]>([]);
  let kpis = $state<Kpis>({ v_p:0, v_g:0, c_p:0, c_g:0, n_p:0, n_g:0, d_p:0, d_g:0 });

  // Date range — reads from appStore
  let startDate = $derived(appStore.fsStartDate);
  let endDate = $derived(appStore.fsEndDate);
  let filterCliente = $derived(appStore.fsFilterCliente);
  let filterEstado = $derived(appStore.fsFilterEstado);
  let filterEntrega = $derived(appStore.fsFilterEntrega);

  // Recent payments
  let recentPagos = $state<(Pago & { cliente_nombre: string })[]>([]);
  let pagoPage = $state(0);
  const PAGOS_PER_PAGE = 10;

  // Top debtors
  let topDebtors = $state<{ cliente: string; deuda: number }[]>([]);

  // Payment dialog
  let showPagoDialog = $state(false);
  let pagoDlg = $state<{
    editing: boolean;
    pagoId: number | null;
    invoiceId: number | null;
    invoiceNumero: string;
    invoiceCliente: string;
    invoiceTotal: number;
    initialAmount: number;
    initialDate: string;
    initialMethod: string;
    initialEntityType: string;
    initialEntityId: number | null;
  }>({
    editing: false,
    pagoId: null,
    invoiceId: null,
    invoiceNumero: '',
    invoiceCliente: '',
    invoiceTotal: 0,
    initialAmount: 0,
    initialDate: '',
    initialMethod: 'Efectivo',
    initialEntityType: 'PROVIDER',
    initialEntityId: null,
  });

  // Audit dialog
  let showAudit = $state(false);
  let auditLogs = $state<{ fecha_sistema: string; mensaje: string }[]>([]);

  // Context menu
  let ctxMenuShow = $state(false);
  let ctxMenuX = $state(0);
  let ctxMenuY = $state(0);
  let ctxMenuRowId = $state<number | null>(null);

  // Delivery status (0 = pending click, 1 = confirm)
  let confirmEntregaId = $state<number | null>(null);

  // Summary strip
  let summaryStats = $derived.by(() => {
    const totalRows = rows.length;
    const totalVentas = rows.reduce((s, r) => s + r.total, 0);
    const totalPagado = rows.reduce((s, r) => s + r.pagado, 0);
    const totalSaldo = rows.reduce((s, r) => s + r.saldo, 0);
    const pagadas = rows.filter(r => r.estado === 'PAGADO').length;
    const pendientes = rows.filter(r => r.estado === 'PENDIENTE').length;
    const parciales = rows.filter(r => r.estado === 'PARCIAL').length;
    const entregadas = rows.filter(r => r.estado_entrega === 'ENTREGADO').length;
    return { totalRows, totalVentas, totalPagado, totalSaldo, pagadas, pendientes, parciales, entregadas };
  });

  let paginatedPagos = $derived.by(() => {
    return recentPagos.slice(pagoPage * PAGOS_PER_PAGE, (pagoPage + 1) * PAGOS_PER_PAGE);
  });

  let totalPagoPages = $derived(Math.ceil(recentPagos.length / PAGOS_PER_PAGE));

  let filteredRows = $derived.by(() => {
    let result = rows;
    if (filterCliente) {
      const q = filterCliente.toLowerCase();
      result = result.filter(r => r.cliente.toLowerCase().includes(q));
    }
    if (filterEstado !== 'TODOS') {
      if (filterEstado === 'PENDIENTE+PARCIAL') {
        result = result.filter(r => r.estado === 'PENDIENTE' || r.estado === 'PARCIAL');
      } else {
        result = result.filter(r => r.estado === filterEstado);
      }
    }
    if (filterEntrega !== 'TODOS') {
      result = result.filter(r => r.estado_entrega === filterEntrega);
    }
    return result;
  });

  function formatDate(d: string): string {
    if (!d) return '';
    const parts = d.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return d;
  }

  function formatCurrency(n: number): string {
    return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function getDefaultDates(): { start: string; end: string } {
    const now = new Date();
    const end = now.toISOString().slice(0, 10);
    const start = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    return { start, end };
  }

  async function loadData() {
    loading = true;
    try {
      const [f, p, c] = await Promise.all([
        cacheStore.fetch(`facturas:semanal:${startDate}:${endDate}`, () => api.listFacturas({ start: startDate, end: endDate, limit: 2000, with_items: false }), 300000),
        cacheStore.fetch('pagos', () => api.listPagos(), 120000),
        cacheStore.fetch('clientes', () => api.listClientes(), 1800000),
      ]);
      facturas = facturasActivas(f);
      pagos = p;
      clientes = c;
      try {
        resumen = await api.getInvoicesResumen();
      } catch {
        resumen = { count: 0, facturado: 0, deuda: 0, cobrado: 0 };
      }
      computeRows();
      computeKpis();
      computeRecentPagos();
      computeTopDebtors();
    } catch (e) {
      console.error('Error loading data:', e);
      appStore.alert('Error al cargar datos: ' + (e as Error).message);
    } finally {
      loading = false;
    }
  }

  function computeRows() {
    rows = facturas.map(f => {
      const total = f.total || 0;
      const invPagos = pagos.filter(p => p.invoice_id === f.id);
      const pagado = invPagos.reduce((s, p) => s + (p.amount || 0), 0);
      const saldo = total - pagado;
      let estado: string;
      if (saldo <= 0.5) estado = 'PAGADO';
      else if (pagado > 0) estado = 'PARCIAL';
      else estado = 'PENDIENTE';
      return {
        id: f.id,
        fecha: f.fecha,
        numero: f.numero_factura || f.numero_presupuesto || '',
        cliente: f.cliente_nombre || '',
        total,
        pagado,
        saldo,
        estado,
        estado_entrega: f.estado_entrega || 'PENDIENTE',
        fecha_entrega: formatFechasEntregaDisplay(parseFechasEntrega(f.fecha_entrega)),
      };
    });
  }

  function computeKpis() {
    const periodF = rows;

    const v_p = periodF.reduce((s, r) => s + r.total, 0);
    const c_p = rows.reduce((s, r) => s + r.pagado, 0);
    const n_p = periodF.length;
    const d_p = periodF.reduce((s, r) => s + r.saldo, 0);

    kpis = {
      v_p,
      v_g: resumen.facturado,
      c_p,
      c_g: resumen.cobrado,
      n_p,
      n_g: resumen.count,
      d_p,
      d_g: resumen.deuda,
    };
  }

  function computeRecentPagos() {
    recentPagos = [...pagos]
      .sort((a, b) => ((b.created_at || b.date || '') > (a.created_at || a.date || '') ? 1 : -1))
      .slice(0, 50)
      .map(p => ({
        ...p,
        cliente_nombre: p.extra_client_name || 'Desconocido',
      }));
    pagoPage = 0;
  }

  function computeTopDebtors() {
    const debtMap = new Map<string, number>();
    rows.forEach(r => {
      if (r.saldo > 0.5) {
        debtMap.set(r.cliente, (debtMap.get(r.cliente) || 0) + r.saldo);
      }
    });
    topDebtors = Array.from(debtMap.entries())
      .map(([cliente, deuda]) => ({ cliente, deuda }))
      .sort((a, b) => b.deuda - a.deuda)
      .slice(0, 50);
  }

   function openNewPago(invId?: number) {
    if (invId) {
      const f = facturas.find(x => x.id === invId);
      if (f) {
        const invPagos = pagos.filter(p => p.invoice_id === f.id);
        const pagado = invPagos.reduce((s, p) => s + (p.amount || 0), 0);
        const saldo = (f.total || 0) - pagado;
        if (saldo <= 0) {
          appStore.alert('Esta factura ya está pagada completamente.');
          return;
        }
        pagoDlg = {
          editing: false,
          pagoId: null,
          invoiceId: f.id,
          invoiceNumero: f.numero_factura || f.numero_presupuesto || '',
          invoiceCliente: f.cliente_nombre || '',
          invoiceTotal: f.total || 0,
          initialAmount: saldo,
          initialDate: new Date().toISOString().slice(0, 10),
          initialMethod: 'Efectivo',
          initialEntityType: 'PROVIDER',
          initialEntityId: null,
        };
      }
    } else {
      pagoDlg = {
        editing: false,
        pagoId: null,
        invoiceId: null,
        invoiceNumero: '',
        invoiceCliente: '',
        invoiceTotal: 0,
        initialAmount: 0,
        initialDate: new Date().toISOString().slice(0, 10),
        initialMethod: 'Efectivo',
        initialEntityType: 'PROVIDER',
        initialEntityId: null,
      };
    }
    showPagoDialog = true;
  }

  function dateToInput(val: string | undefined): string {
    if (!val) return '';
    // Already ISO: YYYY-MM-DD or YYYY-MM-DDTHH:mm...
    if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
    // Argentine: D/M/YYYY or DD/MM/YYYY
    const parts = val.split('/');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    return '';
  }

  function openEditPago(pago: Pago & { cliente_nombre: string }) {
    pagoDlg = {
      editing: true,
      pagoId: pago.id,
      invoiceId: pago.invoice_id,
      invoiceNumero: pago.extra_invoice_num || '',
      invoiceCliente: pago.cliente_nombre,
      invoiceTotal: pago.extra_invoice_total ?? 0,
      initialAmount: pago.amount,
      initialDate: dateToInput(pago.date),
      initialMethod: pago.method,
      initialEntityType: pago.entity_type || 'PROVIDER',
      initialEntityId: pago.entity_id ?? null,
    };
    showPagoDialog = true;
  }

  function handlePagoSaved() {
    loadData();
  }

  async function handleDeletePago() {
    if (!pagoDlg.pagoId) return;
    if (!confirm('¿Eliminar este pago definitivamente?')) return;
    try {
      await api.deletePago(pagoDlg.pagoId);
      showPagoDialog = false;
      cacheStore.invalidate('pagos');
      await loadData();
    } catch (e) {
      appStore.alert('Error al eliminar pago: ' + (e as Error).message);
    }
  }

  async function toggleEntrega(row: FichaSemanalRow) {
    const newStatus = row.estado_entrega === 'ENTREGADO' ? 'PENDIENTE' : 'ENTREGADO';
    try {
      await Promise.all([
        api.patchInvoiceField(row.id, 'estado_entrega', newStatus),
        api.patchInvoiceField(row.id, 'estado_moldura', newStatus === 'ENTREGADO' ? 'DELETED' : 'PENDING'),
        api.patchInvoiceField(row.id, 'estado_orden_tela', newStatus === 'ENTREGADO' ? 'DELETED' : 'PENDING'),
      ]);
      confirmEntregaId = null;
      cacheStore.invalidate('facturas');
      cacheStore.invalidate('pagos');
      await loadData();
    } catch (e) {
      appStore.alert('Error al cambiar estado de entrega: ' + (e as Error).message);
    }
  }

  async function loadAudit() {
    try {
      const allP = await api.listPagos();
      const facturaMap = new Map(facturas.map(f => [f.id, f.cliente_nombre || '']));
      auditLogs = allP
        .filter(p => p.username)
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .slice(0, 100)
        .map(p => ({
          fecha_sistema: p.date,
          mensaje: `"${p.username}" registró ${formatCurrency(p.amount)} (Pago del ${formatDate(p.date)}) - Cliente: ${facturaMap.get(p.invoice_id) || 'Desconocido'}`,
        }));
      showAudit = true;
    } catch (e) {
      appStore.alert('Error al cargar auditoría: ' + (e as Error).message);
    }
  }

  function getEstadoClass(estado: string): string {
    if (estado === 'PAGADO') return 'estado-pagado';
    if (estado === 'PARCIAL') return 'estado-parcial';
    return 'estado-pendiente';
  }

  function getEntregaClass(estado: string): string {
    return estado === 'ENTREGADO' ? 'entrega-listp' : 'entrega-pend';
  }

  function clearFilters() {
    const d = getDefaultDates();
    appStore.fsStartDate = d.start;
    appStore.fsEndDate = d.end;
    appStore.fsFilterCliente = '';
    appStore.fsFilterEstado = 'TODOS';
    appStore.fsFilterEntrega = 'TODOS';
    loadData();
  }

  function copyPhone(rowId: number | null) {
    if (!rowId) return;
    const f = facturas.find(x => x.id === rowId);
    const phone = f?.cliente_telefono?.trim();
    if (!phone) {
      appStore.alert('El cliente no tiene teléfono cargado');
      return;
    }
    navigator.clipboard.writeText(phone);
    appStore.showToast(`Teléfono copiado: ${phone}`, 'success');
    ctxMenuShow = false;
  }

  let initialized = $state(false);
  let showKpis = $state(true);

  onMount(() => {
    const d = getDefaultDates();
    appStore.fsStartDate = d.start;
    appStore.fsEndDate = d.end;
    initialized = true;
    loadData();
  });

  $effect(() => {
    if (initialized) loadData();
  });
</script>

<div class="ficha-semanal">
  <!-- KPI Cards -->
  {#if showKpis}
  <div class="fs-kpis">
    <div class="kpi-card">
      <span class="kpi-label">VENTAS</span>
      <span class="kpi-value">{formatCurrency(kpis.v_p)}</span>
      <span class="kpi-sub">Global: {formatCurrency(kpis.v_g)}</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">COBRADO</span>
      <span class="kpi-value">{formatCurrency(kpis.c_p)}</span>
      <span class="kpi-sub">Global: {formatCurrency(kpis.c_g)}</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">DEUDA</span>
      <span class="kpi-value">{formatCurrency(kpis.d_p)}</span>
      <span class="kpi-sub">Global: {formatCurrency(kpis.d_g)}</span>
    </div>
    <div class="kpi-card">
      <span class="kpi-label">FACTURAS</span>
      <span class="kpi-value">{kpis.n_p}</span>
      <span class="kpi-sub">Global: {kpis.n_g}</span>
    </div>
  </div>
  {/if}

  <!-- Summary Strip -->
  <div class="fs-summary">
    <button class="kpi-toggle" onclick={() => showKpis = !showKpis} title={showKpis ? 'Ocultar cards' : 'Mostrar cards'}>
      {showKpis ? '▲' : '▼'}
    </button>
    <span>{summaryStats.totalRows} facturas</span>
    <span>Ventas: {formatCurrency(summaryStats.totalVentas)}</span>
    <span>Cobrado: {formatCurrency(summaryStats.totalPagado)}</span>
    <span>Saldo: {formatCurrency(summaryStats.totalSaldo)}</span>
    <span class="estado-pagado">✓ {summaryStats.pagadas} pagadas</span>
    <span class="estado-parcial">◐ {summaryStats.parciales} parciales</span>
    <span class="estado-pendiente">◯ {summaryStats.pendientes} pendientes</span>
    <span class="entrega-listp">☑ {summaryStats.entregadas} entregadas</span>
  </div>

  <!-- Main content: Table + Right Panel -->
  <div class="fs-body">
    <!-- Left: Main Table -->
    <div class="fs-table-container">
      {#if loading}
        <div class="fs-loading">Cargando datos...</div>
      {:else if filteredRows.length === 0}
        <div class="fs-empty">No hay facturas en el período seleccionado.</div>
      {:else}
        <table class="fs-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>N°</th>
              <th>Cliente</th>
              <th>Total</th>
              <th>Pagado</th>
              <th>Saldo</th>
              <th>Estado</th>
              <th>Entrega</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredRows as row (row.id)}
              <tr ondblclick={() => openNewPago(row.id)} oncontextmenu={(e) => { e.preventDefault(); ctxMenuRowId = row.id; ctxMenuX = e.clientX; ctxMenuY = e.clientY; ctxMenuShow = true; }}>
                <td>{formatDate(row.fecha)}</td>
                <td class="td-numero">{row.numero}</td>
                <td>{row.cliente}</td>
                <td class="td-number">{formatCurrency(row.total)}</td>
                <td class="td-number">{formatCurrency(row.pagado)}</td>
                <td class="td-number">{formatCurrency(row.saldo)}</td>
                <td>
                  <span class={`estado-badge ${getEstadoClass(row.estado)}`}>{row.estado}</span>
                </td>
                <td>
                  {#if confirmEntregaId === row.id}
                    <span class="entrega-confirm">
                      ¿{row.estado_entrega === 'ENTREGADO' ? 'Pendiente?' : 'Entregado?'}
                      <button class="btn btn-xs btn-success" onclick={() => toggleEntrega(row)}>Sí</button>
                      <button class="btn btn-xs btn-secondary" onclick={() => confirmEntregaId = null}>No</button>
                    </span>
                  {:else}
                    <button
                      class={`entrega-btn ${getEntregaClass(row.estado_entrega)}`}
                      onclick={() => confirmEntregaId = row.id}
                      title="Click para cambiar estado de entrega"
                    >
                      {row.estado_entrega === 'ENTREGADO' ? '☑ LISTO' : '☐ PEND'}
                    </button>
                    {#if row.fecha_entrega}
                      <span class="entrega-date">({formatDate(row.fecha_entrega)})</span>
                    {/if}
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>

    <!-- Right Panel -->
    <div class="fs-right">
      <!-- Recent Payments -->
      <div class="fs-right-section">
        <h3>Últimos Pagos</h3>
        <div class="fs-pagos-list">
          {#each paginatedPagos as p}
            <div class="fs-pago-item" ondblclick={() => openEditPago(p)} title="Doble click para editar">
              <span class="pago-date">{formatDate(p.date)}</span>
              <span class="pago-cliente">{p.cliente_nombre}</span>
              <span class="pago-amount">{formatCurrency(p.amount)}</span>
              <span class="pago-method">{p.method}</span>
            </div>
          {:else}
            <div class="fs-empty-sm">No hay pagos en el período</div>
          {/each}
        </div>
        {#if totalPagoPages > 1}
          <div class="fs-pagination">
            <button class="btn btn-xs btn-secondary" disabled={pagoPage === 0} onclick={() => pagoPage--}>◀</button>
            <span>{pagoPage + 1} / {totalPagoPages}</span>
            <button class="btn btn-xs btn-secondary" disabled={pagoPage >= totalPagoPages - 1} onclick={() => pagoPage++}>▶</button>
          </div>
        {/if}
      </div>

      <!-- Top Debtors -->
      <div class="fs-right-section">
        <h3>Ranking Deudores</h3>
        <div class="fs-debtors-list">
          {#each topDebtors.slice(0, 10) as d, i}
            <div class="fs-debtor-item">
              <span class="debtor-rank">#{i + 1}</span>
              <span class="debtor-name">{d.cliente}</span>
              <span class="debtor-amount">{formatCurrency(d.deuda)}</span>
            </div>
          {:else}
            <div class="fs-empty-sm">Sin deudas pendientes</div>
          {/each}
        </div>
      </div>
    </div>
  </div>

  {#if ctxMenuShow}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="ctx-backdrop" onclick={() => ctxMenuShow = false} oncontextmenu={() => ctxMenuShow = false}></div>
    <div class="ctx-menu" style="left: {ctxMenuX}px; top: {ctxMenuY}px;">
      <button class="ctx-item" onclick={() => copyPhone(ctxMenuRowId)}>📋 Copiar teléfono</button>
    </div>
  {/if}
</div>

<!-- Payment Dialog -->
{#if showPagoDialog}
  <PagoDialog
    bind:show={showPagoDialog}
    editing={pagoDlg.editing}
    pagoId={pagoDlg.pagoId ?? 0}
    invoiceId={pagoDlg.invoiceId ?? 0}
    invoiceNumero={pagoDlg.invoiceNumero}
    invoiceCliente={pagoDlg.invoiceCliente}
    invoiceTotal={pagoDlg.invoiceTotal}
    initialAmount={pagoDlg.initialAmount}
    initialDate={pagoDlg.initialDate}
    initialMethod={pagoDlg.initialMethod}
    initialEntityType={pagoDlg.initialEntityType}
    initialEntityId={pagoDlg.initialEntityId ?? 0}
    onclose={() => { showPagoDialog = false; }}
    onsaved={handlePagoSaved}
    onDelete={handleDeletePago}
  />
{/if}

<!-- Audit Dialog -->
{#if showAudit}
  <div class="modal-overlay" role="presentation">
    <div class="modal modal-lg" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (showAudit = false)}>
      <div class="modal-header">
        <h3>Auditoría - Historial de Cambios</h3>
        <button class="modal-close" onclick={() => showAudit = false} aria-label="Cerrar">✕</button>
      </div>
      <div class="modal-body">
        {#if auditLogs.length === 0}
          <p>Sin registros de auditoría.</p>
        {:else}
          <table class="fs-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {#each auditLogs as log}
                <tr>
                  <td>{formatDate(log.fecha_sistema)}</td>
                  <td>{log.mensaje}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={() => showAudit = false}>Cerrar</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .ficha-semanal {
    padding: 1.143rem;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.857rem;
    background: var(--bg-page);
  }



  .fs-kpis {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.714rem;
  }
  .kpi-card {
    background: var(--bg-card);
    border-radius: 0.571rem;
    padding: 0.857rem 1rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
    display: flex;
    flex-direction: column;
  }
  .kpi-label { font-size: 0.85rem; text-transform: uppercase; color: var(--text-muted); font-weight: 600; }
  .kpi-value { font-size: 1.4rem; font-weight: 700; color: var(--text-primary); }
  .kpi-sub { font-size: 0.85rem; color: var(--text-muted); }

  .fs-summary {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    align-items: center;
    background: var(--bg-card);
    padding: 0.571rem 1rem;
    border-radius: 0.571rem;
    font-size: 0.92rem;
    color: var(--text-secondary);
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }
  .kpi-toggle {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 11px;
    padding: 2px 4px;
    line-height: 1;
    color: var(--text-muted);
  }
  .kpi-toggle:hover { color: var(--text-primary); }

  .fs-body {
    display: flex;
    gap: 0.857rem;
    flex: 1;
    min-height: 0;
  }

  .fs-table-container {
    flex: 1;
    background: var(--bg-card);
    border-radius: 0.571rem;
    overflow: auto;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }

  .fs-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem;
  }
  .fs-table th {
    background: var(--bg-page);
    padding: 0.714rem 0.857rem;
    text-align: left;
    font-weight: 600;
    color: var(--text-secondary);
    font-size: 0.88rem;
    text-transform: uppercase;
    position: sticky;
    top: 0;
    border-bottom: 2px solid var(--border-light);
  }
  .fs-table td {
    padding: 0.714rem 0.857rem;
    border-bottom: 1px solid #f0f0f0;
    cursor: pointer;
  }
  .fs-table tr:hover { background: var(--accent-light); }
  .td-number { text-align: right; font-family: monospace; font-size: 0.95rem; }
  .td-numero { font-family: monospace; font-size: 0.92rem; }

  .estado-badge {
    display: inline-block;
    padding: 0.286rem 0.857rem;
    border-radius: 0.714rem;
    font-size: 0.88rem;
    font-weight: 600;
  }
  .estado-pagado { color: #27ae60; }
  .estado-parcial { color: #d68910; }
  .estado-pendiente { color: #e74c3c; }
  .entrega-btn {
    border: none;
    background: none;
    cursor: pointer;
    font-size: 0.95rem;
    padding: 0.357rem 0.643rem;
    border-radius: 0.286rem;
    font-weight: 600;
  }
  .entrega-btn:hover { background: #f0f0f0; }
  .entrega-listp { color: #2980b9; }
  .entrega-pend { color: #e67e22; }
  .entrega-date { font-size: 0.85rem; color: var(--text-muted); }
  .entrega-confirm {
    display: flex;
    align-items: center;
    gap: 0.286rem;
    font-size: 0.88rem;
  }

  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
  }
  .ctx-menu {
    position: fixed;
    z-index: 1000;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    box-shadow: 0 0.286rem 1rem rgba(0,0,0,0.15);
    min-width: 10rem;
    padding: 0.286rem;
  }
  .ctx-item {
    display: block;
    width: 100%;
    padding: 0.571rem 1rem;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 0.92rem;
    text-align: left;
    border-radius: 0.286rem;
    color: var(--text-primary);
  }
  .ctx-item:hover { background: var(--accent-light); }

  .fs-right {
    width: 22.857rem;
    display: flex;
    flex-direction: column;
    gap: 0.714rem;
    flex-shrink: 0;
  }

  .fs-right-section {
    background: var(--bg-card);
    border-radius: 0.571rem;
    padding: 0.714rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
    overflow: auto;
    flex: 1;
  }
  .fs-right-section h3 {
    margin: 0 0 0.429rem;
    font-size: 0.92rem;
    color: var(--text-primary);
  }

  .fs-pagos-list {
    display: flex;
    flex-direction: column;
    gap: 0.143rem;
  }
  .fs-pago-item {
    display: flex;
    gap: 0.429rem;
    padding: 0.5rem 0.571rem;
    border-radius: 0.286rem;
    font-size: 0.92rem;
    cursor: pointer;
    align-items: center;
  }
  .fs-pago-item:hover { background: var(--accent-light); }
  .pago-date { color: var(--text-muted); min-width: 4.286rem; }
  .pago-cliente { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pago-amount { font-family: monospace; font-weight: 600; min-width: 5rem; text-align: right; }
  .pago-method { font-size: 0.85rem; color: var(--text-muted); min-width: 3.571rem; text-align: right; }

  .fs-pagination {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 0.571rem;
    margin-top: 0.429rem;
    font-size: 0.88rem;
  }

  .fs-debtors-list {
    display: flex;
    flex-direction: column;
    gap: 0.143rem;
  }
  .fs-debtor-item {
    display: flex;
    gap: 0.429rem;
    padding: 0.429rem 0.571rem;
    font-size: 0.92rem;
    align-items: center;
  }
  .debtor-rank { color: var(--text-muted); min-width: 1.571rem; font-weight: 600; }
  .debtor-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .debtor-amount { font-family: monospace; min-width: 4.643rem; text-align: right; color: #e74c3c; }

  .fs-loading, .fs-empty {
    padding: 2.857rem;
    text-align: center;
    color: var(--text-muted);
  }
  .fs-empty-sm {
    padding: 0.857rem;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.88rem;
  }

  .btn-full { width: 100%; }

  /* Modal styles (same as other screens) */
  :global(.modal-overlay) {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  :global(.modal) {
    background: var(--bg-card);
    border-radius: 0.857rem;
    padding: 1.429rem;
    min-width: 30rem;
    max-width: 90vw;
    max-height: 80vh;
    overflow: auto;
    box-shadow: 0 0.571rem 2.143rem rgba(0,0,0,0.15);
  }
  :global(.modal-lg) { min-width: 35.714rem; min-height: 21.429rem; }
  :global(.modal-header) { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
  :global(.modal-header h3) { margin: 0; color: var(--text-primary); }
  :global(.modal-close) { background: none; border: none; font-size: 1.143rem; cursor: pointer; color: var(--text-muted); padding: 0.286rem; border-radius: 0.286rem; }
  :global(.modal-close:hover) { background: var(--bg-hover); color: var(--text-primary); }
  :global(.modal-body) { display: flex; flex-direction: column; gap: 0.714rem; }
  :global(.modal-footer) {
    display: flex;
    justify-content: flex-end;
    gap: 0.571rem;
    margin-top: 1rem;
    padding-top: 0.857rem;
    border-top: 1px solid var(--border-light);
  }
  :global(.form-group) {
    display: flex;
    flex-direction: column;
    gap: 0.214rem;
  }
  :global(.form-group label) {
    font-size: 0.88rem;
    color: var(--text-secondary);
  }
  :global(.form-group input) {
    padding: 0.571rem 0.714rem;
    border: 1px solid var(--border);
    border-radius: 0.429rem;
    font-size: 0.95rem;
    background: var(--bg-card);
    color: var(--text-primary);
    outline: none;
    width: 100%;
    box-sizing: border-box;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  :global(.form-group select) {
    padding: 0.571rem 0.714rem;
    border: 1px solid var(--border);
    border-radius: 0.429rem;
    font-size: 0.95rem;
  }
  :global(.form-group input:focus),
  :global(.form-group select:focus) {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 0.143rem rgba(52,152,219,0.15);
  }

  :global(.btn) {
    padding: 0.571rem 1.143rem;
    border: none;
    border-radius: 0.429rem;
    cursor: pointer;
    font-size: 0.92rem;
    font-weight: 500;
    transition: all 0.15s;
  }
  :global(.btn:hover) { filter: brightness(0.95); }
  :global(.btn:disabled) { opacity: 0.5; cursor: default; }
  :global(.btn-primary) {     background: var(--accent);
    color: white; }
  :global(.btn-secondary) { background: var(--bg-hover); color: var(--text-secondary); }
  :global(.btn-success) { background: var(--success); color: white; }
  :global(.btn-danger) { background: var(--danger); color: white; }
  :global(.btn-sm) { padding: 0.429rem 0.857rem; font-size: 0.88rem; }
  :global(.btn-xs) { padding: 0.286rem 0.714rem; font-size: 0.82rem; }
</style>
