import type { Factura } from '$lib/types';

export const NO_CONFIRMADO = 'NO_CONFIRMADO';

export function facturasActivas(facturas: Factura[]): Factura[] {
  return facturas.filter(f => f.estado_kanban !== NO_CONFIRMADO);
}
