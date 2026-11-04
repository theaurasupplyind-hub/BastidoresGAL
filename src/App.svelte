<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import { api } from '$lib/api/client';
  import * as molduraFormula from '$lib/stores/molduraFormula';
  import type { AppConfig } from '$lib/types';
  import Login from '$lib/screens/Login.svelte';
  import Splash from '$lib/screens/Splash.svelte';
  import Dashboard from '$lib/screens/Dashboard.svelte';
  import TitleBar from '$lib/components/TitleBar.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import SettingsModal from '$lib/components/SettingsModal.svelte';
  import PreciosReferenciaModal from '$lib/components/PreciosReferenciaModal.svelte';
  import PricingRulesModal from '$lib/components/PricingRulesModal.svelte';
  import EstimationRulesModal from '$lib/components/EstimationRulesModal.svelte';
  import PdfTimerWidget from '$lib/components/PdfTimerWidget.svelte';
  import UpdatePrompt from '$lib/components/UpdatePrompt.svelte';
  import Lupa from '$lib/components/Lupa.svelte';
  import AssistantDrawer from '$lib/components/AssistantDrawer.svelte';
  import { assistant } from '$lib/assistant/store.svelte';

  let view = $state<'login' | 'splash' | 'dashboard'>('login');

  function onGlobalKeydown(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (event.key.toLowerCase() !== 'j') return;
    if (view !== 'dashboard') return;
    // No abrir encima de un modal abierto.
    if (document.querySelector('.modal-overlay')) return;
    event.preventDefault();
    assistant.toggle();
  }

  onMount(async () => {
    window.addEventListener('keydown', onGlobalKeydown);
    const saved = localStorage.getItem('theme-dark');
    document.documentElement.setAttribute('data-theme', saved === 'true' ? 'dark' : 'light');

    try {
      const user = await invoke<{ user_id: number; user_name: string } | null>('get_user');
      if (user) {
        appStore.user = user;
        view = 'splash';
        warmCache();
      }
    } catch { }

    try {
      const cfg = await invoke<AppConfig>('get_config');
      appStore.pdfStyle = cfg.selected_template_name;
      appStore.sortDimsEnabled = cfg.sort_dims_enabled ?? true;
      appStore.molduraMerged = cfg.moldura_merged ?? false;
    } catch { }

    // Fórmula de molduras configurable (backend compartido + caché local).
    molduraFormula.load().catch(() => {});
  });

  onDestroy(() => {
    window.removeEventListener('keydown', onGlobalKeydown);
  });

  // Precarga al iniciar: UNA llamada para cada lista compartida, que todas las
  // pantallas reutilizan desde la caché (clave única `facturas` para el listado
  // completo de facturas). Fire-and-forget: no bloquea el login.
  function warmCache() {
    cacheStore.fetch('facturas', () => api.listFacturas({ limit: 2000 }), 300000).catch(() => {});
    cacheStore.fetch('clientes', () => api.listClientes(), 1800000).catch(() => {});
    cacheStore.fetch('productos', () => api.listProductos(), 1800000).catch(() => {});
    cacheStore.fetch('pagos', () => api.listPagos(), 120000).catch(() => {});
    cacheStore.fetch('preciosReferencia', () => api.getPreciosReferencia(), 1800000).catch(() => {});
    cacheStore.fetch('estimationRules', () => api.getEstimationRules(), 1800000).catch(() => {});
    // Purga automática de NO_CONFIRMADO >30 días (soft-delete a papelera, throttled 12h)
    // Fire-and-forget; no bloquea login. Usa backend si existe, si no fallback local.
    import('$lib/utils/purgeNoConfirmadas').then(m => m.purgeNoConfirmadasVencidas({ silent: false }).catch(() => {})).catch(() => {});
  }

  function handleLogin(user: { user_id: number; user_name: string }) {
    appStore.user = user;
    view = 'splash';
    warmCache();
  }

  function handleSplashDone() {
    view = 'dashboard';
  }

  function handleLogout() {
    appStore.user = null;
    view = 'login';
  }
</script>

<div id="zoom-surface">
  <TitleBar />
  <div class="app-shell">
  {#if view === 'login'}
    <Login onLogin={handleLogin} />
  {:else if view === 'splash'}
    <Splash onDone={handleSplashDone} />
  {:else if view === 'dashboard'}
    <Dashboard onLogout={handleLogout} />
  {/if}
  </div>

  <Toast />
  <PdfTimerWidget />
  <UpdatePrompt />
  {#if appStore.showSettings}
    <SettingsModal />
  {/if}
  {#if appStore.showPreciosRef}
    <PreciosReferenciaModal />
  {/if}
  {#if appStore.showPricingRules}
    <PricingRulesModal />
  {/if}
  {#if appStore.showEstimationRules}
    <EstimationRulesModal />
  {/if}

  {#if view === 'dashboard' && !assistant.open}
    <button
      type="button"
      class="assistant-fab"
      title="Asistente (Ctrl+J)"
      aria-label="Abrir asistente"
      onclick={() => assistant.openDrawer('chat')}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" />
        <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" />
      </svg>
      <span>Asistente</span>
    </button>
  {/if}

  {#if assistant.open}
    <AssistantDrawer />
  {/if}
</div>

<Lupa />

<style>
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) { font-family: system-ui, -apple-system, sans-serif; overflow: hidden; }
  :global(#zoom-surface) { height: 100%; }
  .app-shell { display: flex; flex-direction: column; height: calc(100vh - 3.5rem); }

  .assistant-fab {
    position: fixed;
    right: 1.25rem;
    bottom: 5.25rem;
    z-index: 8000;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.55rem 0.85rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-card);
    color: var(--text-primary);
    font: inherit;
    font-size: 0.82rem;
    font-weight: 550;
    box-shadow: var(--shadow-md);
    cursor: pointer;
    transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
  }

  .assistant-fab:hover {
    transform: translateY(-1px);
    border-color: var(--accent);
    box-shadow: var(--shadow-lg);
  }

  .assistant-fab svg { color: var(--accent); }

  .assistant-fab:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
