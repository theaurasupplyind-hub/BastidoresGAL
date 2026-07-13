<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';

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
  let loadingEntregas = $state(false);
  const today = new Date().toISOString().split('T')[0];

  async function loadEntregas() {
    loadingEntregas = true;
    try { entregas = await api.getMapaEntregas(today); } catch { entregas = []; } finally { loadingEntregas = false; }
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

      for (const f of (facturas || [])) {
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
  let noteHistory = $state<Array<{ id: number; preview: string; created_at: string }>>([]);
  let showNotesModal = $state(false);
  let notesTemp = $state('');
  let savingNote = $state(false);
  async function loadNotes() {
    try {
      const data = await api.getNotes();
      notes = data.content || '';
      noteHistory = data.history || [];
    } catch { notes = ''; noteHistory = []; }
  }
  async function saveNote() {
    const content = notesTemp;
    if (!content && !notes) return;
    savingNote = true;
    try {
      await api.saveNotes({ content });
      notes = content;
      await loadNotes();
    } catch { } finally { savingNote = false; }
  }
  async function deleteNoteEntry(id: number) {
    try {
      await api.deleteNote(id);
      await loadNotes();
    } catch {}
  }
  function openNotes() { notesTemp = notes; showNotesModal = true; }
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
    loadEntregas();
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
      <div class="card-header entregas-header">
        <div class="card-title-row">
          <svg class="card-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          <span class="card-title">ENTREGAS DE HOY</span>
        </div>
        <span class="card-badge badge-white">{entregas.length} programadas</span>
      </div>
      <div class="entregas-stats">
        <div class="entregas-stat">
          <span class="stat-big">{entregas.reduce((s: number, e: any) => s + (e.facturas?.length || 0), 0)}</span>
          <span class="stat-label">entregas totales</span>
        </div>
        <div class="entregas-stat">
          <span class="stat-big">{entregas.length}</span>
          <span class="stat-label">clientes</span>
        </div>
      </div>
      <div class="entregas-list">
        {#each entregas as e (e.id)}
          <div class="entrega-item">
            <div class="entrega-cliente">{e.nombre}</div>
            {#each e.facturas as f}
              <div class="entrega-factura">
                <span class="entrega-num">{f.numero_factura || '#' + f.id}</span>
                <span class="entrega-monto">${(f.total || 0).toLocaleString('es-AR')}</span>
              </div>
            {/each}
            <div class="entrega-dom">{e.domicilio}</div>
          </div>
        {/each}
        {#if loadingEntregas}
          <div class="entregas-empty">Cargando...</div>
        {:else if entregas.length === 0}
          <div class="entregas-empty">Sin entregas programadas hoy</div>
        {/if}
      </div>
      <button class="entregas-link" onclick={() => appStore.currentTab = 'mapa'}>
        Ver mapa de entregas →
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
      <h3>Notas</h3>
      <div class="modal-body">
        <textarea class="notes-modal-input" placeholder="Escribí una nota..." bind:value={notesTemp}></textarea>
        {#if noteHistory.length > 0}
          <div class="notes-history">
            <span class="notes-history-title">Historial (7 días)</span>
            {#each noteHistory as entry (entry.id)}
              <div class="notes-history-item">
                <div class="notes-history-head">
                  <span class="notes-history-date">{formatShortDate(entry.created_at)}</span>
                  <button class="notes-history-del" onclick={() => deleteNoteEntry(entry.id)} aria-label="Borrar entrada">✕</button>
                </div>
                <span class="notes-history-text">{entry.preview}{entry.preview?.length >= 200 ? '...' : ''}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" onclick={saveNote} disabled={savingNote}>{savingNote ? 'Guardando...' : 'Guardar'}</button>
        <button class="btn btn-secondary" onclick={closeNotes}>Cerrar</button>
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
  .entregas-header { background: linear-gradient(135deg, #16a34a, #15803d); }
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
  .entregas-empty {
    text-align: center;
    color: rgba(255,255,255,0.6);
    font-size: 0.857rem;
    padding: 1.5rem 0;
  }
  .entregas-link {
    background: none;
    border: none;
    color: rgba(255,255,255,0.7);
    font-size: 0.786rem;
    padding: 0.571rem 0.857rem;
    text-align: left;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.12s;
  }
  .entregas-link:hover { color: white; }

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
  .notes-modal-input {
    width: 100%;
    min-height: 200px;
    padding: 0.714rem;
    border: 1px solid var(--border, #d1d5db);
    border-radius: 0.429rem;
    font-size: 0.95rem;
    font-family: var(--font, inherit);
    resize: vertical;
    box-sizing: border-box;
    outline: none;
  }
  .notes-modal-input:focus { border-color: var(--border-focus, #3b82f6); }
  .notes-history {
    display: flex;
    flex-direction: column;
    gap: 0.429rem;
    max-height: 12rem;
    overflow-y: auto;
  }
  .notes-history-title {
    font-size: 0.714rem;
    font-weight: 600;
    color: var(--text-muted, #9ca3af);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .notes-history-item {
    display: flex;
    flex-direction: column;
    gap: 0.143rem;
    padding: 0.357rem 0.5rem;
    border-left: 2px solid var(--border, #e5e7eb);
    border-radius: 0 0.286rem 0.286rem 0;
    font-size: 0.786rem;
  }
  .notes-history-date {
    font-size: 0.643rem;
    color: var(--text-muted, #9ca3af);
  }
  .notes-history-text {
    color: var(--text-primary, #111827);
    line-height: 1.35;
  }
  .notes-history-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .notes-history-del {
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
  .notes-history-item:hover .notes-history-del { opacity: 1; }
  .notes-history-del:hover { color: #ef4444; background: rgba(239,68,68,0.08); }

  .modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.4);
    display: flex; align-items: center; justify-content: center; z-index: 1000;
  }
  .modal {
    background: var(--bg-card, #fff); border-radius: 0.857rem; padding: 1.429rem;
    min-width: 30rem; max-width: 90vw; max-height: 80vh; overflow: auto;
    box-shadow: 0 0.571rem 2.143rem rgba(0,0,0,0.15);
  }
  .modal-notes { min-width: 35rem; }
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
</style>
