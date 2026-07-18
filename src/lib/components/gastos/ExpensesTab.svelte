<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import type { Expense, ExpenseCategory } from '$lib/types';

  let expenses = $state<Expense[]>([]);
  let categories = $state<ExpenseCategory[]>([]);
  let loading = $state(true);
  let fromDate = $state('');
  let toDate = $state('');
  let categoryId = $state<number | null>(null);

  function formatCurrency(n: number): string {
    return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2 });
  }

  function formatDate(d: string): string {
    if (!d) return '';
    const p = d.split('-');
    if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
    return d;
  }

  function categoryName(id: number): string {
    return categories.find(c => c.id === id)?.name || 'Sin categoría';
  }

  function categoryIcon(id: number): string {
    return categories.find(c => c.id === id)?.icon || '📁';
  }

  onMount(() => { loadData(); });

  async function loadData() {
    loading = true;
    try {
      const [exps, cats] = await Promise.all([
        api.listExpenses({
          from_date: fromDate || undefined,
          to_date: toDate || undefined,
          category_id: categoryId ?? undefined,
          limit: 200,
        }),
        api.listExpenseCategories(),
      ]);
      expenses = exps;
      categories = cats;
    } catch (e) {
      console.error('ExpensesTab error:', e);
    } finally {
      loading = false;
    }
  }

  async function migrate() {
    try {
      const result = await api.migrateExpenses();
      alert(`Migración completada: ${result.created} gastos creados`);
      await loadData();
    } catch (e) {
      alert('Error al migrar: ' + (e as Error).message);
    }
  }

  async function deleteExpense(id: number, desc: string) {
    if (!confirm(`¿Eliminar "${desc.slice(0, 40)}"?`)) return;
    try {
      await api.deleteExpense(id);
      await loadData();
    } catch (e) {
      alert('Error al eliminar: ' + (e as Error).message);
    }
  }
</script>

<div class="expenses-tab">
  <div class="expenses-header">
    <h3>📋 Gastos registrados</h3>
    <button class="btn-migrate" onclick={migrate}>Migrar histórico</button>
  </div>

  <div class="filters">
    <input type="date" bind:value={fromDate} />
    <input type="date" bind:value={toDate} />
    <select bind:value={categoryId}>
      <option value={null}>Todas las categorías</option>
      {#each categories as cat}
        <option value={cat.id}>{cat.icon} {cat.name}</option>
      {/each}
    </select>
    <button onclick={loadData}>Buscar</button>
  </div>

  {#if loading}
    <div class="loading">Cargando...</div>
  {:else if expenses.length === 0}
    <div class="empty">No hay gastos registrados en este período.</div>
  {:else}
    <div class="expenses-list">
      {#each expenses as exp}
        <div class="expense-row">
          <span class="expense-icon">{categoryIcon(exp.category_id)}</span>
          <span class="expense-date">{formatDate(exp.date)}</span>
          <span class="expense-desc">{exp.description}</span>
          <span class="expense-category">{categoryName(exp.category_id)}</span>
          <span class="expense-source">{exp.source}</span>
          <span class="expense-amount">{formatCurrency(exp.amount)}</span>
          <button class="expense-delete" onclick={() => deleteExpense(exp.id, exp.description)} title="Eliminar">🗑️</button>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .expenses-tab {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    height: 100%;
    overflow: auto;
  }
  .expenses-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .expenses-header h3 { margin: 0; }
  .filters {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .filters input, .filters select {
    padding: 0.4rem 0.6rem;
    border: 1px solid #ddd;
    border-radius: 0.3rem;
    font-size: 0.85rem;
  }
  .filters button {
    padding: 0.4rem 0.8rem;
    border: none;
    background: var(--accent, #3498db);
    color: white;
    border-radius: 0.3rem;
    cursor: pointer;
  }
  .btn-migrate {
    padding: 0.4rem 0.8rem;
    border: 1px solid var(--accent, #3498db);
    background: white;
    color: var(--accent, #3498db);
    border-radius: 0.3rem;
    cursor: pointer;
    font-size: 0.8rem;
  }
  .loading, .empty {
    padding: 2rem;
    text-align: center;
    color: var(--text-muted, #888);
  }
  .expenses-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .expense-row {
    display: grid;
    grid-template-columns: 2rem 6rem 1fr 8rem 6rem 7rem 2rem;
    gap: 0.6rem;
    align-items: center;
    padding: 0.6rem;
    background: var(--bg-card, white);
    border-radius: 0.4rem;
    font-size: 0.85rem;
  }
  .expense-icon { text-align: center; }
  .expense-date { font-family: monospace; color: var(--text-muted, #888); }
  .expense-desc { font-weight: 500; }
  .expense-category {
    padding: 0.15rem 0.4rem;
    background: #f0f0f0;
    border-radius: 0.25rem;
    text-align: center;
  }
  .expense-source {
    text-align: center;
    color: var(--text-muted, #888);
    font-size: 0.75rem;
  }
  .expense-amount {
    text-align: right;
    font-weight: 700;
    font-family: monospace;
  }
  .expense-delete {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    font-size: 0.85rem;
    opacity: 0.5;
    transition: opacity 0.15s;
  }
  .expense-delete:hover { opacity: 1; }
</style>
