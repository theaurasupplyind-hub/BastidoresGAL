<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { slide } from 'svelte/transition';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { mapaStore } from '$lib/stores/mapaStore.svelte';
  import type { TabId, OnlineUser } from '$lib/types';
  import Clientes from './Clientes.svelte';
  import Productos from './Productos.svelte';
  import Facturacion from './Facturacion.svelte';
  import FichaSemanal from './FichaSemanal.svelte';
  import Produccion from './Produccion.svelte';
  import Molduras from './Molduras.svelte';
  import Estadisticas from './Estadisticas.svelte';
  import Gastos from './Gastos.svelte';
  import Kanban from './Kanban.svelte';
  import Papelera from './Papelera.svelte';
  import MapaClientes from './MapaClientes.svelte';
  import AnalisisUSD from './AnalisisUSD.svelte';
  import GastoRapido from './GastoRapido.svelte';
  import Caja from './Caja.svelte';

  let { onLogout }: { onLogout: () => void } = $props();

  const TABS: { id: TabId; icon: string; label: string }[] = [
    { id: 'kanban', icon: 'home', label: 'Kanban' },
    { id: 'gasto-rapido', icon: 'zap', label: 'Gasto Rápido' },
    { id: 'facturacion', icon: 'file', label: 'Facturación' },
    { id: 'ficha-semanal', icon: 'dollar', label: 'Ficha Semanal' },
    { id: 'gastos', icon: 'dollar', label: 'Gastos' },
    { id: 'molduras', icon: 'frame', label: 'Molduras' },
    { id: 'productos', icon: 'box', label: 'Productos' },
    { id: 'clientes', icon: 'user', label: 'Clientes' },
    { id: 'estadisticas', icon: 'chart', label: 'Estadísticas' },
    { id: 'analisis-usd', icon: 'usd', label: 'USD' },
    { id: 'mapa', icon: 'map', label: 'Mapa' },
    { id: 'papelera', icon: 'trash', label: 'Papelera' },
    { id: 'caja', icon: 'wallet', label: 'Caja' },
  ];

  let facturacionRef: any = null;
  let kanbanRef: any = null;
  let heartbeatId: ReturnType<typeof setInterval> | undefined;
  let onlineUsers: any[] = $state([]);
  let usersOpen = $state(false);

  onMount(() => {
    heartbeatId = setInterval(runHeartbeat, 10000);
    runHeartbeat();
    const handler = (e: Event) => {
      onlineUsers = (e as CustomEvent).detail;
    };
    window.addEventListener('users-update', handler);
    return () => {
      window.removeEventListener('users-update', handler);
    };
  });

  onDestroy(() => {
    if (heartbeatId) clearInterval(heartbeatId);
  });

  async function runHeartbeat() {
    try {
      const u = appStore.user;
      if (!u) return;
      await api.heartbeat(u.user_id, u.user_name);
      const [active, drafts] = await Promise.all([
        api.getActiveUsers(),
        api.getDrafts(),
      ]);
      const activeIds = new Set(active.map((a: any) => String(a.id)));
      const draftMap = new Map(drafts.map((d: any) => [String(d.user_id), d.client || '']));

      appStore.onlineCount = activeIds.size;
      // Emit event for the facturacion panel to pick up
      window.dispatchEvent(new CustomEvent('users-update', {
        detail: active.map((u: any) => ({
          ...u,
          is_online: true,
          activity: draftMap.get(String(u.id)) || '',
        }))
      }));
    } catch { }
  }

  const ICONS: Record<string, string> = {
    home: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    file: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
    dollar: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>',
    frame: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/></svg>',
    box: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    user: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    trash: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
    chart: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    usd: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 7H9.5a3 3 0 000 6h5a3 3 0 010 6H7"/></svg>',
    map: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>',
    gear: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.32 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>',
    zap: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
    wallet: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/></svg>',
  };

  function selectTab(tab: TabId) {
    appStore.currentTab = tab;
    // Mark as no longer dirty when visiting
    const s = new Set(appStore.dirtyTabs);
    s.delete(tab);
    appStore.dirtyTabs = s;
  }
</script>

<div class="app-layout">
  <nav class="sidebar">
    <div class="sidebar-tabs">
      {#each TABS as tab}
        <button
          class="tab-btn"
          class:active={appStore.currentTab === tab.id}
          onclick={() => selectTab(tab.id)}
          title={tab.label}
        >
          <span class="tab-icon">{@html ICONS[tab.icon]}</span>
        </button>
      {/each}
    </div>
    <div class="sidebar-users">
      <button class="users-toggle" onclick={() => usersOpen = !usersOpen} title="Usuarios conectados">
        <span class="users-dot">🟢</span>
        <span class="users-online-count">{appStore.onlineCount}</span>
      </button>
      {#if usersOpen}
        <div class="users-panel" transition:slide={{ duration: 120 }}>
          <div class="users-panel-header">
            <span>Conectados</span>
            <button class="users-panel-close" onclick={() => usersOpen = false}>✕</button>
          </div>
          {#each onlineUsers as u}
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
    <div class="sidebar-settings">
      <button class="settings-btn" onclick={() => appStore.showSettings = true} title="Configuración">
        <span class="settings-icon">{@html ICONS['gear']}</span>
      </button>
    </div>
  </nav>

  <div class="main-area">
    <header class="top-bar">
      {#if appStore.currentTab === 'facturacion'}
        <div class="tipo-toggle-bar">
          <button class="tipo-btn-bar" class:active={appStore.facturacionTipo === 'PRESUPUESTO'} onclick={() => facturacionRef?.setTipo('PRESUPUESTO')}>Presupuesto</button>
          <button class="tipo-btn-bar" class:active={appStore.facturacionTipo === 'BORRADOR'} onclick={() => facturacionRef?.setTipo('BORRADOR')}>Borrador</button>
        </div>
        <div class="factura-actions">
          <button class="top-btn" onclick={() => facturacionRef?.newInvoice()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nueva
          </button>
          {#if appStore.facturacionTipo === 'PRESUPUESTO'}
            <button class="top-btn" onclick={() => facturacionRef?.save()} disabled={appStore.facturacionSaving}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              {appStore.facturacionSaving ? 'Guardando...' : 'Guardar'}
            </button>
            <button class="top-btn" onclick={() => facturacionRef?.generatePDF()}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              Ver PDF
            </button>
            <button class="top-btn" onclick={() => facturacionRef?.generatePDF(true)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
              Imprimir
            </button>
            <button class="top-btn top-btn-imgs" onclick={() => facturacionRef?.openPriceList()}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
              Lista
            </button>
          {:else}
            <button class="top-btn top-btn-success" onclick={() => facturacionRef?.confirmBorrador()} disabled={appStore.facturacionSaving}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              Confirmar
            </button>
          {/if}
        </div>
      {/if}
      {#if appStore.currentTab === 'ficha-semanal'}
        <div class="filter-bar">
          <div class="filter-date-wrap">
            <svg class="filter-date-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <input class="filter-input filter-date" type="date" bind:value={appStore.fsStartDate} />
          </div>
          <div class="filter-date-wrap">
            <svg class="filter-date-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <input class="filter-input filter-date" type="date" bind:value={appStore.fsEndDate} />
          </div>
          <input class="filter-input filter-text" type="text" bind:value={appStore.fsFilterCliente} placeholder="Cliente..." />
          <select class="filter-input filter-select" bind:value={appStore.fsFilterEstado}>
            <option value="TODOS">Todos</option>
            <option value="PENDIENTE+PARCIAL">Pend+Par</option>
            <option value="PENDIENTE">Pendiente</option>
            <option value="PARCIAL">Parcial</option>
            <option value="PAGADO">Pagado</option>
          </select>
          <select class="filter-input filter-select" bind:value={appStore.fsFilterEntrega}>
            <option value="TODOS">Entrega</option>
            <option value="PENDIENTE">Pendiente</option>
            <option value="ENTREGADO">Entregado</option>
          </select>
          <button class="filter-clear-btn" onclick={() => { appStore.fsStartDate = ''; appStore.fsEndDate = ''; appStore.fsFilterCliente = ''; appStore.fsFilterEstado = 'TODOS'; appStore.fsFilterEntrega = 'TODOS'; }} title="Limpiar">✕</button>
        </div>
      {/if}
      {#if appStore.currentTab === 'kanban'}
        <div class="kanban-bar">
          <span class="kanban-status">Click: seleccionar · Ctrl+Click: multiselect · Arrastrar: mover</span>
          <span class="kanban-count">{appStore.kanbanSelectedCount > 0 ? `${appStore.kanbanSelectedCount} seleccionada(s)` : ''}</span>
          <button class="top-btn" onclick={() => kanbanRef?.deselectAll()} disabled={appStore.kanbanSelectedCount === 0}>✕ Deseleccionar</button>
        </div>
      {/if}
      {#if appStore.currentTab === 'mapa'}
        <div class="mapa-bar">
          <div class="mapa-bar-left">
            <label class="mapa-bar-label" for="mapa-fecha-input">Fecha</label>
            <input id="mapa-fecha-input" type="date" bind:value={mapaStore.fecha} class="mapa-bar-fecha" />
          </div>
          <div class="mapa-bar-center">
            <input type="text" placeholder="Buscar cliente..." bind:value={mapaStore.busqueda} class="mapa-bar-buscar" />
          </div>
          <div class="mapa-bar-right">
            {#if mapaStore.editandoOrigen}
              <input type="text" bind:value={mapaStore.origenDireccion} class="mapa-bar-origen-input" placeholder="Dirección..." />
              <button class="mapa-bar-btn-geo" onclick={() => mapaStore.geocodificarOrigen?.()} disabled={mapaStore.geocodificandoOrigen || !mapaStore.origenDireccion.trim()}>🌍</button>
              <button class="mapa-bar-btn-save" onclick={() => mapaStore.guardarOrigen?.()}>💾</button>
            {:else}
              <span class="mapa-bar-origen-label">📍 Salida:</span>
              <span class="mapa-bar-origen-text">{mapaStore.origenDireccion}</span>
              <button class="mapa-bar-btn-edit" onclick={() => mapaStore.editandoOrigen = true}>✏️</button>
            {/if}
          </div>
        </div>
      {/if}
    </header>

    <main class="content">
      <div class="tab-contents" class:tab-oculto={appStore.currentTab !== 'kanban'}>
        <Kanban bind:this={kanbanRef} />
      </div>
      <div class="tab-contents" class:tab-oculto={appStore.currentTab !== 'facturacion'}>
        <Facturacion bind:this={facturacionRef} />
      </div>
      {#if appStore.currentTab === 'ficha-semanal'}
        <FichaSemanal />
      {:else if appStore.currentTab === 'tela'}
        <Produccion />
      {:else if appStore.currentTab === 'molduras'}
        <Molduras />
      {:else if appStore.currentTab === 'productos'}
        <Productos />
      {:else if appStore.currentTab === 'gasto-rapido'}
        <GastoRapido />
      {:else if appStore.currentTab === 'clientes'}
        <Clientes />
      {:else if appStore.currentTab === 'mapa'}
        <MapaClientes />
      {:else if appStore.currentTab === 'estadisticas'}
        <Estadisticas />
      {:else if appStore.currentTab === 'gastos'}
        <Gastos />
      {:else if appStore.currentTab === 'papelera'}
        <Papelera />
      {:else if appStore.currentTab === 'analisis-usd'}
        <AnalisisUSD />
      {:else if appStore.currentTab === 'caja'}
        <Caja />
      {/if}
    </main>

  </div>
</div>

<style>
  .app-layout {
    display: flex;
    height: 100%;
    overflow: hidden;
  }

  .sidebar {
    width: 3.5rem;
    flex-shrink: 0;
    background: linear-gradient(180deg, #1a252f, #2c3e50);
    display: flex;
    flex-direction: column;
    overflow: visible;
    position: relative;
    z-index: 20;
  }
  .sidebar-tabs {
    display: flex;
    flex-direction: column;
    flex: 1;
  }
  .tab-btn {
    padding: 0.643rem 0;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 1.3rem;
    color: #95a5a6;
    text-align: center;
    border-left: 0.214rem solid transparent;
    transition: all 0.12s;
    position: relative;
  }
  .tab-btn:hover { background: rgba(255,255,255,0.06); color: #ecf0f1; }
  .tab-btn.active {
    color: white;
    background: rgba(255,255,255,0.12);
    border-left-color: #3498db;
  }
  .tab-icon { display: block; line-height: 1; }

  .sidebar-users {
    border-top: 0.071rem solid rgba(255,255,255,0.08);
    flex-shrink: 0;
    position: relative;
  }
  .users-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.143rem;
    width: 100%;
    padding: 0.5rem 0;
    border: none;
    background: none;
    color: #95a5a6;
    font-size: 0.714rem;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    text-align: center;
    flex-direction: column;
  }
  .users-toggle:hover { background: rgba(255,255,255,0.06); color: #ecf0f1; }
  .users-dot { font-size: 1rem; line-height: 1; }
  .users-online-count { font-size: 0.65rem; font-weight: 700; }

  .sidebar-settings {
    border-top: 0.071rem solid rgba(255,255,255,0.08);
    flex-shrink: 0;
  }
  .settings-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 0.5rem 0;
    border: none;
    background: none;
    color: #95a5a6;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .settings-btn:hover { background: rgba(255,255,255,0.06); color: #ecf0f1; }
  .settings-icon { display: block; line-height: 1; font-size: 1rem; }

  .users-panel {
    position: absolute;
    left: 100%;
    bottom: 0;
    width: 13rem;
    background: #1a252f;
    border-left: 0.071rem solid rgba(255,255,255,0.1);
    border-radius: 0 0.571rem 0.571rem 0;
    box-shadow: 0.286rem 0 0.571rem rgba(0,0,0,0.3);
    overflow: hidden;
    z-index: 30;
  }
  .users-panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.571rem 0.714rem;
    color: #ecf0f1;
    font-size: 0.82rem;
    font-weight: 600;
    border-bottom: 0.071rem solid rgba(255,255,255,0.08);
  }
  .users-panel-close {
    background: none;
    border: none;
    color: #7f8c8d;
    cursor: pointer;
    font-size: 0.857rem;
    padding: 0.143rem;
  }
  .users-panel-close:hover { color: #ecf0f1; }
  .user-row {
    display: flex;
    flex-direction: column;
    gap: 0.071rem;
    padding: 0.357rem 0.714rem;
    font-size: 0.786rem;
  }
  .user-name { color: #ecf0f1; font-weight: 500; }
  .user-activity { color: #7f8c8d; font-size: 0.714rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .user-row.muted { color: #7f8c8d; font-style: italic; }

  .main-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.429rem 1rem;
    background: #fff;
    border-bottom: 0.071rem solid var(--border);
    flex-shrink: 0;
    gap: 0.571rem;
  }
  .tipo-toggle-bar {
    display: flex;
    gap: 0;
    border: 0.071rem solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .tipo-btn-bar {
    padding: 0.286rem 1rem;
    border: none;
    background: #fff;
    color: var(--text-secondary);
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .tipo-btn-bar:hover { background: var(--bg-hover); }
  .tipo-btn-bar.active {
    background: var(--accent);
    color: #fff;
  }
  .kanban-bar {
    display: flex;
    align-items: center;
    gap: 0.571rem;
    flex: 1;
  }
  .kanban-status { font-size: 0.72rem; color: #999; }
  .kanban-count { font-size: 0.78rem; color: #3498db; font-weight: 600; }

  .mapa-bar {
    display: flex;
    align-items: center;
    gap: 0.571rem;
    flex: 1;
  }
  .mapa-bar-left {
    display: flex;
    align-items: center;
    gap: 0.286rem;
    flex: 1;
  }
  .mapa-bar-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .mapa-bar-fecha {
    padding: 0.214rem 0.357rem;
    border: 0.071rem solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.82rem;
    font-family: var(--font);
    background: #fff;
  }
  .mapa-bar-center {
    flex: 0 1 auto;
    max-width: 260px;
  }
  .mapa-bar-buscar {
    width: 100%;
    padding: 0.286rem 0.5rem;
    border: 0.071rem solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.82rem;
    font-family: var(--font);
    background: #fff;
  }
  .mapa-bar-right {
    display: flex;
    align-items: center;
    gap: 0.286rem;
    flex: 1;
    justify-content: flex-end;
  }
  .mapa-bar-origen-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: #2563eb;
    white-space: nowrap;
  }
  .mapa-bar-origen-text {
    font-size: 0.78rem;
    color: var(--text-secondary);
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mapa-bar-origen-input {
    width: 120px;
    padding: 0.214rem 0.357rem;
    border: 0.071rem solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.78rem;
    font-family: var(--font);
  }
  .mapa-bar-btn-edit {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 0.82rem;
    padding: 0.071rem 0.286rem;
    color: var(--text-muted);
  }
  .mapa-bar-btn-edit:hover { color: var(--text); }
  .mapa-bar-btn-geo {
    padding: 0.214rem 0.357rem;
    font-size: 0.78rem;
    border: 0.071rem solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-hover);
    cursor: pointer;
  }
  .mapa-bar-btn-geo:hover:not(:disabled) { background: var(--border); }
  .mapa-bar-btn-geo:disabled { opacity: 0.5; cursor: not-allowed; }
  .mapa-bar-btn-save {
    padding: 0.214rem 0.357rem;
    font-size: 0.78rem;
    border: none;
    border-radius: var(--radius-sm);
    background: #2563eb;
    color: white;
    cursor: pointer;
  }
  .mapa-bar-btn-save:hover { background: #1d4ed8; }

  .filter-bar {
    display: flex;
    align-items: center;
    gap: 0.429rem;
    flex: 1;
  }
  .filter-input {
    padding: 0.286rem 0.5rem;
    border: 0.071rem solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    background: white;
    color: var(--text-primary);
    outline: none;
    font-family: inherit;
  }
  .filter-date { min-width: 8.571rem; }
  .filter-text { min-width: 7.857rem; max-width: 10rem; }
  .filter-select { min-width: 7.143rem; }
  .filter-input:focus { border-color: var(--border-focus); }
  .filter-date-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }
  .filter-date-icon {
    position: absolute;
    left: 0.5rem;
    pointer-events: none;
    color: var(--text-muted);
  }
  .filter-date-wrap .filter-date {
    padding-left: 1.8rem;
  }
  .filter-clear-btn {
    background: none;
    border: none;
    color: #bbb;
    cursor: pointer;
    font-size: 1rem;
    padding: 0.214rem 0.429rem;
    border-radius: 0.286rem;
  }
  .filter-clear-btn:hover { color: #e74c3c; }

  .factura-actions {
    display: flex;
    align-items: center;
    gap: 0.429rem;
    margin-left: auto;
  }
  .top-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.286rem;
    padding: 0.429rem 1rem;
    border: 0.071rem solid var(--border);
    background: #fff;
    color: var(--text-primary);
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s;
    white-space: nowrap;
    line-height: 1.4;
  }
  .top-btn:hover { background: var(--bg-hover); border-color: var(--border-focus); }
  .top-btn:disabled { opacity: 0.4; cursor: not-allowed; pointer-events: none; }
  .top-btn svg { flex-shrink: 0; }
  .top-btn-success { color: #16a34a; border-color: #bbf7d0; }
  .top-btn-success:hover { background: #f0fdf4; border-color: #86efac; }
  .top-btn-wa { color: #25D366; border-color: #b7f0d1; }
  .top-btn-wa:hover { background: #f0fdf4; border-color: #86efac; }
  .top-btn-imgs { color: #9333ea; border-color: #ddd6fe; }
  .top-btn-imgs:hover { background: #f5f3ff; border-color: #c4b5fd; }

  .content {
    flex: 1;
    overflow: auto;
    background: var(--bg-page);
  }

  .tab-contents { display: contents; }
  .tab-oculto { display: none !important; }
</style>
