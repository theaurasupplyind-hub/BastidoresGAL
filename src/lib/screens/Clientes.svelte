<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import type { Cliente } from '$lib/types';
  import EditClienteModal from '$lib/components/EditClienteModal.svelte';

  let clientes = $state<Cliente[]>([]);
  let search = $state('');
  let loading = $state(true);
  let showModal = $state(false);
  let selectedCliente = $state<Cliente | null>(null);

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
    selectedCliente = null;
    showModal = true;
  }

  function openEdit(c: Cliente) {
    selectedCliente = c;
    showModal = true;
  }

  function onClienteSaved() {
    showModal = false;
    selectedCliente = null;
    refresh();
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

<EditClienteModal
  show={showModal}
  cliente={selectedCliente}
  onclose={() => { showModal = false; selectedCliente = null; }}
  onsaved={onClienteSaved}
/>

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
</style>
