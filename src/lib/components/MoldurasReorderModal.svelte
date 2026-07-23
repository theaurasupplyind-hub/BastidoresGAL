<script lang="ts">
  import { appStore } from '$lib/stores/appStore.svelte';
  import { buildMoldurasHtmlByTemplate, PAGE_HEIGHT, splitIntoColumns, groupMaterials, renderSingleCardHtml, getTemplateCss } from '$lib/utils/molduras';
  import type { CardItem, CardMaterial } from '$lib/utils/molduras';
  import { invoke } from '@tauri-apps/api/core';

  interface CardData {
    cliente: string;
    num: string;
    items: CardItem[];
    materials: CardMaterial[];
  }

  let { show, cards, onClose }: {
    show: boolean;
    cards: CardData[];
    onClose: () => void;
  } = $props();

  let generatingPdf = $state(false);
  let cardHeights = $state<number[]>([]);
  let measureRef: HTMLDivElement | undefined = $state();

  function cardPxHeight(card: CardData, idx: number): number {
    const m = cardHeights[idx];
    if (m !== undefined && m > 0) return m + 8;
    if (appStore.molduraTemplate === 'juli') return 81 * card.items.length + 64;
    const g = groupMaterials(card.materials).length;
    return 44 * card.items.length + 32 * g + 124;
  }

  $effect(() => {
    if (!show || !measureRef || cards.length === 0) return;
    measureRef.innerHTML = '';
    const style = document.createElement('style');
    style.textContent = getTemplateCss(appStore.molduraTemplate);
    measureRef.appendChild(style);
    measureRef.innerHTML += cards.map((c, i) => renderSingleCardHtml(c, appStore.molduraTemplate, i)).join('');
    requestAnimationFrame(() => {
      const els = measureRef.querySelectorAll('.card');
      const h: number[] = [];
      els.forEach(el => {
        const idx = parseInt((el as HTMLElement).dataset.cardIdx ?? '-1');
        if (idx >= 0) h[idx] = el.offsetHeight;
      });
      cardHeights = h;
    });
  });

  interface PageGroup {
    cards: CardData[];
    height: number;
  }

  interface PageSim {
    col1: PageGroup;
    col2: PageGroup;
    pageNum: number;
    utilization: number;
  }

  function splitIntoPageGroups(c: CardData[]): PageGroup[] {
    const groups: PageGroup[] = [];
    let cur: CardData[] = [];
    let curH = 0;
    for (const card of c) {
      const idx = cards.indexOf(card);
      const h = cardHeights[idx] > 0 ? cardHeights[idx] + 8 : cardPxHeight(card, idx);
      if (cur.length > 0 && curH + h > PAGE_HEIGHT) {
        groups.push({ cards: cur, height: curH });
        cur = [card];
        curH = h;
      } else {
        cur.push(card);
        curH += h;
      }
    }
    if (cur.length > 0) groups.push({ cards: cur, height: curH });
    if (groups.length === 0) groups.push({ cards: [], height: 0 });
    return groups;
  }

  let pages = $derived.by((): PageSim[] => {
    const [left, right] = splitIntoColumns(cards, 2);
    const leftGroups = splitIntoPageGroups(left);
    const rightGroups = splitIntoPageGroups(right);
    const num = Math.max(leftGroups.length, rightGroups.length);
    const result: PageSim[] = [];
    for (let i = 0; i < num; i++) {
      result.push({
        col1: leftGroups[i] ?? { cards: [], height: 0 },
        col2: rightGroups[i] ?? { cards: [], height: 0 },
        pageNum: i + 1,
        utilization: Math.round(((leftGroups[i]?.height ?? 0) + (rightGroups[i]?.height ?? 0)) / (2 * PAGE_HEIGHT) * 100),
      });
    }
    return result;
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  async function handleViewPdf() {
    generatingPdf = true;
    try {
      const html = buildMoldurasHtmlByTemplate(cards, appStore.molduraTemplate);
      const pdfPath = await invoke<string>('generate_molduras_pdf', { html });
      await invoke('open_pdf', { path: pdfPath });
      appStore.showToast('PDF generado', 'success');
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      appStore.showToast('Error: ' + msg, 'error');
    } finally {
      generatingPdf = false;
    }
  }

  async function handlePrint() {
    generatingPdf = true;
    try {
      const html = buildMoldurasHtmlByTemplate(cards, appStore.molduraTemplate);
      const pdfPath = await invoke<string>('generate_molduras_pdf', { html });
      try {
        await invoke('print_pdf', { path: pdfPath });
        appStore.showToast('Enviando a imprimir...', 'success');
      } catch (e: any) {
        const errMsg = e?.message ?? String(e);
        if (errMsg.startsWith('NO_PRINTER:')) appStore.alert(errMsg.replace('NO_PRINTER:', ''));
        else if (errMsg.startsWith('NO_SE_PUDO_IMPRIMIR:')) appStore.alert(errMsg.replace('NO_SE_PUDO_IMPRIMIR:', ''));
        else appStore.alert('Error al imprimir: ' + errMsg);
      }
    } catch (e: any) {
      appStore.showToast('Error: ' + (e?.message ?? String(e)), 'error');
    } finally {
      generatingPdf = false;
    }
  }

  async function handleSendRemote() {
    generatingPdf = true;
    try {
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
      appStore.showToast('Error: ' + (e?.message ?? String(e)), 'error');
    } finally {
      generatingPdf = false;
    }
  }
</script>

{#snippet cardPreview(card: CardData)}
  <div class="preview-card">
    <div class="preview-card-inner">
      <div class="pc-header">
        <div class="pc-cliente">{card.cliente}</div>
        <div class="pc-num">{card.num}</div>
      </div>
      <table class="pc-summary">
        <thead><tr><th>CANT</th><th>MEDIDA</th><th>TIPO</th></tr></thead>
        <tbody>
          {#each card.items as item}
            <tr>
              <td class="pc-qty">{item.cantidad}</td>
              <td class="pc-measure">{item.medida}</td>
              <td class="pc-type">{item.isNonMolding ? 'No moldura' : item.tipo}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if card.materials.length > 0}
        <table class="pc-mats">
          <thead>
            <tr><th colspan="2" class="th-var">VARILLA</th><th colspan="2" class="th-lar">LARGUERO</th><th colspan="2" class="th-tra">TRAV.</th></tr>
            <tr><th class="td-var">#</th><th class="td-var">CM</th><th class="td-lar">#</th><th class="td-lar">CM</th><th class="td-tra">#</th><th class="td-tra">CM</th></tr>
          </thead>
          <tbody>
            {#each groupMaterials(card.materials) as group}
              <tr>
                {#each ['V', 'L', 'T'] as t}
                  {@const cls = t === 'V' ? 'var' : t === 'L' ? 'lar' : 'tra'}
                  {#if group[t]}
                    <td class="td-{cls}">{group[t].qty}</td>
                    <td class="td-{cls}">{group[t].cm}</td>
                  {:else}
                    <td class="td-{cls}"></td>
                    <td class="td-{cls}"></td>
                  {/if}
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  </div>
{/snippet}

{#if show}
  <div class="modal-overlay" onclick={onClose} role="presentation">
    <div class="modal modal-reorder" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={handleKeydown}>
      <div class="reorder-header">
        <h3>Vista previa — {cards.length} moldura(s)</h3>
        <span class="reorder-hint">{pages.length} página(s)</span>
        <button class="modal-close" onclick={onClose} aria-label="Cerrar">✕</button>
      </div>

      <div bind:this={measureRef} style="position:absolute;visibility:hidden;width:387px;z-index:-1;left:-9999px;top:0;"></div>

      <div class="reorder-body">
        {#each pages as page}
          <div class="page-block">
            <div class="page-divider">
              <span class="page-label">Página {page.pageNum}</span>
              <span class="page-cards">{page.col1.cards.length + page.col2.cards.length} tarjeta(s)</span>
              <span class="page-pct">{page.utilization}%</span>
            </div>
            <div class="page-cols">
              <div class="preview-col">
                {#each page.col1.cards as card}
                  {@render cardPreview(card)}
                {/each}
                {#if (PAGE_HEIGHT - page.col1.height) > 30}
                  <div class="empty-space">
                    <span class="empty-label">{Math.round(PAGE_HEIGHT - page.col1.height)}px libres</span>
                  </div>
                {/if}
              </div>
              <div class="preview-col">
                {#each page.col2.cards as card}
                  {@render cardPreview(card)}
                {/each}
                {#if (PAGE_HEIGHT - page.col2.height) > 30}
                  <div class="empty-space">
                    <span class="empty-label">{Math.round(PAGE_HEIGHT - page.col2.height)}px libres</span>
                  </div>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>

      <div class="reorder-footer">
        <div class="modal-actions">
          <button class="btn btn-secondary" onclick={onClose}>Cancelar</button>
        </div>
        <div class="modal-actions">
          <button class="btn btn-primary" onclick={handleViewPdf} disabled={generatingPdf}>
            {generatingPdf ? 'Generando...' : '📄 Ver PDF'}
          </button>
          <button class="btn btn-success" onclick={handlePrint} disabled={generatingPdf}>
            🖨 Imprimir
          </button>
          {#if appStore.activeStations.length > 0}
            <button class="btn btn-info" onclick={handleSendRemote} disabled={generatingPdf}>
              📤 Enviar a sucursal
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-reorder {
    width: 95vw;
    max-width: 1400px;
    height: 90vh;
    max-height: 900px;
    display: flex;
    flex-direction: column;
    padding: 0;
  }

  .reorder-header {
    display: flex;
    align-items: center;
    gap: 0.857rem;
    padding: 1rem 1.143rem;
    border-bottom: 1px solid var(--border-light);
    flex-shrink: 0;
  }
  .reorder-header h3 { margin: 0; font-size: 1.05rem; color: var(--text-primary); }
  .reorder-hint { flex: 1; font-size: 0.78rem; color: var(--text-muted); text-align: right; }
  .modal-close { background: none; border: none; font-size: 1.143rem; cursor: pointer; color: var(--text-muted); padding: 0.286rem; border-radius: 0.286rem; }
  .modal-close:hover { background: var(--bg-hover); color: var(--text-primary); }

  .reorder-body {
    flex: 1;
    padding: 0.571rem 1.143rem;
    overflow: auto;
    min-height: 0;
  }

  .page-block {
    margin-bottom: 1.429rem;
  }
  .page-block:last-child { margin-bottom: 0; }

  .page-divider {
    display: flex;
    align-items: center;
    gap: 0.571rem;
    margin-bottom: 0.571rem;
    padding: 0.286rem 0.571rem;
    background: var(--bg-hover);
    border-radius: 0.286rem;
    border-left: 3px solid var(--accent, #3b82f6);
  }
  .page-label {
    font-size: 0.85rem;
    font-weight: 800;
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .page-cards {
    font-size: 0.72rem;
    color: var(--text-muted);
  }
  .page-pct {
    margin-left: auto;
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--text-primary);
  }

  .page-cols {
    display: flex;
    gap: 0.857rem;
  }

  .preview-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.429rem;
    min-width: 0;
  }

  .preview-card {
    border: 2px solid #000;
    border-radius: 0.286rem;
    background: #fff;
    overflow: hidden;
  }

  .pc-header {
    background: #000;
    color: #fff;
    padding: 0.286rem 0.571rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.429rem;
  }
  .pc-cliente { font-weight: 900; font-size: 0.82rem; text-transform: uppercase; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pc-num { font-size: 0.65rem; color: #bbb; white-space: nowrap; flex-shrink: 0; }

  .pc-summary {
    width: 100%;
    border-collapse: collapse;
    background: #eee;
    border-bottom: 2px solid #000;
    font-size: 0.72rem;
  }
  .pc-summary th { background: #ddd; padding: 0.143rem 0.286rem; text-align: left; font-size: 0.6rem; text-transform: uppercase; color: var(--text-secondary); }
  .pc-summary td { padding: 0.143rem 0.286rem; border: 1px solid #999; }
  .pc-qty { font-weight: 900; font-size: 0.88rem; width: 2rem; text-align: center; }
  .pc-measure { font-weight: 700; font-size: 0.78rem; }
  .pc-type { font-size: 0.68rem; color: var(--text-secondary); }

  .pc-mats {
    width: 100%;
    border-collapse: collapse;
    text-align: center;
    font-size: 0.68rem;
  }
  .pc-mats th { border: 1px solid #000; padding: 0.143rem; font-weight: 900; text-transform: uppercase; font-size: 0.6rem; }
  .pc-mats td { border: 1px solid #000; padding: 0.143rem; height: 1.4rem; font-weight: 700; font-size: 0.72rem; }
  .th-var { background: #2c3e50; color: #fff; }
  .td-var { background: #ebf5fb; }
  .th-lar { background: #27ae60; color: #fff; }
  .td-lar { background: #e9f7ef; }
  .th-tra { background: #d35400; color: #fff; }
  .td-tra { background: #fdf2e9; }

  .empty-space {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 28px;
    background: repeating-linear-gradient(
      45deg,
      rgba(239, 68, 68, 0.06),
      rgba(239, 68, 68, 0.06) 6px,
      rgba(239, 68, 68, 0.02) 6px,
      rgba(239, 68, 68, 0.02) 12px
    );
    border: 1px dashed rgba(239, 68, 68, 0.3);
    border-radius: 0.286rem;
  }
  .empty-label {
    font-size: 0.65rem;
    color: #ef4444;
    font-weight: 600;
    opacity: 0.8;
    letter-spacing: 0.02em;
  }

  .reorder-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.857rem;
    padding: 0.857rem 1.143rem;
    border-top: 1px solid var(--border-light);
    flex-shrink: 0;
  }
  .modal-actions { display: flex; gap: 0.571rem; }
</style>
