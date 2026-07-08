<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import type { Factura, InvoiceItem } from '$lib/types';

  let loading = $state(false);
  let cards = $state<ParsedCard[]>([]);
  let selectedIds = $state<Set<number>>(new Set());

  // Add manual dialog
  let showAddDialog = $state(false);
  let addSearch = $state('');
  let allFacturas = $state<Factura[]>([]);
  let addSelected = $state<Set<number>>(new Set());

  interface ParsedItem {
    cantidad: number;
    measure: string;
    desc: string;
  }

  interface ParsedCard {
    id: number;
    num: string;
    cliente: string;
    items: ParsedItem[];
  }

  function parseItems(f: Factura): ParsedItem[] {
    const result: ParsedItem[] = [];
    for (const it of (f.items || [])) {
      const desc = it.descripcion || '';
      if (/rollo/i.test(desc)) continue;

      if (/circular/i.test(desc)) {
        const m = desc.match(/(\d+(?:[.,]\d+)?)/);
        result.push({
          cantidad: it.cantidad,
          measure: m ? `Ø${m[1].replace(',', '.')}` : 'Circular',
          desc: 'Circular',
        });
        continue;
      }

      const rectM = desc.match(/(\d+(?:[.,]\d+)?)\s*[xX]\s*(\d+(?:[.,]\d+)?)/);
      if (rectM) {
        const w = rectM[1].replace(',', '.');
        const h = rectM[2].replace(',', '.');
        const rest = desc
          .replace(rectM[0], '')
          .replace(/bastidor|cm|["]/gi, '')
          .trim();
        result.push({
          cantidad: it.cantidad,
          measure: `${w}x${h}`,
          desc: rest || 'Bastidor',
        });
      } else if (desc.trim()) {
        result.push({
          cantidad: it.cantidad,
          measure: '',
          desc: desc.trim(),
        });
      }
    }
    return result;
  }

  async function loadCards() {
    loading = true;
    try {
      const facturas = await cacheStore.fetch('facturas:produccion', () => api.listFacturas({ limit: 2000 }), 60000);
      const pending = facturas.filter(f => f.estado_orden_tela === 'PENDING');
      cards = pending.map(f => ({
        id: f.id,
        num: f.numero_factura || `ID:${f.id}`,
        cliente: f.cliente_nombre || '',
        items: parseItems(f),
      }));
    } catch (e) {
      appStore.alert('Error al cargar: ' + (e as Error).message);
    } finally {
      loading = false;
    }
  }

  function toggleSelect(id: number) {
    const s = new Set(selectedIds);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    selectedIds = s;
  }

  async function markDone() {
    if (selectedIds.size === 0) return;
    if (!confirm(`¿Marcar ${selectedIds.size} producción(es) como listas?`)) return;
    try {
      await Promise.all(
        Array.from(selectedIds).map(id =>
          api.patchInvoiceField(id, 'estado_orden_tela', 'DELETED')
        )
      );
      appStore.showToast(`${selectedIds.size} producción(es) marcada(s) como lista(s)`);
      selectedIds = new Set();
      cacheStore.invalidate('facturas');
      await loadCards();
    } catch (e) {
      appStore.alert('Error: ' + (e as Error).message);
    }
  }

  // Add Manual
  const addFiltered = $derived.by(() => {
    const q = addSearch.toLowerCase();
    if (!q) return allFacturas;
    return allFacturas.filter(f =>
      (f.numero_factura || '').toLowerCase().includes(q) ||
      (f.numero_presupuesto || '').toLowerCase().includes(q) ||
      (f.cliente_nombre || '').toLowerCase().includes(q)
    );
  });

  function toggleAddSelect(id: number) {
    const s = new Set(addSelected);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    addSelected = s;
  }

  async function openAddDialog() {
    addSearch = '';
    addSelected = new Set();
    try {
      allFacturas = await cacheStore.fetch('facturas:produccion', () => api.listFacturas({ limit: 2000 }), 60000);
      showAddDialog = true;
    } catch (e) {
      appStore.alert('Error al cargar facturas: ' + (e as Error).message);
    }
  }

  async function confirmAdd() {
    if (addSelected.size === 0) return;
    try {
      await Promise.all(
        Array.from(addSelected).map(id =>
          api.patchInvoiceField(id, 'estado_orden_tela', 'PENDING')
        )
      );
      appStore.showToast(`${addSelected.size} factura(s) agregada(s)`);
      showAddDialog = false;
      cacheStore.invalidate('facturas');
      await loadCards();
    } catch (e) {
      appStore.alert('Error: ' + (e as Error).message);
    }
  }

  onMount(() => {
    loadCards();
  });
</script>

<div class="produccion">
  <div class="prod-header">
    <h2>Producción (Tela)</h2>
    <div class="prod-actions">
      <span class="selected-count">
        {selectedIds.size > 0 ? `${selectedIds.size} seleccionada(s)` : ''}
      </span>
      <button class="btn btn-sm btn-secondary" onclick={openAddDialog}>➕ Agregar Manual</button>
      <button class="btn btn-sm btn-danger" onclick={markDone} disabled={selectedIds.size === 0}>🗑 Marcar Listo</button>
      <button class="btn btn-sm btn-primary" onclick={loadCards} disabled={loading}>
        {loading ? 'Cargando...' : '🔄 Refrescar'}
      </button>
    </div>
  </div>

  {#if loading}
    <div class="prod-loading">Cargando órdenes de producción...</div>
  {:else if cards.length === 0}
    <div class="prod-empty">
      <p>No hay órdenes de producción pendientes.</p>
      <button class="btn btn-primary" onclick={openAddDialog}>➕ Agregar desde facturas existentes</button>
    </div>
  {:else}
    <div class="prod-grid">
      {#each cards as card (card.id)}
        <div
          class="prod-card"
          class:selected={selectedIds.has(card.id)}
          onclick={() => toggleSelect(card.id)}
          role="button"
          tabindex="0"
          onkeydown={(e) => e.key === 'Enter' && toggleSelect(card.id)}
        >
          <div class="card-header">
            <span class="card-num">{card.num}</span>
            <span class="card-cliente">{card.cliente}</span>
          </div>
          <div class="card-body">
            {#each card.items as item}
              <div class="card-item">
                <span class="item-qty">{item.cantidad}</span>
                <span class="item-measure">{item.measure}</span>
                <span class="item-desc">{item.desc}</span>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Add Manual Dialog -->
{#if showAddDialog}
  <div class="modal-overlay" onclick={() => showAddDialog = false} role="presentation">
    <div class="modal modal-add" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (showAddDialog = false)}>
      <h3>Agregar Facturas a Producción</h3>
      <div class="modal-body">
        <input type="text" bind:value={addSearch} placeholder="Buscar por número o cliente..." class="add-search" />
        <div class="add-list">
          {#each addFiltered as f (f.id)}
            <div
              class="add-row"
              class:add-selected={addSelected.has(f.id)}
              onclick={() => toggleAddSelect(f.id)}
              role="button"
              tabindex="0"
              onkeydown={(e) => e.key === 'Enter' && toggleAddSelect(f.id)}
            >
              <span class="add-num">{f.numero_factura || f.numero_presupuesto || `ID:${f.id}`}</span>
              <span class="add-cliente">{f.cliente_nombre}</span>
              <span class="add-total">${(f.total || 0).toFixed(2)}</span>
              <span class="add-check">{addSelected.has(f.id) ? '✓' : ''}</span>
            </div>
          {:else}
            <div class="add-empty">Sin resultados</div>
          {/each}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={() => showAddDialog = false}>Cancelar</button>
        <button class="btn btn-primary" onclick={confirmAdd} disabled={addSelected.size === 0}>
          Agregar ({addSelected.size})
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .produccion {
    padding: 1.143rem;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.857rem;
    background: #f5f6fa;
  }

  .prod-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .prod-header h2 { margin: 0; font-size: 1.3rem; color: #2c3e50; }
  .prod-actions { display: flex; align-items: center; gap: 0.571rem; }
  .selected-count { font-size: 0.8rem; color: #3498db; font-weight: 600; min-width: 8.571rem; text-align: right; }

  .prod-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(21.429rem, 1fr));
    gap: 0.714rem;
    flex: 1;
    overflow: auto;
    align-content: start;
  }

  .prod-card {
    background: white;
    border: 0.143rem solid #e0e0e0;
    border-radius: 0.714rem;
    overflow: hidden;
    cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .prod-card:hover { border-color: #bbb; box-shadow: 0 0.143rem 0.571rem rgba(0,0,0,0.06); }
  .prod-card.selected { border-color: #3498db; box-shadow: 0 0 0 0.143rem rgba(52,152,219,0.2); }

  .card-header {
    background: #2c3e50;
    color: white;
    padding: 0.571rem 0.857rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .card-num { font-weight: 600; font-size: 0.88rem; }
  .card-cliente { font-size: 0.78rem; color: #bdc3c7; }

  .card-body { padding: 0.571rem 0.857rem; }
  .card-item {
    display: flex;
    gap: 0.571rem;
    align-items: baseline;
    padding: 0.214rem 0;
    border-bottom: 1px solid #f0f0f0;
  }
  .card-item:last-child { border-bottom: none; }
  .item-qty {
    font-size: 1rem;
    font-weight: 700;
    min-width: 2rem;
    color: #2c3e50;
  }
  .item-measure {
    font-size: 0.9rem;
    font-weight: 700;
    min-width: 5rem;
    color: #555;
  }
  .item-desc {
    font-size: 0.8rem;
    color: #888;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .prod-loading, .prod-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #999;
    gap: 0.857rem;
  }

  .modal-add { min-width: 35.714rem; max-height: 70vh; }
  .add-search {
    padding: 0.571rem 0.857rem;
    border: 1px solid #ddd;
    border-radius: 0.429rem;
    font-size: 0.88rem;
    width: 100%;
    box-sizing: border-box;
  }
  .add-list {
    max-height: 25rem;
    overflow: auto;
    border: 1px solid #eee;
    border-radius: 0.429rem;
  }
  .add-row {
    display: flex;
    gap: 0.714rem;
    padding: 0.5rem 0.714rem;
    cursor: pointer;
    border-bottom: 1px solid #f5f5f5;
    font-size: 0.82rem;
    align-items: center;
  }
  .add-row:hover { background: #f0f4ff; }
  .add-selected { background: #e8f4fd; }
  .add-num { font-family: monospace; min-width: 5.714rem; font-weight: 600; }
  .add-cliente { flex: 1; }
  .add-total { font-family: monospace; min-width: 4.286rem; text-align: right; color: #555; }
  .add-check { min-width: 1.429rem; color: #27ae60; font-weight: 700; text-align: center; }
  .add-empty { padding: 1.429rem; text-align: center; color: #bbb; font-size: 0.82rem; }
</style>
