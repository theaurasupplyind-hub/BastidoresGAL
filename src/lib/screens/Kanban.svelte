<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import type { Factura, InvoiceItem } from '$lib/types';
  import { hasMolduraItems, parseCard, buildMoldurasHtmlByTemplate } from '$lib/utils/molduras';
  import { invoke } from '@tauri-apps/api/core';
  import InvoicePrintModal from '$lib/components/InvoicePrintModal.svelte';

  const COLUMNS = [
    { key: 'PEDIDO',    title: 'Pedidos',     icon: '📋', color: '#dc3545' },
    { key: 'EN_PROCESO',title: 'En Proceso',   icon: '⚙',  color: '#0dcaf0' },
    { key: 'LISTO',     title: 'Listo',        icon: '✅',  color: '#198754' },
    { key: 'ENTREGADO', title: 'Entregados',   icon: '🚚',  color: '#6c757d' },
  ] as const;

  type ColKey = (typeof COLUMNS)[number]['key'];
  type TipoEntregaFilter = 'TODOS' | 'Retira' | 'Envio' | 'Retiro y Envio';
  type PeriodoFilter = 'TODOS' | 'VENCIDO' | 'ESTA_SEMANA' | 'PROXIMA_SEMANA' | 'ESTE_MES';

  interface ColumnFilters { tipo_entrega: TipoEntregaFilter; periodo: PeriodoFilter; search: string; }

  const FILTER_PRESETS: { label: string; values: Partial<ColumnFilters> }[] = [
    { label: 'Retiran urgentes', values: { tipo_entrega: 'Retira', periodo: 'VENCIDO' } },
    { label: 'Envíos esta semana', values: { tipo_entrega: 'Envio', periodo: 'ESTA_SEMANA' } },
    { label: 'Solo Retiran', values: { tipo_entrega: 'Retira', periodo: 'TODOS' } },
    { label: 'Solo Envíos', values: { tipo_entrega: 'Envio', periodo: 'TODOS' } },
    { label: 'Vencidos', values: { tipo_entrega: 'TODOS', periodo: 'VENCIDO' } },
    { label: 'Esta semana', values: { tipo_entrega: 'TODOS', periodo: 'ESTA_SEMANA' } },
    { label: 'Próxima semana', values: { tipo_entrega: 'TODOS', periodo: 'PROXIMA_SEMANA' } },
    { label: 'Este mes', values: { tipo_entrega: 'TODOS', periodo: 'ESTE_MES' } },
  ];

  const TIPO_ENTREGA_OPTS: { value: TipoEntregaFilter; label: string }[] = [
    { value: 'TODOS', label: 'Todos' },
    { value: 'Retira', label: 'Retiran' },
    { value: 'Envio', label: 'Envían' },
    { value: 'Retiro y Envio', label: 'Ret+Env' },
  ];

  const PERIODO_OPTS: { value: PeriodoFilter; label: string }[] = [
    { value: 'TODOS', label: 'Todos' },
    { value: 'VENCIDO', label: 'Vencidos' },
    { value: 'ESTA_SEMANA', label: 'Esta semana' },
    { value: 'PROXIMA_SEMANA', label: 'Próxima semana' },
    { value: 'ESTE_MES', label: 'Este mes' },
  ];

  function defaultFilters(): ColumnFilters {
    return { tipo_entrega: 'TODOS', periodo: 'TODOS', search: '' };
  }

  let loading = $state(false);
  let facturas = $state<Factura[]>([]);
  let columns = $state<{ key: string; cards: Factura[]; highlight: boolean }[]>(
    COLUMNS.map(c => ({ key: c.key, cards: [], highlight: false }))
  );
  let selectedIds = $state<Set<number>>(new Set());
  let draggedCard = $state<{ id: number; colIdx: number } | null>(null);
  let showItemsModal = $state(false);
  let modalItems = $state<InvoiceItem[]>([]);
  let modalTitle = $state('');
  let showInvoicePrintModal = $state(false);
  let invoicePrintColIdx = $state(-1);
  let modalFacturaId = $state<number | null>(null);
  let checkedItems = $state<Set<number>>(new Set());
  let savedItems = $state<Set<number>>(new Set());
  let savingCheck = $state(false);
  let hasUnsavedChanges = $derived(
    modalFacturaId != null && (
      checkedItems.size !== savedItems.size ||
      [...checkedItems].some(i => !savedItems.has(i))
    )
  );

  let columnFilters = $state<Record<ColKey, ColumnFilters>>({
    PEDIDO: defaultFilters(),
    EN_PROCESO: defaultFilters(),
    LISTO: defaultFilters(),
    ENTREGADO: defaultFilters(),
  });
  let filterOpen = $state<ColKey | null>(null);
  let filterPopoverStyle = $state('');

  let editingCardId = $state<number | null>(null);
  let editTipo = $state('');
  let editFecha = $state('');
  let savingCard = $state(false);
  let generatingPdfCol = $state<number | null>(null);
  let config = $state<any>({});

  function fechaToInput(fechaEntrega: string): string {
    if (!fechaEntrega) return '';
    const d = parseFecha(fechaEntrega);
    if (d.getTime() === 0) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function inputToFecha(val: string): string {
    if (!val) return '';
    const p = val.split('-');
    if (p.length !== 3) return val;
    return `${p[2]}/${p[1]}/${p[0]}`;
  }

  function formatInputFecha(val: string): string {
    if (!val) return '';
    const p = val.split('-');
    if (p.length !== 3) return val;
    return `${p[2]}/${p[1]}/${p[0].slice(-2)}`;
  }

  function startEditing(card: Factura) {
    if (editingCardId === card.id) {
      cancelEdit();
      return;
    }
    editingCardId = card.id;
    editTipo = card.tipo_entrega || '';
    editFecha = fechaToInput(card.fecha_entrega || '');
  }

  function closeItemsModal() {
    showItemsModal = false;
    modalFacturaId = null;
    checkedItems = new Set();
    savedItems = new Set();
  }

  function cancelEdit() {
    editingCardId = null;
    editTipo = '';
    editFecha = '';
  }

  function isDirty(card: Factura): boolean {
    return (card.tipo_entrega || '') !== editTipo || fechaToInput(card.fecha_entrega || '') !== editFecha;
  }

  async function saveEdits(card: Factura) {
    if (savingCard) return;
    savingCard = true;
    try {
      const patches: Promise<any>[] = [];
      if ((card.tipo_entrega || '') !== editTipo) {
        patches.push(api.patchInvoiceField(card.id, 'tipo_entrega', editTipo));
      }
      if (fechaToInput(card.fecha_entrega || '') !== editFecha) {
        patches.push(api.patchInvoiceField(card.id, 'fecha_entrega', inputToFecha(editFecha)));
      }
      if (patches.length > 0) {
        await Promise.all(patches);
        appStore.showToast('Cambios guardados', 'success');
        cacheStore.invalidate('facturas');
        cancelEdit();
        await loadData();
      }
    } catch (e: any) {
      appStore.alert('Error al guardar: ' + (e?.message || e));
    } finally {
      savingCard = false;
    }
  }

  function handleCardContextMenu(e: MouseEvent, card: Factura) {
    e.preventDefault();
    startEditing(card);
  }

  function parseFecha(s: string): Date {
    if (!s) return new Date(0);
    if (s.includes('/')) {
      const p = s.split('/');
      return new Date(+p[2], +p[1] - 1, +p[0]);
    }
    if (s.includes('-')) return new Date(s);
    return new Date(0);
  }

  function shortDate(s: string): string {
    if (!s) return '';
    const p = s.split('/');
    if (p.length === 3) return `${p[0]}/${p[1]}`;
    return s;
  }

  function formatFecha(s: string): string {
    if (!s) return '—';
    if (s.includes('/')) {
      const p = s.split('/');
      return `${p[0]}/${p[1]}/${p[2].slice(-2)}`;
    }
    if (s.includes('-')) {
      const p = s.split('-');
      return `${p[2]}/${p[1]}/${p[0].slice(-2)}`;
    }
    return s;
  }

  function getDiaSemana(s: string): string {
    if (!s) return '';
    const dias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const d = parseFecha(s);
    if (d.getTime() === 0) return '';
    return dias[d.getDay()];
  }

  function enSemanaActual(s: string): boolean {
    if (!s) return false;
    const d = parseFecha(s);
    if (d.getTime() === 0) return false;
    const { ini, fin } = getWeekRange(new Date());
    return d.getTime() >= ini.getTime() && d.getTime() <= fin.getTime();
  }

  function formatFechaDisplay(s: string): string {
    if (!s) return '—';
    if (enSemanaActual(s)) return getDiaSemana(s);
    return formatFecha(s);
  }

  const entregaLabels: Record<string, string> = {
    'Retira': 'Retira',
    'Envio': 'Envío',
    'Retiro y Envio': 'Ret+Env',
  };

  function getTipoBadge(tipo: string): { label: string; color: string } {
    const label = entregaLabels[tipo] || tipo;
    const colors: Record<string, string> = { 'Retira': '#6c757d', 'Envio': '#0d6efd', 'Retiro y Envio': '#6f42c1' };
    return { label, color: colors[tipo] || '#999' };
  }

  function getUrgencia(f: Factura): { label: string; color: string; bg: string } | null {
    if (!f.fecha_entrega) return null;
    const fe = parseFecha(f.fecha_entrega);
    if (fe.getTime() === 0) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diff = fe.getTime() - today.getTime();
    const days = Math.ceil(diff / 86400000);
    if (days < 0) return { label: 'VENCIDO', color: '#fff', bg: '#dc3545' };
    if (days <= 3) return { label: 'URGENTE', color: '#fff', bg: '#e67e22' };
    if (days <= 7) return { label: 'PRONTO', color: '#856404', bg: '#fff3cd' };
    return { label: 'OK', color: '#fff', bg: '#16a34a' };
  }

  function getWeekRange(ref: Date): { ini: Date; fin: Date } {
    const d = new Date(ref);
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1; // Monday-based
    const ini = new Date(d);
    ini.setDate(d.getDate() - diff);
    ini.setHours(0, 0, 0, 0);
    const fin = new Date(ini);
    fin.setDate(ini.getDate() + 6);
    fin.setHours(23, 59, 59, 999);
    return { ini, fin };
  }

  function matchesPeriodo(fe: Date | null, periodo: PeriodoFilter): boolean {
    if (periodo === 'TODOS' || !fe || fe.getTime() === 0) return true;
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    if (periodo === 'VENCIDO') return fe.getTime() < hoy.getTime();
    if (periodo === 'ESTA_SEMANA') {
      const { ini, fin } = getWeekRange(hoy);
      return fe.getTime() >= ini.getTime() && fe.getTime() <= fin.getTime();
    }
    if (periodo === 'PROXIMA_SEMANA') {
      const next = new Date(hoy);
      next.setDate(hoy.getDate() + 7);
      const { ini, fin } = getWeekRange(next);
      return fe.getTime() >= ini.getTime() && fe.getTime() <= fin.getTime();
    }
    if (periodo === 'ESTE_MES') {
      const iniMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      const finMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
      return fe.getTime() >= iniMes.getTime() && fe.getTime() <= finMes.getTime();
    }
    return true;
  }

  function applyFilters(cards: Factura[], colKey: ColKey): Factura[] {
    const f = columnFilters[colKey];
    return cards.filter(card => {
      if (f.tipo_entrega !== 'TODOS' && card.tipo_entrega !== f.tipo_entrega) return false;
      if (f.periodo !== 'TODOS') {
        const fe = card.fecha_entrega ? parseFecha(card.fecha_entrega) : null;
        if (!matchesPeriodo(fe, f.periodo)) return false;
      }
      if (f.search && f.search.trim()) {
        const q = f.search.trim().toLowerCase();
        if (!(card.cliente_nombre || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }

  function hasActiveFilters(colKey: ColKey): boolean {
    const f = columnFilters[colKey];
    return f.tipo_entrega !== 'TODOS' || f.periodo !== 'TODOS' || f.search.trim() !== '';
  }

  function clearFilters(colKey: ColKey) {
    columnFilters[colKey] = defaultFilters();
  }

  function applyPreset(colKey: ColKey, preset: Partial<ColumnFilters>) {
    columnFilters[colKey] = { ...defaultFilters(), ...preset };
  }

  function toggleFilter(colKey: ColKey, e?: MouseEvent) {
    if (filterOpen === colKey) {
      filterOpen = null;
      filterPopoverStyle = '';
    } else {
      filterOpen = colKey;
      if (e && e.currentTarget instanceof HTMLElement) {
        const col = e.currentTarget.closest('.kanban-col');
        if (col) {
          const body = col.querySelector('.col-body');
          const target = body || col;
          const rect = target.getBoundingClientRect();
          filterPopoverStyle = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px;`;
        } else {
          filterPopoverStyle = '';
        }
      } else {
        filterPopoverStyle = '';
      }
    }
  }

  async function loadData() {
    loading = true;
    selectedIds = new Set();
    try {
      const all = await cacheStore.fetch('facturas:kanban', () => api.listFacturas({ limit: 2000 }), 30000);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Filter last 30 days + assign kanban state
      const filtered: Factura[] = [];
      for (const f of all) {
        let kanban = f.estado_kanban || 'PEDIDO';
        if ((!kanban || kanban === 'PEDIDO') && f.estado_entrega === 'ENTREGADO') {
          kanban = 'ENTREGADO';
        }
        if (kanban === 'ARCHIVADO') continue;
        if (kanban === 'ENTREGADO' && f.fecha_entrega) {
          const fe = parseFecha(f.fecha_entrega);
          if (fe.getTime() > 0) {
            const days = Math.ceil((today.getTime() - fe.getTime()) / 86400000);
            if (days > 7) {
              kanban = 'ARCHIVADO';
              try {
                await api.patchInvoiceField(f.id, 'estado_kanban', 'ARCHIVADO');
              } catch {}
              continue;
            }
          }
        }
        if (!['PEDIDO', 'EN_PROCESO', 'LISTO', 'ENTREGADO'].includes(kanban)) {
          kanban = 'PEDIDO';
        }
        filtered.push({ ...f, estado_kanban: kanban });
      }

      filtered.sort((a, b) => parseFecha(a.fecha).getTime() - parseFecha(b.fecha).getTime());
      facturas = filtered;

      // Sort into columns
      for (const col of columns) {
        col.cards = applyFilters(filtered.filter(f => f.estado_kanban === col.key), col.key as ColKey);
      }
      columns = columns;
    } catch (e: any) {
      appStore.alert('Error al cargar kanban: ' + (e?.message || e));
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

  export function deselectAll() {
    selectedIds = new Set();
  }

  $effect(() => {
    appStore.kanbanSelectedCount = selectedIds.size;
  });

  async function moveCards(fromIdx: number, toIdx: number) {
    if (fromIdx < 0 || fromIdx > 3 || toIdx < 0 || toIdx > 3) return;
    const fromKey = COLUMNS[fromIdx].key;
    const toKey = COLUMNS[toIdx].key;
    const cards = columns[fromIdx].cards.filter(c => selectedIds.has(c.id));
    if (cards.length === 0) {
      appStore.showToast(`Seleccioná cards en ${COLUMNS[fromIdx].title}`, 'info');
      return;
    }

    const todayStr = new Date().toLocaleDateString('es-AR');
    try {
      await Promise.all(cards.map(c => {
        const patches = [api.patchInvoiceField(c.id, 'estado_kanban', toKey)];
        if (toKey === 'ENTREGADO') {
          patches.push(api.patchInvoiceField(c.id, 'estado_entrega', 'ENTREGADO'));
          patches.push(api.patchInvoiceField(c.id, 'estado_moldura', 'DELETED'));
          patches.push(api.patchInvoiceField(c.id, 'estado_orden_tela', 'DELETED'));
          patches.push(api.patchInvoiceField(c.id, 'fecha_entrega', todayStr));
        } else if (fromKey === 'ENTREGADO') {
          patches.push(api.patchInvoiceField(c.id, 'estado_entrega', 'PENDIENTE'));
          patches.push(api.patchInvoiceField(c.id, 'estado_moldura', 'PENDING'));
          patches.push(api.patchInvoiceField(c.id, 'estado_orden_tela', 'PENDING'));
        }
        return Promise.all(patches);
      }));
      appStore.showToast(`${cards.length} factura(s) movidas a ${COLUMNS[toIdx].title}`, 'success');
      cacheStore.invalidate('facturas');
      deselectAll();
      await loadData();
    } catch (e: any) {
      appStore.alert('Error al mover: ' + (e?.message || e));
    }
  }

  async function generateColumnPdf(colIdx: number, shouldPrint = false) {
    const cards = columns[colIdx]?.cards;
    if (!cards || cards.length === 0) {
      appStore.showToast('No hay facturas en esta columna', 'info');
      return;
    }
    generatingPdfCol = colIdx;
    try {
      const parsed = cards.map(f => {
        const p = parseCard(f);
        return { ...p, hasMoldura: hasMolduraItems(f) };
      });
      const html = buildMoldurasHtmlByTemplate(parsed, appStore.molduraTemplate);
      const pdfPath = await invoke<string>('generate_molduras_pdf', { html });
      if (shouldPrint) {
        try {
          await invoke('print_pdf', { path: pdfPath });
          appStore.showToast('Enviando a imprimir...', 'success');
        } catch (e: any) {
          const errMsg = e?.message ?? (typeof e === 'string' ? e : 'Error desconocido');
          if (errMsg.startsWith('NO_PRINTER:')) {
            appStore.alert(errMsg.replace('NO_PRINTER:', ''));
          } else if (errMsg.startsWith('NO_SE_PUDO_IMPRIMIR:')) {
            appStore.alert(errMsg.replace('NO_SE_PUDO_IMPRIMIR:', ''));
          } else {
            appStore.alert('Error al imprimir: ' + errMsg);
          }
        }
      } else {
        await invoke('open_pdf', { path: pdfPath });
        appStore.showToast('PDF generado', 'success');
      }
    } catch (e: any) {
      appStore.showToast('Error al generar PDF: ' + (e?.message || e), 'error');
    } finally {
      generatingPdfCol = null;
    }
  }

  async function sendToRemotePrintCol(colIdx: number) {
    const cards = columns[colIdx]?.cards;
    if (!cards || cards.length === 0) {
      appStore.showToast('No hay facturas en esta columna', 'info');
      return;
    }
    generatingPdfCol = colIdx;
    try {
      const parsed = cards.map(f => {
        const p = parseCard(f);
        return { ...p, hasMoldura: hasMolduraItems(f) };
      });
      const html = buildMoldurasHtmlByTemplate(parsed, appStore.molduraTemplate);
      const pdfPath = await invoke<string>('generate_molduras_pdf', { html });
      const u = appStore.user;
      const targetKey = (appStore.selectedStation || appStore.activeStations[0])?.api_key ?? null;
      await invoke('submit_print_job', {
        pdfPath,
        createdBy: u?.user_name || 'Desconocido',
        apiKey: targetKey,
      });
      appStore.showToast('Enviado a impresión remota');
    } catch (e: any) {
      appStore.showToast('Error: ' + (e?.message || e), 'error');
    } finally {
      generatingPdfCol = null;
    }
  }

  function openInvoicePrintModal(colIdx: number) {
    invoicePrintColIdx = colIdx;
    showInvoicePrintModal = true;
  }

  function closeInvoicePrintModal() {
    showInvoicePrintModal = false;
    invoicePrintColIdx = -1;
  }

  // Drag & Drop handlers
  function handleDragStart(e: DragEvent, cardId: number, colIdx: number) {
    if (!selectedIds.has(cardId)) {
      selectedIds = new Set([cardId]);
    }
    draggedCard = { id: cardId, colIdx };
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', String(cardId));
    const card = e.currentTarget as HTMLElement;
    card.style.opacity = '0.4';
  }

  function handleDragEnd(e: DragEvent) {
    const card = e.currentTarget as HTMLElement;
    card.style.opacity = '1';
    for (const col of columns) col.highlight = false;
    columns = columns;
    draggedCard = null;
  }

  function handleDragOver(e: DragEvent, colIdx: number) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    if (draggedCard && draggedCard.colIdx !== colIdx) {
      columns[colIdx].highlight = true;
      columns = columns;
    }
  }

  function handleDragLeave(colIdx: number) {
    columns[colIdx].highlight = false;
    columns = columns;
  }

  async function handleDrop(e: DragEvent, toIdx: number) {
    e.preventDefault();
    for (const col of columns) col.highlight = false;
    columns = columns;
    if (draggedCard && draggedCard.colIdx !== toIdx) {
      await moveCards(draggedCard.colIdx, toIdx);
    }
  }

  function openCard(id: number) {
    appStore.pendingInvoiceId = id;
    appStore.currentTab = 'facturacion';
  }

  function openItemsModal(f: Factura) {
    modalItems = f.items || [];
    modalTitle = `${f.cliente_nombre || '?'} — ${f.numero_factura || `#${f.id}`}`;
    modalFacturaId = f.id;
    let initial: Set<number>;
    try {
      initial = new Set<number>(JSON.parse(f.items_done || '[]'));
    } catch {
      initial = new Set<number>();
    }
    checkedItems = new Set(initial);
    savedItems = new Set(initial);
    showItemsModal = true;
  }

  function toggleItemCheck(idx: number) {
    const next = new Set(checkedItems);
    if (next.has(idx)) next.delete(idx);
    else next.add(idx);
    checkedItems = next;
  }

  async function saveCheckedItems() {
    if (modalFacturaId == null) return;
    savingCheck = true;
    try {
      await api.patchInvoiceField(modalFacturaId, 'items_done', JSON.stringify([...checkedItems]));
      savedItems = new Set(checkedItems);
      const f = facturas.find(f => f.id === modalFacturaId);
      if (f) f.items_done = JSON.stringify([...checkedItems]);
      appStore.showToast('Cambios guardados', 'success');
    } catch (e: any) {
      appStore.showToast('Error al guardar: ' + (e?.message || e), 'error');
    } finally {
      savingCheck = false;
    }
  }

  onMount(async () => {
    try { config = await invoke('get_config'); } catch {}
  });

  $effect(() => {
    if (appStore.currentTab === 'kanban' && cacheStore.get('facturas:kanban') === null) {
      loadData();
    }
  });
</script>

<div class="kanban">
  <!-- Kanban Grid -->
  <div class="kanban-grid">
    {#each COLUMNS as col, i}
      {#if i > 0}
        <div class="nav-col">
          <button class="nav-btn nav-fwd" title="Mover seleccionados a {col.title}" onclick={() => moveCards(i - 1, i)} disabled={selectedIds.size === 0}>›</button>
          <button class="nav-btn nav-bck" title="Mover seleccionados a {COLUMNS[i - 1].title}" onclick={() => moveCards(i, i - 1)} disabled={selectedIds.size === 0}>‹</button>
        </div>
      {/if}
      <div
        class="kanban-col"
        class:highlight={columns[i]?.highlight}
        ondragenter={(e) => e.preventDefault()}
        ondragover={(e) => handleDragOver(e, i)}
        ondragleave={() => handleDragLeave(i)}
        ondrop={(e) => handleDrop(e, i)}
      >
        <div class="col-header" style="--col-color: {col.color};">
          <span>{col.icon} {col.title}</span>
          <div class="col-header-right">
            {#if hasActiveFilters(col.key)}
              {@const filtered = columns[i]?.cards.length || 0}
              {@const total = facturas.filter(f => f.estado_kanban === col.key).length}
              <span class="col-count">{filtered}/{total}</span>
            {:else}
              <span class="col-count">{columns[i]?.cards.length || 0}</span>
            {/if}
            {#if col.key === 'PEDIDO' || col.key === 'LISTO'}
              <button
                class="filter-btn pdf-btn"
                title="Ver facturas e imprimir"
                onclick={() => openInvoicePrintModal(i)}
                disabled={generatingPdfCol !== null || (columns[i]?.cards.length || 0) === 0}
              >🧾</button>
            {/if}
            {#if col.key === 'EN_PROCESO'}
              <button
                class="filter-btn pdf-btn"
                title="Ver PDF de molduras"
                onclick={() => generateColumnPdf(i, false)}
                disabled={generatingPdfCol !== null || (columns[i]?.cards.length || 0) === 0}
              >{generatingPdfCol === i ? '…' : '📄'}</button>
              <button
                class="filter-btn pdf-btn"
                title="Imprimir PDF de molduras"
                onclick={() => generateColumnPdf(i, true)}
                disabled={generatingPdfCol !== null || (columns[i]?.cards.length || 0) === 0}
              >{generatingPdfCol === i ? '…' : '🖨'}</button>
              {#if appStore.activeStations.length > 0}
                <button
                  class="filter-btn pdf-btn remote-btn"
                  title="Enviar a sucursal"
                  onclick={() => sendToRemotePrintCol(i)}
                  disabled={generatingPdfCol !== null || (columns[i]?.cards.length || 0) === 0}
                >{generatingPdfCol === i ? '…' : '📤'}</button>
              {/if}
            {/if}
            <button
              class="filter-btn"
              class:filter-active={hasActiveFilters(col.key)}
              title="Filtrar {col.title}"
              onclick={(e) => toggleFilter(col.key, e)}
            >▾</button>
          </div>
        </div>
        <div class="col-body" ondragenter={(e) => e.preventDefault()} ondragover={(e) => handleDragOver(e, i)} ondrop={(e) => handleDrop(e, i)}>
          {#if loading && columns[i]?.cards.length === 0}
            <div class="col-loading">Cargando...</div>
          {:else if (columns[i]?.cards.length || 0) === 0}
            {#if hasActiveFilters(col.key)}
              <div class="col-empty filtered">Sin resultados con el filtro actual</div>
            {:else}
              <div class="col-empty">Sin facturas</div>
            {/if}
          {:else}
            {#each columns[i]?.cards || [] as card (card.id)}
              <div
                class="kanban-card"
                class:selected={selectedIds.has(card.id)}
                class:editing={editingCardId === card.id}
                draggable="true"
                ondragstart={(e) => handleDragStart(e, card.id, i)}
                ondragend={handleDragEnd}
                onclick={(e) => toggleSelect(card.id, e.ctrlKey)}
                oncontextmenu={(e) => handleCardContextMenu(e, card)}
                role="button"
                tabindex="0"
                onkeydown={(e) => { if (e.key === 'Escape') { cancelEdit(); e.preventDefault(); } else if (e.key === 'Enter') toggleSelect(card.id, e.ctrlKey); }}
              >
                <div class="card-body">
                  <div class="card-header-row">
                    <span class="card-cliente">{card.cliente_nombre || 'Sin nombre'}</span>
                    <span class="card-fecha">{shortDate(card.fecha)}</span>
                  </div>
                  {#if card.cliente_domicilio}
                    <div class="card-addr">{card.cliente_domicilio}{card.cliente_piso_depto ? ` - ${card.cliente_piso_depto}` : ''}</div>
                  {/if}
                  {#if editingCardId === card.id}
                    <div class="card-edit-row">
                      <select class="edit-select" bind:value={editTipo}>
                        <option value="Retira">Retira</option>
                        <option value="Envio">Envío</option>
                        <option value="Retiro y Envio">Ret+Env</option>
                      </select>
                      <input class="edit-date" type="date" bind:value={editFecha} />
                    </div>
                    <div class="card-edit-actions">
                      {#if isDirty(card)}
                        <button class="edit-btn edit-save" onclick={(e) => { e.stopPropagation(); saveEdits(card); }} disabled={savingCard}>💾 {savingCard ? 'Guardando...' : 'Guardar'}</button>
                      {/if}
                      <button class="edit-btn edit-cancel" onclick={(e) => { e.stopPropagation(); cancelEdit(); }}>✕</button>
                    </div>
                  {:else}
                    <div class="card-entrega">
                      <span class="badge badge-tipo" style="background: {getTipoBadge(card.tipo_entrega || '').color};">{getTipoBadge(card.tipo_entrega || '').label}</span>
                      {#if card.fecha_entrega}
                        <span class="badge badge-fecha">📅 {formatFechaDisplay(card.fecha_entrega)}</span>
                      {/if}
                      {#if getUrgencia(card)}
                        <span class="badge badge-urgencia" style="background: {getUrgencia(card)!.bg}; color: {getUrgencia(card)!.color};">{getUrgencia(card)!.label}</span>
                      {/if}
                    </div>
                  {/if}
                  {#if card.items && card.items.length > 0}
                    <div class="card-items">
                      <span class="item-preview">{card.items[0].cantidad}x {card.items[0].descripcion}</span>
                      {#if card.items.length > 1}
                        <span class="item-more" onclick={(e) => { e.stopPropagation(); openItemsModal(card); }} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && openItemsModal(card)}>Ver +{card.items.length - 1}</span>
                      {/if}
                    </div>
                  {:else}
                    <div class="card-items empty">(sin items)</div>
                  {/if}
                  <div class="card-sep"></div>
                  <div class="card-footer">
                    <span class="card-num">N° {card.numero_factura || `#${card.id}`}</span>
                    <span class="card-open" onclick={(e) => { e.stopPropagation(); openCard(card.id); }} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && openCard(card.id)}>→</span>
                  </div>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    {/each}
  </div>

  {#if selectedIds.size > 0}
    <div class="kanban-footer">
      <span class="kanban-footer-count">{selectedIds.size} seleccionada(s)</span>
      <button class="kanban-footer-deselect" onclick={deselectAll}>✕ Deseleccionar</button>
    </div>
  {/if}

  <!-- Filter Popover -->
  {#if filterOpen}
    {@const colKey = filterOpen}
    {@const f = columnFilters[colKey]}
    {@const colDef = COLUMNS.find(c => c.key === colKey)!}
    <div class="filter-col-overlay" style={filterPopoverStyle || ''}>
      <div class="filter-col-panel" onclick={(e) => e.stopPropagation()} role="dialog">
        <div class="filter-col-header" style="background:{colDef.color}">
          <span>{colDef.icon} Filtrar {colDef.title}</span>
          <button class="filter-col-close" onclick={() => { filterOpen = null; filterPopoverStyle = ''; }}>✕</button>
        </div>
        <div class="filter-col-body">
          <!-- Presets -->
          <div class="filter-section">
            <label class="filter-label">Combinaciones rápidas</label>
            <div class="preset-grid">
              {#each FILTER_PRESETS as preset (preset.label)}
                <button
                  class="preset-btn"
                  class:preset-active={f.tipo_entrega === (preset.values.tipo_entrega ?? 'TODOS') && f.periodo === (preset.values.periodo ?? 'TODOS') && !f.search}
                  onclick={() => applyPreset(colKey, preset.values)}
                >{preset.label}</button>
              {/each}
            </div>
          </div>

          <div class="filter-sep"></div>

          <!-- Tipo de entrega -->
          <div class="filter-section">
            <label class="filter-label">Tipo de entrega</label>
            <div class="filter-chip-row">
              {#each TIPO_ENTREGA_OPTS as opt}
                <button
                  class="filter-chip"
                  class:chip-active={f.tipo_entrega === opt.value}
                  onclick={() => { columnFilters[colKey].tipo_entrega = opt.value; }}
                >{opt.label}</button>
              {/each}
            </div>
          </div>

          <!-- Período -->
          <div class="filter-section">
            <label class="filter-label">Período de entrega</label>
            <div class="filter-chip-row">
              {#each PERIODO_OPTS as opt}
                <button
                  class="filter-chip"
                  class:chip-active={f.periodo === opt.value}
                  onclick={() => { columnFilters[colKey].periodo = opt.value; }}
                >{opt.label}</button>
              {/each}
            </div>
          </div>

          <!-- Search -->
          <div class="filter-section">
            <label class="filter-label">Buscar cliente</label>
            <input
              class="filter-search"
              type="text"
              placeholder="Nombre del cliente..."
              bind:value={columnFilters[colKey].search}
            />
          </div>
        </div>

        <!-- Actions -->
        <div class="filter-col-actions">
          <button class="btn btn-sm btn-outline" onclick={() => clearFilters(colKey)}>Limpiar filtros</button>
          <button class="btn btn-sm btn-primary" onclick={() => { filterOpen = null; filterPopoverStyle = ''; loadData(); }}>Aplicar</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Items Modal -->
  {#if showItemsModal}
    <div class="legend-overlay" onclick={closeItemsModal} role="presentation">
      <div class="legend-popover items-modal" onclick={(e) => e.stopPropagation()} role="dialog">
        <h3>📦 {modalTitle}</h3>
        <div class="items-list">
          {#each modalItems as item, i}
            <div class="items-row" class:checked={checkedItems.has(i)}>
              <input type="checkbox" checked={checkedItems.has(i)} onchange={() => toggleItemCheck(i)} disabled={savingCheck} />
              <span class="item-qty">{item.cantidad}x</span>
              <span class="item-desc">{item.descripcion}</span>
            </div>
          {:else}
            <div class="items-empty">Sin items</div>
          {/each}
        </div>
        <div class="items-modal-actions">
          <button class="btn btn-sm btn-primary" onclick={closeItemsModal}>Cerrar</button>
          <button class="btn btn-sm btn-primary save-checked-btn" onclick={saveCheckedItems} disabled={!hasUnsavedChanges || savingCheck}>
            {savingCheck ? 'Guardando...' : '💾 Guardar'}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Invoice Print Modal -->
  <InvoicePrintModal
    show={showInvoicePrintModal}
    cards={invoicePrintColIdx >= 0 ? (columns[invoicePrintColIdx]?.cards || []) : []}
    onClose={closeInvoicePrintModal}
  />
</div>

<style>
  .kanban {
    padding: 0.714rem;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.571rem;
    background: var(--bg-page);
    overflow: hidden;
  }

  /* === Kanban Grid === */
  .kanban-grid {
    display: grid;
    grid-template-columns: 1fr auto 1fr auto 1fr auto 1fr;
    flex: 1;
    min-height: 0;
    gap: 0;
  }

  .nav-col {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.286rem;
    padding: 0 0.286rem;
  }
  .nav-btn {
    width: 1.714rem;
    height: 1.714rem;
    border: 0.071rem solid var(--border);
    border-radius: 0.286rem;
    background: var(--bg-card);
    font-size: 1.1rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.12s;
    color: var(--text-secondary);
    padding: 0;
    line-height: 1;
  }
  .nav-btn:hover:not(:disabled) { background: var(--accent-light); border-color: var(--accent); color: var(--accent); }
  .nav-btn:disabled { opacity: 0.3; cursor: default; }

  /* === Column === */
  .kanban-col {
    display: flex;
    flex-direction: column;
    background: var(--bg-hover);
    border-radius: 0.571rem;
    overflow: hidden;
    border: 0.143rem solid transparent;
    transition: border-color 0.15s, box-shadow 0.15s;
    min-width: 0;
  }
  .kanban-col.highlight {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 0.143rem rgba(52,152,219,0.15);
    background: var(--accent-light);
  }
  .col-header {
    background: var(--col-color);
    color: white;
    padding: 0.714rem 0.857rem;
    font-size: 1.07rem;
    font-weight: 700;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  }
  .col-count {
    background: rgba(255,255,255,0.25);
    border-radius: 0.714rem;
    padding: 0.143rem 0.714rem;
    font-size: 0.92rem;
    font-weight: 700;
  }
  .col-body {
    flex: 1;
    overflow-y: auto;
    padding: 0.429rem;
    display: flex;
    flex-direction: column;
    gap: 0.429rem;
    align-content: start;
  }
  .col-loading, .col-empty {
    text-align: center;
    color: var(--text-muted);
    padding: 1.429rem;
    font-size: 0.82rem;
  }
  .col-empty.filtered { color: var(--warning); font-style: italic; }

  /* === Column Header Right === */
  .col-header-right {
    display: flex;
    align-items: center;
    gap: 0.286rem;
  }
  .filter-btn {
    width: 1.571rem;
    height: 1.571rem;
    border: none;
    border-radius: 0.286rem;
    background: rgba(255,255,255,0.2);
    color: rgba(255,255,255,0.6);
    font-size: 0.9rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    line-height: 1;
    transition: background 0.15s, color 0.15s;
  }
  .filter-btn:hover { background: rgba(255,255,255,0.35); color: white; }
  .remote-btn { color: #0369a1; border-color: #bae6fd; background: rgba(3,105,161,0.1); }
  .remote-btn:hover { background: rgba(3,105,161,0.2); }
  .filter-btn.filter-active {
    background: rgba(255,255,255,0.4);
    color: white;
    font-weight: 700;
  }

  /* === Filter Column Overlay === */
  .filter-col-overlay {
    position: fixed;
    z-index: 1000;
    background: rgba(0,0,0,0.2);
    display: flex;
    flex-direction: column;
    border-radius: 0.571rem;
    overflow: hidden;
  }
  .filter-col-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-card);
    box-shadow: 0 0.571rem 2.143rem rgba(0,0,0,0.2);
  }
  .filter-col-header {
    color: white;
    padding: 0.571rem 0.857rem;
    font-size: 1rem;
    font-weight: 700;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-shrink: 0;
  }
  .filter-col-close {
    width: 1.571rem;
    height: 1.571rem;
    border: none;
    border-radius: 0.286rem;
    background: rgba(255,255,255,0.2);
    color: white;
    font-size: 0.85rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    line-height: 1;
  }
  .filter-col-close:hover { background: rgba(255,255,255,0.35); }
  .filter-col-body {
    flex: 1;
    overflow-y: auto;
    padding: 0.857rem;
    display: flex;
    flex-direction: column;
    gap: 0.571rem;
  }
  .filter-col-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.429rem;
    padding: 0.571rem 0.857rem;
    border-top: 0.071rem solid var(--border-light);
    flex-shrink: 0;
  }

  .filter-section { display: flex; flex-direction: column; gap: 0.357rem; }
  .filter-label { font-size: 0.78rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.03em; }
  .filter-sep { height: 0.071rem; background: var(--border-light); margin: 0.357rem 0; }

  /* Presets */
  .preset-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.357rem;
  }
  .preset-btn {
    padding: 0.357rem 0.571rem;
    border: 0.071rem solid var(--border);
    border-radius: 0.357rem;
    background: var(--bg-page);
    font-size: 0.78rem;
    cursor: pointer;
    text-align: left;
    transition: all 0.12s;
    color: var(--text-secondary);
  }
  .preset-btn:hover { border-color: var(--accent); background: var(--accent-light); }
  .preset-btn.preset-active {
    border-color: #3498db;
    background: #d6eaf8;
    color: #1a5276;
    font-weight: 600;
  }

  /* Chips */
  .filter-chip-row { display: flex; flex-wrap: wrap; gap: 0.286rem; }
  .filter-chip {
    padding: 0.214rem 0.643rem;
    border: 0.071rem solid var(--border);
    border-radius: 1.071rem;
    background: var(--bg-page);
    font-size: 0.78rem;
    cursor: pointer;
    transition: all 0.12s;
    color: var(--text-secondary);
    white-space: nowrap;
  }
  .filter-chip:hover { border-color: var(--text-muted); }
  .filter-chip.chip-active {
    border-color: #3498db;
    background: #3498db;
    color: white;
  }

  .filter-search {
    padding: 0.429rem 0.643rem;
    border: 0.071rem solid var(--border);
    border-radius: 0.357rem;
    font-size: 0.82rem;
    outline: none;
    transition: border-color 0.15s;
  }
  .filter-search:focus { border-color: var(--accent); }

  .kanban-card.editing {
    border-color: var(--col-color, #3498db);
    box-shadow: 0 0 0 0.143rem rgba(52,152,219,0.2);
  }

  /* === Card Edit Mode === */
  .card-edit-row {
    display: flex;
    gap: 0.357rem;
    align-items: center;
  }
  .edit-select {
    flex: 1;
    padding: 0.286rem 0.357rem;
    border: 0.071rem solid var(--border);
    border-radius: 0.286rem;
    font-size: 0.78rem;
    background: var(--bg-card);
    color: var(--text-primary);
    outline: none;
    min-width: 0;
  }
  .edit-select:focus { border-color: var(--accent); }
  .edit-date {
    flex: 1;
    padding: 0.286rem 0.357rem;
    border: 0.071rem solid var(--border);
    border-radius: 0.286rem;
    font-size: 0.78rem;
    background: var(--bg-card);
    color: var(--text-primary);
    outline: none;
    min-width: 0;
    font-family: inherit;
  }
  .edit-date:focus { border-color: var(--accent); }
  .card-edit-actions {
    display: flex;
    gap: 0.357rem;
    align-items: center;
    justify-content: flex-end;
  }
  .edit-btn {
    padding: 0.214rem 0.5rem;
    border-radius: 0.286rem;
    font-size: 0.75rem;
    cursor: pointer;
    border: none;
    transition: background 0.12s;
    font-weight: 600;
    line-height: 1.3;
  }
  .edit-save {
    background: #3498db;
    color: white;
  }
  .edit-save:hover:not(:disabled) { background: #2e86c1; }
  .edit-save:disabled { opacity: 0.5; cursor: default; }
  .edit-cancel {
    background: var(--bg-hover);
    color: var(--text-muted);
  }
  .edit-cancel:hover { background: var(--bg-active); }

  /* === Card === */
  .kanban-card {
    background: var(--bg-card);
    border-radius: 0.429rem;
    overflow: hidden;
    cursor: pointer;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
    border: 0.143rem solid var(--border);
    transition: border-color 0.12s, box-shadow 0.12s, opacity 0.15s;
    user-select: none;
    flex-shrink: 0;
    min-height: 6.429rem;
  }
  .kanban-card:hover { border-color: var(--text-muted); box-shadow: 0 0.143rem 0.429rem rgba(0,0,0,0.08); }
  .kanban-card.selected { border-color: var(--col-color, #dc3545); box-shadow: 0 0 0 0.143rem rgba(var(--col-color), 0.15); }
  .kanban-card.dragging { opacity: 0.4; }


  .card-body { padding: 0.429rem 0.571rem; display: flex; flex-direction: column; gap: 0.286rem; }

  .card-header-row { display: flex; justify-content: space-between; align-items: center; }
  .card-cliente { font-size: 1.1rem; font-weight: 700; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .card-fecha { font-size: 0.85rem; color: var(--text-muted); flex-shrink: 0; }
  .card-addr { font-size: 0.85rem; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .card-entrega { display: flex; flex-wrap: wrap; align-items: center; gap: 0.429rem; }

  .card-items { display: flex; align-items: center; gap: 0.286rem; font-size: 0.9rem; }
  .card-items.empty { color: var(--text-muted); font-style: italic; }
  .item-preview { font-weight: 500; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .item-more { font-size: 0.8rem; color: var(--accent); font-weight: 600; cursor: pointer; white-space: nowrap; flex-shrink: 0; }
  .item-more:hover { text-decoration: underline; }

  .card-sep { height: 0.071rem; background: var(--border-light); margin: 0.143rem 0; }

  .card-footer { display: flex; justify-content: space-between; align-items: center; }
  .card-num { font-size: 0.72rem; color: var(--text-muted); }
  .card-open { font-size: 0.88rem; color: var(--text-muted); cursor: pointer; padding: 0.143rem 0.286rem; line-height: 1; transition: color 0.12s; }
  .card-open:hover { color: var(--accent); }

  /* === Badges === */
  .badge {
    display: inline-block;
    padding: 0.071rem 0.429rem;
    border-radius: 0.214rem;
    font-size: 0.72rem;
    font-weight: 700;
    color: white;
    white-space: nowrap;
    line-height: 1.4;
  }
  .badge-fecha {
    background: var(--bg-hover);
    color: var(--text-secondary);
  }

  /* === Legend Popover === */
  .legend-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .legend-popover {
    background: var(--bg-card);
    border-radius: 0.857rem;
    padding: 1.429rem;
    min-width: 18.571rem;
    max-width: 90vw;
    box-shadow: 0 0.571rem 2.143rem rgba(0,0,0,0.15);
    display: flex;
    flex-direction: column;
    gap: 0.714rem;
  }
  .legend-popover h3 { margin: 0; font-size: 1rem; color: var(--text-primary); }
  .items-modal { min-width: 25rem; max-height: 70vh; overflow-y: auto; }
  .items-list { display: flex; flex-direction: column; gap: 0.286rem; max-height: 18rem; overflow-y: auto; }
  .items-row { display: flex; gap: 0.571rem; padding: 0.286rem 0; border-bottom: 0.071rem solid var(--border-light); font-size: 0.85rem; align-items: center; }
  .items-row.checked { opacity: 0.5; text-decoration: line-through; background: var(--bg-hover); border-radius: 0.286rem; padding-left: 0.286rem; }
  .items-row input[type="checkbox"] { margin: 0; cursor: pointer; flex-shrink: 0; }
  .item-qty { font-weight: 700; color: var(--text-muted); min-width: 2.571rem; flex-shrink: 0; }
  .item-desc { flex: 1; }
  .items-empty { text-align: center; color: var(--text-muted); padding: 1rem; }
  .items-modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; flex-shrink: 0; }
  .save-checked-btn { background: var(--accent, #3498db); }
  .save-checked-btn:disabled { opacity: 0.4; cursor: default; }

  /* === Footer === */
  .kanban-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 0.571rem;
    flex-shrink: 0;
  }
  .kanban-footer-count {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--accent);
  }
  .kanban-footer-deselect {
    padding: 0.357rem 0.857rem;
    border: 1px solid var(--border);
    border-radius: 0.357rem;
    background: var(--bg-card);
    color: var(--text-primary);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s;
  }
  .kanban-footer-deselect:hover {
    background: var(--bg-hover);
    border-color: var(--border-focus);
  }
</style>
