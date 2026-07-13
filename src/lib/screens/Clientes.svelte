<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import type { Cliente } from '$lib/types';

  let clientes = $state<Cliente[]>([]);
  let search = $state('');
  let loading = $state(true);
  let showForm = $state(false);
  let editing = $state<Cliente | null>(null);
  let geocodificandoId = $state<number | null>(null);

  let form = $state({ nombre: '', domicilio: '', telefono: '', taller: '', estudiante: '' });

  onMount(() => { refresh(); });

  async function refresh() {
    loading = true;
    try {
      cacheStore.invalidate('clientes');
      clientes = await api.listClientes();
    } catch (e) {
      appStore.showToast('Error al cargar clientes', 'error');
    } finally {
      loading = false;
    }
  }

  const filtered = $derived(
    search
      ? clientes.filter(c =>
          c.nombre.toLowerCase().includes(search.toLowerCase()) ||
          c.telefono.includes(search) ||
          c.domicilio.toLowerCase().includes(search.toLowerCase())
        )
      : clientes
  );

  function openNew() {
    editing = null;
    form = { nombre: '', domicilio: '', telefono: '', taller: '', estudiante: '' };
    showForm = true;
  }

  function openEdit(c: Cliente) {
    editing = c;
    form = {
      nombre: c.nombre,
      domicilio: c.domicilio,
      telefono: c.telefono,
      taller: c.taller || '',
      estudiante: c.estudiante || '',
    };
    showForm = true;
  }

  async function save() {
    if (!form.nombre.trim()) return;
    try {
      if (editing) {
        await api.updateCliente(editing.id, form);
        appStore.showToast('Cliente actualizado');
      } else {
        await api.addCliente(form);
        appStore.showToast('Cliente creado');
      }
      showForm = false;
      await refresh();
    } catch (e) {
      appStore.showToast(String(e), 'error');
    }
  }

  async function remove(c: Cliente) {
    if (!confirm(`¿Eliminar a "${c.nombre}"?`)) return;
    try {
      await api.deleteCliente(c.id);
      appStore.showToast('Cliente eliminado');
      await refresh();
    } catch (e) {
      appStore.showToast(String(e), 'error');
    }
  }

  async function geocodificar(c: Cliente) {
    if (!c.domicilio) return;
    geocodificandoId = c.id;
    try {
      const res = await api.geocodificarCliente(c.id);
      c.lat = res.lat;
      c.lng = res.lng;
      appStore.showToast(`${c.nombre} geocodificado OK`);
    } catch (e) {
      appStore.showToast(String(e), 'error');
    } finally {
      geocodificandoId = null;
    }
  }
</script>

<div class="screen">
  <div class="screen-header">
    <h2>Clientes</h2>
    <button class="btn-primary" onclick={openNew}>+ Nuevo Cliente</button>
  </div>

  <div class="search-bar">
    <input type="text" placeholder="Buscar por nombre, teléfono o domicilio..." bind:value={search} />
  </div>

  {#if loading}
    <p class="loading">Cargando...</p>
  {:else if filtered.length === 0}
    <div class="empty">
      {#if search}
        Sin resultados para "{search}"
      {:else}
        No hay clientes registrados
      {/if}
    </div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Teléfono</th>
            <th>Domicilio</th>
            <th>Taller</th>
            <th>Estudiante/Galería</th>
            <th>Ubicación</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as c (c.id)}
            <tr>
              <td>{c.nombre}</td>
              <td>{c.telefono}</td>
              <td>{c.domicilio}</td>
              <td>{c.taller}</td>
              <td>{c.estudiante}</td>
              <td>
                <button
                  class="btn-sm btn-geo"
                  onclick={() => geocodificar(c)}
                  disabled={geocodificandoId === c.id || !c.domicilio}
                  title={c.lat && c.lng ? 'Re-geocodificar' : 'Geocodificar ubicación'}
                >
                  {geocodificandoId === c.id ? '⏳' : c.lat && c.lng ? '✅' : '📍'}
                </button>
              </td>
              <td>
                <button class="btn-sm" onclick={() => openEdit(c)}>✏️</button>
                <button class="btn-sm btn-danger" onclick={() => remove(c)}>🗑️</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<!-- Modal Form -->
{#if showForm}
  <div class="overlay" onclick={() => showForm = false}>
    <div class="modal" onclick={(e) => e.stopPropagation()}>
      <h3>{editing ? 'Editar Cliente' : 'Nuevo Cliente'}</h3>
      <form onsubmit={(e) => { e.preventDefault(); save(); }}>
        <label>Nombre *</label>
        <input type="text" bind:value={form.nombre} required />
        <label>Teléfono</label>
        <input type="text" bind:value={form.telefono} />
        <label>Domicilio</label>
        <input type="text" bind:value={form.domicilio} />
        <label>Taller</label>
        <input type="text" bind:value={form.taller} />
        <label>Estudiante / Galería</label>
        <input type="text" bind:value={form.estudiante} />
        <div class="modal-actions">
          {#if editing && editing.domicilio}
            <button
              type="button"
              class="btn-geo-modal"
              onclick={() => { const e = editing!; geocodificar(e); }}
              disabled={geocodificandoId === editing!.id}
            >
              {geocodificandoId === editing!.id ? '⏳ Geocodificando...' : '📍 Geocodificar ubicación'}
            </button>
          {/if}
          <button type="submit" class="btn-primary">{editing ? 'Guardar' : 'Crear'}</button>
          <button type="button" class="btn-secondary" onclick={() => showForm = false}>Cancelar</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .screen { padding: 1.429rem; }
  .screen-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.143rem; }
  .screen-header h2 { margin: 0; font-size: 1.429rem; color: var(--text-primary); }
  .search-bar { margin-bottom: 0.857rem; }
  .search-bar input {
    width: 100%; padding: 0.714rem 1rem; border: 1px solid var(--border); border-radius: 0.571rem;
    font-size: 1rem; box-sizing: border-box;
  }
  .table-wrap { overflow-x: auto; }
  table {
    width: 100%; border-collapse: collapse; background: var(--bg-card); border-radius: 0.571rem;
    overflow: hidden; box-shadow: 0 0.071rem 0.286rem rgba(0,0,0,0.08);
  }
  th, td { padding: 0.714rem 1rem; text-align: left; font-size: 0.929rem; border-bottom: 1px solid var(--border-light); }
  th { background: var(--bg-page); font-weight: 600; color: var(--text-secondary); }
  tr:hover { background: var(--bg-hover); }
  .loading, .empty { text-align: center; color: var(--text-muted); }
  .btn-primary {
    padding: 0.571rem 1.286rem; background: var(--accent); color: white; border: none;
    border-radius: 0.429rem; cursor: pointer; font-size: 0.929rem; font-weight: 500;
  }
  .btn-sm {
    padding: 0.286rem 0.571rem; border: none; background: none; cursor: pointer; font-size: 1.071rem;
    border-radius: 0.286rem;
  }
  .btn-sm:hover { background: var(--bg-hover); }
  .btn-danger:hover { background: #fde8e8; }
  .btn-geo { font-size: 1rem; padding: 0.286rem 0.4rem; }
  .btn-geo:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-geo-modal {
    padding: 0.571rem 1rem; background: var(--success); color: white; border: none;
    border-radius: 0.429rem; cursor: pointer; font-size: 0.857rem; font-weight: 500;
    margin-right: auto;
  }
  .btn-geo-modal:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn-geo-modal:hover:not(:disabled) { background: var(--accent-hover); }
  .overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.4);
    display: flex; align-items: center; justify-content: center; z-index: 1000;
  }
  .modal {
    background: var(--bg-card); border-radius: 0.857rem; padding: 1.714rem; width: 28.571rem;
    box-shadow: 0 0.571rem 2.286rem rgba(0,0,0,0.2);
  }
  .modal h3 { margin: 0 0 1.143rem; }
  .modal label { display: block; font-size: 0.929rem; color: var(--text-secondary); margin: 0.571rem 0 0.286rem; }
  .modal input {
    width: 100%; padding: 0.571rem 0.714rem; border: 1px solid var(--border); border-radius: 0.429rem;
    font-size: 0.929rem; box-sizing: border-box;
  }
  .modal-actions { display: flex; gap: 0.571rem; justify-content: flex-end; margin-top: 1.143rem; }
  .btn-secondary {
    padding: 0.571rem 1.286rem; background: var(--bg-hover); color: var(--text-secondary); border: none;
    border-radius: 0.429rem; cursor: pointer; font-size: 0.929rem;
  }
</style>
