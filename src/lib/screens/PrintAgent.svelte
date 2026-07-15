<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { listen } from '@tauri-apps/api/event';
  import { check } from '@tauri-apps/plugin-updater';
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
  let stationsPollId: ReturnType<typeof setInterval> | undefined;
  let jobHistoryPollId: ReturnType<typeof setInterval> | undefined;
  let jobHistory = $state<any[]>([]);
  let deletingStation = $state(false);
  let unlistenCompleted: (() => void) | undefined;
  let unlistenFailed: (() => void) | undefined;

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

    pollRemoteStations();
    stationsPollId = setInterval(pollRemoteStations, 10000);

    unlistenCompleted = await listen('print-job-completed', () => pollJobHistory());
    unlistenFailed = await listen('print-job-failed', () => pollJobHistory());

    if (config.station_api_key) {
      refreshStatus();
      pollId = setInterval(refreshStatus, 3000);
    }
    pollJobHistory();
    jobHistoryPollId = setInterval(pollJobHistory, 10000);
  });

  onDestroy(() => {
    if (pollId) clearInterval(pollId);
    if (stationsPollId) clearInterval(stationsPollId);
    if (jobHistoryPollId) clearInterval(jobHistoryPollId);
    if (unlistenCompleted) unlistenCompleted();
    if (unlistenFailed) unlistenFailed();
  });

  async function pollRemoteStations() {
    try {
      const stations = await invoke<any[]>('list_print_stations');
      appStore.activeStations = stations || [];
      if (!appStore.selectedStation && stations.length > 0) {
        appStore.selectedStation = stations[0];
        pollJobHistory();
      }
    } catch {
      appStore.activeStations = [];
    }
  }

  function isOnline(lastSeen: string | null): boolean {
    if (!lastSeen) return false;
    const dt = new Date(lastSeen).getTime();
    return (Date.now() - dt) < 300000;
  }

  async function pollJobHistory() {
    const key = getApiKey();
    if (!key) { jobHistory = []; return; }
    try {
      jobHistory = await invoke<any[]>('get_print_job_history', { stationKey: key });
    } catch {
      jobHistory = [];
    }
  }

  function getApiKey(): string | null {
    return config.station_api_key || (appStore.selectedStation?.api_key ?? null);
  }

  async function cancelJob(jobId: number) {
    if (!confirm('¿Cancelar este trabajo de impresión?')) return;
    const key = getApiKey();
    if (!key) { appStore.showToast('No hay API key', 'error'); return; }
    try {
      await invoke('cancel_print_job', { jobId, stationKey: key });
      appStore.showToast('Trabajo cancelado');
      pollJobHistory();
    } catch (e: any) {
      appStore.showToast('Error: ' + (e?.message || e), 'error');
    }
  }

  async function deleteStation(stationId: number) {
    if (!confirm('¿Eliminar esta estación?')) return;
    deletingStation = true;
    try {
      await invoke('delete_station', { stationId });
      appStore.showToast('Estación eliminada');
      pollRemoteStations();
    } catch (e: any) {
      appStore.showToast('Error: ' + (e?.message || e), 'error');
    } finally {
      deletingStation = false;
    }
  }

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
      pollRemoteStations();
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
      pollRemoteStations();
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
  let updateVersion = $state<string | null>(null);
  let updateBody = $state<string | null>(null);
  let checkingUpdate = $state(false);

  async function checkUpdate() {
    checkingUpdate = true;
    updateVersion = null;
    updateBody = null;
    try {
      const update = await check();
      if (update?.available) {
        updateVersion = update.version;
        updateBody = update.body || null;
      } else {
        appStore.showToast('Ya tenés la última versión', 'info');
      }
    } catch (e: any) {
      appStore.showToast('Error al buscar actualización: ' + (e?.message || e), 'error');
    } finally {
      checkingUpdate = false;
    }
  }

  async function installUpdate() {
    checkingUpdate = true;
    try {
      const update = await check();
      if (update?.available) {
        await update.downloadAndInstall();
      }
    } catch (e: any) {
      appStore.showToast('Error: ' + (e?.message || e), 'error');
    } finally {
      checkingUpdate = false;
    }
  }
</script>

<div class="print-agent">
  <h2>Impresión Remota</h2>

  <div class="update-card">
    <div class="update-row">
      <div>
        <span style="font-weight:600;">v2.1.0</span>
        {#if updateVersion}
          <span style="color:var(--accent);font-weight:600;margin-left:0.5rem;">→ v{updateVersion} disponible</span>
        {/if}
      </div>
      <div style="display:flex;gap:0.5rem;">
        {#if updateVersion}
          <button class="btn-primary" onclick={installUpdate} disabled={checkingUpdate}>
            {checkingUpdate ? 'Instalando...' : 'Instalar ahora'}
          </button>
        {:else}
          <button class="btn-secondary" onclick={checkUpdate} disabled={checkingUpdate}>
            {checkingUpdate ? 'Buscando...' : 'Buscar actualización'}
          </button>
        {/if}
      </div>
    </div>
    {#if updateBody}
      <div class="update-notes">{@html updateBody}</div>
    {/if}
  </div>

  <div class="print-agent-grid">
    <div class="print-agent-left">
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

      <div class="card">
        <h3>Estaciones activas</h3>
        {#if appStore.activeStations.length === 0}
          <p class="hint">No hay estaciones de impresión activas.</p>
        {:else}
          <div class="stations-list">
            {#each appStore.activeStations as s}
              <div class="station-row">
                <div class="station-info">
                  <span class="station-name">{s.name}</span>
                  <span class="station-meta">ID: {s.id}{#if s.user_name} — {s.user_name}{/if}</span>
                </div>
                <div class="station-actions">
                  <div class="station-status-badge" class:station-online={isOnline(s.last_seen)}>
                    {isOnline(s.last_seen) ? 'Activa' : 'Inactiva'}
                  </div>
                  <button class="btn-delete-station" onclick={() => deleteStation(s.id)} disabled={deletingStation} title="Eliminar estación">🗑</button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
        {#if appStore.activeStations.length > 1}
          <div class="form-row" style="margin-top:0.714rem;">
            <label>Estación destino</label>
            <select
              value={appStore.selectedStation?.id}
              onchange={(e) => {
                const sel = appStore.activeStations.find(s => s.id == (e.target as HTMLSelectElement).value);
                if (sel) { appStore.selectedStation = sel; pollJobHistory(); }
              }}
            >
              {#each appStore.activeStations as s}
                <option value={s.id}>{s.name} (ID: {s.id})</option>
              {/each}
            </select>
          </div>
        {/if}
      </div>
    </div>

    <div class="print-agent-right">
      <div class="card card-jobs">
        <div class="jobs-header">
          <h3>Trabajos de impresión</h3>
          {#if appStore.selectedStation}
            <span class="jobs-station-name">{appStore.selectedStation.name}</span>
          {/if}
        </div>
        {#if !appStore.selectedStation && !getApiKey()}
          <p class="hint">Seleccioná una estación destino para ver sus trabajos.</p>
        {:else if jobHistory.length === 0}
          <p class="hint">No hay trabajos en esta estación.</p>
        {:else}
          <div class="jobs-list">
            {#each jobHistory as j}
              <div class="job-row">
                <div class="job-info">
                  <span class="job-name">{j.file_name || `Job #${j.id}`}</span>
                  <span class="job-meta">
                    {#if j.created_by}Por: {j.created_by} · {/if}
                    {j.created_at ? new Date(j.created_at).toLocaleString() : ''}
                  </span>
                </div>
                <div class="job-actions">
                  <div class="job-status" class:job-ok={j.status === 'completed'} class:job-err={j.status === 'failed'} class:job-pen={j.status === 'pending' || j.status === 'claimed'} class:job-canc={j.status === 'cancelled'}>
                    {j.status === 'completed' ? '✅ OK' : j.status === 'failed' ? '❌ Falló' : j.status === 'claimed' ? '⏳ Imprimiendo' : j.status === 'cancelled' ? '✖ Cancelado' : '⏳ Pendiente'}
                  </div>
                  {#if j.status === 'pending' || j.status === 'claimed'}
                    <button class="btn-cancel-job" onclick={() => cancelJob(j.id)} title="Cancelar trabajo">✕</button>
                  {/if}
                </div>
              </div>
              {#if j.error_message}
                <div class="job-error">{j.error_message}</div>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .print-agent {
    padding: 1.429rem;
    height: 100%;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  .print-agent h2 {
    margin: 0 0 1.143rem 0;
    font-size: 1.429rem;
    flex-shrink: 0;
  }
  .update-card {
    background: var(--bg-card);
    border-radius: 0.714rem;
    padding: 1.143rem 1.429rem;
    margin-bottom: 1.143rem;
    box-shadow: 0 0.143rem 0.429rem rgba(0,0,0,0.06);
    flex-shrink: 0;
  }
  .update-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .update-notes {
    margin-top: 0.714rem;
    padding: 0.714rem;
    background: var(--bg-page);
    border-radius: 0.429rem;
    font-size: 0.857rem;
    color: var(--text-secondary);
    white-space: pre-wrap;
  }
  .card {
    background: var(--bg-card);
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
    color: var(--text-secondary);
    font-size: 0.857rem;
    margin-bottom: 1rem;
  }
  .form-row {
    margin-bottom: 1rem;
  }
  .form-row label {
    display: block;
    font-size: 0.857rem;
    color: var(--text-secondary);
    margin-bottom: 0.357rem;
  }
  .form-row input, .form-row select {
    width: 100%;
    padding: 0.571rem;
     border: 1px solid var(--border);
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
    color: var(--text-muted);
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
    color: var(--text-muted);
    margin-bottom: 0.214rem;
  }
  .stat-value {
    display: block;
    font-size: 0.929rem;
    font-weight: 600;
    color: var(--text-primary);
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
    background: var(--accent);
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
    background: var(--bg-hover);
    color: var(--text-secondary);
    border: none;
    border-radius: 0.429rem;
    cursor: pointer;
  }
  .btn-danger {
    padding: 0.571rem 1.429rem;
    background: var(--danger);
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
  .stations-list {
    display: flex;
    flex-direction: column;
    gap: 0.571rem;
  }
  .station-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.571rem 0.857rem;
    background: #f8f9fa;
    border-radius: 0.429rem;
    border: 1px solid #e9ecef;
  }
  .station-info {
    display: flex;
    flex-direction: column;
  }
  .station-name {
    font-weight: 600;
    color: var(--text-primary);
    font-size: 0.929rem;
  }
  .station-meta {
    font-size: 0.786rem;
    color: var(--text-muted);
  }
  .station-status-badge {
    padding: 0.214rem 0.714rem;
    border-radius: 1rem;
    font-size: 0.786rem;
    font-weight: 600;
  }
  .station-online {
    background: #d4edda;
    color: #155724;
  }
  .station-status-badge:not(.station-online) {
    background: #f8d7da;
    color: #721c24;
  }
  .station-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .btn-delete-station {
    background: none;
    border: 1px solid #ddd;
    border-radius: 0.429rem;
    cursor: pointer;
    padding: 0.286rem 0.5rem;
    font-size: 0.857rem;
    opacity: 0.6;
    transition: opacity 0.15s;
  }
  .btn-delete-station:hover {
    opacity: 1;
    border-color: #dc3545;
  }
  .jobs-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .job-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0.714rem;
    background: #f8f9fa;
    border-radius: 0.429rem;
    border: 1px solid #e9ecef;
  }
  .job-info {
    display: flex;
    flex-direction: column;
    flex: 1;
  }
  .job-name {
    font-weight: 600;
    font-size: 0.857rem;
    color: var(--text-primary);
  }
  .job-meta {
    font-size: 0.714rem;
    color: var(--text-muted);
  }
  .job-status {
    padding: 0.214rem 0.714rem;
    border-radius: 1rem;
    font-size: 0.786rem;
    font-weight: 600;
  }
  .job-pen {
    background: #fff3cd;
    color: #856404;
  }
  .job-ok {
    background: #d4edda;
    color: #155724;
  }
  .job-err {
    background: #f8d7da;
    color: #721c24;
  }
  .job-canc {
    background: #e5e7eb;
    color: #6b7280;
  }
  .job-error {
    font-size: 0.714rem;
    color: #dc3545;
    margin-top: -0.357rem;
    margin-bottom: 0.357rem;
  }
  .job-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .btn-cancel-job {
    background: none;
    border: 1px solid #fca5a5;
    border-radius: 0.357rem;
    color: #dc2626;
    cursor: pointer;
    padding: 0.143rem 0.429rem;
    font-size: 0.857rem;
    opacity: 0.6;
    transition: opacity 0.12s, background 0.12s;
  }
  .btn-cancel-job:hover {
    opacity: 1;
    background: #fef2f2;
  }
  .print-agent-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.143rem;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .print-agent-left {
    overflow-y: auto;
    min-height: 0;
  }
  .print-agent-right {
    overflow-y: auto;
    min-height: 0;
  }
  .card-jobs {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .card-jobs .hint {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 0;
  }
  .jobs-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.714rem;
  }
  .jobs-header h3 {
    margin: 0;
  }
  .jobs-station-name {
    font-size: 0.786rem;
    color: var(--accent);
    font-weight: 600;
    background: var(--accent-light, rgba(37,99,235,0.08));
    padding: 0.214rem 0.571rem;
    border-radius: 1rem;
  }
</style>
