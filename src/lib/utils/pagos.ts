import { dateKey } from '$lib/types';
import type { Pago } from '$lib/types';

export interface PagoMetodoStat {
  metodo: string;
  count: number;
  total: number;
  /** Porcentaje sobre la cantidad de pagos (0-100). */
  pctCount: number;
  /** Porcentaje sobre el monto total (0-100). */
  pctTotal: number;
}

export interface PagoClienteStat {
  key: string;
  cliente: string;
  count: number;
  total: number;
  promedio: number;
  ultimo: string;
  ultimoKey: number;
  metodos: PagoMetodoStat[];
  /** Método más usado por cantidad. */
  preferido: string;
  preferidoPct: number;
  mixto: boolean;
}

export interface PagoFilterOptions {
  q?: string;
  /** Cadena vacía = todos. */
  metodo?: string;
  /** Cadena vacía = todos. */
  destino?: '' | 'PROVIDER' | 'EMPLOYEE' | 'NONE';
  start?: string;
  end?: string;
}

/** Minúsculas sin acentos y con espacios colapsados. */
export function normalizeTexto(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Unifica las variantes que existen en la base (`efectivo`, `Efectivo `,
 * `transferencia bancaria`, etc.). Los valores desconocidos se conservan.
 */
export function normalizeMetodo(value: string | null | undefined): string {
  const raw = (value || '').trim();
  if (!raw) return 'Sin especificar';
  const n = normalizeTexto(raw);
  if (n.includes('efect')) return 'Efectivo';
  if (n.includes('transf')) return 'Transferencia';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function destinoPago(p: Pago): 'PROVIDER' | 'EMPLOYEE' | 'NONE' {
  if (p.entity_type === 'PROVIDER') return 'PROVIDER';
  if (p.entity_type === 'EMPLOYEE') return 'EMPLOYEE';
  return 'NONE';
}

export function destinoLabel(p: Pago): string {
  const destino = destinoPago(p);
  if (destino === 'PROVIDER') return 'Proveedor';
  if (destino === 'EMPLOYEE') return 'Empleado';
  return '—';
}

export function filterPagos(pagos: Pago[], opts: PagoFilterOptions = {}): Pago[] {
  const q = normalizeTexto(opts.q);
  const metodo = opts.metodo ? normalizeMetodo(opts.metodo) : '';
  const destino = opts.destino || '';
  const startKey = opts.start ? dateKey(opts.start) : 0;
  const endKey = opts.end ? dateKey(opts.end) : 0;

  return pagos.filter((p) => {
    const k = dateKey(p.date);
    if ((startKey || endKey) && !k) return false;
    if (startKey && k < startKey) return false;
    if (endKey && k > endKey) return false;
    if (metodo && normalizeMetodo(p.method) !== metodo) return false;
    if (destino && destinoPago(p) !== destino) return false;
    if (q) {
      const haystack = normalizeTexto(
        `${p.extra_client_name || ''} ${p.extra_invoice_num || ''} ${p.method || ''}`
      );
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function buildMetodoResumen(pagos: Pago[]): PagoMetodoStat[] {
  const map = new Map<string, { count: number; total: number }>();
  let totalCount = 0;
  let totalAmount = 0;

  for (const p of pagos) {
    const metodo = normalizeMetodo(p.method);
    const amount = Number(p.amount) || 0;
    const cur = map.get(metodo) || { count: 0, total: 0 };
    cur.count += 1;
    cur.total += amount;
    map.set(metodo, cur);
    totalCount += 1;
    totalAmount += amount;
  }

  return [...map.entries()]
    .map(([metodo, v]) => ({
      metodo,
      count: v.count,
      total: v.total,
      pctCount: totalCount ? (v.count / totalCount) * 100 : 0,
      pctTotal: totalAmount ? (v.total / totalAmount) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count || b.total - a.total || a.metodo.localeCompare(b.metodo));
}

export function metodoStat(metodos: PagoMetodoStat[], metodo: string): PagoMetodoStat | null {
  return metodos.find((m) => m.metodo === metodo) ?? null;
}

/**
 * Agrupa por cliente (nombre normalizado) y calcula su forma de pago
 * preferente por **cantidad de pagos**. Si el método top concentra menos del
 * 60% se marca como `Mixto`.
 */
export function computeClientePagoStats(pagos: Pago[]): PagoClienteStat[] {
  interface Acc {
    cliente: string;
    count: number;
    total: number;
    ultimo: string;
    ultimoKey: number;
    metodos: Map<string, { count: number; total: number }>;
  }

  const map = new Map<string, Acc>();

  for (const p of pagos) {
    const nombre = (p.extra_client_name || '').trim() || 'Desconocido';
    const key = normalizeTexto(nombre) || 'desconocido';
    const amount = Number(p.amount) || 0;
    const k = dateKey(p.date);

    let acc = map.get(key);
    if (!acc) {
      acc = { cliente: nombre, count: 0, total: 0, ultimo: '', ultimoKey: 0, metodos: new Map() };
      map.set(key, acc);
    }

    acc.count += 1;
    acc.total += amount;
    if (k >= acc.ultimoKey) {
      acc.ultimoKey = k;
      acc.ultimo = p.date || '';
      acc.cliente = nombre;
    }

    const metodo = normalizeMetodo(p.method);
    const m = acc.metodos.get(metodo) || { count: 0, total: 0 };
    m.count += 1;
    m.total += amount;
    acc.metodos.set(metodo, m);
  }

  const out: PagoClienteStat[] = [];
  for (const [key, acc] of map) {
    const metodos: PagoMetodoStat[] = [...acc.metodos.entries()]
      .map(([metodo, v]) => ({
        metodo,
        count: v.count,
        total: v.total,
        pctCount: acc.count ? (v.count / acc.count) * 100 : 0,
        pctTotal: acc.total ? (v.total / acc.total) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count || b.total - a.total || a.metodo.localeCompare(b.metodo));

    const top = metodos[0];
    const preferidoPct = top && acc.count ? (top.count / acc.count) * 100 : 0;
    const mixto = metodos.length > 1 && preferidoPct < 60;

    out.push({
      key,
      cliente: acc.cliente,
      count: acc.count,
      total: acc.total,
      promedio: acc.count ? acc.total / acc.count : 0,
      ultimo: acc.ultimo,
      ultimoKey: acc.ultimoKey,
      metodos,
      // Siempre el método con más pagos; `mixto` solo avisa que el reparto
      // está parejo (el top no llega al 60%).
      preferido: top?.metodo ?? 'Sin especificar',
      preferidoPct,
      mixto,
    });
  }

  return out;
}

/** `2024-03-05` o `5/3/2024` → `05/03/2024`. */
export function formatFechaPago(value: string | null | undefined): string {
  if (!value) return '—';
  const k = dateKey(value);
  if (!k) return value;
  const y = Math.floor(k / 10000);
  const m = Math.floor((k % 10000) / 100);
  const d = k % 100;
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

export function formatFechaHora(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
