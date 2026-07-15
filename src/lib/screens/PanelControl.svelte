<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import { animate, spring } from 'animejs';

  // ── Task List (API) ──
  let tasks = $state<Array<{ id: number; text: string; done: boolean; position: number }>>([]);
  let loadingTasks = $state(false);
  let newTaskText = $state('');

  async function loadTasks() {
    loadingTasks = true;
    try { tasks = await api.listTasks(); } catch { tasks = []; }
    finally { loadingTasks = false; }
  }
  async function addTask() {
    const t = newTaskText.trim();
    if (!t) return;
    newTaskText = '';
    try {
      await api.createTask({ text: t });
      await loadTasks();
    } catch {}
  }
  async function toggleTask(id: number) {
    const task = tasks.find(t => t.id === id);
    if (!task) return;
    try {
      await api.updateTask(id, { done: !task.done });
      await loadTasks();
    } catch {}
  }
  async function removeTask(id: number) {
    try {
      await api.deleteTask(id);
      await loadTasks();
    } catch {}
  }

  // ── Entregas de hoy ──
  let entregas = $state<any[]>([]);
  let loadingData = $state(false);
  const today = new Date().toISOString().split('T')[0];

  // ── Todos los clientes (para grupos) ──
  let todosLosClientes = $state<any[]>([]);

  async function loadDashboardPanel() {
    loadingData = true;
    try {
      const data = await api.getMapaDashboard(today);
      entregas = data.entregas;
      todosLosClientes = data.clientes;
      cacheStore.set('mapa-clientes', data.clientes, 120000);
      if (data.plan && data.plan.grupos && data.plan.grupos.length > 0) {
        planGrupos = data.plan.grupos;
        planViajeId = data.plan.id;
      } else {
        planGrupos = [];
        planViajeId = null;
      }
    } catch {
      entregas = []; todosLosClientes = []; planGrupos = []; planViajeId = null;
    }
    finally { loadingData = false; }
  }

  function buscarCliente(id: number): any | null {
    return todosLosClientes.find(c => c.id === id) ?? entregas.find(e => e.id === id) ?? null;
  }

  function facturasDelCliente(id: number): any[] {
    return entregas.find(e => e.id === id)?.facturas?.filter((f: any) => f.estado_kanban !== 'NO_CONFIRMADO') ?? [];
  }

  // ── Plan de viaje ──
  let planGrupos = $state<any[]>([]);
  let planViajeId = $state<string | null>(null);
  let planDirty = $state(false);
  let dragCliente = $state<{ clienteId: number; grupoOrigen: string | null } | null>(null);
  let dragEl = $state<HTMLElement | null>(null);
  let dragOverGrupo = $state<string | null>(null);
  let showKanbanViajes = $state(false);

  function guardarPlanPanel() {
    if (planGrupos.length === 0) return;
    const data = { fecha: today, grupos: planGrupos };
    if (planViajeId) {
      api.updatePlanViaje(planViajeId, data).then(() => { planDirty = false; appStore.showToast('Plan actualizado', 'success'); }).catch(() => { appStore.showToast('Error al guardar', 'error'); });
    } else {
      api.savePlanViaje(data).then((res) => { planViajeId = res.id; planDirty = false; appStore.showToast('Plan guardado', 'success'); }).catch(() => { appStore.showToast('Error al guardar', 'error'); });
    }
  }

  function grupoDelClientePanel(clienteId: number): any | null {
    for (const g of planGrupos) {
      if (g.clienteIds.includes(clienteId)) return g;
    }
    return null;
  }

  function clientesSinGrupo() {
    const agrupados = new Set<number>();
    for (const g of planGrupos) {
      for (const id of g.clienteIds) agrupados.add(id);
    }
    const idsEntregaHoy = new Set(entregas.map((e: any) => e.id));
    return (todosLosClientes.length > 0 ? todosLosClientes : entregas).filter((e: any) => {
      if (agrupados.has(e.id)) return false;
      const tienePendientes = (e.pedidos_pendientes ?? 0) > 0;
      const tieneEntregaHoy = idsEntregaHoy.has(e.id);
      return tienePendientes || tieneEntregaHoy;
    });
  }

  function dragStartCliente(clienteId: number, grupoId: string | null, el: HTMLElement) {
    dragCliente = { clienteId, grupoOrigen: grupoId };
    dragEl = el;
    animate(el, {
      scale: 1.04,
      opacity: 0.85,
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      duration: 200,
      ease: 'outQuad',
    });
  }

  function dragOverGrupoFn(grupoId: string) {
    dragOverGrupo = grupoId;
  }

  function dragLeaveGrupo() {
    dragOverGrupo = null;
  }

  function dropEnGrupo(grupoId: string | null) {
    if (!dragCliente) return;
    const { clienteId, grupoOrigen } = dragCliente;
    if (grupoOrigen === grupoId) { dragCliente = null; dragEl = null; dragOverGrupo = null; return; }
    const nuevosGrupos = planGrupos.map((g: any) => {
      let ids = [...g.clienteIds];
      let orden = [...(g.ordenRuta || [])];
      if (g.id === grupoOrigen) {
        ids = ids.filter((id: number) => id !== clienteId);
        orden = orden.filter((id: number) => id !== clienteId);
      }
      if (g.id === grupoId) {
        if (!ids.includes(clienteId)) {
          ids = [...ids, clienteId];
          orden = [...orden, clienteId];
        }
      }
      return { ...g, clienteIds: ids, ordenRuta: orden };
    });
    planGrupos = nuevosGrupos;
    planDirty = true;
    if (dragEl) {
      animate(dragEl, {
        scale: [1.04, 1],
        boxShadow: ['0 4px 12px rgba(0,0,0,0.2)', 'none'],
        duration: 300,
        ease: spring({ stiffness: 180, damping: 14 }),
      });
    }
    dragCliente = null;
    dragEl = null;
    dragOverGrupo = null;
  }

  function quitarDeGrupoPanel(clienteId: number, grupoId: string) {
    const nuevosGrupos = planGrupos.map((g: any) => {
      if (g.id !== grupoId) return g;
      return {
        ...g,
        clienteIds: g.clienteIds.filter((id: number) => id !== clienteId),
        ordenRuta: (g.ordenRuta || []).filter((id: number) => id !== clienteId),
      };
    });
    planGrupos = nuevosGrupos;
    planDirty = true;
  }

  // ── Actividad (facturas + pagos) ──
  type ActivityItem = { id: number; type: 'factura' | 'pago'; color: string; message: string; time: string; section: string };
  let activity = $state<ActivityItem[]>([]);
  let usersMap = $state<Map<number, string>>(new Map());
  let dismissed = $state<Set<string>>(new Set());

  function loadDismissed() {
    try {
      const arr = JSON.parse(localStorage.getItem('panel_dismissed_activity') || '[]');
      dismissed = new Set(arr);
    } catch { dismissed = new Set(); }
  }
  function saveDismissed() {
    localStorage.setItem('panel_dismissed_activity', JSON.stringify([...dismissed]));
  }
  function dismissActivity(key: string) {
    dismissed.add(key);
    saveDismissed();
    activity = activity.filter(a => `${a.type}-${a.id}` !== key);
  }

  async function loadActivity() {
    try {
      const [facturas, pagos, usuarios] = await Promise.all([
        api.listFacturas({ limit: 30 }),
        api.listPagos(),
        api.getUsers(),
      ]);
      usersMap = new Map((usuarios || []).map((u: any) => [u.id, u.full_name]));
      const items: ActivityItem[] = [];
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];

      for (const f of (facturas || []).filter((x: any) => x.estado_kanban !== 'NO_CONFIRMADO')) {
        if ((f.created_at || '').startsWith(todayStr)) {
          const userName = usersMap.get(f.created_by) || '';
          items.push({
            id: f.id,
            type: 'factura',
            color: '#22c55e',
            message: `Factura ${f.numero_factura || '#' + f.id} — $${(f.total || 0).toLocaleString('es-AR')}${userName ? ` (por ${userName})` : ''}`,
            time: f.created_at || '',
            section: f.cliente_nombre || 'Cliente',
          });
        }
      }

      for (const p of (pagos || [])) {
        if ((p.created_at || '').startsWith(todayStr)) {
          items.push({
            id: p.id,
            type: 'pago',
            color: '#f59e0b',
            message: `Pago de $${(p.amount || 0).toLocaleString('es-AR')}`,
            time: p.created_at || '',
            section: p.method || 'Pago',
          });
        }
      }

      items.sort((a, b) => (b.time || '').localeCompare(a.time || ''));
      activity = items.slice(0, 20);
    } catch { activity = []; }
  }

  // ── Notas (API global) ──
  let notes = $state('');
  let noteHistory = $state<Array<{ id: number; content: string; created_at: string }>>([]);
  let showNotesModal = $state(false);
  let notesTemp = $state('');
  let savingNote = $state(false);
  let currentPage = $state(0);
  let historyExpanded = $state(false);

  let pages = $derived(notes ? notes.split('\n---\n') : ['']);
  let totalPages = $derived(pages.length);
  let isFirstPage = $derived(currentPage === 0);
  let isLastPage = $derived(currentPage >= pages.length - 1);

  function mergeCurrentPage() {
    const all = [...pages];
    all[currentPage] = notesTemp;
    notes = all.join('\n---\n');
  }

  function goToPage(idx: number) {
    if (idx === currentPage) return;
    mergeCurrentPage();
    currentPage = idx;
    notesTemp = pages[idx] ?? '';
  }

  function prevSec() { if (currentPage > 0) goToPage(currentPage - 1); }
  function nextSec() { if (currentPage < pages.length - 1) goToPage(currentPage + 1); }

  function addPage() {
    mergeCurrentPage();
    notes = notes + '\n---\n';
    const newPages = notes.split('\n---\n');
    currentPage = newPages.length - 1;
    notesTemp = '';
  }

  function deleteCurrentPage() {
    if (pages.length <= 1) return;
    const all = [...pages];
    all.splice(currentPage, 1);
    notes = all.join('\n---\n');
    if (currentPage >= all.length) currentPage = all.length - 1;
    notesTemp = all[currentPage] ?? '';
  }

  let diffs = $derived(
    noteHistory.map((entry, i) => {
      const older = i < noteHistory.length - 1 ? noteHistory[i + 1].content : notes;
      const newer = entry.content;
      return { id: entry.id, date: entry.created_at, lines: diffLines(older, newer) };
    })
  );

  function diffLines(oldText: string, newText: string): Array<{ type: 'add' | 'remove' | 'same'; text: string }> {
    const oldLines = (oldText || '').split('\n');
    const newLines = (newText || '').split('\n');
    const dp: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
      Array(newLines.length + 1).fill(0)
    );
    for (let i = 1; i <= oldLines.length; i++) {
      for (let j = 1; j <= newLines.length; j++) {
        dp[i][j] = oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
    let i = oldLines.length, j = newLines.length;
    const rev: Array<{ type: 'add' | 'remove' | 'same'; text: string }> = [];
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        rev.push({ type: 'same', text: oldLines[i - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        rev.push({ type: 'add', text: newLines[j - 1] });
        j--;
      } else {
        rev.push({ type: 'remove', text: oldLines[i - 1] });
        i--;
      }
    }
    rev.reverse();
    return rev;
  }

  async function loadNotes() {
    try {
      const data = await api.getNotes();
      notes = data.content || '';
      noteHistory = data.history || [];
      const loadedPages = notes.split('\n---\n');
      if (currentPage >= loadedPages.length) currentPage = Math.max(0, loadedPages.length - 1);
      notesTemp = loadedPages[currentPage] ?? '';
    } catch { notes = ''; noteHistory = []; notesTemp = ''; currentPage = 0; }
  }
  async function saveNote() {
    mergeCurrentPage();
    if (!notes) return;
    savingNote = true;
    try {
      await api.saveNotes({ content: notes });
      await loadNotes();
    } catch { } finally { savingNote = false; }
  }
  async function deleteNoteEntry(id: number) {
    try {
      await api.deleteNote(id);
      await loadNotes();
    } catch {}
  }
  function openNotes() {
    const loadedPages = notes.split('\n---\n');
    currentPage = 0;
    notesTemp = loadedPages[0] ?? '';
    historyExpanded = false;
    showNotesModal = true;
  }
  function closeNotes() { showNotesModal = false; }

  // ── Helpers ──
  const taskCount = $derived(tasks.length);
  const taskDone = $derived(tasks.filter(t => t.done).length);
  const taskPct = $derived(taskCount > 0 ? Math.round(taskDone * 100 / taskCount) : 0);

  function shortTime(full: string): string {
    if (!full) return '';
    const d = new Date(full);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString('es-AR', {
        timeZone: 'America/Argentina/Buenos_Aires',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    }
    if (full.includes('T')) {
      const t = full.split('T')[1];
      return t?.slice(0, 5) || '';
    }
    const parts = full.split(' ');
    if (parts.length >= 2) return parts[1]?.slice(0, 5) || '';
    return full;
  }

  function formatShortDate(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso.slice(0, 10);
    return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  onMount(() => {
    loadTasks();
    loadNotes();
    loadDashboardPanel();
    loadActivity();
    loadDismissed();
  });
</script>

<div class="panel-control">
  <div class="panel-top">
    <!-- LISTA DE TAREAS -->
    <div class="card card-tasks">
      <div class="card-header">
        <div class="card-title-row">
          <svg class="card-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
          <span class="card-title">LISTA DE TAREAS</span>
        </div>
        <span class="card-badge">{taskDone}/{taskCount} · {taskPct}%</span>
      </div>
      <div class="task-list">
        {#each tasks as task (task.id)}
          <div class="task-item" class:done={task.done}>
            <button class="task-check" onclick={() => toggleTask(task.id)} aria-label="Marcar tarea">
              {#if task.done}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#22c55e" stroke="none"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
              {:else}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>
              {/if}
            </button>
            <span class="task-text">{task.text}</span>
            <button class="task-remove" onclick={() => removeTask(task.id)} aria-label="Eliminar tarea">✕</button>
          </div>
        {/each}
        {#if tasks.length === 0}
          <div class="task-empty">Sin tareas pendientes</div>
        {/if}
      </div>
      <div class="task-input-row">
        <input class="task-input" type="text" placeholder="Nueva tarea..." bind:value={newTaskText}
          onkeydown={(e) => { if (e.key === 'Enter') addTask(); }} />
        <button class="task-add-btn" onclick={addTask} aria-label="Agregar tarea">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>
    </div>

    <!-- ENTREGAS DE HOY -->
    <div class="card card-entregas">
      <div class="card-header entregas-header" onclick={() => showKanbanViajes = true}>
        <div class="card-title-row">
          <svg class="card-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          <span class="card-title">ENTREGAS DE HOY</span>
        </div>
        <span class="card-badge badge-white">{entregas.reduce((s: number, e: any) => s + (e.facturas?.length || 0), 0)} entregas</span>
      </div>
      <div class="entregas-stats">
        <div class="entregas-stat">
          <span class="stat-big">{entregas.reduce((s: number, e: any) => s + (e.facturas?.length || 0), 0)}</span>
          <span class="stat-label">entregas</span>
        </div>
        <div class="entregas-stat">
          <span class="stat-big">{planGrupos.reduce((s: number, g: any) => s + g.clienteIds.length, 0)}</span>
          <span class="stat-label">en viajes</span>
        </div>
        <div class="entregas-stat">
          <span class="stat-big">{planGrupos.length}</span>
          <span class="stat-label">viajes</span>
        </div>
      </div>
      <div class="entregas-list">
        {#if loadingData}
          <div class="entregas-empty">Cargando...</div>
        {:else if entregas.length === 0}
          <div class="entregas-empty">Sin entregas programadas hoy</div>
        {:else}
          {#if planGrupos.length > 0}
            {#each planGrupos as grupo}
              <div
                class="grupo-section"
                class:drag-over={dragOverGrupo === grupo.id}
                ondragover={(e) => { e.preventDefault(); dragOverGrupoFn(grupo.id); }}
                ondragleave={dragLeaveGrupo}
                ondrop={(e) => { e.preventDefault(); dropEnGrupo(grupo.id); }}
              >
                <div class="grupo-header">
                  <span class="grupo-color" style="background:{grupo.color}"></span>
                  <span class="grupo-nombre">{grupo.nombre}</span>
                  <span class="grupo-count">{grupo.clienteIds.length} cliente{grupo.clienteIds.length !== 1 ? 's' : ''}</span>
                </div>
                <div class="grupo-clientes">
                  {#each grupo.ordenRuta.length > 0 ? grupo.ordenRuta : grupo.clienteIds as clienteId, i}
                    {@const ec = buscarCliente(clienteId)}
                    {@const facts = facturasDelCliente(clienteId)}
                    {#if ec}
                      <div
                        class="cliente-card"
                        draggable="true"
                        ondragstart={(e) => dragStartCliente(ec.id, grupo.id, e.currentTarget)}
                      >
                        <span class="cliente-drag">⠿</span>
                        <span class="cliente-order">{i + 1}</span>
                        <div class="cliente-body">
                          <span class="cliente-nombre">{ec.nombre}</span>
                          <span class="cliente-dir">{ec.domicilio || ''}</span>
                          {#if facts.length > 0}
                            <div class="cliente-facturas">
                              {#each facts as f}
                                <span class="factura-chip">
                                  <span class="factura-num">{f.numero_factura}</span>
                                  <span class="factura-total">${(f.total || 0).toLocaleString('es-AR')}</span>
                                  <span class="factura-date">{f.fecha || ''}</span>
                                </span>
                              {/each}
                            </div>
                          {/if}
                        </div>
                        <button class="cliente-remove" onclick={() => quitarDeGrupoPanel(ec.id, grupo.id)} title="Quitar del grupo">✕</button>
                      </div>
                    {/if}
                  {/each}
                </div>
              </div>
            {/each}
          {/if}

          {#each [clientesSinGrupo()] as sinGrupo}
            {#if sinGrupo.length > 0}
            <div
              class="grupo-section grupo-sin-asignar"
              class:drag-over={dragOverGrupo === '__sin_asignar__'}
              ondragover={(e) => { e.preventDefault(); dragOverGrupoFn('__sin_asignar__'); }}
              ondragleave={dragLeaveGrupo}
              ondrop={(e) => { e.preventDefault(); dropEnGrupo(null); }}
            >
              <div class="grupo-header">
                <span class="grupo-color" style="background:#9ca3af"></span>
                <span class="grupo-nombre">Sin asignar</span>
                <span class="grupo-count">{sinGrupo.length} cliente{sinGrupo.length !== 1 ? 's' : ''}</span>
              </div>
              <div class="grupo-clientes">
                {#each sinGrupo as ec}
                  {@const facts = facturasDelCliente(ec.id)}
                  <div
                    class="cliente-card"
                    draggable="true"
                    ondragstart={(e) => dragStartCliente(ec.id, null, e.currentTarget)}
                  >
                    <span class="cliente-drag">⠿</span>
                    <span class="cliente-order" style="background:#9ca3af">{entregas.findIndex((e: any) => e.id === ec.id) + 1 || ''}</span>
                    <div class="cliente-body">
                      <span class="cliente-nombre">{ec.nombre}</span>
                      <span class="cliente-dir">{ec.domicilio || ''}</span>
                      {#if facts.length > 0}
                        <div class="cliente-facturas">
                          {#each facts as f}
                            <span class="factura-chip">
                              <span class="factura-num">{f.numero_factura}</span>
                              <span class="factura-total">${(f.total || 0).toLocaleString('es-AR')}</span>
                              <span class="factura-date">{f.fecha || ''}</span>
                            </span>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        {/each}
      {/if}
      </div>
      <button class="entregas-link" onclick={() => appStore.currentTab = 'mapa'}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
        Ver mapa de entregas
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>

    <!-- ACTIVIDAD -->
    <div class="card card-activity">
      <div class="card-header">
        <div class="card-title-row">
          <svg class="card-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          <span class="card-title">ACTIVIDAD</span>
        </div>
        <span class="card-badge">HOY</span>
      </div>
      <div class="activity-list">
        {#each activity.filter(a => !dismissed.has(`${a.type}-${a.id}`)) as item, i (i)}
          <div class="activity-item">
            <span class="activity-dot" style="background:{item.color}"></span>
            <div class="activity-body">
              <span class="activity-msg">{item.message}</span>
              <span class="activity-meta">{item.section} · {shortTime(item.time)}</span>
            </div>
            <button class="activity-dismiss" onclick={() => dismissActivity(`${item.type}-${item.id}`)} aria-label="Descartar">✕</button>
          </div>
        {/each}
        {#if activity.length === 0}
          <div class="activity-empty">Sin actividad hoy</div>
        {/if}
      </div>
    </div>
  </div>

  <!-- NOTAS -->
  <div class="card card-notes" onclick={openNotes} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && openNotes()}>
    <div class="card-header notes-header">
      <div class="card-title-row">
        <svg class="card-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        <span class="card-title">NOTAS</span>
      </div>
      <span class="card-badge">{notes ? notes.split('\n')[0] || 'Ver nota' : 'Escribir'}</span>
    </div>
    <div class="notes-preview">{notes ? notes.slice(0, 80).replace(/\n/g, ' · ') : 'Sin notas. Click para escribir...'}</div>
  </div>
</div>

<!-- Notes Modal -->
{#if showNotesModal}
  <div class="modal-overlay" onclick={closeNotes} role="presentation">
    <div class="modal modal-notes" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && closeNotes()}>
      <div class="notes-modal-header">
        <h3>Notas</h3>
        <button class="notes-modal-close" onclick={closeNotes} aria-label="Cerrar">✕</button>
      </div>

      <div class="book-container">
        <div class="book-nav">
          <button class="book-nav-btn" onclick={prevSec} disabled={isFirstPage} aria-label="Sección anterior">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <span class="book-nav-label">Sección {currentPage + 1}</span>
          <span class="book-nav-count">{currentPage + 1} / {totalPages}</span>
          <button class="book-nav-btn" onclick={nextSec} disabled={isLastPage} aria-label="Sección siguiente">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <div class="book-nav-sep"></div>
          {#if pages.length > 1}
            <button class="book-nav-btn book-nav-del" onclick={deleteCurrentPage} disabled={pages.length <= 1} aria-label="Eliminar sección" title="Eliminar sección">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          {/if}
          <button class="book-nav-btn book-nav-add" onclick={addPage} aria-label="Nueva sección" title="Nueva sección">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>

        <div class="book-page">
          <textarea class="book-textarea" placeholder="Escribí una nota..." bind:value={notesTemp}></textarea>
        </div>
      </div>

      {#if noteHistory.length > 0}
        <div class="history-section">
          <button class="history-toggle" onclick={() => historyExpanded = !historyExpanded}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class:rotated={historyExpanded}>
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            Historial ({noteHistory.length} cambio{noteHistory.length !== 1 ? 's' : ''})
          </button>
          {#if historyExpanded}
            <div class="history-list">
              {#each diffs as diff}
                <div class="diff-entry">
                  <div class="diff-header">
                    <span class="diff-date">{formatShortDate(diff.date)}</span>
                    <button class="diff-del" onclick={() => deleteNoteEntry(diff.id)} aria-label="Borrar entrada">✕</button>
                  </div>
                  <div class="diff-body">
                    {#each diff.lines as line}
                      <div class="diff-line diff-{line.type}">
                        <span class="diff-prefix">{line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' '}</span>
                        <span class="diff-text">{line.text}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <div class="modal-footer">
        <button class="btn btn-primary" onclick={saveNote} disabled={savingNote}>{savingNote ? 'Guardando...' : 'Guardar'}</button>
        <button class="btn btn-secondary" onclick={closeNotes}>Cerrar</button>
      </div>
    </div>
  </div>
{/if}

<!-- Kanban Viajes -->
{#if showKanbanViajes}
  <div class="kanban-overlay" onclick={() => showKanbanViajes = false} role="presentation">
    <div class="kanban-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (showKanbanViajes = false)}>
      <div class="kanban-modal-header">
        <div class="kanban-modal-title">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          <h2>Viajes del día</h2>
        </div>
        <div class="kanban-modal-actions">
          {#if planDirty}
            <button class="kanban-btn-save" onclick={guardarPlanPanel}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
              Guardar
            </button>
          {/if}
          <button class="kanban-btn-close" onclick={() => showKanbanViajes = false}>✕</button>
        </div>
      </div>

      <div class="kanban-board">
        {#each planGrupos as grupo}
          <div
            class="kanban-column"
            class:drag-over={dragOverGrupo === grupo.id}
            ondragover={(e) => { e.preventDefault(); dragOverGrupoFn(grupo.id); }}
            ondragleave={dragLeaveGrupo}
            ondrop={(e) => { e.preventDefault(); dropEnGrupo(grupo.id); }}
          >
            <div class="kanban-column-header">
              <span class="grupo-color" style="background:{grupo.color}"></span>
              <span class="kanban-col-title">{grupo.nombre}</span>
              <span class="kanban-col-count">{grupo.clienteIds.length}</span>
            </div>
            <div class="kanban-column-body">
              {#each grupo.ordenRuta.length > 0 ? grupo.ordenRuta : grupo.clienteIds as clienteId, i}
                {@const ec = buscarCliente(clienteId)}
                {@const facts = facturasDelCliente(clienteId)}
                {#if ec}
                  <div
                    class="cliente-card"
                    draggable="true"
                    ondragstart={(e) => dragStartCliente(ec.id, grupo.id, e.currentTarget)}
                  >
                    <span class="cliente-drag">⠿</span>
                    <span class="cliente-order">{i + 1}</span>
                    <div class="cliente-body">
                      <span class="cliente-nombre">{ec.nombre}</span>
                      <span class="cliente-dir">{ec.domicilio || ''}</span>
                      {#if facts.length > 0}
                        <div class="cliente-facturas">
                          {#each facts as f}
                            <span class="factura-chip">
                              <span class="factura-num">{f.numero_factura}</span>
                              <span class="factura-total">${(f.total || 0).toLocaleString('es-AR')}</span>
                              <span class="factura-date">{f.fecha || ''}</span>
                            </span>
                          {/each}
                        </div>
                      {/if}
                    </div>
                    <button class="cliente-remove" onclick={() => quitarDeGrupoPanel(ec.id, grupo.id)} title="Quitar del grupo">✕</button>
                  </div>
                {/if}
              {/each}
            </div>
          </div>
        {/each}

        {#each [clientesSinGrupo()] as sinGrupo}
          {#if sinGrupo.length > 0}
          <div
            class="kanban-column"
            class:drag-over={dragOverGrupo === '__sin_asignar__'}
            ondragover={(e) => { e.preventDefault(); dragOverGrupoFn('__sin_asignar__'); }}
            ondragleave={dragLeaveGrupo}
            ondrop={(e) => { e.preventDefault(); dropEnGrupo(null); }}
          >
            <div class="kanban-column-header kanban-col-sin">
              <span class="grupo-color" style="background:#9ca3af"></span>
              <span class="kanban-col-title">Sin asignar</span>
              <span class="kanban-col-count">{sinGrupo.length}</span>
            </div>
            <div class="kanban-column-body">
              {#each sinGrupo as ec}
                {@const facts = facturasDelCliente(ec.id)}
                <div
                  class="cliente-card"
                  draggable="true"
                  ondragstart={(e) => dragStartCliente(ec.id, null, e.currentTarget)}
                >
                  <span class="cliente-drag">⠿</span>
                  <span class="cliente-order" style="background:#9ca3af">{entregas.findIndex((e: any) => e.id === ec.id) + 1 || ''}</span>
                  <div class="cliente-body">
                    <span class="cliente-nombre">{ec.nombre}</span>
                    <span class="cliente-dir">{ec.domicilio || ''}</span>
                    {#if facts.length > 0}
                      <div class="cliente-facturas">
                        {#each facts as f}
                          <span class="factura-chip">
                            <span class="factura-num">{f.numero_factura}</span>
                            <span class="factura-total">${(f.total || 0).toLocaleString('es-AR')}</span>
                            <span class="factura-date">{f.fecha || ''}</span>
                          </span>
                        {/each}
                      </div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/each}
    </div>
    </div>
  </div>
{/if}

<style>
  .panel-control {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: 1rem;
    gap: 0.714rem;
    overflow: hidden;
    background: var(--bg-page, #f3f4f6);
  }
  .panel-top {
    display: grid;
    grid-template-columns: 1fr 1.4fr 1fr;
    gap: 0.714rem;
    flex: 1;
    min-height: 0;
  }

  /* ── CARDS BASE ── */
  .card {
    background: var(--bg-card, #fff);
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 0.714rem;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-height: 0;
  }
  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.714rem 0.857rem 0.571rem;
    flex-shrink: 0;
  }
  .card-title-row {
    display: flex;
    align-items: center;
    gap: 0.429rem;
  }
  .card-title {
    font-size: 0.714rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-secondary, #6b7280);
  }
  .card-badge {
    font-size: 0.643rem;
    font-weight: 600;
    color: var(--text-muted, #9ca3af);
    background: var(--bg-hover, #f3f4f6);
    padding: 0.143rem 0.429rem;
    border-radius: 1rem;
  }

  /* ── TAREAS ── */
  .task-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 0.857rem;
    min-height: 0;
  }
  .task-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.429rem 0;
    border-bottom: 1px solid var(--border-light, #f3f4f6);
  }
  .task-item:last-child { border-bottom: none; }
  .task-item.done .task-text { text-decoration: line-through; color: var(--text-muted, #9ca3af); }
  .task-check {
    flex-shrink: 0;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
  }
  .task-text {
    flex: 1;
    font-size: 0.857rem;
    color: var(--text-primary, #111827);
    min-width: 0;
  }
  .task-remove {
    flex-shrink: 0;
    background: none;
    border: none;
    color: var(--text-muted, #9ca3af);
    cursor: pointer;
    font-size: 0.714rem;
    padding: 0.143rem 0.286rem;
    border-radius: 0.214rem;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .task-item:hover .task-remove { opacity: 1; }
  .task-remove:hover { color: #ef4444; background: rgba(239,68,68,0.08); }
  .task-empty {
    text-align: center;
    color: var(--text-muted, #9ca3af);
    font-size: 0.857rem;
    padding: 2rem 0;
  }
  .task-input-row {
    display: flex;
    gap: 0.429rem;
    padding: 0.571rem 0.857rem 0.714rem;
    flex-shrink: 0;
  }
  .task-input {
    flex: 1;
    padding: 0.429rem 0.571rem;
    border: 1.5px solid var(--border, #e5e7eb);
    border-radius: var(--radius-sm, 0.357rem);
    font-size: 0.857rem;
    background: var(--bg-card, #fff);
    color: var(--text-primary, #111827);
    outline: none;
  }
  .task-input:focus { border-color: var(--border-focus, #3b82f6); }
  .task-add-btn {
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    border: none;
    background: #22c55e;
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: background 0.12s;
  }
  .task-add-btn:hover { background: #16a34a; }

  /* ── ENTREGAS ── */
  .entregas-header {
    background: linear-gradient(135deg, #16a34a, #15803d);
    cursor: pointer;
    transition: filter 0.12s;
  }
  .entregas-header:hover { filter: brightness(1.08); }
  .entregas-header .card-title { color: rgba(255,255,255,0.85); }
  .badge-white { background: rgba(255,255,255,0.2) !important; color: white !important; }
  .entregas-stats {
    display: flex;
    gap: 1.5rem;
    padding: 0.857rem 0.857rem 0.571rem;
    background: linear-gradient(135deg, #16a34a, #15803d);
    color: white;
  }
  .entregas-stat { display: flex; flex-direction: column; }
  .stat-big { font-size: 2rem; font-weight: 800; line-height: 1; }
  .stat-label { font-size: 0.714rem; opacity: 0.8; }
  .entregas-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.571rem 0.857rem;
    background: linear-gradient(180deg, #16a34a 0%, #14532d 100%);
    min-height: 0;
  }
  .entrega-item {
    padding: 0.571rem 0;
    border-bottom: 1px solid rgba(255,255,255,0.15);
    color: white;
  }
  .entrega-item:last-child { border-bottom: none; }
  .entrega-cliente { font-weight: 600; font-size: 0.857rem; margin-bottom: 0.143rem; }
  .entrega-factura {
    display: flex;
    justify-content: space-between;
    font-size: 0.786rem;
    opacity: 0.9;
    padding-left: 0.429rem;
  }
  .entrega-num { font-family: var(--font-mono, monospace); }
  .entrega-dom { font-size: 0.714rem; opacity: 0.65; margin-top: 0.143rem; }

  .grupo-section {
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    margin-bottom: 8px;
    overflow: hidden;
    transition: box-shadow 0.15s;
  }
  .grupo-section.drag-over {
    box-shadow: 0 0 0 2px #3b82f6, inset 0 0 0 1px #3b82f6;
  }
  .grupo-sin-asignar {
    opacity: 0.8;
  }

  .grupo-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(255,255,255,0.04);
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .grupo-color {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .grupo-nombre {
    flex: 1;
    font-size: 15px;
    font-weight: 600;
    color: rgba(255,255,255,0.9);
  }
  .grupo-count {
    font-size: 12px;
    color: rgba(255,255,255,0.5);
    font-weight: 500;
  }

  .grupo-clientes {
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .cliente-card {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 8px;
    background: rgba(255,255,255,0.03);
    transition: background 0.12s;
    cursor: default;
  }
  .cliente-card:hover { background: rgba(255,255,255,0.07); }
  .cliente-card:active { opacity: 0.7; }

  .cliente-drag {
    font-size: 18px;
    color: rgba(255,255,255,0.3);
    cursor: grab;
    flex-shrink: 0;
    padding: 2px 0;
    line-height: 1;
    user-select: none;
  }
  .cliente-drag:active { cursor: grabbing; }

  .cliente-order {
    width: 24px;
    height: 24px;
    min-width: 24px;
    border-radius: 50%;
    background: #2563eb;
    color: white;
    font-size: 12px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .cliente-body {
    flex: 1;
    min-width: 0;
  }
  .cliente-nombre {
    font-size: 16px;
    font-weight: 600;
    color: rgba(255,255,255,0.9);
  }
  .cliente-dir {
    font-size: 13px;
    color: rgba(255,255,255,0.75);
    display: block;
    margin-top: 2px;
  }
  .cliente-facturas {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 6px;
  }
  .factura-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    background: rgba(255,255,255,0.08);
    border-radius: 6px;
    font-size: 12px;
  }
  .factura-num {
    font-weight: 700;
    color: rgba(255,255,255,0.9);
  }
  .factura-total {
    font-weight: 800;
    color: #ffffff;
  }
  .factura-date {
    font-size: 11px;
    color: rgba(255,255,255,0.5);
  }

  .cliente-remove {
    width: 18px;
    height: 18px;
    border: none;
    background: transparent;
    border-radius: 4px;
    cursor: pointer;
    font-size: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255,255,255,0.3);
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.12s;
    padding: 0;
  }
  .cliente-card:hover .cliente-remove { opacity: 1; }
  .cliente-remove:hover { background: rgba(239,68,68,0.2); color: #ef4444; }

  .header-save-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #059669;
    border: none;
    border-radius: 6px;
    color: white;
    font-size: 12px;
    font-weight: 600;
    padding: 4px 10px;
    cursor: pointer;
    transition: background 0.12s;
    font-family: var(--font);
    margin-left: auto;
    white-space: nowrap;
  }
  .header-save-btn:hover { background: #047857; }

  .entregas-empty {
    text-align: center;
    color: rgba(255,255,255,0.6);
    font-size: 0.857rem;
    padding: 1.5rem 0;
  }

  .entregas-link {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    background: linear-gradient(135deg, #16a34a, #15803d);
    border: none;
    color: white;
    font-size: 0.9rem;
    font-weight: 700;
    padding: 12px 16px;
    text-align: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: filter 0.12s;
    font-family: var(--font);
  }
  .entregas-link:hover { filter: brightness(1.1); }

  /* ── ACTIVIDAD ── */
  .activity-list {
    flex: 1;
    overflow-y: auto;
    padding: 0 0.857rem;
    min-height: 0;
  }
  .activity-item {
    display: flex;
    gap: 0.571rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border-light, #f3f4f6);
  }
  .activity-item:last-child { border-bottom: none; }
  .activity-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 0.286rem;
  }
  .activity-body { flex: 1; min-width: 0; }
  .activity-msg {
    font-size: 0.857rem;
    color: var(--text-primary, #111827);
    display: block;
    line-height: 1.3;
  }
  .activity-meta {
    font-size: 0.714rem;
    color: var(--text-muted, #9ca3af);
    display: block;
    margin-top: 0.071rem;
  }
  .activity-dismiss {
    flex-shrink: 0;
    background: none;
    border: none;
    color: var(--text-muted, #9ca3af);
    cursor: pointer;
    font-size: 0.714rem;
    padding: 0.143rem 0.286rem;
    border-radius: 0.214rem;
    opacity: 0;
    transition: opacity 0.12s;
    align-self: flex-start;
    margin-top: 0.143rem;
  }
  .activity-item:hover .activity-dismiss { opacity: 1; }
  .activity-dismiss:hover { color: #ef4444; background: rgba(239,68,68,0.08); }
  .activity-empty {
    text-align: center;
    color: var(--text-muted, #9ca3af);
    font-size: 0.857rem;
    padding: 2rem 0;
  }

  /* ── NOTAS ── */
  .card-notes {
    flex-shrink: 0;
    flex-direction: row;
    align-items: center;
    border-radius: 0.571rem;
    min-height: 2.5rem;
    cursor: pointer;
    transition: background 0.12s;
  }
  .card-notes:hover { background: var(--bg-hover, #f9fafb); }
  .notes-header { padding: 0.429rem 0.714rem; flex-shrink: 0; }
  .notes-header .card-title { color: var(--text-muted, #9ca3af); }
  .notes-preview {
    flex: 1;
    font-size: 0.786rem;
    color: var(--text-muted, #9ca3af);
    padding: 0 0.714rem 0 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }

  /* ── Notes Modal Header ── */
  .notes-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.857rem;
  }
  .notes-modal-header h3 { margin: 0; color: var(--text-primary); }
  .notes-modal-close {
    width: 1.714rem;
    height: 1.714rem;
    border: none;
    background: none;
    color: var(--text-muted, #9ca3af);
    cursor: pointer;
    border-radius: 0.286rem;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
    transition: all 0.12s;
  }
  .notes-modal-close:hover { background: rgba(239,68,68,0.08); color: #ef4444; }

  /* ── Book Container ── */
  .book-container {
    display: flex;
    flex-direction: column;
    gap: 0.571rem;
  }

  .book-nav {
    display: flex;
    align-items: center;
    gap: 0.571rem;
    justify-content: center;
  }
  .book-nav-btn {
    width: 1.714rem;
    height: 1.714rem;
    border: 1px solid var(--border, #e5e7eb);
    background: var(--bg-card, #fff);
    border-radius: 0.286rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary, #6b7280);
    transition: all 0.12s;
  }
  .book-nav-btn:hover:not(:disabled) { background: var(--bg-hover, #f3f4f6); color: var(--text-primary); }
  .book-nav-btn:disabled { opacity: 0.3; cursor: default; }
  .book-nav-label {
    font-size: 0.786rem;
    color: var(--text-muted, #9ca3af);
    flex: 1;
    text-align: right;
  }
  .book-nav-count {
    font-size: 0.786rem;
    font-weight: 600;
    color: var(--text-secondary, #6b7280);
    min-width: 3.5rem;
    text-align: left;
  }
  .book-nav-sep {
    width: 1px;
    height: 1.2rem;
    background: var(--border, #e5e7eb);
    flex-shrink: 0;
  }
  .book-nav-add {
    color: #22c55e !important;
    border-color: #22c55e !important;
  }
  .book-nav-add:hover:not(:disabled) { background: rgba(34,197,94,0.08) !important; }
  .book-nav-del:hover:not(:disabled) { background: rgba(239,68,68,0.08) !important; color: #ef4444 !important; }

  .book-page {
    background: #fff;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 0.429rem;
    box-shadow: inset 0 1px 3px rgba(0,0,0,0.06), 0 1px 4px rgba(0,0,0,0.08);
    min-height: 200px;
    max-height: 320px;
    overflow: hidden;
    transition: opacity 0.15s;
  }
  .book-textarea {
    width: 100%;
    min-height: 200px;
    max-height: 320px;
    padding: 0.857rem;
    border: none;
    background: transparent;
    font-size: 0.95rem;
    font-family: 'Georgia', 'Times New Roman', serif;
    line-height: 1.6;
    color: #2c2c2c;
    resize: vertical;
    box-sizing: border-box;
    outline: none;
  }
  .book-page-content {
    padding: 0.857rem;
    font-size: 0.95rem;
    font-family: 'Georgia', 'Times New Roman', serif;
    line-height: 1.6;
    color: #2c2c2c;
    max-height: 320px;
    overflow-y: auto;
  }
  .book-line {
    display: block;
    min-height: 1.6em;
  }
  .book-line:empty::before { content: '\00a0'; }

  /* ── History Section ── */
  .history-section {
    margin-top: 0.714rem;
  }
  .history-toggle {
    display: flex;
    align-items: center;
    gap: 0.429rem;
    background: none;
    border: none;
    padding: 0.429rem 0;
    cursor: pointer;
    font-size: 0.786rem;
    font-weight: 600;
    color: var(--text-secondary, #6b7280);
    width: 100%;
    text-align: left;
    transition: color 0.12s;
  }
  .history-toggle:hover { color: var(--text-primary, #111827); }
  .history-toggle svg { transition: transform 0.15s; }
  .history-toggle svg.rotated { transform: rotate(90deg); }
  .history-list {
    display: flex;
    flex-direction: column;
    gap: 0.571rem;
    max-height: 14rem;
    overflow-y: auto;
    border: 1px solid var(--border, #e5e7eb);
    border-radius: 0.429rem;
    padding: 0.571rem;
  }
  .diff-entry {
    font-size: 0.786rem;
    border-bottom: 1px solid var(--border-light, #f3f4f6);
    padding-bottom: 0.429rem;
  }
  .diff-entry:last-child { border-bottom: none; padding-bottom: 0; }
  .diff-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.286rem;
  }
  .diff-date {
    font-size: 0.643rem;
    color: var(--text-muted, #9ca3af);
    font-weight: 500;
  }
  .diff-del {
    background: none;
    border: none;
    color: var(--text-muted, #9ca3af);
    cursor: pointer;
    font-size: 0.643rem;
    padding: 0.071rem 0.286rem;
    border-radius: 0.143rem;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .diff-entry:hover .diff-del { opacity: 1; }
  .diff-del:hover { color: #ef4444; background: rgba(239,68,68,0.08); }
  .diff-body {
    font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
    font-size: 0.714rem;
    line-height: 1.45;
    border-radius: 0.286rem;
    overflow: hidden;
  }
  .diff-line {
    display: flex;
    align-items: flex-start;
    padding: 0.071rem 0.429rem;
  }
  .diff-prefix {
    width: 1rem;
    flex-shrink: 0;
    user-select: none;
    color: inherit;
  }
  .diff-text {
    flex: 1;
    white-space: pre-wrap;
    word-break: break-all;
    min-width: 0;
  }
  .diff-same { background: transparent; color: var(--text-muted, #9ca3af); }
  .diff-add {
    background: rgba(34,197,94,0.1);
    border-left: 2px solid #22c55e;
    color: #166534;
  }
  .diff-remove {
    background: rgba(239,68,68,0.08);
    border-left: 2px solid #ef4444;
    color: #991b1b;
  }

  .modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.4);
    display: flex; align-items: center; justify-content: center; z-index: 1000;
  }
  .modal {
    background: var(--bg-card, #fff); border-radius: 0.857rem; padding: 1.429rem;
    min-width: 30rem; max-width: 90vw; max-height: 80vh; overflow: auto;
    box-shadow: 0 0.571rem 2.143rem rgba(0,0,0,0.15);
  }
  .modal-notes { min-width: 38rem; }
  .modal h3 { margin: 0 0 1rem; color: var(--text-primary); }
  .modal-body { display: flex; flex-direction: column; gap: 0.714rem; }
  .modal-footer {
    display: flex; justify-content: flex-end; gap: 0.571rem;
    margin-top: 1rem; padding-top: 0.857rem; border-top: 1px solid var(--border-light, #e5e7eb);
  }
  .btn {
    padding: 0.571rem 1.143rem; border: none; border-radius: 0.429rem;
    cursor: pointer; font-size: 0.92rem; font-weight: 500; transition: all 0.15s;
  }
  .btn:hover { filter: brightness(0.95); }
  .btn-primary { background: #22c55e; color: white; }
  .btn-secondary { background: var(--bg-hover); color: var(--text-secondary); }
  .btn:disabled { opacity: 0.6; cursor: not-allowed; }

  /* ── Kanban Viajes ── */
  .kanban-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.5);
    display: flex; align-items: center; justify-content: center;
    z-index: 1000; padding: 1.5rem;
  }
  .kanban-modal {
    background: var(--bg-card, #fff);
    border-radius: 12px;
    width: 95vw;
    max-width: 1400px;
    height: 88vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 8px 32px rgba(0,0,0,0.25);
    overflow: hidden;
  }
  .kanban-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border, #e5e7eb);
    flex-shrink: 0;
  }
  .kanban-modal-title {
    display: flex;
    align-items: center;
    gap: 0.571rem;
    color: var(--text-primary, #111827);
  }
  .kanban-modal-title h2 { margin: 0; font-size: 1.2rem; font-weight: 700; }
  .kanban-modal-title svg { color: #16a34a; }
  .kanban-modal-actions {
    display: flex;
    align-items: center;
    gap: 0.571rem;
  }
  .kanban-btn-save {
    display: inline-flex;
    align-items: center;
    gap: 0.429rem;
    background: #16a34a;
    border: none;
    border-radius: 6px;
    color: white;
    font-size: 0.857rem;
    font-weight: 600;
    padding: 0.5rem 1rem;
    cursor: pointer;
    font-family: var(--font);
    transition: background 0.12s;
  }
  .kanban-btn-save:hover { background: #15803d; }
  .kanban-btn-close {
    width: 2rem;
    height: 2rem;
    border: none;
    background: var(--bg-hover, #f3f4f6);
    border-radius: 6px;
    color: var(--text-muted, #9ca3af);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.1rem;
    transition: all 0.12s;
  }
  .kanban-btn-close:hover { background: rgba(239,68,68,0.08); color: #ef4444; }

  .kanban-board {
    display: flex;
    gap: 1rem;
    padding: 1rem 1.25rem;
    flex: 1;
    min-height: 0;
    overflow-x: auto;
    background: var(--bg-page, #f3f4f6);
  }
  .kanban-column {
    min-width: 300px;
    max-width: 380px;
    flex: 1;
    display: flex;
    flex-direction: column;
    background: linear-gradient(180deg, #16a34a 0%, #14532d 100%);
    border-radius: 10px;
    overflow: hidden;
    transition: box-shadow 0.15s;
  }
  .kanban-column.drag-over {
    box-shadow: 0 0 0 3px #3b82f6;
  }
  .kanban-column-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    background: rgba(255,255,255,0.06);
    border-bottom: 1px solid rgba(255,255,255,0.08);
    flex-shrink: 0;
  }
  .kanban-col-sin {
    opacity: 0.7;
  }
  .kanban-col-title {
    flex: 1;
    font-size: 15px;
    font-weight: 700;
    color: rgba(255,255,255,0.9);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .kanban-col-count {
    font-size: 12px;
    font-weight: 600;
    color: rgba(255,255,255,0.5);
    background: rgba(255,255,255,0.08);
    padding: 2px 8px;
    border-radius: 10px;
  }
  .kanban-column-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .kanban-column-body .cliente-card {
    padding: 10px 12px;
    gap: 8px;
    border-radius: 8px;
    background: rgba(255,255,255,0.04);
  }
  .kanban-column-body .cliente-card:hover { background: rgba(255,255,255,0.08); }
  .kanban-column-body .cliente-nombre { font-size: 15px; }
  .kanban-column-body .cliente-dir { font-size: 12px; }
  .kanban-column-body .cliente-order { width: 22px; height: 22px; min-width: 22px; font-size: 11px; }
  .kanban-column-body .cliente-drag { font-size: 16px; }
  .kanban-column-body .factura-chip { font-size: 11px; padding: 4px 8px; }
  .kanban-column-body .factura-num { font-size: 11px; }
  .kanban-column-body .cliente-remove { opacity: 0; }
  .kanban-column-body .cliente-card:hover .cliente-remove { opacity: 1; }
</style>
