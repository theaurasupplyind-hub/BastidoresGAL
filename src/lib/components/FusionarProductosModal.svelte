<script lang="ts">
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import { facturasActivas, normalizarProducto, similitudProducto, sugerirProductosSimilares, esItemProducto } from '$lib/utils/facturas';
  import type { Factura, Producto, ProductoMerge } from '$lib/types';

  let { show, productos, onclose, onmerged }: {
    show: boolean;
    productos: Producto[];
    onclose: () => void;
    onmerged?: () => void;
  } = $props();

  type Tab = 'merge' | 'history';
  interface UsoDescripcion {
    key: string;
    descripcion: string;
    facturas: number;
    unidades: number;
    total: number;
  }

  let tab = $state<Tab>('merge');
  let targetId = $state<string | null>(null);
  let sourceIds = $state<string[]>([]);
  let targetSearch = $state('');
  let sourceSearch = $state('');

  let finalPrecio = $state(0);
  let finalStock = $state(0);
  let finalCategoria = $state('Varios');
  let finalMedida = $state('');
  let finalVariante = $state('');

  let extraAliases = $state<string[]>([]);
  let usos = $state<UsoDescripcion[]>([]);
  let usosLoading = $state(false);

  let mergeHistory = $state<ProductoMerge[]>([]);
  let historyLoading = $state(false);
  let merging = $state(false);
  let undoingId = $state<number | null>(null);
  let error = $state('');
  let opened = false;

  const targetProducto = $derived(productos.find(p => p.id === targetId) ?? null);
  const sourceProductos = $derived(productos.filter(p => sourceIds.includes(p.id)));

  const filteredDestino = $derived(
    targetSearch.trim()
      ? productos.filter(p => {
          const q = targetSearch.trim().toLowerCase();
          return p.descripcion.toLowerCase().includes(q) ||
            (p.categoria || '').toLowerCase().includes(q) ||
            (p.variante || '').toLowerCase().includes(q);
        }).slice(0, 20)
      : []
  );

  const filteredOrigen = $derived(
    sourceSearch.trim()
      ? productos.filter(p => {
          if (p.id === targetId || sourceIds.includes(p.id)) return false;
          const q = sourceSearch.trim().toLowerCase();
          return p.descripcion.toLowerCase().includes(q) ||
            (p.categoria || '').toLowerCase().includes(q) ||
            (p.variante || '').toLowerCase().includes(q);
        }).slice(0, 20)
      : []
  );

  const sugerencias = $derived(
    targetProducto
      ? sugerirProductosSimilares(
          targetProducto,
          productos.filter(p => !sourceIds.includes(p.id)),
          0.6,
          6,
        )
      : []
  );

  const excluidos = $derived.by(() => {
    const set = new Set<string>();
    if (targetProducto) set.add(normalizarProducto(targetProducto.descripcion));
    for (const p of sourceProductos) set.add(normalizarProducto(p.descripcion));
    return set;
  });

  const historicos = $derived.by(() => {
    if (!targetProducto) return [] as Array<UsoDescripcion & { score: number; motivo: string }>;
    return usos
      .filter(u => !excluidos.has(u.key))
      .map(u => ({ ...u, ...similitudProducto(targetProducto.descripcion, u.descripcion) }))
      .filter(u => u.score >= 0.6)
      .sort((a, b) => b.score - a.score || b.total - a.total)
      .slice(0, 8);
  });

  const usosOrigen = $derived(
    sourceProductos.map(p => {
      const key = normalizarProducto(p.descripcion);
      return usos.find(u => u.key === key) ?? { key, descripcion: p.descripcion, facturas: 0, unidades: 0, total: 0 };
    })
  );

  const totalVentasOrigen = $derived(usosOrigen.reduce((s, u) => s + u.total, 0));
  const totalUnidadesOrigen = $derived(usosOrigen.reduce((s, u) => s + u.unidades, 0));

  function money(n: number | null | undefined): string {
    return `$${Number(n || 0).toLocaleString('es-AR')}`;
  }

  function selectTarget(p: Producto) {
    targetId = p.id;
    targetSearch = '';
    finalPrecio = Number(p.precio_unitario) || 0;
    finalStock = 0;
    finalCategoria = p.categoria || 'Varios';
    finalMedida = p.medida || '';
    finalVariante = p.variante || '';
    sourceIds = sourceIds.filter(id => id !== p.id);
    extraAliases = [];
  }

  function addSource(p: Producto) {
    if (!sourceIds.includes(p.id) && p.id !== targetId) sourceIds = [...sourceIds, p.id];
    sourceSearch = '';
  }

  function removeSource(id: string) {
    sourceIds = sourceIds.filter(s => s !== id);
  }

  function toggleAlias(descripcion: string) {
    const key = normalizarProducto(descripcion);
    const exists = extraAliases.some(a => normalizarProducto(a) === key);
    if (exists) extraAliases = extraAliases.filter(a => normalizarProducto(a) !== key);
    else extraAliases = [...extraAliases, descripcion];
  }

  function hasAlias(descripcion: string): boolean {
    const key = normalizarProducto(descripcion);
    return extraAliases.some(a => normalizarProducto(a) === key);
  }

  async function loadUsos() {
    usosLoading = true;
    try {
      const facturas = await cacheStore.fetch<Factura[]>(
        'facturas:merge',
        () => api.listFacturas({ limit: 2000 }),
        300000,
      );
      const map = new Map<string, UsoDescripcion>();
      for (const f of facturasActivas(facturas || [])) {
        for (const it of (f.items || [])) {
          if (!esItemProducto(it)) continue;
          const key = normalizarProducto(it.descripcion);
          let u = map.get(key);
          if (!u) {
            u = { key, descripcion: (it.descripcion || '').trim() || 'Sin descripción', facturas: 0, unidades: 0, total: 0 };
            map.set(key, u);
          }
          u.unidades += Number(it.cantidad) || 0;
          u.total += Number(it.total) || 0;
        }
      }
      // Contar facturas distintas por descripción.
      const facturasPorKey = new Map<string, Set<number>>();
      for (const f of facturasActivas(facturas || [])) {
        for (const it of (f.items || [])) {
          if (!esItemProducto(it)) continue;
          const key = normalizarProducto(it.descripcion);
          let set = facturasPorKey.get(key);
          if (!set) { set = new Set<number>(); facturasPorKey.set(key, set); }
          set.add(f.id);
        }
      }
      for (const [key, set] of facturasPorKey) {
        const u = map.get(key);
        if (u) u.facturas = set.size;
      }
      usos = Array.from(map.values());
    } catch {
      usos = [];
    } finally {
      usosLoading = false;
    }
  }

  async function loadHistory() {
    historyLoading = true;
    try {
      mergeHistory = await api.listProductMerges(20);
    } catch {
      mergeHistory = [];
    } finally {
      historyLoading = false;
    }
  }

  $effect(() => {
    if (show && !opened) {
      opened = true;
      error = '';
      loadUsos();
      loadHistory();
    } else if (!show) {
      opened = false;
    }
  });

  async function doMerge() {
    if (!targetProducto || sourceProductos.length === 0 || merging) return;
    const aliases = [
      ...sourceProductos.map(p => p.descripcion),
      ...extraAliases,
    ];
    const seen = new Set<string>();
    const deduped = aliases.filter(a => {
      const k = normalizarProducto(a);
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const ok = confirm(
      `¿Fusionar ${sourceProductos.length} producto(s) en "${targetProducto.descripcion}"?\n\n` +
      `• Se conserva: ${targetProducto.descripcion} — ${money(finalPrecio)} — stock ${finalStock}\n` +
      `• Se eliminan del catálogo: ${sourceProductos.map(p => p.descripcion).join(', ')}\n` +
      `• Ventas históricas: ${totalUnidadesOrigen} unidades / ${money(totalVentasOrigen)} (no se modifican las facturas)\n` +
      `• Alias a agrupar en estadísticas: ${deduped.length}\n\n` +
      `Se puede deshacer desde el historial.`
    );
    if (!ok) return;

    merging = true;
    error = '';
    try {
      await api.mergeProductos({
        target_id: targetProducto.id,
        target: {
          id: targetProducto.id,
          descripcion: targetProducto.descripcion,
          precio_unitario: Number(finalPrecio) || 0,
          categoria: finalCategoria,
          medida: finalMedida,
          variante: finalVariante,
          stock: Number(finalStock) || 0,
        },
        source_ids: sourceProductos.map(p => p.id),
        aliases: deduped,
        user_id: appStore.user?.user_id || 0,
      });
      cacheStore.invalidate('productos');
      cacheStore.invalidate('productos:alias');
      cacheStore.invalidate('facturas:merge');
      window.dispatchEvent(new Event('productos-changed'));
      appStore.showToast(`Fusionados ${sourceProductos.length} producto(s) en "${targetProducto.descripcion}"`, 'success');
      sourceIds = [];
      extraAliases = [];
      targetId = null;
      onmerged?.();
      await loadHistory();
      tab = 'history';
    } catch (e: any) {
      error = e?.message || String(e);
      appStore.showToast(error, 'error');
    } finally {
      merging = false;
    }
  }

  async function undo(m: ProductoMerge) {
    if (undoingId != null) return;
    if (!confirm(`¿Deshacer la fusión de "${m.target_descripcion}"?\n\nSe restauran los productos eliminados y sus alias.`)) return;
    undoingId = m.id;
    error = '';
    try {
      await api.undoProductoMerge(m.id);
      cacheStore.invalidate('productos');
      cacheStore.invalidate('productos:alias');
      cacheStore.invalidate('facturas:merge');
      window.dispatchEvent(new Event('productos-changed'));
      appStore.showToast('Fusión deshecha', 'success');
      onmerged?.();
      await loadHistory();
    } catch (e: any) {
      error = e?.message || String(e);
      appStore.showToast(error, 'error');
    } finally {
      undoingId = null;
    }
  }

  function resetAndClose() {
    targetId = null;
    sourceIds = [];
    targetSearch = '';
    sourceSearch = '';
    extraAliases = [];
    error = '';
    onclose();
  }

  function formatDate(val?: string | null): string {
    if (!val) return '';
    const d = new Date(val);
    if (isNaN(d.getTime())) return val;
    return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
</script>

{#if show}
  <div class="overlay" role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-label="Fusionar productos" tabindex="-1">
      <div class="modal-header">
        <div class="tabs">
          <button class:active={tab === 'merge'} onclick={() => tab = 'merge'}>Fusionar</button>
          <button class:active={tab === 'history'} onclick={() => { tab = 'history'; loadHistory(); }}>
            Historial {mergeHistory.length ? `(${mergeHistory.length})` : ''}
          </button>
        </div>
        <button class="close-btn" onclick={resetAndClose} aria-label="Cerrar">&times;</button>
      </div>

      {#if tab === 'merge'}
        <div class="modal-body">
          {#if error}
            <div class="error">{error}</div>
          {/if}

          <!-- Destino -->
          <div class="field-group">
            <label for="merge-target">Producto destino (se conserva)</label>
            {#if targetProducto}
              <div class="selected-tag destino">
                <span>
                  <strong>{targetProducto.descripcion}</strong>
                  <small>{targetProducto.categoria || 'Varios'} · {money(targetProducto.precio_unitario)} · stock {targetProducto.stock ?? 0}</small>
                </span>
                <button class="remove-btn" onclick={() => { targetId = null; }} aria-label="Quitar destino">&times;</button>
              </div>
            {:else}
              <input id="merge-target" type="text" placeholder="Buscar producto destino..." bind:value={targetSearch} />
              {#if targetSearch && filteredDestino.length > 0}
                <div class="dropdown">
                  {#each filteredDestino as p (p.id)}
                    <button class="drop-item" onclick={() => selectTarget(p)}>
                      <span class="drop-name">{p.descripcion}</span>
                      <span class="drop-info">{p.categoria || 'Varios'} · {money(p.precio_unitario)} · stock {p.stock ?? 0}</span>
                    </button>
                  {/each}
                </div>
              {:else if targetSearch}
                <p class="hint">Sin resultados.</p>
              {/if}
            {/if}
          </div>

          {#if targetProducto}
            <!-- Valores finales -->
            <div class="values-box">
              <div class="values-title">Valores finales del producto</div>
              <div class="values-grid">
                <label>Precio<input type="number" min="0" step="0.01" bind:value={finalPrecio} /></label>
                <label>Stock<input type="number" bind:value={finalStock} /></label>
                <label>Categoría<input type="text" bind:value={finalCategoria} /></label>
                <label>Medida<input type="text" bind:value={finalMedida} placeholder="ej: 50x60" /></label>
                <label class="wide">Variante<input type="text" bind:value={finalVariante} /></label>
              </div>
              <p class="hint">El stock es un contador manual, no las ventas históricas. Por defecto queda en 0.</p>
            </div>

            <!-- Orígenes -->
            <div class="field-group">
              <label for="merge-source">Productos a fusionar (se eliminan del catálogo)</label>
              <input id="merge-source" type="text" placeholder="Buscar y agregar producto..." bind:value={sourceSearch} />
              {#if sourceSearch && filteredOrigen.length > 0}
                <div class="dropdown">
                  {#each filteredOrigen as p (p.id)}
                    <button class="drop-item" onclick={() => addSource(p)}>
                      <span class="drop-name">{p.descripcion}</span>
                      <span class="drop-info">{p.categoria || 'Varios'} · {money(p.precio_unitario)} · stock {p.stock ?? 0}</span>
                    </button>
                  {/each}
                </div>
              {/if}
            </div>

            {#if sourceProductos.length > 0}
              <div class="source-list">
                {#each sourceProductos as p (p.id)}
                  <div class="selected-tag origen">
                    <span>
                      <strong>{p.descripcion}</strong>
                      <small>{money(p.precio_unitario)} · stock {p.stock ?? 0}</small>
                    </span>
                    <button class="remove-btn" onclick={() => removeSource(p.id)} aria-label="Quitar">&times;</button>
                  </div>
                {/each}
                <div class="usage-summary">
                  Ventas históricas de los orígenes: <strong>{totalUnidadesOrigen} unidades</strong> ·
                  <strong>{money(totalVentasOrigen)}</strong>. No se modifica ninguna factura.
                </div>
              </div>
            {/if}

            <!-- Sugerencias -->
            {#if sugerencias.length > 0 && sourceProductos.length === 0}
              <div class="suggestions">
                <div class="values-title">Posibles duplicados</div>
                {#each sugerencias as s (s.producto.id)}
                  <div class="suggestion-row">
                    <div>
                      <strong>{s.producto.descripcion}</strong>
                      <small>{money(s.producto.precio_unitario)} · stock {s.producto.stock ?? 0} · {s.motivo}</small>
                    </div>
                    <button class="btn-mini" onclick={() => addSource(s.producto)}>Agregar</button>
                  </div>
                {/each}
              </div>
            {/if}

            <!-- Historial de descripciones -->
            <div class="history-desc">
              <div class="values-title">Descripciones históricas similares</div>
              {#if usosLoading}
                <p class="hint">Cargando facturas...</p>
              {:else if historicos.length === 0}
                <p class="hint">No hay otras descripciones parecidas en las facturas.</p>
              {:else}
                <p class="hint">Marcá las que deben agruparse bajo “{targetProducto.descripcion}”.</p>
                {#each historicos as u (u.key)}
                  <label class="alias-row">
                    <input type="checkbox" checked={hasAlias(u.descripcion)} onchange={() => toggleAlias(u.descripcion)} />
                    <span>
                      <strong>{u.descripcion}</strong>
                      <small>{u.facturas} factura(s) · {u.unidades} u. · {money(u.total)} · {u.motivo}</small>
                    </span>
                  </label>
                {/each}
              {/if}
            </div>
          {/if}
        </div>

        <div class="modal-footer">
          <button class="btn-cancel" onclick={resetAndClose} disabled={merging}>Cancelar</button>
          <button
            class="btn-primary"
            onclick={doMerge}
            disabled={!targetProducto || sourceProductos.length === 0 || merging}
          >
            {merging ? 'Fusionando...' : `Fusionar ${sourceProductos.length || ''}`}
          </button>
        </div>
      {:else}
        <div class="modal-body">
          {#if error}
            <div class="error">{error}</div>
          {/if}
          {#if historyLoading}
            <p class="hint">Cargando historial...</p>
          {:else if mergeHistory.length === 0}
            <p class="hint">Todavía no hay fusiones.</p>
          {:else}
            {#each mergeHistory as m (m.id)}
              <div class="merge-row" class:undone={!!m.undone_at}>
                <div>
                  <strong>{m.target_descripcion}</strong>
                  <small>
                    ← {m.sources.join(', ') || 'sin origen'} · {m.alias_count} alias · {formatDate(m.created_at)}
                    {#if m.undone_at}· deshecha{/if}
                  </small>
                </div>
                <button
                  class="btn-mini"
                  onclick={() => undo(m)}
                  disabled={!m.can_undo || undoingId != null}
                  title={m.can_undo ? 'Deshacer esta fusión' : 'Solo se puede deshacer la fusión activa más reciente'}
                >
                  {undoingId === m.id ? 'Deshaciendo...' : 'Deshacer'}
                </button>
              </div>
            {/each}
          {/if}
        </div>
        <div class="modal-footer">
          <button class="btn-cancel" onclick={resetAndClose}>Cerrar</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.4);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: var(--bg-card, #fff); border-radius: 0.714rem;
    width: 640px; max-width: 95vw; max-height: 90vh;
    display: flex; flex-direction: column;
    box-shadow: 0 0.571rem 1.429rem rgba(0,0,0,0.2);
  }
  .modal-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 0.75rem 1.286rem; border-bottom: 1px solid var(--border, #ddd);
  }
  .tabs { display: flex; gap: 0.286rem; }
  .tabs button {
    background: none; border: none; cursor: pointer; padding: 0.429rem 0.714rem;
    font-size: 0.929rem; color: var(--text-secondary, #666); border-radius: 0.429rem;
  }
  .tabs button.active { background: var(--bg-hover, #f0f0f0); color: var(--text-primary, #1a1d23); font-weight: 600; }
  .close-btn {
    background: none; border: none; font-size: 1.429rem; cursor: pointer;
    line-height: 1; padding: 0 0.286rem; color: var(--text-muted, #999);
  }
  .modal-body { padding: 1.286rem; overflow-y: auto; flex: 1; }
  .field-group { margin-bottom: 1rem; }
  .field-group label, .values-title {
    display: block; font-size: 0.857rem; font-weight: 600;
    color: var(--text-secondary, #666); margin-bottom: 0.429rem;
  }
  .field-group input {
    width: 100%; padding: 0.571rem 0.857rem;
    border: 1px solid var(--border, #ddd); border-radius: 0.429rem;
    font-size: 0.929rem; box-sizing: border-box;
    background: var(--bg-card, #fff); color: var(--text-primary, #1a1d23);
  }
  .dropdown {
    border: 1px solid var(--border, #ddd); border-radius: 0.429rem;
    max-height: 200px; overflow-y: auto; margin-top: 0.286rem;
  }
  .drop-item {
    display: flex; flex-direction: column; align-items: flex-start;
    width: 100%; padding: 0.571rem 0.857rem;
    border: none; border-bottom: 1px solid var(--border-light, #eee);
    background: var(--bg-card, #fff); cursor: pointer; text-align: left;
    font-size: 0.929rem;
  }
  .drop-item:last-child { border-bottom: none; }
  .drop-item:hover { background: var(--bg-hover, #f5f5f5); }
  .drop-name { font-weight: 500; }
  .drop-info { font-size: 0.786rem; color: var(--text-muted, #999); }
  .selected-tag {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0.571rem 0.857rem; border-radius: 0.429rem; font-size: 0.929rem;
    margin-bottom: 0.286rem;
  }
  .selected-tag small { display: block; color: var(--text-muted, #999); font-size: 0.786rem; }
  .selected-tag.destino { background: var(--success-soft, #e8f5e9); border: 1px solid var(--success-border, #a5d6a7); }
  .selected-tag.origen { background: var(--warning-soft, #fff8e1); border: 1px solid var(--warning-border, #ffe082); }
  .remove-btn {
    background: none; border: none; font-size: 1.143rem; cursor: pointer;
    line-height: 1; padding: 0 0.286rem; color: var(--text-muted, #999);
  }
  .remove-btn:hover { color: var(--danger, #c00); }
  .values-box, .suggestions, .history-desc {
    background: var(--bg-page, #f9f9f9); border-radius: 0.429rem;
    padding: 0.857rem; margin-bottom: 1rem;
  }
  .values-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.571rem; }
  .values-grid label { font-size: 0.786rem; font-weight: 500; color: var(--text-secondary, #666); }
  .values-grid label.wide { grid-column: 1 / -1; }
  .values-grid input {
    width: 100%; box-sizing: border-box; padding: 0.429rem 0.571rem;
    border: 1px solid var(--border, #ddd); border-radius: 0.357rem;
    margin-top: 0.214rem; background: var(--bg-card, #fff); color: var(--text-primary, #1a1d23);
  }
  .usage-summary {
    margin-top: 0.571rem; font-size: 0.857rem; color: var(--text-secondary, #666);
    background: var(--bg-page, #f9f9f9); border-radius: 0.357rem; padding: 0.571rem;
  }
  .suggestion-row, .alias-row, .merge-row {
    display: flex; align-items: center; justify-content: space-between; gap: 0.571rem;
    padding: 0.429rem 0; border-bottom: 1px solid var(--border-light, #eee);
    font-size: 0.929rem;
  }
  .suggestion-row:last-child, .alias-row:last-child, .merge-row:last-child { border-bottom: none; }
  .suggestion-row small, .alias-row small, .merge-row small {
    display: block; color: var(--text-muted, #999); font-size: 0.786rem;
  }
  .alias-row { justify-content: flex-start; cursor: pointer; }
  .alias-row input { width: auto; margin: 0; }
  .merge-row.undone { opacity: 0.55; }
  .btn-mini {
    padding: 0.286rem 0.714rem; border: 1px solid var(--border, #ddd);
    border-radius: 0.357rem; background: var(--bg-card, #fff); cursor: pointer;
    font-size: 0.857rem; white-space: nowrap;
  }
  .btn-mini:disabled { opacity: 0.45; cursor: default; }
  .hint { margin: 0.286rem 0 0; font-size: 0.786rem; color: var(--text-muted, #999); }
  .error {
    background: var(--danger-soft, #fde8e8); color: var(--danger, #c00);
    border-radius: 0.357rem; padding: 0.571rem; margin-bottom: 0.857rem; font-size: 0.857rem;
  }
  .modal-footer {
    display: flex; justify-content: flex-end; gap: 0.571rem;
    padding: 1rem 1.286rem; border-top: 1px solid var(--border, #ddd);
  }
  .btn-cancel {
    padding: 0.571rem 1.286rem; border: 1px solid var(--border, #ddd);
    border-radius: 0.429rem; background: var(--bg-card, #fff);
    cursor: pointer; font-size: 0.929rem;
  }
  .btn-primary {
    padding: 0.571rem 1.286rem; background: var(--accent, #1976d2);
    color: var(--text-on-accent, #fff); border: none; border-radius: 0.429rem;
    cursor: pointer; font-size: 0.929rem; font-weight: 500;
  }
  .btn-primary:disabled, .btn-cancel:disabled { opacity: 0.5; cursor: default; }
</style>
