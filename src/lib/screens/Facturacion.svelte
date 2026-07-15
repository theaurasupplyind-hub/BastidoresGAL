<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { untrack } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import type { Factura, InvoiceItem, Cliente, Producto, PrecioReferencia, PricingRule } from '$lib/types';
  import { invoke } from '@tauri-apps/api/core';
  import { Image } from '@tauri-apps/api/image';
  import { writeImage } from '@tauri-apps/plugin-clipboard-manager';
  import { open as shellOpen } from '@tauri-apps/plugin-shell';
  import html2canvas from 'html2canvas';
  import { renderReceiptHtml } from '$lib/utils/receipt';
  import MoldurasModal from '$lib/components/MoldurasModal.svelte';
  import PagoDialog from '$lib/components/PagoDialog.svelte';
  import PriceListModal from '$lib/components/PriceListModal.svelte';
  import { suggestPrice, smartProductSearch, normalizeText, getBaseAndDims, refsToProductos, type PriceSuggestion } from '$lib/utils/precios';
import { nominatimSearchUrl, limpiarDireccion } from '$lib/utils/geocoding';
import type { ClientAddress } from '$lib/types';

  let loading = $state(false);
  let saving = $state(false);
  let facturas = $state<Factura[]>([]);
  let currentIndex = $state(-1);
  let clientes = $state<Cliente[]>([]);
  let productos = $state<Producto[]>([]);
  let preciosReferencia = $state<PrecioReferencia[]>([]);
  let pricingRules = $state<PricingRule[]>([]);
  let pagoMap = $state<Record<number, number>>({});
  let formAreaRef = $state<HTMLElement>();

  function getFocusable(): HTMLElement[] {
    if (!formAreaRef) return [];
    return Array.from(
      formAreaRef.querySelectorAll<HTMLElement>(
        'input:not(.date-picker-hidden):not([readonly]), select, button:not(.btn-del)'
      )
    );
  }

  function isAutocompleteVisible(): boolean {
    return !!formAreaRef?.querySelector('.autocomplete-results:has(.autocomplete-item)');
  }

  function handleFormKeydown(e: KeyboardEvent) {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && isAutocompleteVisible()) return;
    const fields = getFocusable();
    const idx = fields.indexOf(document.activeElement as HTMLElement);

    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      if (idx < fields.length - 1) {
        e.preventDefault();
        fields[idx + 1]?.focus();
        if (fields[idx + 1]?.tagName === 'INPUT') {
          (fields[idx + 1] as HTMLInputElement)?.select();
        }
      }
    } else if (e.key === 'ArrowUp') {
      if (idx > 0) {
        e.preventDefault();
        fields[idx - 1]?.focus();
        if (fields[idx - 1]?.tagName === 'INPUT') {
          (fields[idx - 1] as HTMLInputElement)?.select();
        }
      }
    } else if (e.key === 'F1') {
      e.preventDefault();
      save();
    } else if (e.key === 'F2') {
      e.preventDefault();
      newInvoice();
    } else if (e.key === 'd' && e.ctrlKey) {
      e.preventDefault();
      const rowEl = (document.activeElement as HTMLElement | null)?.closest('.items-row') as HTMLElement | null;
      if (!rowEl) return;
      const ri = parseInt(rowEl.dataset.index ?? '');
      if (!isNaN(ri)) duplicateItemRow(ri);
    }
  }

  // Sync reactive state to appStore for top-bar buttons
  $effect(() => {
    appStore.facturacionSaving = saving;
    appStore.facturacionTipo = tipo;
    appStore.facturacionHasId = id !== null;
  });

  // Form fields
  let id = $state<number | null>(null);
  let cliente_id = $state<number | null>(null);
  let tipo = $state<'PRESUPUESTO' | 'BORRADOR'>('PRESUPUESTO');

  $effect(() => {
    if (tipo === 'BORRADOR') {
      const timer = setTimeout(() => {
        appStore.showToast('Borrador expirado', 'info');
        newInvoice();
      }, 600000);
      return () => clearTimeout(timer);
    }
  });
  let numero_factura = $state('');
  let numero_presupuesto = $state('');
  let fecha = $state('');
  let cliente_nombre = $state('');
  let cliente_domicilio = $state('');
  let cliente_piso_depto = $state('');
  let cliente_telefono = $state('');
  let cliente_taller = $state('');
  let clienteAddresses = $state<import('$lib/types').ClientAddress[]>([]);
  let showNewAddressPrompt = $state(false);
  let newAddressLabel = $state('');
  let newAddressDefault = $state(false);
  let pendingSavePayload = $state<any>(null);
  let showAddressDropdown = $state(false);
  let addressSuggestions = $state<Array<{type: 'saved' | 'nominatim', data: any}>>([]);
  let selectedAddressIdx = $state(-1);
  let isSearchingAddress = $state(false);
  let addressDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let selectedNominatimLat = $state<number | null>(null);
  let selectedNominatimLng = $state<number | null>(null);
  let envio = $state(0);
  let tipo_entrega = $state('Retira');
  let fecha_entrega = $state('');
  let pagoRapidoMonto = $state(0);
  let pagoRapidoAplicado = $state(false);
  let showPagoDialog = $state(false);
  let estado_kanban = $state('');

  function handlePagoSaved() {
    if (pagoRapidoMonto > 0) {
      pagoRapidoAplicado = true;
    }
    refreshHistory();
  }

  async function toggleConfirmar() {
    if (!id) return;
    const nuevoEstado = estado_kanban === 'NO_CONFIRMADO' ? 'PEDIDO' : 'NO_CONFIRMADO';
    try {
      await api.patchInvoiceField(id, 'estado_kanban', nuevoEstado);
      estado_kanban = nuevoEstado;
      await refreshHistory();
      appStore.showToast(nuevoEstado === 'PEDIDO' ? 'Presupuesto confirmado' : 'Presupuesto desconfirmado', 'success');
    } catch (e: any) {
      appStore.showToast('Error: ' + (e.message || e), 'error');
    }
  }

  async function openPagoRapido() {
    if (pagoRapidoMonto <= 0 || !id) return;
    try {
      const allPagos = await api.listPagos();
      const invPagos = allPagos.filter((p: any) => p.invoice_id === id);
      const pagado = invPagos.reduce((s: number, p: any) => s + (p.amount || 0), 0);
      const saldo = totalConEnvio - pagado;
      if (saldo <= 0) {
        appStore.alert('Esta factura ya está pagada completamente.');
        return;
      }
    } catch {}
    showPagoDialog = true;
  }
  let items = $state<InvoiceItem[]>([]);

  // Date picker for fecha_entrega
  let datePickerVal = $state('');

  $effect(() => {
    if (fecha_entrega) {
      const parts = fecha_entrega.split('/');
      if (parts.length === 3) {
        datePickerVal = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
    } else {
      datePickerVal = '';
    }
  });

  function onDatePick() {
    if (datePickerVal) {
      const [y, m, d] = datePickerVal.split('-');
      fecha_entrega = `${parseInt(d)}/${parseInt(m)}/${y}`;
    } else {
      fecha_entrega = '';
    }
  }

  function getDiaSemana(fecha: string): string {
    if (!fecha) return '';
    const dias = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
    let d: Date;
    if (fecha.includes('/')) {
      const p = fecha.split('/');
      d = new Date(+p[2], +p[1] - 1, +p[0]);
    } else if (fecha.includes('-')) {
      d = new Date(fecha);
    } else return '';
    return dias[d.getDay()];
  }

  function showDatePicker() {
    const el = document.getElementById('date-picker-input');
    if (el) (el as HTMLInputElement).showPicker();
  }

  // UI state
  let sharingWhatsApp = $state(false);
  let searchHistory = $state('');
  let selectedHistoryIds = $state<Set<number>>(new Set());
  let showMoldurasModal = $state(false);
  let showPriceList = $state(false);
  let showDiscountModal = $state(false);
  let discountMode = $state<'amount' | 'percent'>('amount');
  let discountValue = $state(0);
  let productSuggestions = $state<PriceSuggestion[][]>([[]]);
  let showPriceModal = $state(false);
  let priceAdjustIndex = $state(-1);
  let priceAdjustSuggestion = $state<PriceSuggestion | null>(null);
  let priceAdjustValue = $state(0);
  let priceInputEl = $state<HTMLInputElement | null>(null);
  let clienteSearch = $state('');
  let showClienteResults = $state(false);
  let selectedClienteIndex = $state(-1);

  // Product autocomplete per row
  let productSearch = $state<string[]>(['']);
  let selectedProdIndex = $state<number[]>([-1]);
  let showProdResults = $state<boolean[]>([false]);
  let showQtyDropdown = $state<boolean[]>([false]);

  // Drag to duplicate rows
  let dragStartIndex = $state<number | null>(null);
  let dragHighlightedSet = $state<Set<number>>(new Set());
  let isDragging = $state(false);

  // Combo options
  const tiposEntrega = ['Retira', 'Envio', 'Retiro y Envio'];
  const cantidades = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

  let filteredHistory = $derived.by(() => {
    const q = searchHistory.toLowerCase();
    if (!q) return facturas;
    return facturas.filter(f =>
      (f.cliente_nombre || '').toLowerCase().includes(q) ||
      (f.numero_factura || '').toLowerCase().includes(q) ||
      (f.numero_presupuesto || '').toLowerCase().includes(q)
    );
  });

  let filteredClientes = $derived.by(() => {
    const q = normalizeText(clienteSearch);
    if (!q) return clientes.slice(0, 10);
    return clientes.filter(c =>
      normalizeText(c.nombre).includes(q) ||
      c.telefono?.includes(q) ||
      normalizeText(c.domicilio).includes(q) ||
      normalizeText(c.taller).includes(q) ||
      normalizeText(c.estudiante).includes(q)
    ).slice(0, 10);
  });

  let totalCalculado = $derived.by(() => {
    let sum = 0;
    for (const item of items) {
      sum += item.total || (item.cantidad * (item.precio_unitario ?? 0));
    }
    return sum;
  });

  let totalConEnvio = $derived(totalCalculado + envio);
  let currentSaldo = $derived(id !== null ? totalConEnvio - (pagoMap[id] || 0) : totalConEnvio);

  function loadDiscountFromItems() {
    const d = items.find(i => i.descripcion === 'DESCUENTO');
    if (d) {
      discountValue = Math.abs(d.total);
      discountMode = 'amount';
    } else {
      discountValue = 0;
    }
  }

  function applyDiscount() {
    if (discountValue <= 0) return;
    let netItems = items.filter(i => i.descripcion !== 'DESCUENTO');
    const amount = discountMode === 'amount'
      ? discountValue
      : Math.round(netItems.reduce((s, i) => s + (i.total || i.cantidad * (i.precio_unitario ?? 0)), 0) * discountValue / 100);
    netItems.push({ cantidad: 1, descripcion: 'DESCUENTO', precio_unitario: -amount, total: -amount });
    items = netItems;
    productSearch = [...productSearch, 'DESCUENTO'];
    selectedProdIndex = [...selectedProdIndex, -1];
    showProdResults = [...showProdResults, false];
    productSuggestions = [...productSuggestions, []];
    showDiscountModal = false;
  }

  function removeDiscount() {
    const idx = items.findIndex(i => i.descripcion === 'DESCUENTO');
    if (idx >= 0) {
      items = items.filter((_, i) => i !== idx);
      productSearch = productSearch.filter((_, i) => i !== idx);
      selectedProdIndex = selectedProdIndex.filter((_, i) => i !== idx);
      showProdResults = showProdResults.filter((_, i) => i !== idx);
      productSuggestions = productSuggestions.filter((_, i) => i !== idx);
    }
    discountValue = 0;
    showDiscountModal = false;
  }

  let _initialized = $state(false);

  onMount(async () => {
    await Promise.all([loadClientes(), loadProductos(), loadPreciosReferencia(), loadPricingRules(), refreshHistory()]);
    if (appStore.pendingInvoiceId != null) {
      await loadInvoice(appStore.pendingInvoiceId);
      appStore.pendingInvoiceId = null;
    } else {
      await newInvoice();
    }
    _initialized = true;
    document.addEventListener('mousemove', dragMove);
    document.addEventListener('mouseup', dragEnd);
    document.addEventListener('visibilitychange', onVisibilityChange);
  });

  onDestroy(() => {
    document.removeEventListener('mousemove', dragMove);
    document.removeEventListener('mouseup', dragEnd);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });

  $effect(() => {
    if (!_initialized) return;
    if (appStore.currentTab !== 'facturacion') return;
    const pid = untrack(() => appStore.pendingInvoiceId);
    if (pid != null) {
      untrack(() => { appStore.pendingInvoiceId = null; });
      loadInvoice(pid);
    }
  });

  async function loadClientes() {
    try {
      clientes = await cacheStore.fetch('clientes', () => api.listClientes(), 1800000);
    } catch {
      clientes = [];
    }
  }

  async function loadProductos() {
    try {
      productos = await cacheStore.fetch('productos', () => api.listProductos(), 1800000);
    } catch {
      productos = [];
    }
  }

  async function loadPreciosReferencia() {
    try {
      preciosReferencia = await cacheStore.fetch('preciosReferencia', () => api.getPreciosReferencia(), 1800000);
    } catch {
      preciosReferencia = [];
    }
  }

  async function loadPricingRules() {
    try {
      const raw = await api.getPricingRules();
      if (raw && raw.length > 0) {
        pricingRules = raw.map((r: any) => ({
          id: r.id,
          name: r.name || '',
          matchTokens: typeof (r.matchTokens ?? r.match_tokens) === 'string'
            ? JSON.parse((r.matchTokens ?? r.match_tokens) || '[]')
            : (Array.isArray(r.matchTokens ?? r.match_tokens) ? (r.matchTokens ?? r.match_tokens) : []),
          baseCategoria: r.baseCategoria ?? r.base_categoria ?? '',
          baseVariante: r.baseVariante ?? r.base_variante ?? '',
          operation: r.operation ?? 'direct',
          operationValue: r.operationValue ?? r.operation_value ?? 0,
          conditions: typeof (r.conditions) === 'string'
            ? JSON.parse(r.conditions || '[]')
            : (Array.isArray(r.conditions) ? r.conditions : []),
          enabled: r.enabled ?? true,
          rounding: r.rounding ?? 1000,
        }));
      } else {
        pricingRules = [];
      }
    } catch {
      pricingRules = [];
    }
  }

  function invalidateCache() {
    cacheStore.invalidate('facturas');
    cacheStore.invalidate('clientes');
    cacheStore.invalidate('productos');
    cacheStore.invalidate('preciosReferencia');
  }

  function selectCliente(c: Cliente) {
    cliente_id = c.id;
    cliente_nombre = c.nombre;
    cliente_domicilio = c.domicilio;
    cliente_piso_depto = '';
    cliente_telefono = c.telefono;
    cliente_taller = c.taller || '';
    clienteSearch = c.nombre;
    selectedClienteIndex = -1;
    showClienteResults = false;
    api.listAddresses(c.id).then(addrs => {
      clienteAddresses = addrs;
      const def = addrs.find(a => a.is_default) || addrs[0];
      if (def) {
        cliente_domicilio = def.address;
        cliente_piso_depto = def.extra || '';
      }
    });
  }

  function selectProducto(index: number, prod: Producto) {
    items[index].descripcion = prod.descripcion;
    items[index].precio_unitario = prod.precio_unitario;
    items[index].total = items[index].cantidad * prod.precio_unitario;
    items = items;
    productSearch[index] = prod.descripcion;
    productSearch = productSearch;
    showProdResults[index] = false;
    selectedProdIndex[index] = -1;
  }

  function selectSuggestion(index: number, sug: PriceSuggestion) {
    (document.activeElement as HTMLElement)?.blur();
    const userQuery = productSearch[index];
    let newDesc = sug.description;
    const sugBase = sug.basedOn;
    if (sugBase) {
      const cleanBase = sugBase.includes(' → ') ? sugBase.split(' → ').pop()!.trim() : sugBase;
      const userDims = userQuery.match(/\d+\s*[xX×]\s*\d+/);
      newDesc = userDims ? cleanBase.replace(/\d+\s*[xX×]\s*\d+/i, userDims[0]) : cleanBase;
    }
    items[index].descripcion = newDesc;
    items[index].precio_unitario = sug.price;
    items[index].total = items[index].cantidad * sug.price;
    items = items;
    productSearch[index] = newDesc;
    productSearch = productSearch;
    showProdResults[index] = false;
    selectedProdIndex[index] = -1;
    priceAdjustIndex = index;
    priceAdjustSuggestion = sug;
    priceAdjustValue = sug.price;
    showPriceModal = true;
  }

  function applyPriceAdjust() {
    const idx = priceAdjustIndex;
    if (idx >= 0 && priceAdjustValue > 0) {
      items[idx].precio_unitario = priceAdjustValue;
      items[idx].total = items[idx].cantidad * priceAdjustValue;
      items = items;
    }
    showPriceModal = false;
    priceAdjustIndex = -1;
    priceAdjustSuggestion = null;
    setTimeout(() => focusRowInput(idx), 50);
  }

  function adjustByPercent(pct: number) {
    if (!priceAdjustSuggestion) return;
    priceAdjustValue = Math.round(priceAdjustSuggestion.price * (1 + pct / 100));
  }

  function cancelPriceAdjust() {
    const idx = priceAdjustIndex;
    if (idx >= 0 && priceAdjustSuggestion) {
      items[idx].precio_unitario = priceAdjustSuggestion.price;
      items[idx].total = items[idx].cantidad * priceAdjustSuggestion.price;
      items = items;
    }
    showPriceModal = false;
    priceAdjustIndex = -1;
    priceAdjustSuggestion = null;
    setTimeout(() => focusRowInput(idx), 50);
  }

  function focusRowInput(idx: number) {
    const row = document.querySelector(`.items-row[data-index="${idx}"]`);
    if (row) {
      const input = row.querySelector('.autocomplete-wrap.col-desc input');
      if (input) (input as HTMLInputElement).focus();
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') refreshHistory();
  }

  $effect(() => {
    if (showPriceModal && priceInputEl) {
      priceInputEl.focus();
      priceInputEl.select();
    }
  });

  function getAllResults(index: number): Array<{ type: 'suggestion' | 'product'; data: any }> {
    const suggs = (productSuggestions[index] || [])
      .filter((s: PriceSuggestion) => !s.hint)
      .map((s: PriceSuggestion) => ({ type: 'suggestion' as const, data: s }));
    const prods = smartProductSearch(productSearch[index], productos).map((p: Producto) => ({ type: 'product' as const, data: p }));
    return [...suggs, ...prods];
  }

  function scrollToSelected(index: number) {
    setTimeout(() => {
      const container = formAreaRef?.querySelector('.autocomplete-results') as HTMLElement;
      const row = formAreaRef?.querySelector(`[data-prod-row="${index}"].selected`) as HTMLElement;
      if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 10);
  }

  function handleProdKeydown(e: KeyboardEvent, index: number) {
    const results = getAllResults(index);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedProdIndex[index] = Math.min(selectedProdIndex[index] + 1, results.length - 1);
      selectedProdIndex = selectedProdIndex;
      scrollToSelected(index);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedProdIndex[index] = Math.max(selectedProdIndex[index] - 1, -1);
      selectedProdIndex = selectedProdIndex;
      scrollToSelected(index);
    } else if (e.key === 'Enter' && selectedProdIndex[index] >= 0 && results[selectedProdIndex[index]]) {
      e.preventDefault();
      e.stopPropagation();
      const item = results[selectedProdIndex[index]];
      if (item.type === 'suggestion') {
        selectSuggestion(index, item.data);
      } else {
        selectProducto(index, item.data);
      }
    } else if (e.key === 'Escape') {
      showProdResults[index] = false;
      showProdResults = showProdResults;
    }
  }

  function handleClienteKeydown(e: KeyboardEvent) {
    const results = filteredClientes;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedClienteIndex = Math.min(selectedClienteIndex + 1, results.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedClienteIndex = Math.max(selectedClienteIndex - 1, -1);
    } else if (e.key === 'Enter' && selectedClienteIndex >= 0 && results[selectedClienteIndex]) {
      e.preventDefault();
      selectCliente(results[selectedClienteIndex]);
    } else if (e.key === 'Escape') {
      showClienteResults = false;
    }
  }

  function addItem() {
    items = [...items, { cantidad: 1, descripcion: '', precio_unitario: 0, total: 0 }];
    productSearch = [...productSearch, ''];
    selectedProdIndex = [...selectedProdIndex, -1];
    showProdResults = [...showProdResults, false];
    productSuggestions = [...productSuggestions, []];
    showQtyDropdown = [...showQtyDropdown, false];
  }

  function removeItem(index: number) {
    if (items.length <= 1) return;
    items = items.filter((_, i) => i !== index);
    productSearch = productSearch.filter((_, i) => i !== index);
    selectedProdIndex = selectedProdIndex.filter((_, i) => i !== index);
    showProdResults = showProdResults.filter((_, i) => i !== index);
    productSuggestions = productSuggestions.filter((_, i) => i !== index);
    showQtyDropdown = showQtyDropdown.filter((_, i) => i !== index);
  }

  function updateItemTotal(index: number) {
    const item = items[index];
    item.total = item.cantidad * (item.precio_unitario ?? 0);
    items = items; // trigger reactivity
  }

  function duplicateItemRow(index: number) {
    const src = items[index];
    const emptyIdx = items.findIndex((it, i) => i > index && !it.descripcion.trim());
    let targetIdx: number;
    if (emptyIdx >= 0) {
      targetIdx = emptyIdx;
    } else {
      addItem();
      targetIdx = items.length - 1;
    }
    items[targetIdx] = { ...src, total: src.cantidad * (src.precio_unitario ?? 0) };
    productSearch[targetIdx] = productSearch[index];
    items = items;
    productSearch = productSearch;
    updateItemTotal(targetIdx);
  }

  function dragStart(index: number, e: MouseEvent) {
    e.preventDefault();
    dragStartIndex = index;
    isDragging = true;
    dragHighlightedSet = new Set();
  }

  function dragMove(e: MouseEvent) {
    if (dragStartIndex === null) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    let idx = -1;
    if (el) {
      const row = (el as HTMLElement).closest('.items-row') as HTMLElement | null;
      if (row) {
        idx = parseInt(row.dataset.index ?? '');
      }
    }
    if (isNaN(idx) || idx < 0) {
      const body = document.querySelector('.items-body') as HTMLElement;
      if (!body) return;
      const bodyRect = body.getBoundingClientRect();
      const my = e.clientY - bodyRect.top + body.scrollTop;
      const rh = body.scrollHeight > 0 && items.length > 0 ? body.scrollHeight / items.length : 30;
      idx = Math.floor(my / rh);
    }
    if (idx <= dragStartIndex) {
      dragHighlightedSet = new Set();
      return;
    }
    const maxIdx = Math.min(idx, dragStartIndex + 5);
    const targets = new Set<number>();
    for (let j = dragStartIndex + 1; j <= maxIdx; j++) targets.add(j);
    dragHighlightedSet = targets;
  }

  function dragEnd(_e: MouseEvent) {
    if (dragStartIndex === null) return;
    const src = items[dragStartIndex];
    const targets = [...dragHighlightedSet].sort((a, b) => a - b);
    for (const idx of targets) {
      while (idx >= items.length) addItem();
      items[idx].cantidad = src.cantidad;
      items[idx].descripcion = src.descripcion;
      items[idx].precio_unitario = src.precio_unitario ?? 0;
      productSearch[idx] = productSearch[dragStartIndex];
      updateItemTotal(idx);
    }
    items = items;
    appStore.showToast('Filas duplicadas', 'success');
    dragStartIndex = null;
    dragHighlightedSet = new Set();
    isDragging = false;
  }

  export async function loadInvoice(id: number) {
    loading = true;
    try {
      const { factura } = await api.getFactura(id);
      populateForm(factura);
      currentIndex = facturas.findIndex(f => f.id === id);
    } catch (e: any) {
      appStore.showToast('Error al cargar factura: ' + e.message, 'error');
    } finally {
      loading = false;
    }
  }

  function populateForm(f: Factura) {
    id = f.id;
    cliente_id = f.cliente_id;
    tipo = 'PRESUPUESTO';
    numero_factura = f.numero_factura;
    numero_presupuesto = f.numero_presupuesto;
    fecha = f.fecha;
    cliente_nombre = f.cliente_nombre;
    cliente_domicilio = f.cliente_domicilio;
    cliente_telefono = f.cliente_telefono;
    envio = f.envio || 0;
    tipo_entrega = f.tipo_entrega || 'Retira';
    fecha_entrega = f.fecha_entrega || '';
    items = f.items?.length ? f.items.map(i => ({ ...i })) : [{ cantidad: 1, descripcion: '', precio_unitario: 0, total: 0 }];
    productSearch = f.items?.length ? f.items.map(i => i.descripcion) : [''];
    selectedProdIndex = items.map(() => -1);
    showProdResults = items.map(() => false);
    productSuggestions = items.map(() => []);
    showQtyDropdown = items.map(() => false);
    pagoRapidoMonto = 0;
    pagoRapidoAplicado = false;
    estado_kanban = f.estado_kanban || '';
    clienteSearch = f.cliente_nombre;
    loadDiscountFromItems();
    if (f.cliente_id) {
      api.listAddresses(f.cliente_id).then(addrs => { clienteAddresses = addrs; });
    }
  }

  function resetForm() {
    id = null;
    cliente_id = null;
    tipo = 'PRESUPUESTO';
    numero_factura = '';
    numero_presupuesto = '';
    fecha = new Date().toLocaleDateString('es-AR');
    cliente_nombre = '';
    cliente_domicilio = '';
    cliente_piso_depto = '';
    cliente_telefono = '';
    cliente_taller = '';
    clienteAddresses = [];
    envio = 0;
    tipo_entrega = 'Retira';
    fecha_entrega = '';
    items = Array.from({ length: 7 }, () => ({ cantidad: 1, descripcion: '', precio_unitario: 0, total: 0 }));
    productSearch = Array.from({ length: 7 }, () => '');
    selectedProdIndex = Array.from({ length: 7 }, () => -1);
    showProdResults = Array.from({ length: 7 }, () => false);
    productSuggestions = Array.from({ length: 7 }, () => []);
    showQtyDropdown = Array.from({ length: 7 }, () => false);
    pagoRapidoMonto = 0;
    pagoRapidoAplicado = false;
    estado_kanban = '';
    clienteSearch = '';
    selectedClienteIndex = -1;
    showAddressDropdown = false;
    addressSuggestions = [];
    selectedAddressIdx = -1;
    isSearchingAddress = false;
    selectedNominatimLat = null;
    selectedNominatimLng = null;
    if (addressDebounceTimer) clearTimeout(addressDebounceTimer);
  }

  export function setTipo(v: 'PRESUPUESTO' | 'BORRADOR') {
    tipo = v;
  }

  export async function newInvoice() {
    resetForm();
    currentIndex = -1;
    try {
      const nextNum = await api.nextInvoiceNumber('F');
      numero_factura = nextNum;
      numero_presupuesto = nextNum.replace('F', 'P');
    } catch {
      numero_factura = 'F-00001';
      numero_presupuesto = 'P-00001';
    }
  }

  export async function duplicateInvoice() {
    if (id === null) {
      appStore.showToast('Seleccione una factura primero', 'info');
      return;
    }
    try {
      const nextNum = await api.nextInvoiceNumber('F');
      id = null;
      numero_factura = nextNum;
      numero_presupuesto = nextNum.replace('F', 'P');
      fecha = new Date().toLocaleDateString('es-AR');
      currentIndex = -1;
      appStore.showToast('Copia creada. Guarde para confirmar.', 'info');
    } catch {
      appStore.showToast('Error al generar número', 'error');
    }
  }

  export async function save() {
    if (!cliente_nombre.trim()) {
      appStore.showToast('Ingrese un cliente', 'error');
      return;
    }
    const validItems = items.filter(i => i.descripcion.trim());
    if (!validItems.length) {
      appStore.showToast('Ingrese al menos un item', 'error');
      return;
    }

    if (tipo === 'BORRADOR') {
      appStore.showToast('Borrador guardado', 'success');
      return;
    }

    saving = true;
    try {
      if (!cliente_id) {
        const found = clientes.find(c => c.nombre.trim().toLowerCase() === cliente_nombre.trim().toLowerCase());
        if (found) {
          cliente_id = found.id;
        } else {
          const result = await api.addCliente({
            nombre: cliente_nombre,
            domicilio: cliente_domicilio,
            telefono: cliente_telefono,
            taller: cliente_taller,
          });
          cliente_id = result.id;
          clientes = [...clientes, { id: result.id, nombre: cliente_nombre, domicilio: cliente_domicilio, telefono: cliente_telefono, taller: cliente_taller || '', estudiante: '' }];
        }
      }

      // Ensure addresses are loaded for the new-address prompt
      if (cliente_id && (!clienteAddresses.length || clienteAddresses[0]?.client_id !== cliente_id)) {
        try { clienteAddresses = await api.listAddresses(cliente_id); } catch { clienteAddresses = []; }
      }

      // ── Auto-crear productos nuevos (lógica completa) ──
      const existingDescs = new Set(productos.map(p => p.descripcion.trim().toLowerCase()));
      const allCats = [...new Set(productos
        .filter(p => p.categoria)
        .map(p => p.categoria)
      )].sort((a, b) => b.length - a.length);
      let lastVariant = '';

      for (const item of validItems) {
        const key = item.descripcion.trim().toLowerCase();
        if (existingDescs.has(key)) continue;

        let catDetected = 'Varios';
        for (const c of allCats) {
          if (key.startsWith(c.toLowerCase())) {
            catDetected = c;
            break;
          }
        }

        let medida = '';
        const dimMatch = item.descripcion.match(/(\d+\s*[xX]\s*\d+)/);
        if (dimMatch) {
          medida = dimMatch[1].replace(/\s/g, '');
        }

        let variante = item.descripcion;
        if (medida) variante = variante.replace(dimMatch![1], '');
        if (catDetected !== 'Varios') {
          variante = variante.replace(new RegExp(`^${escapeRegex(catDetected)}`, 'i'), '');
        }
        variante = variante.replace(/^[\s\-.]+|[\s\-.]+$/g, '');

        if (!variante || variante === '"') {
          variante = lastVariant;
        } else {
          lastVariant = variante;
        }

        const pid = `MAN_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}`;
        await api.addProducto({
          id: pid,
          descripcion: item.descripcion.trim(),
          precio_unitario: item.precio_unitario ?? 0,
          categoria: catDetected,
          medida,
          variante,
          stock: 0,
        });

        productos = [...productos, {
          id: pid,
          descripcion: item.descripcion.trim(),
          precio_unitario: item.precio_unitario ?? 0,
          categoria: catDetected,
          medida,
          variante,
          stock: 0,
        }];
        existingDescs.add(key);
      }

      const payload = {
        numero_factura,
        numero_presupuesto,
        fecha,
        cliente_id,
        cliente_nombre,
        cliente_domicilio,
        cliente_piso_depto,
        cliente_telefono,
        items: validItems.map(i => ({
          cantidad: i.cantidad,
          descripcion: i.descripcion,
          precio_unitario: i.precio_unitario ?? 0,
          total: i.total || (i.cantidad * (i.precio_unitario ?? 0)),
        })),
        total: totalConEnvio,
        envio,
        tipo,
        user_id: appStore.user?.user_id || 0,
        tipo_entrega,
        fecha_entrega,
        ...(!id ? { estado_kanban: 'NO_CONFIRMADO' } : {}),
      };

      if (id) {
        await api.updateFactura(id, payload);
        appStore.showToast('Factura actualizada', 'success');
      } else {
        const result = await api.saveFactura(payload);
        id = result.id;
        appStore.showToast('Factura guardada', 'success');
      }
      invalidateCache();
      await refreshHistory();
      // Prompt to save new address if client has addresses and domicilio doesn't match any
      if (cliente_id && clienteAddresses.length > 0 && cliente_domicilio.trim()) {
        const match = clienteAddresses.find(a => a.address === cliente_domicilio.trim());
        if (!match) {
          pendingSavePayload = null;
          newAddressLabel = '';
          newAddressDefault = false;
          showNewAddressPrompt = true;
        }
      }
    } catch (e: any) {
      appStore.showToast('Error al guardar: ' + e.message, 'error');
    } finally {
      saving = false;
    }
  }

  export async function confirmBorrador() {
    tipo = 'PRESUPUESTO';
    await save();
  }

  async function saveNewAddress() {
    if (!cliente_id) {
      appStore.showToast('Guardá la factura primero para asociar la dirección al cliente', 'info');
      return;
    }
    if (!cliente_domicilio.trim()) return;
    try {
      const newAddr = await api.addAddress(cliente_id, {
        address: cliente_domicilio.trim(),
        extra: cliente_piso_depto,
        label: newAddressLabel,
        is_default: newAddressDefault,
        lat: selectedNominatimLat,
        lng: selectedNominatimLng,
      });
      appStore.showToast('Dirección guardada', 'success');
      showNewAddressPrompt = false;
      selectedNominatimLat = null;
      selectedNominatimLng = null;
      clienteAddresses = [...clienteAddresses, newAddr];
    } catch (e: any) {
      appStore.showToast('Error al guardar dirección: ' + e.message, 'error');
    }
  }

  function toggleAddressDropdown() {
    if (showAddressDropdown) {
      showAddressDropdown = false;
      return;
    }
    const items: Array<{type: 'saved' | 'nominatim', data: any}> = [];
    for (const a of clienteAddresses) {
      items.push({ type: 'saved', data: a });
    }
    addressSuggestions = items;
    selectedAddressIdx = -1;
    showAddressDropdown = true;
  }

  function handleAddressFocus() {
    if (clienteAddresses.length > 0 && !cliente_domicilio.trim()) {
      const items: Array<{type: 'saved' | 'nominatim', data: any}> = [];
      for (const a of clienteAddresses) {
        items.push({ type: 'saved', data: a });
      }
      addressSuggestions = items;
      selectedAddressIdx = -1;
      showAddressDropdown = true;
    }
  }

  function handleAddressInput() {
    if (addressDebounceTimer) clearTimeout(addressDebounceTimer);
    const text = cliente_domicilio.trim();
    if (text.length >= 4) {
      isSearchingAddress = true;
      const items: Array<{type: 'saved' | 'nominatim', data: any}> = [];
      for (const a of clienteAddresses) {
        items.push({ type: 'saved', data: a });
      }
      addressSuggestions = items;
      showAddressDropdown = items.length > 0;
      addressDebounceTimer = setTimeout(() => searchNominatim(text), 400);
    } else if (text.length > 0) {
      addressSuggestions = [];
      showAddressDropdown = false;
      isSearchingAddress = false;
    }
  }

  async function searchNominatim(query: string) {
    try {
      const url = nominatimSearchUrl(query);
      const res = await fetch(url, { headers: { 'User-Agent': 'BastidoresGal/1.0' } });
      const data = await res.json();
      const items: Array<{type: 'saved' | 'nominatim', data: any}> = [];
      for (const a of clienteAddresses) {
        items.push({ type: 'saved', data: a });
      }
      for (const r of data.slice(0, 5)) {
        items.push({ type: 'nominatim', data: r });
      }
      addressSuggestions = items;
      showAddressDropdown = items.length > 0;
    } catch {
      const items: Array<{type: 'saved' | 'nominatim', data: any}> = [];
      for (const a of clienteAddresses) {
        items.push({ type: 'saved', data: a });
      }
      addressSuggestions = items;
      showAddressDropdown = items.length > 0;
    } finally {
      isSearchingAddress = false;
    }
  }

  function selectAddress(sug: {type: 'saved' | 'nominatim', data: any}) {
    if (sug.type === 'saved') {
      const addr = sug.data as ClientAddress;
      cliente_domicilio = addr.address;
      cliente_piso_depto = addr.extra || '';
      selectedNominatimLat = addr.lat ?? null;
      selectedNominatimLng = addr.lng ?? null;
    } else {
      const r = sug.data;
      cliente_domicilio = limpiarDireccion(r.display_name);
      cliente_piso_depto = '';
      selectedNominatimLat = parseFloat(r.lat);
      selectedNominatimLng = parseFloat(r.lon);
    }
    showAddressDropdown = false;
    selectedAddressIdx = -1;
  }

  function openAddAddressModal() {
    if (!cliente_id) {
      appStore.showToast('Seleccioná o guardá el cliente primero', 'info');
      return;
    }
    showAddressDropdown = false;
    newAddressLabel = '';
    newAddressDefault = false;
    selectedNominatimLat = null;
    selectedNominatimLng = null;
    showNewAddressPrompt = true;
  }

  function resetAddressLatLng() {
    selectedNominatimLat = null;
    selectedNominatimLng = null;
  }

  function handleAddressKeydown(e: KeyboardEvent) {
    const items = addressSuggestions;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedAddressIdx = Math.min(selectedAddressIdx + 1, items.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedAddressIdx = Math.max(selectedAddressIdx - 1, -1);
    } else if (e.key === 'Enter' && selectedAddressIdx >= 0 && items[selectedAddressIdx]) {
      e.preventDefault();
      selectAddress(items[selectedAddressIdx]);
    } else if (e.key === 'Escape') {
      showAddressDropdown = false;
    }
  }

  export async function deleteInvoice() {
    if (id === null) return;
    if (!confirm('¿Eliminar esta factura?')) return;
    try {
      await api.deleteFactura(id);
      appStore.showToast('Factura enviada a la papelera', 'success');
      invalidateCache();
      await refreshHistory();
      await newInvoice();
    } catch (e: any) {
      appStore.showToast('Error al eliminar: ' + e.message, 'error');
    }
  }

  async function deleteCurrentInvoice() {
    if (id === null) { appStore.showToast('No hay factura cargada', 'info'); return; }
    if (!confirm('¿Eliminar esta factura?')) return;
    try {
      await api.deleteFactura(id);
      appStore.showToast('Factura enviada a la papelera', 'success');
      invalidateCache();
      await refreshHistory();
      await newInvoice();
    } catch (e: any) {
      appStore.showToast('Error al eliminar: ' + e.message, 'error');
    }
  }

  async function refreshHistory() {
    try {
      facturas = await api.listFacturas({ limit: 2000 });
    } catch {
      facturas = [];
    }
    try {
      const pagos = await api.listPagos();
      const map: Record<number, number> = {};
      for (const p of pagos) {
        map[p.invoice_id] = (map[p.invoice_id] || 0) + p.amount;
      }
      pagoMap = map;
    } catch {
      pagoMap = {};
    }
  }

  function prevInvoice() {
    if (currentIndex < 0) return;
    const idx = currentIndex - 1;
    if (idx >= 0 && facturas[idx]) {
      loadInvoice(facturas[idx].id);
    }
  }

  function nextInvoice() {
    if (currentIndex < 0) return;
    const idx = currentIndex + 1;
    if (idx < facturas.length && facturas[idx]) {
      loadInvoice(facturas[idx].id);
    }
  }

  export async function generatePDF(shouldPrint = false) {
    if (tipo === 'PRESUPUESTO' && (id === null || !numero_factura)) {
      appStore.showToast('Guarde la factura primero', 'error');
      return;
    }
    try {
      const pdfPath = await invoke('generate_pdf', {
        numPresupuesto: numero_presupuesto,
        numFactura: numero_factura,
        fecha,
        clienteNombre: cliente_nombre,
        clienteDomicilio: cliente_domicilio,
        clienteTelefono: cliente_telefono,
        items: items.filter(i => i.descripcion.trim()).map(i => ({
          cantidad: i.cantidad,
          descripcion: i.descripcion,
          precio_unitario: i.precio_unitario ?? 0,
          total: i.total || (i.cantidad * (i.precio_unitario ?? 0)),
        })),
        total: totalConEnvio,
        envio,
        saldo: currentSaldo,
        isPresupuesto: true,
        styleName: appStore.pdfStyle,
      });
      if (shouldPrint) {
        try {
          await invoke('print_pdf', { path: pdfPath });
          appStore.showToast('Enviando a imprimir...', 'success');
        } catch (e: any) {
          const errMsg = e?.message ?? (typeof e === 'string' ? e : 'Error desconocido');
          console.error('Error al imprimir PDF:', e);
          if (errMsg.startsWith('NO_PRINTER:')) {
            appStore.alert(errMsg.replace('NO_PRINTER:', ''));
          } else if (errMsg.startsWith('NO_SE_PUDO_IMPRIMIR:')) {
            appStore.alert(errMsg.replace('NO_SE_PUDO_IMPRIMIR:', ''));
          } else {
            appStore.alert('Error al imprimir: ' + errMsg);
          }
        }
      } else {
        try {
          await invoke('open_pdf', { path: pdfPath });
          appStore.showToast('PDF generado', 'success');
        } catch (e: any) {
          const errMsg = e?.message ?? (typeof e === 'string' ? e : 'Error desconocido');
          console.error('Error al abrir PDF:', e);
          appStore.showToast('Error al abrir PDF: ' + errMsg, 'error');
        }
      }
    } catch (e: any) {
      const errMsg = e?.message ?? (typeof e === 'string' ? e : 'Error desconocido');
      console.error('Error al generar PDF:', e);
      appStore.showToast('Error al generar PDF: ' + errMsg, 'error');
    }
  }

  export async function sendToRemotePrint() {
    if (tipo === 'PRESUPUESTO' && (id === null || !numero_factura)) {
      appStore.showToast('Guarde la factura primero', 'error');
      return;
    }
    try {
      const pdfPath = await invoke('generate_pdf', {
        numPresupuesto: numero_presupuesto,
        numFactura: numero_factura,
        fecha,
        clienteNombre: cliente_nombre,
        clienteDomicilio: cliente_domicilio,
        clienteTelefono: cliente_telefono,
        items: items.filter(i => i.descripcion.trim()).map(i => ({
          cantidad: i.cantidad,
          descripcion: i.descripcion,
          precio_unitario: i.precio_unitario ?? 0,
          total: i.total || (i.cantidad * (i.precio_unitario ?? 0)),
        })),
        total: totalConEnvio,
        envio,
        saldo: currentSaldo,
        isPresupuesto: true,
        styleName: appStore.pdfStyle,
      });
      const u = appStore.user;
      const targetKey = (appStore.selectedStation || appStore.activeStations[0])?.api_key ?? null;
      const result = await invoke('submit_print_job', {
        pdfPath,
        createdBy: u?.user_name || 'Desconocido',
        apiKey: targetKey,
      });
      appStore.showToast('Enviado a impresión remota');
    } catch (e: any) {
      const errMsg = e?.message ?? (typeof e === 'string' ? e : 'Error desconocido');
      console.error('Error al enviar a impresión remota:', e);
      appStore.showToast('Error: ' + errMsg, 'error');
    }
  }

  export function openPriceList() {
    showPriceList = true;
  }

  export async function shareWhatsApp() {
    if (tipo === 'PRESUPUESTO' && (id === null || !numero_factura)) {
      appStore.showToast('Guarde la factura primero', 'error');
      return;
    }
    sharingWhatsApp = true;
    try {
      const contacto = [cliente_telefono, cliente_domicilio].filter(Boolean).join(' ');
      const validItems = items.filter(i => i.descripcion.trim());
      const html = renderReceiptHtml({
        num: numero_presupuesto || numero_factura,
        fecha,
        cliente: cliente_nombre,
        contacto,
        items: validItems.map(i => ({
          cantidad: i.cantidad,
          descripcion: i.descripcion,
          precio_unitario: i.precio_unitario ?? 0,
          total: i.total || i.cantidad * (i.precio_unitario ?? 0),
        })),
        total: totalConEnvio,
        envio,
        mode: tipo,
        ...(tipo === 'PRESUPUESTO' ? { saldo: currentSaldo } : {}),
      });

      const iframe = document.getElementById('receipt-iframe') as HTMLIFrameElement;
      if (!iframe) throw new Error('No se encontro el iframe');
      const doc = iframe.contentDocument || iframe.contentWindow!.document;
      doc.open();
      doc.write(html);
      doc.close();
      await new Promise<void>(resolve => {
        if (doc.readyState === 'complete') return resolve();
        doc.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
      });

      const el = doc.body;
      const canvas = await html2canvas(el, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#f5f5f5',
        width: 400,
        height: el.scrollHeight,
        logging: false,
      });

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No se pudo obtener el contexto del canvas');
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const img = await Image.new(
        new Uint8Array(imageData.data.buffer),
        canvas.width,
        canvas.height,
      );
      await writeImage(img);

      // Open WhatsApp via Rust (Desktop if installed, otherwise tell JS to open Web)
      const telefono = (cliente_telefono || '').replace(/\D/g, '');
      const result = await invoke<string>('open_whatsapp', { phone: telefono || 'none' });
      if (result === 'web') {
        const phoneParam = telefono ? `?phone=${telefono}` : '';
        await shellOpen(`https://web.whatsapp.com/send${phoneParam}`);
      }

      await invoke('show_whatsapp_helper');

      appStore.showToast('Imagen copiada al portapapeles', 'success');
    } catch (e: any) {
      appStore.showToast('Error al compartir: ' + getErrorMessage(e), 'error');
    } finally {
      sharingWhatsApp = false;
    }
  }

  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error.trim()) return error;
    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== '{}') return serialized;
    } catch { }
    return 'error desconocido';
  }
</script>

<div class="facturacion">
  <div class="main-layout">
    <div class="content-row">
    <!-- Form -->
    <div class="form-area" bind:this={formAreaRef} onkeydown={handleFormKeydown}>
        <div class="paper-card" style="position:relative;">
        {#if loading}
          <div class="loading-overlay">
            <span class="loading-text">Cargando...</span>
          </div>
        {/if}
        <!-- Header -->
        <div class="paper-section">
          <div class="header-row">
            <span class="brand-text">BASTIDORES GAL</span>
            {#if id !== null && estado_kanban}
              <span class="confirm-badge" class:no-confirmado={estado_kanban === 'NO_CONFIRMADO'} class:confirmado={estado_kanban !== 'NO_CONFIRMADO'}>
                {estado_kanban === 'NO_CONFIRMADO' ? '⏳ No Confirmado' : '✓ Confirmado'}
              </span>
              <button class="top-btn top-btn-confirm" onclick={toggleConfirmar} type="button">
                {estado_kanban === 'NO_CONFIRMADO' ? '✓ Confirmar' : '⏳ Desconfirmar'}
              </button>
            {/if}
            <span class="shortcuts-hint">F1 Guardar · F2 Nueva</span>
            <div class="header-fields">
              <div class="field field-num">
                <label>N° Factura</label>
                <input type="text" value={numero_factura} readonly class="input-readonly" />
              </div>
              <div class="field field-fecha">
                <label>Fecha</label>
                <input type="text" bind:value={fecha} placeholder="DD/MM/AAAA" />
              </div>
            </div>
          </div>
        </div>

        <!-- Client -->
        <div class="paper-section">
          <div class="row">
            <div class="field flex-4">
              <div class="autocomplete-wrap">
                <input
                  type="text"
                  bind:value={clienteSearch}
                  oninput={() => { showClienteResults = true; cliente_nombre = clienteSearch; }}
                  onfocus={() => showClienteResults = true}
                  onblur={() => setTimeout(() => showClienteResults = false, 200)}
                  onkeydown={handleClienteKeydown}
                  placeholder="Buscar cliente..."
                  class="input-with-icon-left"
                />
                <svg class="input-icon-left" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                {#if showClienteResults && filteredClientes.length > 0}
                  <div class="autocomplete-results">
                    {#each filteredClientes as c, i}
                      <div
                        class="autocomplete-item"
                        class:selected={i === selectedClienteIndex}
                        onmousedown={() => selectCliente(c)}
                      >
                        {c.nombre}
                      </div>
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
            <div class="field flex-2">
              <div class="icon-input-wrap">
                <input
                  type="text"
                  bind:value={cliente_telefono}
                  placeholder="Teléfono"
                  class="input-with-icon-left"
                />
                <svg class="input-icon-left" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z"/></svg>
              </div>
            </div>
          </div>
          <div class="row">
            <div class="field flex-2">
              <div class="autocomplete-wrap">
                <input type="text" bind:value={cliente_domicilio} placeholder="Domicilio" class="input-with-icon-left input-with-address-btns"
                  oninput={handleAddressInput}
                  onfocus={handleAddressFocus}
                  onblur={() => setTimeout(() => showAddressDropdown = false, 200)}
                  onkeydown={handleAddressKeydown}
                />
                <svg class="input-icon-left" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
                {#if clienteAddresses.length > 0}
                  <button class="address-inner-btn address-btn-saved" onclick={toggleAddressDropdown} tabindex="-1" type="button" title="Direcciones guardadas">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="6 9 12 15 18 9"/></svg>
                  </button>
                {/if}
                <button class="address-inner-btn address-btn-add" onclick={openAddAddressModal} tabindex="-1" type="button" title="Agregar nueva dirección">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                </button>
                {#if showAddressDropdown}
                  <div class="autocomplete-results">
                    {#each addressSuggestions as sug, i}
                      <div class="autocomplete-item" class:selected={i === selectedAddressIdx} onmousedown={(e) => { e.preventDefault(); selectAddress(sug); }}>
                        {#if sug.type === 'saved'}
                          <span class="addr-label">{sug.data.label || 'Dirección'}</span>
                          <span class="addr-text">{sug.data.address}{sug.data.extra ? ` - ${sug.data.extra}` : ''}</span>
                        {:else}
                          <span class="addr-nominatim">{limpiarDireccion(sug.data.display_name)}</span>
                        {/if}
                      </div>
                    {/each}
                    {#if isSearchingAddress && addressSuggestions.length === 0}
                      <div class="autocomplete-item searching-item">Buscando...</div>
                    {/if}
                    <div class="autocomplete-divider"></div>
                    <div class="autocomplete-item add-address-item" onmousedown={(e) => { e.preventDefault(); openAddAddressModal(); }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      Guardar como nueva dirección
                    </div>
                  </div>
                {/if}
              </div>
            </div>
            <div class="field flex-1">
              <div class="icon-input-wrap">
                <input type="text" bind:value={cliente_piso_depto} placeholder="Piso/Depto" class="input-with-icon-left" />
                <svg class="input-icon-left" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
              </div>
            </div>
            <div class="field flex-1">
              <div class="icon-input-wrap">
                <input type="text" bind:value={cliente_taller} placeholder="Taller" class="input-with-icon-left" />
                <svg class="input-icon-left" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 00 0 1.4l1.6 1.6a1 1 0 00 1.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
              </div>
            </div>
          </div>
        </div>

        <!-- Items -->
        <div class="paper-section items-section">
          <div class="items-layout">
          <div class="items-table">
            <div class="items-header">
              <span class="col-qty">Cant.</span>
              <span class="col-desc">Detalle</span>
              <span class="col-price">P. Unit.</span>
              <span class="col-total">Total</span>
              <span class="col-drag"></span>
              <span class="col-del"></span>
            </div>
            <div class="items-body">
            {#each items as item, i}
              <div class="items-row" data-index={i} class:drag-target={dragHighlightedSet.has(i)} class:dragging={i === dragStartIndex && isDragging} class:desc-only={item.cantidad === 0}>
                <div class="combobox-wrap col-qty">
                  <input type="text" inputmode="decimal" class="combobox-input"
                    value={item.cantidad}
                    oninput={(e) => {
                      const v = parseFloat(e.currentTarget.value);
                      item.cantidad = isNaN(v) || v < 0 ? 1 : v;
                      updateItemTotal(i);
                    }}
                    onfocus={() => { showQtyDropdown[i] = true; showQtyDropdown = showQtyDropdown; }}
                    onblur={() => setTimeout(() => { showQtyDropdown[i] = false; showQtyDropdown = showQtyDropdown; }, 200)}
                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { showQtyDropdown[i] = false; showQtyDropdown = showQtyDropdown; } }}
                  />
                  <button type="button" class="combobox-toggle" tabindex="-1"
                    onmousedown={(e) => { e.preventDefault(); showQtyDropdown[i] = !showQtyDropdown[i]; showQtyDropdown = showQtyDropdown; }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
                  </button>
                  {#if showQtyDropdown[i]}
                    <div class="combobox-menu">
                      {#each cantidades as c}
                        <button type="button" class="combobox-item"
                          onmousedown={(e) => { e.preventDefault(); item.cantidad = c; updateItemTotal(i); showQtyDropdown[i] = false; showQtyDropdown = showQtyDropdown; }}>
                          {c}
                        </button>
                      {/each}
                    </div>
                  {/if}
                </div>
                <div class="autocomplete-wrap col-desc">
                  <input
                    type="text"
                    bind:value={productSearch[i]}
                    oninput={() => {
                      items[i].descripcion = productSearch[i];
                      items = items;
                      productSuggestions[i] = suggestPrice(productSearch[i], refsToProductos(preciosReferencia), pricingRules);
                      productSuggestions = productSuggestions;
                      selectedProdIndex[i] = -1;
                      selectedProdIndex = selectedProdIndex;
                      showProdResults[i] = true;
                      showProdResults = showProdResults;
                    }}
                    onfocus={() => { selectedProdIndex[i] = -1; selectedProdIndex = selectedProdIndex; showProdResults[i] = true; showProdResults = showProdResults; }}
                    onblur={() => setTimeout(() => { showProdResults[i] = false; showProdResults = showProdResults; }, 300)}
                    onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey && i === items.length - 1 && selectedProdIndex[i] < 0) { e.preventDefault(); addItem(); } else { handleProdKeydown(e, i); } }}
                    placeholder="Buscar producto..."
                  />
                  {#if showProdResults[i]}
                    <div class="autocomplete-results">
                      {#if (productSuggestions[i] || []).length > 0}
                        <div class="autocomplete-label">Precios sugeridos</div>
                        {#each (productSuggestions[i] || []) as sug, si}
                          {#if sug.hint}
                            <div class="autocomplete-item autocomplete-hint" data-prod-row={i}>
                              <span class="prod-desc-hint">{sug.hint}</span>
                            </div>
                          {:else}
                            <div
                              class="autocomplete-item suggested"
                              class:selected={si === selectedProdIndex[i]}
                              onmousedown={(e) => { e.preventDefault(); selectSuggestion(i, sug); }}
                              role="button"
                              tabindex="0"
                              data-prod-row={i}
                            >
                              <span class="prod-desc">{sug.basedOn || sug.description}</span>
                              <span class="prod-price">${sug.price.toFixed(0)}</span>
                              <span class="prod-tag" class:estimated={sug.estimated}>{sug.estimated ? 'Estimado' : 'Sugerido'}</span>
                            </div>
                          {/if}
                        {/each}
                        <div class="autocomplete-divider"></div>
                      {/if}
                      {#each smartProductSearch(productSearch[i], productos) as prod, pi}
                        <div
                          class="autocomplete-item"
                          class:selected={(pi + (productSuggestions[i]?.length || 0)) === selectedProdIndex[i]}
                          onmousedown={(e) => { e.preventDefault(); selectProducto(i, prod); }}
                          data-prod-row={i}
                        >
                          <span class="prod-desc">{prod.descripcion}</span>
                          <span class="prod-price">${prod.precio_unitario.toFixed(0)}</span>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
                <input class="col-price" type="number" bind:value={item.precio_unitario} oninput={() => updateItemTotal(i)} min="0" step="0.01" />
                <span class="col-total" class:desc-only={item.cantidad === 0}>{item.cantidad === 0 ? '—' : `$${(item.total || item.cantidad * (item.precio_unitario ?? 0)).toFixed(0)}`}</span>
                <button type="button" class="col-drag btn-drag" onmousedown={(e) => dragStart(i, e)} title="Arrastrar para duplicar" tabindex="-1">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="5" y1="9" x2="19" y2="9"/><line x1="5" y1="15" x2="19" y2="15"/><line x1="9" y1="5" x2="9" y2="19"/><line x1="15" y1="5" x2="15" y2="19"/></svg>
                </button>
                <button class="col-del btn-del" onclick={() => removeItem(i)} disabled={items.length <= 1} aria-label="Eliminar fila">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            {/each}
            </div>
          </div>
          <div class="summary-sidebar">
            <div class="field">
              <label>Costo Envío</label>
              <input type="number" bind:value={envio} min="0" step="0.01" />
            </div>
            <div class="summary-divider"></div>
            <div class="rapid-payment">
              <div class="rapid-payment-header">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                <span>Pago Rápido</span>
              </div>
              {#if pagoRapidoAplicado}
                <div class="payment-applied">
                  <span class="payment-applied-label">Aplicado</span>
                  <span class="payment-applied-value">${pagoRapidoMonto.toFixed(0)}</span>
                </div>
              {:else}
                <div class="payment-row">
                  <input type="number" bind:value={pagoRapidoMonto} min="0" step="0.01" placeholder="Monto $" />
                  <button type="button" class="payment-btn" onclick={openPagoRapido}>Aplicar</button>
                </div>
              {/if}
            </div>
            <div class="summary-divider"></div>
            <div class="summary-total">
              <span class="summary-total-label">Total</span>
              <span class="summary-total-value">${(totalConEnvio - (pagoRapidoAplicado ? pagoRapidoMonto : 0)).toFixed(0)}</span>
              {#if id !== null}
                <div class="summary-status">
                  {#if currentSaldo <= 0.01}
                    <span class="status-paid">✓ Pagado</span>
                  {:else}
                    <span class="status-debt">Debe ${currentSaldo.toFixed(0)}</span>
                  {/if}
                </div>
              {/if}
            </div>
        </div>
        </div>
        </div>
      </div>
        <!-- Delivery section: below form, inside form-area -->
        <div class="delivery-sticky">
          <div class="delivery-row">
            <div class="segmented-control">
              <button class:active={tipo_entrega === 'Retira'} onclick={() => tipo_entrega = 'Retira'} type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> Retira</button>
              <button class:active={tipo_entrega === 'Envio'} onclick={() => tipo_entrega = 'Envio'} type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg> Envío</button>
              <button class:active={tipo_entrega === 'Retiro y Envio'} onclick={() => tipo_entrega = 'Retiro y Envio'} type="button"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/></svg> Ret+Env</button>
            </div>
            <div class="delivery-date-group">
              <button class="date-btn" type="button" onclick={showDatePicker}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                {#if fecha_entrega}
                  <span class="date-text">{getDiaSemana(fecha_entrega)} {fecha_entrega}</span>
                {:else}
                  <span>Elegir fecha</span>
                {/if}
              </button>
              <input id="date-picker-input" type="date" bind:value={datePickerVal} onchange={onDatePick} class="date-picker-hidden" />
            </div>
            <div class="delivery-discount">
              <button class="top-btn top-btn-discount" onclick={() => showDiscountModal = true}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>
                Descuento
              </button>
            </div>
            <div class="delivery-whatsapp">
              <button class="top-btn top-btn-wa" onclick={shareWhatsApp}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                WhatsApp
              </button>
            </div>
          </div>
        </div>
    </div>

    {#if showDiscountModal}
      <div class="modal-overlay" onclick={() => showDiscountModal = false} role="presentation">
        <div class="modal modal-discount" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (showDiscountModal = false)}>
          <h3>Descuento</h3>
          <div class="modal-body">
            <div class="discount-tabs">
              <button class:active={discountMode === 'amount'} onclick={() => discountMode = 'amount'} type="button">$ Monto</button>
              <button class:active={discountMode === 'percent'} onclick={() => discountMode = 'percent'} type="button">% Porcentaje</button>
            </div>
            <div class="discount-input-group">
              {#if discountMode === 'amount'}
                <label>Monto ($)</label>
                <input type="number" bind:value={discountValue} min="0" step="0.01" placeholder="0" class="discount-input" />
              {:else}
                <label>Porcentaje (%)</label>
                <input type="number" bind:value={discountValue} min="0" max="100" step="0.01" placeholder="0" class="discount-input" />
                <div class="discount-preview">
                  {discountValue > 0 ? `$${(totalCalculado * discountValue / 100).toFixed(0)} de $${totalCalculado.toFixed(0)}` : '—'}
                </div>
              {/if}
            </div>
            {#if items.some(i => i.descripcion === 'DESCUENTO')}
              <div class="discount-current">
                Descuento actual: $${Math.abs(items.find(i => i.descripcion === 'DESCUENTO')?.total || 0).toFixed(0)}
              </div>
            {/if}
          </div>
          <div class="modal-footer">
            {#if items.some(i => i.descripcion === 'DESCUENTO')}
              <button class="btn btn-danger" onclick={removeDiscount}>Quitar</button>
            {/if}
            <button class="btn btn-secondary" onclick={() => showDiscountModal = false}>Cancelar</button>
            <button class="btn btn-primary" onclick={applyDiscount} disabled={discountValue <= 0}>Aplicar</button>
          </div>
        </div>
      </div>
    {/if}

    {#if showPriceModal && priceAdjustSuggestion}
      <div class="modal-overlay" onclick={cancelPriceAdjust} role="presentation">
        <div class="modal modal-price" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => { if (e.key === 'Escape') cancelPriceAdjust(); if (e.key === 'Enter') applyPriceAdjust(); }}>
          <h3>Ajustar Precio</h3>
          <div class="modal-body">
            <p class="price-suggestion-label">Precio sugerido</p>
            <p class="price-suggestion-source">Basado en: {priceAdjustSuggestion.basedOn || priceAdjustSuggestion.description}</p>
            <p class="price-suggestion-value">${priceAdjustSuggestion.price.toFixed(0)}</p>
            <div class="price-divider"></div>
            <p class="price-quick-label">Ajuste rápido:</p>
            <div class="price-quick-btns">
              <button class="btn btn-xs btn-price" onclick={() => adjustByPercent(-10)}>-10%</button>
              <button class="btn btn-xs btn-price" onclick={() => adjustByPercent(-5)}>-5%</button>
              <button class="btn btn-xs btn-price" onclick={() => adjustByPercent(5)}>+5%</button>
              <button class="btn btn-xs btn-price" onclick={() => adjustByPercent(10)}>+10%</button>
              <button class="btn btn-xs btn-price" onclick={() => adjustByPercent(20)}>+20%</button>
            </div>
            <div class="form-group">
              <label>Precio final:</label>
              <input type="number" bind:value={priceAdjustValue} bind:this={priceInputEl} autofocus min="0" step="1" class="price-final-input" />
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" onclick={cancelPriceAdjust}>Cancelar</button>
            <button class="btn btn-primary" onclick={applyPriceAdjust}>Confirmar</button>
          </div>
        </div>
      </div>
    {/if}

    <!-- Offscreen iframe for WhatsApp receipt capture (CSS-isolated) -->
    <iframe id="receipt-iframe" style="position:absolute;left:-9999px;width:400px;height:0;border:none" title="receipt"></iframe>

    <!-- History sidebar -->
    <div class="history-panel">
      <div class="history-header">
        <h3>Historial</h3>
        <div class="history-header-actions">
          <button class="refresh-btn" onclick={refreshHistory} title="Actualizar historial">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
          </button>
          <button class="duplicate-btn" onclick={duplicateInvoice} title="Duplicar factura actual">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
          <button class="trash-btn" onclick={deleteCurrentInvoice} title="Eliminar factura actual"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
        </div>
      </div>
      <div class="search-wrap">
        <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input
          class="search-input"
          type="text"
          bind:value={searchHistory}
          placeholder="Buscar en facturas..."
        />
      </div>
      <div class="history-actions">
        <span class="history-sel-count">{selectedHistoryIds.size > 0 ? `${selectedHistoryIds.size} selec.` : ''}</span>
        <button class="top-btn top-btn-molduras" onclick={() => showMoldurasModal = true} disabled={selectedHistoryIds.size === 0}>
          🖼 Molduras
        </button>
      </div>
      <div class="history-list">
        {#each filteredHistory as f}
          <div
            class="history-item"
            class:active={f.id === id}
            class:selected={selectedHistoryIds.has(f.id)}
            onclick={(e) => {
              if (e.ctrlKey) {
                const s = new Set(selectedHistoryIds);
                if (s.has(f.id)) s.delete(f.id); else s.add(f.id);
                selectedHistoryIds = s;
              } else {
                selectedHistoryIds = new Set();
                loadInvoice(f.id);
              }
            }}
          >
            <div class="history-item-header">
              <span class="history-num">{f.numero_factura || f.numero_presupuesto || `#${f.id}`}</span>
              {#if f.estado_kanban === 'NO_CONFIRMADO'}
                <span class="history-nc-badge">⏳ No Confirmado</span>
              {/if}
              <span class="history-date">{f.fecha || ''}</span>
            </div>
            <div class="history-client">{f.cliente_nombre || 'Sin cliente'}</div>
            <div class="history-total">${(f.total || 0).toFixed(0)}</div>
            <div class="history-status">
              {#if (f.total || 0) - (pagoMap[f.id] || 0) <= 0.01}
                <span class="status-paid">✓ Pagado</span>
              {:else}
                <span class="status-debt">Debe ${((f.total || 0) - (pagoMap[f.id] || 0)).toFixed(0)}</span>
              {/if}
            </div>
          </div>
        {:else}
          <div class="history-empty">Sin facturas</div>
        {/each}
      </div>
    </div>
    </div>
  </div>
</div>

{#if showMoldurasModal}
  <MoldurasModal
    show={showMoldurasModal}
    preselectedIds={Array.from(selectedHistoryIds)}
    onClose={() => { showMoldurasModal = false; selectedHistoryIds = new Set(); }}
  />
{/if}

{#if showPagoDialog}
  <PagoDialog
    bind:show={showPagoDialog}
    invoiceId={id ?? 0}
    invoiceNumero={numero_factura || numero_presupuesto}
    invoiceCliente={cliente_nombre}
    invoiceTotal={totalConEnvio}
    initialAmount={pagoRapidoMonto}
    onclose={() => { showPagoDialog = false; }}
    onsaved={handlePagoSaved}
  />
{/if}

{#if showPriceList}
  <PriceListModal
    show={showPriceList}
    onclose={() => { showPriceList = false; }}
  />
{/if}

{#if showNewAddressPrompt}
  <div class="modal-overlay" onclick={() => showNewAddressPrompt = false} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
      <h3>¿Guardar nueva dirección?</h3>
      <p style="margin:0.5rem 0;color:var(--text-secondary);font-size:0.9rem;">
        "{cliente_domicilio}{cliente_piso_depto ? ` - ${cliente_piso_depto}` : ''}" no está guardada como dirección de <strong>{cliente_nombre}</strong>.
      </p>
      <label style="display:block;margin-bottom:0.3rem;font-size:0.85rem;color:var(--text-secondary);">Etiqueta (opcional)</label>
      <input type="text" bind:value={newAddressLabel} placeholder="Ej: Casa, Trabajo, Taller..." style="width:100%;padding:0.5rem;border:1px solid var(--border);border-radius:0.4rem;font-size:0.9rem;box-sizing:border-box;" />
      <label style="display:flex;align-items:center;gap:0.5rem;margin-top:0.75rem;font-size:0.85rem;cursor:pointer;">
        <input type="checkbox" bind:checked={newAddressDefault} />
        Establecer como dirección predeterminada
      </label>
      <div class="modal-actions" style="margin-top:1rem;">
        <button class="btn btn-sm btn-outline" onclick={() => showNewAddressPrompt = false}>No guardar</button>
        <button class="btn btn-sm btn-primary" onclick={saveNewAddress}>Guardar dirección</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .facturacion {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ===== MAIN LAYOUT ===== */
  .main-layout {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
  }
  .content-row {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .form-area {
    flex: 1;
    overflow-y: auto;
    padding: 1.143rem 1.429rem;
    display: flex;
    flex-direction: column;
  }

  /* ===== PAPER CARD (unified Header + Cliente + Items) ===== */
  .paper-card {
    background: var(--bg-card);
    border: 0.071rem solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: 0 0.143rem 0.571rem rgba(0,0,0,0.1);
    overflow: hidden;
    flex: 1;
    min-height: 0;
  }
  .paper-section {
    padding: 1rem 1.429rem;
  }
  .paper-section + .paper-section {
    border-top: 0.071rem solid var(--border-light);
  }


  .pdf-style-label {
    font-size: 0.857rem;
    font-weight: 600;
    color: var(--text-muted, #888);
    margin-right: 0.286rem;
    text-transform: uppercase;
    letter-spacing: 0.036rem;
  }
  .pdf-style-btn {
    font-size: 0.786rem;
    padding: 0.214rem 0.714rem;
    border: 0.071rem solid var(--border, #ddd);
    border-radius: var(--radius-sm, 0.286rem);
    background: var(--bg-card, #fff);
    color: var(--text, #333);
    cursor: pointer;
    transition: all 0.15s;
    font-weight: 500;
  }
  .pdf-style-btn:hover {
    border-color: var(--primary, #e91e63);
    color: var(--primary, #e91e63);
  }
  .pdf-style-btn.active {
    background: var(--primary, #e91e63);
    color: #fff;
    border-color: var(--primary, #e91e63);
  }

  /* ===== ROWS & FIELDS ===== */
  .row {
    display: flex;
    gap: 0.857rem;
    margin-bottom: 0.571rem;
    flex-wrap: wrap;
  }
  .row:last-child { margin-bottom: 0; }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.286rem;
    min-width: 8.571rem;
    flex: 1;
  }
  .field label {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-secondary);
    letter-spacing: 0.01em;
  }
  .field input, .field select {
    padding: 0.5rem 0.714rem;
    border: 1.5px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: var(--text-base);
    color: var(--text-primary);
    background: var(--bg-card);
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
    width: 100%;
  }
  .field .input-with-icon-left {
    padding-left: 2.286rem;
  }
  .field-num { max-width: 11.429rem; }
  .field-fecha { max-width: 10rem; }
  .field input:focus, .field select:focus {
    border-color: var(--border-focus);
    box-shadow: 0 0 0 0.214rem rgba(37,99,235,0.12);
  }
  .input-readonly {
    background: var(--bg-hover);
    color: var(--text-secondary);
    cursor: default;
  }
  .flex-1 { flex: 1; }
  .flex-2 { flex: 2; }
  .flex-4 { flex: 4; }

  /* ===== HEADER ROW ===== */
  .header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.857rem;
  }
  .brand-text {
    font-size: var(--text-lg);
    font-weight: 700;
    color: var(--text-primary);
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  .shortcuts-hint {
    font-size: 0.786rem;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .confirm-badge {
    font-size: 0.72rem;
    font-weight: 700;
    padding: 0.2rem 0.5rem;
    border-radius: 0.3rem;
    white-space: nowrap;
  }
  .confirm-badge.no-confirmado {
    background: #fef3c7;
    color: #92400e;
  }
  .confirm-badge.confirmado {
    background: #d1fae5;
    color: #065f46;
  }
  .top-btn-confirm {
    font-size: 0.78rem;
    padding: 0.25rem 0.6rem;
    border: 0.071rem solid var(--border);
    background: var(--bg-card);
    color: var(--text-primary);
    cursor: pointer;
    border-radius: var(--radius-sm);
    white-space: nowrap;
    transition: all 0.12s;
    font-weight: 600;
  }
  .top-btn-confirm:hover { background: var(--bg-hover); border-color: var(--accent); }
  .header-fields {
    display: flex;
    gap: 0.857rem;
    align-items: flex-end;
  }

  .tipo-toggle {
    display: inline-flex;
    border: 1.5px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .tipo-btn {
    padding: 0.357rem 0.857rem;
    border: none;
    background: var(--bg-card);
    cursor: pointer;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-secondary);
    transition: all 0.15s;
  }
  .tipo-btn:first-child { border-right: 0.071rem solid var(--border); }
  .tipo-btn.active {
    background: var(--accent);
    color: white;
  }
  .tipo-btn:not(.active):hover { background: var(--bg-hover); }

  /* ===== ICON INSIDE INPUT (LEFT) ===== */
  .autocomplete-wrap, .icon-input-wrap {
    position: relative;
  }
  .input-icon-left {
    position: absolute;
    left: 0.714rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-muted);
    pointer-events: none;
    flex-shrink: 0;
  }

  /* ===== AUTOCOMPLETE ===== */
  .autocomplete-wrap {
    position: relative;
  }
  .autocomplete-results {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background: var(--bg-card);
    border: 0.071rem solid var(--border);
    border-radius: 0 0 var(--radius-sm) var(--radius-sm);
    max-height: 14.286rem;
    overflow-y: auto;
    z-index: 100;
    box-shadow: var(--shadow-md);
    margin-top: 0.143rem;
  }
  .autocomplete-item {
    display: flex;
    align-items: center;
    padding: 0.571rem 0.857rem;
    font-size: var(--text-sm);
    cursor: pointer;
    transition: background 0.1s;
  }
  .autocomplete-item:hover, .autocomplete-item.selected {
    background: var(--accent-light);
  }
  .autocomplete-item .prod-desc { flex: 1; }
  .autocomplete-item .prod-price {
    font-family: var(--font-mono);
    color: var(--text-muted);
    margin-left: 0.571rem;
    font-size: var(--text-sm);
  }
  .autocomplete-item.suggested {
  }
  .autocomplete-item.suggested:hover {
    background: var(--accent-light);
  }
  .autocomplete-item .prod-tag {
    font-size: 0.68rem;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .autocomplete-item .prod-tag.estimated {
    color: var(--accent);
  }
  .autocomplete-hint {
    padding: 0.571rem 0.857rem;
    font-size: var(--text-xs);
    color: var(--text-muted);
    font-style: italic;
    cursor: default;
    pointer-events: none;
  }
  .prod-desc-hint {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .autocomplete-label {
    font-size: 0.68rem;
    text-transform: uppercase;
    color: #d97706;
    font-weight: 700;
    padding: 0.286rem 0.857rem 0.143rem;
    letter-spacing: 0.04em;
  }
  .autocomplete-divider {
    height: 0.071rem;
    background: var(--border-light);
    margin: 0.143rem 0;
  }

  /* ===== ITEMS TABLE ===== */
  .items-table {
    border: 0.071rem solid var(--border);
    border-radius: var(--radius-sm);
    overflow: visible;
  }
  .items-header {
    display: grid;
    grid-template-columns: 3.8rem 1fr 5.714rem 6.429rem 2rem 2rem;
    gap: 0.571rem;
    background: var(--bg-hover);
    padding: 0.571rem 0.857rem;
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 0.071rem solid var(--border);
  }
  .items-row {
    display: grid;
    grid-template-columns: 3.8rem 1fr 5.714rem 6.429rem 2rem 2rem;
    gap: 0.571rem;
    align-items: center;
    padding: 0.429rem 0.857rem;
    border-bottom: 0.071rem solid var(--border-light);
    transition: background 0.12s;
  }
  .items-row:hover { background: var(--bg-hover); }
  .items-row:last-child { border-bottom: none; }

  .combobox-wrap { position: relative; width: auto; display: flex; align-items: center; }
  .items-row .combobox-input {
    width: 100%;
    padding: 0.357rem 1.4rem 0.357rem 0.286rem;
    border: 1.5px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    font-weight: 600;
    background: var(--bg-card);
    color: var(--text-primary);
    outline: none;
    text-align: center;
    font-variant-numeric: tabular-nums;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .items-row .combobox-input:focus {
    border-color: var(--border-focus);
    box-shadow: 0 0 0 0.214rem rgba(37,99,235,0.12);
  }
  .combobox-toggle {
    position: absolute;
    right: 0.143rem;
    top: 50%;
    transform: translateY(-50%);
    width: 1.1rem;
    height: 1.1rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-tertiary);
    padding: 0;
    border-radius: 0.143rem;
  }
  .combobox-toggle:hover { color: var(--text-primary); background: var(--bg-hover); }
  .combobox-menu {
    position: absolute;
    top: 100%;
    left: 0;
    min-width: 100%;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    z-index: 100;
    max-height: 220px;
    overflow-y: auto;
  }
  .combobox-item {
    display: block;
    width: 100%;
    padding: 0.286rem 0.429rem;
    font-size: var(--text-sm);
    text-align: center;
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .combobox-item:hover { background: var(--bg-hover); }
  .col-desc { width: auto; min-width: 0; position: relative; }
  .items-row .col-desc input { text-align: left; font-family: var(--font); }
  .col-price { width: auto; }
  .col-total {
    width: auto;
    text-align: right;
    font-weight: 600;
    font-size: var(--text-sm);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }
  .col-total.desc-only {
    color: var(--text-muted);
    font-weight: 400;
  }
  .col-del { width: auto; text-align: center; }
  .col-drag { width: auto; text-align: center; }

  .btn-drag {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: grab;
    padding: 0.286rem;
    border-radius: 0.286rem;
    transition: color 0.12s, background 0.12s;
    opacity: 0.3;
  }
  .items-row:hover .btn-drag { opacity: 0.7; }
  .btn-drag:hover { color: var(--accent); background: var(--bg-hover); opacity: 1; }
  .dragging .btn-drag { cursor: grabbing; opacity: 1; color: var(--accent); }
  .items-row.drag-target {
    background: #e3f2fd;
    outline: 0.071rem solid #90caf9;
    outline-offset: -0.071rem;
  }
  .items-row.dragging { background: #e8f5e9; }
  .items-row.desc-only {
    color: var(--text-muted);
  }
  .items-row.desc-only .col-desc input {
    font-style: italic;
    color: var(--text-muted);
  }

  .items-row input {
    padding: 0.357rem 0.571rem;
    border: 1.5px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    width: 100%;
    outline: none;
    background: var(--bg-card);
    color: var(--text-primary);
    transition: border-color 0.15s, box-shadow 0.15s;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .items-row input:focus {
    border-color: var(--border-focus);
    box-shadow: 0 0 0 0.214rem rgba(37,99,235,0.12);
    font-family: var(--font);
    text-align: left;
  }

  .btn-del {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 1rem;
    padding: 0.286rem;
    border-radius: 0.286rem;
    transition: all 0.12s;
    opacity: 0.4;
  }
  .items-row:hover .btn-del { opacity: 1; }
  .btn-del:hover { color: var(--danger); background: rgba(220,38,38,0.08); }
  .btn-del:disabled { opacity: 0.15; pointer-events: none; }

  /* ===== ITEMS + SUMMARY LAYOUT ===== */
  .items-section { padding: 0; overflow: hidden; }
  .items-layout {
    display: flex;
    gap: 0;
  }
  .items-layout .items-table {
    flex: 1;
    border: none;
    border-radius: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .items-body {
    overflow-y: auto;
    max-height: 20rem;
    flex: 1;
  }
  .items-header {
    flex-shrink: 0;
  }
  .summary-sidebar {
    width: 14.286rem;
    flex-shrink: 0;
    padding: 1rem 1.143rem;
    border-left: 0.071rem solid var(--border-light);
    display: flex;
    flex-direction: column;
    gap: 0.857rem;
    background: var(--bg-card);
  }
  .summary-sidebar .field {
    margin: 0;
  }
  .summary-sidebar .field label {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-bottom: 0.143rem;
  }
  .summary-sidebar input,
  .summary-sidebar select {
    padding: 0.429rem 0.571rem;
    font-size: var(--text-sm);
  }

  .date-btn {
    display: flex;
    align-items: center;
    gap: 0.429rem;
    width: 100%;
    padding: 0.429rem 0.571rem;
    border: 1.5px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-card);
    color: var(--text-primary);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: border-color 0.15s;
    font-family: inherit;
  }
  .date-btn:hover { border-color: var(--border-focus); }
  .date-btn svg { flex-shrink: 0; color: var(--text-muted); }
  .date-text {
    font-weight: 700;
    color: var(--text-primary);
  }
  .date-picker-hidden { display: none; }

  .summary-divider {
    height: 0.071rem;
    background: var(--border-light);
    margin: 0.143rem 0;
  }

  .rapid-payment {
    display: flex;
    flex-direction: column;
    gap: 0.571rem;
  }
  .rapid-payment-header {
    display: flex;
    align-items: center;
    gap: 0.429rem;
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .rapid-payment-header svg {
    flex-shrink: 0;
    color: var(--success);
  }
  .payment-row {
    display: flex;
    gap: 0.429rem;
  }
  .payment-row input {
    flex: 0 1 6.143rem;
    max-width: 6.143rem;
    padding: 0.429rem 0.571rem;
    border: 1.5px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    background: var(--bg-card);
    color: var(--text-primary);
    outline: none;
  }
  .payment-row input:focus {
    border-color: var(--border-focus);
  }
  .payment-btn {
    padding: 0.429rem 0.857rem;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--success);
    color: white;
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;
  }
  .payment-btn:hover { background: #15803d; }

  .payment-applied {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.429rem 0.571rem;
    background: #f0fdf4;
    border: 0.071rem solid #bbf7d0;
    border-radius: var(--radius-sm);
  }
  .payment-applied-label {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--success);
    font-size: var(--text-base);
    font-weight: 700;
    color: #15803d;
    font-family: var(--font-mono);
  }

  /* === Delivery Section === */
  .delivery-sticky {
    flex-shrink: 0;
    background: var(--bg-card);
    border: 0.071rem solid var(--border);
    border-radius: var(--radius-md);
    box-shadow: 0 0.143rem 0.571rem rgba(0,0,0,0.1);
    padding: 0.714rem 1.143rem;
    margin-top: 0.571rem;
    margin-bottom: 1.143rem;
  }
  .delivery-row {
    display: flex;
    align-items: center;
    gap: 1.429rem;
    flex-wrap: nowrap;
  }
  .segmented-control {
    display: flex;
    gap: 0;
    border: 0.071rem solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
    flex-shrink: 0;
  }
  .segmented-control button {
    padding: 0.5rem 0.857rem;
    border: none;
    background: var(--bg-card);
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    border-right: 0.071rem solid var(--border);
    transition: all 0.12s;
    white-space: nowrap;
    color: var(--text-secondary);
  }
  .segmented-control button:last-child { border-right: none; }
  .segmented-control button.active {
    background: var(--accent);
    color: white;
  }
  .segmented-control button:hover:not(.active) { background: var(--bg-hover); }
  .delivery-date-group {
    display: flex;
    align-items: center;
    gap: 0.571rem;
    flex-shrink: 0;
  }
  .delivery-date-group label {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
    white-space: nowrap;
  }
  .delivery-whatsapp {
    margin-left: auto;
  }
  .delivery-whatsapp .top-btn {
    padding: 0.5rem 0.857rem;
    font-size: var(--text-sm);
    font-weight: 600;
    border: 0.071rem solid #b7f0d1;
    background: var(--bg-card);
    color: #25D366;
    cursor: pointer;
    border-radius: var(--radius-sm);
    display: inline-flex;
    align-items: center;
    gap: 0.286rem;
    white-space: nowrap;
    font-family: inherit;
    line-height: 1.4;
    transition: all 0.12s;
  }
  .delivery-whatsapp .top-btn:hover {
    background: #f0fdf4;
    border-color: #86efac;
  }
  .delivery-discount {
    flex-shrink: 0;
  }
  .delivery-discount .top-btn {
    padding: 0.5rem 0.857rem;
    font-size: var(--text-sm);
    font-weight: 600;
    border: 0.071rem solid #fcd34d;
    background: var(--bg-card);
    color: #d97706;
    cursor: pointer;
    border-radius: var(--radius-sm);
    display: inline-flex;
    align-items: center;
    gap: 0.286rem;
    white-space: nowrap;
    font-family: inherit;
    line-height: 1.4;
    transition: all 0.12s;
  }
  .delivery-discount .top-btn:hover {
    background: #fffbeb;
    border-color: #f59e0b;
  }
  .modal-discount { min-width: 22rem; max-width: 90vw; }
  .discount-tabs {
    display: flex;
    gap: 0;
    border: 0.071rem solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .discount-tabs button {
    padding: 0.429rem 0.857rem;
    border: none;
    background: var(--bg-card);
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    color: var(--text-secondary);
    flex: 1;
    text-align: center;
    transition: all 0.12s;
    font-family: inherit;
  }
  .discount-tabs button.active {
    background: #d97706;
    color: white;
  }
  .discount-tabs button:hover:not(.active) { background: var(--bg-hover); }
  .discount-input-group {
    display: flex;
    flex-direction: column;
    gap: 0.286rem;
  }
  .discount-input-group label {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .discount-input {
    padding: 0.5rem 0.714rem;
    border: 0.071rem solid var(--border);
    border-radius: var(--radius-sm);
    font-size: var(--text-base);
    width: 100%;
    box-sizing: border-box;
    font-family: inherit;
  }
  .discount-preview {
    font-size: var(--text-xs);
    color: #d97706;
    font-weight: 600;
    margin-top: 0.143rem;
  }
  .discount-current {
    font-size: var(--text-sm);
    color: #d97706;
    font-weight: 600;
    padding: 0.429rem;
    background: #fffbeb;
    border: 0.071rem solid #fcd34d;
    border-radius: var(--radius-sm);
    text-align: center;
  }
  .modal-price { min-width: 20rem; max-width: 90vw; }
  .price-suggestion-label {
    font-size: var(--text-xs);
    text-transform: uppercase;
    color: var(--text-muted);
    font-weight: 600;
    letter-spacing: 0.03em;
    margin: 0;
  }
  .price-suggestion-source {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    margin: 0.143rem 0 0 0;
  }
  .price-suggestion-value {
    font-size: 2rem;
    font-weight: 800;
    color: #16a34a;
    margin: 0.429rem 0;
  }
  .price-divider {
    height: 0.071rem;
    background: var(--border);
    margin: 0.429rem 0;
  }
  .price-quick-label {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    margin: 0 0 0.429rem 0;
    font-weight: 500;
  }
  .price-quick-btns {
    display: flex;
    gap: 0.286rem;
    flex-wrap: wrap;
    margin-bottom: 0.857rem;
  }
  .btn-price {
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-weight: 600;
    padding: 0.357rem 0.714rem;
  }
  .btn-price:hover {
    background: var(--accent-light);
    color: var(--accent);
  }
  .price-final-input {
    padding: 0.5rem 0.714rem;
    border: 0.071rem solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 1.2rem;
    font-weight: 700;
    width: 100%;
    box-sizing: border-box;
    text-align: center;
    font-family: var(--font-mono);
  }

  .summary-total {
    padding-top: 0.714rem;
    border-top: 0.143rem solid var(--text-primary);
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.286rem;
  }
  .summary-total-label {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .summary-total-value {
    font-size: 2.4rem;
    font-weight: 900;
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    line-height: 1.15;
  }

  /* ===== HISTORY ===== */
  .history-panel {
    width: 21.429rem;
    flex-shrink: 0;
    background: var(--bg-page);
    border-left: 0.143rem solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .history-header {
    padding: 1rem 1.143rem 0.714rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .history-header h3 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
  }
  .history-header-actions {
    display: flex;
    align-items: center;
    gap: 0.286rem;
  }
  .trash-btn:not(.active) {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.143rem 0.286rem;
    border-radius: 0.286rem;
    transition: color 0.12s;
    display: flex;
    align-items: center;
  }
  .trash-btn:hover { color: var(--danger); }
  .duplicate-btn:not(.active) {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.143rem 0.286rem;
    border-radius: 0.286rem;
    transition: color 0.12s;
    display: flex;
    align-items: center;
  }
  .duplicate-btn:hover { color: var(--accent); }
  .refresh-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0.143rem 0.286rem;
    border-radius: 0.286rem;
    transition: color 0.12s;
    display: flex;
    align-items: center;
  }
  .refresh-btn:hover { color: var(--accent); transform: rotate(90deg); }
  .refresh-btn svg { transition: transform 0.3s; }
  .refresh-btn:hover svg { transform: rotate(90deg); }

  .search-wrap {
    position: relative;
    margin: 0 0.857rem 0.571rem;
  }
  .search-icon {
    position: absolute;
    left: 0.714rem;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text-muted);
    pointer-events: none;
  }
  .search-input {
    width: 100%;
    padding: 0.5rem 0.714rem 0.5rem 2.286rem;
    border: 1.5px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    outline: none;
    background: var(--bg-card);
    color: var(--text-primary);
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .search-input:focus {
    border-color: var(--border-focus);
    box-shadow: 0 0 0 0.214rem rgba(37,99,235,0.12);
  }
  .search-input::placeholder { color: var(--text-muted); }

  .history-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.286rem 0.857rem;
    gap: 0.429rem;
  }
  .history-sel-count {
    font-size: 0.72rem;
    color: var(--accent);
    font-weight: 600;
  }
  .top-btn-molduras {
    font-size: 0.78rem;
    padding: 0.214rem 0.571rem;
    border: 0.071rem solid var(--border);
    background: var(--bg-card);
    color: var(--text-primary);
    cursor: pointer;
    border-radius: var(--radius-sm);
    white-space: nowrap;
    transition: all 0.12s;
  }
  .top-btn-molduras:hover { background: var(--bg-hover); border-color: var(--accent); }
  .top-btn-molduras:disabled { opacity: 0.4; cursor: default; pointer-events: none; }

  .history-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 0.571rem 0.571rem;
  }
  .history-item {
    padding: 0.571rem 0.714rem;
    display: flex;
    flex-direction: column;
    gap: 0.143rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    margin-bottom: 0.286rem;
    transition: all 0.12s;
    border-left: 0.214rem solid transparent;
    background: var(--bg-card);
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
    border: 0.071rem solid #e8eaed;
  }
  .history-item:hover { border-color: var(--border); }
  .history-item.active {
    background: var(--accent-light);
    border-left-color: var(--accent);
    border-color: var(--accent);
  }
  .history-item.selected {
    background: var(--accent-light);
    border-left-color: #6366f1;
    border-color: #6366f1;
  }

  .history-item-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .history-num {
    font-weight: 600;
    font-size: var(--text-sm);
    color: var(--text-primary);
  }
  .history-nc-badge {
    font-size: 0.6rem;
    font-weight: 700;
    background: #fef3c7;
    color: #92400e;
    padding: 0.08rem 0.3rem;
    border-radius: 0.2rem;
    white-space: nowrap;
  }
  .history-date {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .history-client {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .history-total {
    font-size: var(--text-sm);
    font-weight: 700;
    color: var(--text-primary);
    margin-top: 0.214rem;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .history-status {
    margin-top: 0.143rem;
  }
  .status-paid {
    color: var(--success, #16a34a);
    font-weight: 700;
    font-size: var(--text-xs);
  }
  .status-debt {
    color: var(--danger, #dc2626);
    font-weight: 700;
    font-size: var(--text-xs);
  }
  .summary-status {
    text-align: right;
    margin-top: 0.286rem;
  }
  .summary-status .status-paid,
  .summary-status .status-debt {
    font-size: var(--text-sm);
  }
  .history-empty {
    padding: 1.714rem 1.143rem;
    text-align: center;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .loading-overlay {
    position: absolute;
    inset: 0;
    background: var(--bg-card);
    opacity: 0.85;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
    border-radius: var(--radius-md);
  }
  .loading-text {
    color: var(--text-muted);
    font-size: var(--text-lg);
    font-weight: 600;
  }

  /* ===== ADDRESS INNER BUTTONS (▼ +) ===== */
  .input-with-address-btns {
    padding-right: 3.2rem !important;
  }
  .address-inner-btn {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.2rem 0.3rem;
    border-radius: 0.214rem;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    transition: color 0.12s, background 0.12s;
    z-index: 1;
  }
  .address-inner-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .address-btn-saved { right: 1.5rem; }
  .address-btn-add { right: 0.2rem; }
  .add-address-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    font-weight: 600;
    color: var(--accent);
  }
  .add-address-item:hover {
    background: var(--accent-light);
  }
  .addr-label {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-right: 0.3rem;
    white-space: nowrap;
  }
  .addr-text {
    font-size: var(--text-sm);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .addr-nominatim {
    font-size: var(--text-sm);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .searching-item {
    color: var(--text-muted);
    font-style: italic;
    font-size: var(--text-xs);
    justify-content: center;
  }

</style>
