import { api } from '$lib/api/client';
import { normalizeMaterialText } from '$lib/utils/molduras';

export interface MolduraHiddenRule {
  id: string;
  keyword: string;
  normalized: string;
  updated_at: string;
}

const STORAGE_KEY = 'moldura-hidden-rules';

// Seeds: lo que no debe aparecer en la orden de producción de molduras,
// ni en pantalla ni en PDF, aunque traiga medida A x B.
const SEEDS = ['acrilic', 'descuento', 'rollo'];

let cache: MolduraHiddenRule[] = [];
let loaded = false;

function now(): string {
  return new Date().toISOString();
}

function makeId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toRule(keyword: string): MolduraHiddenRule {
  const kw = keyword.trim();
  return {
    id: makeId(),
    keyword: kw,
    normalized: normalizeMaterialText(kw),
    updated_at: now(),
  };
}

function readLocal(): MolduraHiddenRule[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((r: any) => r && typeof r.keyword === 'string' && r.keyword.trim().length > 0)
      .map((r: any) => ({
        id: String(r.id ?? makeId()),
        keyword: String(r.keyword).trim(),
        normalized: String(r.normalized ?? normalizeMaterialText(String(r.keyword))),
        updated_at: String(r.updated_at ?? now()),
      }));
  } catch {
    return [];
  }
}

function persistLocal(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // storage lleno o bloqueado: no es fatal
  }
}

function seedIfEmpty(): void {
  if (cache.length > 0) return;
  cache = SEEDS.map((k) => toRule(k));
  persistLocal();
}

export async function load(): Promise<number> {
  cache = readLocal();
  seedIfEmpty();
  // Intento oportunista contra backend compartido; si falla o no existe
  // el endpoint, se conserva lo local sin romper.
  try {
    const remote = await api.getMolduraHiddenRules();
    if (Array.isArray(remote) && remote.length > 0) {
      const mapped: MolduraHiddenRule[] = remote
        .filter((r: any) => r && (r.keyword || r.normalized))
        .map((r: any) => ({
          id: String(r.id ?? makeId()),
          keyword: String(r.keyword ?? r.normalized ?? '').trim(),
          normalized: String(r.normalized ?? normalizeMaterialText(String(r.keyword ?? ''))),
          updated_at: String(r.updated_at ?? now()),
        }))
        .filter((r) => r.keyword.length > 0);
      if (mapped.length > 0) {
        cache = mapped;
        persistLocal();
      }
    }
  } catch {
    // sin backend: se sigue con lo local
  }
  loaded = true;
  return cache.length;
}

async function ensureLoaded(): Promise<void> {
  if (!loaded) await load();
}

export function getAll(): MolduraHiddenRule[] {
  return [...cache].sort((a, b) => a.keyword.localeCompare(b.keyword, 'es'));
}

/** Keywords crudas para pasar a parseCard/hasMolduraItems. */
export function getKeywords(): string[] {
  return cache.map((r) => r.keyword);
}

export function isHidden(desc: string, rules?: string[] | MolduraHiddenRule[]): boolean {
  const list: string[] = Array.isArray(rules)
    ? (rules as any[]).map((r) => (typeof r === 'string' ? r : String(r?.keyword ?? '')))
    : getKeywords();
  const hay = normalizeMaterialText(desc || '');
  if (!hay) return false;
  for (const raw of list) {
    const n = normalizeMaterialText(raw || '');
    if (!n) continue;
    if (hay.includes(n)) return true;
  }
  return false;
}

export async function add(keyword: string): Promise<MolduraHiddenRule | null> {
  await ensureLoaded();
  const kw = keyword.trim();
  if (!kw) return null;
  const n = normalizeMaterialText(kw);
  if (cache.some((r) => r.normalized === n)) return null; // duplicado
  const rule = toRule(kw);
  cache.push(rule);
  persistLocal();
  try {
    await api.saveMolduraHiddenRule({ keyword: rule.keyword });
  } catch {
    // backend ausente: queda solo local
  }
  return rule;
}

export async function remove(id: string): Promise<boolean> {
  await ensureLoaded();
  const found = cache.find((r) => r.id === id);
  if (!found) return false;
  cache = cache.filter((r) => r.id !== id);
  persistLocal();
  // Si la regla vino del backend con id numérico, intentar borrar allá también.
  const numericId = Number(found.id);
  if (Number.isInteger(numericId)) {
    try {
      await api.deleteMolduraHiddenRule(numericId);
    } catch {
      // no fatal
    }
  }
  return true;
}
