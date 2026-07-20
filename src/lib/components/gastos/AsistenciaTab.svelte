<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import type { Employee, Attendance } from '$lib/types';
  import { animate } from 'animejs';

  let employees = $state<Employee[]>([]);
  let attMonth = $state(new Date().toISOString().slice(0, 7));
  let attDirty = $state<Set<string>>(new Set());
  let attData = $state<Map<string, string>>(new Map());
  let selectedAttEmp = $state<number | ''>('');
  let isMonthView = $state(false);
  let auditEntries = $state<{ employeeName: string; status: string; date: string; id: number; employeeId: number }[]>([]);
  let gridWrapEl: HTMLElement;
  let showEditor = $state(false);
  let editorEmpId = $state(0);
  let editorDate = $state('');
  let editorStatus = $state('');
  let editorTime = $state('');

  function key(empId: number, date: string) { return `${empId}_${date}`; }

  function getWeekDates(): Date[] {
    const [y, m] = attMonth.split('-').map(Number);
    const days = new Date(y, m, 0).getDate();
    return Array.from({ length: days }, (_, i) => new Date(y, m - 1, i + 1));
  }

  function getMonthDates(): string[] {
    const days = new Date(+attMonth.split('-')[0], +attMonth.split('-')[1], 0).getDate();
    const [y, m] = attMonth.split('-').map(Number);
    return Array.from({ length: days }, (_, i) =>
      `${y}-${String(m).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`);
  }

  function dk(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

  function isToday(d: Date) { return dk(d) === dk(new Date()); }
  function isWeekend(d: Date) { return d.getDay() === 0 || d.getDay() === 6; }
  function isWeekendStr(s: string) { return isWeekend(new Date(s + 'T12:00:00')); }
  function dayName(d: Date) { return ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][d.getDay()]; }

  function isPresente(status: string | undefined) {
    if (!status || status === 'AUS' || status === 'VACACIONES' || status === 'LICENCIA') return false;
    return true;
  }

  function cellClass(status: string | undefined) {
    if (!status) return 'att-none';
    if (status === 'AUS') return 'att-absent';
    if (status === 'VACACIONES') return 'att-vacation';
    if (status === 'LICENCIA') return 'att-license';
    if (status.startsWith('TARDE')) return 'att-late';
    return 'att-present';
  }

  function cellText(status: string | undefined) {
    if (!status) return '';
    if (status === 'AUS') return 'AUS';
    if (status === 'VACACIONES') return 'VAC';
    if (status === 'LICENCIA') return 'LIC';
    if (status.startsWith('TARDE')) return status.replace('TARDE-', '⏰ ');
    if (status.startsWith('NOTA:')) return status.split(':')[1]?.slice(0, 6) || 'NOTA';
    return status;
  }

  function empSchedule(empId: number) {
    const e = employees.find(x => x.id === empId);
    return e ? { entry: e.entry_time, threshold: e.late_threshold ?? 5 } : null;
  }

  function classifyTime(empId: number, timeStr: string): string {
    const sched = empSchedule(empId);
    if (!sched || !sched.entry) return timeStr;
    const [eh, em] = sched.entry.split(':').map(Number);
    const [th, tm] = timeStr.split(':').map(Number);
    const diff = (th * 60 + tm) - (eh * 60 + em);
    if (diff > sched.threshold) return `TARDE-${timeStr}`;
    return timeStr;
  }

  function invalidateCache() {
    cacheStore.invalidate('employees:active');
    cacheStore.invalidate('attendance');
  }

  onMount(async () => {
    await loadAll();
    scrollToToday();
    if (gridWrapEl) {
      const onWheel = (e: WheelEvent) => { e.preventDefault(); gridWrapEl.scrollLeft += e.deltaY; };
      gridWrapEl.addEventListener('wheel', onWheel, { passive: false });
    }
  });

  async function loadAll() {
    try {
      const month = attMonth;
      const empId = selectedAttEmp || undefined;
      const cacheKey = `attendance:${month}:${empId ?? 'all'}`;
      const records: Attendance[] = await cacheStore.fetch(cacheKey, () => api.listAttendance(empId, month), 120000);
      const map = new Map<string, string>();
      for (const r of records) map.set(key(r.employee_id, r.date), r.status);
      attData = map;

      if (employees.length === 0)
        employees = await cacheStore.fetch('employees:active', () => api.listEmployees(true), 900000);

      const nameMap = new Map(employees.map(e => [e.id, e.name]));
      const sorted = [...records].sort((a, b) => b.id - a.id).slice(0, 10);
      auditEntries = sorted.map(r => ({
        employeeName: nameMap.get(r.employee_id) || `#${r.employee_id}`,
        status: r.status,
        date: r.date,
        id: r.id,
        employeeId: r.employee_id,
      }));
    } catch (e) {
      console.error('[asistencia] Error:', e);
      appStore.alert('Error al cargar asistencias');
    }
  }

  function openEditor(empId: number, date: string) {
    const k = key(empId, date);
    const current = attData.get(k) || '';
    editorEmpId = empId;
    editorDate = date;
    editorStatus = current;
    if (current && current !== 'AUS' && current !== 'VACACIONES' && current !== 'LICENCIA' && !current.startsWith('NOTA:')) {
      editorTime = current.replace('TARDE-', '');
    } else {
      const now = new Date();
      editorTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    }
    showEditor = true;
  }

  function editorSetStatus(s: string) {
    editorStatus = s;
  }

  $effect(() => {
    const time = editorTime;
    const empId = editorEmpId;
    if (!time || !empId) return;
    if (editorStatus === 'AUS' || editorStatus === 'VACACIONES' || editorStatus === 'LICENCIA' || editorStatus.startsWith('NOTA:')) return;
    const classified = classifyTime(empId, time);
    if (classified.startsWith('TARDE-')) {
      editorStatus = 'TARDE';
    } else {
      editorStatus = '';
    }
  });

  async function saveEditor() {
    let finalStatus = editorStatus;
    if (editorStatus === 'PRESENTE' || editorStatus === '' || (!['AUS', 'VACACIONES', 'LICENCIA'].includes(editorStatus) && !editorStatus.startsWith('NOTA:'))) {
      finalStatus = classifyTime(editorEmpId, editorTime);
    }
    const k = key(editorEmpId, editorDate);
    attData.set(k, finalStatus);
    attDirty.add(k);
    showEditor = false;
    await saveAttendance();
  }

  async function deleteEditorAttendance() {
    try {
      await api.deleteAttendance(editorEmpId, editorDate);
      showEditor = false;
      invalidateCache();
      await loadAll();
      scrollToToday();
      if (gridWrapEl) animate(gridWrapEl, { opacity: [0, 1] as any, duration: 150, easing: 'ease-out' });
    } catch (e) {
      appStore.alert('Error al eliminar: ' + (e as Error).message);
    }
  }

  async function deleteAuditAttendance(employeeId: number, date: string) {
    try {
      await api.deleteAttendance(employeeId, date);
      invalidateCache();
      await loadAll();
      scrollToToday();
    } catch (e) {
      appStore.alert('Error al eliminar: ' + (e as Error).message);
    }
  }

  async function saveAttendance() {
    if (attDirty.size === 0) return;
    const records: any[] = [];
    for (const k of attDirty) {
      const parts = k.split('_');
      const date = parts.slice(1).join('_');
      records.push({ employee_id: parseInt(parts[0]), date, status: attData.get(k) || 'AUS' });
    }
    try {
      await api.saveAttendanceBulk(records);
      attDirty = new Set();
      invalidateCache();
      appStore.showToast(`Guardado (${records.length})`);
      await loadAll();
      scrollToToday();
    } catch (e) {
      appStore.alert('Error: ' + (e as Error).message);
    }
  }

  async function shiftMonth(delta: number) {
    const [y, m] = attMonth.split('-').map(Number);
    attMonth = `${new Date(y, m - 1 + delta, 15).getFullYear()}-${String(new Date(y, m - 1 + delta, 15).getMonth() + 1).padStart(2, '0')}`;
    await loadAll();
    scrollToToday();
  }

  function monthName(ym: string) {
    const [y, m] = ym.split('-').map(Number);
    const months = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    return `${months[m - 1]} ${y}`;
  }

  function scrollToToday() {
    if (!gridWrapEl || isMonthView) return;
    const day = new Date().getDate();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const empCol = 3 * rem;
    const cellW = 5.5 * rem;
    const dayOffset = empCol + (day - 1) * cellW + cellW / 2;
    const target = dayOffset - gridWrapEl.clientWidth / 2;
    const maxScroll = gridWrapEl.scrollWidth - gridWrapEl.clientWidth;
    gridWrapEl.scrollLeft = Math.max(0, Math.min(maxScroll, target));
  }

  function toggleView() {
    isMonthView = !isMonthView;
    if (gridWrapEl) {
      if (!isMonthView) scrollToToday();
      animate(gridWrapEl, { opacity: [0, 1] as any, duration: 200, easing: 'ease-out' });
    }
  }

  function statusIcon(status: string | undefined) {
    if (!status || status === 'AUS') return '🔴';
    if (status === 'VACACIONES') return '🏖️';
    if (status === 'LICENCIA') return '🏥';
    if (status.startsWith('TARDE')) return '⏰';
    return '🟢';
  }

</script>

<div class="g-asistencia">
  <div class="g-att-main">
    <div class="g-att-header">
      <button class="btn btn-sm" onclick={() => shiftMonth(-1)}>◀</button>
      <span class="g-month-name">{monthName(attMonth)}</span>
      <button class="btn btn-sm" onclick={() => shiftMonth(1)}>▶</button>
    </div>
    <div class="g-att-grid-wrap" bind:this={gridWrapEl}>
      <div class="g-att-grid">
        {#if isMonthView}
          <table class="att-table att-table-month">
            <thead>
              <tr>
                <th class="att-th-emp">Empleado</th>
                {#each getMonthDates() as date}
                  <th class="att-th-day" class:weekend={isWeekendStr(date)}>
                    {+date.slice(8, 10)}<span class="att-day-name">{dayName(new Date(date + 'T12:00:00'))}</span>
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each employees as emp}
                <tr>
                  <td class="att-td-emp">{emp.name}</td>
                  {#each getMonthDates() as date}
                    <td
                      class="att-cell {cellClass(attData.get(key(emp.id, date)))}"
                      class:weekend={isWeekendStr(date)}
                      onclick={() => openEditor(emp.id, date)}
                      role="button" tabindex="0"
                      onkeydown={(e) => e.key === 'Enter' && openEditor(emp.id, date)}
                    >
                      {cellText(attData.get(key(emp.id, date)))}
                    </td>
                  {/each}
                </tr>
              {:else}
                <tr><td colspan={getMonthDates().length + 1} class="g-empty">Sin empleados activos</td></tr>
              {/each}
            </tbody>
          </table>
        {:else}
          <table class="att-table att-table-week">
            <thead>
              <tr>
                <th class="att-th-emp">Empleado</th>
                {#each getWeekDates() as date}
                  <th class="att-th-day" class:today={isToday(date)} class:weekend={isWeekend(date)}>
                    <span class="att-day-num">{date.getDate()}</span>
                    <span class="att-day-name">{dayName(date)}</span>
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each employees as emp}
                <tr>
                  <td class="att-td-emp">{emp.name}</td>
                  {#each getWeekDates() as date}
                    {@const dateKey = dk(date)}
                    {@const status = attData.get(key(emp.id, dateKey))}
                    <td
                      class="att-cell {cellClass(status)}"
                      class:today={isToday(date)}
                      class:weekend={isWeekend(date)}
                      onclick={() => openEditor(emp.id, dateKey)}
                      role="button" tabindex="0"
                      onkeydown={(e) => e.key === 'Enter' && openEditor(emp.id, dateKey)}
                    >
                      <span class="att-cell-text">{cellText(status)}</span>
                    </td>
                  {/each}
                </tr>
              {:else}
                <tr><td colspan={getWeekDates().length + 1} class="g-empty">Sin empleados activos</td></tr>
              {/each}
            </tbody>
          </table>
        {/if}
      </div>
    </div>
  </div>

  <!-- Right panel -->
  <div class="g-att-panel">
    <div class="g-att-panel-section">
      <div class="g-att-panel-title">📋 Últimos registros</div>
      <div class="g-att-panel-list">
        {#each auditEntries as e}
          <div class="g-att-panel-item">
            <span class="g-att-panel-icon">{statusIcon(e.status)}</span>
            <span class="g-att-panel-name">{e.employeeName}</span>
            <span class="g-att-panel-status">{cellText(e.status) || e.status}</span>
            <span class="g-att-panel-date">{e.date.slice(5)}</span>
            <button class="btn-icon" onclick={() => deleteAuditAttendance(e.employeeId, e.date)} title="Eliminar">✕</button>
          </div>
        {:else}
          <div class="g-att-panel-empty">Sin registros</div>
        {/each}
      </div>
    </div>
    <div class="g-att-panel-divider"></div>
    <div class="g-att-panel-actions">
      <button class="btn btn-sm btn-secondary" onclick={toggleView} style="flex:1">{isMonthView ? '📅 Semana' : '📅 Mes'}</button>
      <button class="btn btn-sm btn-secondary" onclick={async () => { attMonth = new Date().toISOString().slice(0, 7); await loadAll(); scrollToToday(); }} style="flex:1">Hoy</button>
    </div>
    <div class="g-att-panel-actions">
      <select bind:value={selectedAttEmp} onchange={async () => { await loadAll(); scrollToToday(); }} class="g-att-select" style="flex:1">
        <option value={''}>Todos</option>
        {#each employees as e}
          <option value={e.id}>{e.name}</option>
        {/each}
      </select>
    </div>
    <div class="g-att-panel-actions">
      <button class="btn btn-sm btn-primary" onclick={saveAttendance} disabled={attDirty.size === 0} style="flex:1">
        {attDirty.size > 0 ? `Guardar (${attDirty.size})` : 'Guardar'}
      </button>
      <button class="btn btn-sm btn-secondary" onclick={loadAll}>🔄</button>
    </div>
  </div>
</div>

{#if showEditor}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={() => showEditor = false} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal att-editor" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
      <div class="att-editor-header">
        <div class="att-editor-emp-info">
          <span class="att-editor-emp">{employees.find(e => e.id === editorEmpId)?.name || ''}</span>
          {#if empSchedule(editorEmpId)}
            <span class="att-editor-sched">
              {empSchedule(editorEmpId)!.entry} · ±{empSchedule(editorEmpId)!.threshold}min
            </span>
          {/if}
        </div>
        <span class="att-editor-date">{editorDate.slice(8, 10)}/{editorDate.slice(5, 7)}/{editorDate.slice(0, 4)}</span>
      </div>
      <div class="att-editor-body">
        <div class="att-editor-statuses">
          <button class="btn btn-att-status" class:active={editorStatus === '' || editorStatus.startsWith('PRESENTE') || (!['AUS','VACACIONES','LICENCIA'].includes(editorStatus) && !editorStatus.startsWith('TARDE') && !editorStatus.startsWith('NOTA:'))} onclick={() => editorSetStatus('')}>✅ Presente</button>
          <button class="btn btn-att-status" class:active={editorStatus === 'TARDE'} onclick={() => editorSetStatus('TARDE')}>⏰ Tarde</button>
          <button class="btn btn-att-status" class:active={editorStatus === 'AUS'} onclick={() => editorSetStatus('AUS')}>❌ Ausente</button>
          <button class="btn btn-att-status" class:active={editorStatus === 'VACACIONES'} onclick={() => editorSetStatus('VACACIONES')}>🏖 Vacaciones</button>
          <button class="btn btn-att-status" class:active={editorStatus === 'LICENCIA'} onclick={() => editorSetStatus('LICENCIA')}>🏥 Licencia</button>
        </div>
        {#if editorStatus === '' || editorStatus.startsWith('TARDE') || editorStatus.startsWith('PRESENTE')}
          <div class="att-editor-time">
            <label>Hora:</label>
            <input type="time" bind:value={editorTime} />
          </div>
        {/if}
      </div>
      <div class="att-editor-actions">
        <button class="btn btn-sm btn-danger" onclick={deleteEditorAttendance} title="Eliminar registro">🗑</button>
        <span style="flex:1"></span>
        <button class="btn btn-sm btn-secondary" onclick={() => showEditor = false}>Cancelar</button>
        <button class="btn btn-sm btn-primary" onclick={saveEditor}>Guardar</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .g-asistencia { display: flex; gap: 0.35rem; flex: 1; min-height: 0; }

  .btn { font-size: 0.8rem; padding: 0.25rem 0.5rem; border: 1px solid var(--border); border-radius: 0.3rem; background: var(--bg-page); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
  .btn:disabled { opacity: 0.4; cursor: default; }
  .btn-primary { background: var(--accent); color: white; border-color: var(--accent); }
  .btn-secondary { background: var(--bg-hover); }

  .g-att-main { display: flex; flex-direction: column; gap: 0.35rem; flex: 1; min-width: 0; }
  .g-att-header {
    display: flex; gap: 0.3rem; align-items: center; justify-content: center;
    background: var(--bg-card); padding: 0.5rem 0.75rem;
    border-radius: 0.5rem; box-shadow: 0 0.07rem 0.2rem rgba(0,0,0,0.06);
  }
  .g-month-name { font-size: 1.3rem; font-weight: 700; min-width: 10rem; text-align: center; }
  .g-att-select { padding: 0.25rem 0.4rem; border: 1px solid var(--border); border-radius: 0.3rem; font-size: 0.8rem; }

  /* Right panel */
  .g-att-panel {
    width: 22rem; flex-shrink: 0;
    background: var(--bg-card); border-radius: 0.5rem;
    display: flex; flex-direction: column; overflow: hidden;
  }
  .g-att-panel-section { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .g-att-panel-title { font-size: 0.75rem; font-weight: 600; padding: 0.5rem 0.6rem; border-bottom: 1px solid var(--border-light); color: var(--text-secondary); }
  .g-att-panel-list { flex: 1; overflow-y: auto; padding: 0.3rem 0; }
  .g-att-panel-item { display: flex; align-items: center; gap: 0.3rem; padding: 0.25rem 0.6rem; font-size: 0.72rem; border-bottom: 1px solid #f0f0f0; }
  .g-att-panel-item .btn-icon { background: none; border: none; cursor: pointer; padding: 0 0.15rem; font-size: 0.65rem; color: var(--text-muted); line-height: 1; opacity: 0.4; transition: opacity 0.15s; }
  .g-att-panel-item .btn-icon:hover { opacity: 1; color: #c00; }
  .g-att-panel-icon { font-size: 0.65rem; }
  .g-att-panel-name { font-weight: 500; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .g-att-panel-status { color: var(--text-secondary); }
  .g-att-panel-date { color: var(--text-muted); font-size: 0.65rem; }
  .g-att-panel-empty { padding: 1rem; text-align: center; color: var(--text-muted); font-size: 0.75rem; }
  .g-att-panel-divider { border-top: 1px solid var(--border-light); margin: 0.25rem 0; }
  .g-att-panel-actions { display: flex; gap: 0.3rem; padding: 0.25rem 0.5rem; }

  /* Grid */
  .g-att-grid-wrap { flex: 1; overflow: auto; background: var(--bg-card); border-radius: 0.5rem; }
  .g-att-grid-wrap::-webkit-scrollbar { height: 6px; }
  .g-att-grid-wrap::-webkit-scrollbar-thumb { background: #ccc; border-radius: 3px; }

  .att-table { border-collapse: collapse; }
  .att-table-month { width: 100%; }
  .att-table th {
    background: var(--bg-page); padding: 0.3rem 0.15rem; font-weight: 600; color: var(--text-secondary);
    font-size: 0.68rem; position: sticky; top: 0; z-index: 1;
    border: 1px solid var(--border-light); text-align: center;
  }
  .att-th-emp { text-align: left; width: 5rem; position: sticky; left: 0; z-index: 2; background: var(--bg-page); border-left: none; }
  .att-th-day { font-size: 0.8rem; transition: background 0.15s; }
  .att-th-day.today { background: var(--accent); color: white; }
  .att-th-day.today .att-day-name { color: rgba(255,255,255,0.8); }
  .att-th-day:hover { background: var(--accent); color: white; }
  .att-th-day:hover .att-day-name { color: rgba(255,255,255,0.8); }
  .att-th-day.weekend { color: var(--text-muted); }
  .att-day-name { display: block; font-size: 0.65rem; font-weight: 400; color: var(--text-muted); }
  .att-table td { padding: 0.15rem; text-align: center; border: 1px solid #e8e8e8; cursor: pointer; }
  .att-td-emp { text-align: left; font-weight: 500; position: sticky; left: 0; background: var(--bg-card); z-index: 1; font-size: 0.78rem; padding: 0.15rem 0.25rem !important; max-width: 5rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-left: none; }

  /* Week cells */
  .att-table-week { width: max-content; min-width: 100%; table-layout: fixed; }
  .att-table-week td.att-cell { width: 5.5rem; height: 3.2rem; vertical-align: middle; }
  .att-table-week .att-cell-text { font-size: 0.95rem; font-weight: 600; display: block; }
  .att-table-week .att-td-emp { width: 3rem; font-size: 0.7rem; }

  /* Month cells */
  .att-table-month { table-layout: fixed; }
  .att-table-month td.att-cell { width: 2.2rem; font-size: 0.75rem; }

  .att-cell { transition: background 0.15s; }
  .att-cell:hover { filter: brightness(1.06); }
  .att-cell.weekend { background: #f5f5f5; cursor: default; }
  .att-cell.weekend:hover { filter: none; }

  .att-present { background: #d4edda; color: #155724; }
  .att-absent { background: #f8d7da; color: #721c24; }
  .att-late { background: #fff3cd; color: #856404; }
  .att-vacation { background: #d1ecf1; color: #0c5460; }
  .att-license { background: #e2d9f3; color: #5a3d8a; }
  .att-none { color: transparent; }
  .g-empty { padding: 1rem; text-align: center; color: var(--text-muted); font-size: 0.8rem; }

  /* Editor modal */
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal.att-editor { background: var(--bg-card); border-radius: 0.6rem; padding: 1rem 1.2rem; width: 18rem; box-shadow: 0 0.5rem 2rem rgba(0,0,0,0.2); }
  .att-editor-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.8rem; }
  .att-editor-emp-info { display: flex; flex-direction: column; gap: 0.15rem; }
  .att-editor-emp { font-size: 1rem; font-weight: 600; }
  .att-editor-sched { font-size: 0.7rem; color: var(--text-muted); }
  .att-editor-date { font-size: 0.8rem; color: var(--text-secondary); flex-shrink: 0; }
  .att-editor-body { display: flex; flex-direction: column; gap: 0.6rem; }
  .att-editor-statuses { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4rem; }
  .att-editor-statuses .btn-att-status { width: 100%; font-size: 0.95rem; padding: 0.5rem 0.6rem; border: 1px solid var(--border); border-radius: 0.4rem; background: var(--bg-page); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 0.3rem; transition: background 0.15s, color 0.15s; }
  .att-editor-statuses .btn-att-status.active { background: var(--accent); color: white; border-color: var(--accent); }
  .att-editor-time { display: flex; align-items: center; gap: 0.5rem; }
  .att-editor-time label { font-size: 0.85rem; font-weight: 500; }
  .att-editor-time input { padding: 0.3rem; border: 1px solid var(--border); border-radius: 0.3rem; font-size: 0.85rem; flex: 1; }
  .att-editor-actions { display: flex; gap: 0.3rem; align-items: center; margin-top: 0.6rem; }
</style>
