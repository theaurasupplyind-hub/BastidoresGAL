<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';

  let { onclose }: { onclose: () => void } = $props();

  interface FodaItem { id: number; texto: string; }
  type QuadrantKey = 'fortalezas' | 'oportunidades' | 'debilidades' | 'amenazas';

  const QUADRANTS: { key: QuadrantKey; letter: string; title: string; desc: string; color: string; soft: string }[] = [
    { key: 'fortalezas', letter: 'F', title: 'Fortalezas', desc: 'Cualidades, habilidades y recursos internos que hacen destacar a la empresa.', color: '#00b8e6', soft: 'rgba(0,184,230,0.10)' },
    { key: 'oportunidades', letter: 'O', title: 'Oportunidades', desc: 'Situaciones, circunstancias o recursos del entorno que la empresa puede aprovechar.', color: '#8b00b8', soft: 'rgba(139,0,184,0.08)' },
    { key: 'debilidades', letter: 'D', title: 'Debilidades', desc: 'Áreas de mejora, limitaciones o aspectos internos que pueden obstaculizar el desarrollo de la empresa.', color: '#00b3a4', soft: 'rgba(0,179,164,0.10)' },
    { key: 'amenazas', letter: 'A', title: 'Amenazas', desc: 'Obstáculos, riesgos o situaciones del entorno que pueden afectar a la empresa.', color: '#8fd400', soft: 'rgba(143,212,0,0.12)' },
  ];

  let items = $state<Record<QuadrantKey, FodaItem[]>>({ fortalezas: [], oportunidades: [], debilidades: [], amenazas: [] });
  let drafts = $state<Record<QuadrantKey, string>>({ fortalezas: '', oportunidades: '', debilidades: '', amenazas: '' });
  let nextId = $state(1);
  let selected = $state<QuadrantKey | null>(null);
  let saveState = $state<'idle' | 'saving' | 'saved' | 'local'>('idle');
  let loading = $state(true);
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let printRoot = $state<HTMLDivElement | null>(null);

  // ── Semicírculo FODA (donut superior dividido en 4) ──
  const CX = 200, CY = 205, R_OUT = 190, R_IN = 108;
  const ANGLES: Record<QuadrantKey, [number, number]> = {
    fortalezas: [180, 135], oportunidades: [135, 90], debilidades: [90, 45], amenazas: [45, 0],
  };
  function pt(r: number, deg: number) {
    const rad = (deg * Math.PI) / 180;
    return [CX + r * Math.cos(rad), CY - r * Math.sin(rad)] as const;
  }
  function segPath(key: QuadrantKey): string {
    const [a0, a1] = ANGLES[key];
    const [x0, y0] = pt(R_OUT, a0);
    const [x1, y1] = pt(R_OUT, a1);
    const [x2, y2] = pt(R_IN, a1);
    const [x3, y3] = pt(R_IN, a0);
    return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${R_OUT} ${R_OUT} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)} A ${R_IN} ${R_IN} 0 0 0 ${x3.toFixed(1)} ${y3.toFixed(1)} Z`;
  }
  function labelPos(key: QuadrantKey) {
    const [a0, a1] = ANGLES[key];
    const [x, y] = pt((R_OUT + R_IN) / 2, (a0 + a1) / 2);
    return { x, y };
  }

  function snapshot() {
    return {
      fortalezas: items.fortalezas.map(i => i.texto),
      oportunidades: items.oportunidades.map(i => i.texto),
      debilidades: items.debilidades.map(i => i.texto),
      amenazas: items.amenazas.map(i => i.texto),
    };
  }

  function persistLocal() {
    try { localStorage.setItem('foda-items', JSON.stringify(snapshot())); } catch {}
  }

  function scheduleSave() {
    persistLocal();
    if (saveTimer) clearTimeout(saveTimer);
    saveState = 'saving';
    saveTimer = setTimeout(async () => {
      try {
        await api.saveFoda(snapshot());
        saveState = 'saved';
        setTimeout(() => { if (saveState === 'saved') saveState = 'idle'; }, 1500);
      } catch {
        saveState = 'local';
      }
    }, 800);
  }

  onMount(async () => {
    let data: Record<QuadrantKey, string[]> | null = null;
    try {
      data = await api.getFoda();
    } catch {
      try {
        const raw = localStorage.getItem('foda-items');
        if (raw) data = JSON.parse(raw);
      } catch {}
    }
    if (data) {
      for (const q of QUADRANTS) {
        const arr = Array.isArray((data as any)[q.key]) ? (data as any)[q.key] : [];
        items[q.key] = arr.filter((t: unknown) => typeof t === 'string' && (t as string).trim()).map((t: string) => ({ id: nextId++, texto: t }));
      }
    }
    loading = false;
  });

  function addItem(key: QuadrantKey) {
    const t = drafts[key].trim();
    if (!t) return;
    drafts[key] = '';
    items[key] = [...items[key], { id: nextId++, texto: t }];
    scheduleSave();
  }

  function removeItem(key: QuadrantKey, id: number) {
    items[key] = items[key].filter(i => i.id !== id);
    scheduleSave();
  }

  function totalCount() {
    return items.fortalezas.length + items.oportunidades.length + items.debilidades.length + items.amenazas.length;
  }

  function handleKey(e: KeyboardEvent, key: QuadrantKey) {
    if (e.key === 'Enter') addItem(key);
  }

  function closeOnOverlay(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose();
  }

  function handleEsc(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }

  function printFoda() {
    if (!printRoot) return;
    const w = window.open('', '_blank', 'width=800,height=900');
    if (!w) { appStore.showToast('El navegador bloqueó la ventana de impresión', 'error'); return; }
    const rows = QUADRANTS.map(q => {
      const lis = items[q.key].map(i => `<li>${escapeHtml(i.texto)}</li>`).join('') || '<li class="empty">— Sin elementos —</li>';
      return `<section style="border-top:4px solid ${q.color};padding:10px 4px;"><h2 style="color:${q.color};margin:0 0 6px;">${q.letter} · ${q.title}</h2><p style="color:#555;font-size:12px;margin:0 0 8px;">${q.desc}</p><ul>${lis}</ul></section>`;
    }).join('');
    w.document.write(`<html><head><title>Análisis FODA</title><style>body{font-family:system-ui,sans-serif;max-width:640px;margin:24px auto;padding:0 16px;color:#111}h1{text-align:center}ul{margin:0;padding-left:20px}li{margin:3px 0}.empty{color:#999;list-style:none}</style></head><body><h1>Análisis FODA</h1><p style="text-align:center;color:#666">Total de elementos: ${totalCount()}</p>${rows}<script>onload=()=>{print();}<\/script></body></html>`);
    w.document.close();
  }

  function escapeHtml(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
</script>

<svelte:window onkeydown={handleEsc} />

<div class="foda-overlay" onclick={closeOnOverlay} role="presentation">
  <div class="foda-modal" role="dialog" aria-label="Análisis FODA" bind:this={printRoot}>
    <div class="foda-header">
      <div class="foda-title">
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2A10 10 0 0 0 2 12h6a4 4 0 0 1 4 4v6A10 10 0 0 0 12 2z" fill="#00b8e6"/><path d="M12 2A10 10 0 0 1 22 12h-6a4 4 0 0 0-4-4V2z" fill="#8b00b8"/><path d="M16 12a4 4 0 0 0-4 4v6a10 10 0 0 0 10-10h-6z" fill="#00b3a4" opacity="0.9"/><path d="M12 12a4 4 0 0 0-4 4H2a10 10 0 0 0 10 10v-6a4 4 0 0 1 0-8z" fill="#8fd400" opacity="0.9"/></svg>
        <h2>Análisis FODA</h2>
      </div>
      <div class="foda-header-actions">
        {#if saveState === 'saving'}
          <span class="save-hint">Guardando…</span>
        {:else if saveState === 'saved'}
          <span class="save-hint ok">Guardado ☁️</span>
        {:else if saveState === 'local'}
          <span class="save-hint warn">Solo local</span>
        {/if}
        <button class="foda-btn" onclick={printFoda} title="Imprimir FODA">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          Imprimir
        </button>
        <button class="foda-close" onclick={onclose} aria-label="Cerrar">✕</button>
      </div>
    </div>

{#snippet quad(q: { key: QuadrantKey; letter: string; title: string; desc: string; color: string; soft: string })}
  <section
    class="quad"
    class:dim={selected && selected !== q.key}
    style="--qc:{q.color};--qs:{q.soft}"
    aria-label={q.title}
  >
    <header>
      <span class="q-letter">{q.letter}</span>
      <div>
        <h3>{q.title}</h3>
        <p>{q.desc}</p>
      </div>
      <span class="q-count">{items[q.key].length}</span>
    </header>
    <ul>
      {#each items[q.key] as it (it.id)}
        <li>
          <span>{it.texto}</span>
          <button class="q-del" onclick={() => removeItem(q.key, it.id)} aria-label="Eliminar">✕</button>
        </li>
      {/each}
      {#if items[q.key].length === 0}
        <li class="q-empty">Sin elementos todavía…</li>
      {/if}
    </ul>
    <div class="q-add">
      <input
        type="text"
        placeholder="Agregar {q.title.toLowerCase()}…"
        bind:value={drafts[q.key]}
        onkeydown={(e) => handleKey(e, q.key)}
        aria-label="Agregar {q.title}"
      />
      <button onclick={() => addItem(q.key)} aria-label="Agregar">+</button>
    </div>
  </section>
{/snippet}

    {#if loading}
      <div class="foda-loading">Cargando FODA…</div>
    {:else}
      <div class="foda-body">
        <div class="foda-side">
          {@render quad(QUADRANTS[0])}
          {@render quad(QUADRANTS[1])}
        </div>

        <div class="foda-chart">
          <svg viewBox="0 0 400 225" class="foda-svg" role="img" aria-label="Gráfico FODA. Click en un segmento para resaltar su cuadrante.">
            <title>Click en un segmento para resaltar su cuadrante</title>
            {#each QUADRANTS as q}
              {@const p = labelPos(q.key)}
              <g
                class="seg"
                class:active={selected === q.key}
                onclick={() => selected = selected === q.key ? null : q.key}
                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selected = selected === q.key ? null : q.key; } }}
                tabindex="0" role="button" aria-label={q.title}
              >
                <path d={segPath(q.key)} fill={q.color} stroke="#fff" stroke-width="3" />
                <text x={p.x} y={p.y + 14} text-anchor="middle" font-size="44" font-weight="800" fill="#fff">{q.letter}</text>
              </g>
            {/each}
            <g>
              <circle cx={CX} cy={CY} r="86" fill="#fff" stroke="#e5e7eb" stroke-width="6" />
              <circle cx={CX} cy={CY} r="72" fill="#f3f4f6" />
              <text x={CX} y={CY - 2} text-anchor="middle" font-size="21" font-weight="800" fill="#1f2937">Análisis</text>
              <text x={CX} y={CY + 30} text-anchor="middle" font-size="32" font-weight="900" fill="#1f2937">foda</text>
            </g>
          </svg>
          <div class="foda-legend">
            {#each QUADRANTS as q}
              <button class="legend-item" class:active={selected === q.key} onclick={() => selected = selected === q.key ? null : q.key}>
                <span class="dot" style="background:{q.color}"></span>
                {q.title} <b>({items[q.key].length})</b>
              </button>
            {/each}
          </div>
        </div>

        <div class="foda-side">
          {@render quad(QUADRANTS[2])}
          {@render quad(QUADRANTS[3])}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .foda-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.45);
    display: flex; align-items: center; justify-content: center;
    z-index: 1100; padding: 1.2rem;
  }
  .foda-modal {
    background: var(--bg-card, #fff); color: var(--text-primary, #111827);
    border-radius: 1rem; width: min(1220px, 96vw); max-height: 90vh;
    display: flex; flex-direction: column; overflow: hidden;
    box-shadow: 0 12px 48px rgba(0,0,0,0.25);
  }
  .foda-header {
    display: flex; align-items: center; justify-content: space-between;
    gap: 1rem; padding: 1rem 1.25rem; border-bottom: 1px solid var(--border-light, #e5e7eb);
    flex-shrink: 0;
  }
  .foda-title { display: flex; align-items: center; gap: 0.7rem; }
  .foda-title h2 { margin: 0; font-size: 1.25rem; }
  .foda-header-actions { display: flex; align-items: center; gap: 0.5rem; }
  .save-hint { font-size: 0.75rem; color: var(--text-muted, #9ca3af); }
  .save-hint.ok { color: #16a34a; }
  .save-hint.warn { color: #d97706; }
  .foda-btn {
    display: inline-flex; align-items: center; gap: 0.35rem;
    padding: 0.4rem 0.8rem; border: 1px solid var(--border, #e5e7eb); border-radius: 0.45rem;
    background: var(--bg-card, #fff); color: var(--text-primary, #111827);
    font-size: 0.85rem; font-weight: 600; cursor: pointer;
  }
  .foda-btn:hover { background: var(--bg-hover, #f3f4f6); }
  .foda-close {
    background: none; border: none; cursor: pointer; font-size: 1rem;
    color: var(--text-muted, #9ca3af); padding: 0.3rem 0.5rem; border-radius: 0.35rem;
  }
  .foda-close:hover { color: #ef4444; background: rgba(239,68,68,0.08); }
  .foda-loading { padding: 3rem; text-align: center; color: var(--text-muted, #9ca3af); }
  .foda-body {
    display: grid; grid-template-columns: 1fr 330px 1fr; gap: 1rem;
    padding: 1rem 1.25rem; overflow: auto; align-items: start;
  }
  .foda-side { display: flex; flex-direction: column; gap: 0.75rem; min-width: 0; }
  .foda-chart { display: flex; flex-direction: column; gap: 0.75rem; position: sticky; top: 0; }
  .foda-svg { width: 100%; height: auto; }
  .seg { cursor: pointer; transition: opacity 0.15s, transform 0.15s; opacity: 0.92; }
  .seg:hover { opacity: 1; }
  .seg.active path { stroke: #111827; stroke-width: 4; }
  .seg:focus-visible { outline: 2px solid var(--border-focus, #2563eb); outline-offset: 2px; }
  .foda-legend { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .legend-item {
    display: inline-flex; align-items: center; gap: 0.3rem;
    border: 1px solid var(--border-light, #e5e7eb); background: var(--bg-card, #fff);
    border-radius: 1rem; padding: 0.25rem 0.6rem; font-size: 0.75rem; cursor: pointer;
    color: var(--text-secondary, #4b5563);
  }
  .legend-item.active { border-color: var(--text-primary, #111827); font-weight: 700; }
  .dot { width: 0.6rem; height: 0.6rem; border-radius: 50%; display: inline-block; }
  .quad {
    border: 1px solid var(--border-light, #e5e7eb); border-top: 4px solid var(--qc);
    border-radius: 0.6rem; background: var(--qs); padding: 0.7rem;
    display: flex; flex-direction: column; gap: 0.5rem; min-width: 0;
    transition: opacity 0.15s;
  }
  .quad.dim { opacity: 0.45; }
  .quad header { display: flex; gap: 0.55rem; align-items: flex-start; }
  .q-letter {
    flex-shrink: 0; width: 1.9rem; height: 1.9rem; border-radius: 0.45rem;
    background: var(--qc); color: #fff; font-weight: 800;
    display: flex; align-items: center; justify-content: center; font-size: 1.05rem;
  }
  .quad h3 { margin: 0; font-size: 0.95rem; color: var(--qc); }
  .quad p { margin: 0.1rem 0 0; font-size: 0.72rem; color: var(--text-secondary, #4b5563); line-height: 1.35; }
  .q-count {
    margin-left: auto; flex-shrink: 0; font-size: 0.72rem; font-weight: 700;
    background: var(--bg-card, #fff); border: 1px solid var(--border-light, #e5e7eb);
    border-radius: 1rem; padding: 0.1rem 0.5rem; color: var(--text-secondary, #4b5563);
  }
  .quad ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; max-height: 9rem; overflow: auto; }
  .quad li {
    display: flex; align-items: center; gap: 0.4rem;
    background: var(--bg-card, #fff); border: 1px solid var(--border-light, #e5e7eb);
    border-radius: 0.4rem; padding: 0.3rem 0.5rem; font-size: 0.82rem;
  }
  .quad li span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .q-empty { color: var(--text-muted, #9ca3af); font-style: italic; font-size: 0.78rem; border-style: dashed; }
  .q-del { background: none; border: none; cursor: pointer; color: var(--text-muted, #9ca3af); font-size: 0.75rem; padding: 0.1rem 0.3rem; border-radius: 0.3rem; }
  .q-del:hover { color: #ef4444; background: rgba(239,68,68,0.08); }
  .q-add { display: flex; gap: 0.35rem; }
  .q-add input {
    flex: 1; min-width: 0; padding: 0.4rem 0.55rem; font-size: 0.82rem;
    border: 1px solid var(--border, #d0d3d9); border-radius: 0.4rem;
    background: var(--bg-card, #fff); color: var(--text-primary, #111827);
  }
  .q-add button {
    flex-shrink: 0; width: 2rem; border: none; border-radius: 0.4rem;
    background: var(--qc); color: #fff; font-size: 1.1rem; font-weight: 700; cursor: pointer;
  }
  .q-add button:hover { filter: brightness(0.92); }
  @media (max-width: 900px) {
    .foda-body { grid-template-columns: 1fr; }
    .foda-chart { position: static; order: -1; }
  }
</style>
