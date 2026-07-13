<script lang="ts">
  import { recomendarRutas, type GrupoRuta } from '$lib/utils/barrios';

  let { show, clientes, onclose, onseleccionar }: {
    show: boolean;
    clientes: { id: number; domicilio: string }[];
    onclose: () => void;
    onseleccionar: (ids: number[]) => void;
  } = $props();

  let grupos = $derived(recomendarRutas(clientes));
  let cerrando = $state(false);

  function seleccionar(grupo: GrupoRuta) {
    cerrando = true;
    setTimeout(() => {
      onseleccionar(grupo.clientesIds);
      onclose();
      cerrando = false;
    }, 150);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

{#if show}
  <div class="modal-overlay" class:cerrando onclick={onclose} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" onkeydown={handleKeydown} tabindex="-1">
      <div class="modal-header">
        <h2>🗺 Rutas recomendadas</h2>
        <button class="close-btn" onclick={onclose}>✕</button>
      </div>

      <div class="modal-body">
        {#if grupos.length === 0}
          <p class="empty-text">No se encontraron grupos para recomendar. Revisá que los clientes tengan el barrio o localidad en el domicilio.</p>
        {:else}
          <p class="info-text">Agrupados por barrios y localidades cercanas (máx. 3 por grupo)</p>
          <div class="grupos-list">
            {#each grupos as grupo, i}
              <div class="grupo-card">
                <div class="grupo-header">
                  <span class="grupo-num">📍 Grupo {i + 1}</span>
                  <span class="grupo-count">{grupo.totalClientes} cliente{grupo.totalClientes !== 1 ? 's' : ''}</span>
                </div>
                <div class="grupo-barrios">
                  {#each grupo.barrios as barrio, bi}
                    <span class="barrio-chip">{barrio}</span>
                    {#if bi < grupo.barrios.length - 1}
                      <span class="barrio-sep">·</span>
                    {/if}
                  {/each}
                </div>
                <button class="select-btn" onclick={() => seleccionar(grupo)} disabled={cerrando}>
                  ✓ Seleccionar y trazar ruta
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" onclick={onclose}>Cerrar</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    animation: fadeIn 0.15s ease-out;
  }
  .modal-overlay.cerrando {
    opacity: 0;
    transition: opacity 0.15s;
  }

  .modal {
    background: var(--bg-card);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    width: 480px;
    max-width: 90vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    animation: slideUp 0.2s ease-out;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px 0;
  }
  .modal-header h2 {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .close-btn {
    width: 28px;
    height: 28px;
    border: none;
    background: var(--bg-page);
    border-radius: 50%;
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
    transition: background 0.12s;
  }
  .close-btn:hover { background: var(--bg-hover); }

  .modal-body {
    padding: 16px 20px;
    overflow-y: auto;
    flex: 1;
  }

  .empty-text {
    text-align: center;
    color: var(--text-muted);
    font-size: 14px;
    padding: 32px 0;
  }

  .info-text {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 0 0 12px;
  }

  .grupos-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .grupo-card {
    border: 1px solid #e5e7eb;
    border-radius: 10px;
    padding: 14px 16px;
    transition: box-shadow 0.12s;
  }
  .grupo-card:hover {
    box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  }

  .grupo-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }

  .grupo-num {
    font-size: 15px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .grupo-count {
    font-size: 13px;
    font-weight: 600;
    color: #2563eb;
    background: #eff6ff;
    padding: 2px 10px;
    border-radius: 12px;
  }

  .grupo-barrios {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 12px;
  }

  .barrio-chip {
    font-size: 13px;
    color: var(--text-primary);
    font-weight: 500;
  }

  .barrio-sep {
    color: var(--text-muted);
    font-weight: 700;
  }

  .select-btn {
    width: 100%;
    padding: 9px;
    border: none;
    border-radius: 8px;
    background: #2563eb;
    color: white;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s;
  }
  .select-btn:hover:not(:disabled) { background: #1d4ed8; }
  .select-btn:disabled { opacity: 0.5; cursor: default; }

  .modal-footer {
    padding: 12px 20px 16px;
    display: flex;
    justify-content: flex-end;
  }

  .btn-secondary {
    padding: 8px 20px;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    background: #fff;
    color: var(--text-primary);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-secondary:hover { background: #f9fafb; }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes slideUp {
    from { opacity: 0; transform: translateY(20px) scale(0.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
</style>
