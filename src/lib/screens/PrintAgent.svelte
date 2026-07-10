<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { appStore } from '$lib/stores/appStore.svelte';
  import type { AppConfig } from '$lib/types';

  let config = $state<AppConfig>({});
  let printers = $state<string[]>([]);
  let stationName = $state('');
  let agentStatus = $state<any>(null);
  let registering = $state(false);
  let unregistering = $state(false);
  let registeringPrinter = $state('');
  let pollId: ReturnType<typeof setInterval> | undefined;

  onMount(async () => {
    try {
      config = await invoke<AppConfig>('get_config');
      stationName = config.station_name || '';
    } catch {}

    try {
      printers = await invoke<string[]>('list_printers');
    } catch {
      printers = [];
    }

    if (config.station_api_key) {
      refreshStatus();
      pollId = setInterval(refreshStatus, 3000);
    }
  });

  onDestroy(() => {
    if (pollId) clearInterval(pollId);
  });

  async function refreshStatus() {
    try {
      agentStatus = await invoke('get_print_agent_status');
    } catch {}
  }

  async function registerStation() {
    if (!stationName.trim()) {
      appStore.showToast('Ingresá un nombre para la estación', 'error');
      return;
    }
    registering = true;
    try {
      const result = await invoke<{ id: number; api_key: string }>('register_station', {
        name: stationName.trim(),
      });
      appStore.showToast('Estación registrada correctamente');
      config = await invoke<AppConfig>('get_config');
      if (pollId) clearInterval(pollId);
      pollId = setInterval(refreshStatus, 3000);
    } catch (e: any) {
      appStore.showToast('Error al registrar: ' + (e?.message || e), 'error');
    } finally {
      registering = false;
    }
  }

  async function toggleAgent() {
    try {
      if (agentStatus?.running) {
        await invoke('stop_print_agent');
        appStore.showToast('Agent de impresión detenido');
      } else {
        await invoke('start_print_agent');
        appStore.showToast('Agent de impresión iniciado');
      }
      await refreshStatus();
    } catch (e: any) {
      appStore.showToast('Error: ' + (e?.message || e), 'error');
    }
  }

  async function unregisterStation() {
    if (!confirm('¿Desvincular esta estación? Se detendrá el agent si está activo.')) return;
    unregistering = true;
    try {
      if (agentStatus?.running) {
        await invoke('stop_print_agent');
      }
      await invoke('unregister_station');
      appStore.showToast('Estación desvinculada');
      config = await invoke<AppConfig>('get_config');
      if (pollId) clearInterval(pollId);
      pollId = undefined;
    } catch (e: any) {
      appStore.showToast('Error: ' + (e?.message || e), 'error');
    } finally {
      unregistering = false;
    }
  }

  async function savePrinter() {
    config.selected_printer = registeringPrinter || null;
    try {
      await invoke('save_config', { config });
      appStore.showToast('Impresora guardada');
    } catch (e: any) {
      appStore.showToast('Error: ' + (e?.message || e), 'error');
    }
  }

  let isRegistered = $derived(!!config.station_api_key);
  let stationDisplay = $derived(config.station_name || 'Sin nombre');
</script>

<div class="print-agent">
  <h2>Impresión Remota</h2>

  {#if !isRegistered}
    <div class="card">
      <h3>Registrar esta estación</h3>
      <p class="hint">Registrá esta PC como estación de impresión para poder recibir trabajos.</p>
      <div class="form-row">
        <label>Nombre de la estación</label>
        <input type="text" bind:value={stationName} placeholder="Ej: Sucursal Centro" />
      </div>
      <div class="form-row">
        <label>Impresora por defecto</label>
        {#if printers.length > 0}
          <select bind:value={registeringPrinter}>
            <option value="">Usar default del sistema</option>
            {#each printers as p}
              <option value={p}>{p}</option>
            {/each}
          </select>
        {:else}
          <select disabled><option>No se detectaron impresoras</option></select>
        {/if}
      </div>
      <button class="btn-primary" onclick={registerStation} disabled={registering || !stationName.trim()}>
        {registering ? 'Registrando...' : 'Registrar estación'}
      </button>
    </div>
  {:else}
    <div class="card">
      <div class="status-header">
        <div>
          <h3>{stationDisplay}</h3>
          <span class="station-id">ID: {config.station_id}</span>
        </div>
        <div class="status-badge" class:running={agentStatus?.running} class:stopped={!agentStatus?.running}>
          {agentStatus?.running ? 'Activo' : 'Inactivo'}
        </div>
      </div>

      <div class="status-grid">
        <div class="stat">
          <span class="stat-label">Último check</span>
          <span class="stat-value">
            {agentStatus?.last_poll ? new Date(agentStatus.last_poll).toLocaleTimeString() : 'Nunca'}
          </span>
        </div>
        <div class="stat">
          <span class="stat-label">Jobs procesados</span>
          <span class="stat-value">{agentStatus?.jobs_processed || 0}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Impresora</span>
          <span class="stat-value">{config.selected_printer || 'Default del sistema'}</span>
        </div>
      </div>

      {#if agentStatus?.last_error}
        <div class="error-box">
          Último error: {agentStatus.last_error}
        </div>
      {/if}

      <div class="actions">
        <button class="btn-primary" onclick={toggleAgent}>
          {agentStatus?.running ? 'Detener agent' : 'Iniciar agent'}
        </button>
        <button class="btn-danger" onclick={unregisterStation} disabled={unregistering}>
          {unregistering ? 'Desvinculando...' : 'Desvincular estación'}
        </button>
      </div>
    </div>

    <div class="card">
      <h3>Configuración</h3>
      <div class="form-row">
        <label>Impresora destino</label>
        {#if printers.length > 0}
          <select bind:value={config.selected_printer}>
            <option value={null}>Usar default del sistema</option>
            {#each printers as p}
              <option value={p}>{p}</option>
            {/each}
          </select>
        {:else}
          <select disabled><option>No se detectaron impresoras</option></select>
        {/if}
      </div>
      <button class="btn-secondary" onclick={savePrinter}>Guardar impresora</button>
    </div>
  {/if}
</div>

<style>
  .print-agent {
    padding: 1.429rem;
    max-width: 40rem;
  }
  .print-agent h2 {
    margin: 0 0 1.429rem 0;
    font-size: 1.429rem;
  }
  .card {
    background: white;
    border-radius: 0.714rem;
    padding: 1.429rem;
    margin-bottom: 1.143rem;
    box-shadow: 0 0.143rem 0.429rem rgba(0,0,0,0.06);
  }
  .card h3 {
    margin: 0 0 0.714rem 0;
    font-size: 1.143rem;
  }
  .hint {
    color: #666;
    font-size: 0.857rem;
    margin-bottom: 1rem;
  }
  .form-row {
    margin-bottom: 1rem;
  }
  .form-row label {
    display: block;
    font-size: 0.857rem;
    color: #555;
    margin-bottom: 0.357rem;
  }
  .form-row input, .form-row select {
    width: 100%;
    padding: 0.571rem;
    border: 1px solid #ddd;
    border-radius: 0.429rem;
    font-size: 0.929rem;
    box-sizing: border-box;
  }
  .status-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }
  .status-header h3 {
    margin: 0;
  }
  .station-id {
    font-size: 0.786rem;
    color: #999;
  }
  .status-badge {
    padding: 0.286rem 0.857rem;
    border-radius: 1rem;
    font-size: 0.786rem;
    font-weight: 600;
  }
  .status-badge.running {
    background: #d4edda;
    color: #155724;
  }
  .status-badge.stopped {
    background: #f8d7da;
    color: #721c24;
  }
  .status-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .stat {
    text-align: center;
  }
  .stat-label {
    display: block;
    font-size: 0.786rem;
    color: #999;
    margin-bottom: 0.214rem;
  }
  .stat-value {
    display: block;
    font-size: 0.929rem;
    font-weight: 600;
    color: #333;
  }
  .error-box {
    background: #fff3cd;
    border: 1px solid #ffc107;
    border-radius: 0.429rem;
    padding: 0.714rem;
    font-size: 0.857rem;
    color: #856404;
    margin-bottom: 1rem;
  }
  .actions {
    display: flex;
    gap: 0.571rem;
  }
  .btn-primary {
    padding: 0.571rem 1.429rem;
    background: #007bff;
    color: white;
    border: none;
    border-radius: 0.429rem;
    cursor: pointer;
    font-weight: 500;
  }
  .btn-primary:disabled {
    background: #ccc;
    cursor: not-allowed;
  }
  .btn-secondary {
    padding: 0.571rem 1.429rem;
    background: #ecf0f1;
    color: #555;
    border: none;
    border-radius: 0.429rem;
    cursor: pointer;
  }
  .btn-danger {
    padding: 0.571rem 1.429rem;
    background: #dc3545;
    color: white;
    border: none;
    border-radius: 0.429rem;
    cursor: pointer;
    font-weight: 500;
  }
  .btn-danger:disabled {
    background: #e8a4ab;
    cursor: not-allowed;
  }
</style>
