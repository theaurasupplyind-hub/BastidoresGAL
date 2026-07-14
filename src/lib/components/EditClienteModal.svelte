<script lang="ts">
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import type { Cliente, ClientAddress } from '$lib/types';

  let { show, cliente, onclose, onsaved }: {
    show: boolean;
    cliente: Cliente | null;
    onclose: () => void;
    onsaved?: () => void;
  } = $props();

  let form = $state({ nombre: '', domicilio: '', telefono: '', taller: '' });
  let addresses = $state<ClientAddress[]>([]);
  let loaded = $state(false);
  let saving = $state(false);
  let geocodificandoId = $state<number | null>(null);
  let geocodificandoAddrId = $state<number | null>(null);

  let showAddrForm = $state(false);
  let editingAddr = $state<ClientAddress | null>(null);
  let addrForm = $state({ address: '', extra: '', label: '', is_default: false });
  let savingAddr = $state(false);

  let isNew = $derived(!cliente);

  $effect(() => {
    if (show && cliente) {
      form = {
        nombre: cliente.nombre,
        domicilio: cliente.domicilio,
        telefono: cliente.telefono || '',
        taller: cliente.taller || '',
      };
      loaded = false;
      api.listAddresses(cliente.id).then(addrs => {
        addresses = addrs;
        loaded = true;
      });
    } else if (show && !cliente) {
      form = { nombre: '', domicilio: '', telefono: '', taller: '' };
      addresses = [];
      loaded = true;
    }
  });

  async function saveCliente() {
    if (!form.nombre.trim()) return;
    saving = true;
    try {
      if (cliente) {
        await api.updateCliente(cliente.id, form);
        appStore.showToast('Cliente actualizado');
      } else {
        await api.addCliente(form);
        appStore.showToast('Cliente creado');
      }
      onsaved?.();
      onclose();
    } catch (e: any) {
      appStore.showToast('Error: ' + (e.message || e), 'error');
    } finally {
      saving = false;
    }
  }

  async function geocodificarCliente() {
    if (!cliente || !form.domicilio.trim()) return;
    geocodificandoId = cliente.id;
    try {
      const res = await api.geocodificarCliente(cliente.id);
      if (res?.lat && res?.lng) {
        appStore.showToast('Ubicación geocodificada', 'success');
        onsaved?.();
      }
    } catch (e: any) {
      appStore.showToast('Error: ' + (e.message || e), 'error');
    } finally {
      geocodificandoId = null;
    }
  }

  async function geocodificarAddress(addr: ClientAddress) {
    if (!cliente) return;
    geocodificandoAddrId = addr.id;
    try {
      const res = await api.geocodificarAddress(cliente.id, addr.id);
      if (res?.lat && res?.lng) {
        addr.lat = res.lat;
        addr.lng = res.lng;
        appStore.showToast('Dirección geocodificada', 'success');
        onsaved?.();
      }
    } catch (e: any) {
      appStore.showToast('Error: ' + (e.message || e), 'error');
    } finally {
      geocodificandoAddrId = null;
    }
  }

  function openAddAddress() {
    editingAddr = null;
    addrForm = { address: '', extra: '', label: '', is_default: false };
    showAddrForm = true;
  }

  function openEditAddress(a: ClientAddress) {
    editingAddr = a;
    addrForm = { address: a.address, extra: a.extra, label: a.label, is_default: a.is_default };
    showAddrForm = true;
  }

  async function saveAddress() {
    if (!cliente || !addrForm.address.trim()) return;
    savingAddr = true;
    try {
      if (editingAddr) {
        await api.updateAddress(cliente.id, editingAddr.id, addrForm);
      } else {
        await api.addAddress(cliente.id, addrForm);
      }
      addresses = await api.listAddresses(cliente.id);
      showAddrForm = false;
      editingAddr = null;
    } catch (e: any) {
      appStore.showToast('Error: ' + (e.message || e), 'error');
    } finally {
      savingAddr = false;
    }
  }

  async function deleteAddress(a: ClientAddress) {
    if (!cliente) return;
    if (!globalThis.confirm(`¿Eliminar "${a.address}"?`)) return;
    try {
      await api.deleteAddress(cliente.id, a.id);
      addresses = await api.listAddresses(cliente.id);
    } catch (e: any) {
      appStore.showToast('Error', 'error');
    }
  }

  async function setDefaultAddress(a: ClientAddress) {
    if (!cliente || a.is_default) return;
    try {
      await api.setDefaultAddress(cliente.id, a.id);
      addresses = await api.listAddresses(cliente.id);
    } catch (e: any) {
      appStore.showToast('Error', 'error');
    }
  }
</script>

{#if show}
  <div class="modal-overlay" onclick={onclose} role="presentation">
    <div class="modal modal-cliente" onclick={(e) => e.stopPropagation()} role="dialog">
      <h3>{isNew ? 'Nuevo Cliente' : 'Editar Cliente'}</h3>
      <form onsubmit={(e) => { e.preventDefault(); saveCliente(); }}>
        <label class="emlbl" for="em-nombre">Nombre *</label>
        <input id="em-nombre" type="text" bind:value={form.nombre} required />
        <label class="emlbl" for="em-tel">Teléfono</label>
        <input id="em-tel" type="text" bind:value={form.telefono} />
        <label class="emlbl" for="em-dom">Domicilio</label>
        <input id="em-dom" type="text" bind:value={form.domicilio} />
        <label class="emlbl" for="em-tal">Taller</label>
        <input id="em-tal" type="text" bind:value={form.taller} />

        <div class="modal-actions em-actions">
          {#if !isNew && form.domicilio}
            <button type="button" class="btn-geo-modal" onclick={geocodificarCliente} disabled={geocodificandoId === cliente!.id}>
              {geocodificandoId === cliente!.id ? '⏳ Geocodificando...' : '📍 Geocodificar ubicación'}
            </button>
          {/if}
          <button type="submit" class="btn-primary" disabled={saving}>{saving ? 'Guardando...' : isNew ? 'Crear' : 'Guardar'}</button>
          <button type="button" class="btn-secondary" onclick={onclose}>Cancelar</button>
        </div>
      </form>

      {#if !isNew}
        <hr class="em-divider" />
        <h4 class="em-addr-title">Direcciones guardadas</h4>
        {#if !loaded}
          <p class="em-loading">Cargando...</p>
        {:else if addresses.length === 0}
          <p class="em-empty">Sin direcciones guardadas.</p>
        {:else}
          {#each addresses as a (a.id)}
            <div class="address-row">
              <span class="address-col">
                <span class="address-text">
                  {a.label ? `${a.label}: ` : ''}{a.address}{a.extra ? ` - ${a.extra}` : ''}
                </span>
                {#if a.is_default}<span class="default-badge">Default</span>{/if}
              </span>
              <span class="address-btns">
                <button class="btn-sm-addr btn-geo-addr" onclick={() => geocodificarAddress(a)} title="Geocodificar" disabled={geocodificandoAddrId === a.id}>
                  {geocodificandoAddrId === a.id ? '⏳' : '📍'}
                </button>
                {#if !a.is_default}
                  <button class="btn-sm-addr" onclick={() => setDefaultAddress(a)} title="Establecer como default">⭐</button>
                {/if}
                <button class="btn-sm-addr" onclick={() => openEditAddress(a)} title="Editar">✏️</button>
                <button class="btn-sm-addr btn-danger-addr" onclick={() => deleteAddress(a)} title="Eliminar">🗑️</button>
              </span>
            </div>
          {/each}
        {/if}
        <button class="btn-add-address" onclick={openAddAddress}>+ Agregar dirección</button>
      {/if}
    </div>
  </div>
{/if}

{#if showAddrForm}
  <div class="modal-overlay" onclick={() => showAddrForm = false} role="presentation">
    <div class="modal em-addr-modal" onclick={(e) => e.stopPropagation()} role="dialog">
      <h3>{editingAddr ? 'Editar dirección' : 'Nueva dirección'}</h3>
      <form onsubmit={(e) => { e.preventDefault(); saveAddress(); }}>
        <label class="emlbl" for="em-addr">Dirección *</label>
        <input id="em-addr" type="text" bind:value={addrForm.address} required />
        <label class="emlbl" for="em-extra">Piso / Depto</label>
        <input id="em-extra" type="text" bind:value={addrForm.extra} />
        <label class="emlbl" for="em-label">Etiqueta</label>
        <input id="em-label" type="text" bind:value={addrForm.label} placeholder="Ej: Casa, Trabajo, Taller..." />
        <label class="emlbl emlbl-cb" for="em-def">
          <input id="em-def" type="checkbox" bind:checked={addrForm.is_default} />
          Dirección predeterminada
        </label>
        <div class="modal-actions em-actions">
          <button type="submit" class="btn-primary" disabled={savingAddr}>{savingAddr ? 'Guardando...' : 'Guardar'}</button>
          <button type="button" class="btn-secondary" onclick={() => showAddrForm = false}>Cancelar</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  input[type="text"] {
    width: 100%;
    padding: 0.5rem 0.714rem;
    border: 1.5px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.929rem;
    background: var(--bg-card);
    color: var(--text-primary);
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  input[type="text"]:focus {
    border-color: var(--border-focus);
    box-shadow: 0 0 0 0.214rem rgba(37,99,235,0.12);
  }
  input[type="checkbox"] {
    width: auto;
    cursor: pointer;
  }
  .emlbl { display: block; font-size: 0.929rem; color: var(--text-secondary); margin: 0.571rem 0 0.286rem; }
  .emlbl-cb { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.5rem; cursor: pointer; }
  .em-actions { display: flex; gap: 0.571rem; justify-content: flex-end; margin-top: 1.143rem; }
  .em-divider { margin: 1rem 0; border-color: var(--border-light); }
  .em-addr-title { margin: 0 0 0.5rem; font-size: 0.95rem; color: var(--text-primary); }
  .em-loading, .em-empty { font-size: 0.85rem; color: var(--text-muted); }
  .em-addr-modal { width: 28rem; max-width: 95vw; }

  .btn-geo-modal {
    padding: 0.571rem 1rem; background: #22c55e; color: white; border: none;
    border-radius: 0.429rem; cursor: pointer; font-size: 0.857rem; font-weight: 500;
    margin-right: auto;
  }
  .btn-geo-modal:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn-geo-modal:hover:not(:disabled) { background: #16a34a; }
  .btn-primary {
    padding: 0.571rem 1.286rem; background: var(--accent); color: white; border: none;
    border-radius: 0.429rem; cursor: pointer; font-size: 0.929rem; font-weight: 500;
  }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary {
    padding: 0.571rem 1.286rem; background: var(--bg-hover); color: var(--text-secondary); border: none;
    border-radius: 0.429rem; cursor: pointer; font-size: 0.929rem;
  }

  .address-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 0.429rem 0.571rem; border: 1px solid var(--border-light); border-radius: 0.429rem;
    margin-bottom: 0.286rem; font-size: 0.857rem; gap: 0.4rem;
  }
  .address-col { flex: 1; min-width: 0; display: flex; align-items: center; gap: 0.3rem; }
  .address-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); }
  .default-badge {
    display: inline-block; padding: 0.071rem 0.357rem; background: var(--accent); color: white;
    border-radius: 0.286rem; font-size: 0.7rem; font-weight: 700; flex-shrink: 0;
  }
  .address-btns { display: flex; gap: 0.214rem; flex-shrink: 0; }
  .btn-sm-addr {
    padding: 0.143rem 0.286rem; border: none; background: none; cursor: pointer;
    font-size: 0.857rem; border-radius: 0.214rem; line-height: 1;
  }
  .btn-sm-addr:hover { background: var(--bg-hover); }
  .btn-danger-addr:hover { background: #fde8e8; }
  .btn-geo-addr { color: #22c55e; font-size: 0.9rem; }
  .btn-geo-addr:hover { background: #e8f5e9; }
  .btn-geo-addr:disabled { opacity: 0.4; cursor: not-allowed; }

  .btn-add-address {
    margin-top: 0.5rem; padding: 0.357rem 0.857rem; border: 1px dashed var(--border);
    border-radius: 0.429rem; background: transparent; color: var(--accent); font-size: 0.857rem;
    cursor: pointer; width: 100%; text-align: center; transition: all 0.12s;
  }
  .btn-add-address:hover { background: var(--accent-light); border-color: var(--accent); }
</style>
