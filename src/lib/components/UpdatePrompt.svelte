<script lang="ts">
  import { onMount } from 'svelte';
  import { check } from '@tauri-apps/plugin-updater';
  import { relaunch } from '@tauri-apps/plugin-process';

  let available = $state(false);
  let version = $state<string | null>(null);
  let notes = $state<string | null>(null);
  let downloading = $state(false);
  let dismissed = $state(false);

  export async function checkOnStartup() {
    try {
      const dismissedVersion = localStorage.getItem('updater:dismissed');
      const update = await check();
      if (update?.available) {
        // Si el usuario descartó esta versión, no mostrar de nuevo
        if (dismissedVersion === update.version) return;
        available = true;
        version = update.version;
        notes = update.body || null;
        // Guardar el objeto update para instalar sin re-check (evita doble fetch)
        pendingUpdate = update;
      }
    } catch {
      // Silencioso: sin conexión, sin release, etc.
    }
  }

  let pendingUpdate: any = null;

  onMount(() => {
    checkOnStartup();
  });

  function dismiss() {
    if (version) localStorage.setItem('updater:dismissed', version);
    dismissed = true;
    available = false;
  }

  async function install() {
    if (!pendingUpdate) {
      try {
        const u = await check();
        if (!u?.available) return;
        pendingUpdate = u;
      } catch { return; }
    }
    downloading = true;
    try {
      await pendingUpdate.downloadAndInstall();
      await relaunch();
    } catch (e: any) {
      downloading = false;
      // Dejar que el usuario reintente
      console.error('Updater install failed', e);
    }
  }
</script>

{#if available && !dismissed && version}
  <div class="updater-prompt" role="dialog" aria-label="Actualización disponible">
    <div class="updater-icon">⬆</div>
    <div class="updater-body">
      <div class="updater-title">Actualización disponible — v{version}</div>
      {#if notes}
        <div class="updater-notes">{notes}</div>
      {/if}
    </div>
    <div class="updater-actions">
      <button class="updater-btn primary" onclick={install} disabled={downloading}>
        {downloading ? 'Descargando…' : 'Actualizar'}
      </button>
      <button class="updater-btn ghost" onclick={dismiss} disabled={downloading}>Más tarde</button>
    </div>
  </div>
{/if}

<style>
  .updater-prompt {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    z-index: 9999;
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    max-width: 22rem;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    border-radius: 0.75rem;
    box-shadow: 0 8px 24px rgba(0,0,0,0.12);
    padding: 0.875rem 1rem;
  }
  .updater-icon {
    flex-shrink: 0;
    width: 2rem;
    height: 2rem;
    border-radius: 0.5rem;
    background: #2c3e50;
    color: #fff;
    display: grid;
    place-items: center;
    font-weight: 700;
  }
  .updater-body { flex: 1; min-width: 0; }
  .updater-title { font-weight: 700; font-size: 0.875rem; color: #111827; }
  .updater-notes {
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: #6b7280;
    white-space: pre-wrap;
    max-height: 5rem;
    overflow: auto;
  }
  .updater-actions { display: flex; flex-direction: column; gap: 0.375rem; flex-shrink: 0; }
  .updater-btn {
    padding: 0.4rem 0.75rem;
    border-radius: 0.5rem;
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .updater-btn.primary { background: #2c3e50; color: #fff; }
  .updater-btn.primary:disabled { opacity: 0.6; cursor: wait; }
  .updater-btn.ghost { background: #f3f4f6; color: #374151; border-color: #e5e7eb; }
</style>
