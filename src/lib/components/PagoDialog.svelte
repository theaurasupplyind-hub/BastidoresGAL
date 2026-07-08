<script lang="ts">
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import type { Provider, Employee } from '$lib/types';

  let { show = $bindable(false), invoiceId = 0, invoiceNumero = '', invoiceCliente = '', invoiceTotal = 0, initialAmount = 0, onclose, onsaved }:
    { show: boolean; invoiceId: number; invoiceNumero: string; invoiceCliente: string; invoiceTotal: number; initialAmount?: number; onclose?: () => void; onsaved?: () => void; }
    = $props();

  let loading = $state(false);
  let saving = $state(false);
  let pagoDate = $state('');
  let pagoAmount = $state(0);
  let pagoMethod = $state('Efectivo');
  let pagoBalance = $state(0);
  let providers = $state<Provider[]>([]);
  let employees = $state<Employee[]>([]);
  let pagoEntityType = $state('Ninguno');
  let pagoEntityId = $state<number | null>(null);

  function formatCurrency(n: number): string {
    return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function close() {
    show = false;
    onclose?.();
  }

  async function loadData() {
    if (!invoiceId) return;
    loading = true;
    try {
      const allPagos = await api.listPagos();
      const invPagos = allPagos.filter((p: any) => p.invoice_id === invoiceId);
      const pagado = invPagos.reduce((s: number, p: any) => s + (p.amount || 0), 0);
      pagoBalance = (invoiceTotal || 0) - pagado;
      pagoAmount = initialAmount > 0 ? initialAmount : Math.max(0, pagoBalance);

      const [provs, emps] = await Promise.all([
        api.listProviders(),
        api.listEmployees(true),
      ]);
      providers = provs;
      employees = emps;
    } catch {
      pagoBalance = invoiceTotal || 0;
      pagoAmount = initialAmount > 0 ? initialAmount : pagoBalance;
    } finally {
      loading = false;
    }
    pagoDate = new Date().toISOString().slice(0, 10);
    pagoMethod = 'Efectivo';
    pagoEntityType = 'Ninguno';
    pagoEntityId = null;
  }

  $effect(() => {
    if (show && invoiceId) {
      loadData();
    }
  });

  async function handleSave() {
    if (!invoiceId || !pagoDate || pagoAmount <= 0) return;
    saving = true;
    try {
      const payload: Record<string, unknown> = {
        invoice_id: invoiceId,
        date: pagoDate,
        amount: pagoAmount,
        method: pagoMethod,
        user_id: appStore.user?.user_id || 0,
      };
      if (pagoMethod === 'Transferencia' && pagoEntityType !== 'Ninguno' && pagoEntityId) {
        payload.entity_type = pagoEntityType;
        payload.entity_id = pagoEntityId;
      }
      await api.addPago(payload);
      cacheStore.invalidate('pagos');
      cacheStore.invalidate('facturas');
      close();
      onsaved?.();
    } catch (e: any) {
      appStore.alert('Error al registrar pago: ' + (e?.message || e));
    } finally {
      saving = false;
    }
  }
</script>

{#if show && invoiceId}
  <div class="modal-overlay" onclick={close} onkeydown={(e) => e.key === 'Escape' && close()} role="presentation" tabindex="-1">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
      <h3>Nuevo Pago</h3>
      <div class="modal-body">
        {#if invoiceCliente}
          <div class="pago-dialog-header">
            <span class="pago-dialog-cliente">{invoiceCliente}</span>
            <span class="pago-dialog-balance">Saldo: {formatCurrency(pagoBalance)}</span>
          </div>
        {/if}
        <div class="form-group">
          <label>Factura / Presupuesto</label>
          <input type="text" value={invoiceNumero} disabled class="input-readonly" />
        </div>
        <div class="form-group">
          <label>Fecha</label>
          <input type="date" bind:value={pagoDate} />
        </div>
        <div class="form-group">
          <label>Monto</label>
          <input type="number" bind:value={pagoAmount} step="0.01" min="0" />
        </div>
        <div class="form-group">
          <label>Método</label>
          <select bind:value={pagoMethod}>
            <option value="Efectivo">Efectivo</option>
            <option value="Transferencia">Transferencia</option>
            <option value="Cheque">Cheque</option>
          </select>
        </div>
        {#if pagoMethod === 'Transferencia'}
          <div class="vincular-section">
            <label class="vincular-title">Destino de Fondos</label>
            <div class="form-group">
              <label>Vincular con</label>
              <select bind:value={pagoEntityType}>
                <option value="Ninguno">Ninguno</option>
                <option value="PROVIDER">Proveedor</option>
                <option value="EMPLOYEE">Empleado</option>
              </select>
            </div>
            {#if pagoEntityType !== 'Ninguno'}
              <div class="form-group">
                <label>Seleccionar</label>
                <select
                  value={pagoEntityId ?? ''}
                  onchange={(e) => {
                    const val = parseInt((e.target as HTMLSelectElement).value);
                    pagoEntityId = isNaN(val) ? null : val;
                  }}
                >
                  <option value="">Seleccione...</option>
                  {#if pagoEntityType === 'PROVIDER'}
                    {#each providers as prov (prov.id)}
                      <option value={prov.id}>{prov.name}</option>
                    {/each}
                  {:else if pagoEntityType === 'EMPLOYEE'}
                    {#each employees as emp (emp.id)}
                      <option value={emp.id}>{emp.name}</option>
                    {/each}
                  {/if}
                </select>
              </div>
            {/if}
          </div>
        {/if}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={close}>Cancelar</button>
        <button class="btn btn-primary" onclick={handleSave} disabled={!invoiceId || !pagoDate || pagoAmount <= 0 || saving}>
          {saving ? 'Guardando...' : 'Registrar Pago'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.35);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: white;
    border-radius: 0.857rem;
    padding: 1.429rem;
    min-width: 22.857rem;
    max-width: 90vw;
    max-height: 85vh;
    overflow-y: auto;
    box-shadow: 0 0.571rem 2.143rem rgba(0,0,0,0.15);
    display: flex;
    flex-direction: column;
    gap: 0.714rem;
  }
  .modal h3 { margin: 0; font-size: 1.1rem; color: #2c3e50; }
  .modal-body { display: flex; flex-direction: column; gap: 0.714rem; }
  .pago-dialog-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.571rem 0.714rem;
    background: #f0f4ff;
    border-radius: 0.429rem;
    font-size: 0.85rem;
  }
  .pago-dialog-cliente { font-weight: 700; color: #2c3e50; }
  .pago-dialog-balance { font-weight: 600; color: #198754; }
  .form-group { display: flex; flex-direction: column; gap: 0.286rem; }
  .form-group label { font-size: 0.78rem; font-weight: 600; color: #6c757d; text-transform: uppercase; letter-spacing: 0.03em; }
  .form-group input, .form-group select {
    padding: 0.5rem 0.643rem;
    border: 0.071rem solid #ddd;
    border-radius: 0.357rem;
    font-size: 0.92rem;
    outline: none;
  }
  .form-group input:focus, .form-group select:focus { border-color: #3498db; }
  .input-readonly { background: #f8f9fa; color: #6c757d; }
  .vincular-section {
    border: 0.071rem solid #e0e0e0;
    border-radius: 0.571rem;
    padding: 0.857rem;
    display: flex;
    flex-direction: column;
    gap: 0.571rem;
    background: #fafafa;
  }
  .vincular-title { font-size: 0.82rem; font-weight: 700; color: #495057; }
  .modal-footer { display: flex; justify-content: flex-end; gap: 0.571rem; padding-top: 0.714rem; border-top: 0.071rem solid #e9ecef; }
</style>
