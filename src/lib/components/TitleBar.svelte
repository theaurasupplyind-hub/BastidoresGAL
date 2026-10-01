<script lang="ts">
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import { animate, spring } from 'animejs';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { appStore } from '$lib/stores/appStore.svelte';
  import type { TabId } from '$lib/types';
  import NavMenu from '$lib/components/NavMenu.svelte';

  let maximized = $state(false);
  let usersOpen = $state(false);
  let darkMode = $state(false);

  const win = getCurrentWindow();

  function toggleTheme() {
    darkMode = !darkMode;
    localStorage.setItem('theme-dark', String(darkMode));
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }

  const PRIMARIOS: { id: TabId; label: string }[] = [
    { id: 'panel-control', label: 'Panel' },
    { id: 'kanban', label: 'Proceso' },
    { id: 'facturacion', label: 'Facturación' },
    { id: 'ficha-semanal', label: 'Ficha Sem.' },
    { id: 'mapa', label: 'Mapa' },
  ];

  async function checkMaximized() { maximized = await win.isMaximized(); }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.users-wrap')) usersOpen = false;
  }

  onMount(() => {
    darkMode = localStorage.getItem('theme-dark') === 'true';
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  });

  $effect(() => {
    checkMaximized();
    const unlisten = win.onResized(checkMaximized);
    document.addEventListener('click', handleClickOutside);
    return () => {
      unlisten.then(fn => fn());
      document.removeEventListener('click', handleClickOutside);
    };
  });

  function minimize() { win.minimize(); }
  function toggleMax() { win.toggleMaximize(); }
  function close() { win.close(); }

  function selectTab(tab: TabId) {
    appStore.currentTab = tab;
    const s = new Set(appStore.dirtyTabs);
    s.delete(tab);
    appStore.dirtyTabs = s;
  }

  function handleTabClick(e: MouseEvent, tab: TabId) {
    const btn = e.currentTarget as HTMLElement;
    animate(btn, {
      scale: [1, 0.92, 1],
      duration: 600,
      ease: spring({ stiffness: 300, damping: 15 }),
    });
    selectTab(tab);
  }
</script>

<div class="titlebar">
  <div class="tb-left">
    <div class="users-wrap">
      <button class="tb-btn-sm" onclick={() => { usersOpen = !usersOpen; }} title="Usuarios conectados">
        <span class="online-dot"></span>
        <span class="online-count">{appStore.onlineCount}</span>
      </button>
      {#if usersOpen}
        <div class="dropdown users-dropdown" transition:slide={{ duration: 120 }}>
          <div class="dropdown-header">
            <span>Conectados</span>
            <button class="dropdown-close" onclick={() => usersOpen = false}>✕</button>
          </div>
          {#each appStore.onlineUsers as u}
            <div class="user-row">
              <span class="user-name">{u.user_name || u.name || '?'}</span>
              {#if u.activity}
                <span class="user-activity">{u.activity}</span>
              {/if}
            </div>
          {:else}
            <div class="user-row muted">Sin usuarios conectados</div>
          {/each}
        </div>
      {/if}
    </div>
    <button class="tb-btn-sm" onclick={() => appStore.showSettings = true} title="Configuración">
      {@html '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>'}
    </button>
    <button class="tb-btn-sm" onclick={toggleTheme} title={darkMode ? 'Modo claro' : 'Modo oscuro'}>
      {@html darkMode
        ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>'}
    </button>
    <NavMenu />
  </div>

  <div class="tb-tabs" data-tauri-drag-region>
    {#each PRIMARIOS as tab}
      <button
        class="tb-tab"
        class:active={appStore.currentTab === tab.id}
        onclick={(e) => handleTabClick(e, tab.id)}
        data-tauri-drag-region="false"
      >
        <span class="tb-tab-text">{tab.label}</span>
      </button>
    {/each}
  </div>

  <div class="tb-controls">
    <button class="ctrl-btn" onclick={minimize} title="Minimizar">
      <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="4" width="10" height="1.5" rx="0.5" fill="currentColor"/></svg>
    </button>
    <button class="ctrl-btn" onclick={toggleMax} title={maximized ? 'Restaurar' : 'Maximizar'}>
      {#if maximized}
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1.5" y="0" width="7" height="7" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="0.5" y="2.5" width="7" height="7" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
      {:else}
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
      {/if}
    </button>
    <button class="ctrl-btn ctrl-close" onclick={close} title="Cerrar">
      <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.5"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.5"/></svg>
    </button>
  </div>
</div>

<style>
  .titlebar {
    display: flex;
    align-items: center;
    height: 3.5rem;
    padding: 0 0.5rem;
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
    color: var(--text-primary);
    user-select: none;
    flex-shrink: 0;
    position: relative;
    z-index: 1000;
    gap: 0.25rem;
  }

  .tb-left {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    flex-shrink: 0;
  }
  .tb-btn-sm {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    padding: 0.35rem 0.55rem;
    border: none;
    border-radius: 0.4rem;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    white-space: nowrap;
  }
  .tb-btn-sm:hover { background: var(--bg-hover); color: var(--text-primary); }
  .online-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--success);
    flex-shrink: 0;
  }
  .online-count { font-size: 0.7rem; }

  .tb-tabs {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex: 1;
    justify-content: center;
    height: 100%;
  }
  .tb-tab {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.55rem 1rem;
    border: none;
    border-radius: 0.45rem;
    background: transparent;
    color: var(--text-muted);
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    height: fit-content;
    position: relative;
    transition:
      color 0.3s cubic-bezier(0.4, 0, 0.2, 1),
      background 0.3s cubic-bezier(0.4, 0, 0.2, 1),
      transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .tb-tab:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
    transform: scale(1.05);
  }
  .tb-tab.active { color: var(--text-primary); }
  .tb-tab::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0.5rem;
    right: 0.5rem;
    height: 3px;
    background: var(--accent);
    border-radius: 0 0 3px 3px;
    transform: scaleX(0);
    transform-origin: center;
    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .tb-tab:hover::before {
    transform: scaleX(0.4);
  }
  .tb-tab.active::before {
    transform: scaleX(1);
  }
  .tb-tab-text { line-height: 1; }

  .tb-controls {
    display: flex;
    align-items: center;
    height: 100%;
    flex-shrink: 0;
  }
  .ctrl-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3.143rem;
    height: 100%;
    border: none;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }
  .ctrl-btn:hover { background: var(--bg-hover); color: var(--text-primary); }
  .ctrl-close:hover { background: var(--danger); color: #fff; }

  .users-wrap {
    position: relative;
  }
  .dropdown {
    position: absolute;
    top: calc(100% + 0.35rem);
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    z-index: 2000;
  }
  .users-dropdown {
    left: 0;
    width: 14rem;
  }
  .dropdown-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.55rem 0.75rem;
    color: var(--text-primary);
    font-size: 0.8rem;
    font-weight: 600;
    border-bottom: 1px solid var(--border-light);
  }
  .dropdown-close {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.85rem;
    padding: 0.1rem;
  }
  .dropdown-close:hover { color: var(--text-primary); }
  .user-row {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 0.4rem 0.75rem;
    font-size: 0.78rem;
  }
  .user-name { color: var(--text-primary); font-weight: 500; }
  .user-activity { color: var(--text-muted); font-size: 0.7rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .user-row.muted { color: var(--text-muted); font-style: italic; }
</style>
