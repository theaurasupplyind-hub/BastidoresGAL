<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { slide } from 'svelte/transition';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { appStore } from '$lib/stores/appStore.svelte';
  import type { TabId } from '$lib/types';

  let maximized = $state(false);
  let moreOpen = $state(false);
  let usersOpen = $state(false);
  const win = getCurrentWindow();

  const PRIMARIOS: { id: TabId; label: string }[] = [
    { id: 'panel-control', label: 'Panel' },
    { id: 'kanban', label: 'Kanban' },
    { id: 'facturacion', label: 'Facturación' },
    { id: 'ficha-semanal', label: 'Ficha Sem.' },
    { id: 'mapa', label: 'Mapa' },
  ];

  const SECUNDARY_TABS: { id: TabId; icon: string; label: string }[] = [
    { id: 'molduras', icon: 'frame', label: 'Molduras' },
    { id: 'productos', icon: 'box', label: 'Productos' },
    { id: 'clientes', icon: 'user', label: 'Clientes' },
    { id: 'estadisticas', icon: 'chart', label: 'Estadísticas' },
    { id: 'analisis-usd', icon: 'usd', label: 'USD' },
    { id: 'papelera', icon: 'trash', label: 'Papelera' },
    { id: 'print-agent', icon: 'printer', label: 'Impresión' },
  ];

  const ICONS: Record<string, string> = {
    frame: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
    box: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    user: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    chart: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    usd: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 7H9.5a3 3 0 000 6h5a3 3 0 010 6H7"/></svg>',
    trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
    printer: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
  };

  async function checkMaximized() { maximized = await win.isMaximized(); }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.more-wrap')) moreOpen = false;
    if (!target.closest('.users-wrap')) usersOpen = false;
  }

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
    moreOpen = false;
  }
</script>

<div class="titlebar">
  <div class="tb-left">
    <div class="users-wrap">
      <button class="tb-btn-sm" onclick={() => { usersOpen = !usersOpen; moreOpen = false; }} title="Usuarios conectados">
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
    <div class="more-wrap">
      <button
        class="tb-btn-sm"
        class:active={moreOpen || SECUNDARY_TABS.some(t => appStore.currentTab === t.id)}
        onclick={() => { moreOpen = !moreOpen; usersOpen = false; }}
        title="Más opciones"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
      </button>
      {#if moreOpen}
        <div class="dropdown more-dropdown" transition:slide={{ duration: 120 }}>
          {#each SECUNDARY_TABS as tab}
            <button
              class="more-item"
              class:active={appStore.currentTab === tab.id}
              onclick={() => selectTab(tab.id)}
            >
              <span class="more-item-icon">{@html ICONS[tab.icon]}</span>
              <span class="more-item-label">{tab.label}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <div class="tb-tabs" data-tauri-drag-region>
    {#each PRIMARIOS as tab}
      <button
        class="tb-tab"
        class:active={appStore.currentTab === tab.id}
        onclick={() => selectTab(tab.id)}
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
    padding: 0.3rem 0.45rem;
    border: none;
    border-radius: 0.35rem;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.7rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .tb-btn-sm:hover { background: var(--bg-hover); color: var(--text-primary); }
  .tb-btn-sm.active { color: var(--accent); }
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
    gap: 0.2rem;
    flex: 1;
    justify-content: center;
    height: 100%;
  }
  .tb-tab {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.7rem;
    border: none;
    border-radius: 0.4rem;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.95rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
    height: fit-content;
    position: relative;
  }
  .tb-tab:hover { background: var(--bg-hover); color: var(--text-primary); }
  .tb-tab.active { color: var(--text-primary); }
  .tb-tab.active::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0.5rem;
    right: 0.5rem;
    height: 2px;
    background: var(--accent);
    border-radius: 0 0 2px 2px;
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

  .users-wrap, .more-wrap {
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
  .more-dropdown {
    left: 0;
    min-width: 11rem;
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
  .more-item {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: none;
    background: none;
    color: var(--text-secondary);
    font-size: 0.8rem;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    text-align: left;
  }
  .more-item:hover { background: var(--bg-hover); color: var(--text-primary); }
  .more-item.active { color: var(--accent); }
  .more-item-icon { display: flex; align-items: center; flex-shrink: 0; }
  .more-item-label { white-space: nowrap; }
</style>
