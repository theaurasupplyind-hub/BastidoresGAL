<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { animate } from 'animejs';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import { byDateDesc } from '$lib/types';
  import type { Provider, ProviderMovement } from '$lib/types';
  import ProviderFolderCard from './ProviderFolderCard.svelte';
  import GIcon from './GIcon.svelte';

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

  interface MoveGroup {
    date: string;
    label: string;
    items: ProviderMovement[];
  }

  function groupByDate(moves: ProviderMovement[]): MoveGroup[] {
    const groups: MoveGroup[] = [];
    for (const m of moves) {
      const key = m.date || '';
      const last = groups[groups.length - 1];
      if (last && last.date === key) {
        last.items.push(m);
      } else {
        groups.push({ date: key, label: dayLabel(key), items: [m] });
      }
    }
    return groups;
  }

  let transGroups = $derived(groupByDate(transMoves));
  let cashGroups = $derived(groupByDate(cashMoves));

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

  function dayLabel(d: string): string {
    if (!d) return '';
    let parts = d.split('-').map(Number);
    if (parts.some(isNaN)) parts = d.split('/').map(Number).reverse();
    const [y, m, dd] = parts;
    if (!y || !m || !dd) return d;
    const dt = new Date(y, m - 1, dd);
    return dt.toLocaleString('es-AR', { day: 'numeric', month: 'long' });
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
          const sortedMoves = [...moves].sort((a, b) => byDateDesc(a.date, b.date, a.id, b.id));
          const lastMove = sortedMoves.length > 0 ? sortedMoves[0] : null;
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
  let detailEl: HTMLElement | undefined = $state();
  let detailClosing = $state(false);

  function panelEnter(node: HTMLElement) {
    animate(node, {
      translateY: [30, 0],
      opacity: [0, 1],
      duration: 420,
      ease: 'outBack',
    });
    const cols = node.querySelector<HTMLElement>('.pp-detail-cols');
    if (cols) {
      animate(Array.from(cols.children) as HTMLElement[], {
        translateY: [16, 0],
        opacity: [0, 1],
        duration: 340,
        ease: 'outBack',
        delay: (_el: unknown, i = 0) => i * 90 + 120,
      });
    }
    return {};
  }

  function openDetail(p: Provider) {
    selectedProvider = p;
    const moves = providerMovesMap.get(p.id) || [];
    providerMoves = [...moves].sort((a, b) => byDateDesc(a.date, b.date, a.id, b.id));
    viewMode = 'detail';
    timelineFilter = 'Todo';
  }

  function closeDetail() {
    if (detailClosing) return;
    if (!detailEl) { resetDetail(); return; }
    detailClosing = true;
    animate(detailEl, {
      translateY: [0, 24],
      opacity: [1, 0],
      duration: 220,
      ease: 'inQuad',
      complete: resetDetail,
    });
  }

  function resetDetail() {
    detailClosing = false;
    viewMode = 'grid';
    selectedProvider = null;
    providerMoves = [];
  }

  async function refreshDetail() {
    if (!selectedProvider) return;
    try {
      const detail = await api.getProvider(selectedProvider.id);
      providerMoves = [...(detail?.movements || [])].sort((a, b) => byDateDesc(a.date, b.date, a.id, b.id));
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
  <div class="pp-grid" transition:fade={{ duration: 120 }}>
    <div class="pp-grid-header">
      <h3><GIcon name="folder" size={16} /> Carpetas de Proveedores</h3>
      <div class="pp-grid-toolbar">
        <div class="pp-search-wrap">
          <input type="text" bind:value={providerSearch} placeholder="Buscar proveedor..." class="pp-search" />
        </div>
        <button class="btn btn-sm btn-primary" onclick={openNewProvider}><GIcon name="plus" size={13} /> Nuevo</button>
      </div>
    </div>
    <div class="pp-cards-grid">
      {#each filteredProviders as p (p.id)}
        <ProviderFolderCard
          provider={p}
          info={cardsInfo.get(p.id)}
          colorIndex={p.id}
          onOpenDetail={() => openDetail(p)}
          onPay={() => { selectedProvider = p; openNewMove('PAYMENT'); }}
          onPurchase={() => { selectedProvider = p; openNewMove('PURCHASE'); }}
        />
      {:else}
        <div class="pp-empty">Sin proveedores registrados</div>
      {/each}
    </div>
  </div>

<!-- ============ DETAIL VIEW ============ -->
{:else if viewMode === 'detail' && selectedProvider}
  <div class="pp-detail" bind:this={detailEl} use:panelEnter>
    <div class="pp-detail-nav">
      <button class="btn btn-sm btn-secondary" onclick={closeDetail}><GIcon name="arrow-left" size={13} /> Volver</button>
      <div class="pp-detail-nav-center">
        <h3><GIcon name="building" size={16} /> {selectedProvider.name}</h3>
        <div class="pp-nav-stats">
          <span class="pp-nav-debt" style="color:{detailDebt > 0 ? '#dc3545' : '#28a745'}">{formatCurrency(detailDebt)}</span>
          <span class="pp-nav-stock"><GIcon name="box" size={14} /> {detailStock} unid.</span>
        </div>
      </div>
      <div class="pp-detail-nav-actions">
        <button class="btn btn-xs btn-secondary" onclick={openEditProvider}><GIcon name="edit" size={13} /> Editar</button>
        <button class="btn btn-xs btn-danger" onclick={() => deleteProvider(selectedProvider.id)}><GIcon name="trash" size={13} /></button>
      </div>
    </div>

    <div class="pp-detail-cols">
      <!-- CENTER: Timeline -->
      <div class="pp-detail-center">
        <div class="pp-timeline-header">
          <h4><GIcon name="activity" size={13} /> Timeline</h4>
          <div class="pp-timeline-filter">
            {#each ['Todo', 'Financiero', 'Stock'] as f}
              <button
                class="pp-filter-btn"
                class:active={timelineFilter === f}
                onclick={() => timelineFilter = f as 'Todo' | 'Financiero' | 'Stock'}
              >{f}</button>
            {/each}
          </div>
        </div>
        <div class="pp-timeline-panels">
          <div class="pp-timeline-panel">
            <div class="pp-panel-header">
              <span><GIcon name="credit-card" size={14} /> Transferencias</span>
              <span class="pp-panel-total" class:positive={transTotal >= 0} class:negative={transTotal < 0}>
                {transTotal >= 0 ? '+' : ''}{formatCurrency(transTotal)}
              </span>
            </div>
            <div class="pp-panel-scroll">
              {#each transGroups as g}
                <div class="pp-date-header">{g.label}</div>
                {#each g.items as m}
                  <div class="pp-move-row">
                    <span class="pp-move-type-badge {moveTypeClass(m.type)}">{moveTypeLabel(m.type)}</span>
                    <span class="pp-move-desc">{m.description || '—'}</span>
                    <span class="pp-move-amount" class:positive={m.type === 'PURCHASE'} class:negative={m.type === 'PAYMENT'}>
                      {m.type === 'PAYMENT' ? '-' : '+'}{formatCurrency(m.amount)}
                    </span>
                    <button class="pp-move-btn pp-move-del" onclick={() => deleteMove(m.id)} title="Eliminar"><GIcon name="trash" size={13} /></button>
                  </div>
                {/each}
              {:else}
                <div class="pp-panel-empty">Sin movimientos</div>
              {/each}
            </div>
          </div>
          <div class="pp-timeline-panel">
            <div class="pp-panel-header">
              <span><GIcon name="dollar" size={14} /> Efectivo</span>
              <span class="pp-panel-total" class:positive={cashTotal >= 0} class:negative={cashTotal < 0}>
                {cashTotal >= 0 ? '+' : ''}{formatCurrency(cashTotal)}
              </span>
            </div>
            <div class="pp-panel-scroll">
              {#each cashGroups as g}
                <div class="pp-date-header">{g.label}</div>
                {#each g.items as m}
                  <div class="pp-move-row">
                    <span class="pp-move-type-badge {moveTypeClass(m.type)}">{moveTypeLabel(m.type)}</span>
                    <span class="pp-move-desc">{m.description || '—'}</span>
                    <span class="pp-move-amount" class:positive={m.type === 'PURCHASE'} class:negative={m.type === 'PAYMENT'}>
                      {m.type === 'PAYMENT' ? '-' : '+'}{formatCurrency(m.amount)}
                    </span>
                    <button class="pp-move-btn pp-move-del" onclick={() => deleteMove(m.id)} title="Eliminar"><GIcon name="trash" size={13} /></button>
                  </div>
                {/each}
              {:else}
                <div class="pp-panel-empty">Sin movimientos</div>
              {/each}
            </div>
          </div>
        </div>
      </div>

      <!-- RIGHT: Actions + Details -->
      <div class="pp-detail-right">
        <div class="pp-card-section">
          <h4><GIcon name="zap" size={13} /> Acciones</h4>
          <button class="pp-action-btn pp-action-pay" onclick={() => openNewMove('PAYMENT')}><GIcon name="dollar" size={13} /> Pago Rápido</button>
          <button class="pp-action-btn pp-action-buy" onclick={() => openNewMove('PURCHASE')}><GIcon name="cart" size={13} /> Compra Nueva</button>
          <button class="pp-action-btn pp-action-stock" onclick={() => openNewMove('STOCK_IN')}><GIcon name="box" size={13} /> Entrada Stock</button>
          <hr class="pp-divider" />
          <button class="pp-action-btn pp-action-edit" onclick={openEditProvider}><GIcon name="edit" size={13} /> Editar Datos</button>
        </div>
        <div class="pp-card-section">
          <h4><GIcon name="file-text" size={13} /> Detalles</h4>
          <div class="pp-detail-data">
            {#if selectedProvider.cuit}<span>CUIT: {selectedProvider.cuit}</span>{/if}
            {#if selectedProvider.alias_mp}<span>Alias MP: {selectedProvider.alias_mp}</span>{/if}
            {#if selectedProvider.alias_cbu}<span>Alias CBU: {selectedProvider.alias_cbu}</span>{/if}
            {#if selectedProvider.address}<span>Dirección: {selectedProvider.address}</span>{/if}
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}

<!-- ============ PROVIDER FORM MODAL ============ -->
{#if showProviderForm}
  <div class="modal-overlay" role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (showProviderForm = false)}>
      <div class="modal-header">
        <h3>{providerForm.id ? 'Editar' : 'Nuevo'} Proveedor</h3>
        <button class="modal-close" onclick={() => showProviderForm = false} aria-label="Cerrar">✕</button>
      </div>
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
  <div class="modal-overlay" role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (showMoveForm = false)}>
      <div class="modal-header">
        <h3>Nuevo {moveForm.type === 'PAYMENT' ? 'Pago' : moveForm.type === 'PURCHASE' ? 'Compra' : moveForm.type === 'STOCK_IN' ? 'Entrada Stock' : 'Movimiento'}</h3>
        <button class="modal-close" onclick={() => showMoveForm = false} aria-label="Cerrar">✕</button>
      </div>
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
  .pp-grid-header h3 { margin: 0; font-size: 1.05rem; color: var(--text-primary); display: inline-flex; align-items: center; gap: 0.429rem; }
  .pp-grid-toolbar { display: flex; gap: 0.429rem; align-items: center; }
  .pp-search-wrap { position: relative; }
  .pp-search {
    padding: 0.357rem 0.571rem;
    border: 1px solid var(--border);
    border-radius: 0.357rem;
    font-size: 0.82rem;
    width: 12rem;
  }

  .pp-cards-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    gap: 0.5rem 0.75rem;
    overflow: auto;
    flex: 1;
    align-content: start;
    padding-top: 0.5rem;
  }

  .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.857rem; }
  .modal-header h3 { margin: 0; font-size: 1.1rem; color: var(--text-primary); }
  .modal-close { background: none; border: none; font-size: 1.143rem; cursor: pointer; color: var(--text-muted); padding: 0.286rem; border-radius: 0.286rem; }
  .modal-close:hover { background: var(--bg-hover); color: var(--text-primary); }
  .pp-empty {
    grid-column: 1 / -1;
    padding: 2rem;
    text-align: center;
    color: var(--text-muted);
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
    background: var(--bg-card);
    border-radius: 0.571rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }
  .pp-detail-nav h3 { margin: 0; font-size: 0.9rem; color: var(--text-primary); display: inline-flex; align-items: center; gap: 0.429rem; min-width: 0; }
  .pp-detail-nav h3 :global(svg) { flex-shrink: 0; }
  .pp-detail-nav-center { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 0.143rem; min-width: 0; padding: 0 0.571rem; }
  .pp-nav-stats { display: flex; align-items: center; gap: 0.714rem; min-width: 0; }
  .pp-nav-debt { font-family: monospace; font-size: 1.5rem; font-weight: 800; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pp-nav-stock { display: inline-flex; align-items: center; gap: 0.286rem; font-size: 0.85rem; font-weight: 600; color: var(--text-secondary); white-space: nowrap; }
  .pp-detail-nav-actions { display: flex; gap: 0.286rem; }

  .pp-detail-cols {
    display: grid;
    grid-template-columns: 1fr 12rem;
    gap: 0.571rem;
    flex: 1;
    min-height: 0;
  }

  .pp-card-section {
    background: var(--bg-card);
    border-radius: 0.571rem;
    padding: 0.714rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }
  .pp-card-section h4 { margin: 0 0 0.571rem; font-size: 0.78rem; color: var(--text-muted); font-weight: 600; display: inline-flex; align-items: center; gap: 0.357rem; }
  .pp-detail-data { display: flex; flex-direction: column; gap: 0.286rem; }
  .pp-detail-data span { font-size: 0.75rem; color: var(--text-secondary); }
  .pp-divider { border: none; border-top: 1px solid var(--border-light); margin: 0.571rem 0; }

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
    background: var(--bg-card);
    border-radius: 0.571rem;
    padding: 0.571rem 0.714rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }
  .pp-timeline-header h4 { margin: 0; font-size: 0.82rem; color: var(--text-primary); display: inline-flex; align-items: center; gap: 0.357rem; }
  .pp-timeline-filter { display: flex; gap: 0.143rem; }
  .pp-filter-btn {
    padding: 0.214rem 0.571rem;
    border: 1px solid var(--border);
    background: var(--bg-card);
    border-radius: 0.286rem;
    font-size: 0.72rem;
    cursor: pointer;
    color: var(--text-secondary);
    font-family: inherit;
  }
  .pp-filter-btn:hover { background: var(--bg-hover); }
  .pp-filter-btn.active { background: var(--accent); color: white; border-color: var(--accent); }

  .pp-timeline-panels {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.429rem;
    flex: 1;
    min-height: 0;
  }

  .pp-timeline-panel {
    background: var(--bg-card);
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
    padding: 0.571rem 0.714rem;
    border-bottom: 2px solid var(--border-light);
    font-size: 0.92rem;
    font-weight: 600;
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  .pp-panel-total { font-family: monospace; font-size: 1.05rem; }
  .pp-panel-total.positive { color: #dc3545; }
  .pp-panel-total.negative { color: #28a745; }
  .pp-panel-scroll { flex: 1; overflow: auto; padding: 0.143rem 0.429rem; }

  .pp-date-header {
    font-size: 1rem;
    font-weight: 700;
    color: var(--text-primary);
    padding: 0.857rem 0.571rem 0.429rem;
    border-bottom: 1px solid var(--border-light);
    margin-top: 0.714rem;
  }
  .pp-panel-scroll > .pp-date-header:first-child { margin-top: 0; }

  .pp-move-row {
    display: flex;
    align-items: center;
    gap: 0.571rem;
    padding: 0.571rem;
    font-size: 0.85rem;
    border-radius: 0.357rem;
    transition: background 0.12s;
  }
  .pp-move-row:hover { background: var(--bg-hover); }
  .pp-move-type-badge {
    font-size: 0.72rem;
    font-weight: 700;
    padding: 0.143rem 0.5rem;
    border-radius: 0.3rem;
    flex-shrink: 0;
    text-align: center;
    letter-spacing: 0.014rem;
  }
  .type-purchase { background: #fff3cd; color: #856404; }
  .type-payment { background: #d4edda; color: #155724; }
  .type-stockin { background: #cce5ff; color: #004085; }
  .type-stockout { background: #f8d7da; color: #721c24; }

  .pp-move-amount { font-family: monospace; font-weight: 700; font-size: 1rem; margin-left: auto; flex-shrink: 0; white-space: nowrap; }
  .pp-move-amount.positive { color: #dc3545; }
  .pp-move-amount.negative { color: #28a745; }
  .pp-move-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.85rem;
    padding: 0.143rem 0.286rem;
    opacity: 0;
    transition: opacity 0.12s;
    flex-shrink: 0;
  }
  .pp-move-row:hover .pp-move-btn { opacity: 0.5; }
  .pp-move-btn:hover { opacity: 1 !important; }
  .pp-move-desc {
    flex: 1;
    min-width: 0;
    font-size: 0.85rem;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pp-panel-empty { padding: 1rem; text-align: center; color: var(--text-muted); font-size: 0.85rem; }

  /* RIGHT */
  .pp-detail-right { display: flex; flex-direction: column; gap: 0.571rem; }
  .pp-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.357rem;
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
