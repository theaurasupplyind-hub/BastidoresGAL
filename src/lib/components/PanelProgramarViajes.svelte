<script lang="ts">
  import type { Cliente } from '$lib/types';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { animate, spring } from 'animejs';

  let {
    grupos,
    grupoActivoId,
    todosLosClientes,
    clientesDelDia,
    fecha,
    modoProgramar,
    onclose,
    oncreategrupo,
    ondeletergrupo,
    onsetactivo,
    onsave,
    onremovecliente,
    onreorder,
  }: {
    grupos: Map<string, { id: string; nombre: string; clienteIds: number[]; ordenRuta: number[]; color: string }>;
    grupoActivoId: string | null;
    todosLosClientes: any[];
    clientesDelDia: any[];
    fecha: string;
    modoProgramar: boolean;
    onclose: () => void;
    oncreategrupo: () => void;
    ondeletergrupo: (id: string) => void;
    onsetactivo: (id: string | null) => void;
    onsave: () => void;
    onremovecliente: (groupId: string, clienteId: number) => void;
    onreorder: (groupId: string, nuevoOrden: number[]) => void;
  } = $props();

  let dragIndex = $state<number | null>(null);
  let grupoNombreEditando = $state<string | null>(null);
  let grupoNombreValue = $state('');

  const CONSOLA_COLORS = [
    { name: 'Rojo', hex: '#ef4444' },
    { name: 'Violeta', hex: '#8b5cf6' },
    { name: 'Celeste', hex: '#0ea5e9' },
    { name: 'Naranja', hex: '#f59e0b' },
    { name: 'Verde', hex: '#10b981' },
    { name: 'Rosa', hex: '#ec4899' },
  ];

  let grupoArray = $derived([...grupos.values()]);

  let grupoActivo = $derived(
    grupoActivoId ? grupos.get(grupoActivoId) ?? null : null
  );

  let clientesEnActivo = $derived.by(() => {
    if (!grupoActivo) return [];
    return grupoActivo.ordenRuta
      .map(id => {
        const c = todosLosClientes.find((cc: any) => cc.id === id) ?? clientesDelDia.find((cc: any) => cc.id === id);
        if (!c) return null;
        const facturas = clientesDelDia.find((cc: any) => cc.id === id)?.facturas ?? [];
        return { ...c, facturas };
      })
      .filter(Boolean);
  });

  function handleDragStart(e: DragEvent, index: number) {
    dragIndex = index;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
    }
    const target = e.currentTarget as HTMLElement;
    animate(target, {
      scale: 1.04,
      opacity: 0.85,
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      duration: 200,
      ease: 'outQuad',
    });
  }

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(e: DragEvent, dropIndex: number) {
    e.preventDefault();
    if (dragIndex === null || dragIndex === dropIndex || !grupoActivo) return;
    const newOrder = [...grupoActivo.ordenRuta];
    const [moved] = newOrder.splice(dragIndex, 1);
    newOrder.splice(dropIndex, 0, moved);
    onreorder(grupoActivo.id, newOrder);
    dragIndex = null;
    const target = e.currentTarget as HTMLElement;
    animate(target, {
      scale: [1.04, 1],
      boxShadow: ['0 4px 12px rgba(0,0,0,0.15)', 'none'],
      duration: 300,
      ease: spring({ stiffness: 180, damping: 14 }),
    });
  }

  function handleDragEnd(e: DragEvent) {
    dragIndex = null;
    const target = e.currentTarget as HTMLElement;
    animate(target, {
      scale: 1,
      opacity: 1,
      boxShadow: 'none',
      duration: 200,
      ease: 'outQuad',
    });
  }

  function iniciarRenombrar(grupoId: string) {
    const g = grupos.get(grupoId);
    if (!g) return;
    grupoNombreEditando = grupoId;
    grupoNombreValue = g.nombre;
  }

  function confirmarRenombrar() {
    if (!grupoNombreEditando) return;
    const g = grupos.get(grupoNombreEditando);
    if (g && grupoNombreValue.trim()) {
      const updated = new Map(grupos);
      updated.set(grupoNombreEditando, { ...g, nombre: grupoNombreValue.trim() });
      onreorder(grupoNombreEditando, g.ordenRuta);
    }
    grupoNombreEditando = null;
  }

  function facturaDate(factura: any): string {
    if (!factura?.fecha) return '';
    const d = factura.fecha;
    if (d.includes('/')) return d;
    return d;
  }

  function formatDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('es-AR');
  }
</script>

{#if modoProgramar}
  <div class="programar-panel visible">
    <div class="pp-header">
      <span class="pp-title">📦 Programar Viajes</span>
      <button class="pp-close" onclick={onclose}>✕</button>
    </div>

    <div class="pp-date-row">
      <span class="pp-label">Plan del {formatDate(fecha)}</span>
      <div class="pp-btn-row">
        <button class="pp-panel-btn" onclick={() => { onsave(); appStore.currentTab = 'panel-control'; }}>📋 Enviar a panel</button>
        <button class="pp-save-btn" onclick={onsave}>💾 Guardar</button>
      </div>
    </div>

    <div class="pp-grupos">
      <div class="pp-grupos-header">
        <span class="pp-section-title">Grupos</span>
        <button class="pp-add-grupo" onclick={oncreategrupo}>+ Nuevo</button>
      </div>

      <div class="pp-grupos-list">
        {#each grupoArray as grupo}
          <div
            class="pp-grupo-card"
            class:activo={grupo.id === grupoActivoId}
            onclick={() => onsetactivo(grupo.id === grupoActivoId ? null : grupo.id)}
          >
            <span class="pp-grupo-color" style="background:{grupo.color}"></span>
            {#if grupoNombreEditando === grupo.id && grupo.id === grupoActivoId}
              <input
                class="pp-grupo-nombre-input"
                bind:value={grupoNombreValue}
                onkeydown={(e) => { if (e.key === 'Enter') confirmarRenombrar(); if (e.key === 'Escape') grupoNombreEditando = null; }}
                onblur={confirmarRenombrar}
                autofocus
                onclick={(e) => e.stopPropagation()}
              />
            {:else}
              <span class="pp-grupo-nombre">{grupo.nombre}</span>
            {/if}
            <span class="pp-grupo-count">{grupo.clienteIds.length}</span>
            <div class="pp-grupo-actions">
              <button
                class="pp-grupo-btn"
                onclick={(e) => { e.stopPropagation(); iniciarRenombrar(grupo.id); }}
                title="Renombrar"
              >✏️</button>
              <button
                class="pp-grupo-btn pp-grupo-btn-del"
                onclick={(e) => { e.stopPropagation(); ondeletergrupo(grupo.id); }}
                title="Eliminar grupo"
              >🗑</button>
            </div>
          </div>
        {/each}
      </div>
    </div>

    {#if grupoActivo && clientesEnActivo.length > 0}
      <div class="pp-clientes">
        <span class="pp-section-title">{grupoActivo.nombre} — {clientesEnActivo.length} cliente{clientesEnActivo.length !== 1 ? 's' : ''}</span>
        <div class="pp-clientes-list">
          {#each clientesEnActivo as cliente, i}
            <div
              class="pp-cliente-card"
              draggable="true"
              ondragstart={(e) => handleDragStart(e, i)}
              ondragover={handleDragOver}
              ondrop={(e) => handleDrop(e, i)}
              ondragend={handleDragEnd}
              class:drag-over={dragIndex === i}
            >
              <span class="pp-drag-handle" title="Arrastrar para reordenar">⠿</span>
              <span class="pp-cliente-order">{i + 1}</span>
              <div class="pp-cliente-info">
                <div class="pp-cliente-nombre">{cliente.nombre}</div>
                <div class="pp-cliente-dir">{cliente.domicilio ?? ''}</div>
                {#if cliente.facturas && cliente.facturas.length > 0}
                  <div class="pp-cliente-facturas">
                    {#each cliente.facturas as f}
                      <span class="pp-factura-chip">
                        <span class="pp-factura-num">{f.numero_factura}</span>
                        <span class="pp-factura-date">{facturaDate(f)}</span>
                      </span>
                    {/each}
                  </div>
                {/if}
              </div>
              <button
                class="pp-remove-cliente"
                onclick={() => onremovecliente(grupoActivo.id, cliente.id)}
                title="Quitar del grupo"
              >✕</button>
            </div>
          {/each}
        </div>
      </div>
    {:else if grupoActivo}
      <div class="pp-empty">
        <p>Grupo sin clientes. Hacé clic en marcadores del mapa para agregarlos.</p>
      </div>
    {/if}

    {#if grupoArray.length === 0}
      <div class="pp-empty">
        <p>Sin grupos todavía. Creá uno para empezar.</p>
      </div>
    {/if}
  </div>
{/if}

<style>
  .programar-panel {
    position: fixed;
    top: 52px;
    right: 8px;
    width: 340px;
    max-height: calc(100vh - 64px);
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.12);
    display: flex;
    flex-direction: column;
    z-index: 500;
    overflow: hidden;
    font-family: var(--font);
    transform: translateY(-12px);
    opacity: 0;
    transition: transform 0.2s ease-out, opacity 0.2s ease-out;
    pointer-events: auto;
  }
  .programar-panel.visible {
    transform: translateY(0);
    opacity: 1;
  }

  .pp-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .pp-title {
    font-size: 14px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .pp-close {
    width: 24px;
    height: 24px;
    border: none;
    background: var(--bg-page);
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
  }
  .pp-close:hover { background: var(--bg-hover); }

  .pp-date-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    flex-shrink: 0;
  }

  .pp-label {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .pp-btn-row {
    display: flex;
    gap: 4px;
  }

  .pp-panel-btn {
    padding: 4px 8px;
    border: none;
    border-radius: 6px;
    background: #059669;
    color: white;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s;
    font-family: var(--font);
    white-space: nowrap;
  }
  .pp-panel-btn:hover { background: #047857; }

  .pp-save-btn {
    padding: 4px 10px;
    border: none;
    border-radius: 6px;
    background: #2563eb;
    color: white;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s;
    font-family: var(--font);
  }
  .pp-save-btn:hover { background: #1d4ed8; }

  .pp-grupos {
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .pp-grupos-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 12px;
  }

  .pp-section-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .pp-add-grupo {
    padding: 2px 8px;
    border: 1px dashed var(--border);
    border-radius: 6px;
    background: transparent;
    font-size: 11px;
    color: var(--text-secondary);
    cursor: pointer;
    font-family: var(--font);
  }
  .pp-add-grupo:hover { background: var(--bg-hover); color: var(--text-primary); }

  .pp-grupos-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 4px 8px 8px;
    max-height: 140px;
    overflow-y: auto;
  }

  .pp-grupo-card {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.1s;
    border: 1px solid transparent;
  }
  .pp-grupo-card:hover { background: var(--bg-hover); }
  .pp-grupo-card.activo {
    background: var(--bg-page);
    border-color: var(--border);
  }

  .pp-grupo-color {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .pp-grupo-nombre {
    flex: 1;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pp-grupo-nombre-input {
    flex: 1;
    font-size: 12px;
    padding: 2px 4px;
    border: 1px solid #2563eb;
    border-radius: 4px;
    outline: none;
    font-family: var(--font);
  }

  .pp-grupo-count {
    font-size: 11px;
    font-weight: 700;
    color: #2563eb;
    background: #eff6ff;
    padding: 1px 7px;
    border-radius: 10px;
    flex-shrink: 0;
  }

  .pp-grupo-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .pp-grupo-card:hover .pp-grupo-actions { opacity: 1; }

  .pp-grupo-btn {
    width: 20px;
    height: 20px;
    border: none;
    background: transparent;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .pp-grupo-btn:hover { background: var(--bg-hover); }

  .pp-clientes {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .pp-clientes .pp-section-title {
    padding: 6px 12px;
    flex-shrink: 0;
  }

  .pp-clientes-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .pp-cliente-card {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid #e5e7eb;
    transition: background 0.12s, box-shadow 0.12s;
    cursor: default;
  }
  .pp-cliente-card:hover { background: #f9fafb; }
  .pp-cliente-card.drag-over {
    box-shadow: 0 0 0 2px #2563eb;
    border-color: #2563eb;
  }
  .pp-cliente-card:active { opacity: 0.7; }

  .pp-drag-handle {
    font-size: 14px;
    color: var(--text-muted);
    cursor: grab;
    flex-shrink: 0;
    padding: 2px 0;
    line-height: 1;
    user-select: none;
  }
  .pp-drag-handle:active { cursor: grabbing; }

  .pp-cliente-order {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #2563eb;
    color: white;
    font-size: 10px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .pp-cliente-info {
    flex: 1;
    min-width: 0;
  }

  .pp-cliente-nombre {
    font-size: 13px;
    font-weight: 500;
    color: #111;
  }

  .pp-cliente-dir {
    font-size: 11px;
    color: #9ca3af;
  }

  .pp-cliente-facturas {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 4px;
  }

  .pp-factura-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    background: #f3f4f6;
    border-radius: 4px;
    font-size: 10px;
  }
  .pp-factura-num {
    font-weight: 600;
    color: #374151;
  }
  .pp-factura-date {
    color: #9ca3af;
  }

  .pp-remove-cliente {
    width: 18px;
    height: 18px;
    border: none;
    background: transparent;
    border-radius: 4px;
    cursor: pointer;
    font-size: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ef4444;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.12s;
    padding: 0;
  }
  .pp-cliente-card:hover .pp-remove-cliente { opacity: 1; }
  .pp-remove-cliente:hover { background: #fef2f2; }

  .pp-empty {
    padding: 24px 16px;
    text-align: center;
  }
  .pp-empty p {
    font-size: 13px;
    color: var(--text-muted);
    margin: 0;
  }
</style>
