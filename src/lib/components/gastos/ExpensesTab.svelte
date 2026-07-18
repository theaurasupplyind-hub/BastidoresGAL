<script lang="ts">
  import { slide } from 'svelte/transition';
  import { api } from '$lib/api/client';
  import type { Expense, ExpenseCategory } from '$lib/types';

  let { fromDate = '', toDate = '', categoryId = null }: { fromDate?: string; toDate?: string; categoryId?: number | null } = $props();

  let expenses = $state<Expense[]>([]);
  let categories = $state<ExpenseCategory[]>([]);
  let loading = $state(true);
  let openMenuId = $state<number | null>(null);
  let editingExpense = $state<Expense | null>(null);
  let editForm = $state({ description: '', amount: 0, date: '', category_id: 0 });
  let saving = $state(false);

  const CAT_ICONS: Record<string, string> = {
    luz: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>',
    agua: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>',
    internet: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/></svg>',
    alquiler: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    gas: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V4z"/><path d="M8 14h10"/><path d="M14 18v2"/></svg>',
    limpieza: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/></svg>',
    seguro: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>',
    impuestos: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    contabilidad: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/></svg>',
    proveedor: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    materia: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>',
    herramientas: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    mantenimiento: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.32 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    sueldos: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    viáticos: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
    flete: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    envío: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    transporte: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    combustible: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V4z"/><path d="M8 14h10"/><path d="M14 18v2"/><line x1="3" y1="18" x2="22" y2="18"/><line x1="9" y1="4" x2="9" y2="18"/></svg>',
    comida: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></svg>',
    marketing: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    subscripciones: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    varios: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>',
  };

  const SOURCE_ICONS: Record<string, string> = {
    manual: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"/><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 0 1 2 2v4a6 6 0 0 1-6 6H9a5 5 0 0 1-5-5v-1"/></svg>',
    whatsapp: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    facgal: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
    bot: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>',
  };

  let editRef = $state<HTMLDivElement | null>(null);

  function getCatSlug(id: number): string {
    const c = categories.find(c => c.id === id);
    if (!c) return 'varios';
    const n = c.name.toLowerCase();
    if (n.includes('luz') || n.includes('electric')) return 'luz';
    if (n.includes('agua')) return 'agua';
    if (n.includes('internet')) return 'internet';
    if (n.includes('alquiler')) return 'alquiler';
    if (n.includes('gas')) return 'gas';
    if (n.includes('limpieza')) return 'limpieza';
    if (n.includes('seguro')) return 'seguro';
    if (n.includes('impuest')) return 'impuestos';
    if (n.includes('contab')) return 'contabilidad';
    if (n.includes('proveedor') || n.includes('compra') || n.includes('materia')) return 'proveedor';
    if (n.includes('herramient')) return 'herramientas';
    if (n.includes('mantenim')) return 'mantenimiento';
    if (n.includes('sueldo') || n.includes('bonif') || n.includes('personal')) return 'sueldos';
    if (n.includes('viático') || n.includes('viaje')) return 'viáticos';
    if (n.includes('flete') || n.includes('envío') || n.includes('transporte')) return 'flete';
    if (n.includes('combust')) return 'combustible';
    if (n.includes('comida') || n.includes('comid')) return 'comida';
    if (n.includes('market')) return 'marketing';
    if (n.includes('subscrip') || n.includes('susc')) return 'subscripciones';
    if (n.includes('retiro') || n.includes('socio')) return 'varios';
    return 'varios';
  }

  function catIcon(id: number): string {
    return CAT_ICONS[getCatSlug(id)] || CAT_ICONS.varios;
  }

  function catName(id: number): string {
    return categories.find(c => c.id === id)?.name || 'Sin categoría';
  }

  function sourceIcon(src: string): string {
    return SOURCE_ICONS[src] || SOURCE_ICONS.manual;
  }

  function formatCurrency(n: number): string {
    return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2 });
  }

  function formatDate(d: string): string {
    if (!d) return '';
    const p = d.split('-');
    if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
    return d;
  }

  async function loadData() {
    loading = true;
    try {
      const [exps, cats] = await Promise.all([
        api.listExpenses({
          from_date: fromDate || undefined,
          to_date: toDate || undefined,
          category_id: categoryId ?? undefined,
          exclude_owners: true,
          limit: 200,
        }),
        api.listExpenseCategories(),
      ]);
      expenses = exps.sort((a, b) => b.date.localeCompare(a.date));
      categories = cats;
    } catch (e) {
      console.error('ExpensesTab error:', e);
    } finally {
      loading = false;
    }
  }

  $effect(() => { fromDate; toDate; categoryId; loadData(); });

  function toggleMenu(id: number) {
    openMenuId = openMenuId === id ? null : id;
  }

  function closeMenu() {
    openMenuId = null;
  }

  function startEdit(exp: Expense) {
    editingExpense = exp;
    editForm = { description: exp.description, amount: exp.amount, date: exp.date, category_id: exp.category_id };
    openMenuId = null;
  }

  async function saveEdit() {
    if (!editingExpense) return;
    saving = true;
    try {
      await api.updateExpense(editingExpense.id, {
        description: editForm.description,
        amount: editForm.amount,
        date: editForm.date,
        category_id: editForm.category_id,
      });
      editingExpense = null;
      await loadData();
    } catch (e) {
      alert('Error al guardar: ' + (e as Error).message);
    } finally {
      saving = false;
    }
  }

  function cancelEdit() {
    editingExpense = null;
  }

  async function deleteExpense(id: number, desc: string) {
    openMenuId = null;
    if (!confirm(`¿Eliminar "${desc.slice(0, 40)}"?`)) return;
    try {
      await api.deleteExpense(id);
      await loadData();
    } catch (e) {
      alert('Error al eliminar: ' + (e as Error).message);
    }
  }

  function handleDocClick(e: MouseEvent) {
    if (openMenuId !== null) {
      const target = e.target as HTMLElement;
      if (!target.closest('.expense-menu')) {
        openMenuId = null;
      }
    }
  }
</script>

<svelte:window onclick={handleDocClick} />

<div class="expenses-tab">
  {#if loading}
    <div class="loading">Cargando...</div>
  {:else if expenses.length === 0}
    <div class="empty">No hay gastos registrados en este período.</div>
  {:else}
    <div class="expenses-list">
      {#each expenses as exp}
        <div class="expense-row">
          <span class="expense-icon">{@html catIcon(exp.category_id)}</span>
          <span class="expense-date">{formatDate(exp.date)}</span>
          <span class="expense-desc" title={exp.description}>{exp.description}</span>
          <span class="expense-category">{catName(exp.category_id)}</span>
          <span class="expense-source" title={exp.source}>{@html sourceIcon(exp.source)}</span>
          <span class="expense-amount">{formatCurrency(exp.amount)}</span>
          <div class="expense-menu">
            <button class="menu-btn" onclick={() => toggleMenu(exp.id)} title="Acciones">⋮</button>
            {#if openMenuId === exp.id}
              <div class="menu-dropdown" transition:slide|global={{ duration: 100 }}>
                <button class="menu-item" onclick={() => startEdit(exp)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Editar
                </button>
                <button class="menu-item menu-item-danger" onclick={() => deleteExpense(exp.id, exp.description)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                  Eliminar
                </button>
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if editingExpense}
  <div class="modal-overlay" onclick={cancelEdit} role="presentation">
    <div class="modal" bind:this={editRef} onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <h3>Editar gasto</h3>
      <label class="modal-field">
        <span>Descripción</span>
        <input type="text" bind:value={editForm.description} />
      </label>
      <label class="modal-field">
        <span>Monto</span>
        <input type="number" step="0.01" bind:value={editForm.amount} />
      </label>
      <label class="modal-field">
        <span>Fecha</span>
        <input type="date" bind:value={editForm.date} />
      </label>
      <label class="modal-field">
        <span>Categoría</span>
        <select bind:value={editForm.category_id}>
          {#each categories as cat}
            <option value={cat.id}>{cat.name}</option>
          {/each}
        </select>
      </label>
      <div class="modal-actions">
        <button class="btn-cancel" onclick={cancelEdit}>Cancelar</button>
        <button class="btn-save" onclick={saveEdit} disabled={saving}>{saving ? 'Guardando...' : 'Guardar'}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .expenses-tab {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  .loading, .empty {
    padding: 2rem;
    text-align: center;
    color: var(--text-muted, #888);
    font-size: 1rem;
  }
  .expenses-list {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .expense-row {
    display: grid;
    grid-template-columns: 2rem 6rem 1fr 8rem 3rem 7rem 2rem;
    gap: 0.8rem;
    align-items: center;
    padding: 0.9rem 1rem;
    background: var(--bg-card, white);
    border-radius: 0.5rem;
    font-size: 1.05rem;
    position: relative;
  }
  .expense-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }
  .expense-date {
    font-family: monospace;
    color: var(--text-muted, #888);
    font-size: 0.95rem;
    white-space: nowrap;
  }
  .expense-desc {
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .expense-category {
    padding: 0.25rem 0.6rem;
    background: #f0f0f0;
    border-radius: 0.3rem;
    text-align: center;
    font-size: 0.9rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .expense-source {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted, #888);
  }
  .expense-amount {
    text-align: right;
    font-weight: 700;
    font-family: monospace;
    font-size: 1.1rem;
    white-space: nowrap;
  }
  .expense-menu {
    position: relative;
    display: flex;
    justify-content: center;
  }
  .menu-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 1.3rem;
    line-height: 1;
    padding: 0.2rem;
    color: var(--text-muted);
    border-radius: 0.3rem;
    transition: background 0.12s;
  }
  .menu-btn:hover {
    background: var(--bg-hover, #f0f0f0);
    color: var(--text-primary);
  }
  .menu-dropdown {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 50;
    background: var(--bg-card, white);
    border: 1px solid var(--border, #e0e0e0);
    border-radius: 0.4rem;
    box-shadow: 0 4px 12px rgba(0,0,0,0.12);
    overflow: hidden;
    min-width: 130px;
  }
  .menu-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 0.5rem 0.75rem;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 0.85rem;
    color: var(--text-primary);
    text-align: left;
    transition: background 0.1s;
  }
  .menu-item:hover { background: var(--bg-hover, #f5f5f5); }
  .menu-item-danger { color: var(--danger, #e53935); }
  .menu-item-danger:hover { background: #fef2f2; }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
  }
  .modal {
    background: var(--bg-card, white);
    border-radius: 0.6rem;
    padding: 1.5rem;
    min-width: 360px;
    box-shadow: 0 8px 30px rgba(0,0,0,0.2);
  }
  .modal h3 {
    margin: 0 0 1rem;
    font-size: 1.1rem;
    color: var(--text-primary);
  }
  .modal-field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    margin-bottom: 0.8rem;
  }
  .modal-field span {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted);
  }
  .modal-field input, .modal-field select {
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--border, #ddd);
    border-radius: 0.35rem;
    font-size: 0.95rem;
    background: var(--bg-page);
    color: var(--text-primary);
  }
  .modal-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    margin-top: 1rem;
  }
  .btn-cancel {
    padding: 0.5rem 1rem;
    border: 1px solid var(--border, #ddd);
    border-radius: 0.35rem;
    background: none;
    cursor: pointer;
    font-size: 0.9rem;
    color: var(--text-secondary);
  }
  .btn-save {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 0.35rem;
    background: var(--accent, #2563eb);
    color: white;
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 600;
  }
  .btn-save:disabled { opacity: 0.6; cursor: not-allowed; }
</style>
