<script lang="ts">
  import { onMount } from 'svelte';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import { api } from '$lib/api/client';
  import {
    suggestPrice,
    parseQuery,
    estimationMatchesQuery,
    evaluateEstimationRule,
    explainEstimationRule,
    type PriceSuggestion,
  } from '$lib/utils/precios';
  import { refsToProductos } from '$lib/utils/precios';
  import type { PrecioReferencia, EstimationRuleRow, EstimationRulePayload, EstimationMethod } from '$lib/types';
  import { normalizeEstimationParams, defaultEstimationParams } from '$lib/types';

  let refs = $state<PrecioReferencia[]>([]);
  let loadingRefs = $state(false);
  let loadingRules = $state(true);
  let saving = $state(false);
  let rules = $state<EstimationRuleRow[]>([]);
  let testQuery = $state('corte tela 1,5 x 3');
  let testResults = $state<PriceSuggestion[]>([]);
  let testSteps = $state<{ name: string; steps: string[] }[]>([]);
  let dirty = $state(false);
  let expandedRule = $state<number | null>(null);
  let tempIdCounter = 0;

  function tempId(): number { return -(Date.now() + tempIdCounter++); }

  function rawToRows(raw: any[]): EstimationRuleRow[] {
    return raw.map((r: any) => ({
      id: Number(r.id),
      name: r.name || '',
      matchTokens: typeof (r.matchTokens ?? r.match_tokens) === 'string'
        ? JSON.parse((r.matchTokens ?? r.match_tokens) || '[]')
        : (Array.isArray(r.matchTokens ?? r.match_tokens) ? (r.matchTokens ?? r.match_tokens) : []),
      refCategoria: r.refCategoria ?? r.ref_categoria ?? '',
      refVariante: r.refVariante ?? r.ref_variante ?? '',
      refMedida: r.refMedida ?? r.ref_medida ?? '',
      method: (r.method ?? 'perimetro') as EstimationMethod,
      params: typeof r.params === 'string'
        ? normalizeEstimationParams(JSON.parse(r.params || '{}'))
        : normalizeEstimationParams(r.params || {}),
      priority: r.priority ?? 0,
      enabled: r.enabled ?? true,
    }));
  }

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

  async function loadRules() {
    loadingRules = true;
    try {
      const data = await api.getEstimationRules();
      rules = data && data.length > 0 ? rawToRows(data) : defaultRules();
    } catch {
      rules = defaultRules();
    } finally {
      loadingRules = false;
    }
  }

  onMount(() => { loadRefs(); loadRules(); });

  function defaultRules(): EstimationRuleRow[] {
    return [
      {
        id: tempId(),
        name: 'Corte tela desde rollo',
        matchTokens: ['corte tela', 'corte'],
        refCategoria: 'ROLLO DE TELA',
        refVariante: '',
        refMedida: '',
        method: 'area_m2',
        params: { ...defaultEstimationParams(), tope_lado_mayor: 300, rounding: 1000 },
        priority: 0,
        enabled: true,
      },
      {
        id: tempId(),
        name: 'Bastidor oversize',
        matchTokens: ['bastidor'],
        refCategoria: 'BASTIDOR',
        refVariante: '',
        refMedida: '',
        method: 'perimetro',
        params: { ...defaultEstimationParams(), k_vecinos: 5, tope_lado_mayor: 300, rounding: 1000 },
        priority: 10,
        enabled: true,
      },
    ];
  }

  async function saveRules() {
    saving = true;
    try {
      const existingIds = new Set(rules.filter(r => r.id > 0).map(r => r.id));
      for (const rid of existingIds) {
        try { await api.deleteEstimationRule(rid); } catch {}
      }
      const fresh: EstimationRuleRow[] = [];
      for (const rule of rules) {
        const payload: EstimationRulePayload = {
          name: rule.name,
          match_tokens: JSON.stringify(rule.matchTokens),
          ref_categoria: rule.refCategoria,
          ref_variante: rule.refVariante,
          ref_medida: rule.refMedida,
          method: rule.method,
          params: JSON.stringify(rule.params),
          priority: rule.priority,
          enabled: rule.enabled,
        };
        const saved = await api.saveEstimationRule(payload);
        fresh.push({ ...rule, id: saved.id! });
      }
      rules = rawToRows(fresh);
      dirty = false;
      cacheStore.invalidate('estimationRules');
      appStore.showToast('Reglas de estimación guardadas', 'success');
    } catch (e: any) {
      appStore.alert('Error al guardar: ' + (e?.message || ''));
    } finally {
      saving = false;
    }
  }

  function addRule() {
    const r: EstimationRuleRow = {
      id: tempId(),
      name: '',
      matchTokens: [],
      refCategoria: '',
      refVariante: '',
      refMedida: '',
      method: 'perimetro',
      params: { ...defaultEstimationParams() },
      priority: 0,
      enabled: true,
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

  function updateRule(id: number, patch: Partial<EstimationRuleRow>) {
    rules = rules.map(r => r.id === id ? { ...r, ...patch } : r);
    dirty = true;
  }

  function updateParams(id: number, patch: Partial<EstimationRuleRow['params']>) {
    rules = rules.map(r => r.id === id ? { ...r, params: { ...r.params, ...patch } } : r);
    dirty = true;
  }

  function runTest() {
    if (!testQuery.trim()) return;
    const products = refsToProductos(refs);
    testResults = suggestPrice(testQuery, products, [], rules);
    testSteps = [];
    const parsed = parseQuery(testQuery);
    const dims = parsed.dims[0]?.split('x').map(Number);
    if (dims && dims.length === 2) {
      const s = Math.min(dims[0], dims[1]);
      const l = Math.max(dims[0], dims[1]);
      for (const r of rules) {
        if (!r.enabled) continue;
        if (!estimationMatchesQuery(parsed, r)) continue;
        const { steps } = explainEstimationRule(s, l, products, r);
        testSteps.push({ name: r.name || '(sin nombre)', steps });
      }
    }
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

  function medidasFor(cat: string, vari: string): string[] {
    return [...new Set(
      refs
        .filter(r => r.categoria === cat && (!vari || r.variante === vari))
        .map(r => r.medida)
    )].sort();
  }

  function parseTokens(raw: string): string[] {
    return raw.split(',').map(t => t.trim()).filter(t => t.length > 0);
  }

  function tokensToString(tokens: string[]): string {
    return tokens.join(', ');
  }

  function methodLabel(m: EstimationMethod): string {
    return m === 'area_m2' ? 'Por m²' : m === 'lineal_mayor' ? 'Por metro lineal' : 'Por perímetro';
  }
</script>

<div class="overlay" role="presentation">
  <div class="modal" onclick={(e) => e.stopPropagation()} role="dialog">
    <div class="modal-header">
      <h2>📐 Reglas de Estimación</h2>
      <button class="close" onclick={() => appStore.showEstimationRules = false}>✕</button>
    </div>

    <div class="modal-body">
      <p class="help">
        Cada regla dice: <b>cuando el texto contiene…</b> → <b>tomá el precio de…</b> →
        <b>calculalo así</b>. Si la medida <b>pasa el tope</b>, ese estimado aparece
        <b>primero</b> en Facturación. Podés escribir en metros: <b>1,5 x 3</b> = 150×300 cm.
      </p>

      <div class="test-area">
        <label class="section-label">Probar (igual que Facturación)</label>
        <div class="test-input-wrap">
          <input
            type="text"
            bind:value={testQuery}
            onkeydown={handleTestKeydown}
            placeholder="Ej: corte tela 1,5 x 3"
            class="test-input"
          />
          <button class="test-btn" onclick={runTest}>⏎ Probar</button>
        </div>
        {#if testResults.length > 0}
          <div class="test-results">
            {#each testResults.slice(0, 6) as s, i}
              <div class="test-row" class:first={i === 0 && s.estimated}>
                <span class="t-desc">{s.basedOn || s.description}</span>
                <span class="t-price">${s.price.toLocaleString('es-AR')}</span>
                <span class="t-tag" class:est={s.estimated}>{s.estimated ? 'Estimado' : 'Sugerido'}</span>
                {#if i === 0 && s.estimated}<span class="t-first">↑ primero (pasa el tope)</span>{/if}
              </div>
            {/each}
          </div>
        {/if}
        {#if testSteps.length > 0}
          <div class="calc-box">
            <div class="calc-title">¿Cómo se calculó?</div>
            {#each testSteps as t}
              <div class="calc-rule">{t.name}</div>
              {#each t.steps as st}
                <div class="calc-step">{st}</div>
              {/each}
            {/each}
          </div>
        {/if}
      </div>

      <div class="refs-status">
        {#if loadingRefs}
          <span>Cargando referencias...</span>
        {:else}
          <span class="refs-count">{refs.length} refs</span>
          <button class="btn-refresh" onclick={() => { cacheStore.invalidate('preciosReferencia'); loadRefs(); }} title="Recargar">↻</button>
        {/if}
      </div>

      <div class="rules-area">
        <div class="rules-header">
          <label class="section-label">Reglas</label>
          <button class="btn-add" onclick={addRule}>+ Nueva regla</button>
        </div>

        <div class="rules-list">
          {#each rules as rule}
            <div class="rule-card" class:expanded={expandedRule === rule.id}>
              <div class="rule-row" onclick={() => expandedRule = expandedRule === rule.id ? null : rule.id}>
                <button class="rule-toggle" onclick={(e) => { e.stopPropagation(); updateRule(rule.id, { enabled: !rule.enabled }); }}>
                  {rule.enabled ? '✅' : '⏹'}
                </button>
                <span class="rule-name">{rule.name || '(sin nombre)'}</span>
                <span class="rule-tokens">{tokensToString(rule.matchTokens)}</span>
                <span class="rule-op">{methodLabel(rule.method)}</span>
                <span class="rule-expand">{expandedRule === rule.id ? '▲' : '▼'}</span>
              </div>

              {#if expandedRule === rule.id}
                <div class="rule-edit">
                  <div class="form-row">
                    <div class="form-group">
                      <label>Nombre</label>
                      <input type="text" value={rule.name} oninput={(e) => updateRule(rule.id, { name: e.currentTarget.value })} placeholder="Ej: Corte tela desde rollo" />
                    </div>
                    <div class="form-group">
                      <label>Se aplica cuando contiene (coma)</label>
                      <input type="text" value={tokensToString(rule.matchTokens)} oninput={(e) => updateRule(rule.id, { matchTokens: parseTokens(e.currentTarget.value) })} placeholder="corte tela, corte" />
                    </div>
                    <div class="form-group small">
                      <label>Orden</label>
                      <input type="number" value={rule.priority} oninput={(e) => updateRule(rule.id, { priority: parseInt(e.currentTarget.value) || 0 })} />
                    </div>
                  </div>

                  <div class="form-row">
                    <div class="form-group">
                      <label>Precio base tomado de</label>
                      <select value={rule.refCategoria} onchange={(e) => updateRule(rule.id, { refCategoria: e.currentTarget.value, refVariante: '', refMedida: '' })}>
                        <option value="">Seleccionar…</option>
                        {#each allCategorias() as cat}
                          <option value={cat}>{cat}</option>
                        {/each}
                      </select>
                    </div>
                    <div class="form-group">
                      <label>Variante base</label>
                      <select value={rule.refVariante} onchange={(e) => updateRule(rule.id, { refVariante: e.currentTarget.value, refMedida: '' })} disabled={!rule.refCategoria}>
                        <option value="">Todas</option>
                        {#each variantesFor(rule.refCategoria) as v}
                          <option value={v}>{v || '(sin variante)'}</option>
                        {/each}
                      </select>
                    </div>
                    <div class="form-group">
                      <label>Medida base</label>
                      <select value={rule.refMedida} onchange={(e) => updateRule(rule.id, { refMedida: e.currentTarget.value })} disabled={!rule.refCategoria}>
                        <option value="">Automática</option>
                        {#each medidasFor(rule.refCategoria, rule.refVariante) as m}
                          <option value={m}>{m}</option>
                        {/each}
                      </select>
                    </div>
                    <div class="form-group">
                      <label>Cómo se calcula</label>
                      <select value={rule.method} onchange={(e) => updateRule(rule.id, { method: e.currentTarget.value as EstimationMethod })}>
                        <option value="area_m2">Por m² (telas)</option>
                        <option value="lineal_mayor">Por metro lineal (rollos)</option>
                        <option value="perimetro">Por perímetro (bastidores)</option>
                      </select>
                    </div>
                  </div>

                  <div class="form-row">
                    <div class="form-group small">
                      <label>Tope en cm</label>
                      <input type="number" value={rule.params.tope_lado_mayor ?? 300} oninput={(e) => updateParams(rule.id, { tope_lado_mayor: parseFloat(e.currentTarget.value) || 0 })} title="Hasta este lado mayor usa precio de lista; si lo pasa, estima y va primero" />
                    </div>
                    <div class="form-group small">
                      <label>Extra % si pasa el tope</label>
                      <input type="number" value={rule.params.recargo_oversize_pct ?? 0} oninput={(e) => updateParams(rule.id, { recargo_oversize_pct: parseFloat(e.currentTarget.value) || 0 })} />
                    </div>
                    <div class="form-group small">
                      <label>Ganancia %</label>
                      <input type="number" value={rule.params.margen_pct ?? 0} oninput={(e) => updateParams(rule.id, { margen_pct: parseFloat(e.currentTarget.value) || 0 })} />
                    </div>
                    <div class="form-group small">
                      <label>Desperdicio %</label>
                      <input type="number" value={rule.params.desperdicio_pct ?? 0} oninput={(e) => updateParams(rule.id, { desperdicio_pct: parseFloat(e.currentTarget.value) || 0 })} title="Recortes que se pierden al cortar" />
                    </div>
                    <div class="form-group small">
                      <label>No cobrar menos de $</label>
                      <input type="number" value={rule.params.minimo ?? 0} oninput={(e) => updateParams(rule.id, { minimo: parseFloat(e.currentTarget.value) || 0 })} />
                    </div>
                    <div class="form-group small">
                      <label>Redondeo</label>
                      <select value={rule.params.rounding ?? 1000} onchange={(e) => updateParams(rule.id, { rounding: parseInt(e.currentTarget.value) })}>
                        <option value={0}>Sin redondeo</option>
                        <option value={100}>$100</option>
                        <option value={500}>$500</option>
                        <option value={1000}>$1.000</option>
                        <option value={5000}>$5.000</option>
                      </select>
                    </div>
                  </div>

                  <details class="advanced">
                    <summary>Opciones avanzadas</summary>
                    <div class="form-row">
                      {#if rule.method === 'perimetro'}
                        <div class="form-group small">
                          <label>Refs a promediar</label>
                          <input type="number" min="1" max="20" value={rule.params.k_vecinos ?? 5} oninput={(e) => updateParams(rule.id, { k_vecinos: parseInt(e.currentTarget.value) || 5 })} />
                        </div>
                      {:else if rule.method === 'area_m2'}
                        <div class="form-group">
                          <label>$ por m² fijo (vacío = lo saca de la ref)</label>
                          <input type="number" value={rule.params.precio_m2_manual ?? ''} placeholder="Ej: 19700" oninput={(e) => updateParams(rule.id, { precio_m2_manual: e.currentTarget.value === '' ? null : parseFloat(e.currentTarget.value) || null })} />
                        </div>
                      {:else}
                        <div class="form-group">
                          <label>$ por metro fijo (vacío = lo saca de la ref)</label>
                          <input type="number" value={rule.params.precio_m_lineal_manual ?? ''} placeholder="Ej: 39400" oninput={(e) => updateParams(rule.id, { precio_m_lineal_manual: e.currentTarget.value === '' ? null : parseFloat(e.currentTarget.value) || null })} />
                        </div>
                      {/if}
                    </div>
                  </details>

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
      <button class="btn btn-secondary" onclick={() => appStore.showEstimationRules = false}>Cerrar</button>
      <button class="btn btn-primary" onclick={saveRules} disabled={!dirty || saving}>{saving ? 'Guardando...' : '💾 Guardar'}</button>
    </div>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center; z-index: 1000; }
  .modal { background: var(--bg-card, #fff); border-radius: 0.6rem; width: min(95vw, 60rem); max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 1rem 2rem rgba(0,0,0,0.25); }
  .modal-header { display: flex; justify-content: space-between; align-items: center; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border, #ddd); }
  .modal-header h2 { margin: 0; font-size: 1.1rem; }
  .close { background: none; border: none; font-size: 1.2rem; cursor: pointer; color: var(--text-muted); }
  .modal-body { flex: 1; overflow-y: auto; padding: 1rem 1.25rem; display: flex; flex-direction: column; gap: 1rem; }
  .modal-footer { display: flex; justify-content: flex-end; gap: 0.5rem; padding: 0.75rem 1.25rem; border-top: 1px solid var(--border, #ddd); }
  .btn { padding: 0.5rem 1rem; border: none; border-radius: 0.35rem; cursor: pointer; font-size: 0.9rem; font-weight: 600; }
  .btn-primary { background: var(--accent, #e91e63); color: #fff; }
  .btn-primary:disabled { opacity: 0.5; cursor: default; }
  .btn-secondary { background: var(--bg-hover, #f0f0f0); color: var(--text-secondary); }
  .section-label { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.05em; }
  .help { font-size: 0.85rem; color: var(--text-secondary); margin: 0; line-height: 1.5; }
  .test-area { display: flex; flex-direction: column; gap: 0.4rem; }
  .test-input-wrap { display: flex; gap: 0.4rem; }
  .test-input { flex: 1; padding: 0.6rem 0.8rem; border: 1.5px solid var(--border, #ddd); border-radius: 0.35rem; font-size: 1rem; }
  .test-btn { padding: 0.6rem 1rem; background: var(--accent, #e91e63); color: #fff; border: none; border-radius: 0.35rem; font-weight: 600; cursor: pointer; }
  .test-results { border: 1px solid var(--border, #ddd); border-radius: 0.35rem; overflow: hidden; }
  .test-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.45rem 0.6rem; font-size: 0.85rem; border-bottom: 1px solid var(--border-light, #eee); }
  .test-row:last-child { border-bottom: none; }
  .test-row.first { background: #fffbeb; }
  .t-desc { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t-price { font-weight: 700; }
  .t-tag { font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 1rem; background: #e0e7ff; }
  .t-tag.est { background: #fef3c7; }
  .t-first { font-size: 0.7rem; color: #b45309; font-weight: 700; }
  .refs-status { display: flex; align-items: center; gap: 0.5rem; font-size: 0.75rem; padding: 0.3rem 0.5rem; background: var(--bg-hover, #f5f5f5); border-radius: 0.35rem; }
  .refs-count { font-weight: 600; }
  .btn-refresh { background: none; border: 1px solid var(--border, #ddd); border-radius: 0.3rem; cursor: pointer; padding: 0.15rem 0.4rem; }
  .rules-header { display: flex; justify-content: space-between; align-items: center; }
  .btn-add { padding: 0.35rem 0.7rem; background: var(--accent, #e91e63); color: #fff; border: none; border-radius: 0.35rem; font-size: 0.8rem; font-weight: 600; cursor: pointer; }
  .rules-list { display: flex; flex-direction: column; gap: 0.4rem; }
  .rule-card { border: 1px solid var(--border, #ddd); border-radius: 0.35rem; overflow: hidden; }
  .rule-card.expanded { border-color: var(--accent, #e91e63); }
  .rule-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.7rem; cursor: pointer; }
  .rule-row:hover { background: var(--bg-hover, #f5f5f5); }
  .rule-toggle { background: none; border: none; cursor: pointer; font-size: 1rem; padding: 0; }
  .rule-name { flex: 0 0 10rem; font-weight: 600; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rule-tokens { flex: 1; font-size: 0.8rem; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rule-op { flex: 0 0 7rem; font-size: 0.8rem; color: var(--text-muted); text-align: right; }
  .rule-expand { flex: 0 0 1.5rem; text-align: center; font-size: 0.7rem; color: var(--text-muted); }
  .rule-edit { padding: 0.7rem; border-top: 1px solid var(--border-light, #eee); display: flex; flex-direction: column; gap: 0.6rem; background: var(--bg-page, #fafafa); }
  .form-row { display: flex; gap: 0.6rem; flex-wrap: wrap; }
  .form-group { display: flex; flex-direction: column; gap: 0.2rem; flex: 1; min-width: 8rem; }
  .form-group.small { min-width: 6rem; flex: 0 1 8rem; }
  .form-group label { font-size: 0.7rem; font-weight: 600; color: var(--text-muted); text-transform: uppercase; }
  .form-group input, .form-group select { padding: 0.4rem 0.5rem; border: 1px solid var(--border, #ddd); border-radius: 0.3rem; font-size: 0.85rem; }
  .btn-remove { align-self: flex-start; padding: 0.3rem 0.6rem; background: none; border: 1px solid #ef4444; color: #ef4444; border-radius: 0.3rem; font-size: 0.75rem; cursor: pointer; font-weight: 600; }
  .empty { font-size: 0.85rem; color: var(--text-muted); font-style: italic; }
  .calc-box { border: 1px dashed var(--border, #ddd); border-radius: 0.35rem; padding: 0.5rem 0.7rem; background: #fffbeb; display: flex; flex-direction: column; gap: 0.15rem; }
  .calc-title { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: #b45309; letter-spacing: 0.05em; }
  .calc-rule { font-size: 0.8rem; font-weight: 700; color: var(--text-primary); margin-top: 0.3rem; }
  .calc-step { font-size: 0.8rem; color: var(--text-secondary); font-family: var(--font-mono, monospace); padding-left: 0.8rem; }
  .advanced { border: 1px solid var(--border-light, #eee); border-radius: 0.3rem; padding: 0.4rem 0.6rem; }
  .advanced summary { cursor: pointer; font-size: 0.8rem; font-weight: 600; color: var(--text-muted); }
  .advanced .form-row { margin-top: 0.5rem; }
</style>
