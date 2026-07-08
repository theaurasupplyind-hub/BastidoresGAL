<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import type { Provider, ProviderMovement } from '$lib/types';

  // ── Grid state ──
  let providers = $state<Provider[]>([]);
  let providerSearch = $state('');
  let providerMovesMap = $state<Map<number, ProviderMovement[]>>(new Map());

  let filteredProviders = $derived.by(() => {
    const q = providerSearch.toLowerCase();
    if (!q) return providers;
    return providers.filter(p => p.name.toLowerCase().includes(q));
  });

  interface CardInfo {
    debt: number;
    stockQty: number;
    lastMoveDesc: string;
  }
  let cardsInfo = $state<Map<number, CardInfo>>(new Map());

  // ── Detail view state ──
  let viewMode: 'grid' | 'detail' = $state('grid');
  let selectedProvider = $state<Provider | null>(null);
  let providerMoves = $state<ProviderMovement[]>([]);
  let timelineFilter: 'Todo' | 'Financiero' | 'Stock' = $state('Todo');

  let filteredMoves = $derived.by(() => {
    if (timelineFilter === 'Todo') return providerMoves;
    if (timelineFilter === 'Financiero') return providerMoves.filter(m => m.type === 'PURCHASE' || m.type === 'PAYMENT');
    return providerMoves.filter(m => m.type === 'STOCK_IN' || m.type === 'STOCK_OUT');
  });

  let transMoves = $derived(filteredMoves.filter(m => !(m.description || '').toLowerCase().includes('efectivo')));
  let cashMoves = $derived(filteredMoves.filter(m => (m.description || '').toLowerCase().includes('efectivo')));

  let transTotal = $derived.by(() => {
    let total = 0;
    for (const m of transMoves) {
      if (m.type === 'PURCHASE') total += m.amount;
      else if (m.type === 'PAYMENT') total -= m.amount;
    }
    return total;
  });

  let cashTotal = $derived.by(() => {
    let total = 0;
    for (const m of cashMoves) {
      if (m.type === 'PURCHASE') total += m.amount;
      else if (m.type === 'PAYMENT') total -= m.amount;
    }
    return total;
  });

  let detailDebt = $derived(
    providerMoves.filter(m => m.type === 'PURCHASE').reduce((s, m) => s + (m.amount || 0), 0)
    - providerMoves.filter(m => m.type === 'PAYMENT').reduce((s, m) => s + (m.amount || 0), 0)
  );

  let detailStock = $derived(
    providerMoves.filter(m => m.type === 'STOCK_IN').reduce((s, m) => s + (m.quantity || 0), 0)
    - providerMoves.filter(m => m.type === 'STOCK_OUT').reduce((s, m) => s + (m.quantity || 0), 0)
  );

  // ── Modal state ──
  let showProviderForm = $state(false);
  let providerForm = $state<{ id: number | null; name: string; cuit: string; alias_mp: string; alias_cbu: string; address: string }>({ id: null, name: '', cuit: '', alias_mp: '', alias_cbu: '', address: '' });
  let showMoveForm = $state(false);
  let moveForm = $state<{ id: number | null; type: string; description: string; amount: number; quantity: number; date: string }>({ id: null, type: 'PURCHASE', description: '', amount: 0, quantity: 0, date: '' });

  // ── Utilities ──
  function formatCurrency(n: number): string {
    return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2 });
  }

  function formatDate(d: string): string {
    if (!d) return '';
    const p = d.split('-');
    if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
    return d;
  }

  function invalidateCache() {
    cacheStore.invalidate('providers');
    cacheStore.invalidate('provider:moves');
  }

  function moveTypeLabel(type: string): string {
    switch (type) {
      case 'PURCHASE': return 'COMPRA';
      case 'PAYMENT': return 'PAGO';
      case 'STOCK_IN': return 'STOCK+';
      case 'STOCK_OUT': return 'STOCK-';
      default: return type;
    }
  }

  function moveTypeClass(type: string): string {
    switch (type) {
      case 'PURCHASE': return 'type-purchase';
      case 'PAYMENT': return 'type-payment';
      case 'STOCK_IN': return 'type-stockin';
      case 'STOCK_OUT': return 'type-stockout';
      default: return '';
    }
  }

  // ── Load ──
  onMount(() => { loadData(); });

  async function loadData() {
    try {
      providers = await cacheStore.fetch('providers', () => api.listProviders(), 900000);
      const movesMap = new Map<number, ProviderMovement[]>();
      const infoMap = new Map<number, CardInfo>();
      for (const p of providers) {
        try {
          const detail = await api.getProvider(p.id);
          const moves: ProviderMovement[] = detail?.movements || [];
          movesMap.set(p.id, moves);
          const purchases = moves.filter(m => m.type === 'PURCHASE').reduce((s, m) => s + (m.amount || 0), 0);
          const payments = moves.filter(m => m.type === 'PAYMENT').reduce((s, m) => s + (m.amount || 0), 0);
          const lastMove = moves.length > 0 ? moves[0] : null;
          infoMap.set(p.id, {
            debt: purchases - payments,
            stockQty: moves.filter(m => m.type === 'STOCK_IN').reduce((s, m) => s + (m.quantity || 0), 0)
                     - moves.filter(m => m.type === 'STOCK_OUT').reduce((s, m) => s + (m.quantity || 0), 0),
            lastMoveDesc: lastMove ? `${moveTypeLabel(lastMove.type)}: ${lastMove.description || ''}` : 'Sin movimientos',
          });
        } catch {}
      }
      providerMovesMap = movesMap;
      cardsInfo = infoMap;
    } catch {}
  }

  // ── Detail ──
  function openDetail(p: Provider) {
    selectedProvider = p;
    const moves = providerMovesMap.get(p.id) || [];
    providerMoves = [...moves].reverse();
    viewMode = 'detail';
    timelineFilter = 'Todo';
  }

  function closeDetail() {
    viewMode = 'grid';
    selectedProvider = null;
    providerMoves = [];
  }

  async function refreshDetail() {
    if (!selectedProvider) return;
    try {
      const detail = await api.getProvider(selectedProvider.id);
      providerMoves = [...(detail?.movements || [])].reverse();
      providerMovesMap.set(selectedProvider.id, detail?.movements || []);
    } catch {}
  }

  // ── Provider CRUD ──
  function openNewProvider() {
    providerForm = { id: null, name: '', cuit: '', alias_mp: '', alias_cbu: '', address: '' };
    showProviderForm = true;
  }

  function openEditProvider() {
    if (!selectedProvider) return;
    providerForm = { id: selectedProvider.id, name: selectedProvider.name, cuit: selectedProvider.cuit, alias_mp: selectedProvider.alias_mp, alias_cbu: selectedProvider.alias_cbu, address: selectedProvider.address };
    showProviderForm = true;
  }

  async function saveProvider() {
    try {
      if (providerForm.id) {
        await api.updateProvider(providerForm.id, providerForm);
      } else {
        await api.addProvider(providerForm);
      }
      showProviderForm = false;
      invalidateCache();
      await loadData();
    } catch (e) {
      appStore.alert('Error al guardar: ' + (e as Error).message);
    }
  }

  async function deleteProvider(id: number) {
    if (!confirm('¿Eliminar este proveedor definitivamente?')) return;
    try {
      await api.deleteProvider(id);
      if (selectedProvider?.id === id) { closeDetail(); }
      invalidateCache();
      await loadData();
    } catch (e) {
      appStore.alert('Error al eliminar: ' + (e as Error).message);
    }
  }

  // ── Movement CRUD ──
  function openNewMove(type: string) {
    moveForm = { id: null, type, description: '', amount: 0, quantity: 0, date: new Date().toISOString().slice(0, 10) };
    showMoveForm = true;
  }

  async function saveMove() {
    if (!selectedProvider) return;
    try {
      await api.addProviderMovement({
        provider_id: selectedProvider.id,
        date: moveForm.date,
        type: moveForm.type,
        description: moveForm.description,
        amount: moveForm.amount,
        quantity: ['STOCK_IN', 'STOCK_OUT'].includes(moveForm.type) ? moveForm.quantity : undefined,
        reference: '',
      });
      showMoveForm = false;
      invalidateCache();
      await refreshDetail();
      await loadData();
    } catch (e) {
      appStore.alert('Error al guardar movimiento: ' + (e as Error).message);
    }
  }

  async function deleteMove(id: number) {
    if (!confirm('¿Eliminar este movimiento?')) return;
    try {
      await api.deleteProviderMovement(id);
      invalidateCache();
      await refreshDetail();
      await loadData();
    } catch (e) {
      appStore.alert('Error: ' + (e as Error).message);
    }
  }
</script>

<!-- ============ GRID VIEW ============ -->
{#if viewMode === 'grid'}
  <div class="pp-grid">
    <div class="pp-grid-header">
      <h3>📂 Carpetas de Proveedores</h3>
      <div class="pp-grid-toolbar">
        <div class="pp-search-wrap">
          <input type="text" bind:value={providerSearch} placeholder="Buscar proveedor..." class="pp-search" />
        </div>
        <button class="btn btn-sm btn-primary" onclick={openNewProvider}>➕ Nuevo</button>
      </div>
    </div>
    <div class="pp-cards-grid">
      {#each filteredProviders as p}
        {@const info = cardsInfo.get(p.id)}
        {@const debt = info?.debt ?? 0}
        <div class="pp-card">
          <div class="pp-card-header">
            <span class="pp-card-title">{p.name}</span>
            <button class="pp-act-del" onclick={() => deleteProvider(p.id)} title="Eliminar">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>
          <div class="pp-card-body">
            <div class="pp-card-row">
              <span class="pp-debt">{formatCurrency(debt)}</span>
              <span class="pp-stock">{info?.stockQty ?? 0} u.</span>
            </div>
            <div class="pp-card-chips">
              {#if p.cuit}<span class="pp-chip"><span class="pp-chip-label">CUIT</span> {p.cuit}</span>{/if}
              {#if p.alias_mp}<span class="pp-chip"><span class="pp-chip-label">MP</span> {p.alias_mp}</span>{/if}
              {#if p.alias_cbu}<span class="pp-chip"><span class="pp-chip-label">CBU</span> {p.alias_cbu}</span>{/if}
              {#if p.address}<span class="pp-chip"><span class="pp-chip-label">Dir</span> {p.address}</span>{/if}
            </div>
            <div class="pp-lastmove"><span class="pp-lastmove-label">Ultimo</span> {info?.lastMoveDesc ?? 'Sin movimientos'}</div>
          </div>
          <div class="pp-card-actions">
            <button class="pp-act-btn pp-act-folder" onclick={() => openDetail(p)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
              Abrir
            </button>
            <button class="pp-act-btn pp-act-pay" onclick={() => { selectedProvider = p; openNewMove('PAYMENT'); }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
              Pago
            </button>
          </div>
        </div>
      {:else}
        <div class="pp-empty">Sin proveedores registrados</div>
      {/each}
    </div>
  </div>

<!-- ============ DETAIL VIEW ============ -->
{:else if viewMode === 'detail' && selectedProvider}
  <div class="pp-detail">
    <div class="pp-detail-nav">
      <button class="btn btn-sm btn-secondary" onclick={closeDetail}>⬅ Volver</button>
      <h3>🏢 {selectedProvider.name}</h3>
      <div class="pp-detail-nav-actions">
        <button class="btn btn-xs btn-secondary" onclick={openEditProvider}>✏️ Editar</button>
        <button class="btn btn-xs btn-danger" onclick={() => deleteProvider(selectedProvider.id)}>🗑</button>
      </div>
    </div>

    <div class="pp-detail-cols">
      <!-- LEFT: Summary -->
      <div class="pp-detail-left">
        <div class="pp-card-section">
          <h4>📊 Resumen</h4>
          <div class="pp-summary-block">
            <span class="pp-summary-label">💰 Deuda</span>
            <span class="pp-summary-value" style="color:{detailDebt > 0 ? '#dc3545' : '#28a745'}; font-size:1.4rem">{formatCurrency(detailDebt)}</span>
            <span style="font-size:0.75rem;color:#999">{detailDebt > 0 ? '🔴 Pendiente' : '🟢 Al día'}</span>
          </div>
          <div class="pp-summary-block">
            <span class="pp-summary-label">📦 Stock</span>
            <span class="pp-summary-value">{detailStock} unid.</span>
          </div>
          <hr class="pp-divider" />
          <div class="pp-summary-block">
            <span class="pp-summary-label">📇 Datos</span>
            {#if selectedProvider.cuit}<span class="pp-summary-data">CUIT: {selectedProvider.cuit}</span>{/if}
            {#if selectedProvider.alias_mp}<span class="pp-summary-data">Alias MP: {selectedProvider.alias_mp}</span>{/if}
            {#if selectedProvider.alias_cbu}<span class="pp-summary-data">Alias CBU: {selectedProvider.alias_cbu}</span>{/if}
            {#if selectedProvider.address}<span class="pp-summary-data">Dirección: {selectedProvider.address}</span>{/if}
          </div>
        </div>
      </div>

      <!-- CENTER: Timeline -->
      <div class="pp-detail-center">
        <div class="pp-timeline-header">
          <h4>📋 Timeline</h4>
          <div class="pp-timeline-filter">
            {#each ['Todo', 'Financiero', 'Stock'] as f}
              <button
                class="pp-filter-btn"
                class:active={timelineFilter === f}
                onclick={() => timelineFilter = f}
              >{f}</button>
            {/each}
          </div>
        </div>
        <div class="pp-timeline-panels">
          <div class="pp-timeline-panel">
            <div class="pp-panel-header">
              <span>🏦 Transferencias</span>
              <span class="pp-panel-total" class:positive={transTotal >= 0} class:negative={transTotal < 0}>
                {transTotal >= 0 ? '+' : ''}{formatCurrency(transTotal)}
              </span>
            </div>
            <div class="pp-panel-scroll">
              {#each transMoves as m, i}
                <div class="pp-move-item" class:pp-move-alt={i % 2 === 1}>
                  <div class="pp-move-top">
                    <span class="pp-move-date">{formatDate(m.date)}</span>
                    <span class="pp-move-type-badge {moveTypeClass(m.type)}">{moveTypeLabel(m.type)}</span>
                    <span class="pp-move-amount" class:positive={m.type === 'PURCHASE'} class:negative={m.type === 'PAYMENT'}>
                      {m.type === 'PAYMENT' ? '-' : '+'}{formatCurrency(m.amount)}
                    </span>
                    <div class="pp-move-actions">
                      <button class="pp-move-btn pp-move-del" onclick={() => deleteMove(m.id)} title="Eliminar">🗑</button>
                    </div>
                  </div>
                  <div class="pp-move-desc">{m.description || '—'}</div>
                </div>
              {:else}
                <div class="pp-panel-empty">Sin movimientos</div>
              {/each}
            </div>
          </div>
          <div class="pp-timeline-panel">
            <div class="pp-panel-header">
              <span>💵 Efectivo</span>
              <span class="pp-panel-total" class:positive={cashTotal >= 0} class:negative={cashTotal < 0}>
                {cashTotal >= 0 ? '+' : ''}{formatCurrency(cashTotal)}
              </span>
            </div>
            <div class="pp-panel-scroll">
              {#each cashMoves as m, i}
                <div class="pp-move-item" class:pp-move-alt={i % 2 === 1}>
                  <div class="pp-move-top">
                    <span class="pp-move-date">{formatDate(m.date)}</span>
                    <span class="pp-move-type-badge {moveTypeClass(m.type)}">{moveTypeLabel(m.type)}</span>
                    <span class="pp-move-amount" class:positive={m.type === 'PURCHASE'} class:negative={m.type === 'PAYMENT'}>
                      {m.type === 'PAYMENT' ? '-' : '+'}{formatCurrency(m.amount)}
                    </span>
                    <div class="pp-move-actions">
                      <button class="pp-move-btn pp-move-del" onclick={() => deleteMove(m.id)} title="Eliminar">🗑</button>
                    </div>
                  </div>
                  <div class="pp-move-desc">{m.description || '—'}</div>
                </div>
              {:else}
                <div class="pp-panel-empty">Sin movimientos</div>
              {/each}
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT: Actions -->
      <div class="pp-detail-right">
        <div class="pp-card-section">
          <h4>⚡ Acciones</h4>
          <button class="pp-action-btn pp-action-pay" onclick={() => openNewMove('PAYMENT')}>💸 Pago Rápido</button>
          <button class="pp-action-btn pp-action-buy" onclick={() => openNewMove('PURCHASE')}>🛒 Compra Nueva</button>
          <button class="pp-action-btn pp-action-stock" onclick={() => openNewMove('STOCK_IN')}>📦 Entrada Stock</button>
          <hr class="pp-divider" />
          <button class="pp-action-btn pp-action-edit" onclick={openEditProvider}>✏️ Editar Datos</button>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- ============ PROVIDER FORM MODAL ============ -->
{#if showProviderForm}
  <div class="modal-overlay" onclick={() => showProviderForm = false} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (showProviderForm = false)}>
      <h3>{providerForm.id ? 'Editar' : 'Nuevo'} Proveedor</h3>
      <div class="modal-body">
        <div class="form-group"><label>Nombre</label><input type="text" bind:value={providerForm.name} /></div>
        <div class="form-group"><label>CUIT</label><input type="text" bind:value={providerForm.cuit} /></div>
        <div class="form-group"><label>Alias MP</label><input type="text" bind:value={providerForm.alias_mp} /></div>
        <div class="form-group"><label>Alias CBU</label><input type="text" bind:value={providerForm.alias_cbu} /></div>
        <div class="form-group"><label>Dirección</label><input type="text" bind:value={providerForm.address} /></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={() => showProviderForm = false}>Cancelar</button>
        <button class="btn btn-primary" onclick={saveProvider}>Guardar</button>
      </div>
    </div>
  </div>
{/if}

<!-- ============ MOVEMENT FORM MODAL ============ -->
{#if showMoveForm}
  <div class="modal-overlay" onclick={() => showMoveForm = false} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (showMoveForm = false)}>
      <h3>Nuevo {moveForm.type === 'PAYMENT' ? 'Pago' : moveForm.type === 'PURCHASE' ? 'Compra' : moveForm.type === 'STOCK_IN' ? 'Entrada Stock' : 'Movimiento'}</h3>
      <div class="modal-body">
        <div class="form-group"><label>Fecha</label><input type="date" bind:value={moveForm.date} /></div>
        <div class="form-group"><label>Descripción</label><input type="text" bind:value={moveForm.description} /></div>
        {#if ['PURCHASE', 'PAYMENT'].includes(moveForm.type)}
          <div class="form-group"><label>Monto</label><input type="number" bind:value={moveForm.amount} step="0.01" /></div>
        {/if}
        {#if ['STOCK_IN', 'STOCK_OUT'].includes(moveForm.type)}
          <div class="form-group"><label>Cantidad</label><input type="number" bind:value={moveForm.quantity} step="0.01" /></div>
        {/if}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={() => showMoveForm = false}>Cancelar</button>
        <button class="btn btn-primary" onclick={saveMove}>Guardar</button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* ============ GRID VIEW ============ */
  .pp-grid { display: flex; flex-direction: column; gap: 0.714rem; flex: 1; min-height: 0; }
  .pp-grid-header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.571rem; }
  .pp-grid-header h3 { margin: 0; font-size: 1.05rem; color: #2c3e50; }
  .pp-grid-toolbar { display: flex; gap: 0.429rem; align-items: center; }
  .pp-search-wrap { position: relative; }
  .pp-search {
    padding: 0.357rem 0.571rem;
    border: 1px solid #ddd;
    border-radius: 0.357rem;
    font-size: 0.82rem;
    width: 12rem;
  }

  .pp-cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr));
    gap: 0.714rem;
    overflow: auto;
    flex: 1;
    align-content: start;
  }

  .pp-card {
    background: white;
    border: 1px solid #e5e7eb;
    border-radius: 0.571rem;
    display: flex;
    flex-direction: column;
  }

  .pp-card-header {
    display: flex;
    align-items: center;
    gap: 0.429rem;
    padding: 0.857rem 1rem 0.286rem;
  }
  .pp-card-title { font-weight: 600; font-size: 1.05rem; color: #2c3e50; flex: 1; }

  .pp-card-body { padding: 0.286rem 1rem 0.714rem; flex: 1; }

  .pp-card-row {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 0.571rem;
    margin-bottom: 0.357rem;
  }
  .pp-debt { font-size: 1.5rem; font-weight: 700; color: #2c3e50; }
  .pp-stock { font-size: 0.8rem; color: #999; }

  .pp-card-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.143rem 0.571rem;
    margin: 0.429rem 0;
  }
  .pp-chip {
    font-size: 0.72rem;
    color: #555;
  }
  .pp-chip-label {
    color: #888;
    margin-right: 0.286rem;
    font-weight: 500;
  }

  .pp-lastmove {
    font-size: 0.72rem;
    color: #999;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    margin-top: 0.286rem;
  }
  .pp-lastmove-label {
    color: #bbb;
    margin-right: 0.214rem;
  }

  .pp-card-actions {
    display: flex;
    align-items: center;
    gap: 0.357rem;
    padding: 0.571rem 1rem;
    border-top: 1px solid #f0f0f0;
  }

  .pp-act-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.286rem;
    flex: 1;
    padding: 0.429rem 0.571rem;
    border: 1px solid #ddd;
    border-radius: 0.286rem;
    background: white;
    font-size: 0.78rem;
    font-weight: 500;
    cursor: pointer;
    color: #555;
    font-family: inherit;
    transition: background 0.1s, border-color 0.1s;
  }
  .pp-act-btn:hover { background: #f5f6fa; border-color: #bbb; }
  .pp-act-btn svg { flex-shrink: 0; }

  .pp-act-del {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    height: 1.6rem;
    padding: 0;
    border: none;
    border-radius: 0.286rem;
    background: none;
    cursor: pointer;
    color: #ccc;
    flex-shrink: 0;
    transition: color 0.1s, background 0.1s;
  }
  .pp-card:hover .pp-act-del { color: #e74c3c; }
  .pp-act-del:hover { background: #fff5f5; color: #e74c3c !important; }

  .pp-empty {
    grid-column: 1 / -1;
    padding: 2rem;
    text-align: center;
    color: #bbb;
    font-size: 0.85rem;
  }

  /* ============ DETAIL VIEW ============ */
  .pp-detail {
    display: flex;
    flex-direction: column;
    gap: 0.571rem;
    flex: 1;
    min-height: 0;
  }

  .pp-detail-nav {
    display: flex;
    align-items: center;
    gap: 0.714rem;
    padding: 0.571rem 0.857rem;
    background: white;
    border-radius: 0.571rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }
  .pp-detail-nav h3 { margin: 0; font-size: 1rem; color: #2c3e50; flex: 1; }
  .pp-detail-nav-actions { display: flex; gap: 0.286rem; }

  .pp-detail-cols {
    display: grid;
    grid-template-columns: 14rem 1fr 12rem;
    gap: 0.571rem;
    flex: 1;
    min-height: 0;
  }

  /* LEFT */
  .pp-detail-left { display: flex; flex-direction: column; gap: 0.571rem; }
  .pp-card-section {
    background: white;
    border-radius: 0.571rem;
    padding: 0.714rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }
  .pp-card-section h4 { margin: 0 0 0.571rem; font-size: 0.78rem; color: #888; font-weight: 600; }
  .pp-summary-block { display: flex; flex-direction: column; gap: 0.143rem; margin-bottom: 0.571rem; }
  .pp-summary-label { font-size: 0.65rem; text-transform: uppercase; color: #999; font-weight: 600; }
  .pp-summary-value { font-size: 1.1rem; font-weight: 700; color: #2c3e50; }
  .pp-summary-data { font-size: 0.75rem; color: #666; }
  .pp-divider { border: none; border-top: 1px solid #eee; margin: 0.571rem 0; }

  /* CENTER */
  .pp-detail-center {
    display: flex;
    flex-direction: column;
    gap: 0.429rem;
    min-height: 0;
  }

  .pp-timeline-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    background: white;
    border-radius: 0.571rem;
    padding: 0.571rem 0.714rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }
  .pp-timeline-header h4 { margin: 0; font-size: 0.82rem; color: #2c3e50; }
  .pp-timeline-filter { display: flex; gap: 0.143rem; }
  .pp-filter-btn {
    padding: 0.214rem 0.571rem;
    border: 1px solid #ddd;
    background: white;
    border-radius: 0.286rem;
    font-size: 0.72rem;
    cursor: pointer;
    color: #666;
    font-family: inherit;
  }
  .pp-filter-btn:hover { background: #f0f0f0; }
  .pp-filter-btn.active { background: #3498db; color: white; border-color: #3498db; }

  .pp-timeline-panels {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.429rem;
    flex: 1;
    min-height: 0;
  }

  .pp-timeline-panel {
    background: white;
    border-radius: 0.571rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  .pp-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0.714rem;
    border-bottom: 2px solid #eee;
    font-size: 0.78rem;
    font-weight: 600;
    color: #555;
    flex-shrink: 0;
  }
  .pp-panel-total { font-family: monospace; font-size: 0.82rem; }
  .pp-panel-total.positive { color: #dc3545; }
  .pp-panel-total.negative { color: #28a745; }
  .pp-panel-scroll { flex: 1; overflow: auto; padding: 0.286rem 0.429rem; }

  .pp-move-item {
    padding: 0.357rem 0.429rem;
    border-bottom: 1px solid #f5f5f5;
    font-size: 0.75rem;
  }
  .pp-move-alt { background: #fafbfc; }
  .pp-move-top { display: flex; align-items: center; gap: 0.357rem; }
  .pp-move-date { font-family: monospace; font-size: 0.68rem; color: #888; min-width: 3rem; }
  .pp-move-type-badge {
    font-size: 0.6rem;
    font-weight: 600;
    padding: 0.071rem 0.357rem;
    border-radius: 0.214rem;
    min-width: 2.5rem;
    text-align: center;
  }
  .type-purchase { background: #fff3cd; color: #856404; }
  .type-payment { background: #d4edda; color: #155724; }
  .type-stockin { background: #cce5ff; color: #004085; }
  .type-stockout { background: #f8d7da; color: #721c24; }

  .pp-move-amount { font-family: monospace; font-weight: 700; font-size: 0.78rem; margin-left: auto; }
  .pp-move-amount.positive { color: #dc3545; }
  .pp-move-amount.negative { color: #28a745; }
  .pp-move-actions { display: flex; gap: 0.143rem; flex-shrink: 0; }
  .pp-move-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.72rem;
    padding: 0.071rem 0.143rem;
    opacity: 0.4;
    transition: opacity 0.1s;
  }
  .pp-move-item:hover .pp-move-btn { opacity: 1; }
  .pp-move-del:hover { opacity: 1; }
  .pp-move-desc { font-size: 0.72rem; color: #666; margin-top: 0.071rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pp-panel-empty { padding: 1rem; text-align: center; color: #ccc; font-size: 0.78rem; }

  /* RIGHT */
  .pp-detail-right { display: flex; flex-direction: column; gap: 0.571rem; }
  .pp-action-btn {
    display: block;
    width: 100%;
    padding: 0.571rem;
    border: none;
    border-radius: 0.357rem;
    font-size: 0.82rem;
    font-weight: 600;
    cursor: pointer;
    text-align: center;
    font-family: inherit;
    margin-bottom: 0.357rem;
    transition: opacity 0.12s;
  }
  .pp-action-btn:hover { opacity: 0.85; }
  .pp-action-pay { background: #ffc107; color: #333; }
  .pp-action-buy { background: #dc3545; color: white; }
  .pp-action-stock { background: #28a745; color: white; }
  .pp-action-edit { background: #6c757d; color: white; }
</style>
