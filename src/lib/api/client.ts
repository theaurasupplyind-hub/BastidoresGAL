import { invoke } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

const API_URL = 'https://api-bastidores.onrender.com';

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
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    if (res.status === 204) return undefined as T;
    return res.json();
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

function handleResponse<T>(data: T, fallback: T): T {
  return data ?? fallback;
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

  // ---- Mapa ----
  getMapaClientes: () => handleResponse(request<any[]>('GET', '/mapa/clientes', undefined, 15), []),

  getMapaEntregas: (fecha: string) =>
    handleResponse(request<any[]>('GET', `/mapa/entregas?fecha=${fecha}`, undefined, 15), []),

  geocodificarCliente: (id: number) =>
    request<{ status: string; lat: number; lng: number }>('POST', `/mapa/geocodificar/${id}`, undefined, 15),

  geocodificarAddress: (clientId: number, addressId: number) =>
    request<{ status: string; lat: number; lng: number }>('POST', `/clients/${clientId}/addresses/${addressId}/geocode`, undefined, 15),

  getMapaOrigen: () =>
    handleResponse(request<{ direccion: string; lat: number | null; lng: number | null }>('GET', '/mapa/origen', undefined, 15),
      { direccion: 'Bermudez 331', lat: null, lng: null }),

  updateMapaOrigen: (data: { direccion: string; lat?: number | null; lng?: number | null }) =>
    request<{ status: string; direccion: string; lat: number | null; lng: number | null }>('PUT', '/mapa/origen', data, 15),

  getMapaDashboard: (fecha: string, todas = false) =>
    request<{ clientes: any[]; entregas: any[]; plan: import('$lib/types').PlanDeViaje | null }>('GET', `/mapa/dashboard?fecha=${fecha}&todas=${todas}`, undefined, 20),

  getPlanViaje: (fecha: string) =>
    request<import('$lib/types').PlanDeViaje | null>('GET', `/mapa/planes?fecha=${fecha}`, undefined, 15),

  savePlanViaje: (data: { fecha: string; grupos: import('$lib/types').GrupoCliente[] }) =>
    request<{ id: string }>('POST', '/mapa/planes', data, 15),

  updatePlanViaje: (id: string, data: { fecha: string; grupos: import('$lib/types').GrupoCliente[] }) =>
    request<{ status: string }>('PUT', `/mapa/planes/${id}`, data, 15),

  deletePlanViaje: (id: string) =>
    request<{ status: string }>('DELETE', `/mapa/planes/${id}`, undefined, 15),

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

  listFacturas: (params?: { search?: string; user_id?: number; start?: string; end?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.user_id) q.set('user_id', String(params.user_id));
    if (params?.start) q.set('start', params.start);
    if (params?.end) q.set('end', params.end);
    if (params?.limit) q.set('limit', String(params.limit));
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

  // ---- Pagos ----
  listPagos: () => handleResponse(request<import('$lib/types').Pago[]>('GET', '/payments'), []),

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
    handleResponse(request<{ id: number; name: string; position: number; created_at: string }[]>('GET', '/price-list-images'), []),

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
  }) => request<{ status: string }>('POST', '/moldura-corrections', data),

  findMolduraCorrection: (w: number, h: number, qty: number = 1) =>
    handleResponse(request<any>('GET', `/moldura-corrections/match?w=${w}&h=${h}&qty=${qty}`, undefined, 8), null),

  getInvoiceCorrections: (invoiceId: number) =>
    handleResponse(request<any[]>('GET', `/moldura-corrections/${invoiceId}`, undefined, 8), []),

  deleteMolduraCorrection: (id: number) =>
    request<{ status: string }>('DELETE', `/moldura-corrections/${id}`),

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
  getExpensesSummary: (from_date?: string, to_date?: string, group_by: string = 'category', exclude_owners?: boolean) => {
    const q = new URLSearchParams();
    if (from_date) q.set('from_date', from_date);
    if (to_date) q.set('to_date', to_date);
    q.set('group_by', group_by);
    if (exclude_owners) q.set('exclude_owners', 'true');
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
    handleResponse(request<{ id: number; text: string; done: boolean; position: number; created_at: string | null }[]>('GET', '/tasks', undefined, 10), []),

  createTask: (data: { text: string }) =>
    request<{ id: number; text: string; done: boolean; position: number; created_at: string | null }>('POST', '/tasks', data),

  updateTask: (id: number, data: { text?: string; done?: boolean; position?: number }) =>
    request<{ id: number; text: string; done: boolean; position: number; created_at: string | null }>('PUT', `/tasks/${id}`, data),

  deleteTask: (id: number) =>
    request<{ status: string }>('DELETE', `/tasks/${id}`),

  // ---- Notes ----
  getNotes: () =>
    request<{ content: string; updated_at: string; history: { id: number; content: string; created_at: string }[] }>('GET', '/notes', undefined, 10),
  saveNotes: (data: { content: string }) =>
    request<{ status: string; id: number }>('POST', '/notes', data),
  deleteNote: (id: number) =>
    request<{ status: string }>('DELETE', `/notes/${id}`),

  getLatestManifest: () =>
    request<{ version: string; notes: string; pub_date: string; platforms: any }>('GET', '/latest.json', undefined, 10),
};
