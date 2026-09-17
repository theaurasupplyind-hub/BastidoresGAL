import { invoke } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

const API_URL = 'https://api-bastidores.onrender.com';

type TaskImageRef = { id: number; created_at?: string | null; url?: string | null };

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  timeout = 15
): Promise<T> {
  const url = `${API_URL}${path}`;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout * 1000);

  try {
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'FacBalApp/2.0' },
      signal: controller.signal,
    };
    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }
    const res = await tauriFetch(url, options);
    clearTimeout(id);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      let detail = text;
      try {
        const j = JSON.parse(text);
        if (j?.detail) {
          if (Array.isArray(j.detail)) {
            detail = j.detail.map((d: any) => d.msg || d.message || JSON.stringify(d)).join(' | ');
          } else if (typeof j.detail === 'string') detail = j.detail;
          else detail = JSON.stringify(j.detail);
        } else if (j?.message) detail = j.message;
      } catch {}
      const short = detail.length > 400 ? detail.slice(0, 400) : detail;
      throw new Error(short ? `Error ${res.status}: ${short}` : `Error ${res.status}`);
    }

    if (res.status === 204) return undefined as T;
    return res.json();
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

function handleResponse<T>(data: Promise<T>, fallback: T): Promise<T> {
  return data.then(d => (d === undefined ? fallback : d));
}

export const api = {

  wakeServer: () => request<{ status: string }>('GET', '/sync/status'),

  heartbeat: (userId: number, userName: string) =>
    request('POST', '/heartbeat', { user_id: userId, username: userName }, 3),

  reportDraft: (userId: number, clientName: string) =>
    request('POST', '/invoices/draft', { user_id: userId, client_name: clientName }, 3),

  // ---- Users ----
  getUsers: () => handleResponse(request<any[]>('GET', '/users', undefined, 3), []),
  getActiveUsers: () => handleResponse(request<any[]>('GET', '/users/active', undefined, 3), []),
  getDrafts: () => handleResponse(request<any[]>('GET', '/invoices/drafts', undefined, 3), []),

  // ---- Clientes ----
  listClientes: () => handleResponse(request<import('$lib/types').Cliente[]>('GET', '/clients'), []),

  getCliente: (id: number) =>
    request<import('$lib/types').Cliente | null>('GET', `/clients/${id}`),

  addCliente: (data: { nombre: string; domicilio: string; telefono: string; taller?: string; estudiante?: string }) =>
    request<{ id: number }>('POST', '/clients', data),

  updateCliente: (id: number, data: any) =>
    request('PUT', `/clients/${id}`, data),

  deleteCliente: async (id: number) => {
    const res = await tauriFetch(`${API_URL}/clients/${id}`, { method: 'DELETE' });
    if (![200, 204].includes(res.status)) {
      throw new Error('No se puede eliminar: El cliente tiene datos asociados (facturas).');
    }
  },

  mergeClients: async (sourceIds: number[], targetId: number) => {
    const facturas = await api.listFacturas({ limit: 2000 });
    const errors: string[] = [];
    // Cache de direcciones del destino para dedup (idénticas = mismo address+extra+label normalizados)
    const targetAddrs = await api.listAddresses(targetId);
    const norm = (v: any) => (v == null ? '' : String(v).trim());
    const keyOf = (a: { address: string; extra?: string | null; label?: string | null }) =>
      `${norm(a.address).toLowerCase()}|${norm(a.extra).toLowerCase()}|${norm(a.label).toLowerCase()}`;
    const targetKeys = new Set(targetAddrs.map(keyOf));
    const targetHasDefault = targetAddrs.some(a => a.is_default);

    for (const sid of sourceIds) {
      const srcFacturas = facturas.filter(f => f.cliente_id === sid);
      for (const inv of srcFacturas) {
        try {
          await request('PATCH', `/invoices/${inv.id}`, { cliente_id: targetId });
        } catch (e: any) {
          errors.push(`Factura ${inv.numero_factura || inv.id}: ${e.message || String(e)}`);
        }
      }

      let dirs: import('$lib/types').ClientAddress[] = [];
      try {
        dirs = await api.listAddresses(sid);
      } catch (e: any) {
        errors.push(`No se pudieron leer direcciones de cliente ${sid}: ${e.message || String(e)}`);
        dirs = [];
      }

      for (const d of dirs) {
        const address = norm(d.address);
        if (!address) {
          try { await api.deleteAddress(sid, d.id); } catch {}
          continue;
        }
        const extra = norm(d.extra);
        const label = norm(d.label);
        const key = `${address.toLowerCase()}|${extra.toLowerCase()}|${label.toLowerCase()}`;
        if (targetKeys.has(key)) {
          // Idéntica -> deduplicar, solo borrar origen
          try { await api.deleteAddress(sid, d.id); } catch (e: any) {
            errors.push(`Dirección duplicada '${address}' no se pudo eliminar del origen: ${e.message || String(e)}`);
          }
          continue;
        }
        // Diferente -> acumular en destino, siempre is_default false para no robar default
        try {
          await api.addAddress(targetId, {
            address,
            extra: extra || undefined,
            label: label || undefined,
            is_default: false,
            lat: d.lat ?? null,
            lng: d.lng ?? null,
          });
          targetKeys.add(key);
          await api.deleteAddress(sid, d.id);
        } catch (e: any) {
          const msg = e.message || String(e);
          errors.push(`Dirección '${address}${extra ? ' - ' + extra : ''}': ${msg}`);
          // No borrar origen si falló el copiado, para no perder datos
        }
      }

      try {
        await api.deleteCliente(sid);
      } catch {
        try {
          const res = await tauriFetch(`${API_URL}/clients/${sid}?force=true`, { method: 'DELETE' });
          if (![200, 204].includes(res.status)) {
            const t = await res.text().catch(() => '');
            errors.push(`No se pudo eliminar cliente ${sid}: ${t || res.status}`);
          }
        } catch (e: any) {
          errors.push(`No se pudo eliminar cliente ${sid}: ${e.message || String(e)}`);
        }
      }
    }

    // Si el destino no tenía default y se copiaron direcciones, no promovemos automáticamente para respetar el default de Claudio Quiroga

    if (errors.length > 0) {
      throw new Error(errors.join(' | '));
    }
  },

  // ---- Direcciones ----
  listAddresses: (clientId: number) =>
    handleResponse(request<import('$lib/types').ClientAddress[]>('GET', `/clients/${clientId}/addresses`), []),

  addAddress: (clientId: number, data: { address: string; extra?: string; label?: string; is_default?: boolean; lat?: number | null; lng?: number | null }) =>
    request<import('$lib/types').ClientAddress>('POST', `/clients/${clientId}/addresses`, data),

  updateAddress: (clientId: number, addressId: number, data: any) =>
    request('PUT', `/clients/${clientId}/addresses/${addressId}`, data),

  deleteAddress: async (clientId: number, addressId: number) => {
    const res = await tauriFetch(`${API_URL}/clients/${clientId}/addresses/${addressId}`, { method: 'DELETE' });
    if (![200, 204].includes(res.status)) throw new Error('Error al eliminar dirección');
  },

  setDefaultAddress: (clientId: number, addressId: number) =>
    request('PUT', `/clients/${clientId}/addresses/${addressId}/default`),

  saveClientPreference: (clientId: number, tipoEntrega: string) =>
    request('PATCH', `/clients/${clientId}/preference`, { ultimo_tipo_entrega: tipoEntrega }),

  // ---- Talleres (taller → dirección) ----
  listTalleres: () =>
    handleResponse(request<import('$lib/types').TallerDireccion[]>('GET', '/talleres', undefined, 8), []),

  addTaller: (data: { taller: string; direccion?: string }) =>
    request<{ id: number }>('POST', '/talleres', data, 5),

  updateTaller: (id: number, data: { taller?: string; direccion?: string }) =>
    request('PUT', `/talleres/${id}`, data),

  deleteTaller: async (id: number) => {
    const res = await tauriFetch(`${API_URL}/talleres/${id}`, { method: 'DELETE' });
    if (![200, 204].includes(res.status)) throw new Error('Error al eliminar el taller');
  },

  // ---- Mapa ----
  getMapaClientes: () => handleResponse(request<any[]>('GET', '/mapa/clientes', undefined, 15), []),

  getMapaEntregas: (fecha: string) =>
    handleResponse(request<any[]>('GET', `/mapa/entregas?fecha=${fecha}`, undefined, 15), []),

  geocodificarCliente: (id: number) =>
    request<{ status: string; lat: number; lng: number }>('POST', `/mapa/geocodificar/${id}`, undefined, 15),

  geocodificarAddress: (clientId: number, addressId: number) =>
    request<{ status: string; lat: number; lng: number }>('POST', `/clients/${clientId}/addresses/${addressId}/geocode`, undefined, 15),

  geocodificarFactura: (facturaId: number) =>
    request<{ status: string; lat: number; lng: number }>('POST', `/mapa/geocodificar-factura/${facturaId}`, undefined, 15),

  getMapaOrigen: () =>
    handleResponse(request<{ direccion: string; lat: number | null; lng: number | null }>('GET', '/mapa/origen', undefined, 15),
      { direccion: 'Bermudez 331', lat: null, lng: null }),

  updateMapaOrigen: (data: { direccion: string; lat?: number | null; lng?: number | null }) =>
    request<{ status: string; direccion: string; lat: number | null; lng: number | null }>('PUT', '/mapa/origen', data, 15),

  getMapaConfig: () =>
    handleResponse(request<{ cluster_min: number; cluster_max: number; cluster_eps_km: number }>('GET', '/mapa/config', undefined, 15),
      { cluster_min: 3, cluster_max: 6, cluster_eps_km: 8.0 }),

  updateMapaConfig: (data: { cluster_min?: number; cluster_max?: number; cluster_eps_km?: number }) =>
    request<{ status: string; cluster_min: number; cluster_max: number; cluster_eps_km: number }>('PUT', '/mapa/config', data, 15),

  getClusterPending: (fecha = 'plan_permanente') =>
    handleResponse(request<{ factura_id: number; numero_factura: string; cliente_id: number; cliente_nombre: string; cliente_domicilio: string; cliente_piso_depto: string; lat: number; lng: number; ya_en_plan: boolean; cambio_direccion: boolean }[]>('GET', `/mapa/cluster-pending?fecha=${fecha}`, undefined, 15), []),

  getMapaDashboard: (fecha: string, todas = false, recencia_meses = 0) =>
    request<{ clientes: any[]; entregas: any[]; plan: import('$lib/types').PlanDeViaje | null }>('GET', `/mapa/dashboard?fecha=${fecha}&todas=${todas}&recencia_meses=${recencia_meses}`, undefined, 20),

  getPlanViaje: (fecha: string) =>
    request<import('$lib/types').PlanDeViaje | null>('GET', `/mapa/planes?fecha=${fecha}`, undefined, 15),

  savePlanViaje: (data: { fecha: string; grupos: import('$lib/types').GrupoCliente[] }) =>
    request<{ id: string }>('POST', '/mapa/planes', data, 15),

  updatePlanViaje: (id: string, data: { fecha: string; grupos: import('$lib/types').GrupoCliente[] }) =>
    request<{ status: string }>('PUT', `/mapa/planes/${id}`, data, 15),

  deletePlanViaje: (id: string) =>
    request<{ status: string }>('DELETE', `/mapa/planes/${id}`, undefined, 15),

  getRecomendaciones: (fecha: string) =>
    handleResponse(request<{ id: number; grupo_id: string; cliente_id: number; distancia_km: number; cerca_de_cliente_id?: number | null; creado_en: string }[]>('GET', `/mapa/recomendaciones?fecha=${fecha}`, undefined, 15), []),

  saveRecomendaciones: (fecha: string, items: { grupo_id: string; cliente_id: number; distancia_km: number; cerca_de_cliente_id?: number | null }[]) =>
    request<{ status: string; count: number }>('POST', '/mapa/recomendaciones', { fecha, items }, 15),

  mapaOptimizar: (data: { origen: [number, number]; destinos: [number, number][]; prioridades?: Record<string, number> }) =>
    request<{ orden: string[]; geometry: string; distance: number; duration: number }>('POST', '/mapa/optimizar', data, 25),

  mapaRuta: (data: { puntos: [number, number][] }) =>
    request<{ geometry: string; distance: number; duration: number }>('POST', '/mapa/ruta', data, 25),

  mapaMatriz: (data: { origen: [number, number]; destinos: [number, number][] }) =>
    request<{ distances: number[]; durations: number[] }>('POST', '/mapa/matriz', data, 25),

  // ---- Productos ----
  listProductos: () => handleResponse(request<import('$lib/types').Producto[]>('GET', '/products', undefined, 10), []),

  addProducto: async (data: any) => {
    const res = await request<{ id?: string }>('POST', '/products', data, 5);
    return res;
  },

  updateProducto: (id: string, data: any) =>
    request('PUT', `/products/${id}`, data),

  deleteProducto: async (id: string) => {
    const res = await tauriFetch(`${API_URL}/products/${id}`, { method: 'DELETE' });
    if (![200, 204].includes(res.status)) throw new Error('Error del servidor al borrar producto');
  },

  // ---- Facturas ----
  nextInvoiceNumber: (prefix = 'F') =>
    request<{ next_number: string }>('GET', `/invoices/next_number?prefix=${prefix}`, undefined, 5)
      .then(r => r.next_number)
      .catch(() => 'F-00000'),

  listFacturas: (params?: { search?: string; user_id?: number; start?: string; end?: string; limit?: number; estado_entrega?: string; estado_kanban?: string; with_items?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.user_id) q.set('user_id', String(params.user_id));
    if (params?.start) q.set('start', params.start);
    if (params?.end) q.set('end', params.end);
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.estado_entrega) q.set('estado_entrega', params.estado_entrega);
    if (params?.estado_kanban) q.set('estado_kanban', params.estado_kanban);
    if (params?.with_items !== undefined) q.set('with_items', params.with_items ? 'true' : 'false');
    const qs = q.toString();
    return handleResponse(request<import('$lib/types').Factura[]>('GET', `/invoices${qs ? '?' + qs : ''}`, undefined, 25), []);
  },

  getFactura: async (id: number) => {
    try { await request('POST', `/invoices/${id}/lock`, { user_id: 0 }, 2); } catch { }
    const data = await request<any>('GET', `/invoices/${id}`);
    return { factura: data, items: data?.items ?? [] };
  },

  saveFactura: (data: any) =>
    request<{ id: number }>('POST', '/invoices', data),

  updateFactura: (id: number, data: any) =>
    request('PUT', `/invoices/${id}`, data),

  deleteFactura: async (id: number) => {
    const res = await tauriFetch(`${API_URL}/invoices/${id}`, { method: 'DELETE' });
    if (res.status === 404) return;
    if (![200, 204].includes(res.status)) throw new Error(`Error al eliminar: ${res.status}`);
  },

  listTrash: () => handleResponse(request<import('$lib/types').Factura[]>('GET', '/invoices/trash'), []),

  restoreInvoice: (id: number) =>
    request('POST', `/invoices/${id}/restore`),

  permanentDeleteInvoice: async (id: number) => {
    const res = await tauriFetch(`${API_URL}/invoices/${id}/permanent?force=true`, { method: 'DELETE' });
    if (![200, 204].includes(res.status)) throw new Error(`Error al eliminar definitivamente: ${res.status}`);
  },

  patchInvoiceField: (id: number, field: string, value: string) =>
    request('PATCH', `/invoices/${id}`, { [field]: value }),

  cleanupNoConfirmadas: (days = 15) =>
    request<{ deleted: number; ids: number[] }>('POST', `/invoices/cleanup-no-confirmado?days=${days}`, undefined, 25).catch(() => ({ deleted: 0, ids: [] as number[] })),

  setImpresas: (ids: number[], mark: boolean, user_name?: string) =>
    request<{ status: string; count: number }>('POST', '/invoices/print/batch', {
      ids,
      user_name,
      action: mark ? 'mark' : 'unmark',
    }),

  // ---- Pagos ----
  listPagos: () => handleResponse(request<import('$lib/types').Pago[]>('GET', '/payments'), []),

  getInvoicesResumen: () =>
    request<{ count: number; facturado: number; deuda: number; cobrado: number }>('GET', '/invoices/resumen'),

  addPago: (data: any) =>
    request('POST', '/payments', data),

  updatePago: (id: number, data: any) =>
    request('PUT', `/payments/${id}`, data),

  deletePago: (id: number) => request('DELETE', `/payments/${id}`),

  // ---- Voucher Reviews (solo lectura) ----
  listVoucherReviews: (params?: { status?: 'pending' | 'seen' | 'all'; from_date?: string; to_date?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.from_date) q.set('from_date', params.from_date);
    if (params?.to_date) q.set('to_date', params.to_date);
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.offset) q.set('offset', String(params.offset));
    const qs = q.toString();
    return handleResponse(request<import('$lib/types').VoucherReview[]>('GET', `/voucher-reviews${qs ? '?' + qs : ''}`, undefined, 20), []);
  },

  getVoucherReviewMediaUrl: (id: number) => `${API_URL}/voucher-reviews/${id}/media`,

  deleteVoucherReview: (id: number) =>
    request<{ status: string }>('DELETE', `/voucher-reviews/${id}`),

  cleanupVoucherReviews: (keep = 200) =>
    request<{ deleted: number; kept: number }>('POST', `/voucher-reviews/cleanup?keep=${keep}`, undefined, 30),

  // ---- Providers ----
  listProviders: () => handleResponse(request<import('$lib/types').Provider[]>('GET', '/providers'), []),
  getProvider: (id: number) => request<any>('GET', `/providers/${id}`),
  addProvider: (data: any) => request<{ id: number }>('POST', '/providers', data),
  updateProvider: (id: number, data: any) => request('PUT', `/providers/${id}`, data),
  deleteProvider: (id: number) => request('DELETE', `/providers/${id}`),
  addProviderMovement: (data: any) => request('POST', '/providers/movements', data),
  deleteProviderMovement: (id: number) => request('DELETE', `/providers/movements/${id}`),
  updateProviderMovement: (id: number, data: any) => request('PUT', `/providers/movements/${id}`, data),

  // ---- Employees ----
  listEmployees: (activeOnly = true) =>
    handleResponse(request<import('$lib/types').Employee[]>('GET', `/employees?active_only=${activeOnly}`), []),
  getEmployee: (id: number) => request<any>('GET', `/employees/${id}`),
  addEmployee: (data: any) => request<{ id: number }>('POST', '/employees', data),
  updateEmployee: (id: number, data: any) => request('PUT', `/employees/${id}`, data),
  deleteEmployee: (id: number) => request('DELETE', `/employees/${id}`),
  hardDeleteEmployee: (id: number) => request('DELETE', `/employees/${id}/hard`),
  addEmployeePayment: (data: any) => request('POST', '/employees/payments', data),
  listEmployeePaymentsRecent: (limit = 100) =>
    handleResponse(request<any[]>('GET', `/employees/payments/recent?limit=${limit}`), []),
  deleteEmployeePayment: (id: number) => request('DELETE', `/employees/payments/${id}`),
  updateEmployeePayment: (id: number, data: any) => request('PUT', `/employees/payments/${id}`, data),

  // ---- Attendance ----
  listAttendance: (employeeId?: number, month?: string) => {
    const q = new URLSearchParams();
    if (employeeId) q.set('employee_id', String(employeeId));
    if (month) q.set('month', month);
    const qs = q.toString();
    return handleResponse(request<import('$lib/types').Attendance[]>('GET', `/attendance${qs ? '?' + qs : ''}`, undefined, 12), []);
  },

  saveAttendanceBulk: (records: any[]) =>
    request('POST', '/attendance/bulk', { records }),
  deleteAttendance: (employee_id: number, date: string) =>
    request('DELETE', `/attendance?employee_id=${employee_id}&date=${encodeURIComponent(date)}`),

  // ---- Price List Images ----
  async uploadPriceListImage(position: number, name: string, file: Uint8Array) {
    const formData = new FormData();
    formData.append('position', String(position));
    formData.append('name', name);
    formData.append('file', new Blob([file], { type: 'image/png' }), name + '.png');
    const url = `${API_URL}/price-list-images`;
    const resp = await tauriFetch(url, { method: 'POST', body: formData });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
    }
    return resp.json();
  },

  listPriceListImages: () =>
    handleResponse(request<{ id: number; name: string; position: number; created_at: string; view_url?: string | null }[]>('GET', '/price-list-images'), []),

  getPriceListViewUrl: (id: number) => `${API_URL}/price-list-images/${id}/view`,

  getPriceListDownloadUrl: (id: number) => `${API_URL}/price-list-images/${id}/download`,

  deletePriceListImage: (id: number) =>
    request<{ status: string }>('DELETE', `/price-list-images/${id}`),

  updatePriceListImage: (id: number, data: { name: string }) =>
    request<{ status: string }>('PATCH', `/price-list-images/${id}`, data),

  // ---- Moldura Corrections ----
  saveMolduraCorrection: (data: {
    invoice_id: number;
    item_descripcion: string;
    width: number;
    height: number;
    qty: number;
    larguero_qty: number;
    larguero_cm: number;
    travesano_qty: number;
    travesano_cm: number;
  }) => request<import('$lib/stores/molduraCorrectionsLocal').MolduraCorrectionLocal>('POST', '/moldura-corrections', data),

  getAllMolduraCorrections: () =>
    handleResponse(request<import('$lib/stores/molduraCorrectionsLocal').MolduraCorrectionLocal[]>('GET', '/moldura-corrections', undefined, 8), []),

  findMolduraCorrection: (w: number, h: number, qty: number = 1) =>
    handleResponse(request<any>('GET', `/moldura-corrections/match?w=${w}&h=${h}&qty=${qty}`, undefined, 8), null),

  getInvoiceCorrections: (invoiceId: number) =>
    handleResponse(request<any[]>('GET', `/moldura-corrections/${invoiceId}`, undefined, 8), []),

  deleteMolduraCorrection: (id: number) =>
    request<{ status: string }>('DELETE', `/moldura-corrections/${id}`),

  // ---- Moldura Material Rules (Sin materiales, por keyword) ----
  getMolduraMaterialRules: () =>
    handleResponse(request<{ id: number | string; keyword: string; normalized?: string; updated_at?: string }[]>('GET', '/moldura-material-rules', undefined, 8), []),

  saveMolduraMaterialRule: (data: { keyword: string }) =>
    request<{ id: number | string; keyword: string; normalized?: string; updated_at?: string }>('POST', '/moldura-material-rules', data, 8),

  deleteMolduraMaterialRule: (id: number | string) =>
    request<{ status: string }>('DELETE', `/moldura-material-rules/${id}`, undefined, 8),

  // ---- Moldura Hidden Rules (Ocultos en producción, por keyword) ----
  getMolduraHiddenRules: () =>
    handleResponse(request<{ id: number | string; keyword: string; normalized?: string; updated_at?: string }[]>('GET', '/moldura-hidden-rules', undefined, 8), []),

  saveMolduraHiddenRule: (data: { keyword: string }) =>
    request<{ id: number | string; keyword: string; normalized?: string; updated_at?: string }>('POST', '/moldura-hidden-rules', data, 8),

  deleteMolduraHiddenRule: (id: number | string) =>
    request<{ status: string }>('DELETE', `/moldura-hidden-rules/${id}`, undefined, 8),

  getAnalisisMensual: (usuarioId: number) =>
    handleResponse(request<import('$lib/types').AnalisisPeriodo | null>('GET', `/analisis/mensual?usuario_id=${usuarioId}`, undefined, 10), null),

  getAnalisisSemanal: (usuarioId: number) =>
    handleResponse(request<import('$lib/types').AnalisisPeriodo | null>('GET', `/analisis/semanal?usuario_id=${usuarioId}`, undefined, 10), null),

  getAnalisisHistorial: (usuarioId: number) =>
    handleResponse(request<import('$lib/types').AnalisisPeriodo[]>('GET', `/analisis/mensual/historial?usuario_id=${usuarioId}`, undefined, 10), []),

  getPreciosReferencia: () =>
    handleResponse(request<import('$lib/types').PrecioReferencia[]>('GET', '/precios-referencia', undefined, 10), []),

  importPreciosReferencia: (rows: import('$lib/types').PrecioReferencia[]) =>
    request<{ status: string; imported: number }>('POST', '/precios-referencia/import', { rows }, 15),

  // ---- Pricing Rules ----
  getPricingRules: () =>
    handleResponse(request<import('$lib/types').PricingRule[]>('GET', '/pricing-rules', undefined, 10), []),

  savePricingRule: (data: Omit<import('$lib/types').PricingRule, 'id'>) =>
    request<import('$lib/types').PricingRule>('POST', '/pricing-rules', data, 10),

  updatePricingRule: (id: number, data: Partial<import('$lib/types').PricingRule>) =>
    request<import('$lib/types').PricingRule>('PUT', `/pricing-rules/${id}`, data, 10),

  deletePricingRule: (id: number) =>
    request<{ status: string }>('DELETE', `/pricing-rules/${id}`),

  // ---- Expenses ----
  listExpenseCategories: () =>
    request<import('$lib/types').ExpenseCategory[]>('GET', '/expense-categories').catch(() => [] as import('$lib/types').ExpenseCategory[]),
  createExpenseCategory: (data: Omit<import('$lib/types').ExpenseCategory, 'id' | 'created_at'>) =>
    request<import('$lib/types').ExpenseCategory>('POST', '/expense-categories', data),
  listExpenses: (params?: { from_date?: string; to_date?: string; category_id?: number; exclude_owners?: boolean; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.from_date) q.set('from_date', params.from_date);
    if (params?.to_date) q.set('to_date', params.to_date);
    if (params?.category_id) q.set('category_id', String(params.category_id));
    if (params?.exclude_owners) q.set('exclude_owners', 'true');
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return request<import('$lib/types').Expense[]>('GET', `/expenses${qs ? '?' + qs : ''}`).catch(() => [] as import('$lib/types').Expense[]);
  },
  createExpense: (data: Omit<import('$lib/types').Expense, 'id' | 'created_at' | 'updated_at'>) =>
    request<import('$lib/types').Expense>('POST', '/expenses', data),
  getExpensesSummary: (from_date?: string, to_date?: string, group_by: string = 'category', exclude_owners?: boolean, category_id?: number | null) => {
    const q = new URLSearchParams();
    if (from_date) q.set('from_date', from_date);
    if (to_date) q.set('to_date', to_date);
    q.set('group_by', group_by);
    if (exclude_owners) q.set('exclude_owners', 'true');
    if (category_id) q.set('category_id', String(category_id));
    return request<{ group_by: string; total: number; groups: Record<string, number> }>('GET', `/expenses/summary?${q.toString()}`);
  },
  migrateExpenses: () =>
    request<{ status: string; created: number }>('POST', '/expenses/migrate'),
  updateExpense: (id: number, data: { date?: string; amount?: number; description?: string; category_id?: number; payment_method?: string; reference?: string; status?: string }) =>
    request<import('$lib/types').Expense>('PUT', `/expenses/${id}`, data),
  deleteExpense: (id: number) =>
    request<{ status: string }>('DELETE', `/expenses/${id}`),

  // ---- Tasks ----
  listTasks: () =>
    handleResponse(request<{ id: number; text: string; done: boolean; position: number; pinned: boolean; created_at: string | null; assigned_by: string | null; images: TaskImageRef[]; reply_count?: number }[]>('GET', '/tasks', undefined, 10), [] as any[]),

  createTask: (data: { text: string; assigned_by?: string; pinned?: boolean }) =>
    request<{ id: number; text: string; done: boolean; position: number; pinned: boolean; created_at: string | null; assigned_by: string | null; images: TaskImageRef[] }>('POST', '/tasks', data),

  updateTask: (id: number, data: { text?: string; done?: boolean; position?: number; pinned?: boolean }) =>
    request<{ id: number; text: string; done: boolean; position: number; pinned: boolean; created_at: string | null; assigned_by: string | null; images: TaskImageRef[] }>('PUT', `/tasks/${id}`, data),

  deleteTask: (id: number) =>
    request<{ status: string }>('DELETE', `/tasks/${id}`),

 listTaskTrash: () =>
    handleResponse(request<{ id: number; text: string; done: boolean; position: number; pinned: boolean; created_at: string | null; deleted_at: string | null; assigned_by: string | null; images: TaskImageRef[] }[]>('GET', '/tasks/trash'), [] as any[]),

  restoreTask: (id: number) =>
    request<{ status: string }>('POST', '/tasks/' + id + '/restore'),

  listTaskImages: (taskId: number) =>
    handleResponse(request<TaskImageRef[]>('GET', '/tasks/' + taskId + '/images'), []),

  async uploadTaskImage(taskId: number, file: Uint8Array, name: string) {
    const formData = new FormData();
    formData.append('file', new Blob([file], { type: 'image/webp' }), name);
    const url = `${API_URL}/tasks/${taskId}/images`;
    const resp = await tauriFetch(url, { method: 'POST', body: formData });
    if (!resp.ok) { const t = await resp.text().catch(() => ''); throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`); }
    return resp.json();
  },

  getTaskImageViewUrl: (taskId: number, imageId: number) =>
    `${API_URL}/tasks/${taskId}/images/${imageId}/view`,

  deleteTaskImage: (taskId: number, imageId: number) =>
    request<{ status: string }>('DELETE', `/tasks/${taskId}/images/${imageId}`),

  // ---- Task Replies (1 nivel, múltiples por tarea) ----
  listTaskReplies: (taskId: number) =>
    handleResponse(request<{ id: number; task_id: number; text: string; done: boolean; assigned_by: string | null; created_at: string | null; images: TaskImageRef[] }[]>('GET', `/tasks/${taskId}/replies`, undefined, 10), [] as any[]),

  createTaskReply: (taskId: number, data: { text: string; assigned_by?: string | null }) =>
    request<{ id: number; task_id: number; text: string; done: boolean; assigned_by: string | null; created_at: string | null; images: TaskImageRef[] }>('POST', `/tasks/${taskId}/replies`, data),

  updateTaskReply: (taskId: number, replyId: number, data: { text?: string; done?: boolean }) =>
    request<{ id: number; task_id: number; text: string; done: boolean; assigned_by: string | null; created_at: string | null; images: TaskImageRef[] }>('PUT', `/tasks/${taskId}/replies/${replyId}`, data),

  deleteTaskReply: (taskId: number, replyId: number) =>
    request<{ status: string }>('DELETE', `/tasks/${taskId}/replies/${replyId}`),

  async uploadTaskReplyImage(taskId: number, replyId: number, file: Uint8Array, name: string) {
    const formData = new FormData();
    formData.append('file', new Blob([file], { type: 'image/webp' }), name);
    const url = `${API_URL}/tasks/${taskId}/replies/${replyId}/images`;
    const resp = await tauriFetch(url, { method: 'POST', body: formData });
    if (!resp.ok) { const t = await resp.text().catch(() => ''); throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`); }
    return resp.json();
  },

  getTaskReplyImageViewUrl: (taskId: number, replyId: number, imageId: number) =>
    `${API_URL}/tasks/${taskId}/replies/${replyId}/images/${imageId}/view`,

  deleteTaskReplyImage: (taskId: number, replyId: number, imageId: number) =>
    request<{ status: string }>('DELETE', `/tasks/${taskId}/replies/${replyId}/images/${imageId}`),

  // ---- Notes ----
  getNotes: () =>
    request<{ content: string; updated_at: string; history: { id: number; content: string; created_at: string }[] }>('GET', '/notes', undefined, 10),
  saveNotes: (data: { content: string }) =>
    request<{ status: string; id: number }>('POST', '/notes', data),
  deleteNote: (id: number) =>
    request<{ status: string }>('DELETE', `/notes/${id}`),

  // ---- Mini-drive de excels (pestaña Archivos junto a Notas) ----
  listProspectoFiles: () =>
    handleResponse(request<{ id: number; name: string; original_filename: string; mime_type: string; size_bytes: number; sheets_meta: string; created_at: string }[]>('GET', '/prospecto-files', undefined, 15), []),

  async uploadProspectoFile(name: string, sheetsMeta: string, bytes: Uint8Array, filename: string) {
    const formData = new FormData();
    formData.append('name', name);
    formData.append('sheets_meta', sheetsMeta);
    formData.append('file', new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
    const url = `${API_URL}/prospecto-files`;
    const resp = await tauriFetch(url, { method: 'POST', body: formData });
    if (!resp.ok) { const t = await resp.text().catch(() => ''); throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`); }
    return resp.json();
  },

  async downloadProspectoBytes(id: number): Promise<Uint8Array> {
    const url = `${API_URL}/prospecto-files/${id}/download`;
    const resp = await tauriFetch(url, { method: 'GET' });
    if (!resp.ok) { const t = await resp.text().catch(() => ''); throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`); }
    const buf = await resp.arrayBuffer();
    return new Uint8Array(buf);
  },

  getProspectoDownloadUrl: (id: number) => `${API_URL}/prospecto-files/${id}/download`,

  deleteProspectoFile: (id: number) =>
    request<{ status: string }>('DELETE', `/prospecto-files/${id}`),

  // ---- FODA ----
  getFoda: () =>
    handleResponse(request<{ fortalezas: string[]; oportunidades: string[]; debilidades: string[]; amenazas: string[] }>('GET', '/foda', undefined, 10), { fortalezas: [], oportunidades: [], debilidades: [], amenazas: [] } as any),
  saveFoda: (data: { fortalezas: string[]; oportunidades: string[]; debilidades: string[]; amenazas: string[] }) =>
    request<{ status: string }>('PUT', '/foda', data),

  getLatestManifest: () =>
    request<{ version: string; notes: string; pub_date: string; platforms: any }>('GET', '/latest.json', undefined, 10),
};
