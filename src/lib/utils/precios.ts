import type { Producto } from '$lib/types';

export interface PriceSuggestion {
  description: string;
  price: number;
  basedOn?: string;
  suggested: boolean;
  category?: string;
  estimated?: boolean;
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
  let base = norm;
  for (const d of dims) {
    base = base.replace(d, '');
  }
  base = base.replace(/\s+/g, ' ').trim();
  return { base, dims };
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

export function suggestPrice(query: string, products: Producto[]): PriceSuggestion[] {
  const { base, dims } = getBaseAndDims(query);
  if (dims.size === 0) return [];

  const dimPair = [...dims][0];
  const [dimSmall, dimLarge] = dimPair.split('x').map(Number);

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

  if (productsWithDims.length === 0) return [];

  const stdSmall = [...new Set(productsWithDims.map(pd => pd.dimSmall))].sort((a, b) => a - b);
  const stdLarge = [...new Set(productsWithDims.map(pd => pd.dimLarge))].sort((a, b) => a - b);

  const roundedSmall = nearestStandard(dimSmall, stdSmall);
  const roundedLarge = nearestStandard(dimLarge, stdLarge);

  let result: PriceSuggestion[] = [];

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

  return result;
}
