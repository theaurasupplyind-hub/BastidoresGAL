<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { appStore } from '$lib/stores/appStore.svelte';
  import type { Factura } from '$lib/types';

  let { show, cards = [] as Factura[], onClose }: {
    show: boolean;
    cards: Factura[];
    onClose: () => void;
  } = $props();

  let config = $state<any>({});
  let selectedIds = $state<Set<number>>(new Set());
  let generating = $state(false);

  onMount(async () => {
    try { config = await invoke('get_config'); } catch {}
  });

  $effect(() => {
    if (show) {
      selectedIds = new Set(cards.map(c => c.id));
    }
  });

  function toggle(id: number) {
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
    } else {
      selectedIds.add(id);
    }
    selectedIds = new Set(selectedIds);
  }

  function selectAll() {
    selectedIds = new Set(cards.map(c => c.id));
  }

  function deselectAll() {
    selectedIds = new Set();
  }

  function toggleSelectAll() {
    if (selectedIds.size === cards.length) {
      deselectAll();
    } else {
      selectAll();
    }
  }

  async function handleGenerate(shouldPrint: boolean) {
    if (selectedIds.size === 0) return;
    const selected = cards.filter(c => selectedIds.has(c.id));

    const invoices = selected.map(c => ({
      numPresupuesto: c.numero_presupuesto,
      numFactura: c.numero_factura,
      fecha: c.fecha,
      clienteNombre: c.cliente_nombre,
      clienteDomicilio: c.cliente_domicilio + (c.cliente_piso_depto ? ` - ${c.cliente_piso_depto}` : ''),
      clienteTelefono: c.cliente_telefono,
      items: c.items.map(i => ({
        cantidad: i.cantidad,
        descripcion: i.descripcion,
        precio_unitario: i.precio_unitario ?? 0,
        total: i.total || (i.cantidad * (i.precio_unitario ?? 0)),
      })),
      total: c.total,
      envio: c.envio ?? 0,
      isPresupuesto: c.tipo === 'PRESUPUESTO',
      styleName: appStore.pdfStyle,
    }));

    generating = true;
    try {
      const pdfPath = await invoke<string>('generate_invoices_pdf', { invoices });

      if (shouldPrint) {
        try {
          await invoke('print_pdf', { path: pdfPath });
          appStore.showToast('Enviando a imprimir...', 'success');
        } catch (e: any) {
          const errMsg = e?.message ?? (typeof e === 'string' ? e : 'Error desconocido');
          if (errMsg.startsWith('NO_PRINTER:')) {
            appStore.alert(errMsg.replace('NO_PRINTER:', ''));
          } else if (errMsg.startsWith('NO_SE_PUDO_IMPRIMIR:')) {
            appStore.alert(errMsg.replace('NO_SE_PUDO_IMPRIMIR:', ''));
          } else {
            appStore.alert('Error al imprimir: ' + errMsg);
          }
        }
      } else {
        await invoke('open_pdf', { path: pdfPath });
        appStore.showToast('PDF generado', 'success');
      }
    } catch (e: any) {
      appStore.showToast('Error: ' + (e?.message || e), 'error');
    } finally {
      generating = false;
    }
  }

  async function handleSendToRemote() {
    if (selectedIds.size === 0) return;
    const selected = cards.filter(c => selectedIds.has(c.id));

    const invoices = selected.map(c => ({
      numPresupuesto: c.numero_presupuesto,
      numFactura: c.numero_factura,
      fecha: c.fecha,
      clienteNombre: c.cliente_nombre,
      clienteDomicilio: c.cliente_domicilio + (c.cliente_piso_depto ? ` - ${c.cliente_piso_depto}` : ''),
      clienteTelefono: c.cliente_telefono,
      items: c.items.map(i => ({
        cantidad: i.cantidad,
        descripcion: i.descripcion,
        precio_unitario: i.precio_unitario ?? 0,
        total: i.total || (i.cantidad * (i.precio_unitario ?? 0)),
      })),
      total: c.total,
      envio: c.envio ?? 0,
      isPresupuesto: c.tipo === 'PRESUPUESTO',
      styleName: appStore.pdfStyle,
    }));

    generating = true;
    try {
      const pdfPath = await invoke<string>('generate_invoices_pdf', { invoices });
      const u = appStore.user;
      const targetKey = (appStore.selectedStation || appStore.activeStations[0])?.api_key ?? null;
      await invoke('submit_print_job', {
        pdfPath,
        createdBy: u?.user_name || 'Desconocido',
        apiKey: targetKey,
      });
      appStore.showToast('Enviado a impresión remota');
    } catch (e: any) {
      appStore.showToast('Error: ' + (e?.message || e), 'error');
    } finally {
      generating = false;
    }
  }
</script>

{#if show}
  <div class="modal-overlay" onclick={onClose} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
      <div class="modal-header">
        <h3>Facturas ({cards.length})</h3>
        <button class="modal-close" onclick={onClose}>&times;</button>
      </div>

      <div class="modal-body">
        <div class="selection-bar">
          <button class="btn-link" onclick={toggleSelectAll}>
            {selectedIds.size === cards.length ? 'Deseleccionar todas' : 'Seleccionar todas'}
          </button>
          <span>{selectedIds.size} de {cards.length} seleccionadas</span>
        </div>

        <div class="invoice-list">
          {#each cards as card (card.id)}
            <label class="invoice-item" class:selected={selectedIds.has(card.id)}>
              <input
                type="checkbox"
                checked={selectedIds.has(card.id)}
                onchange={() => toggle(card.id)}
              />
              <div class="invoice-info">
                <span class="invoice-client">{card.cliente_nombre || 'Sin nombre'}</span>
                <span class="invoice-detail">
                  {card.tipo === 'PRESUPUESTO' ? 'Presupuesto' : 'Factura'} #{card.numero_factura || card.numero_presupuesto} — ${(card.total ?? 0).toLocaleString('es-AR')}
                </span>
              </div>
            </label>
          {/each}
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-pdf" onclick={() => handleGenerate(false)} disabled={selectedIds.size === 0 || generating}>
          {generating ? 'Generando...' : '📄 Ver PDF'}
        </button>
        <button class="btn btn-print" onclick={() => handleGenerate(true)} disabled={selectedIds.size === 0 || generating}>
          {generating ? 'Generando...' : '🖨 Imprimir'}
        </button>
        {#if appStore.activeStations.length > 0}
          <button class="btn btn-remote" onclick={() => handleSendToRemote()} disabled={selectedIds.size === 0 || generating}>
            {generating ? 'Generando...' : '📤 Enviar a sucursal'}
          </button>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: var(--bg-card);
    border-radius: 0.714rem;
    width: 90%;
    max-width: 500px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 0.286rem 1.143rem rgba(0,0,0,0.15);
  }
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.286rem;
    border-bottom: 1px solid var(--border-light);
  }
  .modal-header h3 { margin: 0; font-size: 1.143rem; }
  .modal-close {
    background: none;
    border: none;
    font-size: 1.429rem;
    cursor: pointer;
    color: var(--text-muted);
  }
  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 0.857rem 1.286rem;
  }
  .selection-bar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.714rem;
    font-size: 0.857rem;
    color: var(--text-secondary);
  }
  .btn-link {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 0.857rem;
    text-decoration: underline;
  }
  .btn-link:hover { color: #0056b3; }
  .invoice-list {
    display: flex;
    flex-direction: column;
    gap: 0.286rem;
  }
  .invoice-item {
    display: flex;
    align-items: center;
    gap: 0.714rem;
    padding: 0.571rem 0.714rem;
    border: 1px solid var(--border-light);
    border-radius: 0.429rem;
    cursor: pointer;
  }
  .invoice-item.selected { background: var(--accent-light); border-color: var(--accent); }
  .invoice-item:hover { background: var(--bg-page); }
  .invoice-item input[type="checkbox"] { margin: 0; }
  .invoice-info {
    display: flex;
    flex-direction: column;
    gap: 0.143rem;
  }
  .invoice-client { font-weight: 600; font-size: 0.929rem; }
  .invoice-detail { font-size: 0.786rem; color: #666; }
  .modal-footer {
    display: flex;
    gap: 0.571rem;
    padding: 1rem 1.286rem;
    border-top: 1px solid #eee;
    justify-content: flex-end;
  }
  .btn {
    padding: 0.571rem 1.286rem;
    border: none;
    border-radius: 0.429rem;
    cursor: pointer;
    font-weight: 500;
    font-size: 0.929rem;
  }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-pdf { background: var(--bg-hover); color: var(--text-secondary); }
  .btn-print { background: var(--accent); color: white; }
  .btn-remote { background: var(--accent-hover); color: white; }
  .btn-pdf:hover:not(:disabled) { background: var(--bg-hover); }
  .btn-print:hover:not(:disabled) { background: #0069d9; }
  .btn-remote:hover:not(:disabled) { background: #024f7a; }
</style>
