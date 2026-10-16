import type { Factura } from '$lib/types';
import { parseFecha } from '$lib/types';

export const NO_CONFIRMADO = 'NO_CONFIRMADO';
export const DIAS_PURGA_NO_CONFIRMADO = 30;

export function facturasActivas(facturas: Factura[]): Factura[] {
  return facturas.filter(f => f.estado_kanban !== NO_CONFIRMADO);
}

export function isNoConfirmado(f: Factura): boolean {
  return f.estado_kanban === NO_CONFIRMADO;
}

function fechaOrigenFactura(f: Factura): Date | null {
  // Prefer created_at (ISO), fallback a fecha DD/MM/YYYY o YYYY-MM-DD
  if (f.created_at) {
    const d = new Date(f.created_at);
    if (!isNaN(d.getTime())) return d;
  }
  if (f.fecha) {
    try {
      const d = parseFecha(f.fecha);
      if (!isNaN(d.getTime()) && d.getTime() !== 0) return d;
    } catch {}
  }
  return null;
}

export function diasDesdeCreacion(f: Factura, now = new Date()): number | null {
  const origen = fechaOrigenFactura(f);
  if (!origen) return null;
  const a = new Date(origen); a.setHours(0, 0, 0, 0);
  const b = new Date(now); b.setHours(0, 0, 0, 0);
  const diff = b.getTime() - a.getTime();
  return Math.floor(diff / 86400000);
}

export function isVencidaNoConfirmada(f: Factura, dias = DIAS_PURGA_NO_CONFIRMADO, now = new Date()): boolean {
  if (!isNoConfirmado(f)) return false;
  const d = diasDesdeCreacion(f, now);
  if (d === null) return false;
  return d >= dias;
}

export function getVencidasNoConfirmadas(facturas: Factura[], dias = DIAS_PURGA_NO_CONFIRMADO, now = new Date()): Factura[] {
  return facturas.filter(f => isVencidaNoConfirmada(f, dias, now));
}

export function diasRestantesNoConfirmada(f: Factura, dias = DIAS_PURGA_NO_CONFIRMADO, now = new Date()): number | null {
  const d = diasDesdeCreacion(f, now);
  if (d === null) return null;
  return dias - d;
}

// ── Tiempos de entrega (estadística anual) ──
// origen = created_at (ISO) ?? fecha DD/MM/YYYY — truncado a día
// entrega = entregado_at (UTC sin Z desde backend) — interpretado como UTC y truncado a día AR

function parseEntregadoAtUTC(val: string | null | undefined): Date | null {
  if (!val) return null;
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(val) ? val : val + 'Z';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

function truncDiaLocal(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** Días entre creación y entrega real. null si no ENTREGADO, sin fechas o inválido. */
export function diasDemoraEntrega(f: Factura): number | null {
  if ((f.estado_entrega || 'PENDIENTE') !== 'ENTREGADO') return null;
  const origen = fechaOrigenFactura(f);
  const entrega = parseEntregadoAtUTC(f.entregado_at);
  if (!origen || !entrega) return null;
  const diff = truncDiaLocal(entrega).getTime() - truncDiaLocal(origen).getTime();
  const dias = Math.floor(diff / 86400000);
  // negativos (toggle/reentrega) o >365 se consideran inválidos, no promedian
  if (dias < 0 || dias > 365) return null;
  return dias;
}

/** Fecha de entrega como día (para filtrar por rango anual). null si no hay. */
export function diaEntregaFactura(f: Factura): Date | null {
  const entrega = parseEntregadoAtUTC(f.entregado_at);
  if (!entrega) return null;
  return truncDiaLocal(entrega);
}

/** Normaliza descripción libre para promediar por producto. */
export function normalizarProducto(desc: string | null | undefined): string {
  if (!desc) return 'sin descripción';
  return desc.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ── Clasificación por tipo de pedido (híbrido B+A) ──
// B = variante detectada (quitando medida + categoría, como Facturación)
// A = fallback por palabras clave sobre el texto completo.
// Orden de prioridad: rollo > pintura > sin tela > entelado > bastidor suelto > otros.

export type TipoPedido = 'entelado' | 'sin_tela' | 'pintura' | 'rollo' | 'otros';

export const TIPOS_PEDIDO: { key: TipoPedido; label: string; hint: string }[] = [
  { key: 'entelado', label: 'Bastidor entelado', hint: 'Lienzo, lona, doble o bastidor sin variante (default)' },
  { key: 'sin_tela', label: 'Bastidor sin tela', hint: 'Sin tela / sintela' },
  { key: 'pintura', label: 'Pinturas', hint: 'Pintura / pinturas' },
  { key: 'rollo', label: 'Rollo de tela', hint: 'Rollo (no pasa por producción)' },
  { key: 'otros', label: 'Otros', hint: 'Tapacanto, acrílico, marcos… (revisar)' },
];

function normTipo(s: string | null | undefined): string {
  let t = (s || '').toLowerCase().trim();
  t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  t = t.replace(/\s+/g, ' ');
  // "sintela" pegado ⇔ "sin tela"
  t = t.replace(/sintela/g, 'sin tela');
  return t;
}

/** Quita medida (40x50, 40 x 50 x 5) y categoría inicial → deja la variante. */
function extraerVariante(t: string): string {
  let v = t.replace(/\d+(?:[.,]\d+)?\s*x\s*\d+(?:[.,]\d+)?(?:\s*x\s*\d+(?:[.,]\d+)?)?/g, ' ');
  v = v.replace(/^(bastidores|bastidor|pinturas|pintura|acrilicos|acrilico|rollos|rollo|tapacantos|tapacanto|marcos|marco|fibro|circular|circulares)\s+/, '');
  return v.replace(/\s+/g, ' ').trim();
}

const SIN_TELA_RE = /(^|\s)sin\s+tela(\s|$)/;
const ENTEL_RE = /(entel|lienzo|lona|doble)/;
export function clasificarTipoPedido(desc: string | null | undefined): TipoPedido {
  const t = normTipo(desc);
  if (!t) return 'otros';
  if (t.includes('rollo')) return 'rollo';
  if (t.includes('pintura')) return 'pintura';
  // B: variante limpia primero
  const v = extraerVariante(t);
  const hay = (re: RegExp) => re.test(v) || re.test(t);
  if (hay(SIN_TELA_RE)) return 'sin_tela';
  if (hay(ENTEL_RE)) return 'entelado';
  // A: fallback — bastidor suelto se asume entelado (es el default del taller)
  if (t.includes('bastidor')) return 'entelado';
  return 'otros';
}

/**
 * Base para sub-agrupar dentro de un tipo: quita medidas (40x50, 40 x 50 x 5)
 * y el prefijo de categoría grande (bastidor/pintura/rollo), conservando el
 * texto original (mayúsculas y acentos). Ej: "Bastidor 50 x 70 Lienzo
 * Profesional" → "Lienzo Profesional"; "Corte de tela 2 x 2 · 4" → "Corte de tela".
 */
export function baseAgrupada(desc: string | null | undefined): { key: string; display: string } {
  const orig = (desc || '').trim();
  if (!orig) return { key: 'sin descripcion', display: 'Sin descripción' };
  let d = orig
    .replace(/\d+(?:[.,]\d+)?\s*x\s*\d+(?:[.,]\d+)?(?:\s*x\s*\d+(?:[.,]\d+)?)?/gi, ' ')
    .replace(/^(bastidores|bastidor|pinturas|pintura|rollos|rollo)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-–—.,;:\s]+|[-–—.,;:\s]+$/g, '');
  if (!d) d = orig.split(/\s+/)[0] || orig;
  return { key: normTipo(d), display: d };
}

export function mediana(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function percentil(vals: number[], p: number): number | null {
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return s[Math.max(0, idx)];
}
