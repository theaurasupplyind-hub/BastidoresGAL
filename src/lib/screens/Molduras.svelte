<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import type { Factura } from '$lib/types';
  import { parseCard, typeLabel, groupMaterials, buildMoldurasHtmlByTemplate, calcMaterials, applyCorrection, parse2DItem, calcFilas, calcLargueros, consolidateMaterials } from '$lib/utils/molduras';
  import Bastidor from '$lib/components/Bastidor.svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { confirm as dialogConfirm } from '@tauri-apps/plugin-dialog';
  import type { CardItem, CardMaterial, MolduraCorrectionData } from '$lib/utils/molduras';

  let loading = $state(false);
  let cards = $state<ParsedCard[]>([]);
  let selectedIds = $state<Set<number>>(new Set());
  let generatingPdf = $state(false);

  // Add manual dialog
  let showFormulaModal = $state(false);
  let showDetailModal = $state(false);
  let detailCard = $state<ParsedCard | null>(null);
  let detailItemIdx = $state(0);
  let showAddDialog = $state(false);
  let addSearch = $state('');
  let allFacturas = $state<Factura[]>([]);
  let addSelected = $state<Set<number>>(new Set());
  let correctionsMap = $state<Map<number, MolduraCorrectionData>>(new Map());
  let editLargQty = $state(0);
  let editLargCm = $state(0);
  let editLargNum = $state(0);
  let editTravQty = $state(0);
  let editTravCm = $state(0);
  let editMode = $state(false);
  let savedLargNum = $state(0);
  let savedTravQty = $state(0);
  let savingCorrection = $state(false);

  let hasChanges = $derived(editLargNum !== savedLargNum || editTravQty !== savedTravQty);

  let editTravFilas = $derived(editTravQty > 0 ? Math.ceil(editTravQty / (editLargNum + 1)) : 0);

  interface ParsedCard {
    id: number;
    num: string;
    cliente: string;
    entrega: string;
    items: CardItem[];
    materials: CardMaterial[];
    hasCorrection: boolean;
  }

  function parseCardLocal(f: Factura): ParsedCard {
    const p = parseCard(f);
    const base = { ...p, entrega: f.estado_entrega || 'PENDIENTE', hasCorrection: false };
    for (const item of p.items) {
      const m = parse2DItem(item.medida);
      if (m && m.w && m.h) {
        const corr = correctionsMap.get(f.id);
        if (corr) {
          base.hasCorrection = true;
          const formula = calcMaterials(m.w, m.h, item.cantidad);
          base.materials = applyCorrection(formula, corr);
          break;
        }
      }
    }
    return base;
  }

  async function loadCards() {
    loading = true;
    selectedIds = new Set();
    try {
      const facturas = await cacheStore.fetch('facturas:molduras', () => api.listFacturas({ limit: 2000 }), 60000);
      const pending = facturas.filter(f => f.estado_moldura === 'PENDING' && f.estado_entrega !== 'ENTREGADO');
      const correctionMap = new Map<number, MolduraCorrectionData>();
      await Promise.all(pending.map(async f => {
        try {
          const corrs = await api.getInvoiceCorrections(f.id);
          if (corrs.length > 0) {
            correctionMap.set(f.id, corrs[0]);
          }
        } catch { }
      }));
      correctionsMap = correctionMap;
      cards = pending.map(parseCardLocal);
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
    if (!await dialogConfirm(`¿Marcar ${selectedIds.size} moldura(s) como lista(s)?`)) return;
    try {
      await Promise.all(
        Array.from(selectedIds).flatMap(id => [
          api.patchInvoiceField(id, 'estado_moldura', 'DELETED'),
          api.patchInvoiceField(id, 'estado_orden_tela', 'DELETED'),
        ])
      );
      appStore.showToast(`${selectedIds.size} moldura(s) marcada(s) como lista(s)`);
      selectedIds = new Set();
      cacheStore.invalidate('facturas');
      await loadCards();
    } catch (e) {
      appStore.alert('Error: ' + (e as Error).message);
    }
  }

  async function syncStatus() {
    loading = true;
    try {
      const toDelete = cards.filter(c => c.entrega === 'ENTREGADO');
      if (toDelete.length === 0) {
        appStore.showToast('Sin cambios', 'info');
        return;
      }
      await Promise.all(
        toDelete.flatMap(c => [
          api.patchInvoiceField(c.id, 'estado_moldura', 'DELETED'),
          api.patchInvoiceField(c.id, 'estado_orden_tela', 'DELETED'),
        ])
      );
      appStore.showToast(`${toDelete.length} moldura(s) sincronizada(s)`);
      cacheStore.invalidate('facturas');
      await loadCards();
    } catch (e) {
      appStore.alert('Error en sincronización: ' + (e as Error).message);
    } finally {
      loading = false;
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
      allFacturas = await cacheStore.fetch('facturas:all_add', () => api.listFacturas({ limit: 2000 }), 60000);
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
          api.patchInvoiceField(id, 'estado_moldura', 'PENDING')
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

  async function generatePDF(shouldPrint = false) {
    if (selectedIds.size === 0) return;
    generatingPdf = true;
    try {
      const selCards = cards.filter(c => selectedIds.has(c.id));
      const data = selCards.map(c => ({
        cliente: c.cliente,
        num: c.num,
        items: c.items,
        materials: c.materials,
      }));
      const html = buildMoldurasHtmlByTemplate(data, appStore.molduraTemplate);
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
      const msg = (e as Error)?.message ?? String(e);
      console.error('Error al generar PDF:', e);
      appStore.showToast('Error al generar PDF: ' + msg, 'error');
    } finally {
      generatingPdf = false;
    }
  }

  const detailItem = $derived(detailCard?.items[detailItemIdx] ?? null);
  const detailItemDims = $derived.by(() => {
    if (!detailItem) return null;
    const m = detailItem.medida.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
    if (!m) return null;
    return { w: parseFloat(m[1]), h: parseFloat(m[2]) };
  });
  const detailItemMaterials = $derived.by(() => {
    if (!detailItem || !detailItemDims) return [];
    return calcMaterials(detailItemDims.w, detailItemDims.h, detailItem.cantidad);
  });

  function openDetail(card: ParsedCard) {
    detailCard = card;
    detailItemIdx = 0;
    editMode = false;
    showDetailModal = true;
    const item = card.items[0];
    const dimMatch = item?.medida.match(/^(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);
    if (!dimMatch) return;
    const w = parseFloat(dimMatch[1]);
    const h = parseFloat(dimMatch[2]);
    const shorter = Math.min(w, h);
    const formula = calcMaterials(w, h, item.cantidad);
    const l = formula.find(m => m.type === 'L');
    const t = formula.find(m => m.type === 'T');
    editLargNum = calcLargueros(Math.max(w, h));
    editLargCm = l?.cm ?? Math.round((shorter - 5.2) * 10) / 10;
    editTravQty = t?.qty ?? 0;
    const discount = editLargNum === 1 ? 9.0 : editLargNum === 2 ? 12.8 : 16.5;
    editTravCm = t?.cm ?? (editTravFilas > 0 ? Math.round(((Math.max(w, h) - discount) / (editLargNum + 1)) * 10) / 10 : 0);
  }

  async function saveCorrection() {
    if (!detailCard || !detailItemDims) return;
    if (!hasChanges) { editMode = false; return; }
    savingCorrection = true;
    try {
      const item = detailCard.items[detailItemIdx];
      await api.saveMolduraCorrection({
        invoice_id: detailCard.id,
        item_descripcion: item.medida,
        width: detailItemDims.w,
        height: detailItemDims.h,
        qty: item.cantidad,
        larguero_qty: editLargQty,
        larguero_cm: editLargCm,
        travesano_qty: editTravQty,
        travesano_cm: editTravCm
      });
      editMode = false;
      detailCard.hasCorrection = true;
      const allMats: CardMaterial[] = [];
      const curItem = detailCard.items[detailItemIdx];
      for (const it of detailCard.items) {
        const dm = parse2DItem(it.medida);
        if (!dm) continue;
        if (it === curItem) {
          allMats.push({ type: 'V', qty: 2 * it.cantidad, cm: dm.w });
          allMats.push({ type: 'V', qty: 2 * it.cantidad, cm: dm.h });
          if (editLargQty > 0) allMats.push({ type: 'L', qty: editLargQty, cm: editLargCm });
          if (editTravQty > 0) allMats.push({ type: 'T', qty: editTravQty, cm: editTravCm });
        } else {
          allMats.push(...calcMaterials(dm.w, dm.h, it.cantidad));
        }
      }
      detailCard.materials = consolidateMaterials(allMats);
      const corrs = await api.getInvoiceCorrections(detailCard.id);
      if (corrs.length > 0) {
        correctionsMap.set(detailCard.id, corrs[0]);
      }
      appStore.showToast('Corrección guardada', 'success');
      savedLargNum = editLargNum;
      savedTravQty = editTravQty;
    } catch (e) {
      appStore.alert('Error al guardar: ' + (e as Error).message);
    } finally {
      savingCorrection = false;
    }
  document.querySelector('.detail-item-row.selected')?.scrollIntoView?.({ block: 'nearest' });
  }

  function startEdit() {
    savedLargNum = editLargNum;
    savedTravQty = editTravQty;
    editMode = true;
  }

  function updateDetailItem() {
    const item = detailCard?.items[detailItemIdx];
    const dims = detailItemDims;
    if (!item || !dims) return;
    const shorter = Math.min(dims.w, dims.h);
    const formula = calcMaterials(dims.w, dims.h, item.cantidad);
    const l = formula.find(m => m.type === 'L');
    const t = formula.find(m => m.type === 'T');
    editLargNum = calcLargueros(Math.max(dims.w, dims.h));
    editLargCm = l?.cm ?? Math.round((shorter - 5.2) * 10) / 10;
    editTravQty = t?.qty ?? 0;
    const discount = editLargNum === 1 ? 9.0 : editLargNum === 2 ? 12.8 : 16.5;
    editTravCm = t?.cm ?? (editTravFilas > 0 ? Math.round(((Math.max(dims.w, dims.h) - discount) / (editLargNum + 1)) * 10) / 10 : 0);
  }

  async function switchDetailItem(i: number) {
    if (editMode && hasChanges) {
      if (await dialogConfirm('Hay cambios sin guardar. ¿Guardar antes de cambiar?')) {
        await saveCorrection();
      }
      editMode = false;
    }
    detailItemIdx = i;
    updateDetailItem();
  }

  function cancelEdit() {
    editMode = false;
    const dims = detailItemDims;
    if (!dims) return;
    const shorter = Math.min(dims.w, dims.h);
    const formula = calcMaterials(dims.w, dims.h, detailCard?.items[detailItemIdx]?.cantidad ?? 1);
    const l = formula.find(m => m.type === 'L');
    const t = formula.find(m => m.type === 'T');
    editLargNum = calcLargueros(Math.max(dims.w, dims.h));
    editLargCm = l?.cm ?? Math.round((shorter - 5.2) * 10) / 10;
    editTravQty = t?.qty ?? 0;
    const discount = editLargNum === 1 ? 9.0 : editLargNum === 2 ? 12.8 : 16.5;
    const filas = calcFilas(shorter);
    editTravCm = t?.cm ?? (filas > 0 ? Math.round(((Math.max(dims.w, dims.h) - discount) / (editLargNum + 1)) * 10) / 10 : 0);
  }

  async function restoreFormula() {
    if (!detailCard) return;
    if (!await dialogConfirm('¿Eliminar la corrección y restaurar valores de la fórmula?')) return;
    const corr = correctionsMap.get(detailCard.id);
    if (corr && (corr as any).id) {
      try {
        await api.deleteMolduraCorrection((corr as any).id);
      } catch (e) {
        appStore.alert('Error al eliminar corrección: ' + (e as Error).message);
        return;
      }
    }
    correctionsMap.delete(detailCard.id);
    detailCard.hasCorrection = false;
    editMode = false;
    updateDetailItem();
    const allMats: CardMaterial[] = [];
    for (const item of detailCard.items) {
      const dm = parse2DItem(item.medida);
      if (dm) allMats.push(...calcMaterials(dm.w, dm.h, item.cantidad));
    }
    detailCard.materials = consolidateMaterials(allMats);
    appStore.showToast('Fórmula restaurada', 'success');
  }

  async function closeDetailModal() {
    if (editMode && hasChanges && !await dialogConfirm('Hay cambios sin guardar. ¿Salir sin guardar?')) return;
    editMode = false;
    showDetailModal = false;
  }

  $effect(() => {
    if (!editMode) return;
    const item = detailCard?.items[detailItemIdx];
    const dims = detailItemDims;
    if (!item || !dims) return;
    const shorter = Math.min(dims.w, dims.h);
    const longer = Math.max(dims.w, dims.h);
    editLargCm = Math.round((shorter - 5.2) * 10) / 10;
    const discount = editLargNum === 1 ? 9.0 : editLargNum === 2 ? 12.8 : 16.5;
    editTravCm = editTravFilas > 0 ? Math.round(((longer - discount) / (editLargNum + 1)) * 10) / 10 : 0;
    editLargQty = editLargNum * item.cantidad;
  });

  onMount(() => { loadCards(); });
</script>

<div class="molduras">
  <div class="mol-header">
    <h2>Molduras</h2>
    <div class="mol-actions">
      <span class="selected-count">{selectedIds.size > 0 ? `${selectedIds.size} seleccionada(s)` : ''}</span>
      <button class="btn btn-sm btn-secondary" onclick={openAddDialog}>➕ Agregar Manual</button>
      <button class="btn btn-sm btn-secondary" onclick={syncStatus} disabled={loading}>🔗 Sincronizar</button>
      <button class="btn btn-sm btn-danger" onclick={markDone} disabled={selectedIds.size === 0}>🗑 Marcar Listo</button>
      <button class="btn btn-sm btn-primary" onclick={() => generatePDF(false)} disabled={selectedIds.size === 0 || generatingPdf}>
        {generatingPdf ? '...' : '📄 Ver PDF Sel.'}
      </button>
      <button class="btn btn-sm btn-success" onclick={() => generatePDF(true)} disabled={selectedIds.size === 0 || generatingPdf}>
        🖨 Imprimir Sel.
      </button>
      <button class="btn btn-sm btn-secondary" onclick={() => showFormulaModal = true}>📐 Fórmula</button>
      <button class="btn btn-sm btn-primary" onclick={loadCards} disabled={loading}>
        {loading ? 'Cargando...' : '🔄 Refrescar'}
      </button>
    </div>
  </div>

  {#if loading}
    <div class="mol-loading">Cargando molduras...</div>
  {:else if cards.length === 0}
    <div class="mol-empty">
      <p>No hay molduras pendientes.</p>
      <button class="btn btn-primary" onclick={openAddDialog}>➕ Agregar desde facturas existentes</button>
    </div>
  {:else}
    <div class="mol-scroll">
      <div class="mol-grid">
        {#each cards as card (card.id)}
          <div
            class="mol-card"
            class:selected={selectedIds.has(card.id)}
            onclick={() => toggleSelect(card.id)}
            ondblclick={() => openDetail(card)}
            role="button"
            tabindex="0"
            onkeydown={(e) => e.key === 'Enter' && toggleSelect(card.id)}
          >
            <div class="mol-card-header">
              <div>
                <div class="mol-card-cliente">{card.cliente}</div>
                <div class="mol-card-num">{card.num}{#if card.hasCorrection} <span class="corr-tag" title="Corregida manualmente">✏️</span>{/if}</div>
              </div>
              <button class="btn-detail-header" onclick={(e) => { e.stopPropagation(); openDetail(card); }} title="Ver detalle">🔍</button>
            </div>

            <div class="mol-card-body">
              <div class="mol-summary">
                <table class="mol-summary-table">
                  <thead>
                    <tr><th>CANT</th><th>MEDIDA</th></tr>
                  </thead>
                  <tbody>
                    {#each card.items as item}
                      <tr class:non-molding={item.isNonMolding}>
                        <td class="sm-qty">{item.cantidad}</td>
                        <td class="sm-measure">
                          {item.medida}
                          {#if item.isNonMolding}
                            <span class="sm-tag-no"> No moldura</span>
                          {:else}
                            <span class="sm-tipo"> {item.tipo}</span>
                          {/if}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>

              <div class="mol-materials">
                <table class="mol-materials-table">
                  <thead>
                    <tr>
                      <th colspan="2" class="th-var">VARILLA</th>
                      <th colspan="2" class="th-lar">LARGUERO</th>
                      <th colspan="2" class="th-tra">TRAV.</th>
                    </tr>
                    <tr>
                      <th class="td-var">#</th>
                      <th class="td-var">CM</th>
                      <th class="td-lar">#</th>
                      <th class="td-lar">CM</th>
                      <th class="td-tra">#</th>
                      <th class="td-tra">CM</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each groupMaterials(card.materials) as group}
                      <tr>
                        {#each ['V', 'L', 'T'] as t}
                          {#if group[t]}
                            <td class="td-{t === 'V' ? 'var' : t === 'L' ? 'lar' : 'tra'} td-val">{group[t].qty}</td>
                            <td class="td-{t === 'V' ? 'var' : t === 'L' ? 'lar' : 'tra'} td-val">{group[t].cm}</td>
                          {:else}
                            <td class="td-{t === 'V' ? 'var' : t === 'L' ? 'lar' : 'tra'}"></td>
                            <td class="td-{t === 'V' ? 'var' : t === 'L' ? 'lar' : 'tra'}"></td>
                          {/if}
                        {/each}
                      </tr>
                    {:else}
                      <tr><td colspan="6" class="mat-empty">Sin materiales</td></tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<!-- Add Manual Dialog -->
{#if showAddDialog}
  <div class="modal-overlay" onclick={() => showAddDialog = false} role="presentation">
    <div class="modal modal-add" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (showAddDialog = false)}>
      <h3>Agregar Facturas a Molduras</h3>
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

<!-- Formula Modal -->
{#if showFormulaModal}
  <div class="modal-overlay" onclick={() => showFormulaModal = false} role="presentation">
    <div class="modal modal-formula" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (showFormulaModal = false)}>
      <h3>📐 Fórmula de Materiales</h3>
      <div class="modal-body">
        <div class="formula-section">
          <h4 style="color:#2c3e50;">Varillas (V)</h4>
          <p>2 × <em>ancho</em> + 2 × <em>alto</em> por cada bastidor</p>
          <p class="formula-example">Siempre 4 varillas por bastidor (2 de cada medida)</p>
        </div>
        <div class="formula-section">
          <h4 style="color:#27ae60;">Largueros (L)</h4>
          <p>Cantidad según el lado <strong>más largo</strong>:</p>
          <ul>
            <li>90 – 129 cm → 1 larguero</li>
            <li>130 – 200 cm → 2 largueros</li>
            <li>&gt; 200 cm → 3 largueros</li>
          </ul>
          <p class="formula-example">Largo = lado_corto − 5.2 cm</p>
        </div>
        <div class="formula-section">
          <h4 style="color:#d35400;">Travesaños (T)</h4>
          <p>Filas según el lado <strong>más corto</strong>:</p>
          <ul>
            <li>90 – 129 cm → 1 fila</li>
            <li>≥ 130 cm → 2 filas</li>
          </ul>
          <p class="formula-example">Largo = (lado_largo − descuento) ÷ (largueros + 1)</p>
          <p class="formula-example">Descuento: 9.0cm (1L) · 12.8cm (2L) · 16.5cm (3L)</p>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" onclick={() => showFormulaModal = false}>Cerrar</button>
      </div>
    </div>
  </div>
{/if}

<!-- Detail Modal -->
{#if showDetailModal && detailCard}
  <div class="modal-overlay" onclick={closeDetailModal} role="presentation">
    <div class="modal modal-detail" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && closeDetailModal()}>
      <h3>📦 {detailCard.num} — {detailCard.cliente}</h3>
      <div class="detail-body">
        <div class="detail-items">
          <h4>Productos</h4>
          <div class="detail-items-list">
            {#each detailCard.items as item, i}
              <div
                class="detail-item-row"
                class:selected={detailItemIdx === i}
                class:non-molding={item.isNonMolding}
                onclick={() => switchDetailItem(i)}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === 'Enter' && (detailItemIdx = i)}
              >
                <span class="di-qty">{item.cantidad}x</span>
                <span class="di-measure">{item.medida}</span>
                <span class="di-type">{item.isNonMolding ? 'No moldura' : item.tipo}</span>
              </div>
            {/each}
          </div>
        </div>
        <div class="detail-svg">
          {#if detailItemDims}
            <Bastidor w={detailItemDims.w} h={detailItemDims.h} largueroQty={editLargNum} travesanoQty={editTravFilas} />
            <div class="detail-mat-info">
              <table class="detail-mat-table">
                <thead>
                  <tr><th></th><th>#</th><th>CM</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td style="font-weight:600;color:#2c3e50">Varilla</td>
                    <td>{2 * (detailItem?.cantidad ?? 1)}</td>
                    <td>{detailItemDims.w} / {detailItemDims.h}</td>
                  </tr>
                  <tr>
                    <td style="font-weight:600;color:#27ae60">Larguero</td>
                    {#if editMode}
                      <td><input type="number" class="mat-input" bind:value={editLargNum} min="0" /></td>
                    {:else}
                      <td><span class="mat-ro">{editLargNum}</span></td>
                    {/if}
                    <td><span class="mat-ro">{editLargCm}</span></td>
                  </tr>
                  <tr>
                    <td style="font-weight:600;color:#d35400">Traves.</td>
                    {#if editMode}
                      <td><input type="number" class="mat-input" bind:value={editTravQty} min="0" /></td>
                    {:else}
                      <td><span class="mat-ro">{editTravQty}</span></td>
                    {/if}
                    <td><span class="mat-ro">{editTravCm}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          {:else if detailItem?.isNonMolding}
            <div class="detail-no-molding">
              <span class="dnm-icon">🖼️</span>
              <p>Este producto no es una moldura</p>
              <p class="dnm-desc">{detailItem.medida}</p>
            </div>
          {:else}
            <div class="detail-no-molding">
              <span class="dnm-icon">👆</span>
              <p>Seleccione un producto de la lista</p>
            </div>
          {/if}
        </div>
      </div>
      <div class="modal-footer">
        <span class="corr-indicator" class:has-corr={detailCard.hasCorrection}>
          {detailCard.hasCorrection ? '✏️ Valores corregidos' : '📐 Fórmula original'}
        </span>
        <div class="modal-btn-group">
          {#if detailCard.hasCorrection && !editMode}
            <button class="btn btn-sm btn-outline" onclick={restoreFormula}>🔄 Restaurar fórmula</button>
          {/if}
          {#if !editMode}
            {#if detailItemDims}
              <button class="btn btn-sm btn-warning" onclick={startEdit}>✏️ Editar</button>
            {/if}
          {:else}
            {#if detailItemDims}
              <button class="btn btn-sm btn-warning" onclick={saveCorrection} disabled={savingCorrection}>
                {savingCorrection ? 'Guardando...' : '💾 Guardar'}
              </button>
            {/if}
            <button class="btn btn-secondary" onclick={cancelEdit}>Cancelar</button>
          {/if}
          <button class="btn btn-primary" onclick={closeDetailModal}>Cerrar</button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .molduras {
    padding: 1.143rem;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.857rem;
    background: #f5f6fa;
  }

  .mol-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .mol-header h2 { margin: 0; font-size: 1.3rem; color: #2c3e50; }
  .mol-actions { display: flex; align-items: center; gap: 0.571rem; }
  .selected-count { font-size: 0.8rem; color: #3498db; font-weight: 600; min-width: 8.571rem; text-align: right; }

  .mol-grid {
    column-width: 22rem;
    column-count: 3;
    column-gap: 0.857rem;
    padding: 0.143rem;
  }

  .mol-scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .mol-card {
    break-inside: avoid;
    display: inline-block;
    width: 100%;
    margin-bottom: 0.714rem;
    border: 0.214rem solid #000;
    border-radius: 0.571rem;
    background: #fff;
    overflow: hidden;
    cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .mol-card:hover { border-color: #333; box-shadow: 0 0.143rem 0.571rem rgba(0,0,0,0.1); }
  .mol-card.selected { border-color: #375a7f; box-shadow: 0 0 0 0.214rem rgba(55,90,127,0.25); }

  .mol-card-header {
    background: #000;
    color: #fff;
    padding: 0.429rem 0.714rem;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
  }
  .mol-card-cliente { font-weight: 900; font-size: 0.95rem; text-transform: uppercase; line-height: 1.2; letter-spacing: 0.02em; }
  .mol-card-num { font-size: 0.72rem; color: #bbb; margin-top: 0.071rem; }
  .corr-tag { font-size: 0.64rem; opacity: 0.7; }

  .btn-detail-header {
    background: none; border: none; color: rgba(255,255,255,0.5); cursor: pointer;
    font-size: 0.9rem; padding: 0.143rem; line-height: 1;
    border-radius: 0.286rem; transition: background 0.15s; flex-shrink: 0;
  }
  .btn-detail-header:hover { background: rgba(255,255,255,0.15); color: #fff; }

  .mol-card-body { padding: 0; }

  .mol-summary-table {
    width: 100%;
    border-collapse: collapse;
    background: #eee;
    border-bottom: 0.214rem solid #000;
    font-size: 0.82rem;
  }
  .mol-summary-table th {
    background: #ddd;
    padding: 0.286rem 0.571rem;
    text-align: left;
    font-size: 0.65rem;
    text-transform: uppercase;
    color: #555;
  }
  .mol-summary-table td {
    padding: 0.214rem 0.571rem;
    border: 1px solid #999;
  }
  .sm-qty { font-weight: 900; font-size: 1.15rem; width: 2.5rem; text-align: center; }
  .sm-measure { font-weight: 700; font-size: 1rem; }
  .sm-tipo { font-weight: 400; color: #666; font-size: 0.78rem; }
  .sm-tag-no { font-size: 0.68rem; color: #aaa; font-style: italic; }
  .mol-summary-table tr.non-molding { opacity: 0.5; }

  .mol-materials-table {
    width: 100%;
    border-collapse: collapse;
    text-align: center;
  }
  .mol-materials-table th {
    border: 1px solid #000;
    padding: 0.143rem 0.214rem;
    font-size: 0.62rem;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .mol-materials-table td {
    border: 1px solid #000;
    padding: 0.143rem;
    height: 1.8rem;
  }
  .th-var { background: #2c3e50; color: #fff; }
  .th-lar { background: #27ae60; color: #fff; }
  .th-tra { background: #d35400; color: #fff; }
  .td-var { background: #ebf5fb; }
  .td-lar { background: #e9f7ef; }
  .td-tra { background: #fdf2e9; }
  .td-val { font-weight: 900; font-size: 1rem; }
  .mat-empty { text-align: center; color: #bbb; padding: 0.429rem; font-size: 0.72rem; }

  .mol-loading, .mol-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #999;
    gap: 0.857rem;
  }

  .modal-add { min-width: 35.714rem; max-height: 70vh; }
  .modal-formula { min-width: 26rem; max-width: 90vw; }
  .modal-formula h3 { margin: 0 0 0.857rem; }
  .formula-section { margin-bottom: 0.857rem; }
  .formula-section h4 { margin: 0 0 0.286rem; font-size: 0.95rem; }
  .formula-section p { margin: 0.143rem 0; font-size: 0.82rem; color: #444; line-height: 1.4; }
  .formula-section ul { margin: 0.143rem 0; padding-left: 1.429rem; font-size: 0.82rem; color: #444; }
  .formula-section ul li { margin: 0.071rem 0; }
  .formula-example { font-size: 0.75rem !important; color: #888 !important; font-style: italic; }
  .modal-detail { min-width: 38rem; max-width: 90vw; min-height: 28rem; }
  .modal-detail h3 { margin: 0 0 0.714rem; }
  .detail-body { display: flex; gap: 1.143rem; flex: 1; min-height: 0; }
  .detail-items { flex: 0 0 16rem; display: flex; flex-direction: column; }
  .detail-items h4 { margin: 0 0 0.429rem; font-size: 0.85rem; color: #555; }
  .detail-items-list { flex: 1; overflow-y: auto; border: 1px solid #eee; border-radius: 0.429rem; }
  .detail-item-row {
    display: flex; align-items: center; gap: 0.571rem; padding: 0.5rem 0.571rem;
    cursor: pointer; border-bottom: 1px solid #f5f5f5; font-size: 0.82rem;
    transition: background 0.1s;
  }
  .detail-item-row:hover { background: #f0f4ff; }
  .detail-item-row.selected { background: #e8f4fd; }
  .detail-item-row.non-molding { opacity: 0.5; }
  .di-qty { font-weight: 700; min-width: 2rem; color: #2c3e50; }
  .di-measure { flex: 1; font-weight: 500; }
  .di-type { font-size: 0.72rem; color: #888; min-width: 4.286rem; text-align: right; }
  .detail-svg { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.857rem; min-height: 12rem; }
  .detail-mat-info { width: 100%; max-width: 16rem; }
  .detail-mat-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
  .detail-mat-table th { background: #e9ecef; padding: 0.286rem 0.571rem; text-align: center; font-size: 0.7rem; text-transform: uppercase; color: #666; }
  .detail-mat-table td { padding: 0.286rem 0.571rem; text-align: center; border-bottom: 1px solid #eee; }
  .detail-no-molding { text-align: center; color: #999; padding: 2rem; }
  .dnm-icon { font-size: 2.5rem; display: block; margin-bottom: 0.571rem; }
  .dnm-desc { font-size: 0.82rem; color: #bbb; margin-top: 0.286rem; }
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

  .mat-input {
    width: 3.571rem;
    padding: 0.214rem 0.286rem;
    border: 1px solid #ddd;
    border-radius: 0.286rem;
    font-size: 0.82rem;
    text-align: center;
    background: #fff;
  }
  .mat-input:focus { outline: none; border-color: #6366f1; }
  .mat-ro {
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--text-primary, #333);
    padding: 0.214rem 0;
    display: inline-block;
    min-width: 3rem;
    text-align: center;
  }

  .corr-indicator { font-size: 0.78rem; color: #888; font-weight: 500; }
  .corr-indicator.has-corr { color: #d97706; }

  .modal-btn-group { display: flex; gap: 0.571rem; }

  .btn-warning {
    background: #fef3c7;
    color: #b45309;
    border-color: #fcd34d;
  }
  .btn-warning:hover:not(:disabled) { background: #fde68a; }
</style>
