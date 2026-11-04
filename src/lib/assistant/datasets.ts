/**
 * Catálogo de lectura genérica del asistente.
 *
 * Envuelve los endpoints que ya usa la app para que el modelo pueda consultar
 * cualquier dato aunque no exista una tool específica. Todo es solo lectura:
 * este módulo no expone ninguna escritura.
 */
import { api } from '$lib/api/client';
import { CHANGELOG } from '$lib/data/changelog';
import { appStore } from '$lib/stores/appStore.svelte';
import { cacheStore } from '$lib/stores/cacheStore.svelte';

const MINUTE = 60_000;

export interface DatasetDef {
  id: string;
  description: string;
  /** Campos recomendados para el catálogo (no es una whitelist). */
  fields: string[];
  /** Claves de `filtros` que deben venir sí o sí. */
  requires?: string[];
  /** Campo de fecha para `desde` / `hasta`. */
  dateField?: string;
  /** Campos donde busca `search`; si falta, busca en todos los string. */
  searchFields?: string[];
  load: (filters: Record<string, unknown>) => Promise<unknown[]>;
}

export interface DatasetReadOptions {
  dataset: string;
  filtros?: Record<string, unknown>;
  campos?: string[];
  limite?: number;
  offset?: number;
  orden?: string;
  desde?: string;
  hasta?: string;
  modo?: 'filas' | 'resumen';
  agrupar?: string;
  sumar?: string;
}

export interface DatasetReadResult {
  dataset: string;
  descripcion: string;
  total: number;
  devueltos: number;
  truncado: boolean;
  campos: string[];
  filas?: Array<Record<string, unknown>>;
  resumen?: Array<{ valor: string; cantidad: number; suma?: number }>;
  nota?: string;
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter(
      (row): row is Record<string, unknown> => typeof row === 'object' && row !== null,
    );
  }
  if (typeof value === 'object' && value !== null) {
    return [value as Record<string, unknown>];
  }
  return [];
}

function cached<T>(key: string, fetcher: () => Promise<T>, ttl = 5 * MINUTE): Promise<T> {
  return cacheStore.fetch(key, fetcher, ttl);
}

function num(filters: Record<string, unknown>, key: string): number | undefined {
  const value = filters[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

function text(filters: Record<string, unknown>, key: string): string | undefined {
  const value = filters[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function loadFacturas(): Promise<unknown[]> {
  return cached('facturas', () => api.listFacturas({ limit: 2000 }) as Promise<unknown[]>, 5 * MINUTE);
}

const DATASETS: DatasetDef[] = [
  {
    id: 'clientes',
    description: 'Clientes: nombre, domicilio, teléfono, taller, estudiante y última preferencia de entrega.',
    fields: ['id', 'nombre', 'domicilio', 'telefono', 'taller', 'estudiante', 'lat', 'lng', 'ultimo_tipo_entrega'],
    searchFields: ['nombre', 'domicilio', 'telefono', 'taller', 'estudiante'],
    load: () => cached('clientes', () => api.listClientes() as Promise<unknown[]>, 30 * MINUTE),
  },
  {
    id: 'direcciones',
    description: 'Direcciones alternativas de un cliente (requiere cliente_id).',
    fields: ['id', 'client_id', 'address', 'extra', 'label', 'lat', 'lng', 'is_default'],
    requires: ['cliente_id'],
    searchFields: ['address', 'extra', 'label'],
    load: (f) => api.listAddresses(num(f, 'cliente_id') as number) as Promise<unknown[]>,
  },
  {
    id: 'talleres',
    description: 'Talleres y su dirección.',
    fields: ['id', 'taller', 'direccion'],
    searchFields: ['taller', 'direccion'],
    load: () => cached('talleres', () => api.listTalleres() as Promise<unknown[]>, 30 * MINUTE),
  },
  {
    id: 'usuarios',
    description: 'Usuarios/estaciones que usaron la app y su última conexión.',
    fields: ['id', 'full_name', 'last_seen'],
    searchFields: ['full_name'],
    load: () => api.getUsers() as Promise<unknown[]>,
  },
  {
    id: 'usuarios_activos',
    description: 'Usuarios conectados en los últimos 20 segundos.',
    fields: ['id', 'name'],
    searchFields: ['name'],
    load: () => api.getActiveUsers() as Promise<unknown[]>,
  },
  {
    id: 'facturas',
    description:
      'Facturas y presupuestos con total, saldo, estado de tablero/entrega, fechas, urgencia y datos de entrega. Incluye ítems.',
    fields: [
      'id', 'numero_factura', 'fecha', 'fecha_iso', 'cliente_id', 'cliente_nombre', 'total', 'envio', 'tipo',
      'tipo_entrega', 'fecha_entrega', 'estado_entrega', 'estado_kanban', 'estado_orden_tela',
      'estado_moldura', 'created_by', 'created_at', 'entregado_at', 'revision_saldo', 'urgencia',
      'cliente_domicilio', 'cliente_telefono', 'impresa_at', 'impresa_por', 'cluster_pending',
    ],
    dateField: 'fecha_iso',
    searchFields: ['numero_factura', 'cliente_nombre', 'cliente_domicilio', 'tipo', 'estado_kanban'],
    load: loadFacturas,
  },
  {
    id: 'items_factura',
    description: 'Ítems de facturas aplanados: factura, cliente, descripción, cantidad y precios.',
    fields: ['factura_id', 'numero_factura', 'cliente_nombre', 'descripcion', 'cantidad', 'precio_unitario', 'total'],
    searchFields: ['numero_factura', 'cliente_nombre', 'descripcion'],
    load: async () => {
      const facturas = await loadFacturas();
      const rows: Array<Record<string, unknown>> = [];
      for (const raw of facturas) {
        const factura = raw as Record<string, unknown>;
        const items = Array.isArray(factura.items) ? factura.items : [];
        for (const itemRaw of items) {
          if (typeof itemRaw !== 'object' || itemRaw === null) continue;
          const item = itemRaw as Record<string, unknown>;
          rows.push({
            factura_id: factura.id,
            numero_factura: factura.numero_factura,
            cliente_nombre: factura.cliente_nombre,
            fecha: factura.fecha,
            descripcion: item.descripcion,
            cantidad: item.cantidad,
            precio_unitario: item.precio_unitario,
            total: item.total,
          });
        }
      }
      return rows;
    },
  },
  {
    id: 'pagos',
    description: 'Pagos de facturas: monto, fecha, método, usuario y vínculo con proveedor/empleado.',
    fields: ['id', 'invoice_id', 'amount', 'date', 'method', 'user_id', 'entity_type', 'entity_id', 'created_at'],
    dateField: 'date',
    searchFields: ['method', 'entity_type'],
    load: () => cached('pagos', () => api.listPagos() as Promise<unknown[]>, 2 * MINUTE),
  },
  {
    id: 'facturas_resumen',
    description: 'Totales globales de facturación: cantidad, facturado, deuda y cobrado.',
    fields: ['count', 'facturado', 'deuda', 'cobrado'],
    load: async () => [await api.getInvoicesResumen()],
  },
  {
    id: 'borradores',
    description: 'Facturas en borrador que están escribiendo los usuarios ahora.',
    fields: ['user', 'client', 'user_id'],
    searchFields: ['user', 'client'],
    load: () => api.getDrafts() as Promise<unknown[]>,
  },
  {
    id: 'papelera',
    description: 'Facturas eliminadas (soft delete) que se pueden restaurar.',
    fields: ['id', 'numero_factura', 'cliente_nombre', 'total', 'estado_kanban', 'deleted_at'],
    searchFields: ['numero_factura', 'cliente_nombre'],
    load: () => api.listTrash({ limit: 500 }) as Promise<unknown[]>,
  },
  {
    id: 'productos',
    description: 'Catálogo de productos: descripción, precio, categoría, medida, variante y stock.',
    fields: ['id', 'descripcion', 'precio_unitario', 'categoria', 'medida', 'variante', 'stock'],
    searchFields: ['descripcion', 'categoria', 'medida', 'variante'],
    load: () => cached('productos', () => api.listProductos() as Promise<unknown[]>, 30 * MINUTE),
  },
  {
    id: 'precios_referencia',
    description: 'Precios de referencia por categoría, medida y variante.',
    fields: ['id', 'categoria', 'medida', 'variante', 'precio'],
    searchFields: ['categoria', 'medida', 'variante'],
    load: () => cached('preciosReferencia', () => api.getPreciosReferencia() as Promise<unknown[]>, 30 * MINUTE),
  },
  {
    id: 'reglas_precios',
    description: 'Reglas de precios automáticos: tokens, operación, valor, condiciones y redondeo.',
    fields: ['id', 'name', 'matchTokens', 'operation', 'operationValue', 'rounding', 'enabled'],
    searchFields: ['name'],
    load: () => cached('pricingRules', () => api.getPricingRules() as Promise<unknown[]>, 30 * MINUTE),
  },
  {
    id: 'reglas_estimacion',
    description: 'Reglas de estimación por medida (topes, recargos, márgenes y cálculos).',
    fields: ['id', 'name', 'matchTokens', 'method', 'priority', 'params'],
    searchFields: ['name'],
    load: () => cached('estimationRules', () => api.getEstimationRules() as Promise<unknown[]>, 30 * MINUTE),
  },
  {
    id: 'correcciones_moldura',
    description: 'Correcciones de moldura por medida y factura (largueros y travesaños).',
    fields: ['id', 'invoice_id', 'item_descripcion', 'width', 'height', 'qty', 'larguero_qty', 'larguero_cm', 'travesano_qty', 'travesano_cm'],
    searchFields: ['item_descripcion'],
    load: () => api.getAllMolduraCorrections() as Promise<unknown[]>,
  },
  {
    id: 'formula_moldura',
    description: 'Fórmula de molduras configurada actualmente.',
    fields: ['data', 'updated_at'],
    load: async () => {
      const formula = await api.getMolduraFormula();
      return formula ? [formula as unknown as Record<string, unknown>] : [];
    },
  },
  {
    id: 'historial_formula_moldura',
    description: 'Historial de cambios de la fórmula de molduras, con quién y cuándo.',
    fields: ['id', 'data', 'changed_by', 'created_at'],
    dateField: 'created_at',
    searchFields: ['changed_by'],
    load: () => api.getMolduraFormulaHistory(200) as Promise<unknown[]>,
  },
  {
    id: 'reglas_materiales_moldura',
    description: 'Keywords de productos que no generan materiales de moldura.',
    fields: ['id', 'keyword', 'normalized', 'created_at'],
    searchFields: ['keyword'],
    load: () => api.getMolduraMaterialRules() as Promise<unknown[]>,
  },
  {
    id: 'reglas_ocultas_moldura',
    description: 'Keywords de productos ocultos en pantalla y PDF de molduras.',
    fields: ['id', 'keyword', 'normalized', 'created_at'],
    searchFields: ['keyword'],
    load: () => api.getMolduraHiddenRules() as Promise<unknown[]>,
  },
  {
    id: 'gastos',
    description: 'Gastos: fecha, monto, descripción, categoría, proveedor, empleado, método y origen.',
    fields: [
      'id', 'date', 'amount', 'description', 'category_id', 'provider_id', 'employee_id',
      'payment_method', 'reference', 'source', 'status', 'created_by_user_id', 'created_at',
    ],
    dateField: 'date',
    searchFields: ['description', 'reference', 'payment_method', 'source'],
    load: () => api.listExpenses({ limit: 2000 }) as Promise<unknown[]>,
  },
  {
    id: 'categorias_gasto',
    description: 'Categorías de gasto con tipo, color e ícono.',
    fields: ['id', 'name', 'slug', 'type', 'color', 'icon', 'is_default'],
    searchFields: ['name', 'slug', 'type'],
    load: () => cached('assistant:expense-categories', () => api.listExpenseCategories() as Promise<unknown[]>, 5 * MINUTE),
  },
  {
    id: 'resumen_gastos',
    description: 'Resumen de gastos por categoría o tipo en un período.',
    fields: ['category', 'total', 'count'],
    load: async (f) => {
      const data = await api.getExpensesSummary(text(f, 'desde'), text(f, 'hasta'));
      return asRows(data);
    },
  },
  {
    id: 'proveedores',
    description: 'Proveedores: CUIT, alias, dirección, saldo y stock.',
    fields: ['id', 'name', 'cuit', 'alias_mp', 'alias_cbu', 'address', 'balance', 'stock_qty', 'created_at'],
    searchFields: ['name', 'cuit', 'alias_mp', 'alias_cbu', 'address'],
    load: () => cached('providers', () => api.listProviders() as Promise<unknown[]>, 15 * MINUTE),
  },
  {
    id: 'movimientos_proveedor',
    description: 'Movimientos de un proveedor (requiere proveedor_id).',
    fields: ['id', 'provider_id', 'expense_id', 'date', 'type', 'description', 'quantity', 'amount', 'reference'],
    requires: ['proveedor_id'],
    dateField: 'date',
    searchFields: ['description', 'reference', 'type'],
    load: async (f) => {
      const providerId = num(f, 'proveedor_id') as number;
      const data = (await api.getProvider(providerId)) as Record<string, unknown>;
      return asRows(data.movements ?? data.movimientos ?? []);
    },
  },
  {
    id: 'empleados',
    description: 'Empleados: contacto, CUIT/CBU/alias, tipo, frecuencia, sueldo base y horario.',
    fields: [
      'id', 'name', 'phone', 'address', 'cuit', 'cbu', 'alias', 'hire_date', 'active',
      'job_type', 'payment_freq', 'base_salary', 'attendance_bonus', 'work_days',
      'entry_time', 'exit_time', 'late_threshold', 'is_owner',
    ],
    searchFields: ['name', 'phone', 'cuit', 'cbu', 'alias'],
    load: () => cached('employees', () => api.listEmployees(false) as Promise<unknown[]>, 15 * MINUTE),
  },
  {
    id: 'pagos_sueldos',
    description: 'Pagos de sueldos recientes: empleado, fecha, monto, modo y detalle.',
    fields: ['id', 'employee_id', 'date', 'amount', 'mode', 'detail', 'created_at'],
    dateField: 'date',
    searchFields: ['mode', 'detail'],
    load: () => api.listEmployeePaymentsRecent(500) as Promise<unknown[]>,
  },
  {
    id: 'asistencias',
    description: 'Asistencias: empleado, fecha, hora de llegada/salida o AUS. Filtros: employee_id, month (YYYY-MM).',
    fields: ['id', 'employee_id', 'date', 'status', 'exit_time'],
    dateField: 'date',
    searchFields: ['status'],
    load: (f) => api.listAttendance(num(f, 'employee_id'), text(f, 'month')) as Promise<unknown[]>,
  },
  {
    id: 'tareas',
    description: 'Tareas del panel: texto, hecha, fijada, quién la asignó y cantidad de respuestas.',
    fields: ['id', 'text', 'done', 'pinned', 'assigned_by', 'created_at', 'reply_count'],
    searchFields: ['text', 'assigned_by'],
    load: () => api.listTasks() as Promise<unknown[]>,
  },
  {
    id: 'respuestas_tareas',
    description: 'Respuestas de una tarea (requiere tarea_id).',
    fields: ['id', 'task_id', 'text', 'done', 'assigned_by', 'created_at'],
    requires: ['tarea_id'],
    searchFields: ['text', 'assigned_by'],
    load: (f) => api.listTaskReplies(num(f, 'tarea_id') as number) as Promise<unknown[]>,
  },
  {
    id: 'notas',
    description: 'Notas del panel (texto compartido) y su historial.',
    fields: ['id', 'content', 'created_at'],
    searchFields: ['content'],
    load: async () => {
      const data = (await api.getNotes()) as { content?: string; updated_at?: string; history?: Array<Record<string, unknown>> };
      if (Array.isArray(data.history) && data.history.length > 0) return data.history;
      return data.content ? [{ id: 0, content: data.content, created_at: data.updated_at ?? '' }] : [];
    },
  },
  {
    id: 'foda',
    description: 'Matriz FODA: fortalezas, oportunidades, debilidades y amenazas.',
    fields: ['quadrant', 'texto'],
    searchFields: ['texto'],
    load: async () => {
      const data = (await api.getFoda()) as Record<string, unknown>;
      const out: Array<Record<string, unknown>> = [];
      for (const [quadrant, values] of Object.entries(data)) {
        if (!Array.isArray(values)) continue;
        for (const value of values) out.push({ quadrant, texto: String(value) });
      }
      return out;
    },
  },
  {
    id: 'prospectos',
    description: 'Archivos Excel del mini-drive: nombre, tamaño, hojas y fecha.',
    fields: ['id', 'name', 'original_filename', 'size_bytes', 'sheets_meta', 'created_at'],
    searchFields: ['name', 'original_filename'],
    load: () => api.listProspectoFiles() as Promise<unknown[]>,
  },
  {
    id: 'analisis_mensual',
    description: 'Análisis de facturación mensual (pesos, dólar y variaciones). Usa el usuario actual por defecto.',
    fields: ['periodo_inicio', 'periodo_fin', 'facturacion_pesos', 'dolar_promedio', 'facturacion_usd', 'variacion_pct_pesos', 'variacion_pct_usd', 'etiqueta'],
    load: async (f) => {
      const userId = num(f, 'usuario_id') ?? appStore.user?.user_id;
      if (!userId) return [];
      return [await api.getAnalisisMensual(userId)];
    },
  },
  {
    id: 'analisis_semanal',
    description: 'Análisis de facturación semanal (pesos, dólar y variaciones). Usa el usuario actual por defecto.',
    fields: ['periodo_inicio', 'periodo_fin', 'facturacion_pesos', 'dolar_promedio', 'facturacion_usd', 'variacion_pct_pesos', 'variacion_pct_usd', 'etiqueta'],
    load: async (f) => {
      const userId = num(f, 'usuario_id') ?? appStore.user?.user_id;
      if (!userId) return [];
      return [await api.getAnalisisSemanal(userId)];
    },
  },
  {
    id: 'analisis_historial',
    description: 'Historial de análisis de facturación del usuario.',
    fields: ['periodo_inicio', 'periodo_fin', 'tipo_periodo', 'facturacion_pesos', 'dolar_promedio', 'facturacion_usd', 'etiqueta'],
    load: async (f) => {
      const userId = num(f, 'usuario_id') ?? appStore.user?.user_id;
      if (!userId) return [];
      return api.getAnalisisHistorial(userId) as Promise<unknown[]>;
    },
  },
  {
    id: 'mapa_clientes',
    description: 'Clientes en el mapa con coordenadas, entregas y pedidos pendientes.',
    fields: ['id', 'nombre', 'domicilio', 'telefono', 'lat', 'lng', 'entregas', 'pedidos_pendientes'],
    searchFields: ['nombre', 'domicilio', 'telefono'],
    load: () => api.getMapaClientes() as Promise<unknown[]>,
  },
  {
    id: 'mapa_entregas',
    description: 'Entregas del mapa para una fecha (requiere fecha YYYY-MM-DD).',
    fields: ['id', 'fecha', 'estado_entrega', 'cliente', 'direccion', 'lat', 'lng'],
    requires: ['fecha'],
    load: (f) => api.getMapaEntregas(text(f, 'fecha') as string) as Promise<unknown[]>,
  },
  {
    id: 'mapa_origen',
    description: 'Dirección de origen configurada para las entregas.',
    fields: ['direccion', 'lat', 'lng'],
    load: async () => [await api.getMapaOrigen()],
  },
  {
    id: 'mapa_config',
    description: 'Configuración de clusters del mapa.',
    fields: ['cluster_min', 'cluster_max', 'cluster_eps_km'],
    load: async () => [await api.getMapaConfig()],
  },
  {
    id: 'planes_viaje',
    description: 'Plan de viaje de una fecha (requiere fecha). Incluye grupos de clientes.',
    fields: ['id', 'fecha', 'grupos', 'created_at', 'updated_at'],
    requires: ['fecha'],
    load: async (f) => {
      const plan = await api.getPlanViaje(text(f, 'fecha') as string);
      return plan ? [plan as unknown as Record<string, unknown>] : [];
    },
  },
  {
    id: 'recomendaciones_viaje',
    description: 'Clientes recomendados cerca de los viajes de una fecha (requiere fecha).',
    fields: ['fecha', 'grupo_id', 'cliente_id', 'distancia_km', 'cerca_de_cliente_id'],
    requires: ['fecha'],
    load: (f) => api.getRecomendaciones(text(f, 'fecha') as string) as Promise<unknown[]>,
  },
  {
    id: 'imagenes_precios',
    description: 'Imágenes de listas de precios cargadas (metadatos).',
    fields: ['id', 'name', 'position', 'mime_type', 'created_at'],
    searchFields: ['name'],
    load: () => api.listPriceListImages() as Promise<unknown[]>,
  },
  {
    id: 'vouchers_pendientes',
    description: 'Comprobantes de WhatsApp recibidos y su estado de revisión.',
    fields: [
      'id', 'contact_name', 'wa_id', 'extracted_monto', 'extracted_fecha', 'extracted_nombre_cliente',
      'extracted_nombre_destino', 'match_status', 'matched_invoice_numero', 'matched_cliente_nombre',
      'review_status', 'created_at',
    ],
    searchFields: ['contact_name', 'wa_id', 'extracted_nombre_cliente', 'matched_cliente_nombre', 'match_status'],
    load: () => api.listVoucherReviews({ status: 'all', limit: 500 }) as Promise<unknown[]>,
  },
  {
    id: 'documentacion',
    description: 'Novedades y funcionalidades de la app por versión (changelog). Útil para explicar cómo se usa algo.',
    fields: ['version', 'texto'],
    searchFields: ['texto', 'version'],
    load: async () =>
      Object.entries(CHANGELOG).flatMap(([version, content]) =>
        String(content)
          .split('\n')
          .map((linea) => linea.trim())
          .filter(Boolean)
          .map((texto) => ({ version, texto })),
      ),
  },
];

const DATASET_MAP = new Map(DATASETS.map((dataset) => [dataset.id, dataset]));

const SENSITIVE_KEY = /(?:^|_)(?:image_data|file_data|media_data|media_bytes|api_key|password|token|file_bytes)$/i;
const LONG_TEXT_KEY = /^(?:data|content|text|description|grupos|sheets_meta|respuesta|motivo)$/i;
const MAX_STRING = 200;
const MAX_LONG_STRING = 1200;
const MAX_ARRAY = 20;
const MAX_DEFAULT_FIELDS = 20;
const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 25;

function sanitizeValue(value: unknown, key?: string, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    const max = key && LONG_TEXT_KEY.test(key) ? MAX_LONG_STRING : MAX_STRING;
    return value.length > max ? `${value.slice(0, max)}…` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 2) return '[…]';
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((item) => sanitizeValue(item, key, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [nestedKey, nested] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(nestedKey)) continue;
      out[nestedKey] = sanitizeValue(nested, nestedKey, depth + 1);
    }
    return out;
  }
  return String(value);
}

function isSensitive(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

function normalize(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function valueAt(row: Record<string, unknown>, key: string): unknown {
  return row[key];
}

function pickFields(row: Record<string, unknown>, fields?: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (fields && fields.length > 0) {
    for (const field of fields) {
      if (!(field in row) || isSensitive(field)) continue;
      out[field] = sanitizeValue(row[field], field);
    }
    return out;
  }
  let count = 0;
  for (const [key, value] of Object.entries(row)) {
    if (isSensitive(key) || Array.isArray(value)) continue;
    out[key] = sanitizeValue(value, key);
    count++;
    if (count >= MAX_DEFAULT_FIELDS) break;
  }
  return out;
}

function matchesSearch(row: Record<string, unknown>, term: string, fields?: string[]): boolean {
  const needle = normalize(term);
  if (!needle) return true;
  const keys = fields && fields.length > 0 ? fields : Object.keys(row);
  return keys.some((key) => {
    const value = valueAt(row, key);
    if (typeof value === 'string' || typeof value === 'number') {
      return normalize(value).includes(needle);
    }
    return false;
  });
}

function rowHasKey(rows: Array<Record<string, unknown>>, key: string): boolean {
  return rows.some((row) => key in row);
}

function matchesEquals(
  row: Record<string, unknown>,
  key: string,
  expected: unknown,
): boolean {
  const value = row[key];
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') {
    const bool = typeof expected === 'boolean' ? expected : expected === 'true' || expected === 1;
    return value === bool;
  }
  if (typeof value === 'number') {
    const parsed = typeof expected === 'number' ? expected : Number(expected);
    return Number.isFinite(parsed) && Math.abs(value - parsed) < 0.0001;
  }
  return normalize(value) === normalize(expected);
}

function inDateRange(row: Record<string, unknown>, key: string, desde?: string, hasta?: string): boolean {
  if (!desde && !hasta) return true;
  const raw = row[key];
  if (typeof raw !== 'string' || !raw.trim()) return true;
  const day = raw.slice(0, 10);
  if (desde && day < desde.slice(0, 10)) return false;
  if (hasta && day > hasta.slice(0, 10)) return false;
  return true;
}

function sortRows(
  rows: Array<Record<string, unknown>>,
  order?: string,
): Array<Record<string, unknown>> {
  if (!order) return rows;
  const [rawField, rawDirection] = order.split(':');
  const field = rawField?.trim();
  if (!field) return rows;
  const direction = rawDirection?.trim().toLowerCase() === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = a[field];
    const right = b[field];
    if (left === right) return 0;
    if (left === null || left === undefined) return 1;
    if (right === null || right === undefined) return -1;
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
    return String(left).localeCompare(String(right), 'es') * direction;
  });
}

export function datasetCatalog(only?: string): Array<{
  dataset: string;
  descripcion: string;
  campos: string[];
  requiere?: string[];
}> {
  const list = only
    ? DATASETS.filter((dataset) => dataset.id === only)
    : DATASETS;
  return list.map((dataset) => ({
    dataset: dataset.id,
    descripcion: dataset.description,
    campos: dataset.fields,
    ...(dataset.requires?.length ? { requiere: dataset.requires } : {}),
  }));
}

export function datasetIds(): string[] {
  return DATASETS.map((dataset) => dataset.id);
}

export async function readDataset(options: DatasetReadOptions): Promise<DatasetReadResult> {
  const dataset = DATASET_MAP.get(options.dataset);
  if (!dataset) {
    throw new Error(
      `No existe el dataset "${options.dataset}". Usá catalogo_datos para ver los disponibles.`,
    );
  }

  const filtros = options.filtros ?? {};
  for (const required of dataset.requires ?? []) {
    const value = filtros[required];
    if (value === undefined || value === null || value === '') {
      throw new Error(`El dataset "${dataset.id}" requiere el filtro "${required}".`);
    }
  }

  const raw = await dataset.load(filtros);
  let rows = asRows(raw);

  const search = typeof filtros.search === 'string' ? filtros.search.trim() : '';
  if (search) {
    rows = rows.filter((row) => matchesSearch(row, search, dataset.searchFields));
  }

  const reserved = new Set(['search', 'desde', 'hasta', 'limit', 'limite', 'offset', 'order', 'orden', 'fields', 'campos']);
  for (const [rawKey, expected] of Object.entries(filtros)) {
    if (reserved.has(rawKey)) continue;
    if (expected === undefined || expected === null || expected === '') continue;
    // En facturas el filtro `fecha` (ISO) se aplica sobre `fecha_iso`, no sobre `fecha` (D/M/AAAA).
    const key = rawKey === 'fecha' && dataset.dateField === 'fecha_iso' ? 'fecha_iso' : rawKey;
    if (!rowHasKey(rows, key)) continue;
    rows = rows.filter((row) => matchesEquals(row, key, expected));
  }

  if (options.desde || options.hasta || typeof filtros.desde === 'string' || typeof filtros.hasta === 'string') {
    const dateField = dataset.dateField ?? 'fecha';
    const desde = options.desde ?? (typeof filtros.desde === 'string' ? filtros.desde : undefined);
    const hasta = options.hasta ?? (typeof filtros.hasta === 'string' ? filtros.hasta : undefined);
    if (rowHasKey(rows, dateField)) {
      rows = rows.filter((row) => inDateRange(row, dateField, desde, hasta));
    }
  }

  rows = sortRows(rows, options.orden);

  const total = rows.length;
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(options.limite ?? DEFAULT_LIMIT)));

  if (options.modo === 'resumen') {
    const groupKey =
      options.agrupar ??
      (rows.some((row) => 'estado_kanban' in row)
        ? 'estado_kanban'
        : rows.some((row) => 'estado' in row)
          ? 'estado'
          : rows.some((row) => 'status' in row)
            ? 'status'
            : rows.some((row) => 'category' in row)
              ? 'category'
              : undefined);
    if (!groupKey) {
      const sumField = options.sumar;
      const suma = sumField
        ? rows.reduce((acc, row) => acc + (Number(row[sumField]) || 0), 0)
        : undefined;
      return {
        dataset: dataset.id,
        descripcion: dataset.description,
        total,
        devueltos: 0,
        truncado: false,
        campos: [],
        resumen: [{ valor: 'total', cantidad: total, ...(suma !== undefined ? { suma } : {}) }],
      };
    }
    const groups = new Map<string, { cantidad: number; suma: number }>();
    for (const row of rows) {
      const key = String(row[groupKey] ?? '(sin dato)');
      const current = groups.get(key) ?? { cantidad: 0, suma: 0 };
      current.cantidad++;
      if (options.sumar) current.suma += Number(row[options.sumar]) || 0;
      groups.set(key, current);
    }
    const resumen = [...groups.entries()]
      .sort((a, b) => b[1].cantidad - a[1].cantidad)
      .slice(0, 20)
      .map(([valor, data]) => ({
        valor,
        cantidad: data.cantidad,
        ...(options.sumar ? { suma: Math.round(data.suma * 100) / 100 } : {}),
      }));
    return {
      dataset: dataset.id,
      descripcion: dataset.description,
      total,
      devueltos: resumen.length,
      truncado: groups.size > resumen.length,
      campos: [groupKey, 'cantidad', ...(options.sumar ? [options.sumar] : [])],
      resumen,
    };
  }

  const page = rows.slice(offset, offset + limit);
  const fields = options.campos && options.campos.length > 0 ? options.campos : undefined;
  const filas = page.map((row) => pickFields(row, fields));
  const campos = filas.length > 0 ? Object.keys(filas[0]) : (fields ?? dataset.fields);
  const truncado = offset + filas.length < total;
  return {
    dataset: dataset.id,
    descripcion: dataset.description,
    total,
    devueltos: filas.length,
    truncado,
    campos,
    filas,
    ...(filas.length === 0
      ? { nota: 'No hay filas con esos filtros. Probá sin filtros o con otro dataset.' }
      : truncado
        ? {
            nota: `Hay ${total} filas; mostrando ${filas.length} desde la fila ${offset}. Usá offset para paginar o modo resumen para agregar.`,
          }
        : {}),
  };
}

/** Normaliza los filtros que vienen del modelo (JSON) a un objeto plano. */
export function normalizeFilters(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}
