<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import type { ExpenseCategory } from '$lib/types';

  let categories = $state<ExpenseCategory[]>([]);
  let loading = $state(true);
  let newName = $state('');
  let newType = $state('otros');
  let saving = $state(false);

  const types = [
    { value: 'operativo', label: 'Operativo' },
    { value: 'administrativo', label: 'Administrativo' },
    { value: 'personal', label: 'Personal' },
    { value: 'logistica', label: 'Logística' },
    { value: 'otros', label: 'Otros' },
  ];

  onMount(() => { loadCategories(); });

  async function loadCategories() {
    loading = true;
    try {
      categories = await api.listExpenseCategories();
    } catch (e) {
      console.error('CategoriesTab error:', e);
    } finally {
      loading = false;
    }
  }

  async function addCategory() {
    if (!newName.trim()) return;
    saving = true;
    try {
      await api.createExpenseCategory({
        name: newName.trim(),
        slug: '',
        color: '#3498db',
        icon: '📁',
        type: newType,
        is_default: 0,
        created_by: null,
      });
      newName = '';
      await loadCategories();
    } catch (e) {
      alert('Error al crear categoría: ' + (e as Error).message);
    } finally {
      saving = false;
    }
  }

  function keyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') addCategory();
  }
</script>

<div class="categories-tab">
  <h3>🏷️ Categorías de gastos</h3>

  <div class="new-category">
    <input
      type="text"
      placeholder="Nueva categoría..."
      bind:value={newName}
      onkeydown={keyDown}
    />
    <select bind:value={newType}>
      {#each types as t}
        <option value={t.value}>{t.label}</option>
      {/each}
    </select>
    <button onclick={addCategory} disabled={saving}>
      {saving ? 'Guardando...' : 'Agregar'}
    </button>
  </div>

  {#if loading}
    <div class="loading">Cargando...</div>
  {:else}
    <div class="categories-grid">
      {#each categories as cat}
        <div class="category-card" style="border-color: {cat.color}">
          <span class="category-icon">{cat.icon}</span>
          <span class="category-name">{cat.name}</span>
          <span class="category-type">{cat.type}</span>
          {#if cat.is_default}
            <span class="badge-default">Predeterminada</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .categories-tab {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    height: 100%;
    overflow: auto;
  }
  .categories-tab h3 { margin: 0; }
  .new-category {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .new-category input, .new-category select {
    padding: 0.4rem 0.6rem;
    border: 1px solid #ddd;
    border-radius: 0.3rem;
    font-size: 0.85rem;
  }
  .new-category input { flex: 1; min-width: 12rem; }
  .new-category button {
    padding: 0.4rem 0.8rem;
    border: none;
    background: var(--accent, #27ae60);
    color: white;
    border-radius: 0.3rem;
    cursor: pointer;
  }
  .new-category button:disabled { opacity: 0.6; }
  .loading {
    padding: 2rem;
    text-align: center;
    color: var(--text-muted, #888);
  }
  .categories-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
    gap: 0.6rem;
  }
  .category-card {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.7rem;
    background: var(--bg-card, white);
    border-radius: 0.4rem;
    border-left: 4px solid;
  }
  .category-icon { font-size: 1.2rem; }
  .category-name { font-weight: 600; }
  .category-type {
    font-size: 0.75rem;
    color: var(--text-muted, #888);
    text-transform: capitalize;
  }
  .badge-default {
    font-size: 0.7rem;
    background: #e8f5e9;
    color: #2e7d32;
    padding: 0.15rem 0.4rem;
    border-radius: 0.25rem;
    width: fit-content;
  }
</style>
