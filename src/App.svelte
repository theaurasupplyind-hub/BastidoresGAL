<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { appStore } from '$lib/stores/appStore.svelte';
  import type { AppConfig } from '$lib/types';
  import Login from '$lib/screens/Login.svelte';
  import Splash from '$lib/screens/Splash.svelte';
  import Dashboard from '$lib/screens/Dashboard.svelte';
  import TitleBar from '$lib/components/TitleBar.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import SettingsModal from '$lib/components/SettingsModal.svelte';
  import PreciosReferenciaModal from '$lib/components/PreciosReferenciaModal.svelte';
  import PricingRulesModal from '$lib/components/PricingRulesModal.svelte';

  let view = $state<'login' | 'splash' | 'dashboard'>('login');

  onMount(async () => {
    const saved = localStorage.getItem('theme-dark');
    document.documentElement.setAttribute('data-theme', saved === 'true' ? 'dark' : 'light');
    const zoom = localStorage.getItem('zoom-level');
    if (zoom) {
      const f = parseFloat(zoom);
      if (f && f !== 1) {
        document.documentElement.style.setProperty('--zoom', String(f));
        document.documentElement.setAttribute('data-zoom', 'true');
      }
    }

    try {
      const user = await invoke<{ user_id: number; user_name: string } | null>('get_user');
      if (user) {
        appStore.user = user;
        view = 'splash';
      }
    } catch { }

    try {
      const cfg = await invoke<AppConfig>('get_config');
      appStore.pdfStyle = cfg.selected_template_name;
      appStore.molduraTemplate = cfg.moldura_template;
    } catch { }
  });

  function handleLogin(user: { user_id: number; user_name: string }) {
    appStore.user = user;
    view = 'splash';
  }

  function handleSplashDone() {
    view = 'dashboard';
  }

  function handleLogout() {
    appStore.user = null;
    view = 'login';
  }
</script>

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
{#if appStore.showSettings}
  <SettingsModal />
{/if}
{#if appStore.showPreciosRef}
  <PreciosReferenciaModal />
{/if}
{#if appStore.showPricingRules}
  <PricingRulesModal />
{/if}

<style>
  :global(*) { margin: 0; padding: 0; box-sizing: border-box; }
  :global(body) { font-family: system-ui, -apple-system, sans-serif; overflow: hidden; }
  .app-shell { display: flex; flex-direction: column; height: calc(100vh - 3.5rem); }
</style>
