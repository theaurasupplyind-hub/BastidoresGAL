import { api } from '$lib/api/client';
import { parse2DItem, calcMaterials, applyCorrection, consolidateMaterials, syncItemStrings } from '$lib/utils/molduras';
import type { CardItem, CardMaterial } from '$lib/utils/molduras';

export interface MolduraCorrectionLocal {
  id: number;
  invoice_id: number;
  item_descripcion: string;
  width: number;
  height: number;
  qty: number;
  larguero_qty: number;
  larguero_cm: number;
  travesano_qty: number;
  travesano_cm: number;
  updated_at: string;
}

export interface MolduraCorrectionInput {
  invoice_id: number;
  item_descripcion: string;
  width: number;
  height: number;
  qty: number;
  larguero_qty: number;
  larguero_cm: number;
  travesano_qty: number;
  travesano_cm: number;
}

const LEGACY_KEY = 'moldura-corrections';

let cache: MolduraCorrectionLocal[] = [];
let loaded = false;

async function migrateIfNeeded(): Promise<number> {
  let items: MolduraCorrectionLocal[] = [];
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) items = arr;
    }
  } catch {
    // clave ilegible: se ignora
  }
  if (items.length === 0) return 0;
  try {
    for (const c of items) {
      await api.saveMolduraCorrection({
        invoice_id: c.invoice_id,
        item_descripcion: c.item_descripcion,
        width: c.width,
        height: c.height,
        qty: c.qty,
        larguero_qty: c.larguero_qty,
        larguero_cm: c.larguero_cm,
        travesano_qty: c.travesano_qty,
        travesano_cm: c.travesano_cm,
      });
    }
  } catch {
    // si algo falla se deja la clave intacta (se reintenta en el próximo load)
    return 0;
  }
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // no se pudo limpiar: no es fatal
  }
  return items.length;
}

export async function load(): Promise<number> {
  await migrateIfNeeded();
  cache = await api.getAllMolduraCorrections();
  loaded = true;
  return cache.length;
}

async function ensureLoaded(): Promise<void> {
  if (!loaded) await load();
}

export function getByInvoice(invoiceId: number): MolduraCorrectionLocal[] {
  return cache.filter(c => c.invoice_id === invoiceId);
}

export function getAll(): MolduraCorrectionLocal[] {
  return [...cache].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
}

export async function save(input: MolduraCorrectionInput): Promise<MolduraCorrectionLocal> {
  await ensureLoaded();
  const saved = await api.saveMolduraCorrection(input);
  const idx = cache.findIndex(
    c => c.invoice_id === input.invoice_id && c.item_descripcion === input.item_descripcion
  );
  if (idx >= 0) cache[idx] = saved;
  else cache.push(saved);
  return saved;
}

export async function removeForItem(invoiceId: number, itemDescripcion: string): Promise<boolean> {
  await ensureLoaded();
  const item = cache.find(
    c => c.invoice_id === invoiceId && c.item_descripcion === itemDescripcion
  );
  if (!item) return false;
  try {
    await api.deleteMolduraCorrection(item.id);
  } catch (e: any) {
    if (!String(e?.message ?? '').includes('404')) throw e;
  }
  cache = cache.filter(c => c.id !== item.id);
  return true;
}

export function match(w: number, h: number): MolduraCorrectionLocal | null {
  const items = cache;
  if (items.length === 0) return null;
  const same = (a: number, b: number) => Math.abs(a - b) < 0.01;
  const byDims = items.filter(
    c => (same(c.width, w) && same(c.height, h)) || (same(c.width, h) && same(c.height, w))
  );
  if (byDims.length === 0) return null;
  return [...byDims].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))[0];
}

export function effectiveFor(
  invoiceId: number,
  medida: string,
  w: number,
  h: number,
  qty: number
): { corr: MolduraCorrectionLocal; inherited: boolean } | null {
  const exact = getByInvoice(invoiceId).find(c => c.item_descripcion === medida);
  if (exact) return { corr: exact, inherited: false };
  const m = match(w, h);
  if (!m) return null;
  const srcQty = m.qty || 1;
  return {
    corr: {
      ...m,
      qty,
      larguero_qty: Math.round(m.larguero_qty / srcQty) * qty,
      travesano_qty: Math.round(m.travesano_qty / srcQty) * qty,
    },
    inherited: true,
  };
}

export function applyCorrectionsToCard(card: {
  id: number;
  items: CardItem[];
  materials: CardMaterial[];
  hasCorrection?: boolean;
}): void {
  const allMats: CardMaterial[] = [];
  for (const it of card.items) {
    const m = parse2DItem(it.medida);
    if (!m || !m.w || !m.h) continue;
    const formula = calcMaterials(m.w, m.h, it.cantidad);
    const eff = effectiveFor(card.id, it.medida, m.w, m.h, it.cantidad);
    const itemMats = eff ? applyCorrection(formula, eff.corr) : formula;
    it.hasCorrection = !!eff;
    it.correctionInherited = eff ? eff.inherited : false;
    syncItemStrings(it, itemMats);
    allMats.push(...itemMats);
  }
  card.materials = consolidateMaterials(allMats);
  card.hasCorrection = card.items.some(i => i.hasCorrection);
}
