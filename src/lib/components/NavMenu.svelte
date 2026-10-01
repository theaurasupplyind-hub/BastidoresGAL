<script lang="ts">
  import { appStore } from '$lib/stores/appStore.svelte';
  import type { TabId } from '$lib/types';

  type GastosSub = 'dashboard' | 'proveedores' | 'sueldos' | 'asistencia' | 'categorias';
  interface NavItem { icon: string; label: string; desc: string; active: boolean; action: () => void; }
  interface NavColumn { title: string; items: NavItem[]; }

  let open = $state(false);
  let closeTimeout: ReturnType<typeof setTimeout> | null = null;

  const ICONS: Record<string, string> = {
    grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
    printer: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
    folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
    box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
    usd: '<line x1="12" y1="2" x2="12" y2="22"/><path d="M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H7"/>',
    receipt: '<path d="M4 3h16v18l-3-2-3 2-2-2-2 2-3-2-3 2V3z"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/>',
    frame: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="3" x2="9" y2="21"/>',
    rules: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  };

  let columns: NavColumn[] = $derived.by(() => {
    const cur = appStore.currentTab;
    const gt = appStore.gastosTab;
    const subs: { id: GastosSub; icon: string; label: string; desc: string }[] = [
      { id: 'dashboard', icon: 'grid', label: 'Dashboard', desc: 'Resumen y métricas de gastos' },
      { id: 'proveedores', icon: 'folder', label: 'Proveedores', desc: 'Cuentas corrientes de proveedores' },
      { id: 'sueldos', icon: 'users', label: 'Sueldos', desc: 'Liquidación de sueldos' },
      { id: 'asistencia', icon: 'calendar', label: 'Asistencia', desc: 'Presentismo y jornadas' },
      { id: 'categorias', icon: 'tag', label: 'Categorías', desc: 'Rubros de gastos' },
    ];
    const modules: { id: TabId; icon: string; label: string; desc: string }[] = [
      { id: 'revision-comprobantes', icon: 'receipt', label: 'Comprobantes', desc: 'Revisión de comprobantes' },
      { id: 'molduras', icon: 'frame', label: 'Molduras', desc: 'Catálogo de molduras' },
      { id: 'productos', icon: 'box', label: 'Productos', desc: 'Catálogo de productos' },
      { id: 'clientes', icon: 'user', label: 'Clientes', desc: 'Base de clientes' },
      { id: 'estadisticas', icon: 'chart', label: 'Estadísticas', desc: 'Reportes y métricas' },
      { id: 'analisis-usd', icon: 'usd', label: 'USD', desc: 'Análisis en dólares' },
    ];
    return [
      {
        title: 'Sistema',
        items: [
          { icon: 'trash', label: 'Papelera', desc: 'Restaurar o eliminar registros', active: cur === 'papelera', action: () => go('papelera') },
          { icon: 'printer', label: 'Impresión', desc: 'Estaciones y agente de impresión', active: cur === 'print-agent', action: () => go('print-agent') },
          { icon: 'rules', label: 'Reglas', desc: 'Reglas de precios', active: false, action: () => { appStore.showPricingRules = true; close(); } },
        ],
      },
      {
        title: 'Gastos',
        items: subs.map(s => ({
          icon: s.icon,
          label: s.label,
          desc: s.desc,
          active: cur === 'gastos' && gt === s.id,
          action: () => goGastos(s.id),
        })),
      },
      {
        title: 'Módulos',
        items: modules.map(m => ({
          icon: m.icon,
          label: m.label,
          desc: m.desc,
          active: cur === m.id,
          action: () => go(m.id),
        })),
      },
    ];
  });

  let anyActive = $derived(columns.some(c => c.items.some(i => i.active)));

  function enter() {
    if (closeTimeout) clearTimeout(closeTimeout);
    open = true;
  }
  function leave() {
    closeTimeout = setTimeout(() => { open = false; }, 200);
  }
  function toggle() {
    if (closeTimeout) clearTimeout(closeTimeout);
    open = !open;
  }
  function close() { open = false; }

  function go(tab: TabId) {
    appStore.currentTab = tab;
    const s = new Set(appStore.dirtyTabs);
    s.delete(tab);
    appStore.dirtyTabs = s;
    close();
  }
  function goGastos(sub: GastosSub) {
    appStore.gastosTab = sub;
    go('gastos');
  }

  function onWindowClick(e: MouseEvent) {
    if (!open) return;
    if ((e.target as HTMLElement)?.closest('.nav-menu-wrap')) return;
    close();
  }
  function onWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') close();
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={onWindowKeydown} />

<div class="nav-menu-wrap">
  <button
    class="nav-trigger"
    class:active={anyActive || open}
    onclick={toggle}
    onmouseenter={enter}
    onmouseleave={leave}
    title="Menú"
    aria-haspopup="true"
    aria-expanded={open}
  >
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ICONS.grid}</svg>
    <span class="nav-trigger-label">Menú</span>
    <svg class="nav-chevron" class:open width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>
  </button>

  <div class="nav-panel" class:open aria-hidden={!open} role="menu" onmouseenter={enter} onmouseleave={leave}>
    {#each columns as col}
      <div class="nav-col">
        <div class="nav-col-title">{col.title}</div>
        {#each col.items as item}
          <button class="nav-item" class:active={item.active} onclick={item.action} role="menuitem" tabindex={open ? 0 : -1}>
            <span class="nav-item-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{@html ICONS[item.icon]}</svg>
            </span>
            <span class="nav-item-text">
              <span class="nav-item-label">{item.label}</span>
              <span class="nav-item-desc">{item.desc}</span>
            </span>
          </button>
        {/each}
      </div>
    {/each}
  </div>
</div>

<style>
  .nav-menu-wrap { position: relative; }

  .nav-trigger {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.55rem;
    border: none;
    border-radius: 0.4rem;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }
  .nav-trigger:hover { background: var(--bg-hover); color: var(--text-primary); }
  .nav-trigger.active { color: var(--accent); }
  .nav-trigger-label { line-height: 1; }
  .nav-chevron {
    color: var(--text-muted);
    transition: transform 0.2s ease;
  }
  .nav-chevron.open { transform: rotate(180deg); }

  .nav-panel {
    position: fixed;
    top: 3.5rem;
    left: 0;
    right: 0;
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 1.25rem 2.5rem;
    padding: 1.25rem 1.5rem 1.5rem;
    background: var(--bg-card);
    border-bottom: 1px solid var(--border);
    box-shadow: var(--shadow-lg);
    z-index: 1500;
    opacity: 0;
    transform: translateY(-8px);
    pointer-events: none;
    transition: opacity 0.18s ease, transform 0.18s ease;
  }
  .nav-panel.open {
    opacity: 1;
    transform: translateY(0);
    pointer-events: auto;
  }
  .nav-panel::before {
    content: '';
    position: absolute;
    top: -1rem;
    left: 0;
    right: 0;
    height: 1rem;
  }

  .nav-col { display: flex; flex-direction: column; gap: 0.15rem; min-width: 0; }
  .nav-col-title {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-weight: 700;
    color: var(--text-muted);
    padding: 0 0.5rem 0.4rem;
  }

  .nav-item {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    width: 100%;
    padding: 0.5rem 0.5rem;
    border: none;
    border-radius: 0.4rem;
    background: none;
    color: var(--text-secondary);
    text-align: left;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .nav-item:hover { background: var(--bg-hover); color: var(--text-primary); }
  .nav-item.active { color: var(--accent); }
  .nav-item-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    margin-top: 0.1rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .nav-item:hover .nav-item-icon,
  .nav-item.active .nav-item-icon { color: inherit; }
  .nav-item-text { display: flex; flex-direction: column; gap: 0.05rem; min-width: 0; }
  .nav-item-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-primary);
  }
  .nav-item:hover .nav-item-label,
  .nav-item.active .nav-item-label { color: var(--accent); }
  .nav-item-desc {
    font-size: 0.72rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
</style>
