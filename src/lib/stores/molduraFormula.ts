import { api } from '$lib/api/client';
import {
  DEFAULT_MOLDURA_FORMULA,
  cloneMolduraFormula,
  normalizeMolduraFormulaConfig,
  setMolduraFormulaConfig,
} from '$lib/utils/molduras';
import type { MolduraFormulaConfig } from '$lib/utils/molduras';

export interface MolduraFormulaHistoryEntry {
  id: number;
  changed_by: string | null;
  created_at: string | null;
  data: MolduraFormulaConfig | null;
}

const STORAGE_KEY = 'moldura-formula';

let cache: MolduraFormulaConfig = cloneMolduraFormula(DEFAULT_MOLDURA_FORMULA);
let loaded = false;

function readLocal(): MolduraFormulaConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeMolduraFormulaConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

function persistLocal(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // storage lleno/bloqueado: no es fatal
  }
}

/**
 * Carga la fórmula: primero la caché local (para tener algo usable offline),
 * y luego intenta el backend compartido. Si el backend responde, gana y se
 * persiste localmente. Aplica el resultado al estado global de molduras.ts.
 */
export async function load(): Promise<MolduraFormulaConfig> {
  cache = readLocal() ?? cloneMolduraFormula(DEFAULT_MOLDURA_FORMULA);
  setMolduraFormulaConfig(cache);
  try {
    const remote = await api.getMolduraFormula();
    if (remote) {
      cache = normalizeMolduraFormulaConfig(remote);
      setMolduraFormulaConfig(cache);
      persistLocal();
    }
  } catch {
    // sin backend: se sigue con local/defaults
  }
  loaded = true;
  return cache;
}

async function ensureLoaded(): Promise<void> {
  if (!loaded) await load();
}

export function getConfig(): MolduraFormulaConfig {
  return cache;
}

export function hasLoaded(): boolean {
  return loaded;
}

/** Guarda la fórmula: aplica al instante, persiste local y hace PUT best-effort. */
export async function save(cfg: MolduraFormulaConfig, changedBy?: string): Promise<MolduraFormulaConfig> {
  await ensureLoaded();
  cache = normalizeMolduraFormulaConfig(cfg);
  setMolduraFormulaConfig(cache);
  persistLocal();
  try {
    await api.saveMolduraFormula(cache, changedBy);
  } catch {
    // backend ausente: la config queda local hasta el próximo guardado
  }
  return cache;
}

/** Historial de versiones (backend compartido). Devuelve [] si no hay backend. */
export async function getHistory(limit = 100): Promise<MolduraFormulaHistoryEntry[]> {
  try {
    const list = await api.getMolduraFormulaHistory(limit);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function resetDefaults(): MolduraFormulaConfig {
  cache = cloneMolduraFormula(DEFAULT_MOLDURA_FORMULA);
  setMolduraFormulaConfig(cache);
  persistLocal();
  return cache;
}

export { DEFAULT_MOLDURA_FORMULA, cloneMolduraFormula };
