<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import type { Factura } from '$lib/types';
  import { hasMolduraItems, parseCard, buildMoldurasHtmlByTemplate } from '$lib/utils/molduras';
  import { invoke } from '@tauri-apps/api/core';

  let { show, preselectedIds = [], onClose }: {
    show: boolean;
    preselectedIds: number[];
    onClose: () => void;
  } = $props();

  let facturas = $state<Factura[]>([]);
  let selectedIds = $state<Set<number>>(new Set());
  let searchQuery = $state('');
  let searchResults = $state<Factura[]>([]);
  let loading = $state(false);
  let generatingPdf = $state(false);
  let config = $state<any>({});

  let parsedCache = $state<Map<number, ReturnType<typeof parseCard>>>(new Map());

  onMount(async () => {
    try { config = await invoke('get_config'); } catch {}
    selectedIds = new Set(preselectedIds);
    if (preselectedIds.length > 0) {
      await loadFacturas();
    }
  });

  function getParsed(id: number) {
    let p = parsedCache.get(id);
    if (!p) {
      const f = facturas.find(x => x.id === id);
      if (f) {
        p = parseCard(f);
        parsedCache.set(id, p);
      }
    }
    return p;
  }

  async function loadFacturas() {
    loading = true;
    try {
      const all = await cacheStore.fetch('facturas:modal', () => api.listFacturas({ limit: 2000 }), 60000);
      facturas = all;
      // Load preselected ones first
      for (const id of preselectedIds) {
        if (!facturas.find(f => f.id === id)) {
          try {
            const { factura } = await api.getFactura(id);
            if (factura) facturas = [factura, ...facturas];
          } catch { }
        }
      }
    } catch (e) {
      appStore.alert('Error al cargar facturas: ' + (e as Error).message);
    } finally {
      loading = false;
    }
  }

  const selectedCards = $derived.by(() => {
    return Array.from(selectedIds)
      .map(id => facturas.find(f => f.id === id))
      .filter(Boolean) as Factura[];
  });

  const parsedCards = $derived.by(() => {
    return selectedCards.map(f => {
      const p = getParsed(f.id);
      return { ...p, hasMoldura: hasMolduraItems(f) };
    });
  });

  let searchTimeout: ReturnType<typeof setTimeout> | undefined;

  async function doSearch(q: string) {
    searchQuery = q;
    if (searchTimeout) clearTimeout(searchTimeout);
    if (!q.trim()) {
      searchResults = [];
      return;
    }
    searchTimeout = setTimeout(async () => {
      try {
        const results = await api.listFacturas({ search: q, limit: 20 });
        searchResults = results.filter(r => !selectedIds.has(r.id));
      } catch { searchResults = []; }
    }, 300);
  }

  function addToSelection(id: number) {
    const s = new Set(selectedIds);
    s.add(id);
    selectedIds = s;
    searchResults = searchResults.filter(r => r.id !== id);
    searchQuery = '';
  }

  function removeFromSelection(id: number) {
    const s = new Set(selectedIds);
    s.delete(id);
    selectedIds = s;
  }

  async function generatePDF(shouldPrint = false) {
    if (selectedIds.size === 0) return;
    generatingPdf = true;
    try {
      const cards = selectedCards.map(f => {
        const p = getParsed(f.id);
        return {
          cliente: p?.cliente || f.cliente_nombre || '',
          num: p?.num || f.numero_factura || `ID:${f.id}`,
          items: p?.items || [],
          materials: p?.materials || [],
        };
      });

      const html = buildMoldurasHtmlByTemplate(cards, appStore.molduraTemplate);
      const pdfPath = await invoke<string>('generate_molduras_pdf', { html });

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
    } finally {
      generatingPdf = false;
    }
  }

  async function sendToRemotePrint() {
    if (selectedIds.size === 0) return;
    generatingPdf = true;
    try {
      const cards = selectedCards.map(f => {
        const p = getParsed(f.id);
        return {
          cliente: p?.cliente || f.cliente_nombre || '',
          num: p?.num || f.numero_factura || `ID:${f.id}`,
          items: p?.items || [],
          materials: p?.materials || [],
        };
      });
      const html = buildMoldurasHtmlByTemplate(cards, appStore.molduraTemplate);
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
      const errMsg = e?.message ?? (typeof e === 'string' ? e : 'Error desconocido');
      console.error('Error al enviar a impresión remota:', e);
      appStore.showToast('Error: ' + errMsg, 'error');
    } finally {
      generatingPdf = false;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

{#if show}
  <div class="modal-overlay" onclick={onClose} role="presentation">
    <div
      class="modal modal-molduras"
      onclick={(e) => e.stopPropagation()}
      role="dialog"
      tabindex="-1"
      onkeydown={handleKeydown}
    >
      <div class="modal-header">
        <h3>🖼 Imprimir Molduras</h3>
        <button class="modal-close" onclick={onClose} aria-label="Cerrar">✕</button>
      </div>

      <div class="modal-body">
        <!-- Search bar -->
        <div class="search-add">
          <input
            type="text"
            bind:value={searchQuery}
            oninput={(e) => doSearch((e.target as HTMLInputElement).value)}
            placeholder="Buscar facturas para agregar..."
            class="search-input"
          />
          {#if searchResults.length > 0}
            <div class="search-results">
              {#each searchResults as f}
                <div class="search-item" onclick={() => addToSelection(f.id)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && addToSelection(f.id)}>
                  <span class="search-num">{f.numero_factura || f.numero_presupuesto || `ID:${f.id}`}</span>
                  <span class="search-cliente">{f.cliente_nombre}</span>
                  <span class="search-total">${(f.total || 0).toFixed(0)}</span>
                  <span class="search-moldura">{hasMolduraItems(f) ? '🖼' : '📄'}</span>
                  <span class="search-add-btn">+</span>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Selected cards -->
        {#if loading}
          <div class="modal-loading">Cargando facturas...</div>
        {:else if parsedCards.length === 0}
          <div class="modal-empty">
            <p>Seleccioná facturas desde el historial de Facturación o usando el buscador de arriba.</p>
            <p class="modal-hint">Usá Ctrl+Click en Facturación para seleccionar múltiples facturas.</p>
          </div>
        {:else}
          <div class="selected-grid">
            {#each parsedCards as card (card.id)}
              <div class="sel-card">
                <div class="sel-card-header">
                  <span class="sel-card-num">{card.num}</span>
                  <span class="sel-card-cliente">{card.cliente}</span>
                  <button class="sel-card-remove" onclick={() => removeFromSelection(card.id)} aria-label="Remover">✕</button>
                </div>
                <div class="sel-card-body">
                  {#if card.items.length === 0}
                    <div class="sel-no-items">Sin items de moldura detectados</div>
                  {:else}
                    <table class="sel-summary">
                      <thead><tr><th>CANT</th><th>MEDIDA</th></tr></thead>
                      <tbody>
                        {#each card.items as item}
                          <tr>
                            <td class="sel-qty">{item.cantidad}</td>
                            <td class="sel-measure">{item.medida} <span class="sel-tipo">{item.tipo}</span></td>
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  {/if}
                  <div class="sel-moldura-indicator">
                    {card.hasMoldura ? '🖼 Tiene molduras' : '📄 Sin molduras detectadas'}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="modal-footer">
        <span class="modal-count">{selectedIds.size} factura(s) seleccionada(s)</span>
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick={onClose}>Cancelar</button>
          <button class="btn btn-primary" onclick={() => generatePDF(false)} disabled={selectedIds.size === 0 || generatingPdf}>
            {generatingPdf ? 'Generando...' : '📄 Ver PDF'}
          </button>
          <button class="btn btn-success" onclick={() => generatePDF(true)} disabled={selectedIds.size === 0 || generatingPdf}>
            🖨 Imprimir
          </button>
          {#if appStore.activeStations.length > 0}
            <button class="btn btn-info" onclick={() => sendToRemotePrint()} disabled={selectedIds.size === 0 || generatingPdf}>
              📤 Enviar a sucursal
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-molduras { min-width: 42.857rem; max-width: 90vw; max-height: 85vh; display: flex; flex-direction: column; }
  .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.857rem; }
  .modal-header h3 { margin: 0; font-size: 1.1rem; color: var(--text-primary); }
  .modal-close { background: none; border: none; font-size: 1.143rem; cursor: pointer; color: var(--text-muted); padding: 0.286rem; border-radius: 0.286rem; }
  .modal-close:hover { background: var(--bg-hover); color: var(--text-primary); }
  .modal-body { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 0.714rem; }
  .modal-loading, .modal-empty { padding: 2.857rem; text-align: center; color: var(--text-muted); }
  .modal-hint { font-size: 0.78rem; color: var(--text-muted); }

  .search-add { position: relative; }
  .search-input { width: 100%; padding: 0.571rem 0.857rem; border: 1px solid var(--border); border-radius: 0.429rem; font-size: 0.88rem; box-sizing: border-box; }
  .search-results { position: absolute; top: 100%; left: 0; right: 0; background: var(--bg-card); border: 1px solid var(--border); border-radius: 0 0 0.429rem 0.429rem; max-height: 14.286rem; overflow: auto; z-index: 10; box-shadow: 0 0.286rem 0.857rem rgba(0,0,0,0.1); }
  .search-item { display: flex; gap: 0.571rem; padding: 0.429rem 0.714rem; cursor: pointer; border-bottom: 1px solid var(--border-light); font-size: 0.82rem; align-items: center; transition: background 0.1s; }
  .search-item:hover { background: var(--accent-light); }
  .search-num { font-family: monospace; min-width: 5.714rem; font-weight: 600; }
  .search-cliente { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .search-total { font-family: monospace; min-width: 4.286rem; text-align: right; color: var(--text-secondary); }
  .search-moldura { min-width: 1.429rem; text-align: center; font-size: 0.88rem; }
  .search-add-btn { color: #27ae60; font-weight: 700; font-size: 1.1rem; min-width: 1.429rem; text-align: center; }

  .selected-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(17.143rem, 1fr)); gap: 0.571rem; }
  .sel-card { background: var(--bg-page); border: 1px solid var(--border); border-radius: 0.571rem; overflow: hidden; }
  .sel-card-header { background: #2c3e50; color: white; padding: 0.357rem 0.571rem; display: flex; align-items: center; gap: 0.429rem; font-size: 0.78rem; }
  .sel-card-num { font-weight: 600; font-size: 0.82rem; }
  .sel-card-cliente { flex: 1; color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
  .sel-card-remove { background: none; border: none; color: #e74c3c; cursor: pointer; font-size: 0.857rem; padding: 0.143rem; border-radius: 0.214rem; opacity: 0.7; }
  .sel-card-remove:hover { opacity: 1; background: rgba(231,76,60,0.1); }
  .sel-card-body { padding: 0.429rem 0.571rem; }
  .sel-no-items { font-size: 0.75rem; color: var(--text-muted); text-align: center; padding: 0.429rem; }
  .sel-summary { width: 100%; border-collapse: collapse; font-size: 0.75rem; margin-bottom: 0.286rem; }
  .sel-summary th { background: var(--bg-hover); padding: 0.143rem 0.286rem; text-align: left; font-size: 0.65rem; text-transform: uppercase; color: var(--text-secondary); }
  .sel-summary td { padding: 0.143rem 0.286rem; border-bottom: 1px solid var(--border-light); }
  .sel-qty { font-weight: 700; font-size: 0.88rem; width: 1.714rem; }
  .sel-measure { font-weight: 600; font-size: 0.82rem; }
  .sel-tipo { font-weight: 400; color: var(--text-muted); font-size: 0.72rem; }
  .sel-moldura-indicator { font-size: 0.72rem; padding: 0.214rem 0; text-align: center; }

  .modal-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 0.857rem; padding-top: 0.714rem; border-top: 1px solid var(--border-light); }
  .modal-count { font-size: 0.82rem; color: var(--text-secondary); font-weight: 500; }
  .modal-actions { display: flex; gap: 0.571rem; }
</style>
