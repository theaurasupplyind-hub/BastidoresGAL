import type { Factura } from '$lib/types';
import { parseCard, hasMolduraItems } from '$lib/utils/molduras';
import * as materialRules from './molduraMaterialRules';
import * as hiddenRules from './molduraHiddenRules';

export type ParsedCardWithRules = ReturnType<typeof parseCard> & { hasMoldura: boolean };

// Carga las dos listas de reglas ("Sin materiales" y "Ocultos en producción").
// Hay que esperarla antes de parsear tarjetas: si no, getKeywords() devuelve
// una lista vacía y las reglas no se aplican.
export async function loadRuleKeywords(): Promise<void> {
  await Promise.all([materialRules.load(), hiddenRules.load()]);
}

// parseCard() + las reglas configuradas por el usuario. Punto único para que
// pantalla, modal, PDF de Kanban e impresión remota den exactamente lo mismo.
export function parseCardWithRules(f: Factura): ParsedCardWithRules {
  const p = parseCard(f, materialRules.getKeywords(), hiddenRules.getKeywords());
  return { ...p, hasMoldura: hasMolduraWithRules(f) };
}

// Misma detección que usa parseCardWithRules, para chequeos sueltos (ej. el
// buscador de facturas) sin parsear la tarjeta entera.
export function hasMolduraWithRules(f: Factura): boolean {
  return hasMolduraItems(f, undefined, hiddenRules.getKeywords());
}
