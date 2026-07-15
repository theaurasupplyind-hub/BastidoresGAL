<script lang="ts">
  import { onMount } from 'svelte';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import { api } from '$lib/api/client';
  import { evaluateRules, parseQuery, type RuleEvalStep } from '$lib/utils/precios';
  import type { PrecioReferencia, PricingRule, RuleCondition } from '$lib/types';

  let refs = $state<PrecioReferencia[]>([]);
  let loadingRefs = $state(false);
  let loadingRules = $state(true);
  let saving = $state(false);
  let rules = $state<PricingRule[]>([]);
  let testQuery = $state('');
  let steps = $state<RuleEvalStep[]>([]);
  let dirty = $state(false);
  let expandedRule = $state<number | null>(null);
  let tempIdCounter = 0;

  const roundingOptions = [
    { value: 0, label: 'Sin redondeo' },
    { value: 100, label: '$100' },
    { value: 500, label: '$500' },
    { value: 1000, label: '$1.000' },
    { value: 5000, label: '$5.000' },
    { value: 10000, label: '$10.000' },
  ];

  async function loadRefs() {
    const cached = cacheStore.get<PrecioReferencia[]>('preciosReferencia');
    if (cached) { refs = cached; return; }
    loadingRefs = true;
    try {
      refs = await cacheStore.fetch('preciosReferencia', () => api.getPreciosReferencia(), 1800000);
    } catch {
      refs = [];
    } finally {
      loadingRefs = false;
    }
  }

  function tempId(): number { return -(Date.now() + tempIdCounter++); }

  function rawToRules(raw: any[]): PricingRule[] {
    return raw.map((r: any) => ({
      id: r.id,
      name: r.name || '',
      matchTokens: typeof (r.matchTokens ?? r.match_tokens) === 'string'
        ? JSON.parse((r.matchTokens ?? r.match_tokens) || '[]')
        : (Array.isArray(r.matchTokens ?? r.match_tokens) ? (r.matchTokens ?? r.match_tokens) : []),
      baseCategoria: r.baseCategoria ?? r.base_categoria ?? '',
      baseVariante: r.baseVariante ?? r.base_variante ?? '',
      operation: r.operation ?? 'direct',
      operationValue: r.operationValue ?? r.operation_value ?? 0,
      conditions: typeof (r.conditions) === 'string'
        ? JSON.parse(r.conditions || '[]')
        : (Array.isArray(r.conditions) ? r.conditions : []),
      enabled: r.enabled ?? true,
      rounding: r.rounding ?? 1000,
    }));
  }

  async function loadRules() {
    loadingRules = true;
    try {
      const data = await api.getPricingRules();
      rules = data && data.length > 0 ? rawToRules(data) : defaultRules();
    } catch {
      rules = defaultRules();
    } finally {
      loadingRules = false;
    }
  }

  onMount(() => { loadRefs(); loadRules(); });

  function defaultRules(): PricingRule[] {
    return [
      {
        name: 'Pintura',
        matchTokens: ['pintura'],
        baseCategoria: 'BASTIDOR',
        baseVariante: 'Sin tela',
        operation: 'percentage',
        operationValue: 10,
        conditions: [],
        enabled: true,
        rounding: 1000,
      },
      {
        name: 'Tapacantos',
        matchTokens: ['tapacanto'],
        baseCategoria: 'BASTIDOR',
        baseVariante: 'Lienzo Profesional',
        operation: 'direct',
        operationValue: 0,
        conditions: [],
        enabled: true,
        rounding: 1000,
      },
      {
        name: 'Caja fibro fácil',
        matchTokens: ['fibro facil', 'fibrofacil'],
        baseCategoria: 'BASTIDOR',
        baseVariante: 'Lienzo Profesional',
        operation: 'direct',
        operationValue: 0,
        conditions: [],
        enabled: true,
        rounding: 1000,
      },
    ];
  }

  async function saveRules() {
    saving = true;
    try {
      const existingIds = new Set(rules.filter(r => r.id && r.id > 0).map(r => r.id!));
      const toDelete = [...existingIds];
      const toSave = [...rules];

      for (const rid of toDelete) {
        try { await api.deletePricingRule(rid); } catch {}
      }

    const fresh: any[] = [];
    for (const rule of toSave) {
      const payload = {
        name: rule.name,
        match_tokens: JSON.stringify(rule.matchTokens),
        base_categoria: rule.baseCategoria,
        base_variante: rule.baseVariante,
        operation: rule.operation,
        operation_value: rule.operationValue,
        conditions: JSON.stringify(rule.conditions),
        enabled: rule.enabled,
        rounding: rule.rounding,
      };
      const saved = await api.savePricingRule(payload);
        fresh.push({
          id: saved.id!,
          ...rule,
          id: saved.id!,
        });
      }
      rules = rawToRules(fresh);
      dirty = false;
      appStore.showToast('Reglas guardadas', 'success');
    } catch (e: any) {
      appStore.alert('Error al guardar: ' + (e?.message || ''));
    } finally {
      saving = false;
    }
  }

  function addRule() {
    const r: PricingRule = {
      id: tempId(),
      name: '',
      matchTokens: [],
      baseCategoria: '',
      baseVariante: '',
      operation: 'direct',
      operationValue: 0,
      conditions: [],
      enabled: true,
      rounding: 1000,
    };
    rules = [...rules, r];
    expandedRule = r.id!;
    dirty = true;
  }

  function removeRule(id: number) {
    rules = rules.filter(r => r.id !== id);
    if (expandedRule === id) expandedRule = null;
    dirty = true;
  }

  function updateRule(id: number, patch: Partial<PricingRule>) {
    rules = rules.map(r => r.id === id ? { ...r, ...patch } : r);
    dirty = true;
  }

  function addCondition(ruleId: number) {
    const cond: RuleCondition = {
      field: 'grosor',
      operator: '>=',
      value: 0,
      adjustmentType: 'percentage',
      adjustmentValue: 0,
    };
    rules = rules.map(r =>
      r.id === ruleId ? { ...r, conditions: [...r.conditions, cond] } : r
    );
    dirty = true;
  }

  function removeCondition(ruleId: number, ci: number) {
    rules = rules.map(r =>
      r.id === ruleId ? { ...r, conditions: r.conditions.filter((_, i) => i !== ci) } : r
    );
    dirty = true;
  }

  function updateCondition(ruleId: number, ci: number, patch: Partial<RuleCondition>) {
    rules = rules.map(r =>
      r.id === ruleId
        ? { ...r, conditions: r.conditions.map((c, i) => i === ci ? { ...c, ...patch } : c) }
        : r
    );
    dirty = true;
  }

  async function runTest() {
    if (!testQuery.trim()) return;
    await loadRefs();
    steps = evaluateRules(testQuery, refs, rules);
  }

  function handleTestKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') runTest();
  }

  function allCategorias(): string[] {
    return [...new Set(refs.map(r => r.categoria))].sort();
  }

  function variantesFor(cat: string): string[] {
    return [...new Set(refs.filter(r => r.categoria === cat).map(r => r.variante))].sort();
  }

  function parseTokens(raw: string): string[] {
    return raw.split(',').map(t => t.trim()).filter(t => t.length > 0);
  }

  function tokensToString(tokens: string[]): string {
    return tokens.join(', ');
  }

  function operationLabel(op: PricingRule['operation']): string {
    const map: Record<string, string> = {
      direct: 'Directo',
      percentage: 'Porcentaje',
      fixed: 'Monto fijo',
      override: 'Sobreescribir',
    };
    return map[op] || op;
  }

  function operationOptions(): Array<{ value: PricingRule['operation']; label: string }> {
    return [
      { value: 'direct', label: 'Directo' },
      { value: 'percentage', label: 'Porcentaje' },
      { value: 'fixed', label: 'Monto fijo' },
      { value: 'override', label: 'Sobreescribir' },
    ];
  }

  const conditionFields: Array<{ value: RuleCondition['field']; label: string }> = [
    { value: 'grosor', label: 'Grosor (cm)' },
    { value: 'lado_mayor', label: 'Lado mayor (cm)' },
    { value: 'lado_menor', label: 'Lado menor (cm)' },
  ];

  const conditionOps: Array<{ value: RuleCondition['operator']; label: string }> = [
    { value: '>', label: '>' },
    { value: '>=', label: '>=' },
    { value: '<', label: '<' },
    { value: '<=', label: '<=' },
    { value: '==', label: '==' },
  ];
</script>

<div class="overlay" onclick={() => appStore.showPricingRules = false} role="presentation">
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="modal-header">
      <h2>⚙ Reglas de Precio</h2>
      <button class="close" onclick={() => appStore.showPricingRules = false}>✕</button>
    </div>

    <div class="modal-body">
      <!-- Simular input de facturación -->
      <div class="test-area">
        <label class="section-label">Simular campo de facturación</label>
        <div class="test-input-wrap">
          <input
            type="text"
            bind:value={testQuery}
            onkeydown={handleTestKeydown}
            placeholder="Ej: pintura 40 x 50 x 5"
            class="test-input"
          />
          <button class="test-btn" onclick={runTest}>⏎ Probar</button>
        </div>
      </div>

      <!-- Estado de refs -->
      <div class="refs-status">
        {#if loadingRefs}
          <span class="refs-loading">Cargando precios de referencia...</span>
        {:else}
          <span class="refs-count">{refs.length} precios cargados</span>
          {#if refs.length > 0}
            <span class="refs-sample">
              Ej: {refs[0].categoria} / {refs[0].variante} / {refs[0].medida} = ${refs[0].precio}
            </span>
          {:else}
            <span class="refs-empty">⚠ Sin datos — importá precios desde Productos → Precios Ref</span>
          {/if}
          <button class="btn-refresh" onclick={() => { cacheStore.invalidate('preciosReferencia'); loadRefs(); }} title="Recargar precios de referencia">↻</button>
        {/if}
      </div>

      <!-- Procesamiento paso a paso -->
      {#if steps.length > 0}
        <div class="steps-area">
          <label class="section-label">Procesamiento paso a paso</label>
          <div class="steps-list">
            {#each steps as step}
              <div class="step" class:step-success={step.success} class:step-fail={step.success === false}>
                <div class="step-label">{step.label}</div>
                <div class="step-detail">{step.detail}</div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Reglas -->
      <div class="rules-area">
        <div class="rules-header">
          <label class="section-label">Reglas</label>
          <button class="btn-add" onclick={addRule}>+ Nueva regla</button>
        </div>

        <div class="rules-list">
          {#each rules as rule}
            <div class="rule-card" class:expanded={expandedRule === rule.id}>
              <!-- Fila contraída -->
              <div class="rule-row" onclick={() => expandedRule = expandedRule === rule.id ? null : rule.id}>
                <button class="rule-toggle" onclick={(e) => { e.stopPropagation(); updateRule(rule.id, { enabled: !rule.enabled }); }}>
                  {rule.enabled ? '✅' : '⏹'}
                </button>
                <span class="rule-name">{rule.name || '(sin nombre)'}</span>
                <span class="rule-tokens">{tokensToString(rule.matchTokens)}</span>
                <span class="rule-op">{operationLabel(rule.operation)}</span>
                <span class="rule-val">{rule.operation === 'percentage' ? `${rule.operationValue}%` : rule.operation === 'fixed' ? `$${rule.operationValue}` : rule.operation === 'override' ? `$${rule.operationValue}` : '—'}</span>
                <span class="rule-expand">{expandedRule === rule.id ? '▲' : '▼'}</span>
              </div>

              <!-- Fila expandida -->
              {#if expandedRule === rule.id}
                <div class="rule-edit">
                  <div class="form-row">
                    <div class="form-group">
                      <label>Nombre</label>
                      <input type="text" value={rule.name} oninput={(e) => updateRule(rule.id, { name: e.currentTarget.value })} placeholder="Ej: Pintura con grosor" />
                    </div>
                    <div class="form-group">
                      <label>Tokens (separados por coma)</label>
                      <input type="text" value={tokensToString(rule.matchTokens)} oninput={(e) => updateRule(rule.id, { matchTokens: parseTokens(e.currentTarget.value) })} placeholder="pintura, esmalte" />
                    </div>
                  </div>

                  <div class="form-row">
                    <div class="form-group">
                      <label>Categoría fuente</label>
                      <select value={rule.baseCategoria} onchange={(e) => updateRule(rule.id, { baseCategoria: e.currentTarget.value, baseVariante: '' })}>
                        <option value="">Seleccionar…</option>
                        {#each allCategorias() as cat}
                          <option value={cat}>{cat}</option>
                        {/each}
                      </select>
                    </div>
                    <div class="form-group">
                      <label>Variante fuente</label>
                      <select value={rule.baseVariante} onchange={(e) => updateRule(rule.id, { baseVariante: e.currentTarget.value })} disabled={!rule.baseCategoria}>
                        {#if !rule.baseCategoria}
                          <option>Primero elegí categoría</option>
                        {:else}
                          <option value="">Todas las variantes</option>
                          {#each variantesFor(rule.baseCategoria) as v}
                            <option value={v}>{v || '(sin variante)'}</option>
                          {/each}
                        {/if}
                      </select>
                    </div>
                    <div class="form-group">
                      <label>Operación</label>
                      <select value={rule.operation} onchange={(e) => updateRule(rule.id, { operation: e.currentTarget.value as PricingRule['operation'] })}>
                        {#each operationOptions() as opt}
                          <option value={opt.value}>{opt.label}</option>
                        {/each}
                      </select>
                    </div>
                    <div class="form-group">
                      <label>Valor</label>
                      <input type="number" value={rule.operationValue} oninput={(e) => updateRule(rule.id, { operationValue: parseFloat(e.currentTarget.value) || 0 })} />
                    </div>
                    <div class="form-group">
                      <label>Redondeo</label>
                      <select value={rule.rounding} onchange={(e) => updateRule(rule.id, { rounding: parseInt(e.currentTarget.value) })}>
                        {#each roundingOptions as opt}
                          <option value={opt.value}>{opt.label}</option>
                        {/each}
                      </select>
                    </div>
                  </div>

                  <!-- Condiciones -->
                  <div class="conditions-section">
                    <div class="conditions-header">
                      <label>Condiciones</label>
                      <button class="btn-add-sm" onclick={() => addCondition(rule.id)}>+ Agregar condición</button>
                    </div>
                    {#if rule.conditions.length === 0}
                      <p class="no-conditions">Sin condiciones</p>
                    {:else}
                      {#each rule.conditions as cond, ci}
                        <div class="condition-row">
                          <select value={cond.field} onchange={(e) => updateCondition(rule.id, ci, { field: e.currentTarget.value as RuleCondition['field'] })}>
                            {#each conditionFields as f}
                              <option value={f.value}>{f.label}</option>
                            {/each}
                          </select>
                          <select value={cond.operator} onchange={(e) => updateCondition(rule.id, ci, { operator: e.currentTarget.value as RuleCondition['operator'] })}>
                            {#each conditionOps as op}
                              <option value={op.value}>{op.label}</option>
                            {/each}
                          </select>
                          <input type="number" value={cond.value} oninput={(e) => updateCondition(rule.id, ci, { value: parseFloat(e.currentTarget.value) || 0 })} class="cond-val" />
                          <span class="cond-arrow">→</span>
                          <select value={cond.adjustmentType} onchange={(e) => updateCondition(rule.id, ci, { adjustmentType: e.currentTarget.value as 'percentage' | 'fixed' })}>
                            <option value="percentage">+%</option>
                            <option value="fixed">+$</option>
                          </select>
                          <input type="number" value={cond.adjustmentValue} oninput={(e) => updateCondition(rule.id, ci, { adjustmentValue: parseFloat(e.currentTarget.value) || 0 })} class="cond-val" />
                          <button class="btn-remove-sm" onclick={() => removeCondition(rule.id, ci)}>✕</button>
                        </div>
                      {/each}
                    {/if}
                  </div>

                  <button class="btn-remove" onclick={() => removeRule(rule.id)}>✕ Eliminar regla</button>
                </div>
              {/if}
            </div>
          {:else}
            <p class="empty">No hay reglas. Creá la primera.</p>
          {/each}
        </div>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" onclick={() => appStore.showPricingRules = false}>Cerrar</button>
      <button class="btn btn-primary" onclick={saveRules} disabled={!dirty || saving}>{saving ? 'Guardando...' : '💾 Guardar Reglas'}</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .modal {
    background: var(--bg-card, #fff);
    border-radius: var(--radius-md, 0.6rem);
    width: min(95vw, 64rem);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 1rem 2rem rgba(0,0,0,0.25);
  }
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border, #ddd);
  }
  .modal-header h2 { margin: 0; font-size: 1.1rem; }
  .close { background: none; border: none; font-size: 1.2rem; cursor: pointer; color: var(--text-muted); padding: 0.2rem 0.4rem; border-radius: 0.3rem; }
  .close:hover { background: var(--bg-hover); }
  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    border-top: 1px solid var(--border, #ddd);
  }
  .btn {
    padding: 0.5rem 1rem;
    border: none;
    border-radius: var(--radius-sm, 0.35rem);
    cursor: pointer;
    font-size: 0.9rem;
    font-weight: 600;
  }
  .btn-primary { background: var(--accent, #e91e63); color: #fff; }
  .btn-primary:disabled { opacity: 0.5; cursor: default; }
  .btn-secondary { background: var(--bg-hover, #f0f0f0); color: var(--text-secondary); }

  .section-label {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    color: var(--text-muted);
    letter-spacing: 0.05em;
  }

  /* ── Test area ── */
  .test-area { display: flex; flex-direction: column; gap: 0.4rem; }
  .refs-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.75rem;
    color: var(--text-secondary);
    padding: 0.3rem 0.5rem;
    background: var(--bg-hover, #f5f5f5);
    border-radius: var(--radius-sm, 0.35rem);
  }
  .refs-loading { font-style: italic; color: var(--text-muted); }
  .refs-count { font-weight: 600; color: var(--text-primary); }
  .refs-sample { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .refs-empty { color: #ef4444; font-weight: 600; flex: 1; }
  .btn-refresh {
    background: none;
    border: 1px solid var(--border, #ddd);
    border-radius: var(--radius-sm, 0.3rem);
    cursor: pointer;
    font-size: 0.85rem;
    padding: 0.15rem 0.4rem;
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .btn-refresh:hover { background: var(--bg-card); color: var(--text-primary); }
  .test-input-wrap { display: flex; gap: 0.4rem; }
  .test-input {
    flex: 1;
    padding: 0.6rem 0.8rem;
    border: 1.5px solid var(--border, #ddd);
    border-radius: var(--radius-sm, 0.35rem);
    font-size: 1rem;
    outline: none;
  }
  .test-input:focus { border-color: var(--accent, #e91e63); }
  .test-btn {
    padding: 0.6rem 1rem;
    background: var(--accent, #e91e63);
    color: #fff;
    border: none;
    border-radius: var(--radius-sm, 0.35rem);
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }

  /* ── Steps ── */
  .steps-area { display: flex; flex-direction: column; gap: 0.4rem; }
  .steps-list {
    border: 1px solid var(--border, #ddd);
    border-radius: var(--radius-sm, 0.35rem);
    overflow: hidden;
  }
  .step {
    padding: 0.5rem 0.7rem;
    border-bottom: 1px solid var(--border-light, #eee);
    font-size: 0.85rem;
  }
  .step:last-child { border-bottom: none; }
  .step.step-success { border-left: 3px solid #22c55e; }
  .step.step-fail { border-left: 3px solid #ef4444; }
  .step-label { font-weight: 600; color: var(--text-primary); margin-bottom: 0.15rem; }
  .step-detail { color: var(--text-secondary); font-size: 0.8rem; font-family: var(--font-mono, monospace); }

  /* ── Rules ── */
  .rules-area { display: flex; flex-direction: column; gap: 0.4rem; }
  .rules-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .btn-add {
    padding: 0.35rem 0.7rem;
    background: var(--accent, #e91e63);
    color: #fff;
    border: none;
    border-radius: var(--radius-sm, 0.35rem);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
  }
  .rules-list { display: flex; flex-direction: column; gap: 0.4rem; }
  .rule-card {
    border: 1px solid var(--border, #ddd);
    border-radius: var(--radius-sm, 0.35rem);
    overflow: hidden;
    background: var(--bg-card, #fff);
  }
  .rule-card.expanded { border-color: var(--accent, #e91e63); }
  .rule-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.7rem;
    cursor: pointer;
    transition: background 0.1s;
  }
  .rule-row:hover { background: var(--bg-hover, #f5f5f5); }
  .rule-toggle { background: none; border: none; cursor: pointer; font-size: 1rem; padding: 0; }
  .rule-name { flex: 0 0 8rem; font-weight: 600; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rule-tokens { flex: 1; font-size: 0.8rem; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rule-op { flex: 0 0 5rem; font-size: 0.8rem; color: var(--text-muted); }
  .rule-val { flex: 0 0 4rem; font-size: 0.8rem; color: var(--text-muted); text-align: right; }
  .rule-expand { flex: 0 0 1.5rem; text-align: center; font-size: 0.7rem; color: var(--text-muted); }
  .empty { font-size: 0.85rem; color: var(--text-muted); font-style: italic; padding: 0.5rem 0; }

  /* ── Rule edit form ── */
  .rule-edit {
    padding: 0.7rem;
    border-top: 1px solid var(--border-light, #eee);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    background: var(--bg-page, #fafafa);
  }
  .form-row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
  .form-group { display: flex; flex-direction: column; gap: 0.2rem; flex: 1; min-width: 7rem; }
  .form-group label { font-size: 0.7rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; }
  .form-group input, .form-group select {
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--border, #ddd);
    border-radius: var(--radius-sm, 0.3rem);
    font-size: 0.85rem;
    background: var(--bg-card, #fff);
  }
  .btn-remove {
    align-self: flex-start;
    padding: 0.3rem 0.6rem;
    background: none;
    border: 1px solid #ef4444;
    color: #ef4444;
    border-radius: var(--radius-sm, 0.3rem);
    font-size: 0.75rem;
    cursor: pointer;
    font-weight: 600;
  }
  .btn-remove:hover { background: #fef2f2; }

  /* ── Conditions ── */
  .conditions-section { display: flex; flex-direction: column; gap: 0.4rem; }
  .conditions-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .conditions-header label { font-size: 0.7rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; }
  .btn-add-sm {
    padding: 0.2rem 0.5rem;
    background: none;
    border: 1px solid var(--border, #ddd);
    border-radius: var(--radius-sm, 0.3rem);
    font-size: 0.7rem;
    cursor: pointer;
    color: var(--accent, #e91e63);
    font-weight: 600;
  }
  .btn-add-sm:hover { background: var(--accent-light); }
  .no-conditions { font-size: 0.8rem; color: var(--text-muted); font-style: italic; margin: 0; }
  .condition-row {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
  }
  .condition-row select, .condition-row input {
    padding: 0.3rem 0.4rem;
    border: 1px solid var(--border, #ddd);
    border-radius: var(--radius-sm, 0.3rem);
    font-size: 0.8rem;
    background: var(--bg-card, #fff);
  }
  .cond-val { width: 4rem; }
  .cond-arrow { color: var(--text-muted); font-size: 0.8rem; }
  .btn-remove-sm {
    background: none;
    border: none;
    color: #ef4444;
    cursor: pointer;
    font-size: 0.8rem;
    padding: 0.1rem 0.3rem;
  }
</style>
