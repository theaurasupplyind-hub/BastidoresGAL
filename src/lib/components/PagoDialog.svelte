<script lang="ts">
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import type { Provider, Employee } from '$lib/types';

  let {
    show = $bindable(false),
    invoiceId = 0,
    invoiceNumero = '',
    invoiceCliente = '',
    invoiceTotal = 0,
    initialAmount = 0,
    editing = false,
    pagoId = 0,
    initialDate = '',
    initialMethod = '',
    initialEntityType = '',
    initialEntityId = 0,
    onclose,
    onsaved,
    onDelete,
  }: {
    show: boolean;
    invoiceId: number;
    invoiceNumero: string;
    invoiceCliente: string;
    invoiceTotal: number;
    initialAmount?: number;
    editing?: boolean;
    pagoId?: number;
    initialDate?: string;
    initialMethod?: string;
    initialEntityType?: string;
    initialEntityId?: number;
    onclose?: () => void;
    onsaved?: () => void;
    onDelete?: () => void;
  } = $props();

  let loading = $state(false);
  let saving = $state(false);
  let pagoDate = $state('');
  let pagoAmount = $state(0);
  let pagoMethod = $state('Efectivo');
  let pagoBalance = $state(0);
  let providers = $state<Provider[]>([]);
  let employees = $state<Employee[]>([]);
  let pagoEntityType = $state<string>('PROVIDER');
  let pagoEntityId = $state<number | null>(null);

  const METHODS: readonly string[] = ['Efectivo', 'Transferencia'];
  const canSave = $derived(
    !!invoiceId && !!pagoDate && pagoAmount > 0 && !saving &&
    !(pagoMethod === 'Transferencia' && !pagoEntityId)
  );

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
      pagoBalance = (invoiceTotal || 0) - pagado + (editing ? initialAmount : 0);

      const [provs, emps] = await Promise.all([
        api.listProviders(),
        api.listEmployees(true),
      ]);
      providers = provs;
      employees = emps;
    } catch {
      pagoBalance = (invoiceTotal || 0) + (editing ? initialAmount : 0);
    } finally {
      loading = false;
    }
    pagoDate = initialDate || new Date().toISOString().slice(0, 10);
    pagoAmount = initialAmount > 0 ? initialAmount : Math.max(0, pagoBalance);
    pagoMethod = initialMethod || 'Efectivo';
    pagoEntityType = initialEntityType === 'EMPLOYEE' ? 'EMPLOYEE' : 'PROVIDER';
    pagoEntityId = initialEntityId > 0 ? initialEntityId : null;
  }

  $effect(() => {
    if (show && invoiceId) {
      loadData();
    }
  });

  function setEntityType(type: string) {
    pagoEntityType = type;
    pagoEntityId = null;
  }

  async function handleSave() {
    if (!invoiceId || !pagoDate || pagoAmount <= 0) return;
    if (pagoMethod === 'Transferencia' && !pagoEntityId) return;
    saving = true;
    try {
      const payload: Record<string, unknown> = {
        invoice_id: invoiceId,
        date: pagoDate,
        amount: pagoAmount,
        method: pagoMethod,
      };
      if (pagoMethod === 'Transferencia' && pagoEntityId) {
        payload.entity_type = pagoEntityType;
        payload.entity_id = pagoEntityId;
      }
      if (editing && pagoId) {
        await api.updatePago(pagoId, payload);
      } else {
        await api.addPago({ ...payload, user_id: appStore.user?.user_id || 0 });
      }
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
  <div class="modal-overlay" onkeydown={(e) => e.key === 'Escape' && close()} role="presentation" tabindex="-1">
    <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1">
      <div class="modal-header">
        <h3>{editing ? 'Editar Pago' : 'Nuevo Pago'}</h3>
        <button class="modal-close" onclick={close} aria-label="Cerrar">✕</button>
      </div>
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
          <div class="seg-group">
            {#each METHODS as m (m)}
              <button
                type="button"
                class:seg-active={pagoMethod === m}
                class="seg-btn"
                aria-pressed={pagoMethod === m}
                onclick={() => {
                  pagoMethod = m;
                  if (m === 'Transferencia') setEntityType(pagoEntityType);
                }}
              >
                {m}
              </button>
            {/each}
          </div>
        </div>
        {#if pagoMethod === 'Transferencia'}
          <div class="vincular-section">
            <label class="vincular-title">Destino de Fondos</label>
            <div class="form-group">
              <label>Vincular con</label>
              <div class="seg-group">
                <button
                  type="button"
                  class:seg-active={pagoEntityType === 'PROVIDER'}
                  class="seg-btn"
                  aria-pressed={pagoEntityType === 'PROVIDER'}
                  onclick={() => setEntityType('PROVIDER')}
                >
                  Proveedor
                </button>
                <button
                  type="button"
                  class:seg-active={pagoEntityType === 'EMPLOYEE'}
                  class="seg-btn"
                  aria-pressed={pagoEntityType === 'EMPLOYEE'}
                  onclick={() => setEntityType('EMPLOYEE')}
                >
                  Empleado
                </button>
              </div>
            </div>
            <div class="form-group">
              <label>Seleccionar</label>
              {#if pagoEntityType === 'PROVIDER'}
                {#if providers.length === 0}
                  <div class="empty-chips">Sin proveedores cargados</div>
                {:else}
                  <div class="chip-grid chip-grid-providers">
                    {#each providers as prov (prov.id)}
                      <button
                        type="button"
                        class:chip-active={pagoEntityId === prov.id}
                        class="chip-btn"
                        aria-pressed={pagoEntityId === prov.id}
                        data-tooltip={prov.name}
                        onclick={() => (pagoEntityId = prov.id)}
                      >
                        {prov.name}
                      </button>
                    {/each}
                  </div>
                {/if}
              {:else}
                {#if employees.filter((e) => e.active).length === 0}
                  <div class="empty-chips">Sin empleados activos</div>
                {:else}
                  <div class="chip-grid">
                    {#each employees.filter((e) => e.active) as emp (emp.id)}
                      <button
                        type="button"
                        class:chip-active={pagoEntityId === emp.id}
                        class="chip-btn"
                        aria-pressed={pagoEntityId === emp.id}
                        title={emp.name}
                        onclick={() => (pagoEntityId = emp.id)}
                      >
                        {emp.name}
                      </button>
                    {/each}
                  </div>
                {/if}
              {/if}
            </div>
          </div>
        {/if}
      </div>
      <div class="modal-footer">
        {#if editing}
          <button class="btn btn-danger" onclick={onDelete}>🗑 Eliminar Pago</button>
        {/if}
        <button class="btn btn-secondary" onclick={close}>Cancelar</button>
        <button class="btn btn-primary" onclick={handleSave} disabled={!canSave}>
          {saving ? 'Guardando...' : editing ? 'Guardar Cambios' : 'Registrar Pago'}
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
    background: var(--bg-card);
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
  .modal-header { display: flex; justify-content: space-between; align-items: center; }
  .modal-header h3 { margin: 0; font-size: 1.1rem; color: var(--text-primary); }
  .modal-close { background: none; border: none; font-size: 1.143rem; cursor: pointer; color: var(--text-muted); padding: 0.286rem; border-radius: 0.286rem; }
  .modal-close:hover { background: var(--bg-hover); color: var(--text-primary); }
  .modal-body { display: flex; flex-direction: column; gap: 0.714rem; }
  .pago-dialog-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.571rem 0.714rem;
    background: var(--accent-light);
    border-radius: 0.429rem;
    font-size: 0.85rem;
  }
  .pago-dialog-cliente { font-weight: 700; color: var(--text-primary); }
  .pago-dialog-balance { font-weight: 600; color: #198754; }
  .form-group { display: flex; flex-direction: column; gap: 0.286rem; }
  .form-group label { font-size: 0.78rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.03em; }
  .form-group input {
    padding: 0.5rem 0.643rem;
    border: 0.071rem solid var(--border);
    border-radius: 0.357rem;
    font-size: 0.92rem;
    outline: none;
  }
  .form-group input:focus { border-color: #3498db; }
  .input-readonly { background: var(--bg-page); color: var(--text-muted); }

  .seg-group {
    display: flex;
    gap: 0.286rem;
    background: var(--bg-page);
    padding: 0.214rem;
    border-radius: 0.429rem;
  }
  .seg-btn {
    flex: 1;
    padding: 0.429rem 0.857rem;
    border: none;
    border-radius: 0.357rem;
    background: transparent;
    color: var(--text-secondary);
    font-size: 0.88rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .seg-btn:hover { color: var(--text-primary); }
  .seg-active {
    background: var(--accent);
    color: #fff;
    box-shadow: 0 0.143rem 0.429rem rgba(52,152,219,0.3);
  }
  .seg-active:hover { color: #fff; }

  .vincular-section {
    border: 0.071rem solid var(--border);
    border-radius: 0.571rem;
    padding: 0.857rem;
    display: flex;
    flex-direction: column;
    gap: 0.571rem;
    background: var(--bg-page);
  }
  .vincular-title { font-size: 0.82rem; font-weight: 700; color: var(--text-secondary); }

  .chip-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.286rem;
    max-height: 9.5rem;
    max-width: 18rem;
    overflow-y: auto;
    padding: 0.143rem;
  }
  .chip-btn {
    padding: 0.286rem 0.571rem;
    border: 0.071rem solid var(--border);
    border-radius: 0.857rem;
    background: var(--bg-card);
    color: var(--text-secondary);
    font-size: 0.75rem;
    cursor: pointer;
    white-space: nowrap;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: all 0.12s;
  }
  .chip-btn:hover { border-color: var(--accent); color: var(--accent); }
  .chip-active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-weight: 600;
  }
  .chip-active:hover { color: #fff; }
  .empty-chips { font-size: 0.85rem; color: var(--text-muted); padding: 0.286rem 0; }

  .chip-grid-providers {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.286rem;
  }
  .chip-grid-providers .chip-btn {
    width: 100%;
    min-width: 0;
  }

  .chip-btn { position: relative; }

  .chip-btn[data-tooltip]::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: calc(100% + 0.357rem);
    left: 50%;
    transform: translateX(-50%);
    background: var(--text-primary);
    color: var(--bg-card);
    padding: 0.286rem 0.571rem;
    border-radius: 0.286rem;
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.12s;
    z-index: 30;
  }
  .chip-btn[data-tooltip]:hover::after,
  .chip-btn[data-tooltip]:focus-visible::after {
    opacity: 1;
    visibility: visible;
  }

  .modal-footer { display: flex; justify-content: flex-end; gap: 0.571rem; padding-top: 0.714rem; border-top: 0.071rem solid var(--border-light); }
</style>
