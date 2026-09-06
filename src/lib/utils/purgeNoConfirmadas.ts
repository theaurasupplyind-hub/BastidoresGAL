import { api } from '$lib/api/client';
import { cacheStore } from '$lib/stores/cacheStore.svelte';
import { appStore } from '$lib/stores/appStore.svelte';
import { getVencidasNoConfirmadas, DIAS_PURGA_NO_CONFIRMADO } from '$lib/utils/facturas';
import type { Factura } from '$lib/types';

const LAST_PURGE_KEY = 'last_purge_no_confirmado';
const PURGE_THROTTLE_MS = 12 * 60 * 60 * 1000; // 12h

function shouldRunPurge(): boolean {
  try {
    const raw = localStorage.getItem(LAST_PURGE_KEY);
    if (!raw) return true;
    const last = new Date(raw).getTime();
    if (isNaN(last)) return true;
    return Date.now() - last > PURGE_THROTTLE_MS;
  } catch { return true; }
}

function markPurged() {
  try { localStorage.setItem(LAST_PURGE_KEY, new Date().toISOString()); } catch {}
}

export async function purgeNoConfirmadasVencidas(opts?: { force?: boolean; silent?: boolean; dias?: number }): Promise<number> {
  const dias = opts?.dias ?? DIAS_PURGA_NO_CONFIRMADO;
  const force = opts?.force ?? false;
  const silent = opts?.silent ?? false;

  if (!force && !shouldRunPurge()) return 0;

  try {
    // 1) Intentar limpieza server-side (cuando el backend la soporte)
    try {
      const res: any = await api.cleanupNoConfirmadas(dias);
      const deleted = typeof res?.deleted === 'number' ? res.deleted : 0;
      if (deleted > 0) {
        cacheStore.invalidate('facturas');
        cacheStore.invalidate('facturas:no_confirmado');
        cacheStore.invalidate('pagos');
        markPurged();
        if (!silent) appStore.showToast(`${deleted} presupuesto(s) no confirmado(s) >${dias} días enviado(s) a papelera`, 'info');
        return deleted;
      }
      // si backend no borró nada, caer a fallback local para cubrir facturas ya cacheadas
    } catch {}

    // 2) Fallback local: filtrar NO_CONFIRMADO >15 días y soft-delete a papelera
    let noConfirmadas: Factura[] = [];
    try {
      noConfirmadas = await api.listFacturas({ estado_kanban: 'NO_CONFIRMADO', limit: 2000, with_items: false }) as Factura[];
    } catch {
      // si falla listado filtrado, intentar con cache general
      const all = await cacheStore.fetch('facturas', () => api.listFacturas({ limit: 2000 }), 300000) as Factura[];
      noConfirmadas = all.filter(f => f.estado_kanban === 'NO_CONFIRMADO');
    }

    const vencidas = getVencidasNoConfirmadas(noConfirmadas, dias);
    if (vencidas.length === 0) {
      markPurged();
      return 0;
    }

    // Evitar borrar facturas que ya tienen pagos (saldo parcial = confirmación implícita)
    let conPagos = new Set<number>();
    try {
      const pagos = await api.listPagos();
      for (const p of pagos as any[]) if (p.amount > 0 && p.invoice_id) conPagos.add(p.invoice_id);
    } catch {}
    const aEliminar = vencidas.filter(f => !conPagos.has(f.id));

    if (aEliminar.length === 0) {
      markPurged();
      return 0;
    }

    const results = await Promise.allSettled(aEliminar.map(f => api.deleteFactura(f.id)));
    const ok = results.filter(r => r.status === 'fulfilled').length;
    const fail = results.length - ok;

    cacheStore.invalidate('facturas');
    cacheStore.invalidate('facturas:no_confirmado');
    markPurged();

    if (!silent && ok > 0) {
      appStore.showToast(`${ok} presupuesto(s) no confirmado(s) >${dias} días enviado(s) a papelera${fail ? ` (${fail} error)` : ''}`, fail ? 'error' : 'info');
    } else if (fail > 0 && !silent) {
      appStore.showToast(`Error al purgar ${fail} factura(s) no confirmadas`, 'error');
    }
    return ok;
  } catch (e: any) {
    if (!silent) console.warn('[purgeNoConfirmadas] error', e);
    return 0;
  }
}

export function forcePurgeNoConfirmadas(dias = DIAS_PURGA_NO_CONFIRMADO): Promise<number> {
  return purgeNoConfirmadasVencidas({ force: true, dias });
}
