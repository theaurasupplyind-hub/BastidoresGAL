<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import type { Producto } from '$lib/types';

  let productos = $state<Producto[]>([]);
  let search = $state('');
  let loading = $state(true);
  let showForm = $state(false);
  let editing = $state<Producto | null>(null);

  let form = $state({ descripcion: '', precio_unitario: 0, categoria: 'Varios', medida: '', variante: '', stock: 0 });

  onMount(() => { refresh(); });

  async function refresh() {
    loading = true;
    try {
      cacheStore.invalidate('productos');
      productos = await api.listProductos();
    } catch (e) {
      appStore.showToast('Error al cargar productos', 'error');
    } finally {
      loading = false;
    }
  }

  const filtered = $derived(
    search
      ? productos.filter(p =>
          p.descripcion.toLowerCase().includes(search.toLowerCase()) ||
          p.categoria.toLowerCase().includes(search.toLowerCase()) ||
          p.medida.toLowerCase().includes(search.toLowerCase())
        )
      : productos
  );

  const totalStock = $derived(filtered.reduce((sum, p) => sum + (p.stock || 0), 0));

  function openNew() {
    editing = null;
    form = { descripcion: '', precio_unitario: 0, categoria: 'Varios', medida: '', variante: '', stock: 0 };
    showForm = true;
  }

  function openEdit(p: Producto) {
    editing = p;
    form = {
      descripcion: p.descripcion,
      precio_unitario: p.precio_unitario,
      categoria: p.categoria,
      medida: p.medida || '',
      variante: p.variante || '',
      stock: p.stock || 0,
    };
    showForm = true;
  }

  async function save() {
    if (!form.descripcion.trim()) return;
    try {
      if (editing) {
        await api.updateProducto(editing.id, {
          id: editing.id,
          descripcion: form.descripcion,
          precio_unitario: form.precio_unitario,
          categoria: form.categoria,
          medida: form.medida,
          variante: form.variante,
          stock: form.stock,
        });
        appStore.showToast('Producto actualizado');
      } else {
        const pid = `MAN_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}`;
        await api.addProducto({
          id: pid,
          descripcion: form.descripcion,
          precio_unitario: form.precio_unitario,
          categoria: form.categoria,
          medida: form.medida,
          variante: form.variante,
          stock: form.stock,
        });
        appStore.showToast('Producto creado');
      }
      showForm = false;
      await refresh();
    } catch (e) {
      appStore.showToast(String(e), 'error');
    }
  }

  async function remove(p: Producto) {
    if (!confirm(`¿Eliminar "${p.descripcion}"?`)) return;
    try {
      await api.deleteProducto(p.id);
      appStore.showToast('Producto eliminado');
      await refresh();
    } catch (e) {
      appStore.showToast(String(e), 'error');
    }
  }
</script>

<div class="screen">
  <div class="screen-header">
    <h2>Productos</h2>
    <div class="header-actions">
      <span class="stock-total">Stock total: {totalStock}</span>
      <button class="btn-secondary" onclick={() => appStore.showPreciosRef = true}>$ Precios Ref</button>
      <button class="btn-primary" onclick={openNew}>+ Nuevo Producto</button>
    </div>
  </div>

  <div class="search-bar">
    <input type="text" placeholder="Buscar por descripción, categoría o medida..." bind:value={search} />
  </div>

  {#if loading}
    <p class="loading">Cargando...</p>
  {:else if filtered.length === 0}
    <div class="empty">
      {#if search}
        Sin resultados para "{search}"
      {:else}
        No hay productos registrados
      {/if}
    </div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Categoría</th>
            <th>Medida</th>
            <th>Variante</th>
            <th>Descripción</th>
            <th>Precio</th>
            <th>Stock</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>
          {#each filtered as p (p.id)}
            <tr>
              <td>{p.categoria}</td>
              <td>{p.medida}</td>
              <td>{p.variante}</td>
              <td>{p.descripcion}</td>
              <td>${p.precio_unitario?.toLocaleString()}</td>
              <td>{p.stock ?? 0}</td>
              <td>
                <button class="btn-sm" onclick={() => openEdit(p)}>✏️</button>
                <button class="btn-sm btn-danger" onclick={() => remove(p)}>🗑️</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if showForm}
  <div class="overlay" onclick={() => showForm = false}>
    <div class="modal" onclick={(e) => e.stopPropagation()}>
      <h3>{editing ? 'Editar Producto' : 'Nuevo Producto'}</h3>
      <form onsubmit={(e) => { e.preventDefault(); save(); }}>
        <div class="form-row">
          <div>
            <label>Categoría</label>
            <select bind:value={form.categoria}>
              <option value="Varios">Varios</option>
              <option value="Bastidor">Bastidor</option>
              <option value="Marco">Marco</option>
              <option value="Lienzo">Lienzo</option>
              <option value="Moldura">Moldura</option>
              <option value="Servicio">Servicio</option>
            </select>
          </div>
          <div>
            <label>Medida</label>
            <input type="text" bind:value={form.medida} placeholder="ej: 50x60" />
          </div>
        </div>
        <label>Descripción *</label>
        <input type="text" bind:value={form.descripcion} required />
        <div class="form-row">
          <div>
            <label>Precio Unitario</label>
            <input type="number" bind:value={form.precio_unitario} min="0" />
          </div>
          <div>
            <label>Stock</label>
            <input type="number" bind:value={form.stock} min="0" />
          </div>
        </div>
        <label>Variante</label>
        <input type="text" bind:value={form.variante} />
        <div class="modal-actions">
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
  .screen-header h2 { margin: 0; font-size: 1.429rem; color: #2c3e50; }
  .header-actions { display: flex; align-items: center; gap: 0.857rem; }
  .stock-total { font-size: 0.929rem; color: #7f8c8d; }
  .search-bar { margin-bottom: 0.857rem; }
  .search-bar input {
    width: 100%; padding: 0.714rem 1rem; border: 1px solid #ddd; border-radius: 0.571rem;
    font-size: 1rem; box-sizing: border-box;
  }
  .table-wrap { overflow-x: auto; }
  table {
    width: 100%; border-collapse: collapse; background: white; border-radius: 0.571rem;
    overflow: hidden; box-shadow: 0 0.071rem 0.286rem rgba(0,0,0,0.08);
  }
  th, td { padding: 0.714rem 1rem; text-align: left; font-size: 0.929rem; border-bottom: 1px solid #eee; }
  th { background: #f8f9fa; font-weight: 600; color: #555; }
  tr:hover { background: #f8f9fa; }
  .loading { text-align: center; color: #999; padding: 2.857rem; }
  .empty { text-align: center; color: #999; padding: 4.286rem 1.429rem; }
  .btn-primary {
    padding: 0.571rem 1.286rem; background: #007bff; color: white; border: none;
    border-radius: 0.429rem; cursor: pointer; font-size: 0.929rem; font-weight: 500;
  }
  .btn-sm {
    padding: 0.286rem 0.571rem; border: none; background: none; cursor: pointer; font-size: 1.071rem; border-radius: 0.286rem;
  }
  .btn-sm:hover { background: #f0f0f0; }
  .btn-danger:hover { background: #fde8e8; }
  .overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.4);
    display: flex; align-items: center; justify-content: center; z-index: 1000;
  }
  .modal {
    background: white; border-radius: 0.857rem; padding: 1.714rem; width: 34.286rem;
    box-shadow: 0 0.571rem 2.286rem rgba(0,0,0,0.2);
  }
  .modal h3 { margin: 0 0 1.143rem; }
  .modal label { display: block; font-size: 0.929rem; color: #555; margin: 0.571rem 0 0.286rem; }
  .modal input, .modal select {
    width: 100%; padding: 0.571rem 0.714rem; border: 1px solid #ddd; border-radius: 0.429rem;
    font-size: 0.929rem; box-sizing: border-box;
  }
  .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.857rem; }
  .modal-actions { display: flex; gap: 0.571rem; justify-content: flex-end; margin-top: 1.143rem; }
  .btn-secondary {
    padding: 0.571rem 1.286rem; background: #ecf0f1; color: #555; border: none;
    border-radius: 0.429rem; cursor: pointer; font-size: 0.929rem;
  }
</style>
