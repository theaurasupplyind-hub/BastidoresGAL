import type { PrecioReferencia, Producto, PricingRule, ParsedQuery, RuleCondition, EstimationRule } from '$lib/types';
import { normalizeEstimationParams } from '$lib/types';

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
  // Normalizar primero las medidas triples evita que "67 x 67 x 3"
  // termine convertido en "67x67 x 3".
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*[xX*×]\s*(\d+(?:[.,]\d+)?)\s*[xX*×]\s*(\d+(?:[.,]\d+)?)/g, '$1x$2x$3');
  t = t.replace(/(\d+(?:[.,]\d+)?)\s*[xX*×]\s*(\d+(?:[.,]\d+)?)/g, '$1x$2');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function extractDims(text: string): Set<string> {
  const dimRegex = /(\d+(?:[.,]\d+)?)x(\d+(?:[.,]\d+)?)/g;
  const dims = new Set<string>();
  let m;
  while ((m = dimRegex.exec(text)) !== null) {
    const r1 = parseFloat(m[1].replace(',', '.'));
    const r2 = parseFloat(m[2].replace(',', '.'));
    const [c1, c2] = toCmPair(r1, r2);
    const sorted = [Math.min(c1, c2), Math.max(c1, c2)];
    dims.add(`${sorted[0]}x${sorted[1]}`);
  }
  return dims;
}

// ── Normalizador mixto m/cm ──
// "1,5 x 3" (ambos <12) → metros → 150x300 cm.
// "1,5 x 300" (uno <12, otro >50) → mixto → 150x300 cm.
// "150 x 300" → ya cm, se deja igual.
export function toCmPair(d1: number, d2: number): [number, number] {
  if (!Number.isFinite(d1) || !Number.isFinite(d2)) return [d1, d2];
  if (d1 < 12 && d2 < 12) return [Math.round(d1 * 100), Math.round(d2 * 100)];
  if (d1 < 12 && d2 > 50) return [Math.round(d1 * 100), Math.round(d2)];
  if (d2 < 12 && d1 > 50) return [Math.round(d1), Math.round(d2 * 100)];
  return [d1, d2];
}

export function wasAutoConvertedToCm(d1: number, d2: number): boolean {
  if (d1 < 12 && d2 < 12) return true;
  if ((d1 < 12 && d2 > 50) || (d2 < 12 && d1 > 50)) return true;
  return false;
}

export function getBaseAndDims(text: string): { base: string; dims: Set<string> } {
  const parsed = parseQuery(text);
  return { base: parsed.base, dims: new Set(parsed.dims) };
}

// ── Parseo de query con grosor (triple dim: 40x50x5) ──

export function parseQuery(query: string): ParsedQuery {
  const norm = normalizeText(query);
  const tripleRegex = /(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)(?:\s*x\s*(\d+(?:[.,]\d+)?))?/;
  const m = norm.match(tripleRegex);
  let dims: string[] = [];
  let grosor: number | null = null;
  if (m) {
    const r1 = parseFloat(m[1].replace(',', '.'));
    const r2 = parseFloat(m[2].replace(',', '.'));
    const [c1, c2] = toCmPair(r1, r2);
    dims.push(`${Math.min(c1, c2)}x${Math.max(c1, c2)}`);
    if (m[3] !== undefined) {
      grosor = parseFloat(m[3].replace(',', '.'));
    }
  }
  const base = dims.length > 0 ? norm.replace(tripleRegex, '').trim() : norm;
  const tokens = base.split(/\s+/).filter(t => t.length > 0);
  return { tokens, dims, base, grosor };
}

// ── Singularización simple (escalable a cualquier regla) ──
// "pinturas"→"pintura", "tapacantos"→"tapacanto", "marcos"→"marco".
// Solo quita una "s"/"es" final; no toca infinitivos ("embastar").

export function singularize(word: string): string {
  const w = (word || '').toLowerCase().trim();
  if (w.length <= 3 || !w.endsWith('s')) return w;
  if (w.endsWith('es') && w.length > 4) {
    const prev = w.charAt(w.length - 3);
    if (!'aeiou'.includes(prev)) return w.slice(0, -2);
  }
  return w.slice(0, -1);
}

function capFirst(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ── Matching de reglas por tokens (normalizado, no-estricto, escalable) ──
// - Todo lo que el usuario configura en matchTokens + el propio rule.name dispara.
// - Niveles: exacto (100) > singular/pegado (90) > frase contenida (80) >
//   prefijo >=2 letras en ambos sentidos (60-79, más largo = más score).
// - El filtro de longitud solo limita lo difuso (prefijo/substring),
//   nunca el exacto: un token explícito corto como "Sin" debe matchear "sin".

// Palabras de enlace que no identifican una regla por sí solas: un trigger
// multi-palabra ("corte de tela") no puede matchear solo por "de"/"tela".
const STOP_WORDS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'con', 'sin', 'para', 'por', 'y', 'o', 'en', 'al', 'un', 'una']);

/** ¿La palabra del trigger está en el query? Misma tolerancia que el matcheo por palabra. */
function triggerWordInQuery(mw: string, tokens: string[], hasDims: boolean): boolean {
  const mwSing = singularize(mw);
  for (const qt of tokens) {
    if (qt === mw) return true;
    if (singularize(qt) === mwSing) return true;
    // Prefijo query→trigger ("pi"→"pintura") e inicial con medidas ("90x87 p")
    if (qt.length >= 2 && mw.startsWith(qt)) return true;
    if (qt.length === 1 && hasDims && mw.startsWith(qt)) return true;
    // Prefijo trigger→query ("pinturas" vs "pintura")
    if (mw.length >= 2 && qt.startsWith(mw)) return true;
  }
  return false;
}

export function ruleMatchScore(
  parsed: ParsedQuery,
  rule: PricingRule,
  opts: { requireAllWords?: boolean } = {},
): { score: number; matched: string | null } {
  const base = parsed.base || '';
  const baseNoSpace = base.replace(/\s+/g, '');
  const tokens = parsed.tokens || [];
  const hasDims = (parsed.dims?.length ?? 0) > 0;
  const triggers: string[] = [...(rule.matchTokens || []), rule.name || ''].filter(Boolean);

  let best = 0;
  let bestRaw: string | null = null;
  const consider = (score: number, raw: string) => {
    if (score > best) { best = score; bestRaw = raw; }
  };

  for (const raw of triggers) {
    const mt = normalizeText(String(raw || ''));
    if (!mt) continue;
    const mtNoSpace = mt.replace(/\s+/g, '');
    const mtSing = singularize(mt);
    const mtWords = mt.split(/\s+/).filter(Boolean);

    // En modo estricto (estimaciones) un trigger multi-palabra solo vale si
    // TODAS sus palabras significativas están en el query. Así "Corte de tela"
    // no matchea "Bastidor 86 x 100 Sin Tela" por la sola palabra "tela".
    const sigWords = mtWords.filter(w => !STOP_WORDS.has(w));
    const wordsOk = !opts.requireAllWords
      || sigWords.length <= 1
      || sigWords.every(w => triggerWordInQuery(w, tokens, hasDims));

    // Exacto frase / token
    if (base === mt) { consider(100, String(raw)); continue; }
    if (tokens.includes(mt)) { consider(100, String(raw)); continue; }
    // Exacto singular / pegado
    if (singularize(base) === mtSing && base) { consider(90, String(raw)); continue; }
    if (baseNoSpace && mtNoSpace && baseNoSpace === mtNoSpace) { consider(90, String(raw)); continue; }
    // Frase contenida (multi-palabra): "caja fibro" contiene "fibro facil"
    if (mt.includes(' ')) {
      if (base.includes(mt)) { consider(80, String(raw)); continue; }
      if (mtNoSpace.length >= 3 && baseNoSpace.includes(mtNoSpace)) { consider(78, String(raw)); continue; }
      // Prefijo de frase: "fibro" → "fibro facil", "sin" → "sin tela"
      if (base.length >= 2 && mt.startsWith(base)) { consider(60 + Math.min(19, base.length), String(raw)); continue; }
      if (mt.length >= 2 && base.startsWith(mt)) { consider(60 + Math.min(19, mt.length), String(raw)); continue; }
    } else {
      // Glued: "sintela" ⇔ "sin tela" / "sin" en "sintela"
      if (mtNoSpace.length >= 2 && baseNoSpace.includes(mtNoSpace) && baseNoSpace !== mtNoSpace) {
        consider(mtNoSpace.length <= 3 ? 70 : 78, String(raw));
      }
    }

    // Por palabra: exacto, singular y prefijo en ambos sentidos
    if (!wordsOk) continue;
    for (const qt of tokens) {
      const qtSing = singularize(qt);
      for (const mw of mtWords) {
        const mwSing = singularize(mw);
        if (qt === mw) { consider(100, String(raw)); break; }
        if (qtSing === mwSing) { consider(90, String(raw)); break; }
        // Prefijo query→trigger: "pi"→"pintura", "ta"→"tapacantos", "embas"→"embastado"
        if (qt.length >= 2 && mw.startsWith(qt)) {
          consider(60 + Math.min(19, qt.length), String(raw));
        }
        // Inicial con medidas ("90x87 p"→"pintura"): solo si hay dims para no
        // inundar al tipear una letra suelta; score menor que el prefijo >=2.
        else if (qt.length === 1 && parsed.dims.length > 0 && mw.startsWith(qt)) {
          consider(55, String(raw));
        }
        // Prefijo trigger→query: "pinturas" escrito vs token "pintura", "sintela" vs "sin"
        else if (mw.length >= 2 && qt.startsWith(mw)) {
          consider(60 + Math.min(19, mw.length), String(raw));
        }
      }
    }
  }

  if (best > 0 && bestRaw) return { score: best, matched: bestRaw };

  // Una consulta triple (ej. "67x67x3") ya identifica un producto con
  // grosor, aunque todavía no tenga escrito el nombre/categoría. En ese
  // caso pueden aplicar las reglas que explícitamente dependen del grosor.
  if (parsed.grosor !== null && rule.conditions?.some(c => c.field === 'grosor')) {
    return { score: 50, matched: 'grosor' };
  }
  return { score: 0, matched: null };
}

export function ruleMatchesQuery(parsed: ParsedQuery, rule: PricingRule): string | null {
  return ruleMatchScore(parsed, rule).matched;
}

// ── Nombre final de la sugerencia (genérico, sin hardcodear productos) ──
// - Cualquier alias (matchTokens) canonicaliza al rule.name.
// - Abreviaturas ("pi"→"Pintura", "ta"→"Tapacanto", "sin"→"Sin Tela") se expanden.
// - Si la regla ES una variante (name ≈ baseVariante, ej. "Sin Tela"),
//   formato "{Categoria} {dims} {Nombre}": "Bastidor 34 x 56 Sin Tela".
// - Si no (ej. "Pinturas", "Tapacanto"), formato "{Nombre} {dims}":
//   "Pintura 34 x 54", "Tapacanto 45 x 32" (singularizado, sin duplicar).

export function buildSuggestionDesc(
  userQuery: string,
  ruleName: string,
  rule?: Pick<PricingRule, 'baseCategoria' | 'baseVariante' | 'matchTokens'> | null,
): string {
  const dimsRe = /\d+(?:[.,]\d+)?\s*[xX×]\s*\d+(?:[.,]\d+)?(?:\s*[xX×]\s*\d+(?:[.,]\d+)?)?/;
  const userDims = (userQuery || '').match(dimsRe);
  if (!userDims) return ruleName || userQuery;
  const dimsText = userDims[0].replace(/\s+/g, ' ').trim();

  const triggers: string[] = [ruleName, ...((rule?.matchTokens as string[]) || [])].filter(Boolean);
  // Quitar medidas primero
  let remainder = (userQuery || '')
    .replace(new RegExp(dimsRe.source, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Quitar menciones completas de los triggers (frases largas primero, con \b)
  const sorted = [...triggers].sort((a, b) => String(b).length - String(a).length);
  for (const t of sorted) {
    const norm = normalizeText(String(t));
    if (!norm) continue;
    const esc = String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
      remainder = remainder.replace(new RegExp(`\\b${esc}\\b`, 'gi'), ' ');
    } catch {
      remainder = remainder.replace(new RegExp(esc, 'gi'), ' ');
    }
    // También quitar versión singular/plural simple del trigger
    const sing = singularize(norm);
    if (sing && sing !== norm) {
      const escS = sing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      try {
        remainder = remainder.replace(new RegExp(`\\b${escS}\\b`, 'gi'), ' ');
      } catch { /* noop */ }
    }
  }
  remainder = remainder.replace(/\s+/g, ' ').trim();

  const ruleNorm = normalizeText(ruleName);
  const ruleSing = singularize(ruleNorm);
  const remNorm = normalizeText(remainder);
  const remSing = singularize(remNorm);

  // ¿El resto es la misma idea (exacto, plural o abreviatura/prefijo)?
  // La inicial sola ("p"→"pintura") solo vale si hay medidas en la query.
  const hasDims = !!userDims;
  let consumed = remNorm.length === 0;
  if (!consumed) {
    if (remNorm === ruleNorm || remSing === ruleSing) consumed = true;
    else if ((remNorm.length >= 2 || (remNorm.length === 1 && hasDims)) && (ruleNorm.startsWith(remNorm) || ruleSing.startsWith(remNorm))) consumed = true;
    else if (ruleNorm.length >= 2 && (remNorm.startsWith(ruleNorm) || remNorm.startsWith(ruleSing))) consumed = true;
    else {
      // Alias: el resto es otro token de la misma regla ("marco"→Tapacanto, "embastar"→Pinturas)
      const aliasHit = (rule?.matchTokens || []).some(t => {
        const tn = normalizeText(String(t));
        return tn && (tn === remNorm || singularize(tn) === remSing || ((remNorm.length >= 2 || (remNorm.length === 1 && hasDims)) && tn.startsWith(remNorm)));
      });
      if (aliasHit) consumed = true;
      // Resto es primera palabra de un nombre multi-palabra ("sin"→"sin tela")
      if (!consumed && ruleNorm.includes(' ')) {
        const first = ruleNorm.split(/\s+/)[0];
        if (remNorm === first || singularize(first) === remSing || ((remNorm.length >= 2 || (remNorm.length === 1 && hasDims)) && first.startsWith(remNorm))) consumed = true;
      }
    }
  }

  if (consumed) {
    const varNorm = normalizeText(String(rule?.baseVariante || ''));
    const isVarianteRule = varNorm && (ruleNorm === varNorm || ruleSing === singularize(varNorm));
    if (isVarianteRule) {
      const cat = (rule?.baseCategoria || 'Bastidor').toLowerCase();
      const catCap = capFirst(cat);
      return `${catCap} ${dimsText} ${ruleName}`.replace(/\s+/g, ' ').trim();
    }
    // Producto: preferir la forma que escribió el usuario si solo difiere en plural,
    // si no usar el singular del rule.name ("Pinturas"→"Pintura", "pi"→"Pintura").
    let display = ruleName;
    if (remainder && remSing === ruleSing) display = capFirst(remainder.toLowerCase());
    else display = capFirst(ruleSing);
    return `${display} ${dimsText}`.replace(/\s+/g, ' ').trim();
  }

  // Concepto distinto al de la regla: conservar prefijo ("Marco dorado 45x32 Tapacanto")
  const prefix = capFirst(remainder);
  return `${prefix} ${dimsText} ${ruleName}`.replace(/\s+/g, ' ').trim();
}

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
    const matchedToken = ruleMatchesQuery(parsed, rule);
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
    if (rule.rounding !== 0 && currentPrice > 0) {
      const beforeRound = currentPrice;
      currentPrice = roundPrice(currentPrice, rule.rounding);
      const diff = currentPrice - beforeRound;
      if (diff !== 0) {
        const step = Math.abs(rule.rounding);
        const label = step >= 1000 ? `$${step.toLocaleString('es-AR')}` : `$${step}`;
        const dir = rule.rounding < 0 ? 'hacia arriba ' : '';
        steps.push({
          type: 'condition',
          label: `🔢 Redondeo ${dir}al múltiplo de ${label}`,
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
  const qTokens = qNorm.split(/\s+/).filter(t => !/^\d+(?:[.,]\d+)?x\d+(?:[.,]\d+)?$/.test(t));

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

// ── Redondeo de precios (half-down para .5; negativo = hacia arriba) ──

function roundPrice(price: number, roundTo: number): number {
  const step = Math.abs(roundTo);
  if (step <= 0) return price;
  if (roundTo < 0) return Math.ceil(price / step) * step;
  const half = step / 2;
  const remainder = price % step;
  if (remainder > half) {
    return Math.ceil(price / step) * step;
  } else {
    return Math.floor(price / step) * step;
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

// ── Cálculo de precio estimado por perímetro (legacy: 5 vecinos, redondeo 1000/400) ──

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

// ── Estimación configurable (tabla estimation_rules) ──

export interface EstimationPoolItem {
  product: Producto;
  dimSmall: number;
  dimLarge: number;
}

function parseAxB(medida: string): { s: number; l: number } | null {
  const norm = normalizeText(medida || '');
  const p = norm.match(/(\d+(?:[.,]\d+)?)x(\d+(?:[.,]\d+)?)/);
  if (!p) return null;
  const r1 = parseFloat(p[1].replace(',', '.'));
  const r2 = parseFloat(p[2].replace(',', '.'));
  const [c1, c2] = toCmPair(r1, r2);
  return { s: Math.min(c1, c2), l: Math.max(c1, c2) };
}

function filterEstimationPool(
  products: Producto[],
  refCategoria: string,
  refVariante: string,
  refMedida: string,
): EstimationPoolItem[] {
  const cat = (refCategoria || '').trim().toUpperCase();
  const vari = (refVariante || '').trim().toUpperCase();
  const out: EstimationPoolItem[] = [];
  for (const p of products) {
    if (cat && (p.categoria || '').toUpperCase() !== cat) continue;
    if (vari && (p.variante || '').toUpperCase() !== vari) continue;
    const md = parseAxB(p.medida || '');
    if (!md) continue;
    if (p.precio_unitario <= 0) continue;
    out.push({ product: p, dimSmall: md.s, dimLarge: md.l });
  }
  const fixed = parseAxB(refMedida || '');
  if (fixed) {
    const exact = out.filter(o => o.dimSmall === fixed.s && o.dimLarge === fixed.l);
    if (exact.length > 0) return exact;
  }
  return out;
}

function applyEstimationPost(
  raw: number,
  ladoMayorCm: number,
  params: ReturnType<typeof normalizeEstimationParams>,
): number {
  let price = raw;
  if (params.desperdicio_pct) price += price * params.desperdicio_pct / 100;
  if (params.margen_pct) price += price * params.margen_pct / 100;
  const tope = params.tope_lado_mayor ?? 300;
  if (tope != null && ladoMayorCm > tope && params.recargo_oversize_pct) {
    price += price * params.recargo_oversize_pct / 100;
  }
  price = Math.round(price);
  if (params.minimo && price < params.minimo) price = params.minimo;
  if (params.rounding) price = roundPrice(price, params.rounding);
  return price;
}

export function calcPerimetroConfigurable(
  dimSmall: number, dimLarge: number,
  pool: EstimationPoolItem[],
  rawParams?: Partial<import('$lib/types').EstimationParams>,
): number | null {
  const params = normalizeEstimationParams(rawParams ?? {});
  const valid = pool.filter(pd => pd.product.precio_unitario > 0);
  if (valid.length === 0) return null;
  const queryPerimeter = 2 * (dimSmall + dimLarge);
  const k = Math.max(1, Math.min(20, params.k_vecinos ?? 5));
  const closest = [...valid]
    .map(pd => ({ ...pd, diff: Math.abs(2 * (pd.dimSmall + pd.dimLarge) - queryPerimeter) }))
    .sort((a, b) => a.diff - b.diff)
    .slice(0, k);
  let total = 0;
  for (const pd of closest) {
    total += pd.product.precio_unitario / (2 * (pd.dimSmall + pd.dimLarge));
  }
  const rawPrice = (total / closest.length) * queryPerimeter;
  return applyEstimationPost(rawPrice, Math.max(dimSmall, dimLarge), params);
}

export function calcAreaM2(
  dimSmall: number, dimLarge: number,
  pool: EstimationPoolItem[],
  rawParams?: Partial<import('$lib/types').EstimationParams>,
): number | null {
  const params = normalizeEstimationParams(rawParams ?? {});
  let precioM2: number | null = params.precio_m2_manual ?? null;
  if (precioM2 == null) {
    const ratios: number[] = [];
    for (const pd of pool) {
      const area = (pd.dimSmall * pd.dimLarge) / 10000;
      if (area > 0 && pd.product.precio_unitario > 0) ratios.push(pd.product.precio_unitario / area);
    }
    if (ratios.length === 0) return null;
    precioM2 = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  }
  if (!precioM2 || precioM2 <= 0) return null;
  const areaQuery = (dimSmall * dimLarge) / 10000;
  return applyEstimationPost(areaQuery * precioM2, Math.max(dimSmall, dimLarge), params);
}

export function calcLinealMayor(
  dimSmall: number, dimLarge: number,
  pool: EstimationPoolItem[],
  rawParams?: Partial<import('$lib/types').EstimationParams>,
): number | null {
  const params = normalizeEstimationParams(rawParams ?? {});
  let precioM: number | null = params.precio_m_lineal_manual ?? null;
  if (precioM == null) {
    const ratios: number[] = [];
    for (const pd of pool) {
      const largoM = Math.max(pd.dimSmall, pd.dimLarge) / 100;
      if (largoM > 0 && pd.product.precio_unitario > 0) ratios.push(pd.product.precio_unitario / largoM);
    }
    if (ratios.length === 0) return null;
    precioM = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  }
  if (!precioM || precioM <= 0) return null;
  const largoQueryM = Math.max(dimSmall, dimLarge) / 100;
  return applyEstimationPost(largoQueryM * precioM, Math.max(dimSmall, dimLarge), params);
}

export function estimationMatchesQuery(parsed: ParsedQuery, rule: EstimationRule): string | null {
  // Estricto: una estimación solo aplica si el query menciona la operación
  // completa ("corte de tela"), no una palabra suelta del nombre ("tela").
  return ruleMatchScore(
    parsed,
    { matchTokens: rule.matchTokens, name: rule.name } as PricingRule,
    { requireAllWords: true },
  ).matched;
}

/** Evalúa todas las reglas de estimación que matcheen el query.
 *  Devuelve {first, last}: primero = oversize (supera el tope), resto al final. */
export function evaluateAllEstimations(
  query: string,
  dimSmall: number,
  dimLarge: number,
  products: Producto[],
  estimationRules?: EstimationRule[],
): { first: PriceSuggestion[]; last: PriceSuggestion[] } {
  const first: PriceSuggestion[] = [];
  const last: PriceSuggestion[] = [];
  if (!estimationRules || estimationRules.length === 0) return { first, last };
  const parsedEst = parseQuery(query);
  const sortedRules = [...estimationRules]
    .filter(r => r.enabled)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  for (const er of sortedRules) {
    if (!estimationMatchesQuery(parsedEst, er)) continue;
    // Solo estimar si hay pool de la ref pedida; si no, se salta en silencio.
    const sug = evaluateEstimationRule(dimSmall, dimLarge, products, er);
    if (!sug) continue;
    const tope = normalizeEstimationParams(er.params ?? {}).tope_lado_mayor ?? 300;
    if (isOversize(dimSmall, dimLarge, tope)) first.push(sug);
    else last.push(sug);
  }
  return { first, last };
}

const fmtAR = (n: number): string => `$${Math.round(n).toLocaleString('es-AR')}`;
const fmtM2 = (n: number): string => n.toLocaleString('es-AR', { maximumFractionDigits: 2 });

/** Desglose paso a paso en lenguaje simple para mostrar en el modal.
 *  Ej: ["Medida: 150×300 cm = 4,5 m²", "Ref ROLLO 2×5: $197.000 / 10 m² = $19.700/m²", ...] */
export function explainEstimationRule(
  dimSmall: number, dimLarge: number,
  products: Producto[],
  rule: EstimationRule,
): { suggestion: PriceSuggestion | null; steps: string[] } {
  const suggestion = evaluateEstimationRule(dimSmall, dimLarge, products, rule);
  const steps: string[] = [];
  const params = normalizeEstimationParams(rule.params ?? {});
  const pool = filterEstimationPool(products, rule.refCategoria, rule.refVariante, rule.refMedida);
  const ladoMayor = Math.max(dimSmall, dimLarge);
  const areaQuery = (dimSmall * dimLarge) / 10000;
  steps.push(`Medida pedida: ${dimSmall}×${dimLarge} cm = ${fmtM2(areaQuery)} m² (lado mayor ${ladoMayor} cm)`);
  if (pool.length === 0) {
    steps.push(`Sin datos: no hay referencia ${[rule.refCategoria, rule.refVariante, rule.refMedida].filter(Boolean).join(' ') || '(vacía)'}`);
    return { suggestion, steps };
  }
  if (rule.method === 'area_m2') {
    let precioM2 = params.precio_m2_manual ?? null;
    if (precioM2 == null) {
      const ratios = pool.map(pd => pd.product.precio_unitario / (((pd.dimSmall * pd.dimLarge) / 10000) || 1));
      precioM2 = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      const ref = pool[0];
      steps.push(`Precio base: ${ref.product.categoria} ${ref.product.medida} a ${fmtAR(ref.product.precio_unitario)} → ${fmtAR(precioM2)}/m²`);
    } else {
      steps.push(`Precio base manual: ${fmtAR(precioM2)}/m²`);
    }
    let price = areaQuery * (precioM2 || 0);
    steps.push(`Base: ${fmtM2(areaQuery)} m² × ${fmtAR(precioM2 || 0)} = ${fmtAR(price)}`);
    if (params.desperdicio_pct) { price += price * params.desperdicio_pct / 100; steps.push(`+ Desperdicio ${params.desperdicio_pct}% (recortes) = ${fmtAR(price)}`); }
    if (params.margen_pct) { price += price * params.margen_pct / 100; steps.push(`+ Ganancia ${params.margen_pct}% = ${fmtAR(price)}`); }
    const tope = params.tope_lado_mayor ?? 300;
    if (tope != null && ladoMayor > tope && params.recargo_oversize_pct) {
      price += price * params.recargo_oversize_pct / 100;
      steps.push(`Pasa el tope (${ladoMayor} > ${tope} cm): +${params.recargo_oversize_pct}% = ${fmtAR(price)} → va PRIMERO`);
    } else {
      steps.push(`No pasa el tope (${ladoMayor} ≤ ${tope ?? 300} cm): sin recargo`);
    }
    if (params.minimo && price < params.minimo) { price = params.minimo; steps.push(`Mínimo: se cobra ${fmtAR(price)}`); }
    if (params.rounding) steps.push(`Redondeo a ${fmtAR(params.rounding)} = ${fmtAR(suggestion?.price ?? price)}`);
  } else if (rule.method === 'lineal_mayor') {
    let precioM = params.precio_m_lineal_manual ?? null;
    if (precioM == null) {
      const ratios = pool.map(pd => pd.product.precio_unitario / ((Math.max(pd.dimSmall, pd.dimLarge) / 100) || 1));
      precioM = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      steps.push(`Precio base desde ref: ${fmtAR(precioM)}/metro lineal`);
    } else {
      steps.push(`Precio base manual: ${fmtAR(precioM)}/metro lineal`);
    }
    const largoM = ladoMayor / 100;
    let price = largoM * (precioM || 0);
    steps.push(`Base: ${fmtM2(largoM)} m × ${fmtAR(precioM || 0)} = ${fmtAR(price)}`);
    if (params.desperdicio_pct) { price += price * params.desperdicio_pct / 100; steps.push(`+ Desperdicio ${params.desperdicio_pct}% = ${fmtAR(price)}`); }
    if (params.margen_pct) { price += price * params.margen_pct / 100; steps.push(`+ Ganancia ${params.margen_pct}% = ${fmtAR(price)}`); }
    const tope = params.tope_lado_mayor ?? 300;
    if (tope != null && ladoMayor > tope && params.recargo_oversize_pct) {
      price += price * params.recargo_oversize_pct / 100;
      steps.push(`Pasa el tope (${ladoMayor} > ${tope} cm): +${params.recargo_oversize_pct}% = ${fmtAR(price)} → va PRIMERO`);
    }
    if (params.minimo && price < params.minimo) { price = params.minimo; steps.push(`Mínimo: se cobra ${fmtAR(price)}`); }
    if (params.rounding) steps.push(`Redondeo a ${fmtAR(params.rounding)} = ${fmtAR(suggestion?.price ?? price)}`);
  } else {
    steps.push(`Método por perímetro: promedia el precio por cm de perímetro de las ${params.k_vecinos ?? 5} referencias más cercanas`);
    if (params.margen_pct) steps.push(`+ Ganancia ${params.margen_pct}%`);
    const tope = params.tope_lado_mayor ?? 300;
    if (tope != null && ladoMayor > tope && params.recargo_oversize_pct) steps.push(`Pasa el tope (${ladoMayor} > ${tope} cm): +${params.recargo_oversize_pct}% → va PRIMERO`);
    if (params.rounding) steps.push(`Redondeo a ${fmtAR(params.rounding)} = ${fmtAR(suggestion?.price ?? 0)}`);
  }
  return { suggestion, steps };
}

export function evaluateEstimationRule(
  dimSmall: number, dimLarge: number,
  products: Producto[],
  rule: EstimationRule,
): PriceSuggestion | null {
  if (!rule.enabled) return null;
  const params = normalizeEstimationParams(rule.params ?? {});
  const pool = filterEstimationPool(products, rule.refCategoria, rule.refVariante, rule.refMedida);
  if (pool.length === 0) return null;
  let price: number | null = null;
  if (rule.method === 'area_m2') price = calcAreaM2(dimSmall, dimLarge, pool, params);
  else if (rule.method === 'lineal_mayor') price = calcLinealMayor(dimSmall, dimLarge, pool, params);
  else price = calcPerimetroConfigurable(dimSmall, dimLarge, pool, params);
  if (price == null || price <= 0) return null;
  const refLabel = [rule.refCategoria, rule.refVariante, rule.refMedida].filter(Boolean).join(' ');
  return {
    description: rule.name,
    price,
    basedOn: `${rule.name} → ${refLabel || 'refs'} (${rule.method})`,
    suggested: false,
    estimated: true,
  };
}

// Tope: si el lado mayor supera el tope de la regla, el estimado va primero.
// Un tope 0/vacío significa "sin tope" (no todo es oversize).
export function isOversize(dimSmall: number, dimLarge: number, tope?: number | null): boolean {
  // tope 0/vacío = "sin tope": no debe convertir toda medida en oversize.
  if (tope == null || tope <= 0) return false;
  return Math.max(dimSmall, dimLarge) > tope;
}

// ── Sugerencia de precio para medidas personalizadas ──

export function suggestPrice(query: string, products: Producto[], rules?: PricingRule[], estimationRules?: EstimationRule[]): PriceSuggestion[] {
  const { base, dims } = getBaseAndDims(query);
  if (dims.size === 0) return [];

  const dimPair = [...dims][0];
  const [dimSmall, dimLarge] = dimPair.split('x').map(Number);

  let result: PriceSuggestion[] = [];

  // ── Evaluar reglas (solo las que matchean el query) ──
  if (rules && rules.length > 0) {
    const parsed = parseQuery(query);
    for (const rule of rules) {
      if (!rule.enabled) continue;
      if (!ruleMatchesQuery(parsed, rule)) continue;

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

      if (rule.rounding !== 0 && price > 0) {
        price = roundPrice(price, rule.rounding);
      }

      result.push({
        description: rule.name,
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
    // Las estimaciones configurables usan su propia referencia (ej: ROLLO),
    // así que se evalúan aunque no haya pool por nombre ("corte tela").
    const estOnly = evaluateAllEstimations(query, dimSmall, dimLarge, products, estimationRules);
    const combined = [...estOnly.first, ...result, ...estOnly.last];
    if (combined.length > 0) return combined;
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
  const targetPerimeter = 2 * (roundedSmall + roundedLarge);

  // Token relevance: word-start (do->doble) vale más que substring dentro de otra palabra (bastidor contiene do)
  const tokenScore = (queryBase: string, desc: string): number => {
    const q = normalizeText(queryBase).trim();
    if (!q) return 0;
    const qTokens = q.split(/\s+/).filter(t => t.length >= 2);
    if (qTokens.length === 0) return 0;
    const dNorm = normalizeText(desc);
    const dWords = dNorm.split(/\s+/);
    let score = 0;
    for (const qt of qTokens) {
      if (dWords.some(w => w.startsWith(qt))) score += 10;
      else if (dWords.some(w => w.includes(qt))) score += 5;
      else if (dNorm.includes(qt)) score += 1;
    }
    return score;
  };

  // Identidad de variante: usa el campo `variante` del producto; si falta, cae
  // al texto de la descripción sin medidas (para no fusionar productos distintos).
  const dimsReKey = /\d+(?:[.,]\d+)?\s*[xX×]\s*\d+(?:[.,]\d+)?(?:\s*[xX×]\s*\d+(?:[.,]\d+)?)?/g;
  const variantKey = (p: Producto): string => {
    const v = (p.variante || '').trim();
    if (v) return normalizeText(v);
    return normalizeText((p.descripcion || '').replace(dimsReKey, ' '));
  };

  // Quedarse con el mejor producto por variante: exacto primero, luego mayor
  // relevancia de tokens, luego perímetro más cercano. Así aparecen TODAS las
  // variantes una sola vez (Lienzo Profesional, Sin Tela, Lona Preparada,
  // Doble 4cm, …) sin repetir la misma variante en distintas medidas.
  const bestByVariant = new Map<string, { product: Producto; score: number; exact: boolean; diff: number }>();
  for (const pd of productsWithDims) {
    const key = variantKey(pd.product);
    const exact = pd.dimSmall === roundedSmall && pd.dimLarge === roundedLarge;
    const score = tokenScore(base, pd.product.descripcion);
    const diff = Math.abs(2 * (pd.dimSmall + pd.dimLarge) - targetPerimeter);
    const cur = bestByVariant.get(key);
    const better = !cur
      || (exact && !cur.exact)
      || (exact === cur.exact && score > cur.score)
      || (exact === cur.exact && score === cur.score && diff < cur.diff);
    if (better) bestByVariant.set(key, { product: pd.product, score, exact, diff });
  }

  const ordered = [...bestByVariant.values()].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.exact !== b.exact) return a.exact ? -1 : 1;
    return a.diff - b.diff;
  });

  result = [...ordered.map(v => ({
    description: query,
    price: v.product.precio_unitario,
    basedOn: v.product.descripcion,
    suggested: true,
  })), ...result];

  const estimated = calcPriceByPerimeter(dimSmall, dimLarge, productsWithDims);
  if (estimated !== null) {
    const legacySug: PriceSuggestion = {
      description: query,
      price: estimated,
      suggested: false,
      estimated: true,
    };
    // Si supera el tope (300 por defecto), el estimado va primero.
    if (isOversize(dimSmall, dimLarge, 300)) result.unshift(legacySug);
    else result.push(legacySug);
  }

  // ── Estimaciones configurables (tabla estimation_rules) ──
  // Van primero si hay oversize respecto a su tope, si no al final.
  const est = evaluateAllEstimations(query, dimSmall, dimLarge, products, estimationRules);
  result = [...est.first, ...result, ...est.last];

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
