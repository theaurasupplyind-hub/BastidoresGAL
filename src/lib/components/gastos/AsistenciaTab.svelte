<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import type { Employee, Attendance } from '$lib/types';

  let employees = $state<Employee[]>([]);
  let attendanceRecords = $state<Attendance[]>([]);
  let attMonth = $state(new Date().toISOString().slice(0, 7));
  let attDirty = $state<Set<string>>(new Set());
  let attData = $state<Map<string, Map<string, string>>>(new Map());
  let selectedAttEmp = $state<number | null>(null);

  function getDaysInMonth(month: string): number {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }

  function getDatesInMonth(month: string): string[] {
    const days = getDaysInMonth(month);
    const [y, m] = month.split('-').map(Number);
    const dates: string[] = [];
    for (let d = 1; d <= days; d++) {
      dates.push(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    return dates;
  }

  function getDayName(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'][d.getDay()];
  }

  function isWeekend(dateStr: string): boolean {
    const d = new Date(dateStr + 'T12:00:00');
    return d.getDay() === 0 || d.getDay() === 6;
  }

  function getAttClass(empId: number, date: string): string {
    const empMap = attData.get(String(empId));
    const status = empMap?.get(date);
    if (!status) return 'att-none';
    if (status === 'PRESENTE' || status?.startsWith('PRESENTE')) return 'att-present';
    if (status === 'AUSENTE') return 'att-absent';
    if (status?.startsWith('TARDE')) return 'att-late';
    if (status === 'VACACIONES') return 'att-vacation';
    if (status === 'LICENCIA') return 'att-license';
    return 'att-none';
  }

  function getAttShort(empId: number, date: string): string {
    const empMap = attData.get(String(empId));
    const status = empMap?.get(date);
    if (!status) return '';
    if (status.startsWith('PRESENTE')) return 'P';
    if (status === 'AUSENTE') return 'A';
    if (status.startsWith('TARDE')) return 'T';
    if (status === 'VACACIONES') return 'V';
    if (status === 'LICENCIA') return 'L';
    return '?';
  }

  function invalidateCache() {
    cacheStore.invalidate('employees:active');
    cacheStore.invalidate('attendance');
  }

  onMount(() => { loadAttendance(); });

  async function loadAttendance() {
    try {
      const cacheKey = `attendance:${attMonth}:${selectedAttEmp ?? 'all'}`;
      attendanceRecords = await cacheStore.fetch(cacheKey, () => api.listAttendance(selectedAttEmp || undefined, attMonth), 120000);
      const map = new Map<string, Map<string, string>>();
      for (const r of attendanceRecords) {
        const eid = String(r.employee_id);
        if (!map.has(eid)) map.set(eid, new Map());
        map.get(eid)!.set(r.date, r.status);
      }
      attData = map;

      if (employees.length === 0) {
        employees = await cacheStore.fetch('employees:active', () => api.listEmployees(true), 900000);
      }
    } catch {}
  }

  async function toggleAttendance(empId: number, date: string) {
    const eid = String(empId);
    const empMap = attData.get(eid) || new Map();
    const current = empMap.get(date);
    const newStatus = current === 'PRESENTE' ? 'AUSENTE' : 'PRESENTE';
    empMap.set(date, newStatus);
    attData.set(eid, empMap);
    attData = attData;
    attDirty.add(`${empId}_${date}`);
    attDirty = attDirty;
  }

  async function saveAttendance() {
    if (attDirty.size === 0) return;
    const records: any[] = [];
    for (const key of attDirty) {
      const [empId, date] = key.split('_');
      const empMap = attData.get(empId);
      if (empMap) {
        records.push({ employee_id: parseInt(empId), date, status: empMap.get(date) || 'AUSENTE' });
      }
    }
    try {
      await api.saveAttendanceBulk(records);
      attDirty = new Set();
      invalidateCache();
      appStore.showToast('Asistencia guardada');
    } catch (e) {
      appStore.alert('Error: ' + (e as Error).message);
    }
  }
</script>

<div class="g-asistencia">
  <div class="g-att-toolbar">
    <input type="month" bind:value={attMonth} onchange={loadAttendance} />
    <select bind:value={selectedAttEmp} onchange={loadAttendance}>
      <option value={null}>Todos</option>
      {#each employees as e}
        <option value={e.id}>{e.name}</option>
      {/each}
    </select>
    <button class="btn btn-sm btn-primary" onclick={saveAttendance} disabled={attDirty.size === 0}>
      {attDirty.size > 0 ? `Guardar (${attDirty.size})` : 'Guardar'}
    </button>
    <button class="btn btn-sm btn-secondary" onclick={loadAttendance}>🔄</button>
  </div>
  <div class="g-att-grid">
    <table class="att-table">
      <thead>
        <tr>
          <th class="att-th-emp">Empleado</th>
          {#each getDatesInMonth(attMonth) as date}
            <th class="att-th-day" class:weekend={isWeekend(date)}>
              {new Date(date + 'T12:00:00').getDate()}
              <span class="att-day-name">{getDayName(date)}</span>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each employees as emp}
          <tr>
            <td class="att-td-emp">{emp.name}</td>
            {#each getDatesInMonth(attMonth) as date}
              <td
                class="att-cell {getAttClass(emp.id, date)}"
                class:weekend={isWeekend(date)}
                onclick={() => !isWeekend(date) && toggleAttendance(emp.id, date)}
                role="button"
                tabindex="0"
                onkeydown={(e) => e.key === 'Enter' && !isWeekend(date) && toggleAttendance(emp.id, date)}
              >
                {getAttShort(emp.id, date)}
              </td>
            {/each}
          </tr>
        {:else}
          <tr><td colspan={getDatesInMonth(attMonth).length + 1} class="g-empty">Sin empleados activos</td></tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>

<style>
  .g-asistencia { display: flex; flex-direction: column; gap: 0.571rem; flex: 1; min-height: 0; }
  .g-att-toolbar {
    display: flex;
    gap: 0.571rem;
    align-items: center;
    background: var(--bg-card);
    padding: 0.571rem 0.857rem;
    border-radius: 0.571rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }
  .g-att-toolbar input,
  .g-att-toolbar select {
    padding: 0.357rem 0.571rem;
    border: 1px solid var(--border);
    border-radius: 0.357rem;
    font-size: 0.85rem;
  }

  .g-att-grid {
    flex: 1;
    overflow: auto;
     background: var(--bg-card);
   }
   .att-table {
     border-collapse: collapse;
     font-size: 0.75rem;
   }
  .att-table th {
    background: var(--bg-page);
    padding: 0.286rem 0.214rem;
    font-weight: 600;
    color: var(--text-secondary);
    font-size: 0.68rem;
    position: sticky;
    top: 0;
    z-index: 1;
    border-bottom: 2px solid var(--border-light);
    text-align: center;
    min-width: 1.857rem;
  }
  .att-th-emp { text-align: left; min-width: 8.571rem; position: sticky; left: 0; z-index: 2; background: var(--bg-page); }
  .att-th-day.weekend { color: var(--text-muted); }
  .att-day-name { display: block; font-size: 0.6rem; color: var(--text-muted); }
  .att-table td {
    padding: 0.214rem;
    text-align: center;
    border-bottom: 1px solid #f0f0f0;
    cursor: pointer;
  }
  .att-td-emp { text-align: left; font-weight: 500; position: sticky; left: 0; background: var(--bg-card); z-index: 1; min-width: 8.571rem; }
  .att-cell { transition: background 0.12s; }
  .att-cell:hover { filter: brightness(0.9); }
  .att-cell.weekend { background: #f9f9f9; cursor: default; }
  .att-present { background: #d4edda; color: #155724; font-weight: 600; }
  .att-absent { background: #f8d7da; color: #721c24; font-weight: 600; }
  .att-late { background: #fff3cd; color: #856404; font-weight: 600; }
  .att-vacation { background: #d1ecf1; color: #0c5460; }
  .att-license { background: #e2d9f3; color: #5a3d8a; }
  .att-none { color: #ddd; }
  .g-empty { padding: 1.429rem; text-align: center; color: var(--text-muted); font-size: 0.82rem; }
</style>
