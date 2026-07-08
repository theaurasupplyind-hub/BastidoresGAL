<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import type { Employee } from '$lib/types';

  let employees = $state<Employee[]>([]);
  let selectedEmployee = $state<Employee | null>(null);
  let employeePayments = $state<any[]>([]);
  let showEmployeeForm = $state(false);
  let employeeForm = $state<{ id: number | null; name: string; phone: string; address: string; job_type: string; payment_freq: string; base_salary: number; attendance_bonus: number; work_days: string }>({
    id: null, name: '', phone: '', address: '', job_type: 'NOMINA', payment_freq: 'MENSUAL', base_salary: 0, attendance_bonus: 0, work_days: 'L M M J V S'
  });
  let showEmployeePayForm = $state(false);
  let empPayForm = $state<{ amount: number; date: string; concept: string }>({ amount: 0, date: '', concept: '' });

  function formatCurrency(n: number): string {
    return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2 });
  }

  function formatDate(d: string): string {
    if (!d) return '';
    const p = d.split('-');
    if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
    return d;
  }

  function invalidateCache() {
    cacheStore.invalidate('employees');
    cacheStore.invalidate('employees:active');
    cacheStore.invalidate('employee:payments');
  }

  onMount(() => { loadEmployees(); });

  async function loadEmployees() {
    try {
      employees = await cacheStore.fetch('employees', () => api.listEmployees(false), 900000);
    } catch {}
  }

  async function selectEmployee(e: Employee) {
    selectedEmployee = e;
    try {
      const detail = await api.getEmployee(e.id);
      employeePayments = detail?.payments || [];
    } catch {}
  }

  function openNewEmployee() {
    employeeForm = { id: null, name: '', phone: '', address: '', job_type: 'NOMINA', payment_freq: 'MENSUAL', base_salary: 0, attendance_bonus: 0, work_days: 'L M M J V S' };
    showEmployeeForm = true;
  }

  function openEditEmployee(e: Employee) {
    employeeForm = {
      id: e.id, name: e.name, phone: e.phone, address: e.address,
      job_type: e.job_type, payment_freq: e.payment_freq,
      base_salary: e.base_salary, attendance_bonus: e.attendance_bonus,
      work_days: e.work_days || 'L M M J V S',
    };
    showEmployeeForm = true;
  }

  async function saveEmployee() {
    try {
      if (employeeForm.id) {
        await api.updateEmployee(employeeForm.id, employeeForm);
      } else {
        await api.addEmployee(employeeForm);
      }
      showEmployeeForm = false;
      invalidateCache();
      await loadEmployees();
    } catch (e) {
      appStore.alert('Error al guardar: ' + (e as Error).message);
    }
  }

  async function deleteEmployee(id: number) {
    if (!confirm('¿Eliminar este empleado?')) return;
    try {
      await api.deleteEmployee(id);
      if (selectedEmployee?.id === id) selectedEmployee = null;
      invalidateCache();
      await loadEmployees();
    } catch (e) {
      appStore.alert('Error: ' + (e as Error).message);
    }
  }

  function openPayEmployee() {
    empPayForm = { amount: 0, date: new Date().toISOString().slice(0, 10), concept: '' };
    showEmployeePayForm = true;
  }

  async function saveEmployeePay() {
    if (!selectedEmployee) return;
    try {
      await api.addEmployeePayment({
        employee_id: selectedEmployee.id,
        date: empPayForm.date,
        amount: empPayForm.amount,
        concept: empPayForm.concept || 'Pago',
      });
      showEmployeePayForm = false;
      invalidateCache();
      await selectEmployee(selectedEmployee);
    } catch (e) {
      appStore.alert('Error: ' + (e as Error).message);
    }
  }

  async function deleteEmployeePay(id: number) {
    if (!confirm('¿Eliminar este pago?')) return;
    try {
      await api.deleteEmployeePayment(id);
      invalidateCache();
      if (selectedEmployee) await selectEmployee(selectedEmployee);
    } catch (e) {
      appStore.alert('Error: ' + (e as Error).message);
    }
  }
</script>

<div class="g-sueldos">
  <div class="g-emp-sidebar">
    <div class="g-emp-toolbar">
      <button class="btn btn-sm btn-primary" onclick={openNewEmployee}>➕ Nuevo</button>
    </div>
    <div class="g-emp-list">
      {#each employees as e}
        <div
          class="g-emp-item"
          class:active={selectedEmployee?.id === e.id}
          onclick={() => selectEmployee(e)}
          role="button"
          tabindex="0"
          onkeydown={(e2) => e2.key === 'Enter' && selectEmployee(e)}
        >
          <span class="g-emp-name">{e.name}</span>
          <span class="g-emp-type">{e.job_type}</span>
        </div>
      {:else}
        <div class="g-empty">Sin empleados</div>
      {/each}
    </div>
  </div>
  <div class="g-emp-detail">
    {#if selectedEmployee}
      <div class="g-emp-detail-header">
        <h3>{selectedEmployee.name}</h3>
        <span class="g-emp-badge">{selectedEmployee.job_type}</span>
        <span class="g-emp-badge">{selectedEmployee.payment_freq}</span>
        <div class="g-emp-actions">
          <button class="btn btn-xs btn-secondary" onclick={() => openEditEmployee(selectedEmployee)}>✏️</button>
          <button class="btn btn-xs btn-primary" onclick={openPayEmployee}>💰 Pago</button>
          <button class="btn btn-xs btn-danger" onclick={() => deleteEmployee(selectedEmployee.id)}>🗑</button>
        </div>
      </div>
      <div class="g-emp-info">
        <span>Tel: {selectedEmployee.phone || '—'}</span>
        <span>Dir: {selectedEmployee.address || '—'}</span>
        <span>Salario base: {formatCurrency(selectedEmployee.base_salary || 0)}</span>
        <span>Días: {selectedEmployee.work_days}</span>
      </div>
      <div class="g-pays-list">
        <h4>Historial de pagos</h4>
        {#each [...employeePayments].reverse() as p}
          <div class="g-pay-item">
            <span class="g-pay-date">{formatDate(p.date)}</span>
            <span class="g-pay-concept">{p.concept || 'Pago'}</span>
            <span class="g-pay-amount">{formatCurrency(p.amount)}</span>
            <button class="btn btn-xs btn-danger" onclick={() => deleteEmployeePay(p.id)}>✕</button>
          </div>
        {:else}
          <div class="g-empty">Sin pagos registrados</div>
        {/each}
      </div>
    {:else}
      <div class="g-empty">Seleccione un empleado</div>
    {/if}
  </div>
</div>

<!-- Employee Form Modal -->
{#if showEmployeeForm}
  <div class="modal-overlay" onclick={() => showEmployeeForm = false} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (showEmployeeForm = false)}>
      <h3>{employeeForm.id ? 'Editar' : 'Nuevo'} Empleado</h3>
      <div class="modal-body">
        <div class="form-group"><label>Nombre</label><input type="text" bind:value={employeeForm.name} /></div>
        <div class="form-group"><label>Teléfono</label><input type="text" bind:value={employeeForm.phone} /></div>
        <div class="form-group"><label>Dirección</label><input type="text" bind:value={employeeForm.address} /></div>
        <div class="form-row">
          <div class="form-group"><label>Tipo</label>
            <select bind:value={employeeForm.job_type}>
              <option value="NOMINA">Nómina</option>
              <option value="OCASIONAL">Ocasional</option>
            </select>
          </div>
          <div class="form-group"><label>Frecuencia</label>
            <select bind:value={employeeForm.payment_freq}>
              <option value="SEMANAL">Semanal</option>
              <option value="MENSUAL">Mensual</option>
              <option value="POR HORA">Por hora</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Salario base</label><input type="number" bind:value={employeeForm.base_salary} step="0.01" /></div>
          <div class="form-group"><label>Bono asistencia</label><input type="number" bind:value={employeeForm.attendance_bonus} step="0.01" /></div>
        </div>
        <div class="form-group"><label>Días laborales</label><input type="text" bind:value={employeeForm.work_days} placeholder="L M M J V S" /></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={() => showEmployeeForm = false}>Cancelar</button>
        <button class="btn btn-primary" onclick={saveEmployee}>Guardar</button>
      </div>
    </div>
  </div>
{/if}

<!-- Employee Pay Modal -->
{#if showEmployeePayForm}
  <div class="modal-overlay" onclick={() => showEmployeePayForm = false} role="presentation">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (showEmployeePayForm = false)}>
      <h3>Registrar Pago - {selectedEmployee?.name}</h3>
      <div class="modal-body">
        <div class="form-group"><label>Fecha</label><input type="date" bind:value={empPayForm.date} /></div>
        <div class="form-group"><label>Monto</label><input type="number" bind:value={empPayForm.amount} step="0.01" /></div>
        <div class="form-group"><label>Concepto</label><input type="text" bind:value={empPayForm.concept} /></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={() => showEmployeePayForm = false}>Cancelar</button>
        <button class="btn btn-primary" onclick={saveEmployeePay}>Guardar</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .g-sueldos {
    display: flex;
    gap: 0.714rem;
    flex: 1;
    min-height: 0;
  }
  .g-emp-sidebar {
    width: 15.714rem;
    background: white;
    border-radius: 0.571rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    overflow: hidden;
  }
  .g-emp-toolbar { padding: 0.571rem; border-bottom: 1px solid #eee; }
  .g-emp-list { flex: 1; overflow: auto; }
  .g-emp-item {
    padding: 0.571rem 0.714rem;
    cursor: pointer;
    border-bottom: 1px solid #f5f5f5;
  }
  .g-emp-item:hover { background: #f8f9fa; }
  .g-emp-item.active { background: #e8f4fd; border-left: 0.214rem solid #3498db; }
  .g-emp-name { display: block; font-weight: 600; font-size: 0.85rem; }
  .g-emp-type { font-size: 0.7rem; color: #999; }

  .g-emp-detail {
    flex: 1;
    background: white;
    border-radius: 0.571rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .g-emp-detail-header {
    display: flex;
    align-items: center;
    gap: 0.571rem;
    padding: 0.714rem 1rem;
    border-bottom: 1px solid #eee;
    flex-wrap: wrap;
  }
  .g-emp-detail-header h3 { margin: 0; font-size: 1rem; }
  .g-emp-badge {
    font-size: 0.68rem;
    padding: 0.143rem 0.571rem;
    border-radius: 0.571rem;
    background: #e9ecef;
    color: #555;
  }
  .g-emp-actions { margin-left: auto; display: flex; gap: 0.286rem; }
  .g-emp-info {
    display: flex;
    flex-wrap: wrap;
    gap: 0.857rem;
    padding: 0.571rem 1rem;
    font-size: 0.78rem;
    color: #888;
    border-bottom: 1px solid #f0f0f0;
  }
  .g-pays-list { flex: 1; overflow: auto; padding: 0.429rem 0.714rem; }
  .g-pays-list h4 { margin: 0.429rem 0; font-size: 0.82rem; color: #555; }
  .g-pay-item {
    display: flex;
    align-items: center;
    gap: 0.571rem;
    padding: 0.357rem 0.429rem;
    border-bottom: 1px solid #f5f5f5;
    font-size: 0.8rem;
  }
  .g-pay-date { font-family: monospace; font-size: 0.72rem; color: #888; min-width: 3.929rem; }
  .g-pay-concept { flex: 1; }
  .g-pay-amount { font-family: monospace; font-weight: 600; min-width: 4.286rem; text-align: right; }
  .g-empty { padding: 1.429rem; text-align: center; color: #bbb; font-size: 0.82rem; }
</style>
