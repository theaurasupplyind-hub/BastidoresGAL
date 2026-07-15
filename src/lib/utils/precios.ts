import type { PrecioReferencia, Producto, PricingRule, ParsedQuery, RuleCondition } from '$lib/types';

export interface PriceSuggestion {
  description: string;
  price: number;
  basedOn?: string;
  suggested: boolean;
  category?: string;
  estimated?: boolean;
  hint?: string;
}

// ── Normalización (acentos, separadores, espacios) ──

export function normalizeText(text: string): string {
  let t = text.toLowerCase().trim();
  t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  t = t.replace(/(\d)\s*[xX*×]\s*(\d)/g, '$1x$2');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function extractDims(text: string): Set<string> {
  const dimRegex = /(\d+(?:[.,]\d+)?)x(\d+(?:[.,]\d+)?)/g;
  const dims = new Set<string>();
  let m;
  while ((m = dimRegex.exec(text)) !== null) {
    const d1 = parseFloat(m[1].replace(',', '.'));
    const d2 = parseFloat(m[2].replace(',', '.'));
    const sorted = [Math.min(d1, d2), Math.max(d1, d2)];
    dims.add(`${sorted[0]}x${sorted[1]}`);
  }
  return dims;
}

export function getBaseAndDims(text: string): { base: string; dims: Set<string> } {
  const norm = normalizeText(text);
  const dims = extractDims(norm);
  const base = norm.replace(/\d+x\d+/g, '').replace(/\s+/g, ' ').trim();
  return { base, dims };
}

// ── Parseo de query con grosor (triple dim: 40x50x5) ──

export function parseQuery(query: string): ParsedQuery {
  const norm = normalizeText(query);
  const tripleRegex = /(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)(?:\s*x\s*(\d+(?:[.,]\d+)?))?/;
  const m = norm.match(tripleRegex);
  let dims: string[] = [];
  let grosor: number | null = null;
  if (m) {
    const d1 = parseFloat(m[1].replace(',', '.'));
    const d2 = parseFloat(m[2].replace(',', '.'));
    dims.push(`${Math.min(d1, d2)}x${Math.max(d1, d2)}`);
    if (m[3] !== undefined) {
      grosor = parseFloat(m[3].replace(',', '.'));
    }
  }
  const base = dims.length > 0 ? norm.replace(tripleRegex, '').trim() : norm;
  const tokens = base.split(/\s+/).filter(t => t.length > 0);
  return { tokens, dims, base, grosor };
}

// ── Evaluación de reglas (paso a paso para UI) ──

export interface RuleEvalStep {
  type: 'parse' | 'lookup' | 'rule' | 'condition' | 'result';
  label: string;
  detail: string;
  success?: boolean;
}

interface FindRefResult {
  ref: PrecioReferencia;
  price: number;
  candidates: PrecioReferencia[];
}

function findRefPrice(
  dims: string[],
  refs: PrecioReferencia[],
  categoria: string,
  variante: string,
): FindRefResult | null {
  if (dims.length === 0) return null;
  const dimPair = dims[0];
  const [ds, dl] = dimPair.split('x').map(Number);
  const rds = roundDim(ds);
  const rdl = roundDim(dl);

  const candidates = refs.filter(r =>
    r.categoria.toUpperCase() === categoria.toUpperCase() &&
    r.variante.toUpperCase() === variante.toUpperCase()
  );
  if (candidates.length === 0) return null;

  const measureDims = (medida: string): { s: number; l: number } | null => {
    const norm = normalizeText(medida);
    const p = norm.match(/(\d+)x(\d+)/);
    if (!p) return null;
    const a = parseFloat(p[1]), b = parseFloat(p[2]);
    return { s: Math.min(a, b), l: Math.max(a, b) };
  };

  const exact = candidates.find(c => {
    const md = measureDims(c.medida);
    return md && md.s === rds && md.l === rdl;
  });
  if (exact) return { ref: exact, price: exact.precio, candidates };

  const targetPerim = 2 * (rds + rdl);
  let best: PrecioReferencia | null = null;
  let bestDiff = Infinity;
  for (const c of candidates) {
    const md = measureDims(c.medida);
    if (!md) continue;
    const perim = 2 * (md.s + md.l);
    const diff = Math.abs(perim - targetPerim);
    if (diff < bestDiff) { bestDiff = diff; best = c; }
  }
  if (!best) return null;
  return { ref: best, price: best.precio, candidates };
}

export function evaluateRules(
  query: string,
  refs: PrecioReferencia[],
  rules: PricingRule[],
): RuleEvalStep[] {
  const steps: RuleEvalStep[] = [];
  const parsed = parseQuery(query);

  // 1. Parseo
  steps.push({
    type: 'parse',
    label: 'Parseo del texto',
    detail: `Tokens: [${parsed.tokens.join(', ')}]  |  Medidas: ${parsed.dims.join(', ') || '(ninguna)'}  |  Grosor: ${parsed.grosor !== null ? parsed.grosor + 'cm' : '(ninguno)'}`,
    success: true,
  });

  if (parsed.dims.length === 0) {
    steps.push({ type: 'result', label: 'Sin medidas', detail: 'No se detectaron dimensiones (ej: 40x50) en el texto', success: false });
    return steps;
  }

  // 2. Evaluar cada regla
  const enabled = rules.filter(r => r.enabled);
  if (enabled.length === 0) {
    steps.push({ type: 'result', label: 'Sin reglas', detail: 'No hay reglas habilitadas', success: false });
    return steps;
  }

  let ruleApplied = false;
  for (const rule of enabled) {
    const matchedToken = parsed.tokens.find(t =>
      rule.matchTokens.some(mt => t.includes(mt) || mt.includes(t))
    );
    if (!matchedToken) continue;
    ruleApplied = true;

    steps.push({
      type: 'rule',
      label: `Regla "${rule.name}" aplicada`,
      detail: `Match por token "${matchedToken}" → busca ${rule.baseCategoria} / ${rule.baseVariante}`,
      success: true,
    });

    // 3. Buscar precio base
    const catsInRefs = refs.filter(r => r.categoria.toUpperCase() === rule.baseCategoria.toUpperCase());
    const varsInRefs = catsInRefs.filter(r => r.variante.toUpperCase() === rule.baseVariante.toUpperCase());
    if (catsInRefs.length === 0) {
      steps.push({
        type: 'lookup',
        label: 'Búsqueda en precios de referencia',
        detail: `❌ No existe la categoría "${rule.baseCategoria}" en ningún precio de referencia. Categorías disponibles: ${[...new Set(refs.map(r => r.categoria))].join(', ')}`,
        success: false,
      });
      continue;
    }
    if (varsInRefs.length === 0) {
      steps.push({
        type: 'lookup',
        label: 'Búsqueda en precios de referencia',
        detail: `❌ La categoría "${rule.baseCategoria}" existe (${catsInRefs.length} refs) pero ninguna con variante "${rule.baseVariante}". Variantes disponibles: ${[...new Set(catsInRefs.map(r => r.variante))].join(', ')}`,
        success: false,
      });
      continue;
    }
    const found = findRefPrice(parsed.dims, refs, rule.baseCategoria, rule.baseVariante);
    if (!found) {
      const dimSamples = varsInRefs.filter(r => /^\d+\s*x\s*\d+$/i.test(r.medida)).slice(0, 5).map(r => r.medida.trim());
      steps.push({
        type: 'lookup',
        label: 'Búsqueda en precios de referencia',
        detail: `❌ ${varsInRefs.length} refs con ${rule.baseCategoria} / ${rule.baseVariante}, pero ninguno con medidas cercanas a ${parsed.dims[0]}. Medidas disponibles: ${dimSamples.length > 0 ? dimSamples.join(', ') : '(ninguna con formato AxB)'}`,
        success: false,
      });
      continue;
    }
    steps.push({
      type: 'lookup',
      label: 'Precio base encontrado',
      detail: `${found.ref.categoria} / ${found.ref.variante} / ${found.ref.medida} → $${found.price.toLocaleString('es-AR')}`,
      success: true,
    });

    let currentPrice = found.price;

    // 4. Aplicar operación de la regla
    let opLabel = '';
    if (rule.operation === 'direct') {
      opLabel = 'Uso directo';
    } else if (rule.operation === 'percentage') {
      const amt = Math.round(currentPrice * rule.operationValue / 100);
      opLabel = `${rule.operationValue >= 0 ? '+' : ''}${rule.operationValue}% ($${amt.toLocaleString('es-AR')})`;
      currentPrice = currentPrice + amt;
    } else if (rule.operation === 'fixed') {
      opLabel = `${rule.operationValue >= 0 ? '+' : ''}$${rule.operationValue.toLocaleString('es-AR')}`;
      currentPrice = currentPrice + rule.operationValue;
    } else if (rule.operation === 'override') {
      opLabel = `Sobreescribe a $${rule.operationValue.toLocaleString('es-AR')}`;
      currentPrice = rule.operationValue;
    }
    steps.push({
      type: 'rule',
      label: `Operación: ${opLabel}`,
      detail: `$${found.price.toLocaleString('es-AR')} → $${currentPrice.toLocaleString('es-AR')}`,
      success: true,
    });

    // 5. Evaluar condiciones
    for (const cond of rule.conditions) {
      let actual: number | null = null;
      let condLabel = '';
      if (cond.field === 'grosor') {
        actual = parsed.grosor;
        condLabel = 'Grosor';
      } else if (cond.field === 'lado_mayor') {
        const p = parsed.dims[0]?.split('x').map(Number);
        actual = p ? Math.max(p[0], p[1]) : null;
        condLabel = 'Lado mayor';
      } else if (cond.field === 'lado_menor') {
        const p = parsed.dims[0]?.split('x').map(Number);
        actual = p ? Math.min(p[0], p[1]) : null;
        condLabel = 'Lado menor';
      }

      let met = false;
      if (actual !== null) {
        if (cond.operator === '>') met = actual > cond.value;
        else if (cond.operator === '>=') met = actual >= cond.value;
        else if (cond.operator === '<') met = actual < cond.value;
        else if (cond.operator === '<=') met = actual <= cond.value;
        else if (cond.operator === '==') met = actual === cond.value;
      }

      if (met) {
        let adj = 0;
        if (cond.adjustmentType === 'percentage') {
          adj = Math.round(currentPrice * cond.adjustmentValue / 100);
        } else {
          adj = cond.adjustmentValue;
        }
        const adjLabel = cond.adjustmentType === 'percentage' ? `${cond.adjustmentValue >= 0 ? '+' : ''}${cond.adjustmentValue}%` : `${cond.adjustmentValue >= 0 ? '+' : ''}$${cond.adjustmentValue}`;
        currentPrice = currentPrice + adj;
        steps.push({
          type: 'condition',
          label: `✅ Condición: ${condLabel} ${cond.operator} ${cond.value}`,
          detail: `(${condLabel}=${actual}) → ${adjLabel} = $${adj.toLocaleString('es-AR')} | Precio: $${currentPrice.toLocaleString('es-AR')}`,
          success: true,
        });
      } else {
        steps.push({
          type: 'condition',
          label: `⏭ Condición: ${condLabel} ${cond.operator} ${cond.value}`,
          detail: actual !== null ? `(${condLabel}=${actual}) → No se cumple, se omite` : `${condLabel} no disponible en el texto`,
          success: false,
        });
      }
    }

    // 6. Redondeo
    if (rule.rounding > 0 && currentPrice > 0) {
      const beforeRound = currentPrice;
      currentPrice = roundPrice(currentPrice, rule.rounding);
      const diff = currentPrice - beforeRound;
      if (diff !== 0) {
        const label = rule.rounding >= 1000 ? `$${rule.rounding.toLocaleString('es-AR')}` : `$${rule.rounding}`;
        steps.push({
          type: 'condition',
          label: `🔢 Redondeo al múltiplo de ${label}`,
          detail: `$${beforeRound.toLocaleString('es-AR')} → $${currentPrice.toLocaleString('es-AR')} (${diff > 0 ? `+$${diff.toLocaleString('es-AR')}` : `-$${Math.abs(diff).toLocaleString('es-AR')}`})`,
          success: true,
        });
      }
    }

    steps.push({
      type: 'result',
      label: '🏁 Precio final sugerido',
      detail: `$${currentPrice.toLocaleString('es-AR')}`,
      success: true,
    });
  }

  if (!ruleApplied) {
    steps.push({
      type: 'result',
      label: 'Sin regla aplicada',
      detail: `Ninguna regla coincide con los tokens [${parsed.tokens.join(', ')}]`,
      success: false,
    });
  }

  return steps;
}

// ── Búsqueda con scoring (productos) ──

export function smartProductSearch(query: string, products: Producto[], maxResults = 8): Producto[] {
  const q = query.trim();
  if (q.length < 2) return [];

  const qNorm = normalizeText(q);
  const qDims = extractDims(qNorm);
  const qTokens = qNorm.split(/\s+/).filter(t => !/^\d+x\d+$/.test(t));

  const scored: Array<[number, Producto]> = [];

  for (const p of products) {
    const itemNorm = normalizeText(p.descripcion);
    if (!itemNorm) continue;

    let score = 0;

    if (qNorm === itemNorm) {
      score += 2000;
    } else {
      if (qDims.size > 0) {
        const itemDims = extractDims(itemNorm);
        let common = 0;
        for (const d of qDims) {
          if (itemDims.has(d)) common++;
        }
        if (common > 0) {
          score += 1000 * common;
          if (common === qDims.size) score += 200;
        }
      }

      const found = qTokens.filter(t => itemNorm.includes(t)).length;
      if (found === qTokens.length && qTokens.length > 0) score += 100;
      else if (found > 0) score += 10 * found;

      if (itemNorm.startsWith(qNorm)) score += 50;
      else if (itemNorm.includes(qNorm)) score += 30;
    }

    if (score > 0) {
      scored.push([score - itemNorm.length * 0.01, p]);
    }
  }

  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, maxResults).map(([_, p]) => p);
}

// ── Conversión desde PrecioReferencia ──

export function refsToProductos(refs: PrecioReferencia[]): Producto[] {
  return refs.map(r => ({
    id: '',
    descripcion: `${r.categoria.charAt(0).toUpperCase() + r.categoria.slice(1).toLowerCase()} ${r.medida} ${r.variante}`.trim(),
    precio_unitario: r.precio,
    categoria: r.categoria,
    medida: r.medida,
    variante: r.variante,
    stock: 0,
  }));
}

// ── Redondeo de precios (half-down para .5) ──

function roundPrice(price: number, roundTo: number): number {
  if (roundTo <= 0) return price;
  const half = roundTo / 2;
  const remainder = price % roundTo;
  if (remainder > half) {
    return Math.ceil(price / roundTo) * roundTo;
  } else {
    return Math.floor(price / roundTo) * roundTo;
  }
}

// ── Redondeo fijo: 0-3 piso, 4-9 techo ──

function roundDim(val: number): number {
  const remainder = val % 10;
  if (remainder <= 3) {
    return Math.floor(val / 10) * 10;
  } else {
    return Math.ceil(val / 10) * 10;
  }
}

// ── Redondeo inteligente al estándar del catálogo ──

function nearestStandard(val: number, standards: number[]): number {
  if (standards.length === 0) return val;
  let best = standards[0];
  let bestDiff = Math.abs(val - best);
  for (const s of standards) {
    const d = Math.abs(val - s);
    if (d < bestDiff) { bestDiff = d; best = s; }
  }
  return best;
}

// ── Cálculo de precio estimado por perímetro ──

function calcPriceByPerimeter(
  dimSmall: number, dimLarge: number,
  pool: Array<{ product: Producto; dimSmall: number; dimLarge: number }>,
): number | null {
  const valid = pool.filter(pd => pd.product.precio_unitario > 0);
  if (valid.length === 0) return null;

  const queryPerimeter = 2 * (dimSmall + dimLarge);

  const closest = [...valid]
    .map(pd => ({
      ...pd,
      diff: Math.abs(2 * (pd.dimSmall + pd.dimLarge) - queryPerimeter),
    }))
    .sort((a, b) => a.diff - b.diff)
    .slice(0, 5);

  let total = 0;
  for (const pd of closest) {
    total += pd.product.precio_unitario / (2 * (pd.dimSmall + pd.dimLarge));
  }

  const rawPrice = Math.round((total / closest.length) * queryPerimeter);

  const remainder = rawPrice % 1000;
  if (remainder >= 400) {
    return Math.ceil(rawPrice / 1000) * 1000;
  } else {
    return Math.floor(rawPrice / 1000) * 1000;
  }
}

// ── Sugerencia de precio para medidas personalizadas ──

export function suggestPrice(query: string, products: Producto[], rules?: PricingRule[]): PriceSuggestion[] {
  const { base, dims } = getBaseAndDims(query);
  if (dims.size === 0) return [];

  const dimPair = [...dims][0];
  const [dimSmall, dimLarge] = dimPair.split('x').map(Number);

  let result: PriceSuggestion[] = [];

  // ── Evaluar reglas (independiente del base matching) ──
  if (rules && rules.length > 0) {
    const parsed = parseQuery(query);
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const matchedToken = parsed.tokens.find(t =>
        rule.matchTokens.some(mt => t.includes(mt) || mt.includes(t))
      );
      if (!matchedToken) continue;

      const catUpper = rule.baseCategoria.toUpperCase();
      const varUpper = rule.baseVariante.toUpperCase();
      const refCandidates = products.filter(p =>
        p.categoria.toUpperCase() === catUpper &&
        p.variante.toUpperCase() === varUpper
      );
      if (refCandidates.length === 0) continue;

      const measureDimsR = (medida: string): { s: number; l: number } | null => {
        const norm = normalizeText(medida);
        const p = norm.match(/(\d+)x(\d+)/);
        if (!p) return null;
        const a = parseFloat(p[1]), b = parseFloat(p[2]);
        return { s: Math.min(a, b), l: Math.max(a, b) };
      };

      const rds = roundDim(dimSmall);
      const rdl = roundDim(dimLarge);

      let baseProduct: Producto | null = null;
      const exact = refCandidates.find(p => {
        const md = measureDimsR(p.medida);
        return md && md.s === rds && md.l === rdl;
      });
      if (exact) {
        baseProduct = exact;
      } else {
        const targetPerim = 2 * (rds + rdl);
        let best: Producto | null = null;
        let bestDiff = Infinity;
        for (const p of refCandidates) {
          const md = measureDimsR(p.medida);
          if (!md) continue;
          const diff = Math.abs(2 * (md.s + md.l) - targetPerim);
          if (diff < bestDiff) { bestDiff = diff; best = p; }
        }
        baseProduct = best;
      }

      if (!baseProduct) continue;

      let price = baseProduct.precio_unitario;

      if (rule.operation === 'percentage') {
        price += Math.round(price * rule.operationValue / 100);
      } else if (rule.operation === 'fixed') {
        price += rule.operationValue;
      } else if (rule.operation === 'override') {
        price = rule.operationValue;
      }

      for (const cond of rule.conditions) {
        let actual: number | null = null;
        if (cond.field === 'grosor') actual = parsed.grosor;
        else if (cond.field === 'lado_mayor') actual = Math.max(dimSmall, dimLarge);
        else if (cond.field === 'lado_menor') actual = Math.min(dimSmall, dimLarge);
        let met = false;
        if (actual !== null) {
          if (cond.operator === '>') met = actual > cond.value;
          else if (cond.operator === '>=') met = actual >= cond.value;
          else if (cond.operator === '<') met = actual < cond.value;
          else if (cond.operator === '<=') met = actual <= cond.value;
          else if (cond.operator === '==') met = actual === cond.value;
        }
        if (met) {
          if (cond.adjustmentType === 'percentage') {
            price += Math.round(price * cond.adjustmentValue / 100);
          } else {
            price += cond.adjustmentValue;
          }
        }
      }

      if (rule.rounding > 0 && price > 0) {
        price = roundPrice(price, rule.rounding);
      }

      result.push({
        description: query,
        price,
        basedOn: `${rule.name} → ${baseProduct.variante || baseProduct.categoria} ${baseProduct.medida}`,
        suggested: true,
      });
    }
  }

  const productsWithDims: Array<{
    product: Producto;
    dimSmall: number;
    dimLarge: number;
  }> = [];

  for (const p of products) {
    const { base: pBase, dims: pDims } = getBaseAndDims(p.descripcion);
    if (pDims.size === 0) continue;
    if (base && !pBase.includes(base) && !base.includes(pBase)) continue;
    const pd = [...pDims][0];
    const [ps, pl] = pd.split('x').map(Number);
    productsWithDims.push({ product: p, dimSmall: ps, dimLarge: pl });
  }

  if (productsWithDims.length === 0) {
    if (result.length > 0) return result;
    return [{
      description: query,
      price: 0,
      suggested: false,
      hint: base
        ? `Sin referencia: no hay precios guardados para "${base}" con medidas`
        : 'Sin referencia: categoría no encontrada en precios guardados',
    }];
  }

  const roundedSmall = roundDim(dimSmall);
  const roundedLarge = roundDim(dimLarge);

  const exactMatches = productsWithDims
    .filter(pd => pd.dimSmall === roundedSmall && pd.dimLarge === roundedLarge)
    .slice(0, 3);

  if (exactMatches.length > 0) {
    result = exactMatches.map(pd => ({
      description: query,
      price: pd.product.precio_unitario,
      basedOn: pd.product.descripcion,
      suggested: true,
    }));
  } else {
    const targetPerimeter = 2 * (roundedSmall + roundedLarge);
    const sorted = [...productsWithDims].sort((a, b) => {
      const da = Math.abs(2 * (a.dimSmall + a.dimLarge) - targetPerimeter);
      const db = Math.abs(2 * (b.dimSmall + b.dimLarge) - targetPerimeter);
      return da - db;
    });

    result = sorted.slice(0, 3).map(pd => ({
      description: query,
      price: pd.product.precio_unitario,
      basedOn: pd.product.descripcion,
      suggested: true,
    }));
  }

  const estimated = calcPriceByPerimeter(dimSmall, dimLarge, productsWithDims);
  if (estimated !== null) {
    result.push({
      description: query,
      price: estimated,
      suggested: false,
      estimated: true,
    });
  }

  if (result.length === 0) {
    return [{
      description: query,
      price: 0,
      suggested: false,
      hint: `Sin coincidencia: ${roundedSmall}x${roundedLarge} no tiene precio de referencia y no se pudo estimar por perímetro`,
    }];
  }

  return result;
}
