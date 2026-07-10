import type { TabId } from '$lib/types';

let _currentUser = $state<{ user_id: number; user_name: string } | null>(null);
let _currentTab = $state<TabId>('kanban');
let _isLoading = $state(false);
let _toast = $state<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
let _dirtyTabs = $state<Set<TabId>>(new Set());
let _onlineCount = $state(0);
let _showSettings = $state(false);
let _showPreciosRef = $state(false);

// Facturacion shared state for top-bar actions
let _facturacionSaving = $state(false);
let _facturacionTipo = $state<'PRESUPUESTO' | 'BORRADOR'>('PRESUPUESTO');
let _facturacionHasId = $state(false);
let _pdfStyle = $state('Original');
let _molduraTemplate = $state('clasico');

// Ficha Semanal filter state
let _fsStartDate = $state('');
let _fsEndDate = $state('');
let _fsFilterCliente = $state('');
let _fsFilterEstado = $state('TODOS');
let _fsFilterEntrega = $state('TODOS');
let _kanbanSelectedCount = $state(0);
let _pendingInvoiceId = $state<number | null>(null);

export const appStore = {
  get user() { return _currentUser; },
  set user(v) { _currentUser = v; },

  get currentTab() { return _currentTab; },
  set currentTab(v: TabId) { _currentTab = v; },

  get isLoading() { return _isLoading; },
  set isLoading(v: boolean) { _isLoading = v; },

  get toast() { return _toast; },
  set toast(v) { _toast = v; },

  get dirtyTabs() { return _dirtyTabs; },
  set dirtyTabs(v) { _dirtyTabs = v; },

  get onlineCount() { return _onlineCount; },
  set onlineCount(v: number) { _onlineCount = v; },

  get showSettings() { return _showSettings; },
  set showSettings(v: boolean) { _showSettings = v; },

  get showPreciosRef() { return _showPreciosRef; },
  set showPreciosRef(v: boolean) { _showPreciosRef = v; },

  get facturacionSaving() { return _facturacionSaving; },
  set facturacionSaving(v: boolean) { _facturacionSaving = v; },

  get facturacionTipo() { return _facturacionTipo; },
  set facturacionTipo(v: 'PRESUPUESTO' | 'BORRADOR') { _facturacionTipo = v; },

  get facturacionHasId() { return _facturacionHasId; },
  set facturacionHasId(v: boolean) { _facturacionHasId = v; },

  get pdfStyle() { return _pdfStyle; },
  set pdfStyle(v: string) { _pdfStyle = v; },

  get molduraTemplate() { return _molduraTemplate; },
  set molduraTemplate(v: string) { _molduraTemplate = v; },

  get fsStartDate() { return _fsStartDate; },
  set fsStartDate(v: string) { _fsStartDate = v; },
  get fsEndDate() { return _fsEndDate; },
  set fsEndDate(v: string) { _fsEndDate = v; },
  get fsFilterCliente() { return _fsFilterCliente; },
  set fsFilterCliente(v: string) { _fsFilterCliente = v; },
  get fsFilterEstado() { return _fsFilterEstado; },
  set fsFilterEstado(v: string) { _fsFilterEstado = v; },
  get fsFilterEntrega() { return _fsFilterEntrega; },
  set fsFilterEntrega(v: string) { _fsFilterEntrega = v; },

  get kanbanSelectedCount() { return _kanbanSelectedCount; },
  set kanbanSelectedCount(v: number) { _kanbanSelectedCount = v; },

  get pendingInvoiceId() { return _pendingInvoiceId; },
  set pendingInvoiceId(v: number | null) { _pendingInvoiceId = v; },

  showToast(message: string, type: 'success' | 'error' | 'info' = 'success') {
    _toast = { message, type };
    setTimeout(() => { _toast = null; }, 3000);
  },

  alert(message: string) {
    _toast = { message, type: 'error' };
    setTimeout(() => { _toast = null; }, 5000);
  },

  markDirty(tab: TabId) {
    const s = new Set(_dirtyTabs);
    s.add(tab);
    _dirtyTabs = s;
  },
};
