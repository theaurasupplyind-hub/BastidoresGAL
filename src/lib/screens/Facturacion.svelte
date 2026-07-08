<script lang="ts">
  import { onMount } from 'svelte';
  import { untrack } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import type { Factura, InvoiceItem, Cliente, Producto } from '$lib/types';
  import { invoke } from '@tauri-apps/api/core';
  import { Image } from '@tauri-apps/api/image';
  import { writeImage } from '@tauri-apps/plugin-clipboard-manager';
  import { open as shellOpen } from '@tauri-apps/plugin-shell';
  import html2canvas from 'html2canvas';
  import { renderReceiptHtml } from '$lib/utils/receipt';
  import MoldurasModal from '$lib/components/MoldurasModal.svelte';
  import PagoDialog from '$lib/components/PagoDialog.svelte';
  import PriceListModal from '$lib/components/PriceListModal.svelte';
  import { suggestPrice, smartProductSearch, normalizeText, getBaseAndDims, type PriceSuggestion } from '$lib/utils/precios';

  let loading = $state(false);
  let saving = $state(false);
  let facturas = $state<Factura[]>([]);
  let currentIndex = $state(-1);
  let clientes = $state<Cliente[]>([]);
  let productos = $state<Producto[]>([]);
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
  let cliente_telefono = $state('');
  let cliente_taller = $state('');
  let cliente_estudiante = $state('');
  let envio = $state(0);
  let tipo_entrega = $state('Retira');
  let fecha_entrega = $state('');
  let pagoRapidoMonto = $state(0);
  let pagoRapidoAplicado = $state(false);
  let showPagoDialog = $state(false);

  function handlePagoSaved() {
    if (pagoRapidoMonto > 0) {
      pagoRapidoAplicado = true;
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
  let clienteSearch = $state('');
  let showClienteResults = $state(false);
  let selectedClienteIndex = $state(-1);

  // Product autocomplete per row
  let productSearch = $state<string[]>(['']);
  let selectedProdIndex = $state<number[]>([-1]);
  let showProdResults = $state<boolean[]>([false]);

  // Combo options
  const tiposEntrega = ['Retira', 'Envio', 'Retiro y Envio'];
  const cantidades = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

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
    await Promise.all([loadClientes(), loadProductos(), refreshHistory()]);
    if (appStore.pendingInvoiceId != null) {
      await loadInvoice(appStore.pendingInvoiceId);
      appStore.pendingInvoiceId = null;
    } else {
      await newInvoice();
    }
    _initialized = true;
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

  function invalidateCache() {
    cacheStore.invalidate('facturas');
    cacheStore.invalidate('clientes');
    cacheStore.invalidate('productos');
  }

  function selectCliente(c: Cliente) {
    cliente_id = c.id;
    cliente_nombre = c.nombre;
    cliente_domicilio = c.domicilio;
    cliente_telefono = c.telefono;
    cliente_taller = c.taller || '';
    cliente_estudiante = c.estudiante || '';
    clienteSearch = c.nombre;
    selectedClienteIndex = -1;
    showClienteResults = false;
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
    items[index].descripcion = sug.description;
    items[index].precio_unitario = sug.price;
    items[index].total = items[index].cantidad * sug.price;
    items = items;
    productSearch[index] = sug.description;
    productSearch = productSearch;
    showProdResults[index] = false;
    selectedProdIndex[index] = -1;
    priceAdjustIndex = index;
    priceAdjustSuggestion = sug;
    priceAdjustValue = sug.price;
    showPriceModal = true;
  }

  function applyPriceAdjust() {
    if (priceAdjustIndex >= 0 && priceAdjustValue > 0) {
      items[priceAdjustIndex].precio_unitario = priceAdjustValue;
      items[priceAdjustIndex].total = items[priceAdjustIndex].cantidad * priceAdjustValue;
      items = items;
    }
    showPriceModal = false;
    priceAdjustIndex = -1;
    priceAdjustSuggestion = null;
  }

  function adjustByPercent(pct: number) {
    if (!priceAdjustSuggestion) return;
    priceAdjustValue = Math.round(priceAdjustSuggestion.price * (1 + pct / 100));
  }

  function cancelPriceAdjust() {
    if (priceAdjustIndex >= 0 && priceAdjustSuggestion) {
      items[priceAdjustIndex].precio_unitario = priceAdjustSuggestion.price;
      items[priceAdjustIndex].total = items[priceAdjustIndex].cantidad * priceAdjustSuggestion.price;
      items = items;
    }
    showPriceModal = false;
    priceAdjustIndex = -1;
    priceAdjustSuggestion = null;
  }

  function getAllResults(index: number): Array<{ type: 'suggestion' | 'product'; data: any }> {
    const suggs = (productSuggestions[index] || []).map((s: PriceSuggestion) => ({ type: 'suggestion' as const, data: s }));
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
  }

  function removeItem(index: number) {
    if (items.length <= 1) return;
    items = items.filter((_, i) => i !== index);
    productSearch = productSearch.filter((_, i) => i !== index);
    selectedProdIndex = selectedProdIndex.filter((_, i) => i !== index);
    showProdResults = showProdResults.filter((_, i) => i !== index);
    productSuggestions = productSuggestions.filter((_, i) => i !== index);
  }

  function updateItemTotal(index: number) {
    const item = items[index];
    item.total = item.cantidad * (item.precio_unitario ?? 0);
    items = items; // trigger reactivity
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
    pagoRapidoMonto = 0;
    pagoRapidoAplicado = false;
    clienteSearch = f.cliente_nombre;
    loadDiscountFromItems();
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
    cliente_telefono = '';
    cliente_taller = '';
    cliente_estudiante = '';
    envio = 0;
    tipo_entrega = 'Retira';
    fecha_entrega = '';
    items = Array.from({ length: 7 }, () => ({ cantidad: 1, descripcion: '', precio_unitario: 0, total: 0 }));
    productSearch = Array.from({ length: 7 }, () => '');
    selectedProdIndex = Array.from({ length: 7 }, () => -1);
    showProdResults = Array.from({ length: 7 }, () => false);
    productSuggestions = Array.from({ length: 7 }, () => []);
    pagoRapidoMonto = 0;
    pagoRapidoAplicado = false;
    clienteSearch = '';
    selectedClienteIndex = -1;
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
            estudiante: cliente_estudiante,
          });
          cliente_id = result.id;
          clientes = [...clientes, { id: result.id, nombre: cliente_nombre, domicilio: cliente_domicilio, telefono: cliente_telefono, taller: cliente_taller || '', estudiante: cliente_estudiante || '' }];
        }
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
      facturas = await cacheStore.fetch('facturas:historico', () => api.listFacturas({ limit: 2000 }), 60000);
    } catch {
      facturas = [];
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
        items: items.map(i => ({
          cantidad: i.cantidad,
          descripcion: i.descripcion,
          precio_unitario: i.precio_unitario ?? 0,
          total: i.total || (i.cantidad * (i.precio_unitario ?? 0)),
        })),
        total: totalConEnvio,
        envio,
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
          total: i.total || i.cantidad * (i.precio_unitario ?? 0),
        })),
        total: totalConEnvio,
        envio,
        mode: tipo,
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
              <div class="icon-input-wrap">
                <input type="text" bind:value={cliente_domicilio} placeholder="Domicilio" class="input-with-icon-left" />
                <svg class="input-icon-left" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              </div>
            </div>
            <div class="field flex-1">
              <div class="icon-input-wrap">
                <input type="text" bind:value={cliente_taller} placeholder="Taller" class="input-with-icon-left" />
                <svg class="input-icon-left" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 00 0 1.4l1.6 1.6a1 1 0 00 1.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
              </div>
            </div>
            <div class="field flex-1">
              <div class="icon-input-wrap">
                <input type="text" bind:value={cliente_estudiante} placeholder="Estudiante / Galería" class="input-with-icon-left" />
                <svg class="input-icon-left" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
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
              <span class="col-del"></span>
            </div>
            <div class="items-body">
            {#each items as item, i}
              <div class="items-row">
                <select class="col-qty" bind:value={item.cantidad} onchange={() => updateItemTotal(i)}>
                  {#each cantidades as c}
                    <option value={c}>{c}</option>
                  {/each}
                </select>
                <div class="autocomplete-wrap col-desc">
                  <input
                    type="text"
                    bind:value={productSearch[i]}
                    oninput={() => {
                      items[i].descripcion = productSearch[i];
                      items = items;
                      const filtered = smartProductSearch(productSearch[i], productos);
                      const { dims: qDims } = getBaseAndDims(productSearch[i]);
                      const hasExact = qDims.size > 0 && filtered.some(p => {
                        const { dims: pDims } = getBaseAndDims(p.descripcion);
                        return [...qDims].every(d => pDims.has(d));
                      });
                      productSuggestions[i] = hasExact ? [] : suggestPrice(productSearch[i], productos);
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
                <span class="col-total">${(item.total || item.cantidad * (item.precio_unitario ?? 0)).toFixed(0)}</span>
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
        <div class="modal modal-price" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && cancelPriceAdjust()}>
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
              <input type="number" bind:value={priceAdjustValue} min="0" step="1" class="price-final-input" />
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
        <button class="trash-btn" onclick={deleteCurrentInvoice} title="Eliminar factura actual"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
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
              <span class="history-date">{f.fecha || ''}</span>
            </div>
            <div class="history-client">{f.cliente_nombre || 'Sin cliente'}</div>
            <div class="history-total">${(f.total || 0).toFixed(0)}</div>
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
    color: #d97706;
    font-weight: 600;
    margin-left: 0.429rem;
    white-space: nowrap;
  }
  .autocomplete-item .prod-tag.estimated {
    color: #2563eb;
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
    grid-template-columns: 3.143rem 1fr 5.714rem 6.429rem 2.286rem;
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
    grid-template-columns: 3.143rem 1fr 5.714rem 6.429rem 2.286rem;
    gap: 0.571rem;
    align-items: center;
    padding: 0.429rem 0.857rem;
    border-bottom: 0.071rem solid var(--border-light);
    transition: background 0.12s;
  }
  .items-row:hover { background: var(--bg-hover); }
  .items-row:last-child { border-bottom: none; }

  .col-qty { width: auto; }
  .col-desc { width: auto; min-width: 0; position: relative; }
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
  .col-del { width: auto; text-align: center; }

  .items-row select {
    width: 100%;
    padding: 0.357rem 0.143rem;
    border: 1.5px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
    font-weight: 600;
    background: var(--bg-card);
    color: var(--text-primary);
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
    cursor: pointer;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .items-row select:focus {
    border-color: var(--border-focus);
    box-shadow: 0 0 0 0.214rem rgba(37,99,235,0.12);
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
  }
  .items-row .col-desc input {
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
    color: #1a1d23;
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
    color: #22c55e;
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
    background: #16a34a;
    color: #fff;
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
    color: #16a34a;
  }
  .payment-applied-value {
    font-size: var(--text-base);
    font-weight: 700;
    color: #15803d;
    font-family: var(--font-mono);
  }

  /* === Delivery Section === */
  .delivery-sticky {
    flex-shrink: 0;
    background: white;
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
    background: white;
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
    background: white;
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
    background: white;
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
    background: white;
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
    background: #f0f2f5;
    border-left: 0.143rem solid #d0d3d9;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .history-header {
    padding: 1rem 1.143rem 0.714rem;
  }
  .history-header h3 {
    margin: 0;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
  }
  .trash-btn {
    background: none;
    border: none;
    color: #bbb;
    cursor: pointer;
    padding: 0.143rem 0.286rem;
    border-radius: 0.286rem;
    transition: color 0.12s;
    display: flex;
    align-items: center;
  }
  .trash-btn:hover { color: #e74c3c; }

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
    color: #3498db;
    font-weight: 600;
  }
  .top-btn-molduras {
    font-size: 0.78rem;
    padding: 0.214rem 0.571rem;
    border: 0.071rem solid var(--border);
    background: #fff;
    color: var(--text-primary);
    cursor: pointer;
    border-radius: var(--radius-sm);
    white-space: nowrap;
    transition: all 0.12s;
  }
  .top-btn-molduras:hover { background: var(--bg-hover); border-color: #3498db; }
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
    background: white;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
    border: 0.071rem solid #e8eaed;
  }
  .history-item:hover { border-color: #c8ccd0; }
  .history-item.active {
    background: var(--accent-light);
    border-left-color: var(--accent);
    border-color: var(--accent);
  }
  .history-item.selected {
    background: #eef2ff;
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
  .history-empty {
    padding: 1.714rem 1.143rem;
    text-align: center;
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .loading-overlay {
    position: absolute;
    inset: 0;
    background: rgba(255,255,255,0.85);
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

</style>
