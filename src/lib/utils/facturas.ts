import type { Factura } from '$lib/types';
import { parseFecha } from '$lib/types';

export const NO_CONFIRMADO = 'NO_CONFIRMADO';
export const DIAS_PURGA_NO_CONFIRMADO = 15;

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
