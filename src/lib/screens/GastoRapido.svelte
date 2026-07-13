<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import type { Provider, Employee } from '$lib/types';
  import { parseExpense, getSuggestions, extractAmount, fuzzyMatchEntities, EXPENSE_TYPE_LABELS } from '$lib/utils/quickExpense';
  import type { ParsedExpense, Suggestion } from '$lib/utils/quickExpense';

  let providers: Provider[] = $state([]);
  let employees: Employee[] = $state([]);
  let inputText = $state('');
  let suggestions: Suggestion[] = $state([]);
  let selectedIdx = $state(-1);
  let loading = $state(true);
  let saving = $state(false);
  let gastosVariosId: number | null = $state(null);
  let inputEl: HTMLInputElement | undefined = $state();
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  let parsed: ParsedExpense = $derived(parseExpense(inputText, providers, employees));
  let hasSuggestions = $derived(suggestions.length > 0 && selectedIdx >= -1);

  let recentExpenses: Array<{ amount: number; text: string; type: string; entity: string; date: string }> = $state([]);

  function formatCurrency(n: number): string {
    return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2 });
  }

  function formatDate(d: string): string {
    if (!d) return '';
    const p = d.split('-');
    if (p.length === 3) return `${p[2]}/${p[1]}/${p[0]}`;
    return d;
  }

  onMount(async () => {
    try {
      const [provs, emps] = await Promise.all([
        cacheStore.fetch('providers', () => api.listProviders(), 900000),
        cacheStore.fetch('employees:active', () => api.listEmployees(true), 900000),
      ]);
      providers = provs;
      employees = emps;
    } catch {}
    loading = false;
    inputEl?.focus();
  });

  function onInput() {
    selectedIdx = -1;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      suggestions = getSuggestions(inputText, providers, employees);
    }, 80);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (suggestions.length > 0) {
        selectedIdx = selectedIdx < suggestions.length - 1 ? selectedIdx + 1 : 0;
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = selectedIdx > 0 ? selectedIdx - 1 : suggestions.length - 1;
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIdx >= 0 && selectedIdx < suggestions.length) {
        selectSuggestion(suggestions[selectedIdx]);
      } else if (parsed.amount > 0 && parsed.description) {
        confirmExpense();
      }
    } else if (e.key === 'Escape') {
      suggestions = [];
      selectedIdx = -1;
    }
  }

  function selectSuggestion(s: Suggestion) {
    const trimmed = inputText.trimEnd();
    if (!trimmed) {
      inputText = s.appendText;
    } else {
      const lastSpace = trimmed.lastIndexOf(' ');
      if (lastSpace >= 0) {
        inputText = trimmed.substring(0, lastSpace + 1) + s.appendText;
      } else {
        inputText = s.appendText;
      }
    }
    suggestions = [];
    selectedIdx = -1;
    inputEl?.focus();
  }

  async function ensureGastosVarios(): Promise<number> {
    if (gastosVariosId) return gastosVariosId;
    const existing = providers.find(p => p.name === 'Gastos Varios');
    if (existing) {
      gastosVariosId = existing.id;
      return existing.id;
    }
    try {
      const result = await api.addProvider({ name: 'Gastos Varios' });
      gastosVariosId = result.id;
      providers = [...providers, { id: result.id, name: 'Gastos Varios', cuit: '', alias_mp: '', alias_cbu: '', address: '' }];
      return result.id;
    } catch (e) {
      throw new Error('No se pudo crear la cuenta de Gastos Varios');
    }
  }

  async function confirmExpense() {
    if (saving || !parsed.amount || !parsed.description) return;
    saving = true;
    try {
      const today = new Date().toISOString().slice(0, 10);

      if (parsed.type === 'EMPLOYEE_PAYMENT' && parsed.entityId) {
        await api.addEmployeePayment({
          employee_id: parsed.entityId,
          date: today,
          amount: parsed.amount,
          concept: parsed.description,
        });
      } else if (parsed.type === 'PURCHASE' && parsed.entityId) {
        await api.addProviderMovement({
          provider_id: parsed.entityId,
          date: today,
          type: 'PURCHASE',
          description: parsed.description,
          amount: parsed.amount,
          reference: '',
        });
      } else if (parsed.type === 'PAYMENT' && parsed.entityId) {
        await api.addProviderMovement({
          provider_id: parsed.entityId,
          date: today,
          type: 'PAYMENT',
          description: parsed.description,
          amount: parsed.amount,
          reference: '',
        });
      } else {
        const gvId = await ensureGastosVarios();
        await api.addProviderMovement({
          provider_id: gvId,
          date: today,
          type: 'PAYMENT',
          description: parsed.description,
          amount: parsed.amount,
          reference: '',
        });
      }

      cacheStore.invalidate('providers');
      cacheStore.invalidate('employees');

      const entityName = parsed.entityName || 'Gastos Varios';
      const typeLabel = EXPENSE_TYPE_LABELS[parsed.type];
      recentExpenses = [{ amount: parsed.amount, text: inputText, type: typeLabel, entity: entityName, date: today }, ...recentExpenses.slice(0, 19)];

      inputText = '';
      appStore.showToast(`${formatCurrency(parsed.amount)} registrado — ${typeLabel} a ${entityName}`);
    } catch (e) {
      appStore.alert('Error al guardar: ' + (e as Error).message);
    } finally {
      saving = false;
      inputEl?.focus();
    }
  }

  function getTypeBadgeClass(type: ParsedExpense['type']): string {
    switch (type) {
      case 'PAYMENT': return 'badge-payment';
      case 'PURCHASE': return 'badge-purchase';
      case 'EMPLOYEE_PAYMENT': return 'badge-salary';
      case 'GENERAL': return 'badge-general';
    }
  }

  function getTypeIcon(type: ParsedExpense['type']): string {
    switch (type) {
      case 'PAYMENT': return '💸';
      case 'PURCHASE': return '🛒';
      case 'EMPLOYEE_PAYMENT': return '👷';
      case 'GENERAL': return '📄';
    }
  }
</script>

<div class="gasto-rapido">
  <div class="gr-header">
    <h2>🚀 Gasto Rápido</h2>
  </div>

  {#if loading}
    <div class="gr-loading">Cargando datos...</div>
  {:else}
    <div class="gr-input-area">
      <div class="gr-input-wrap" class:gr-has-suggestions={hasSuggestions}>
        <input
          type="text"
          bind:value={inputText}
          bind:this={inputEl}
          oninput={onInput}
          onkeydown={onKeyDown}
          placeholder="Ej: 1000 pago de sueldo a Julian"
          class="gr-input"
          autocomplete="off"
        />
        {#if inputText}
          <button class="gr-clear-btn" onclick={() => { inputText = ''; suggestions = []; selectedIdx = -1; inputEl?.focus(); }}>✕</button>
        {/if}
      </div>

      {#if hasSuggestions}
        <div class="gr-suggestions">
          {#each suggestions as s, i}
            <button
              class="gr-sug-item"
              class:gr-sug-selected={i === selectedIdx}
              onmousedown={(e) => { e.preventDefault(); selectSuggestion(s); }}
              onmouseenter={() => selectedIdx = i}
            >
              <span class="gr-sug-icon">
                {#if s.type === 'provider'}📦
                {:else if s.type === 'employee'}👤
                {:else if s.type === 'template'}⚡
                {:else}📁
                {/if}
              </span>
              <span class="gr-sug-label">{s.label}</span>
              <span class="gr-sug-sub">{s.subtitle}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    {#if parsed.amount > 0}
      <div class="gr-preview">
        <h3>Vista Previa</h3>
        <div class="gr-preview-grid">
          <div class="gr-preview-row">
            <span class="gr-preview-label">Monto</span>
            <span class="gr-preview-value gr-amount">{formatCurrency(parsed.amount)}</span>
          </div>
          <div class="gr-preview-row">
            <span class="gr-preview-label">Tipo</span>
            <span class="gr-preview-value">
              <span class="gr-type-badge {getTypeBadgeClass(parsed.type)}">
                {getTypeIcon(parsed.type)} {EXPENSE_TYPE_LABELS[parsed.type]}
              </span>
            </span>
          </div>
          <div class="gr-preview-row">
            <span class="gr-preview-label">Entidad</span>
            <span class="gr-preview-value">
              {#if parsed.entityName}
                <span class="gr-entity-ok">
                  {parsed.entityName}
                  <span class="gr-entity-type">{parsed.entityType === 'PROVIDER' ? 'Proveedor' : 'Empleado'}</span>
                </span>
              {:else}
                <span class="gr-entity-none">Gastos Varios (genérico)</span>
              {/if}
            </span>
          </div>
          <div class="gr-preview-row">
            <span class="gr-preview-label">Descripción</span>
            <span class="gr-preview-value">{parsed.description}</span>
          </div>
        </div>
        <button
          class="gr-confirm-btn"
          onclick={confirmExpense}
          disabled={saving}
        >
          {saving ? 'Guardando...' : '✓ Confirmar Gasto'}
        </button>
      </div>
    {:else if inputText}
      <div class="gr-empty-preview">
        Escribe un monto y descripción para ver la vista previa
      </div>
    {/if}

    {#if recentExpenses.length > 0}
      <div class="gr-recent">
        <h3>Últimos registrados</h3>
        <div class="gr-recent-list">
          {#each recentExpenses as r}
            <div class="gr-recent-item">
              <span class="gr-recent-amount">{formatCurrency(r.amount)}</span>
              <span class="gr-recent-entity">→ {r.entity}</span>
              <span class="gr-recent-type">({r.type})</span>
              <span class="gr-recent-date">{formatDate(r.date)}</span>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>

<style>
  .gasto-rapido {
    padding: 1.143rem;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.857rem;
    background: var(--bg-page);
    overflow: auto;
  }

  .gr-header h2 {
    margin: 0;
    font-size: 1.3rem;
    color: var(--text-primary);
  }

  .gr-loading {
    padding: 2rem;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .gr-input-area {
    position: relative;
    z-index: 10;
  }

  .gr-input-wrap {
    display: flex;
    background: var(--bg-card);
    border: 2px solid var(--border);
    border-radius: 0.643rem;
    transition: border-color 0.15s;
  }

  .gr-input-wrap:focus-within {
    border-color: var(--accent);
  }

  .gr-input-wrap.gr-has-suggestions {
    border-radius: 0.643rem 0.643rem 0 0;
  }

  .gr-input {
    flex: 1;
    padding: 0.857rem 1rem;
    border: none;
    background: none;
    font-size: 1.05rem;
    font-family: inherit;
    outline: none;
    color: var(--text-primary);
  }

  .gr-input::placeholder {
    color: var(--text-muted);
  }

  .gr-clear-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 0.9rem;
    padding: 0 0.857rem;
    cursor: pointer;
  }

  .gr-clear-btn:hover {
    color: #e74c3c;
  }

  .gr-suggestions {
    background: var(--bg-card);
    border: 2px solid var(--accent);
    border-top: none;
    border-radius: 0 0 0.643rem 0.643rem;
    overflow: hidden;
    box-shadow: 0 0.429rem 0.857rem rgba(0,0,0,0.1);
  }

  .gr-sug-item {
    display: flex;
    align-items: center;
    gap: 0.571rem;
    width: 100%;
    padding: 0.571rem 0.857rem;
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
    font-family: inherit;
    font-size: 0.85rem;
    transition: background 0.08s;
  }

  .gr-sug-item:hover,
  .gr-sug-selected {
    background: var(--accent-light);
  }

  .gr-sug-icon {
    font-size: 1rem;
    flex-shrink: 0;
  }

  .gr-sug-label {
    font-weight: 600;
    color: var(--text-primary);
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .gr-sug-sub {
    font-size: 0.72rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .gr-preview {
    background: var(--bg-card);
    border-radius: 0.571rem;
    padding: 1rem 1.143rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }

  .gr-preview h3 {
    margin: 0 0 0.714rem;
    font-size: 0.85rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.036rem;
  }

  .gr-preview-grid {
    display: flex;
    flex-direction: column;
    gap: 0.429rem;
  }

  .gr-preview-row {
    display: flex;
    align-items: center;
    gap: 0.714rem;
  }

  .gr-preview-label {
    min-width: 5.714rem;
    font-size: 0.78rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .gr-preview-value {
    font-size: 0.9rem;
    color: var(--text-primary);
    font-weight: 500;
  }

  .gr-amount {
    font-size: 1.2rem;
    font-weight: 700;
    color: #27ae60;
  }

  .gr-type-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.286rem;
    padding: 0.143rem 0.571rem;
    border-radius: 0.286rem;
    font-size: 0.78rem;
    font-weight: 600;
  }

  .badge-payment { background: #d4edda; color: #155724; }
  .badge-purchase { background: #fff3cd; color: #856404; }
  .badge-salary { background: #cce5ff; color: #004085; }
  .badge-general { background: #e2d9f3; color: #5a3d8a; }

  .gr-entity-ok {
    display: inline-flex;
    align-items: center;
    gap: 0.429rem;
    color: var(--success);
    font-weight: 600;
  }

  .gr-entity-type {
    font-size: 0.68rem;
    color: var(--text-muted);
    font-weight: 400;
    background: #f0f0f0;
    padding: 0.071rem 0.357rem;
    border-radius: 0.214rem;
  }

  .gr-entity-none {
    color: var(--text-muted);
    font-style: italic;
    font-size: 0.82rem;
  }

  .gr-confirm-btn {
    display: block;
    width: 100%;
    margin-top: 0.857rem;
    padding: 0.714rem;
    border: none;
    border-radius: 0.429rem;
    background: var(--success);
    color: white;
    font-size: 1rem;
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
  }

  .gr-confirm-btn:hover:not(:disabled) {
    background: #219a52;
  }

  .gr-confirm-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .gr-empty-preview {
    padding: 1.5rem;
    text-align: center;
    color: var(--text-muted);
    font-size: 0.85rem;
    border: 2px dashed var(--border);
    border-radius: 0.571rem;
  }

  .gr-recent {
    background: var(--bg-card);
    border-radius: 0.571rem;
    padding: 0.857rem 1rem;
    box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.06);
  }

  .gr-recent h3 {
    margin: 0 0 0.571rem;
    font-size: 0.82rem;
    color: var(--text-muted);
    font-weight: 600;
  }

  .gr-recent-list {
    display: flex;
    flex-direction: column;
    gap: 0.143rem;
  }

  .gr-recent-item {
    display: flex;
    align-items: center;
    gap: 0.571rem;
    padding: 0.357rem 0.429rem;
    font-size: 0.8rem;
    border-bottom: 1px solid #f5f5f5;
  }

  .gr-recent-amount {
    font-weight: 700;
    font-family: monospace;
    min-width: 5rem;
  }

  .gr-recent-entity {
    color: var(--text-primary);
    font-weight: 500;
    flex: 1;
  }

  .gr-recent-type {
    font-size: 0.72rem;
    color: var(--text-muted);
  }

  .gr-recent-date {
    font-family: monospace;
    font-size: 0.72rem;
    color: var(--text-muted);
  }
</style>
