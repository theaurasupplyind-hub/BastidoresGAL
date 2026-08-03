<script lang="ts">
  import { mapaStore } from '$lib/stores/mapaStore.svelte';
  import { api } from '$lib/api/client';

  let {
    show, onclose, onsave
  }: {
    show: boolean;
    onclose: () => void;
    onsave: () => Promise<void>;
  } = $props();

  let min = $state(mapaStore.algoMinPorGrupo);
  let max = $state(mapaStore.algoMaxPorGrupo);
  let eps = $state(mapaStore.algoEpsKm);
  let guardando = $state(false);

  $effect(() => {
    if (show) {
      min = mapaStore.algoMinPorGrupo;
      max = mapaStore.algoMaxPorGrupo;
      eps = mapaStore.algoEpsKm;
    }
  });

  $effect(() => { mapaStore.algoMinPorGrupo = min; });
  $effect(() => { mapaStore.algoMaxPorGrupo = max; });
  $effect(() => { mapaStore.algoEpsKm = eps; });

  async function persistirConfig() {
    try {
      await api.updateMapaConfig({ cluster_min: min, cluster_max: max, cluster_eps_km: eps });
    } catch {}
  }

  async function guardar() {
    if (guardando) return;
    guardando = true;
    try {
      await persistirConfig();
      await onsave();
    } finally {
      guardando = false;
      onclose();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

{#if show}
  <div class="modal-overlay role-presentation" role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" onkeydown={handleKeydown} tabindex="-1">
      <div class="modal-header">
        <h2>⚙️ Configuración de Agrupamiento</h2>
        <button class="close-btn" onclick={onclose} disabled={guardando}>✕</button>
      </div>

      <div class="modal-body">
        <div class="config-panel">
          <div class="config-field">
            <label for="rec-min">Mínimo clientes por viaje</label>
            <div class="config-row">
              <input id="rec-min" type="range" bind:value={min} min="1" max="10" step="1" disabled={guardando} />
              <span class="config-val">{min}</span>
            </div>
          </div>
          <div class="config-field">
            <label for="rec-max">Máximo clientes por viaje</label>
            <div class="config-row">
              <input id="rec-max" type="range" bind:value={max} min="0" max="30" step="1" disabled={guardando} />
              <span class="config-val">{max === 0 ? '∞' : max}</span>
            </div>
          </div>
          <div class="config-field">
            <label for="rec-eps">Radio de agrupación (km)</label>
            <div class="config-row">
              <input id="rec-eps" type="range" bind:value={eps} min="0.5" max="15" step="0.5" disabled={guardando} />
              <span class="config-val">{eps} km</span>
            </div>
          </div>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-secondary" onclick={onclose} disabled={guardando}>Cancelar</button>
        <button class="btn-apply" onclick={guardar} disabled={guardando}>
          {guardando ? '⏳ Reagrupando...' : '✓ Guardar y reagrupar'}
        </button>
      </div>
    </div>
  </div>

  {#if guardando}
    <div class="reagrupar-screen">
      <div class="reagrupar-spinner"></div>
      <span class="reagrupar-text">Reagrupando viajes...</span>
    </div>
  {/if}
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

  .modal {
    background: var(--bg-card);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.2);
    width: 520px;
    max-width: 90vw;
    max-height: 85vh;
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
  .close-btn:disabled { opacity: 0.5; cursor: default; }
  .close-btn:disabled:hover { background: var(--bg-page); }

  .modal-body {
    padding: 16px 20px;
    overflow-y: auto;
    flex: 1;
  }

  .config-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--bg-page);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 10px 12px;
    margin-bottom: 12px;
  }

  .config-field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .config-field label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .config-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .config-row input[type="range"] {
    flex: 1;
    min-width: 0;
    accent-color: #2563eb;
  }

  .config-val {
    font-size: 12px;
    font-weight: 700;
    color: #2563eb;
    min-width: 42px;
    text-align: right;
  }

  .modal-footer {
    padding: 12px 20px 16px;
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    border-top: 1px solid var(--border);
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
  .btn-secondary:hover:not(:disabled) { background: #f9fafb; }
  .btn-secondary:disabled { opacity: 0.5; cursor: default; }

  .btn-apply {
    padding: 8px 20px;
    border: none;
    border-radius: 8px;
    background: #059669;
    color: white;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-apply:hover:not(:disabled) { background: #047857; }
  .btn-apply:disabled { opacity: 0.5; cursor: default; }

  .reagrupar-screen {
    position: fixed;
    inset: 0;
    z-index: 100000;
    background: rgba(15, 23, 42, 0.6);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    font-family: var(--font);
    animation: fadeIn 0.15s ease-out;
  }
  .reagrupar-spinner {
    width: 48px;
    height: 48px;
    border: 5px solid rgba(255, 255, 255, 0.3);
    border-top-color: #ffffff;
    border-radius: 50%;
    animation: reagrupar-spin 0.8s linear infinite;
  }
  .reagrupar-text {
    color: #ffffff;
    font-size: 16px;
    font-weight: 600;
  }
  @keyframes reagrupar-spin { to { transform: rotate(360deg); } }

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  @keyframes slideUp {
    from { opacity: 0; transform: translateY(20px) scale(0.97); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
</style>
