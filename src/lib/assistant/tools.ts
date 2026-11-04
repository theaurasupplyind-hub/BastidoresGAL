import { api } from '$lib/api/client';
import { appStore } from '$lib/stores/appStore.svelte';
import { cacheStore } from '$lib/stores/cacheStore.svelte';
import { normalizeEstimationParams, parseFechasEntrega, serializeFechasEntrega } from '$lib/types';
import type { EstimationRule, PrecioReferencia, PricingRule, Producto } from '$lib/types';
import { refsToProductos, smartProductSearch, suggestPrice } from '$lib/utils/precios';
import { datasetCatalog, datasetIds, normalizeFilters, readDataset } from './datasets';
import type { DatasetReadOptions } from './datasets';
import { assistant } from './store.svelte';
import type { ToolCallView, UndoAction } from './types';

export type ToolEffect = 'read' | 'write' | 'destructive';

export interface ToolParameters {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties: false;
}

export interface PreparedProposal {
  args: Record<string, unknown>;
  summary: string;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: ToolParameters;
  effect: ToolEffect;
  /** Si es true, la escritura se propone y espera confirmación (solo destructivas). */
  requiresConfirmation?: boolean;
  /** Valida y normaliza los args que compuso el modelo. Lanza ToolInputError. */
  validate(raw: unknown): Record<string, unknown>;
  /** Lecturas: ejecuta. Escrituras: ejecuta (auto) o al confirmar. */
  run(args: Record<string, unknown>): Promise<unknown>;
  /** Escrituras: valida contra datos reales y arma el resumen legible. */
  prepare?(args: Record<string, unknown>): Promise<PreparedProposal>;
  /** Solo escrituras confirmadas: texto de éxito determinístico. */
  success?(args: Record<string, unknown>, result: unknown): string;
  /** Escrituras que se pueden deshacer: arma la acción con los args normalizados y el resultado. */
  undo?(args: Record<string, unknown>, result: unknown): UndoAction | undefined;
}

export class ToolInputError extends Error {
  /** Código interno para que el runtime reaccione (no se muestra al usuario). */
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ToolInputError';
    this.code = code;
  }
}

/** Aclaración necesaria (pago parcial o duplicado) que se resuelve con un sí/no. */
export class ClarificationError extends Error {
  question: string;
  args: Record<string, unknown>;
  overrides: Record<string, unknown>;

  constructor(question: string, args: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
    super(question);
    this.name = 'ClarificationError';
    this.question = question;
    this.args = args;
    this.overrides = overrides;
  }
}

export const MAX_PINNED = 3;

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function asObject(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ToolInputError('Los argumentos deben ser un objeto JSON.');
  }
  return raw as Record<string, unknown>;
}

function optionalText(obj: Record<string, unknown>, key: string, max = 2000): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new ToolInputError(`"${key}" debe ser texto.`);
  const clean = value.trim();
  return clean ? clean.slice(0, max) : undefined;
}

function requiredText(obj: Record<string, unknown>, key: string, max = 2000): string {
  const value = optionalText(obj, key, max);
  if (!value) throw new ToolInputError(`Falta "${key}".`);
  return value;
}

function optionalNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  if (value === undefined || value === null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new ToolInputError(`"${key}" debe ser un número.`);
  return n;
}

function requiredInt(obj: Record<string, unknown>, key: string): number {
  const n = optionalNumber(obj, key);
  if (n === undefined || !Number.isInteger(n) || n <= 0) {
    throw new ToolInputError(`"${key}" debe ser un id válido.`);
  }
  return n;
}

function optionalBool(obj: Record<string, unknown>, key: string): boolean | undefined {
  const value = obj[key];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'boolean') throw new ToolInputError(`"${key}" debe ser true o false.`);
  return value;
}

function optionalDate(obj: Record<string, unknown>, key: string): string | undefined {
  const value = optionalText(obj, key, 10);
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ToolInputError(`"${key}" debe tener formato YYYY-MM-DD.`);
  }
  return value;
}

function normalize(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Texto normalizado (sin acentos, minúsculas) para comparar intenciones. */
export function normalizeText(value: string | null | undefined): string {
  return normalize(value);
}

function digitsOnly(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

function normalizeAlias(value: string | null | undefined): string {
  return normalize(value).replace(/[^a-z0-9]/g, '');
}

function nameTokens(value: string): string[] {
  return normalize(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

function nameMatchScore(
  query: string,
  candidate: string,
): { kind: 'exact' | 'tokens' | 'token'; score: number } | null {
  const q = normalize(query);
  const c = normalize(candidate);
  if (!q || !c) return null;
  if (q === c) return { kind: 'exact', score: 100 };

  const queryTokens = nameTokens(q);
  const candidateTokens = nameTokens(c);
  if (queryTokens.length === 0 || candidateTokens.length === 0) return null;

  const querySet = new Set(queryTokens);
  const matched = candidateTokens.filter((token) => querySet.has(token)).length;
  if (matched === 0) return null;

  const coverage = matched / candidateTokens.length;
  const score = 50 + Math.round(coverage * 30) + Math.min(10, matched * 5);
  return { kind: matched === candidateTokens.length ? 'tokens' : 'token', score };
}

function bestNameMatches<T>(
  items: T[],
  getName: (item: T) => string,
  query: string,
): Array<{ item: T; score: number }> {
  return items
    .map((item) => ({ item, match: nameMatchScore(query, getName(item)) }))
    .filter(
      (entry): entry is { item: T; match: { kind: 'exact' | 'tokens' | 'token'; score: number } } =>
        entry.match !== null,
    )
    .map((entry) => ({ item: entry.item, score: entry.match.score }))
    .sort((a, b) => b.score - a.score);
}

/** Coincidencia única por prefijo: "Tobi" → "Tobías". Solo devuelve si no hay empate. */
function bestPrefixMatch<T>(items: T[], getName: (item: T) => string, query: string): T | null {
  const q = normalize(query).trim();
  if (q.length < 3) return null;
  const matches = items.filter((item) => {
    const tokens = nameTokens(getName(item));
    return tokens.some((token) => token.startsWith(q) || q.startsWith(token));
  });
  return matches.length === 1 ? matches[0] : null;
}

function matchClients(
  pagador: string,
  clientes: ClienteRow[],
): Array<{ cliente: ClienteRow; coincidencia: string; score: number }> {  const digits = digitsOnly(pagador);
  const matches: Array<{ cliente: ClienteRow; coincidencia: string; score: number }> = [];
  for (const cliente of clientes) {
    const byName = nameMatchScore(pagador, cliente.nombre);
    if (byName) {
      matches.push({ cliente, coincidencia: byName.kind, score: byName.score });
      continue;
    }
    if (digits.length >= 4 && digitsOnly(cliente.telefono).includes(digits)) {
      matches.push({ cliente, coincidencia: 'telefono', score: 70 });
    }
  }
  return matches.sort((a, b) => b.score - a.score);
}

/** Palabras de un intento de pago que no forman parte del nombre del cliente. */
const PAYMENT_NOISE_RE =
  /\b(?:pagos?|pag[oó]|pagaron|pagamos|abon[oó]|abono|abonaron|abonamos|cobr[oó]|cobro|cobraron|transferencia|transferencias|transfiri[oó]|deposito|dep[oó]sito|efectivo|contado|billetes?|plata|dinero|total|parcial|adelanto|senia|se[ñn]a|saldo|sald[oó]|cancel[oó]|cancelo|pague|pagu[ée]|pagan|hizo|hace|hoy|ayer|el|la|los|las|un|una|de|del|en|por|con|y|a|al|que|me|le|lo|mi|ya|fue|son|mil|lucas?|pesos?|grupal)\b/gi;

/** Saca del texto el ruido del intento de pago para quedarse con el nombre del cliente. */
function cleanClientQuery(text: string): string {
  return normalize(text)
    .replace(/\$\s*[\d.,]+/g, ' ')
    .replace(/\b\d[\d.,]*\b/g, ' ')
    .replace(PAYMENT_NOISE_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cliente mencionado explícitamente en el texto del usuario, si hay uno claro. */
export async function resolveMentionedClientId(text: string): Promise<number | null> {
  if (!text.trim()) return null;
  try {
    const clientes = await loadClientes();
    const cleaned = cleanClientQuery(text);
    const attempts = cleaned && normalize(cleaned) !== normalize(text) ? [cleaned, text] : [text];
    for (const attempt of attempts) {
      const matches = matchClients(attempt, clientes);
      if (matches.length === 0) continue;
      const top = matches[0];
      if (top.score < 80) continue;
      if (matches.length > 1 && matches[1].score >= top.score) return null;
      return top.cliente.id;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Cliente mencionado en un intento de pago. Acepta nombre parcial ("Fabricio")
 * porque el texto ya viene limpio de ruido ("pagó en efectivo").
 * Exige que todas las palabras dichas pertenezcan al nombre y que no haya empate;
 * los tokens cortos (<4) nunca resuelven así: evita falsos positivos tipo "Ana".
 */
export async function resolvePaymentClientId(text: string): Promise<number | null> {
  if (!text.trim()) return null;
  try {
    const cleaned = cleanClientQuery(text);
    const tokens = nameTokens(cleaned);
    if (tokens.length === 0 || tokens.some((token) => token.length < 4)) return null;
    const clientes = await loadClientes();

    const exact = clientes.filter((cliente) => normalize(cliente.nombre) === cleaned);
    if (exact.length === 1) return exact[0].id;

    const matches = clientes
      .map((cliente) => {
        const candidateTokens = new Set(nameTokens(cliente.nombre));
        const matched = tokens.filter((token) => candidateTokens.has(token)).length;
        return { cliente, matched };
      })
      .filter((entry) => entry.matched === tokens.length)
      .sort((a, b) => b.matched - a.matched);

    if (matches.length === 0) return null;
    if (matches.length > 1 && matches[1].matched === matches[0].matched) return null;
    return matches[0].cliente.id;
  } catch {
    return null;
  }
}

/** El texto habla del destino de los fondos, no del cliente que pagó. */
export const DESTINATION_TEXT_RE =
  /\b(?:emplead[oa]s?|proveedor(?:a|es)?|destino|cuenta\s+(?:de|del)|a\s+nombre\s+de)\b/i;

/** Cliente mencionado en alguno de los últimos textos del usuario (de más reciente a más viejo). */
export async function resolveRecentClientMention(texts: string[]): Promise<number | null> {
  for (const text of texts) {
    if (!text?.trim() || DESTINATION_TEXT_RE.test(text)) continue;
    const id = (await resolvePaymentClientId(text)) ?? (await resolveMentionedClientId(text));
    if (id !== null) return id;
  }
  return null;
}

export type PaymentInvoice = { id: number; numero: string; fecha: string; saldo: number };

/** Datos de pago resueltos por el runtime para un turno (no se persisten). */
export interface PaymentContext {
  clientId: number;
  clientName: string;
  source: 'turno' | 'reciente';
  /** Facturas con saldo pendiente, de la más nueva a la más vieja. */
  invoices: PaymentInvoice[];
  total: number;
}

/** Facturas pendientes del cliente, listas para inyectar como contexto del turno. */
export async function buildPaymentContext(
  clientId: number,
  source: 'turno' | 'reciente',
): Promise<PaymentContext | null> {
  try {
    const [clientes, facturas, pagos] = await Promise.all([loadClientes(), loadFacturas(), loadPagosMap()]);
    const cliente = clientes.find((c) => c.id === clientId);
    if (!cliente) return null;
    const invoices = facturas
      .filter((f) => f.cliente_id === cliente.id)
      .map((f) => ({ id: f.id, numero: f.numero_factura, fecha: f.fecha, saldo: saldoOf(f, pagos) }))
      .filter((x) => x.saldo > 0.01)
      .sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
    const total = invoices.reduce((acc, x) => acc + x.saldo, 0);
    return {
      clientId: cliente.id,
      clientName: cliente.nombre,
      source,
      invoices,
      total: Math.round(total * 100) / 100,
    };
  } catch {
    return null;
  }
}

/** Método de cobro mencionado explícitamente en un texto. undefined si no surge. */
export function detectPaymentMethod(text: string | null | undefined): 'Efectivo' | 'Transferencia' | undefined {
  const clean = normalize(text);
  if (!clean) return undefined;
  if (/\btransfer|\btransf\b|\bdeposito\b/.test(clean)) return 'Transferencia';
  if (/\befectivo\b|\bcontado\b|\ben mano\b|\bbilletes?\b/.test(clean)) return 'Efectivo';
  return undefined;
}

/** true si el texto trae un monto explícito (excluye números de factura). */
export function hasExplicitAmount(text: string): boolean {
  const clean = String(text ?? '').replace(/\b[fF]-?\d{2,}\b/g, ' ');
  return /(?:\$\s*\d|\b\d{1,3}(?:[.,]\d{3})+\b|\b\d{1,3}\s*(?:mil|k|lucas?|palos?)\b|\b\d{4,}\b)/i.test(
    clean,
  );
}

/** Invalida todo lo que depende de movimientos de dinero (caché de tools y de pantallas). */
export function invalidateMoneyCaches(): void {
  // invalidate es por prefijo: cubre facturas:semanal:*, empleados:all, caja:all, etc.
  for (const key of [
    'pagos',
    'facturas',
    'providers',
    'provider:',
    'employees',
    'employee:',
    'clientes',
    'caja',
    'mapa-base',
  ]) {
    cacheStore.invalidate(key);
  }
}

/** Metadata de undo de un tool call, derivada del resultado (sirve también para mensajes viejos). */
export function undoOf(call: ToolCallView): UndoAction | null {
  // Compatibilidad con la primera versión del undo (guardaba solo paymentId).
  const legacy = call.undo as unknown as { paymentId?: unknown; doneAt?: unknown } | undefined;
  if (legacy && typeof legacy.paymentId === 'number') {
    const base = findTool('registrar_pago_factura')?.undo?.(call.args, { id: legacy.paymentId });
    if (base) return { ...base, doneAt: typeof legacy.doneAt === 'number' ? legacy.doneAt : undefined };
  }
  if (call.undo) return call.undo;
  if (call.error || call.pending) return null;
  const tool = findTool(call.name);
  if (!tool?.undo || call.result === undefined) return null;
  return tool.undo(call.args, call.result) ?? null;
}

/** Ejecuta el borrado correspondiente y vuelve el saldo cuando aplica. */
export async function performUndo(action: UndoAction): Promise<string> {
  const numericId = typeof action.id === 'number' ? action.id : Number(action.id);
  const productId = typeof action.id === 'string' ? action.id : String(action.id);

  switch (action.kind) {
    case 'pago_factura':
      await api.deletePago(numericId);
      break;
    case 'gasto':
      await api.deleteExpense(numericId);
      break;
    case 'pago_sueldo':
      await api.deleteEmployeePayment(numericId);
      break;
    case 'movimiento_proveedor':
      await api.deleteProviderMovement(numericId);
      break;
    case 'factura': {
      cacheStore.invalidate('pagos');
      const pagos = (await loadPagos()).filter((p) => p.invoice_id === numericId);
      if (pagos.length > 0) {
        throw new ToolInputError(
          'La factura tiene pagos registrados. Deshacé primero los pagos y después la factura.',
        );
      }
      await api.deleteFactura(numericId);
      break;
    }
    case 'estado_factura': {
      const prev = action.data ?? {};
      for (const [field, value] of Object.entries(prev)) {
        if (typeof value === 'string' && value) {
          await api.patchInvoiceField(numericId, field, value);
        }
      }
      break;
    }
    case 'cliente_editado':
      await api.updateCliente(numericId, action.data ?? {});
      break;
    case 'proveedor_editado':
      await api.updateProvider(numericId, action.data ?? {});
      break;
    case 'empleado_editado':
      await api.updateEmployee(numericId, action.data ?? {});
      break;
    case 'gasto_editado':
      await api.updateExpense(numericId, action.data ?? {});
      break;
    case 'pago_editado':
      await api.updatePago(numericId, action.data ?? {});
      break;
    case 'producto_creado':
      await api.deleteProducto(productId);
      break;
    case 'producto_editado':
      await api.updateProducto(productId, action.data ?? {});
      break;
    case 'producto_eliminado':
      await api.addProducto(action.data ?? {});
      break;
  }
  invalidateMoneyCaches();
  if (action.kind.startsWith('producto_')) cacheStore.invalidate('productos');

  let extra = '';
  if (action.kind === 'pago_factura' && action.invoiceId) {
    try {
      const snapshot = await invoiceSnapshot(action.invoiceId);
      if (snapshot) extra = ` El saldo volvió a ${formatMoney(snapshot.saldo)}.`;
    } catch {
      extra = '';
    }
  }
  return `Listo, deshice ${action.message}.${extra}`;
}

/** Borra un pago. El backend revierte el movimiento de proveedor/empleado vinculado. */
export async function deletePayment(paymentId: number): Promise<void> {
  await api.deletePago(paymentId);
  invalidateMoneyCaches();
}

/** Estado actual de una factura (para contar el saldo después de deshacer). */
export async function invoiceSnapshot(
  invoiceId: number,
): Promise<{ numero: string; cliente: string; saldo: number } | null> {
  const [facturas, pagos] = await Promise.all([loadFacturas(), loadPagosMap()]);
  const factura = facturas.find((f) => f.id === invoiceId);
  if (!factura) return null;
  return {
    numero: factura.numero_factura,
    cliente: factura.cliente_nombre,
    saldo: saldoOf(factura, pagos),
  };
}

type DestinoCandidate = {
  tipo: 'proveedor' | 'empleado';
  id: number;
  nombre: string;
  coincidencia: string;
  score: number;
  saldo?: number;
  activo?: boolean;
};

function matchDestinations(
  proveedores: ProviderRow[],
  empleados: EmployeeRow[],
  input: { nombre?: string; cuit?: string; cbu?: string; alias?: string },
): DestinoCandidate[] {
  const cuit = digitsOnly(input.cuit);
  const cbu = digitsOnly(input.cbu);
  const alias = normalizeAlias(input.alias);
  const nombre = input.nombre;
  const out: DestinoCandidate[] = [];

  const consider = (
    tipo: 'proveedor' | 'empleado',
    id: number,
    name: string,
    cuitValue: string | null | undefined,
    cbuValue: string | null | undefined,
    aliasValues: Array<string | null | undefined>,
    saldo?: number,
    activo?: boolean,
  ) => {
    let match: { kind: string; score: number } | null = null;
    if (cuit && cuit.length >= 8 && digitsOnly(cuitValue) === cuit) {
      match = { kind: 'cuit', score: 200 };
    } else if (cbu && cbu.length >= 8 && digitsOnly(cbuValue) === cbu) {
      match = { kind: 'cbu', score: 190 };
    } else if (alias && aliasValues.some((value) => normalizeAlias(value) === alias)) {
      match = { kind: 'alias', score: 180 };
    } else if (nombre) {
      const byName = nameMatchScore(nombre, name);
      if (byName) match = { kind: byName.kind, score: byName.score };
    }
    if (match) out.push({ tipo, id, nombre: name, coincidencia: match.kind, score: match.score, saldo, activo });
  };

  for (const proveedor of proveedores) {
    consider(
      'proveedor',
      proveedor.id,
      proveedor.name,
      proveedor.cuit,
      proveedor.alias_cbu,
      [proveedor.alias_mp, proveedor.alias_cbu],
      proveedor.balance,
    );
  }
  for (const empleado of empleados) {
    consider(
      'empleado',
      empleado.id,
      empleado.name,
      empleado.cuit,
      empleado.cbu,
      [empleado.alias],
      undefined,
      empleado.active,
    );
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

type PendingInvoice = { factura: FacturaRow; saldo: number };

function findExactCombinations(
  invoices: PendingInvoice[],
  target: number,
  maxSize = 4,
  limit = 5,
): PendingInvoice[][] {
  const singles = invoices.filter((item) => Math.abs(item.saldo - target) <= 0.01);
  if (singles.length > 0) return singles.slice(0, limit).map((item) => [item]);

  const pool = invoices
    .filter((item) => item.saldo < target - 0.01)
    .sort((a, b) => b.saldo - a.saldo)
    .slice(0, 30);
  const results: PendingInvoice[][] = [];
  const chosen: PendingInvoice[] = [];

  const dfs = (start: number, remaining: number) => {
    if (results.length >= limit) return;
    if (Math.abs(remaining) <= 0.01) {
      results.push([...chosen]);
      return;
    }
    if (chosen.length >= maxSize || remaining < -0.01) return;
    for (let index = start; index < pool.length; index++) {
      const item = pool[index];
      if (item.saldo > remaining + 0.01) continue;
      chosen.push(item);
      dfs(index + 1, remaining - item.saldo);
      chosen.pop();
      if (results.length >= limit) return;
    }
  };

  dfs(0, target);
  return results;
}

/* Listas compartidas: misma caché que usa la app (se invalida al mutar). */
type TaskRow = { id: number; text: string; done: boolean; position: number; pinned: boolean; created_at?: string | null; assigned_by: string | null };
type FacturaRow = {
  id: number;
  numero_factura: string;
  fecha: string;
  cliente_id: number | null;
  cliente_nombre: string;
  total: number;
  estado_kanban: string;
  tipo?: string;
  estado_entrega?: string | null;
  estado_moldura?: string | null;
  estado_orden_tela?: string | null;
  tipo_entrega?: string | null;
  fecha_entrega?: string | null;
  envio?: number | null;
  cliente_domicilio?: string | null;
  cliente_piso_depto?: string | null;
  cliente_taller?: string | null;
  fecha_iso?: string | null;
  items?: Array<{ descripcion: string; cantidad?: number; precio_unitario?: number; total?: number }>;
};

type PagoFullRow = {
  id: number;
  invoice_id: number;
  amount: number;
  date: string;
  method: string;
  user_id?: number | null;
  entity_type?: string | null;
  entity_id?: number | null;
  extra_client_name?: string | null;
  extra_invoice_num?: string | null;
  extra_invoice_total?: number | null;
};

async function loadTasks(): Promise<TaskRow[]> {
  return (await api.listTasks()) as TaskRow[];
}

async function loadClientes() {
  return cacheStore.fetch('clientes', () => api.listClientes(), 1_800_000);
}

async function loadFacturas(): Promise<FacturaRow[]> {
  return cacheStore.fetch<FacturaRow[]>(
    'facturas',
    () => api.listFacturas({ limit: 2000 }) as Promise<FacturaRow[]>,
    300_000,
  );
}

async function loadPagos(): Promise<PagoFullRow[]> {
  return cacheStore.fetch<PagoFullRow[]>('pagos', () => api.listPagos() as Promise<PagoFullRow[]>, 120_000);
}

async function loadPagosMap(): Promise<Map<number, number>> {
  const pagos = await loadPagos();
  const map = new Map<number, number>();
  for (const p of pagos) {
    map.set(p.invoice_id, (map.get(p.invoice_id) ?? 0) + (Number(p.amount) || 0));
  }
  return map;
}

function saldoOf(factura: FacturaRow, pagos: Map<number, number>): number {
  const total = Number(factura.total) || 0;
  return Math.round((total - (pagos.get(factura.id) ?? 0)) * 100) / 100;
}

async function findTask(id: number): Promise<TaskRow> {
  const tasks = await loadTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new ToolInputError(`No existe una tarea con id ${id}. Buscala primero con listar_tareas.`);
  return task as TaskRow;
}

/* ------------------------------------------------------------------ */
/* Gastos y asistencia: tipos, loaders y helpers                       */
/* ------------------------------------------------------------------ */

type EmployeeRow = {
  id: number;
  name: string;
  active: boolean;
  entry_time?: string | null;
  exit_time?: string | null;
  late_threshold?: number | null;
  is_owner?: number | null;
  cuit?: string | null;
  cbu?: string | null;
  alias?: string | null;
  phone?: string | null;
  address?: string | null;
  hire_date?: string | null;
  job_type?: string | null;
  payment_freq?: string | null;
  base_salary?: number | null;
  attendance_bonus?: number | null;
  work_days?: string | null;
};
type CategoriaRow = { id: number; name: string; slug: string; type: string };
type ProviderRow = {
  id: number;
  name: string;
  balance?: number;
  stock_qty?: number;
  cuit?: string | null;
  alias_mp?: string | null;
  alias_cbu?: string | null;
  address?: string | null;
};
type ClienteRow = {
  id: number;
  nombre: string;
  telefono: string;
  domicilio?: string;
  taller?: string;
  estudiante?: string;
  ultimo_tipo_entrega?: string;
};
type AttendanceRow = { id: number; employee_id: number; date: string; status: string | null; exit_time?: string | null };
type EmployeePaymentRow = {
  id: number;
  employee_id: number;
  date: string;
  amount: number;
  mode?: string | null;
  detail?: string | null;
};
type ProviderMovementRow = {
  id: number;
  provider_id: number;
  date: string;
  type: string;
  description: string;
  quantity?: number | null;
  amount?: number | null;
  reference?: string | null;
};

type EstadoAsistencia = 'presente' | 'ausente' | 'vacaciones' | 'licencia' | 'tarde';

const PAYMENT_METHODS = ['efectivo', 'transferencia', 'debito', 'credito', 'mercadopago'];

async function loadCategorias(): Promise<CategoriaRow[]> {
  return cacheStore.fetch<CategoriaRow[]>(
    'assistant:expense-categories',
    () => api.listExpenseCategories() as Promise<CategoriaRow[]>,
    300_000,
  );
}

async function loadEmpleados(activeOnly = true): Promise<EmployeeRow[]> {
  return cacheStore.fetch<EmployeeRow[]>(
    activeOnly ? 'employees:active' : 'employees',
    () => api.listEmployees(activeOnly) as Promise<EmployeeRow[]>,
    900_000,
  );
}

async function loadProviders(): Promise<ProviderRow[]> {
  return cacheStore.fetch<ProviderRow[]>('providers', () => api.listProviders() as Promise<ProviderRow[]>, 900_000);
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function nowTime(): string {
  const d = new Date();
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function currentMonth(): string {
  return todayIso().slice(0, 7);
}

function isValidMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function normalizeTime(value: string): string {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) throw new ToolInputError('La hora debe tener formato HH:MM.');
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new ToolInputError(`Hora inválida: ${value}.`);
  return `${pad2(hours)}:${pad2(minutes)}`;
}

function minutesOf(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 }).format(
    value || 0,
  );
}

function money(value: number): string {
  return formatMoney(value);
}

function shortDate(iso: string): string {
  const parts = iso.split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : iso;
}

function attendanceInfo(status: string | null | undefined): { tipo: string; hora_entrada?: string; nota?: string } {
  const value = String(status ?? '').trim();
  if (!value) return { tipo: 'sin_registro' };
  if (value === 'AUS') return { tipo: 'ausente' };
  if (value === 'VACACIONES') return { tipo: 'vacaciones' };
  if (value === 'LICENCIA') return { tipo: 'licencia' };
  if (value.startsWith('TARDE-')) return { tipo: 'tarde', hora_entrada: value.slice('TARDE-'.length) };
  if (value.startsWith('NOTA:')) return { tipo: 'nota', nota: value.slice('NOTA:'.length) };
  return { tipo: 'presente', hora_entrada: value };
}

function attendanceLabel(info: { tipo: string; hora_entrada?: string; nota?: string }): string {
  switch (info.tipo) {
    case 'presente':
      return `presente${info.hora_entrada ? ` ${info.hora_entrada}` : ''}`;
    case 'tarde':
      return `tarde${info.hora_entrada ? ` ${info.hora_entrada}` : ''}`;
    case 'ausente':
      return 'ausente';
    case 'vacaciones':
      return 'vacaciones';
    case 'licencia':
      return 'licencia';
    case 'nota':
      return `nota: ${info.nota ?? ''}`;
    default:
      return info.tipo;
  }
}

function classifyArrival(employee: EmployeeRow, time: string): string {
  if (!employee.entry_time) return time;
  const diff = minutesOf(time) - minutesOf(employee.entry_time);
  const threshold = Number(employee.late_threshold ?? 5);
  return diff > threshold ? `TARDE-${time}` : time;
}

function parseEstadoAsistencia(value: string | undefined): EstadoAsistencia {
  if (!value) return 'presente';
  const clean = normalize(value);
  if (clean.startsWith('tarde') || clean === 'llego tarde') return 'tarde';
  if (clean.startsWith('presente') || clean === 'vino' || clean === 'asistio') return 'presente';
  if (clean.startsWith('ausent') || clean === 'falto') return 'ausente';
  if (clean.startsWith('vacacion')) return 'vacaciones';
  if (clean.startsWith('licencia')) return 'licencia';
  throw new ToolInputError('Estado inválido. Usá: presente, ausente, vacaciones, licencia o tarde.');
}

function parseMetodoPago(value: string | undefined): string {
  if (!value) return 'efectivo';
  const clean = normalize(value);
  const aliases: Record<string, string> = {
    efectivo: 'efectivo',
    cash: 'efectivo',
    transferencia: 'transferencia',
    transfer: 'transferencia',
    debito: 'debito',
    credito: 'credito',
    mercadopago: 'mercadopago',
    'mercado pago': 'mercadopago',
    mp: 'mercadopago',
  };
  const found = aliases[clean];
  if (!found) throw new ToolInputError(`Método de pago inválido. Usá: ${PAYMENT_METHODS.join(', ')}.`);
  return found;
}

function parseTipoMovimiento(value: string | undefined): 'PURCHASE' | 'PAYMENT' {
  const clean = normalize(value);
  if (clean.startsWith('compra') || clean === 'purchase') return 'PURCHASE';
  if (clean.startsWith('pago') || clean === 'payment') return 'PAYMENT';
  throw new ToolInputError('El tipo de movimiento debe ser "compra" o "pago".');
}

function movementTypeLabel(type: string): string {
  switch (type) {
    case 'PURCHASE':
      return 'compra';
    case 'PAYMENT':
      return 'pago';
    case 'STOCK_IN':
      return 'ingreso de stock';
    case 'STOCK_OUT':
      return 'egreso de stock';
    default:
      return type.toLowerCase();
  }
}

async function resolveCategoria(nombre: string | undefined, id: number | undefined): Promise<CategoriaRow> {
  const categorias = await loadCategorias();
  if (categorias.length === 0) throw new ToolInputError('No hay categorías de gasto cargadas.');
  if (id !== undefined) {
    const found = categorias.find((c) => c.id === id);
    if (!found) throw new ToolInputError(`No existe la categoría de gasto con id ${id}.`);
    return found;
  }
  const query = normalize(nombre);
  if (!query) throw new ToolInputError('Falta la categoría del gasto. Usá listar_categorias_gasto para ver las disponibles.');
  const exact = categorias.filter((c) => normalize(c.name) === query || normalize(c.slug) === query);
  if (exact.length === 1) return exact[0];
  const partial = categorias.filter((c) => normalize(c.name).includes(query) || query.includes(normalize(c.name)));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    throw new ToolInputError(`Categoría ambigua: ${partial.map((c) => c.name).join(', ')}. Elegí una.`);
  }
  throw new ToolInputError(`No encontré la categoría “${nombre}”. Disponibles: ${categorias.map((c) => c.name).join(', ')}.`);
}

async function resolveEmpleado(
  nombre: string | undefined,
  id: number | undefined,
  activeOnly = true,
): Promise<EmployeeRow> {
  const empleados = await loadEmpleados(activeOnly);
  if (id !== undefined) {
    const found = empleados.find((e) => e.id === id);
    if (!found) throw new ToolInputError(`No existe el empleado con id ${id}.`);
    return found;
  }
  const query = normalize(nombre);
  if (!query) throw new ToolInputError('Falta el empleado. Usá listar_empleados para ver los disponibles.');

  const pick = (items: EmployeeRow[]): EmployeeRow | null => {
    const scored = bestNameMatches(items, (e) => e.name, query);
    if (scored.length === 0) return null;
    const topScore = scored[0].score;
    const ties = scored.filter((entry) => entry.score === topScore);
    if (ties.length === 1) return ties[0].item;
    throw new ToolInputError(
      `Hay varios empleados que coinciden: ${ties.map((entry) => entry.item.name).join(', ')}. Decime cuál.`,
    );
  };

  const found = pick(empleados) ?? bestPrefixMatch(empleados, (e) => e.name, nombre ?? '');
  if (found) return found;

  if (activeOnly) {
    const all = await loadEmpleados(false);
    const inactive = pick(all) ?? bestPrefixMatch(all, (e) => e.name, nombre ?? '');
    if (inactive) return inactive;
  }

  const all = activeOnly ? await loadEmpleados(false) : empleados;
  throw new ToolInputError(`No encontré al empleado “${nombre}”. Disponibles: ${all.map((e) => e.name).join(', ')}.`);
}

async function resolveProveedor(nombre: string | undefined, id: number | undefined): Promise<ProviderRow> {
  const proveedores = await loadProviders();
  if (id !== undefined) {
    const found = proveedores.find((p) => p.id === id);
    if (!found) throw new ToolInputError(`No existe el proveedor con id ${id}.`);
    return found;
  }
  const query = normalize(nombre);
  if (!query) throw new ToolInputError('Falta el proveedor.');
  const scored = bestNameMatches(proveedores, (p) => p.name, query);
  if (scored.length === 0) {
    const prefix = bestPrefixMatch(proveedores, (p) => p.name, nombre ?? '');
    if (prefix) return prefix;
    throw new ToolInputError(`No encontré al proveedor “${nombre}”.`);
  }
  const topScore = scored[0].score;
  const ties = scored.filter((entry) => entry.score === topScore);
  if (ties.length === 1) return ties[0].item;
  throw new ToolInputError(
    `Hay varios proveedores que coinciden: ${ties.map((entry) => entry.item.name).join(', ')}. Decime cuál.`,
  );
}

export interface DestinoResuelto {
  tipo: 'proveedor' | 'empleado';
  id: number;
  nombre: string;
}

/**
 * Resuelve el destino de fondos a partir de una respuesta corta del usuario
 * ("el empleado es Tobi", "a Textil Muñoz"). Devuelve candidatos si hay empate.
 */
export async function resolveDestinoFromText(
  text: string,
): Promise<{ ok: true; destino: DestinoResuelto } | { ok: false; candidatos: DestinoResuelto[] } | null> {
  const raw = normalize(text);
  if (!raw.trim()) return null;
  const wantsEmpleado = /\bemplead/.test(raw);
  const wantsProveedor = /\bproveedor/.test(raw);
  const query = raw
    .replace(
      /\b(?:el|la|los|las|un|una|es|fue|fondo|fondos|destino|empleado|empleada|proveedor|proveedora|a|al|para|de|del|cuenta|transferencia|transferi|mande|pase|plata|dinero)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  if (!query) return null;

  const [empleados, proveedores] = await Promise.all([loadEmpleados(true), loadProviders()]);
  const pool: DestinoResuelto[] = [];
  if (!wantsProveedor) {
    for (const empleado of empleados) {
      pool.push({ tipo: 'empleado', id: empleado.id, nombre: empleado.name });
    }
  }
  if (!wantsEmpleado) {
    for (const proveedor of proveedores) {
      pool.push({ tipo: 'proveedor', id: proveedor.id, nombre: proveedor.name });
    }
  }

  const scored = bestNameMatches(pool, (destino) => destino.nombre, query);
  const topScore = scored[0]?.score ?? 0;
  let matches = scored.filter((entry) => entry.score === topScore).map((entry) => entry.item);
  if (matches.length === 0) {
    matches = pool.filter((destino) =>
      nameTokens(destino.nombre).some((token) => token.startsWith(query) || query.startsWith(token)),
    );
  }
  if (matches.length === 1) return { ok: true, destino: matches[0] };
  if (matches.length > 1) return { ok: false, candidatos: matches.slice(0, 6) };
  return null;
}

function parseMetodoCobro(value: string | undefined): 'Efectivo' | 'Transferencia' {
  if (!value) throw new ToolInputError('Falta el método: ¿efectivo o transferencia?');
  const clean = normalize(value);
  if (clean.startsWith('transf')) return 'Transferencia';
  if (clean.startsWith('efect') || clean === 'cash') return 'Efectivo';
  throw new ToolInputError('El método debe ser "Efectivo" o "Transferencia".');
}

function parseDestinoTipo(value: string | undefined): 'proveedor' | 'empleado' | undefined {
  if (!value) return undefined;
  const clean = normalize(value);
  if (clean.startsWith('proveedor')) return 'proveedor';
  if (clean.startsWith('empleado')) return 'empleado';
  throw new ToolInputError('El destino debe ser "proveedor" o "empleado".');
}

function parseTipoEmpleado(value: string | undefined): 'NOMINA' | 'OCASIONAL' {
  const clean = normalize(value);
  if (!clean || clean.startsWith('nomina') || clean === 'fijo') return 'NOMINA';
  if (clean.startsWith('ocasional') || clean === 'eventual') return 'OCASIONAL';
  throw new ToolInputError('El tipo debe ser "NOMINA" u "OCASIONAL".');
}

function parseFrecuenciaPago(value: string | undefined): 'SEMANAL' | 'MENSUAL' | 'POR HORA' {
  if (!value) return 'MENSUAL';
  const clean = normalize(value).replace(/\s+/g, ' ');
  if (clean.startsWith('semanal')) return 'SEMANAL';
  if (clean.startsWith('mensual')) return 'MENSUAL';
  if (clean === 'por hora' || clean === 'hora' || clean === 'porhora') return 'POR HORA';
  throw new ToolInputError('La frecuencia debe ser "SEMANAL", "MENSUAL" o "POR HORA".');
}

async function resolveFactura(
  facturaId: number | undefined,
  numero: string | undefined,
  clienteNombre: string | undefined,
): Promise<FacturaRow> {
  const facturas = await loadFacturas();
  if (facturaId !== undefined) {
    const found = facturas.find((f) => f.id === facturaId);
    if (found) return found;
    // El modelo a veces manda el número (F-11041) como id (11041): intentamos resolverlo.
    const suffix = String(facturaId);
    const byNumero = facturas.filter((f) => {
      const numero = normalize(f.numero_factura);
      return numero === `f-${suffix}` || numero === suffix || numero.endsWith(`-${suffix}`);
    });
    if (byNumero.length === 1) return byNumero[0];
    if (byNumero.length > 1) {
      const candidatas = byNumero
        .slice(0, 10)
        .map((f) => `${f.numero_factura} - ${f.cliente_nombre} - total ${money(Number(f.total) || 0)}`);
      throw new ToolInputError(
        `El número ${facturaId} coincide con varias facturas: ${candidatas.join('; ')}. Pasá el id o el cliente.`,
      );
    }
    throw new ToolInputError(`No existe la factura con id ${facturaId}.`);
  }

  const query = normalize(numero);
  if (!query) throw new ToolInputError('Pasá factura_id o numero_factura.');
  let matches = facturas.filter((f) => normalize(f.numero_factura) === query);
  if (matches.length === 0) {
    matches = facturas.filter((f) => normalize(f.numero_factura).includes(query));
  }
  if (clienteNombre) {
    const clienteQuery = normalize(clienteNombre);
    matches = matches.filter((f) => normalize(f.cliente_nombre).includes(clienteQuery));
  }

  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw new ToolInputError(`No encontré la factura “${numero}”.`);
  const candidatas = matches
    .slice(0, 10)
    .map((f) => `${f.numero_factura} — ${f.cliente_nombre} — total ${money(Number(f.total) || 0)}`);
  throw new ToolInputError(`Hay varias facturas que coinciden: ${candidatas.join('; ')}. Pasá el id o el cliente.`);
}

async function pagoInfo(factura: FacturaRow): Promise<{ pagado: number; saldo: number; pagos: PagoFullRow[] }> {
  const pagos = (await loadPagos()).filter((p) => p.invoice_id === factura.id);
  const pagado = pagos.reduce((acc, p) => acc + Number(p.amount || 0), 0);
  const total = Number(factura.total) || 0;
  return {
    pagado: Math.round(pagado * 100) / 100,
    saldo: Math.round((total - pagado) * 100) / 100,
    pagos,
  };
}

/* ------------------------------------------------------------------ */
/* Lecturas                                                            */
/* ------------------------------------------------------------------ */

const listarTareas: ToolDef = {
  name: 'listar_tareas',
  description:
    'Lista las tareas del panel. Por defecto devuelve solo las pendientes. Usala para responder qué hay para hacer y para obtener ids reales antes de editar, marcar, fijar o eliminar.',
  effect: 'read',
  parameters: {
    type: 'object',
    properties: {
      incluir_hechas: { type: 'boolean', description: 'Incluir tareas ya completadas.' },
      solo_fijadas: { type: 'boolean', description: 'Solo tareas fijadas arriba del panel.' },
      texto: { type: 'string', description: 'Filtro por texto contenido.' },
    },
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    return {
      incluir_hechas: optionalBool(obj, 'incluir_hechas') ?? false,
      solo_fijadas: optionalBool(obj, 'solo_fijadas') ?? false,
      texto: optionalText(obj, 'texto', 120),
    };
  },
  async run(args) {
    const tasks = await loadTasks();
    const query = normalize(args.texto as string | undefined);
    const includeDone = args.incluir_hechas === true;
    const onlyPinned = args.solo_fijadas === true;
    const filtered = tasks.filter(
      (t) =>
        (includeDone || !t.done) &&
        (!onlyPinned || t.pinned) &&
        (!query || normalize(t.text).includes(query)),
    );
    return {
      total: filtered.length,
      tareas: filtered.map((t) => ({
        id: t.id,
        texto: t.text,
        hecha: t.done,
        fijada: t.pinned,
        ...(t.assigned_by ? { creada_por: t.assigned_by } : {}),
      })),
    };
  },
};

const buscarClientes: ToolDef = {
  name: 'buscar_clientes',
  description:
    'Busca clientes por nombre o teléfono (parcial, ignora acentos y mayúsculas). Devuelve id, nombre, teléfono y domicilio. Usala para resolver el cliente antes de consultar deudas o cobrar una factura.',
  effect: 'read',
  parameters: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Parte del nombre o número de teléfono.' },
      limite: { type: 'integer', description: 'Máximo de resultados (1-15). Default 8.' },
    },
    required: ['texto'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    return {
      texto: requiredText(obj, 'texto', 120),
      limite: Math.min(15, Math.max(1, Math.trunc(optionalNumber(obj, 'limite') ?? 8))),
    };
  },
  async run(args) {
    const raw = args.texto as string;
    const clientes = await loadClientes();
    const matches = matchClients(raw, clientes);
    const limit = args.limite as number;
    return {
      total: matches.length,
      clientes: matches.slice(0, limit).map(({ cliente, coincidencia }) => ({
        id: cliente.id,
        nombre: cliente.nombre,
        telefono: cliente.telefono || undefined,
        domicilio: cliente.domicilio || undefined,
        coincidencia,
      })),
    };
  },
};

const consultarDeudasCliente: ToolDef = {
  name: 'consultar_deudas_cliente',
  description:
    'Devuelve las facturas con saldo pendiente de un cliente y el total que debe. Pasá cliente_id si ya lo tenés; si no, pasá nombre y la tool resuelve. Si hay varios clientes con ese nombre devuelve "ambiguo" con candidatos y tenés que preguntar.',
  effect: 'read',
  parameters: {
    type: 'object',
    properties: {
      cliente_id: { type: 'integer', description: 'Id del cliente si ya lo conocés.' },
      nombre: { type: 'string', description: 'Nombre o parte del nombre del cliente.' },
      incluir_pagadas: { type: 'boolean', description: 'Incluir facturas ya saldadas.' },
    },
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const clienteId = optionalNumber(obj, 'cliente_id');
    return {
      cliente_id: clienteId !== undefined ? requiredInt(obj, 'cliente_id') : undefined,
      nombre: optionalText(obj, 'nombre', 120),
      incluir_pagadas: optionalBool(obj, 'incluir_pagadas') ?? false,
    };
  },
  async run(args) {
    const clientes = await loadClientes();
    const clienteId = args.cliente_id as number | undefined;
    let cliente = clienteId !== undefined ? clientes.find((c) => c.id === clienteId) : undefined;

    if (clienteId !== undefined && !cliente) {
      return { encontrado: false, mensaje: `No existe un cliente con id ${clienteId}.` };
    }

    if (!cliente) {
      const query = normalize(args.nombre as string | undefined);
      if (!query) throw new ToolInputError('Pasá cliente_id o nombre.');
      const matches = clientes.filter((c) => normalize(c.nombre).includes(query));
      if (matches.length === 0) return { encontrado: false, mensaje: `No hay clientes que coincidan con "${args.nombre}".` };
      if (matches.length > 1) {
        return {
          ambiguo: true,
          mensaje: 'Hay varios clientes con ese nombre. Preguntá a cuál se refiere.',
          candidatos: matches.slice(0, 10).map((c) => ({ id: c.id, nombre: c.nombre, telefono: c.telefono || undefined })),
        };
      }
      cliente = matches[0];
    }

    const [facturas, pagos] = await Promise.all([loadFacturas(), loadPagosMap()]);
    const propias = facturas.filter((f) => f.cliente_id === cliente!.id);
    const conSaldo = propias
      .map((f) => ({ factura: f, saldo: saldoOf(f, pagos) }))
      .filter((x) => args.incluir_pagadas === true || x.saldo > 0.5)
      .sort((a, b) => (a.factura.fecha < b.factura.fecha ? 1 : -1));

    const total = conSaldo.reduce((acc, x) => acc + Math.max(0, x.saldo), 0);
    return {
      cliente: { id: cliente.id, nombre: cliente.nombre, telefono: cliente.telefono || undefined },
      cantidad: conSaldo.length,
      total_deuda: Math.round(total * 100) / 100,
      facturas: conSaldo.slice(0, 40).map((x) => ({
        id: x.factura.id,
        numero: x.factura.numero_factura,
        fecha: x.factura.fecha,
        total: x.factura.total,
        saldo: x.saldo,
        estado: x.factura.estado_kanban,
        tipo: x.factura.tipo,
      })),
    };
  },
};

const consultarFacturas: ToolDef = {
  name: 'consultar_facturas',
  description:
    'Busca facturas/presupuestos por número, cliente, monto de saldo o descripción de ítem (ej. "pintura 108x140"). Las coincidencias por ítem se limitan a los últimos 3 meses y a pedidos pendientes de entrega (excluye NO_CONFIRMADO y ARCHIVADO); si no hay, devuelve el histórico marcando fuera_de_ventana. Devuelve estado de entrega y de tablero. Para la deuda de un cliente usá consultar_deudas_cliente.',
  effect: 'read',
  parameters: {
    type: 'object',
    properties: {
      texto: {
        type: 'string',
        description: 'Número, cliente o descripción/medida de un ítem (ej. "pintura 108x140").',
      },
      cliente_id: { type: 'integer', description: 'Filtrar por id de cliente.' },
      monto: { type: 'number', description: 'Buscar facturas cuyo saldo sea igual a este monto.' },
      tolerancia: { type: 'number', description: 'Diferencia aceptada para el monto. Default 0.' },
      solo_con_saldo: { type: 'boolean', description: 'Solo facturas con saldo pendiente. Default false.' },
      meses: {
        type: 'integer',
        description: 'Ventana para coincidencias por ítem. Default 3; 0 = todo el historial.',
      },
      incluir_entregadas: {
        type: 'boolean',
        description: 'Incluir facturas ya entregadas en la búsqueda por ítem. Default false.',
      },
      limite: { type: 'integer', description: 'Máximo de resultados (1-50). Default 20.' },
    },
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const clienteId = optionalNumber(obj, 'cliente_id');
    const monto = optionalNumber(obj, 'monto');
    if (monto !== undefined && monto <= 0) throw new ToolInputError('"monto" debe ser mayor a 0.');
    const tolerancia = optionalNumber(obj, 'tolerancia');
    const meses = optionalNumber(obj, 'meses');
    return {
      texto: optionalText(obj, 'texto', 120),
      cliente_id: clienteId !== undefined ? requiredInt(obj, 'cliente_id') : undefined,
      monto,
      tolerancia: tolerancia !== undefined ? Math.max(0, tolerancia) : 0,
      solo_con_saldo: optionalBool(obj, 'solo_con_saldo') ?? false,
      meses: meses === undefined ? 3 : Math.min(60, Math.max(0, Math.trunc(meses))),
      incluir_entregadas: optionalBool(obj, 'incluir_entregadas') ?? false,
      limite: Math.min(50, Math.max(1, Math.trunc(optionalNumber(obj, 'limite') ?? 20))),
    };
  },
  async run(args) {
    const [facturas, pagos] = await Promise.all([loadFacturas(), loadPagosMap()]);
    const texto = (args.texto as string | undefined) ?? '';
    const query = normalize(texto);
    const clienteId = args.cliente_id as number | undefined;
    const monto = args.monto as number | undefined;
    const tolerancia = args.tolerancia as number;
    const meses = args.meses as number;
    const incluirEntregadas = args.incluir_entregadas === true;
    const limite = args.limite as number;

    type Coincidencia = {
      factura: FacturaRow;
      saldo: number;
      motivos: Set<string>;
      items: Array<{ descripcion: string; cantidad: number; precio_unitario: number }>;
    };
    const porFactura = new Map<number, Coincidencia>();
    const agregar = (factura: FacturaRow, motivo: string): Coincidencia => {
      const actual = porFactura.get(factura.id);
      if (actual) {
        actual.motivos.add(motivo);
        return actual;
      }
      const nuevo: Coincidencia = {
        factura,
        saldo: saldoOf(factura, pagos),
        motivos: new Set([motivo]),
        items: [],
      };
      porFactura.set(factura.id, nuevo);
      return nuevo;
    };

    const baseOk = (factura: FacturaRow) => {
      if (clienteId !== undefined && factura.cliente_id !== clienteId) return false;
      const saldo = saldoOf(factura, pagos);
      if (args.solo_con_saldo === true && saldo <= 0.5) return false;
      if (monto !== undefined && Math.abs(saldo - monto) > tolerancia) return false;
      return true;
    };

    const general = facturas.filter(baseOk).filter((factura) => {
      if (!query) return true;
      return (
        normalize(factura.numero_factura).includes(query) ||
        normalize(factura.cliente_nombre).includes(query)
      );
    });
    for (const factura of general) {
      if (!query) {
        agregar(factura, 'listado');
        continue;
      }
      if (normalize(factura.numero_factura).includes(query)) agregar(factura, 'numero');
      if (normalize(factura.cliente_nombre).includes(query)) agregar(factura, 'cliente');
    }

    const escanearItems = (scope: { meses: number; incluirEntregadas: boolean }) => {
      const desde = scope.meses > 0 ? isoMesesAtras(scope.meses) : '';
      const hasta = isoHoy();
      return facturas.filter((factura) => {
        if (!baseOk(factura)) return false;
        const kanban = (factura.estado_kanban || '').toUpperCase();
        if (kanban === 'NO_CONFIRMADO' || kanban === 'ARCHIVADO') return false;
        if (!scope.incluirEntregadas && (factura.estado_entrega ?? 'PENDIENTE') === 'ENTREGADO') return false;
        if (!(factura.items ?? []).some((item) => itemMatches(item.descripcion, query))) return false;
        if (desde) {
          const fecha = fechaOrden(factura);
          if (!fecha || fecha < desde || fecha > hasta) return false;
        }
        return true;
      });
    };

    let fueraDeVentana = false;
    if (query) {
      const usandoDefaults = meses > 0 && !incluirEntregadas;
      let conItems = escanearItems({ meses, incluirEntregadas });
      if (conItems.length === 0 && usandoDefaults) {
        conItems = escanearItems({ meses: 0, incluirEntregadas: true });
        fueraDeVentana = conItems.length > 0;
      }
      for (const factura of conItems) {
        const entrada = agregar(factura, 'item');
        entrada.items = (factura.items ?? [])
          .filter((item) => itemMatches(item.descripcion, query))
          .map((item) => ({
            descripcion: item.descripcion,
            cantidad: Number(item.cantidad) || 1,
            precio_unitario: Number(item.precio_unitario) || 0,
          }));
      }
    }

    const coincidencias = [...porFactura.values()].sort(
      (a, b) =>
        fechaOrden(b.factura).localeCompare(fechaOrden(a.factura)) || b.factura.id - a.factura.id,
    );

    const clientesMap = new Map<string, { cliente: string; facturas: number; saldo: number }>();
    for (const entrada of coincidencias) {
      const nombre = entrada.factura.cliente_nombre || 'Sin cliente';
      const actual = clientesMap.get(nombre) ?? { cliente: nombre, facturas: 0, saldo: 0 };
      actual.facturas += 1;
      actual.saldo = Math.round((actual.saldo + Math.max(0, entrada.saldo)) * 100) / 100;
      clientesMap.set(nombre, actual);
    }
    const clientes = [...clientesMap.values()]
      .sort((a, b) => b.facturas - a.facturas || a.cliente.localeCompare(b.cliente))
      .slice(0, 50);

    const notas: string[] = [];
    if (fueraDeVentana) {
      notas.push(
        `No hay coincidencias pendientes en los últimos ${meses} meses; se muestra el historial completo (incluye entregadas).`,
      );
    }
    if (coincidencias.length > limite) {
      notas.push(`Hay ${coincidencias.length - limite} facturas más; subí limite o acotá la búsqueda.`);
    }

    return {
      texto,
      ventana: { desde: meses > 0 ? isoMesesAtras(meses) : null, hasta: isoHoy(), meses },
      filtros: { solo_pendientes: !incluirEntregadas, excluye_no_confirmado: true },
      fuera_de_ventana: fueraDeVentana,
      ...(notas.length ? { nota: notas.join(' ') } : {}),
      total: coincidencias.length,
      total_facturas: coincidencias.length,
      total_clientes: clientesMap.size,
      mostradas: Math.min(coincidencias.length, limite),
      truncado: coincidencias.length > limite,
      clientes,
      facturas: coincidencias.slice(0, limite).map((entrada) => {
        const factura = entrada.factura;
        const entrega = parseFechasEntrega(factura.fecha_entrega);
        return {
          id: factura.id,
          numero: factura.numero_factura,
          cliente: factura.cliente_nombre,
          cliente_id: factura.cliente_id,
          fecha: factura.fecha,
          total: Number(factura.total) || 0,
          pagado: Math.round(((Number(factura.total) || 0) - entrada.saldo) * 100) / 100,
          saldo: entrada.saldo,
          estado: factura.estado_kanban,
          estado_kanban: factura.estado_kanban,
          estado_entrega: factura.estado_entrega ?? 'PENDIENTE',
          ...(entrega.desde ? { fecha_entrega: entrega.desde } : {}),
          coincide_en: [...entrada.motivos],
          ...(entrada.items.length ? { items: entrada.items } : {}),
        };
      }),
    };
  },
};

const resumenGastos: ToolDef = {
  name: 'resumen_gastos',
  description:
    'Resumen de gastos por categoría o por tipo en un rango de fechas. Sin fechas usa todo el historial, así que si el usuario dice "este mes" calculá desde/hasta.',
  effect: 'read',
  parameters: {
    type: 'object',
    properties: {
      desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD (inclusive).' },
      hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD (inclusive).' },
      agrupar_por: { type: 'string', enum: ['categoria', 'tipo'], description: 'Default categoria.' },
    },
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const group = optionalText(obj, 'agrupar_por', 20);
    if (group && group !== 'categoria' && group !== 'tipo') {
      throw new ToolInputError('"agrupar_por" debe ser "categoria" o "tipo".');
    }
    return {
      desde: optionalDate(obj, 'desde'),
      hasta: optionalDate(obj, 'hasta'),
      agrupar_por: group ?? 'categoria',
    };
  },
  async run(args) {
    const group = args.agrupar_por === 'tipo' ? 'type' : 'category';
    const res = await api.getExpensesSummary(args.desde as string | undefined, args.hasta as string | undefined, group);
    const grupos = Object.entries(res.groups ?? {})
      .map(([nombre, monto]) => ({ nombre, monto: Number(monto) || 0 }))
      .sort((a, b) => b.monto - a.monto);
    return {
      desde: args.desde ?? null,
      hasta: args.hasta ?? null,
      agrupado_por: group === 'type' ? 'tipo' : 'categoria',
      total: res.total ?? 0,
      grupos,
    };
  },
};

/* ------------------------------------------------------------------ */
/* Escrituras (propuestas: no ejecutan hasta confirmar)                */
/* ------------------------------------------------------------------ */

const crearTarea: ToolDef = {
  name: 'crear_tarea',
  description: 'Crea una tarea nueva en el panel. Se ejecuta directo (sin confirmación). Si el usuario pide varias tareas, llamala una vez por cada una.',
  effect: 'write',
  parameters: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Texto de la tarea, claro y accionable.' },
      fijada: { type: 'boolean', description: 'Fijar arriba del panel (máximo 3 fijadas).' },
    },
    required: ['texto'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    return { texto: requiredText(obj, 'texto', 500), fijada: optionalBool(obj, 'fijada') ?? false };
  },
  async prepare(args) {
    const texto = args.texto as string;
    const fijada = args.fijada === true;
    if (fijada) {
      const tasks = await loadTasks();
      if (tasks.filter((t) => t.pinned).length >= MAX_PINNED) {
        throw new ToolInputError(`Ya hay ${MAX_PINNED} tareas fijadas. Desfijá una primero o creá la tarea sin fijar.`);
      }
    }
    return { args, summary: `Crear tarea${fijada ? ' (fijada)' : ''}: “${texto}”` };
  },
  async run(args) {
    return api.createTask({
      text: args.texto as string,
      assigned_by: appStore.user?.user_name || undefined,
      pinned: args.fijada === true,
    });
  },
  success(args) {
    return `Listo, creé la tarea${args.fijada ? ' fijada' : ''}: “${args.texto}”.`;
  },
};

const editarTarea: ToolDef = {
  name: 'editar_tarea',
  description: 'Cambia el texto de una tarea existente. Se ejecuta directo. Necesitás el id real de una lectura previa.',
  effect: 'write',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'integer', description: 'Id de la tarea.' },
      texto: { type: 'string', description: 'Nuevo texto completo de la tarea.' },
    },
    required: ['id', 'texto'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    return { id: requiredInt(obj, 'id'), texto: requiredText(obj, 'texto', 500) };
  },
  async prepare(args) {
    const task = await findTask(args.id as number);
    return {
      args,
      summary: `Editar tarea #${task.id}\nAntes: “${task.text}”\nAhora: “${args.texto}”`,
    };
  },
  async run(args) {
    return api.updateTask(args.id as number, { text: args.texto as string });
  },
  success() {
    return 'Tarea actualizada.';
  },
};

const marcarTarea: ToolDef = {
  name: 'marcar_tarea',
  description: 'Marca una tarea como hecha o la reabre. Se ejecuta directo.',
  effect: 'write',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'integer', description: 'Id de la tarea.' },
      hecha: { type: 'boolean', description: 'true para completar, false para reabrir.' },
    },
    required: ['id', 'hecha'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const hecha = optionalBool(obj, 'hecha');
    if (hecha === undefined) throw new ToolInputError('Falta "hecha" (true o false).');
    return { id: requiredInt(obj, 'id'), hecha };
  },
  async prepare(args) {
    const task = await findTask(args.id as number);
    const accion = args.hecha ? 'Marcar como hecha' : 'Reabrir';
    return { args, summary: `${accion}: “${task.text}”` };
  },
  async run(args) {
    return api.updateTask(args.id as number, { done: args.hecha as boolean });
  },
  success(args) {
    return args.hecha ? 'Tarea marcada como hecha.' : 'Tarea reabierta.';
  },
};

const fijarTarea: ToolDef = {
  name: 'fijar_tarea',
  description: `Fija o desfija una tarea del panel. Se ejecuta directo. Como máximo hay ${MAX_PINNED} fijadas.`,
  effect: 'write',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'integer', description: 'Id de la tarea.' },
      fijada: { type: 'boolean', description: 'true para fijar, false para desfijar.' },
    },
    required: ['id', 'fijada'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const fijada = optionalBool(obj, 'fijada');
    if (fijada === undefined) throw new ToolInputError('Falta "fijada" (true o false).');
    return { id: requiredInt(obj, 'id'), fijada };
  },
  async prepare(args) {
    const tasks = await loadTasks();
    const task = tasks.find((t) => t.id === args.id) as TaskRow | undefined;
    if (!task) throw new ToolInputError(`No existe una tarea con id ${args.id}. Buscala primero con listar_tareas.`);
    if (args.fijada === true && !task.pinned && tasks.filter((t) => t.pinned).length >= MAX_PINNED) {
      throw new ToolInputError(`Ya hay ${MAX_PINNED} tareas fijadas. Desfijá otra primero.`);
    }
    return {
      args,
      summary: `${args.fijada ? 'Fijar' : 'Desfijar'}: “${task.text}”`,
    };
  },
  async run(args) {
    return api.updateTask(args.id as number, { pinned: args.fijada as boolean });
  },
  success(args) {
    return args.fijada ? 'Tarea fijada.' : 'Tarea desfijada.';
  },
};

const eliminarTarea: ToolDef = {
  name: 'eliminar_tarea',
  description: 'Propone eliminar una tarea. Es destructivo: siempre requiere confirmación explícita.',
  effect: 'destructive',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: { id: { type: 'integer', description: 'Id de la tarea.' } },
    required: ['id'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    return { id: requiredInt(obj, 'id') };
  },
  async prepare(args) {
    const task = await findTask(args.id as number);
    return { args, summary: `Eliminar la tarea #${task.id}: “${task.text}”` };
  },
  async run(args) {
    return api.deleteTask(args.id as number);
  },
  success() {
    return 'Tarea eliminada.';
  },
};

/* ------------------------------------------------------------------ */
/* Gastos                                                              */
/* ------------------------------------------------------------------ */

const listarCategoriasGasto: ToolDef = {
  name: 'listar_categorias_gasto',
  description:
    'Lista las categorías de gasto disponibles con id y tipo. Usala antes de registrar un gasto si no estás seguro de la categoría exacta.',
  effect: 'read',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  validate(raw) {
    asObject(raw);
    return {};
  },
  async run() {
    const categorias = await loadCategorias();
    return {
      categorias: [...categorias]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ id: c.id, nombre: c.name, tipo: c.type, slug: c.slug })),
    };
  },
};

const listarGastos: ToolDef = {
  name: 'listar_gastos',
  description:
    'Lista los gastos de un período, opcionalmente filtrados por categoría, proveedor o empleado. Devuelve el detalle y la suma de lo listado. Para totales agrupados usá resumen_gastos.',
  effect: 'read',
  parameters: {
    type: 'object',
    properties: {
      desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD.' },
      hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD.' },
      categoria: { type: 'string', description: 'Nombre de la categoría.' },
      proveedor: { type: 'string', description: 'Nombre del proveedor.' },
      empleado: { type: 'string', description: 'Nombre del empleado.' },
      limite: { type: 'integer', description: 'Máximo de resultados (1-50). Default 15.' },
    },
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    return {
      desde: optionalDate(obj, 'desde'),
      hasta: optionalDate(obj, 'hasta'),
      categoria: optionalText(obj, 'categoria', 80),
      proveedor: optionalText(obj, 'proveedor', 80),
      empleado: optionalText(obj, 'empleado', 80),
      limite: Math.min(50, Math.max(1, Math.trunc(optionalNumber(obj, 'limite') ?? 15))),
    };
  },
  async run(args) {
    const gastos = await api.listExpenses({
      from_date: args.desde as string | undefined,
      to_date: args.hasta as string | undefined,
      limit: 500,
    });
    const [categorias, proveedores, empleados] = await Promise.all([
      loadCategorias(),
      loadProviders(),
      loadEmpleados(false),
    ]);
    const catMap = new Map(categorias.map((c) => [c.id, c.name]));
    const provMap = new Map(proveedores.map((p) => [p.id, p.name]));
    const empMap = new Map(empleados.map((e) => [e.id, e.name]));

    let filtrados = gastos;
    if (args.categoria) {
      const categoria = await resolveCategoria(args.categoria as string, undefined);
      filtrados = filtrados.filter((g) => g.category_id === categoria.id);
    }
    if (args.proveedor) {
      const proveedor = await resolveProveedor(args.proveedor as string, undefined);
      filtrados = filtrados.filter((g) => g.provider_id === proveedor.id);
    }
    if (args.empleado) {
      const empleado = await resolveEmpleado(args.empleado as string, undefined, false);
      filtrados = filtrados.filter((g) => g.employee_id === empleado.id);
    }

    const total = filtrados.reduce((acc, g) => acc + Number(g.amount || 0), 0);
    return {
      total: filtrados.length,
      suma: Math.round(total * 100) / 100,
      gastos: filtrados.slice(0, args.limite as number).map((g) => ({
        id: g.id,
        fecha: g.date,
        monto: g.amount,
        descripcion: g.description,
        categoria: catMap.get(g.category_id) ?? `#${g.category_id}`,
        metodo: g.payment_method,
        ...(g.provider_id ? { proveedor: provMap.get(g.provider_id) ?? `#${g.provider_id}` } : {}),
        ...(g.employee_id ? { empleado: empMap.get(g.employee_id) ?? `#${g.employee_id}` } : {}),
      })),
    };
  },
};

const registrarGasto: ToolDef = {
  name: 'registrar_gasto',
  description:
    'Registra un gasto. Requiere confirmación del usuario. Si no sabés la categoría, listala primero con listar_categorias_gasto. Podés vincular un proveedor o un empleado, no ambos.',
  effect: 'write',
  parameters: {
    type: 'object',
    properties: {
      monto: { type: 'number', description: 'Monto en pesos, mayor a 0.' },
      descripcion: { type: 'string', description: 'Descripción breve del gasto.' },
      categoria: { type: 'string', description: 'Nombre de la categoría (ej. Combustible).' },
      categoria_id: { type: 'integer', description: 'Id de la categoría si ya lo tenés.' },
      fecha: { type: 'string', description: 'YYYY-MM-DD. Default hoy.' },
      metodo: {
        type: 'string',
        enum: PAYMENT_METHODS,
        description: 'Método de pago. Default efectivo.',
      },
      proveedor: { type: 'string', description: 'Nombre del proveedor (opcional).' },
      empleado: { type: 'string', description: 'Nombre del empleado (opcional).' },
      referencia: { type: 'string', description: 'Número de comprobante o nota (opcional).' },
    },
    required: ['monto', 'descripcion'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const monto = optionalNumber(obj, 'monto');
    if (monto === undefined || monto <= 0) throw new ToolInputError('"monto" debe ser mayor a 0.');
    const categoriaId = optionalNumber(obj, 'categoria_id');
    return {
      monto,
      descripcion: requiredText(obj, 'descripcion', 300),
      categoria: optionalText(obj, 'categoria', 80),
      categoria_id: categoriaId !== undefined ? requiredInt(obj, 'categoria_id') : undefined,
      fecha: optionalDate(obj, 'fecha'),
      metodo: parseMetodoPago(optionalText(obj, 'metodo', 30)),
      proveedor: optionalText(obj, 'proveedor', 80),
      empleado: optionalText(obj, 'empleado', 80),
      referencia: optionalText(obj, 'referencia', 120),
    };
  },
  async prepare(args) {
    const monto = args.monto as number;
    const categoria = await resolveCategoria(
      args.categoria as string | undefined,
      args.categoria_id as number | undefined,
    );
    const proveedor = args.proveedor ? await resolveProveedor(args.proveedor as string, undefined) : undefined;
    const empleado = args.empleado ? await resolveEmpleado(args.empleado as string, undefined, false) : undefined;
    if (proveedor && empleado) {
      throw new ToolInputError('Un gasto no puede estar vinculado a un proveedor y a un empleado a la vez.');
    }
    const fecha = (args.fecha as string | undefined) ?? todayIso();
    const metodo = (args.metodo as string | undefined) ?? 'efectivo';
    const lineas = [
      `Registrar gasto: ${money(monto)} en «${categoria.name}» — “${args.descripcion}”`,
      `${shortDate(fecha)} · ${metodo}`,
    ];
    if (proveedor) lineas.push(`Proveedor: ${proveedor.name}`);
    if (empleado) lineas.push(`Empleado: ${empleado.name}`);
    return {
      args: {
        monto,
        descripcion: args.descripcion,
        categoria_id: categoria.id,
        categoria: categoria.name,
        fecha,
        metodo,
        proveedor_id: proveedor?.id,
        proveedor: proveedor?.name,
        empleado_id: empleado?.id,
        empleado: empleado?.name,
        referencia: args.referencia,
      },
      summary: lineas.join('\n'),
    };
  },
  async run(args) {
    const created = await api.createExpense({
      date: args.fecha as string,
      amount: args.monto as number,
      description: args.descripcion as string,
      category_id: args.categoria_id as number,
      provider_id: (args.proveedor_id as number | undefined) ?? null,
      employee_id: (args.empleado_id as number | undefined) ?? null,
      payment_method: args.metodo as string,
      reference: (args.referencia as string | undefined) ?? '',
      source: 'assistant',
      created_by_user_id: appStore.user?.user_id ?? null,
      created_by_contact_id: null,
      status: 'confirmed',
      raw_input: null,
      media_url: null,
      media_id: null,
    });
    cacheStore.invalidate('providers');
    cacheStore.invalidate('provider:moves');
    cacheStore.invalidate('employees');
    cacheStore.invalidate('employees:active');
    cacheStore.invalidate('employee:payments');
    return created;
  },
  success(args) {
    const extra = args.categoria ? ` en «${args.categoria}»` : '';
    return `Listo, registré el gasto de ${money(args.monto as number)} (“${args.descripcion}”)${extra}.`;
  },
  undo(args, result) {
    const id = (result as { id?: unknown } | null | undefined)?.id;
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return undefined;
    const monto = Number(args.monto) || 0;
    const descripcion = String(args.descripcion ?? '');
    const corta = descripcion.length > 28 ? `${descripcion.slice(0, 27)}…` : descripcion;
    return {
      kind: 'gasto',
      id,
      label: `gasto de ${money(monto)}${corta ? ` · ${corta}` : ''}`,
      message: `el gasto de ${money(monto)}${corta ? ` («${corta}»)` : ''}`,
    };
  },
};

/* ------------------------------------------------------------------ */
/* Asistencia                                                          */
/* ------------------------------------------------------------------ */

const listarEmpleados: ToolDef = {
  name: 'listar_empleados',
  description:
    'Lista los empleados con id, nombre, horario y estado. Usala para resolver el empleado antes de registrar asistencia o un gasto vinculado a un sueldo.',
  effect: 'read',
  parameters: {
    type: 'object',
    properties: {
      incluir_inactivos: { type: 'boolean', description: 'Incluir empleados inactivos. Default false.' },
    },
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    return { incluir_inactivos: optionalBool(obj, 'incluir_inactivos') ?? false };
  },
  async run(args) {
    const empleados = await loadEmpleados(args.incluir_inactivos !== true);
    return {
      total: empleados.length,
      empleados: empleados.map((e) => ({
        id: e.id,
        nombre: e.name,
        activo: e.active,
        horario_entrada: e.entry_time || undefined,
        horario_salida: e.exit_time || undefined,
        umbral_tarde: e.late_threshold ?? undefined,
        es_dueno: e.is_owner === 1,
      })),
    };
  },
};

const consultarAsistencia: ToolDef = {
  name: 'consultar_asistencia',
  description:
    'Consulta asistencias por mes (por defecto el actual), opcionalmente de un empleado y/o un día exacto. Devuelve estado, hora de entrada y salida.',
  effect: 'read',
  parameters: {
    type: 'object',
    properties: {
      empleado: { type: 'string', description: 'Nombre o parte del nombre.' },
      empleado_id: { type: 'integer', description: 'Id del empleado si ya lo tenés.' },
      mes: { type: 'string', description: 'Mes YYYY-MM. Default el actual.' },
      fecha: { type: 'string', description: 'Día exacto YYYY-MM-DD (opcional).' },
    },
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const mes = optionalText(obj, 'mes', 7);
    if (mes && !isValidMonth(mes)) throw new ToolInputError('"mes" debe tener formato YYYY-MM.');
    const empleadoId = optionalNumber(obj, 'empleado_id');
    return {
      empleado: optionalText(obj, 'empleado', 80),
      empleado_id: empleadoId !== undefined ? requiredInt(obj, 'empleado_id') : undefined,
      mes,
      fecha: optionalDate(obj, 'fecha'),
    };
  },
  async run(args) {
    const empleado =
      args.empleado || args.empleado_id !== undefined
        ? await resolveEmpleado(
            args.empleado as string | undefined,
            args.empleado_id as number | undefined,
            false,
          )
        : undefined;
    const fecha = args.fecha as string | undefined;
    const mes = (args.mes as string | undefined) ?? (fecha ? fecha.slice(0, 7) : currentMonth());
    const rows = (await api.listAttendance(empleado?.id, mes)) as AttendanceRow[];
    const filtradas = fecha ? rows.filter((r) => r.date === fecha) : rows;
    const empleados = await loadEmpleados(false);
    const nameMap = new Map(empleados.map((e) => [e.id, e.name]));

    const registros = filtradas.map((r) => {
      const info = attendanceInfo(r.status);
      return {
        empleado: nameMap.get(r.employee_id) ?? `#${r.employee_id}`,
        empleado_id: r.employee_id,
        fecha: r.date,
        tipo: info.tipo,
        hora_entrada: info.hora_entrada,
        salida: r.exit_time || undefined,
        ...(info.nota ? { nota: info.nota } : {}),
      };
    });

    const resumen = registros.reduce<Record<string, number>>((acc, r) => {
      acc[r.tipo] = (acc[r.tipo] ?? 0) + 1;
      return acc;
    }, {});

    let sinRegistro: string[] = [];
    if (fecha && !empleado) {
      const activos = await loadEmpleados(true);
      const conRegistro = new Set(filtradas.map((r) => r.employee_id));
      sinRegistro = activos.filter((e) => !conRegistro.has(e.id)).map((e) => e.name);
    }

    return {
      mes,
      ...(fecha ? { fecha } : {}),
      ...(empleado ? { empleado: empleado.name } : {}),
      resumen: {
        total: registros.length,
        presentes: resumen.presente ?? 0,
        tarde: resumen.tarde ?? 0,
        ausentes: resumen.ausente ?? 0,
        vacaciones: resumen.vacaciones ?? 0,
        licencias: resumen.licencia ?? 0,
        notas: resumen.nota ?? 0,
      },
      ...(sinRegistro.length > 0 ? { sin_registro: sinRegistro } : {}),
      registros: registros.slice(0, 200),
    };
  },
};

const registrarAsistencia: ToolDef = {
  name: 'registrar_asistencia',
  description:
    'Registra o corrige la asistencia de un empleado para un día (upsert). Se ejecuta directo. Si vino a las 8 pasá hora_entrada; si faltó, estado ausente.',
  effect: 'write',
  parameters: {
    type: 'object',
    properties: {
      empleado: { type: 'string', description: 'Nombre o parte del nombre.' },
      empleado_id: { type: 'integer', description: 'Id del empleado si ya lo tenés.' },
      fecha: { type: 'string', description: 'YYYY-MM-DD. Default hoy.' },
      estado: {
        type: 'string',
        enum: ['presente', 'ausente', 'vacaciones', 'licencia', 'tarde'],
        description: 'Default presente.',
      },
      hora_entrada: { type: 'string', description: 'HH:MM (opcional).' },
      hora_salida: { type: 'string', description: 'HH:MM (opcional).' },
    },
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const empleadoId = optionalNumber(obj, 'empleado_id');
    const entrada = optionalText(obj, 'hora_entrada', 5);
    const salida = optionalText(obj, 'hora_salida', 5);
    return {
      empleado: optionalText(obj, 'empleado', 80),
      empleado_id: empleadoId !== undefined ? requiredInt(obj, 'empleado_id') : undefined,
      fecha: optionalDate(obj, 'fecha'),
      estado: parseEstadoAsistencia(optionalText(obj, 'estado', 30)),
      hora_entrada: entrada ? normalizeTime(entrada) : undefined,
      hora_salida: salida ? normalizeTime(salida) : undefined,
    };
  },
  async prepare(args) {
    const empleado = await resolveEmpleado(
      args.empleado as string | undefined,
      args.empleado_id as number | undefined,
      true,
    );
    const fecha = (args.fecha as string | undefined) ?? todayIso();
    const estado = (args.estado as EstadoAsistencia | undefined) ?? 'presente';
    let status: string;
    let salida = args.hora_salida as string | undefined;

    if (estado === 'ausente') {
      status = 'AUS';
      salida = undefined;
    } else if (estado === 'vacaciones') {
      status = 'VACACIONES';
      salida = undefined;
    } else if (estado === 'licencia') {
      status = 'LICENCIA';
      salida = undefined;
    } else {
      const entrada =
        (args.hora_entrada as string | undefined) ||
        (fecha === todayIso() ? nowTime() : empleado.entry_time || nowTime());
      const time = normalizeTime(entrada);
      status = estado === 'tarde' ? `TARDE-${time}` : classifyArrival(empleado, time);
    }

    const detalle = [`Registrar asistencia: ${empleado.name}`, shortDate(fecha), attendanceLabel(attendanceInfo(status))];
    if (salida) detalle.push(`salida ${salida}`);
    return {
      args: {
        empleado_id: empleado.id,
        empleado: empleado.name,
        fecha,
        status,
        hora_salida: salida ?? null,
      },
      summary: detalle.join(' · '),
    };
  },
  async run(args) {
    await api.saveAttendanceBulk([
      {
        employee_id: args.empleado_id as number,
        date: args.fecha as string,
        status: args.status as string,
        exit_time: (args.hora_salida as string | null) ?? '',
      },
    ]);
    cacheStore.invalidate('attendance');
    return {
      empleado_id: args.empleado_id,
      empleado: args.empleado,
      fecha: args.fecha,
      estado: args.status,
      salida: args.hora_salida,
    };
  },
  success(args) {
    const info = attendanceInfo(args.status as string);
    return `Listo, registré a ${args.empleado} como ${attendanceLabel(info)} el ${shortDate(args.fecha as string)}.`;
  },
};

/* ------------------------------------------------------------------ */
/* Proveedores y sueldos                                               */
/* ------------------------------------------------------------------ */

const listarProveedores: ToolDef = {
  name: 'listar_proveedores',
  description:
    'Lista los proveedores con su saldo (lo que se les debe) y stock. Usala para responder deudas o para elegir el proveedor antes de registrar una compra o un pago.',
  effect: 'read',
  parameters: {
    type: 'object',
    properties: {
      con_deuda: { type: 'boolean', description: 'Solo proveedores con saldo mayor a 0.' },
    },
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    return { con_deuda: optionalBool(obj, 'con_deuda') ?? false };
  },
  async run(args) {
    const proveedores = await loadProviders();
    const filtrados = args.con_deuda === true ? proveedores.filter((p) => (p.balance ?? 0) > 0) : proveedores;
    const ordenados = [...filtrados].sort(
      (a, b) => (b.balance ?? 0) - (a.balance ?? 0) || a.name.localeCompare(b.name),
    );
    return {
      total: ordenados.length,
      total_deuda:
        Math.round(ordenados.reduce((acc, p) => acc + Math.max(0, p.balance ?? 0), 0) * 100) / 100,
      proveedores: ordenados.map((p) => ({
        id: p.id,
        nombre: p.name,
        saldo: Math.round((p.balance ?? 0) * 100) / 100,
        stock: p.stock_qty ?? undefined,
      })),
    };
  },
};

const consultarProveedor: ToolDef = {
  name: 'consultar_proveedor',
  description:
    'Devuelve el saldo, el stock y los últimos movimientos de un proveedor (compras, pagos y stock). Usala para saber cuánto se le debe o qué se le compró.',
  effect: 'read',
  parameters: {
    type: 'object',
    properties: {
      proveedor: { type: 'string', description: 'Nombre o parte del nombre.' },
      proveedor_id: { type: 'integer', description: 'Id si ya lo tenés.' },
      limite: { type: 'integer', description: 'Máximo de movimientos (1-50). Default 20.' },
    },
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const id = optionalNumber(obj, 'proveedor_id');
    return {
      proveedor: optionalText(obj, 'proveedor', 80),
      proveedor_id: id !== undefined ? requiredInt(obj, 'proveedor_id') : undefined,
      limite: Math.min(50, Math.max(1, Math.trunc(optionalNumber(obj, 'limite') ?? 20))),
    };
  },
  async run(args) {
    const prov = await resolveProveedor(
      args.proveedor as string | undefined,
      args.proveedor_id as number | undefined,
    );
    const detail = (await api.getProvider(prov.id)) as {
      provider?: ProviderRow;
      movements?: ProviderMovementRow[];
    };
    const all = detail.movements ?? [];
    const compras = all
      .filter((m) => m.type === 'PURCHASE')
      .reduce((acc, m) => acc + Number(m.amount || 0), 0);
    const pagos = all
      .filter((m) => m.type === 'PAYMENT')
      .reduce((acc, m) => acc + Number(m.amount || 0), 0);
    const limite = args.limite as number;

    return {
      proveedor: {
        id: prov.id,
        nombre: detail.provider?.name ?? prov.name,
        saldo:
          Math.round(
            Number(detail.provider?.balance ?? prov.balance ?? compras - pagos) * 100,
          ) / 100,
        stock: detail.provider?.stock_qty ?? prov.stock_qty ?? undefined,
      },
      totales: {
        compras: Math.round(compras * 100) / 100,
        pagos: Math.round(pagos * 100) / 100,
        saldo_por_movimientos: Math.round((compras - pagos) * 100) / 100,
      },
      movimientos: all.slice(0, limite).map((m) => ({
        id: m.id,
        fecha: m.date,
        tipo: movementTypeLabel(m.type),
        descripcion: m.description,
        monto: m.amount ?? 0,
        cantidad: m.quantity ?? undefined,
        referencia: m.reference || undefined,
      })),
    };
  },
};

const listarPagosSueldos: ToolDef = {
  name: 'listar_pagos_sueldos',
  description:
    'Lista los pagos de sueldos registrados, opcionalmente de un empleado y en un rango de fechas. Devuelve el total pagado.',
  effect: 'read',
  parameters: {
    type: 'object',
    properties: {
      empleado: { type: 'string', description: 'Nombre o parte del nombre.' },
      empleado_id: { type: 'integer', description: 'Id si ya lo tenés.' },
      desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD.' },
      hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD.' },
      limite: { type: 'integer', description: 'Máximo de pagos (1-100). Default 20.' },
    },
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const id = optionalNumber(obj, 'empleado_id');
    return {
      empleado: optionalText(obj, 'empleado', 80),
      empleado_id: id !== undefined ? requiredInt(obj, 'empleado_id') : undefined,
      desde: optionalDate(obj, 'desde'),
      hasta: optionalDate(obj, 'hasta'),
      limite: Math.min(100, Math.max(1, Math.trunc(optionalNumber(obj, 'limite') ?? 20))),
    };
  },
  async run(args) {
    const empleado =
      args.empleado || args.empleado_id !== undefined
        ? await resolveEmpleado(
            args.empleado as string | undefined,
            args.empleado_id as number | undefined,
            false,
          )
        : undefined;
    const rows = (await api.listEmployeePaymentsRecent(500)) as EmployeePaymentRow[];
    const desde = args.desde as string | undefined;
    const hasta = args.hasta as string | undefined;
    const filtrados = rows.filter(
      (p) =>
        (!empleado || p.employee_id === empleado.id) &&
        (!desde || p.date >= desde) &&
        (!hasta || p.date <= hasta),
    );
    const empleados = await loadEmpleados(false);
    const nameMap = new Map(empleados.map((e) => [e.id, e.name]));
    const total = filtrados.reduce((acc, p) => acc + Number(p.amount || 0), 0);

    return {
      total: filtrados.length,
      suma: Math.round(total * 100) / 100,
      ...(empleado ? { empleado: empleado.name } : {}),
      pagos: filtrados.slice(0, args.limite as number).map((p) => ({
        id: p.id,
        empleado: nameMap.get(p.employee_id) ?? `#${p.employee_id}`,
        fecha: p.date,
        monto: p.amount,
        modalidad: p.mode || undefined,
        detalle: p.detail || undefined,
      })),
    };
  },
};

const registrarPagoSueldo: ToolDef = {
  name: 'registrar_pago_sueldo',
  description:
    'Registra un pago de sueldo a un empleado. Requiere confirmación. No lo registres como gasto general.',
  effect: 'write',
  parameters: {
    type: 'object',
    properties: {
      empleado: { type: 'string', description: 'Nombre o parte del nombre.' },
      empleado_id: { type: 'integer', description: 'Id si ya lo tenés.' },
      monto: { type: 'number', description: 'Monto, mayor a 0.' },
      fecha: { type: 'string', description: 'YYYY-MM-DD. Default hoy.' },
      modalidad: {
        type: 'string',
        description: 'Variable, Semanal, Por Hora, Asistencia. Default Variable.',
      },
      detalle: { type: 'string', description: 'Concepto o detalle (opcional).' },
    },
    required: ['monto'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const monto = optionalNumber(obj, 'monto');
    if (monto === undefined || monto <= 0) throw new ToolInputError('"monto" debe ser mayor a 0.');
    const id = optionalNumber(obj, 'empleado_id');
    return {
      empleado: optionalText(obj, 'empleado', 80),
      empleado_id: id !== undefined ? requiredInt(obj, 'empleado_id') : undefined,
      monto,
      fecha: optionalDate(obj, 'fecha'),
      modalidad: optionalText(obj, 'modalidad', 40) ?? 'Variable',
      detalle: optionalText(obj, 'detalle', 200),
    };
  },
  async prepare(args) {
    const empleado = await resolveEmpleado(
      args.empleado as string | undefined,
      args.empleado_id as number | undefined,
      true,
    );
    const fecha = (args.fecha as string | undefined) ?? todayIso();
    const modalidad = (args.modalidad as string | undefined) ?? 'Variable';
    const detalle = (args.detalle as string | undefined) ?? 'Pago';
    const lineas = [
      `Registrar pago de sueldo: ${money(args.monto as number)} a ${empleado.name}`,
      `${shortDate(fecha)} · ${modalidad}`,
    ];
    if (args.detalle) lineas.push(`“${detalle}”`);
    return {
      args: { empleado_id: empleado.id, empleado: empleado.name, monto: args.monto, fecha, modalidad, detalle },
      summary: lineas.join('\n'),
    };
  },
  async run(args) {
    const created = await api.addEmployeePayment({
      employee_id: args.empleado_id as number,
      date: args.fecha as string,
      amount: args.monto as number,
      mode: args.modalidad as string,
      detail: (args.detalle as string | undefined) ?? '',
    });
    cacheStore.invalidate('employee:payments');
    cacheStore.invalidate('employees');
    cacheStore.invalidate('employees:active');
    return created;
  },
  success(args) {
    return `Listo, registré el pago de sueldo de ${money(args.monto as number)} a ${args.empleado}.`;
  },
  undo(args, result) {
    const id = (result as { id?: unknown } | null | undefined)?.id;
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return undefined;
    const monto = Number(args.monto) || 0;
    const empleado = String(args.empleado ?? '');
    return {
      kind: 'pago_sueldo',
      id,
      label: `sueldo de ${money(monto)}${empleado ? ` · ${empleado}` : ''}`,
      message: `el pago de sueldo de ${money(monto)}${empleado ? ` a ${empleado}` : ''}`,
    };
  },
};

const registrarMovimientoProveedor: ToolDef = {
  name: 'registrar_movimiento_proveedor',
  description:
    'Registra una compra o un pago a un proveedor y actualiza su saldo. Requiere confirmación. Una compra aumenta la deuda; un pago la reduce. No lo registres como gasto general.',
  effect: 'write',
  parameters: {
    type: 'object',
    properties: {
      proveedor: { type: 'string', description: 'Nombre o parte del nombre.' },
      proveedor_id: { type: 'integer', description: 'Id si ya lo tenés.' },
      tipo: { type: 'string', enum: ['compra', 'pago'], description: 'Compra o pago.' },
      monto: { type: 'number', description: 'Monto, mayor a 0.' },
      descripcion: { type: 'string', description: 'Detalle de la compra o pago (opcional).' },
      fecha: { type: 'string', description: 'YYYY-MM-DD. Default hoy.' },
      referencia: {
        type: 'string',
        description: 'Método o comprobante: Transferencia, Efectivo, remito, etc. (opcional).',
      },
    },
    required: ['tipo', 'monto'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const monto = optionalNumber(obj, 'monto');
    if (monto === undefined || monto <= 0) throw new ToolInputError('"monto" debe ser mayor a 0.');
    const id = optionalNumber(obj, 'proveedor_id');
    return {
      proveedor: optionalText(obj, 'proveedor', 80),
      proveedor_id: id !== undefined ? requiredInt(obj, 'proveedor_id') : undefined,
      tipo: parseTipoMovimiento(optionalText(obj, 'tipo', 20)),
      monto,
      descripcion: optionalText(obj, 'descripcion', 200),
      fecha: optionalDate(obj, 'fecha'),
      referencia: optionalText(obj, 'referencia', 80),
    };
  },
  async prepare(args) {
    const proveedor = await resolveProveedor(
      args.proveedor as string | undefined,
      args.proveedor_id as number | undefined,
    );
    const tipo = args.tipo as 'PURCHASE' | 'PAYMENT';
    const fecha = (args.fecha as string | undefined) ?? todayIso();
    const descripcion =
      (args.descripcion as string | undefined) ??
      (tipo === 'PURCHASE' ? 'Compra a proveedor' : 'Pago a proveedor');
    const accion = tipo === 'PURCHASE' ? 'Registrar compra' : 'Registrar pago';
    const lineas = [
      `${accion} a ${proveedor.name}: ${money(args.monto as number)}`,
      `${shortDate(fecha)} · “${descripcion}”`,
    ];
    if (args.referencia) lineas.push(`Referencia: ${args.referencia}`);
    return {
      args: {
        proveedor_id: proveedor.id,
        proveedor: proveedor.name,
        tipo,
        monto: args.monto,
        fecha,
        descripcion,
        referencia: args.referencia,
      },
      summary: lineas.join('\n'),
    };
  },
  async run(args) {
    const created = await api.addProviderMovement({
      provider_id: args.proveedor_id as number,
      date: args.fecha as string,
      type: args.tipo as string,
      description: args.descripcion as string,
      amount: args.monto as number,
      quantity: 0,
      reference: (args.referencia as string | undefined) ?? '',
    });
    cacheStore.invalidate('providers');
    cacheStore.invalidate('provider:moves');
    return created;
  },
  success(args) {
    const texto = args.tipo === 'PURCHASE' ? 'la compra' : 'el pago';
    return `Listo, registré ${texto} a ${args.proveedor} por ${money(args.monto as number)}.`;
  },
  undo(args, result) {
    const id = (result as { id?: unknown } | null | undefined)?.id;
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return undefined;
    const monto = Number(args.monto) || 0;
    const proveedor = String(args.proveedor ?? '');
    const esCompra = args.tipo === 'PURCHASE';
    const accion = esCompra ? 'compra' : 'pago';
    return {
      kind: 'movimiento_proveedor',
      id,
      label: `${accion} a ${proveedor || 'proveedor'} · ${money(monto)}`,
      message: `${esCompra ? 'la' : 'el'} ${accion} a ${proveedor || 'el proveedor'} por ${money(monto)}`,
    };
  },
};

/* ------------------------------------------------------------------ */
/* Entidades y cobros                                                  */
/* ------------------------------------------------------------------ */

const crearCliente: ToolDef = {
  name: 'crear_cliente',
  description:
    'Crea un cliente. Se ejecuta directo. Si ya existe uno con el mismo nombre, pedí permiso antes de duplicarlo.',
  effect: 'write',
  parameters: {
    type: 'object',
    properties: {
      nombre: { type: 'string', description: 'Nombre del cliente.' },
      domicilio: { type: 'string', description: 'Domicilio (opcional).' },
      telefono: { type: 'string', description: 'Teléfono (opcional).' },
      taller: { type: 'string', description: 'Taller asociado (opcional).' },
      estudiante: { type: 'string', description: 'Estudiante asociado (opcional).' },
      permitir_duplicado: { type: 'boolean', description: 'Crear aunque exista otro con el mismo nombre.' },
    },
    required: ['nombre'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    return {
      nombre: requiredText(obj, 'nombre', 120),
      domicilio: optionalText(obj, 'domicilio', 200),
      telefono: optionalText(obj, 'telefono', 40),
      taller: optionalText(obj, 'taller', 120),
      estudiante: optionalText(obj, 'estudiante', 120),
      permitir_duplicado: optionalBool(obj, 'permitir_duplicado') ?? false,
    };
  },
  async prepare(args) {
    if (!args.permitir_duplicado) {
      const nombre = args.nombre as string;
      const clientes = await loadClientes();
      const existing = clientes.find((c) => normalize(c.nombre) === normalize(nombre));
      if (existing) {
        throw new ToolInputError(
          `Ya existe el cliente “${existing.nombre}” (id ${existing.id}${existing.telefono ? `, tel ${existing.telefono}` : ''}). Si es otro, repetí con permitir_duplicado=true.`,
        );
      }
    }
    const partes = [`Crear cliente: “${args.nombre}”`];
    if (args.telefono) partes.push(`tel ${args.telefono}`);
    if (args.domicilio) partes.push(String(args.domicilio));
    return { args, summary: partes.join(' · ') };
  },
  async run(args) {
    const created = await api.addCliente({
      nombre: args.nombre as string,
      domicilio: (args.domicilio as string | undefined) ?? '',
      telefono: (args.telefono as string | undefined) ?? '',
      taller: args.taller as string | undefined,
      estudiante: args.estudiante as string | undefined,
    });
    cacheStore.invalidate('clientes');
    return created;
  },
  success(args, result) {
    const id = (result as { id?: number } | null)?.id;
    return `Listo, creé el cliente “${args.nombre}”${id ? ` (id ${id})` : ''}.`;
  },
};

const crearProveedor: ToolDef = {
  name: 'crear_proveedor',
  description:
    'Crea un proveedor. Se ejecuta directo. Si ya existe uno con el mismo nombre, pedí permiso antes de duplicarlo.',
  effect: 'write',
  parameters: {
    type: 'object',
    properties: {
      nombre: { type: 'string', description: 'Nombre del proveedor.' },
      cuit: { type: 'string', description: 'CUIT (opcional).' },
      alias_mp: { type: 'string', description: 'Alias de Mercado Pago (opcional).' },
      alias_cbu: { type: 'string', description: 'Alias CBU (opcional).' },
      direccion: { type: 'string', description: 'Dirección (opcional).' },
      permitir_duplicado: { type: 'boolean', description: 'Crear aunque exista otro con el mismo nombre.' },
    },
    required: ['nombre'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    return {
      nombre: requiredText(obj, 'nombre', 120),
      cuit: optionalText(obj, 'cuit', 20),
      alias_mp: optionalText(obj, 'alias_mp', 80),
      alias_cbu: optionalText(obj, 'alias_cbu', 80),
      direccion: optionalText(obj, 'direccion', 200),
      permitir_duplicado: optionalBool(obj, 'permitir_duplicado') ?? false,
    };
  },
  async prepare(args) {
    if (!args.permitir_duplicado) {
      const nombre = args.nombre as string;
      const proveedores = await loadProviders();
      const existing = proveedores.find((p) => normalize(p.name) === normalize(nombre));
      if (existing) {
        throw new ToolInputError(
          `Ya existe el proveedor “${existing.name}” (id ${existing.id}). Si es otro, repetí con permitir_duplicado=true.`,
        );
      }
    }
    return { args, summary: `Crear proveedor: “${args.nombre}”${args.cuit ? ` · CUIT ${args.cuit}` : ''}` };
  },
  async run(args) {
    const created = await api.addProvider({
      name: args.nombre as string,
      cuit: (args.cuit as string | undefined) ?? '',
      alias_mp: (args.alias_mp as string | undefined) ?? '',
      alias_cbu: (args.alias_cbu as string | undefined) ?? '',
      address: (args.direccion as string | undefined) ?? '',
    });
    cacheStore.invalidate('providers');
    return created;
  },
  success(args, result) {
    const id = (result as { id?: number } | null)?.id;
    return `Listo, creé el proveedor “${args.nombre}”${id ? ` (id ${id})` : ''}.`;
  },
};

const crearEmpleado: ToolDef = {
  name: 'crear_empleado',
  description:
    'Crea un empleado con sus datos laborales. Se ejecuta directo. Si ya existe uno con el mismo nombre, pedí permiso antes de duplicarlo.',
  effect: 'write',
  parameters: {
    type: 'object',
    properties: {
      nombre: { type: 'string', description: 'Nombre del empleado.' },
      telefono: { type: 'string', description: 'Teléfono (opcional).' },
      direccion: { type: 'string', description: 'Dirección (opcional).' },
      cuit: { type: 'string', description: 'CUIT (opcional).' },
      cbu: { type: 'string', description: 'CBU/CVU (opcional).' },
      alias: { type: 'string', description: 'Alias bancario (opcional).' },
      fecha_ingreso: { type: 'string', description: 'YYYY-MM-DD (opcional).' },
      tipo: { type: 'string', enum: ['NOMINA', 'OCASIONAL'], description: 'Default NOMINA.' },
      frecuencia: {
        type: 'string',
        enum: ['SEMANAL', 'MENSUAL', 'POR HORA'],
        description: 'Default MENSUAL.',
      },
      sueldo_base: { type: 'number', description: 'Sueldo base (opcional).' },
      bono_asistencia: { type: 'number', description: 'Bono por asistencia (opcional).' },
      dias_trabajo: { type: 'string', description: 'Días laborales, ej. "L M M J V S".' },
      hora_entrada: { type: 'string', description: 'HH:MM (opcional).' },
      hora_salida: { type: 'string', description: 'HH:MM (opcional).' },
      tolerancia: { type: 'integer', description: 'Minutos de tolerancia (0-120). Default 5.' },
      es_dueno: { type: 'boolean', description: 'Marcar como dueño. Default false.' },
      permitir_duplicado: { type: 'boolean', description: 'Crear aunque exista otro con el mismo nombre.' },
    },
    required: ['nombre'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const entrada = optionalText(obj, 'hora_entrada', 5);
    const salida = optionalText(obj, 'hora_salida', 5);
    const sueldo = optionalNumber(obj, 'sueldo_base');
    const bono = optionalNumber(obj, 'bono_asistencia');
    const tolerancia = optionalNumber(obj, 'tolerancia');
    if (sueldo !== undefined && sueldo < 0) throw new ToolInputError('"sueldo_base" no puede ser negativo.');
    if (bono !== undefined && bono < 0) throw new ToolInputError('"bono_asistencia" no puede ser negativo.');
    return {
      nombre: requiredText(obj, 'nombre', 120),
      telefono: optionalText(obj, 'telefono', 40),
      direccion: optionalText(obj, 'direccion', 200),
      cuit: optionalText(obj, 'cuit', 20),
      cbu: optionalText(obj, 'cbu', 40),
      alias: optionalText(obj, 'alias', 80),
      fecha_ingreso: optionalDate(obj, 'fecha_ingreso'),
      tipo: parseTipoEmpleado(optionalText(obj, 'tipo', 20)),
      frecuencia: parseFrecuenciaPago(optionalText(obj, 'frecuencia', 20)),
      sueldo_base: sueldo ?? 0,
      bono_asistencia: bono ?? 0,
      dias_trabajo: optionalText(obj, 'dias_trabajo', 40) ?? 'L M M J V S',
      hora_entrada: entrada ? normalizeTime(entrada) : undefined,
      hora_salida: salida ? normalizeTime(salida) : undefined,
      tolerancia:
        tolerancia !== undefined ? Math.min(120, Math.max(0, Math.trunc(tolerancia))) : 5,
      es_dueno: optionalBool(obj, 'es_dueno') ?? false,
      permitir_duplicado: optionalBool(obj, 'permitir_duplicado') ?? false,
    };
  },
  async prepare(args) {
    if (!args.permitir_duplicado) {
      const nombre = args.nombre as string;
      const empleados = await loadEmpleados(false);
      const existing = empleados.find((e) => normalize(e.name) === normalize(nombre));
      if (existing) {
        throw new ToolInputError(
          `Ya existe el empleado “${existing.name}” (id ${existing.id}). Si es otro, repetí con permitir_duplicado=true.`,
        );
      }
    }
    const partes = [
      `Crear empleado: “${args.nombre}”`,
      `${args.tipo} · ${args.frecuencia}`,
    ];
    if (Number(args.sueldo_base) > 0) partes.push(`sueldo ${money(Number(args.sueldo_base))}`);
    if (args.hora_entrada) partes.push(`entrada ${args.hora_entrada}`);
    if (args.hora_salida) partes.push(`salida ${args.hora_salida}`);
    return { args, summary: partes.join('\n') };
  },
  async run(args) {
    const created = await api.addEmployee({
      name: args.nombre as string,
      phone: (args.telefono as string | undefined) ?? '',
      address: (args.direccion as string | undefined) ?? '',
      cuit: (args.cuit as string | undefined) ?? '',
      cbu: (args.cbu as string | undefined) ?? '',
      alias: (args.alias as string | undefined) ?? '',
      hire_date: (args.fecha_ingreso as string | undefined) ?? '',
      job_type: args.tipo as string,
      payment_freq: args.frecuencia as string,
      base_salary: args.sueldo_base as number,
      attendance_bonus: args.bono_asistencia as number,
      work_days: args.dias_trabajo as string,
      entry_time: (args.hora_entrada as string | undefined) ?? '',
      exit_time: (args.hora_salida as string | undefined) ?? '',
      late_threshold: args.tolerancia as number,
      is_owner: args.es_dueno ? 1 : 0,
    });
    cacheStore.invalidate('employees');
    cacheStore.invalidate('employees:active');
    return created;
  },
  success(args, result) {
    const id = (result as { id?: number } | null)?.id;
    return `Listo, creé al empleado “${args.nombre}”${id ? ` (id ${id})` : ''}.`;
  },
};

const listarPagosFacturas: ToolDef = {
  name: 'listar_pagos_facturas',
  description:
    'Lista los pagos recibidos de facturas, filtrables por cliente, número de factura y rango de fechas. Devuelve el total cobrado y el destino si lo hubo.',
  effect: 'read',
  parameters: {
    type: 'object',
    properties: {
      cliente: { type: 'string', description: 'Nombre o parte del nombre.' },
      factura: { type: 'string', description: 'Número de factura.' },
      desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD.' },
      hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD.' },
      limite: { type: 'integer', description: 'Máximo de pagos (1-100). Default 20.' },
    },
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    return {
      cliente: optionalText(obj, 'cliente', 120),
      factura: optionalText(obj, 'factura', 40),
      desde: optionalDate(obj, 'desde'),
      hasta: optionalDate(obj, 'hasta'),
      limite: Math.min(100, Math.max(1, Math.trunc(optionalNumber(obj, 'limite') ?? 20))),
    };
  },
  async run(args) {
    const pagos = await loadPagos();
    const clienteQuery = normalize(args.cliente as string | undefined);
    const facturaQuery = normalize(args.factura as string | undefined);
    const desde = args.desde as string | undefined;
    const hasta = args.hasta as string | undefined;
    const filtrados = pagos.filter(
      (p) =>
        (!clienteQuery || normalize(p.extra_client_name).includes(clienteQuery)) &&
        (!facturaQuery || normalize(p.extra_invoice_num).includes(facturaQuery)) &&
        (!desde || p.date >= desde) &&
        (!hasta || p.date <= hasta),
    );
    const [proveedores, empleados] = await Promise.all([loadProviders(), loadEmpleados(false)]);
    const provMap = new Map(proveedores.map((p) => [p.id, p.name]));
    const empMap = new Map(empleados.map((e) => [e.id, e.name]));
    const total = filtrados.reduce((acc, p) => acc + Number(p.amount || 0), 0);

    return {
      total: filtrados.length,
      suma: Math.round(total * 100) / 100,
      pagos: filtrados.slice(0, args.limite as number).map((p) => ({
        id: p.id,
        factura: p.extra_invoice_num ?? `#${p.invoice_id}`,
        cliente: p.extra_client_name ?? undefined,
        fecha: p.date,
        monto: p.amount,
        metodo: p.method,
        destino:
          p.entity_type === 'PROVIDER'
            ? (provMap.get(Number(p.entity_id)) ?? `proveedor #${p.entity_id}`)
            : p.entity_type === 'EMPLOYEE'
              ? (empMap.get(Number(p.entity_id)) ?? `empleado #${p.entity_id}`)
              : undefined,
      })),
    };
  },
};

const analizarComprobante: ToolDef = {
  name: 'analizar_comprobante',
  description:
    'Analiza un comprobante ya leído: busca clientes por nombre/teléfono, facturas por monto exacto y combinaciones, y destinos por CUIT/CBU/alias/nombre. Si el comprobante muestra el método (transferencia/depósito/efectivo), pasalo en "metodo". No ejecuta nada. Usala siempre que llegue una imagen de comprobante.',
  effect: 'read',
  parameters: {
    type: 'object',
    properties: {
      monto: { type: 'number', description: 'Monto del comprobante.' },
      fecha: { type: 'string', description: 'Fecha YYYY-MM-DD (opcional).' },
      pagador: { type: 'string', description: 'Nombre o teléfono de quien pagó.' },
      destinatario: { type: 'string', description: 'Nombre del destinatario/beneficiario.' },
      cuit: { type: 'string', description: 'CUIT del destinatario si aparece.' },
      cbu: { type: 'string', description: 'CBU/CVU del destinatario si aparece.' },
      alias: { type: 'string', description: 'Alias del destinatario si aparece.' },
      metodo: {
        type: 'string',
        enum: ['Efectivo', 'Transferencia'],
        description: 'Método visible en el comprobante (transferencia/depósito ⇒ Transferencia).',
      },
      tipo: {
        type: 'string',
        enum: ['cobro', 'gasto', 'compra', 'sueldo'],
        description: 'Qué representa el comprobante. Default cobro.',
      },
    },
    required: ['monto'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const monto = optionalNumber(obj, 'monto');
    if (monto === undefined || monto <= 0) throw new ToolInputError('"monto" debe ser mayor a 0.');
    const tipo = optionalText(obj, 'tipo', 20) ?? 'cobro';
    if (!['cobro', 'gasto', 'compra', 'sueldo'].includes(tipo)) {
      throw new ToolInputError('"tipo" debe ser cobro, gasto, compra o sueldo.');
    }
    const metodoRaw = optionalText(obj, 'metodo', 20);
    return {
      monto,
      fecha: optionalDate(obj, 'fecha'),
      pagador: optionalText(obj, 'pagador', 120),
      destinatario: optionalText(obj, 'destinatario', 120),
      cuit: optionalText(obj, 'cuit', 20),
      cbu: optionalText(obj, 'cbu', 40),
      alias: optionalText(obj, 'alias', 80),
      metodo: metodoRaw ? parseMetodoCobro(metodoRaw) : undefined,
      tipo,
    };
  },
  async run(args) {
    const monto = args.monto as number;
    const pagador = args.pagador as string | undefined;
    const destinatario = args.destinatario as string | undefined;
    const cuit = args.cuit as string | undefined;
    const cbu = args.cbu as string | undefined;
    const alias = args.alias as string | undefined;
    const metodo = args.metodo as 'Efectivo' | 'Transferencia' | undefined;
    const tipo = args.tipo as string;
    const esCobro = tipo === 'cobro';

    if (esCobro) {
      cacheStore.invalidate('pagos');
      cacheStore.invalidate('facturas');
    }

    const [clientesAll, facturas, pagosList, proveedores, empleados] = await Promise.all([
      loadClientes(),
      esCobro ? loadFacturas() : Promise.resolve([] as FacturaRow[]),
      esCobro ? loadPagos() : Promise.resolve([] as PagoFullRow[]),
      loadProviders(),
      loadEmpleados(true),
    ]);
    const pagosMap = new Map<number, number>();
    for (const pago of pagosList) {
      pagosMap.set(pago.invoice_id, (pagosMap.get(pago.invoice_id) ?? 0) + Number(pago.amount || 0));
    }

    const pendientes: PendingInvoice[] = esCobro
      ? facturas
          .map((factura) => ({ factura, saldo: saldoOf(factura, pagosMap) }))
          .filter((item) => item.saldo > 0.01)
      : [];

    const clientes = esCobro && pagador ? matchClients(pagador, clientesAll).slice(0, 5) : [];
    const clienteAmbiguoNombre = clientes.length > 1 && clientes[0].score === clientes[1].score;
    const clientePorNombre = clientes.length > 0 && !clienteAmbiguoNombre ? clientes[0] : null;

    // El monto exacto identifica la factura y, con ella, al cliente. Solo se usa
    // cuando el nombre no resolvió un cliente único: el nombre único tiene prioridad.
    const combosGlobales = esCobro ? findExactCombinations(pendientes, monto) : [];
    const comboGlobal = combosGlobales.length === 1 ? combosGlobales[0] : null;
    const comboGlobalMismoCliente =
      comboGlobal !== null &&
      new Set(comboGlobal.map((item) => item.factura.cliente_id)).size === 1;
    const clientePorFactura =
      !clientePorNombre && comboGlobal !== null && comboGlobalMismoCliente
        ? (clientesAll.find((cliente) => cliente.id === comboGlobal[0].factura.cliente_id) ?? null)
        : null;

    const clienteResuelto = clientePorNombre
      ? clientePorNombre
      : clientePorFactura
        ? { cliente: clientePorFactura, coincidencia: 'monto', score: 0 }
        : null;
    const resueltoPor: 'nombre' | 'factura_exacta' | null = clientePorNombre
      ? 'nombre'
      : clientePorFactura
        ? 'factura_exacta'
        : null;

    const facturaCliente = new Map(facturas.map((factura) => [factura.id, factura.cliente_id]));
    const pagosExistentes = esCobro
      ? pagosList
          .filter((pago) => {
            if (Math.abs(Number(pago.amount) - monto) > 0.01) return false;
            if (args.fecha && pago.date !== args.fecha) return false;
            if (clienteResuelto && facturaCliente.get(pago.invoice_id) !== clienteResuelto.cliente.id) {
              return false;
            }
            return true;
          })
          .slice(0, 5)
      : [];

    const pool = clienteResuelto
      ? pendientes.filter((item) => item.factura.cliente_id === clienteResuelto.cliente.id)
      : pendientes;

    const combinaciones = findExactCombinations(pool, monto);
    const facturasExactas = pool.filter((item) => Math.abs(item.saldo - monto) <= 0.01);
    // Varias combinaciones exactas o una que mezcla clientes: hay que preguntar.
    const combinacionMixta = combinaciones.some(
      (combo) => new Set(combo.map((item) => item.factura.cliente_id)).size > 1,
    );
    const montoAmbiguo = combinaciones.length > 1 || combinacionMixta;
    const clienteAmbiguo = clienteAmbiguoNombre && !clientePorFactura;
    const facturasCliente = clienteResuelto
      ? pendientes
          .filter((item) => item.factura.cliente_id === clienteResuelto.cliente.id)
          .sort((a, b) => b.saldo - a.saldo)
          .slice(0, 20)
      : [];
    const facturasCercanas = !clienteResuelto
      ? [...pendientes]
          .sort((a, b) => Math.abs(a.saldo - monto) - Math.abs(b.saldo - monto))
          .slice(0, 10)
      : [];

    const destinos = matchDestinations(proveedores, empleados, { nombre: destinatario, cuit, cbu, alias });
    const destinoProbable =
      destinos.length > 0 && (destinos.length === 1 || destinos[0].score > destinos[1].score)
        ? destinos[0]
        : null;
    const destinoAmbiguo = destinos.length > 1 && destinos[0].score === destinos[1].score;
    const metodoSugerido: 'Efectivo' | 'Transferencia' | null =
      metodo ?? (destinoProbable ? 'Transferencia' : null);

    let requiereAclaracion:
      | 'cliente_ambiguo'
      | 'monto_ambiguo'
      | 'pago_parcial'
      | 'sin_coincidencia'
      | null = null;
    if (tipo === 'cobro') {
      if (montoAmbiguo) requiereAclaracion = 'monto_ambiguo';
      else if (combinaciones.length > 0) requiereAclaracion = null;
      else if (clienteAmbiguo) requiereAclaracion = 'cliente_ambiguo';
      else if (clienteResuelto && facturasCliente.some((item) => item.saldo > monto + 0.01)) {
        requiereAclaracion = 'pago_parcial';
      } else {
        requiereAclaracion = 'sin_coincidencia';
      }
    }

    const fmtInvoice = (item: PendingInvoice) => ({
      id: item.factura.id,
      numero: item.factura.numero_factura,
      cliente: item.factura.cliente_nombre,
      cliente_id: item.factura.cliente_id,
      saldo: Math.round(item.saldo * 100) / 100,
      total: item.factura.total,
    });

    const sugerencias: string[] = [];
    if (pagosExistentes.length > 0) {
      const pago = pagosExistentes[0];
      sugerencias.push(
        `Ya existe un pago de ${money(monto)} el ${shortDate(pago.date)} para ${pago.extra_invoice_num ?? 'una factura'} (${pago.extra_client_name ?? 'cliente'}). No lo registres de nuevo.`,
      );
    }
    if (esCobro && clienteAmbiguo) {
      sugerencias.push(
        `Hay varios clientes que coinciden con “${pagador}”: ${clientes.map((c) => c.cliente.nombre).join(', ')}.`,
      );
    } else if (esCobro && resueltoPor === 'factura_exacta' && clienteResuelto) {
      sugerencias.push(
        `Cliente resuelto por el monto exacto: ${clienteResuelto.cliente.nombre}.` +
          (clienteAmbiguoNombre
            ? ` Los nombres coincidentes (${clientes.map((c) => c.cliente.nombre).join(', ')}) no definen el pago.`
            : ''),
      );
    } else if (esCobro && clienteResuelto) {
      sugerencias.push(`Cliente: ${clienteResuelto.cliente.nombre} (${clienteResuelto.coincidencia}).`);
    } else if (esCobro && pagador) {
      sugerencias.push(`No encontré un cliente para “${pagador}”.`);
    }

    if (esCobro && montoAmbiguo) {
      const textos = combinaciones.map((combo) =>
        combo
          .map((item) => `${item.factura.numero_factura} (${item.factura.cliente_nombre}, ${money(item.saldo)})`)
          .join(' + '),
      );
      sugerencias.push(
        `Hay varias coincidencias exactas por ${money(monto)}: ${textos.join(' | ')}. Preguntá cuál antes de registrar.`,
      );
    } else if (esCobro && combinaciones.length > 0) {
      const textos = combinaciones.map((combo) =>
        combo
          .map((item) => `${item.factura.numero_factura} (${item.factura.cliente_nombre}, ${money(item.saldo)})`)
          .join(' + '),
      );
      sugerencias.push(`Coincidencia exacta por ${money(monto)}: ${textos.join(' | ')}.`);
      if (resueltoPor === 'factura_exacta') {
        sugerencias.push('Registrá el pago contra ese cliente sin preguntar: el monto identifica la factura.');
      }
    } else if (esCobro && facturasCliente.length > 0) {
      sugerencias.push(
        `No hay coincidencia exacta. Facturas pendientes: ${facturasCliente
          .slice(0, 8)
          .map((item) => `${item.factura.numero_factura} ${money(item.saldo)}`)
          .join(', ')}.`,
      );
    } else if (esCobro && facturasCercanas.length > 0) {
      sugerencias.push(
        `No hay coincidencia exacta. Facturas con saldo más cercano: ${facturasCercanas
          .slice(0, 5)
          .map((item) => `${item.factura.numero_factura} ${item.factura.cliente_nombre} ${money(item.saldo)}`)
          .join(', ')}.`,
      );
    }

    if (destinoProbable) {
      sugerencias.push(
        `Destino probable: ${destinoProbable.tipo} ${destinoProbable.nombre} (${destinoProbable.coincidencia}).`,
      );
    } else if (destinoAmbiguo) {
      sugerencias.push(`Destino ambiguo: ${destinos.map((d) => `${d.tipo} ${d.nombre}`).join(', ')}.`);
    } else if (destinatario) {
      sugerencias.push('No identifiqué el destino de fondos.');
    }

    if (metodoSugerido) {
      sugerencias.push(`Método sugerido: ${metodoSugerido}.`);
    }

    return {
      monto,
      fecha: args.fecha ?? null,
      tipo,
      nota: 'La imagen ya fue analizada en este turno. No pidas que la reenvíen; usá estos datos.',
      clientes: clientes.map(({ cliente, coincidencia, score }) => ({
        id: cliente.id,
        nombre: cliente.nombre,
        telefono: cliente.telefono || undefined,
        coincidencia,
        score,
      })),
      cliente_resuelto: clienteResuelto
        ? { id: clienteResuelto.cliente.id, nombre: clienteResuelto.cliente.nombre }
        : null,
      resuelto_por: resueltoPor,
      cliente_ambiguo: clienteAmbiguo,
      metodo_sugerido: metodoSugerido,
      posible_duplicado: pagosExistentes.length > 0,
      pagos_existentes: pagosExistentes.map((pago) => ({
        id: pago.id,
        factura: pago.extra_invoice_num ?? undefined,
        cliente: pago.extra_client_name ?? undefined,
        fecha: pago.date,
        monto: pago.amount,
        metodo: pago.method,
      })),
      facturas_exactas: facturasExactas.slice(0, 10).map(fmtInvoice),
      combinaciones: combinaciones.slice(0, 5).map((combo) => ({
        total: Math.round(combo.reduce((sum, item) => sum + item.saldo, 0) * 100) / 100,
        facturas: combo.map(fmtInvoice),
      })),
      facturas_cliente: facturasCliente.map(fmtInvoice),
      facturas_cercanas: facturasCercanas.map(fmtInvoice),
      destinos: destinos.map(({ tipo: destinoTipo, id, nombre, coincidencia, score, saldo }) => ({
        tipo: destinoTipo,
        id,
        nombre,
        coincidencia,
        score,
        saldo: saldo === undefined ? undefined : Math.round(saldo * 100) / 100,
      })),
      destino_probable: destinoProbable,
      destino_ambiguo: destinoAmbiguo,
      requiere_aclaracion: requiereAclaracion,
      sugerencia: sugerencias.join('\n'),
    };
  },
};

const registrarPagoFactura: ToolDef = {
  name: 'registrar_pago_factura',
  description:
    'Registra un pago de un cliente contra una factura. factura_id es el id numérico (ej. 1069), no el número (F-11041); si solo tenés el número, usá numero_factura. Se ejecuta directo si el monto coincide exacto con el saldo y no hay duplicado. Si es parcial o duplicado, llamala igual: devuelve una pregunta de confirmación y el sistema espera el "sí". Antes de proponer, buscá el cliente y la factura en este turno (consultar_facturas o analizar_comprobante); no reutilices facturas de pagos anteriores. Si el pago cubre varias facturas, proponé una tool por cada una.',
  effect: 'write',
  parameters: {
    type: 'object',
    properties: {
      factura_id: { type: 'integer', description: 'Id de la factura si ya lo tenés.' },
      numero_factura: { type: 'string', description: 'Número de factura.' },
      cliente: { type: 'string', description: 'Cliente, para desambiguar números repetidos.' },
      monto: { type: 'number', description: 'Monto recibido, mayor a 0.' },
      fecha: { type: 'string', description: 'YYYY-MM-DD. Default hoy.' },
      metodo: {
        type: 'string',
        enum: ['Efectivo', 'Transferencia'],
        description: 'Obligatorio: Efectivo o Transferencia.',
      },
      destino_tipo: {
        type: 'string',
        enum: ['proveedor', 'empleado'],
        description: 'Destino de fondos (obligatorio en transferencia).',
      },
      destino: { type: 'string', description: 'Nombre del proveedor o empleado destino.' },
      destino_id: { type: 'integer', description: 'Id del destino si ya lo tenés.' },
    },
    required: ['monto', 'metodo'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const monto = optionalNumber(obj, 'monto');
    if (monto === undefined || monto <= 0) throw new ToolInputError('"monto" debe ser mayor a 0.');
    const facturaId = optionalNumber(obj, 'factura_id');
    const destinoId = optionalNumber(obj, 'destino_id');
    return {
      factura_id: facturaId !== undefined ? requiredInt(obj, 'factura_id') : undefined,
      numero_factura: optionalText(obj, 'numero_factura', 40),
      cliente: optionalText(obj, 'cliente', 120),
      monto,
      fecha: optionalDate(obj, 'fecha'),
      metodo: parseMetodoCobro(optionalText(obj, 'metodo', 20)),
      destino_tipo: parseDestinoTipo(optionalText(obj, 'destino_tipo', 20)),
      destino: optionalText(obj, 'destino', 80),
      destino_id: destinoId !== undefined ? requiredInt(obj, 'destino_id') : undefined,
    };
  },
  async prepare(args) {
    cacheStore.invalidate('pagos');
    cacheStore.invalidate('facturas');
    const factura = await resolveFactura(
      args.factura_id as number | undefined,
      args.numero_factura as string | undefined,
      args.cliente as string | undefined,
    );
    const { pagado, saldo, pagos } = await pagoInfo(factura);
    const monto = args.monto as number;
    if (saldo <= 0.01) {
      throw new ToolInputError(`La factura ${factura.numero_factura} de ${factura.cliente_nombre} ya está paga.`);
    }
    if (monto > saldo + 0.01) {
      throw new ToolInputError(
        `El saldo de la factura ${factura.numero_factura} es ${money(saldo)}; no se puede registrar ${money(monto)}. Si el pago cubre varias facturas, repartilo.`,
      );
    }

    const fecha = (args.fecha as string | undefined) ?? todayIso();
    const metodo = args.metodo as 'Efectivo' | 'Transferencia';
    const destinoTipo = args.destino_tipo as 'proveedor' | 'empleado' | undefined;
    const destinoNombre = args.destino as string | undefined;
    const destinoId = args.destino_id as number | undefined;

    if (metodo === 'Transferencia' && !destinoTipo && !destinoNombre && destinoId === undefined) {
      throw new ToolInputError(
        'Falta el destino de fondos: ¿a qué proveedor o empleado se destinan? No se registra una transferencia sin destino.',
      );
    }

    let destino: { tipo: 'PROVIDER' | 'EMPLOYEE'; id: number; nombre: string } | undefined;
    if (destinoTipo || destinoNombre || destinoId !== undefined) {
      if (metodo !== 'Transferencia') {
        throw new ToolInputError('El destino de fondos solo aplica a pagos por transferencia.');
      }
      if (!destinoTipo) throw new ToolInputError('Indicá destino_tipo: "proveedor" o "empleado".');
      if (destinoTipo === 'proveedor') {
        const proveedor = await resolveProveedor(destinoNombre, destinoId);
        destino = { tipo: 'PROVIDER', id: proveedor.id, nombre: proveedor.name };
      } else {
        const empleado = await resolveEmpleado(destinoNombre, destinoId, true);
        destino = { tipo: 'EMPLOYEE', id: empleado.id, nombre: empleado.name };
      }
    }

    const saldoDespues = Math.round((saldo - monto) * 100) / 100;
    const esParcial = saldoDespues > 0.01;
    const normalizedArgs: Record<string, unknown> = {
      invoice_id: factura.id,
      numero_factura: factura.numero_factura,
      cliente: factura.cliente_nombre,
      cliente_id: factura.cliente_id,
      monto,
      fecha,
      metodo,
      entity_type: destino?.tipo ?? null,
      entity_id: destino?.id ?? null,
      destino_nombre: destino?.nombre ?? null,
      saldo_antes: saldo,
      saldo_despues: saldoDespues,
      pagado_antes: pagado,
      permitir_duplicado: args.permitir_duplicado === true,
      permitir_parcial: args.permitir_parcial === true,
    };

    const duplicado = pagos.find(
      (p) =>
        p.invoice_id === factura.id &&
        Math.abs(Number(p.amount) - monto) < 0.01 &&
        p.date === fecha &&
        normalize(p.method) === normalize(metodo),
    );
    if (duplicado && args.permitir_duplicado !== true) {
      const extra = esParcial ? ' y además sería un pago parcial' : '';
      throw new ClarificationError(
        `Ya existe un pago de ${money(monto)} para la factura ${factura.numero_factura} el ${shortDate(fecha)} (pago #${duplicado.id})${extra}. ¿Registrarlo igual?`,
        normalizedArgs,
        esParcial ? { permitir_duplicado: true, permitir_parcial: true } : { permitir_duplicado: true },
      );
    }

    if (esParcial && args.permitir_parcial !== true) {
      throw new ClarificationError(
        `El saldo de la factura ${factura.numero_factura} es ${money(saldo)}. ¿Registrar ${money(monto)} como pago parcial?`,
        normalizedArgs,
        { permitir_parcial: true },
      );
    }

    const lineas = [
      `Registrar pago: Factura ${factura.numero_factura} · ${factura.cliente_nombre}`,
      `${money(monto)} · ${metodo} · ${shortDate(fecha)}`,
      `Saldo: ${money(saldo)} → ${money(saldoDespues)}${esParcial ? ' (parcial)' : ''}`,
    ];
    if (destino) {
      lineas.push(`Destino: ${destino.tipo === 'PROVIDER' ? 'Proveedor' : 'Empleado'} ${destino.nombre}`);
    }

    return {
      args: normalizedArgs,
      summary: lineas.join('\n'),
    };
  },
  async run(args) {
    cacheStore.invalidate('pagos');
    cacheStore.invalidate('facturas');
    const factura = (await loadFacturas()).find((f) => f.id === args.invoice_id);
    if (!factura) throw new ToolInputError('La factura ya no existe.');
    const info = await pagoInfo(factura);
    const monto = args.monto as number;
    if (info.saldo <= 0.01) throw new ToolInputError('La factura ya está paga.');
    if (monto > info.saldo + 0.01) {
      throw new ToolInputError(
        `El saldo actual de la factura es ${money(info.saldo)}; no se puede registrar ${money(monto)}.`,
      );
    }

    const result = await api.addPago({
      invoice_id: args.invoice_id as number,
      amount: monto,
      date: args.fecha as string,
      method: args.metodo as string,
      user_id: appStore.user?.user_id ?? 0,
      entity_type: (args.entity_type as string | null) ?? undefined,
      entity_id: (args.entity_id as number | null) ?? undefined,
    });
    cacheStore.invalidate('pagos');
    cacheStore.invalidate('facturas');
    if (args.entity_type === 'PROVIDER') {
      cacheStore.invalidate('providers');
      cacheStore.invalidate('provider:moves');
    } else if (args.entity_type === 'EMPLOYEE') {
      cacheStore.invalidate('employee:payments');
      cacheStore.invalidate('employees');
      cacheStore.invalidate('employees:active');
    }
    return result;
  },
  success(args) {
    const saldo = Number(args.saldo_despues) || 0;
    const extra = saldo > 0.01 ? ` Quedan ${money(saldo)} pendientes.` : ' La factura quedó paga.';
    return `Listo, registré el pago de ${money(args.monto as number)} para la factura ${args.numero_factura} de ${args.cliente}.${extra}`;
  },
  undo(args, result) {
    const id = (result as { id?: unknown } | null | undefined)?.id;
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return undefined;
    const monto = Number(args.monto) || 0;
    const numero = String(args.numero_factura ?? '');
    const cliente = String(args.cliente ?? '');
    return {
      kind: 'pago_factura',
      id,
      label: `pago de ${money(monto)}${numero ? ` · ${numero}` : ''}`,
      message: `el pago de ${money(monto)}${cliente ? ` de ${cliente}` : ''}${
        numero ? ` para la factura ${numero}` : ''
      }`,
      invoiceId: Number(args.invoice_id) || undefined,
    };
  },
};

/** true si el nombre del cliente contiene lo dicho (o todas sus palabras). */
function textMatchesClient(query: string, candidate: string | null | undefined): boolean {
  const clean = normalize(candidate);
  if (!clean) return false;
  const q = normalize(query);
  if (q && clean.includes(q)) return true;
  const tokens = nameTokens(query);
  return tokens.length > 0 && tokens.every((token) => clean.includes(token));
}

function descripcionPago(pago: PagoFullRow, factura?: FacturaRow): string {
  const numero = factura?.numero_factura ?? pago.extra_invoice_num ?? 's/factura';
  const cliente = factura?.cliente_nombre ?? pago.extra_client_name ?? '?';
  return `#${pago.id} · ${numero} · ${cliente} · ${money(Number(pago.amount) || 0)} · ${pago.method} · ${shortDate(String(pago.date ?? '').slice(0, 10))}`;
}

const deshacerPago: ToolDef = {
  name: 'deshacer_pago',
  description:
    'Deshace (elimina) un pago de factura ya registrado. Es destructivo: siempre se confirma con tarjeta. Si el usuario no dice cuál, usá ultimo=true para el último pago registrado. Si hay varios que coinciden y no aclaró "el último", la tool devuelve los candidatos para preguntar.',
  effect: 'destructive',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      pago_id: { type: 'integer', description: 'Id del pago si ya lo tenés.' },
      cliente: { type: 'string', description: 'Cliente que pagó (nombre o parte).' },
      numero_factura: { type: 'string', description: 'Número de factura del pago.' },
      monto: { type: 'number', description: 'Monto exacto del pago a deshacer.' },
      ultimo: { type: 'boolean', description: 'Si hay varios candidatos, deshacer el más reciente.' },
    },
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const pagoId = optionalNumber(obj, 'pago_id');
    const monto = optionalNumber(obj, 'monto');
    if (monto !== undefined && monto <= 0) throw new ToolInputError('"monto" debe ser mayor a 0.');
    return {
      pago_id: pagoId !== undefined ? requiredInt(obj, 'pago_id') : undefined,
      cliente: optionalText(obj, 'cliente', 120),
      numero_factura: optionalText(obj, 'numero_factura', 40),
      monto,
      ultimo: optionalBool(obj, 'ultimo') ?? false,
    };
  },
  async prepare(args) {
    cacheStore.invalidate('pagos');
    cacheStore.invalidate('facturas');
    const [pagos, facturas] = await Promise.all([loadPagos(), loadFacturas()]);
    const facturaDe = new Map(facturas.map((f) => [f.id, f]));

    let candidatos = [...pagos].sort((a, b) => b.id - a.id);
    const pagoId = args.pago_id as number | undefined;
    if (pagoId !== undefined) {
      const pago = candidatos.find((p) => p.id === pagoId);
      if (!pago) throw new ToolInputError(`No existe un pago con id ${pagoId}.`);
      candidatos = [pago];
    } else {
      const cliente = args.cliente as string | undefined;
      if (cliente) {
        candidatos = candidatos.filter((p) => {
          const factura = facturaDe.get(p.invoice_id);
          return textMatchesClient(cliente, factura?.cliente_nombre ?? p.extra_client_name);
        });
      }
      const numero = args.numero_factura as string | undefined;
      if (numero) {
        const query = normalize(numero);
        candidatos = candidatos.filter((p) => {
          const factura = facturaDe.get(p.invoice_id);
          return normalize(factura?.numero_factura ?? p.extra_invoice_num).includes(query);
        });
      }
      const monto = args.monto as number | undefined;
      if (monto !== undefined) {
        candidatos = candidatos.filter((p) => Math.abs(Number(p.amount) - monto) <= 0.01);
      }
    }

    const hayCriterios =
      pagoId !== undefined || Boolean(args.cliente) || Boolean(args.numero_factura) || args.monto !== undefined;
    const ultimo = args.ultimo === true || !hayCriterios;

    if (candidatos.length === 0) {
      throw new ToolInputError('No encontré un pago de factura que coincida. Pasá cliente, factura o monto.');
    }
    if (candidatos.length > 1 && !ultimo) {
      const lista = candidatos
        .slice(0, 6)
        .map((p) => descripcionPago(p, facturaDe.get(p.invoice_id)))
        .join('\n');
      throw new ToolInputError(`Hay varios pagos que coinciden. ¿Cuál deshago?\n${lista}`);
    }

    const pago = candidatos[0];
    const factura = facturaDe.get(pago.invoice_id);
    const pagosFactura = pagos.filter((p) => p.invoice_id === pago.invoice_id);
    const pagado = pagosFactura.reduce((acc, p) => acc + Number(p.amount || 0), 0);
    const saldoAntes = Math.round(((Number(factura?.total) || 0) - pagado) * 100) / 100;
    const montoPago = Number(pago.amount) || 0;
    const saldoDespues = Math.round((saldoAntes + montoPago) * 100) / 100;

    const cliente = factura?.cliente_nombre ?? pago.extra_client_name ?? '';
    const numero = factura?.numero_factura ?? pago.extra_invoice_num ?? '';
    const lineas = [
      `Deshacer pago #${pago.id}: ${numero || 'sin factura'} · ${cliente || 'sin cliente'}`,
      `${money(montoPago)} · ${pago.method} · ${shortDate(String(pago.date ?? '').slice(0, 10))}`,
    ];
    if (factura) lineas.push(`El saldo de la factura volverá a ${money(saldoDespues)}.`);
    else lineas.push('La factura ya no existe; se elimina el pago igual.');

    return {
      args: {
        pago_id: pago.id,
        invoice_id: pago.invoice_id,
        numero_factura: numero || null,
        cliente: cliente || null,
        cliente_id: factura?.cliente_id ?? null,
        monto: montoPago,
        fecha: pago.date,
        metodo: pago.method,
        entity_type: pago.entity_type ?? null,
        entity_id: pago.entity_id ?? null,
        saldo_antes: saldoAntes,
        saldo_despues: saldoDespues,
      },
      summary: lineas.join('\n'),
    };
  },
  async run(args) {
    await deletePayment(args.pago_id as number);
    return { deshecho: true, saldo: args.saldo_despues ?? null };
  },
  success(args) {
    const numero = args.numero_factura ? ` para la factura ${args.numero_factura}` : '';
    const cliente = args.cliente ? ` de ${args.cliente}` : '';
    const saldo = Number(args.saldo_despues);
    const extra =
      args.numero_factura && Number.isFinite(saldo)
        ? saldo > 0.01
          ? ` El saldo volvió a ${money(saldo)}.`
          : ' La factura quedó saldada.'
        : '';
    return `Listo, deshice el pago de ${money(Number(args.monto) || 0)}${cliente}${numero}.${extra}`;
  },
};

const deshacerUltimo: ToolDef = {
  name: 'deshacer_ultimo',
  description:
    'Deshace el último cambio que hizo el asistente en la conversación (pago de factura, gasto, pago de sueldo o movimiento de proveedor). Es destructivo: siempre se confirma con tarjeta. Usala cuando el usuario diga "deshacé eso", "anulá lo último" o "revertí el último cambio".',
  effect: 'destructive',
  requiresConfirmation: true,
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  validate(raw) {
    asObject(raw);
    return {};
  },
  async prepare(args) {
    const accion = args.accion as UndoAction | undefined;
    const kinds = [
      'pago_factura',
      'gasto',
      'pago_sueldo',
      'movimiento_proveedor',
      'factura',
      'estado_factura',
      'cliente_editado',
      'proveedor_editado',
      'empleado_editado',
      'gasto_editado',
      'pago_editado',
      'producto_creado',
      'producto_editado',
      'producto_eliminado',
    ];
    if (!accion || typeof accion.id !== 'number' || !kinds.includes(accion.kind)) {
      throw new ToolInputError('No hay un cambio reciente que se pueda deshacer.');
    }
    return { args: { accion }, summary: `Deshacer ${accion.message}` };
  },
  async run(args) {
    const accion = args.accion as UndoAction;
    return { texto: await performUndo(accion) };
  },
  success(_args, result) {
    return (result as { texto?: string } | null | undefined)?.texto ?? 'Listo, deshice el último cambio.';
  },
};

/* ------------------------------------------------------------------ */
/* Correcciones: editar entidades, gastos y pagos                      */
/* ------------------------------------------------------------------ */

const consultarPrecio: ToolDef = {
  name: 'consultar_precio',
  description:
    'Consulta el precio sugerido de un ítem o medida (ej. "bastidor 30x40 fondo 3", "vidrio 3mm") usando las reglas de precio y el catálogo. No crea nada. Si no encuentra, lo dice y pide medidas o precio.',
  effect: 'read',
  parameters: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Descripción, con medidas si aplica.' },
      limite: { type: 'integer', description: 'Máximo de sugerencias (1-10). Default 5.' },
    },
    required: ['texto'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    return {
      texto: requiredText(obj, 'texto', 160),
      limite: Math.min(10, Math.max(1, Math.trunc(optionalNumber(obj, 'limite') ?? 5))),
    };
  },
  async run(args) {
    const texto = args.texto as string;
    const limite = args.limite as number;
    const catalogo = await loadCatalogoPrecios();
    const base = catalogo.refs.length > 0 ? refsToProductos(catalogo.refs) : catalogo.productos;
    const sugerencias = suggestPrice(texto, base, catalogo.rules, catalogo.estimations)
      .slice(0, limite)
      .map((s) => ({
        descripcion: s.description,
        precio: Math.round((Number(s.price) || 0) * 100) / 100,
        estimado: s.estimated === true,
        basado_en: s.basedOn ?? null,
      }));
    if (sugerencias.length > 0) return { consulta: texto, encontrado: true, sugerencias };

    const productos = smartProductSearch(texto, catalogo.productos, limite, catalogo.refs).map((p) => ({
      descripcion: p.descripcion,
      precio: p.precio_unitario,
      estimado: false,
      basado_en: 'catálogo',
    }));
    if (productos.length > 0) return { consulta: texto, encontrado: true, sugerencias: productos };

    return {
      consulta: texto,
      encontrado: false,
      mensaje: 'No encontré un precio para esa descripción. Pasá medidas (ej. 30x40) o el precio.',
    };
  },
};

const listarDeudores: ToolDef = {
  name: 'listar_deudores',
  description:
    'Lista los clientes con deuda de facturas (saldo pendiente), de mayor a menor. Excluye las facturas NO_CONFIRMADO. Usala para "¿quién debe más?" o "¿cuánta deuda hay?".',
  effect: 'read',
  parameters: {
    type: 'object',
    properties: {
      limite: { type: 'integer', description: 'Máximo de clientes (1-50). Default 10.' },
      minimo: { type: 'number', description: 'Deuda mínima por cliente. Default 0.01.' },
    },
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const minimo = optionalNumber(obj, 'minimo');
    return {
      limite: Math.min(50, Math.max(1, Math.trunc(optionalNumber(obj, 'limite') ?? 10))),
      minimo: minimo !== undefined ? Math.max(0, minimo) : 0.01,
    };
  },
  async run(args) {
    const [facturas, pagos] = await Promise.all([loadFacturas(), loadPagosMap()]);
    const porCliente = new Map<
      string,
      { cliente: string; cliente_id: number | null; facturas: number; deuda: number }
    >();
    let deudaTotal = 0;
    for (const factura of facturas) {
      if (factura.estado_kanban === 'NO_CONFIRMADO') continue;
      const saldo = saldoOf(factura, pagos);
      if (saldo <= 0.5) continue;
      const key =
        factura.cliente_id !== null
          ? `id:${factura.cliente_id}`
          : `nombre:${normalize(factura.cliente_nombre)}`;
      const actual = porCliente.get(key) ?? {
        cliente: factura.cliente_nombre || 'Sin cliente',
        cliente_id: factura.cliente_id,
        facturas: 0,
        deuda: 0,
      };
      actual.facturas += 1;
      actual.deuda = Math.round((actual.deuda + saldo) * 100) / 100;
      porCliente.set(key, actual);
      deudaTotal += saldo;
    }
    const deudores = [...porCliente.values()]
      .filter((c) => c.deuda >= (args.minimo as number))
      .sort((a, b) => b.deuda - a.deuda)
      .slice(0, args.limite as number);
    return {
      total_clientes: porCliente.size,
      deuda_total: Math.round(deudaTotal * 100) / 100,
      deudores,
    };
  },
};

const editarCliente: ToolDef = {
  name: 'editar_cliente',
  description:
    'Actualiza los datos de un cliente (nombre, domicilio, teléfono, taller, estudiante). Pasá solo los campos que cambian. Si hay varios clientes con ese nombre, preguntá cuál.',
  effect: 'write',
  parameters: {
    type: 'object',
    properties: {
      cliente: { type: 'string', description: 'Cliente actual (nombre o parte).' },
      nombre: { type: 'string', description: 'Nombre nuevo.' },
      domicilio: { type: 'string' },
      telefono: { type: 'string' },
      taller: { type: 'string' },
      estudiante: { type: 'string' },
    },
    required: ['cliente'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const cambios = {
      nombre: optionalText(obj, 'nombre', 120),
      domicilio: optionalText(obj, 'domicilio', 200),
      telefono: optionalText(obj, 'telefono', 40),
      taller: optionalText(obj, 'taller', 120),
      estudiante: optionalText(obj, 'estudiante', 120),
    };
    if (Object.values(cambios).every((value) => value === undefined)) {
      throw new ToolInputError('Pasá al menos un campo a cambiar.');
    }
    return { cliente: requiredText(obj, 'cliente', 120), ...cambios };
  },
  async prepare(args) {
    const actual = await resolveClienteUnico(args.cliente as string);
    const prev = {
      nombre: actual.nombre ?? '',
      domicilio: actual.domicilio ?? '',
      telefono: actual.telefono ?? '',
      taller: actual.taller ?? '',
      estudiante: actual.estudiante ?? '',
    };
    const next = {
      nombre: (args.nombre as string | undefined) ?? prev.nombre,
      domicilio: (args.domicilio as string | undefined) ?? prev.domicilio,
      telefono: (args.telefono as string | undefined) ?? prev.telefono,
      taller: (args.taller as string | undefined) ?? prev.taller,
      estudiante: (args.estudiante as string | undefined) ?? prev.estudiante,
    };
    const cambios: string[] = [];
    for (const key of Object.keys(prev) as Array<keyof typeof prev>) {
      if (next[key] !== prev[key]) cambios.push(`${key}: “${prev[key]}” → “${next[key]}”`);
    }
    if (cambios.length === 0) {
      throw new ToolInputError('Los datos son iguales a los actuales; no hay nada que cambiar.');
    }
    return {
      args: { cliente_id: actual.id, cliente: actual.nombre, prev, next },
      summary: [`Editar cliente: ${actual.nombre}`, ...cambios].join('\n'),
    };
  },
  async run(args) {
    await api.updateCliente(args.cliente_id as number, args.next as Record<string, unknown>);
    cacheStore.invalidate('clientes');
    return { id: args.cliente_id, ...(args.next as Record<string, unknown>) };
  },
  success(args) {
    return `Listo, actualicé los datos de ${args.cliente}.`;
  },
  undo(args) {
    return {
      kind: 'cliente_editado',
      id: Number(args.cliente_id),
      label: `cliente ${args.cliente}`,
      message: `los datos de ${args.cliente}`,
      data: args.prev as Record<string, string>,
    };
  },
};

const editarProveedor: ToolDef = {
  name: 'editar_proveedor',
  description:
    'Actualiza los datos de un proveedor (nombre, CUIT, alias MP/CBU, dirección). Pasá solo los campos que cambian. Si hay varios con ese nombre, preguntá cuál.',
  effect: 'write',
  parameters: {
    type: 'object',
    properties: {
      proveedor: { type: 'string', description: 'Proveedor actual (nombre o parte).' },
      nombre: { type: 'string' },
      cuit: { type: 'string' },
      alias_mp: { type: 'string' },
      alias_cbu: { type: 'string' },
      direccion: { type: 'string' },
    },
    required: ['proveedor'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const cambios = {
      nombre: optionalText(obj, 'nombre', 120),
      cuit: optionalText(obj, 'cuit', 20),
      alias_mp: optionalText(obj, 'alias_mp', 80),
      alias_cbu: optionalText(obj, 'alias_cbu', 80),
      direccion: optionalText(obj, 'direccion', 200),
    };
    if (Object.values(cambios).every((value) => value === undefined)) {
      throw new ToolInputError('Pasá al menos un campo a cambiar.');
    }
    return { proveedor: requiredText(obj, 'proveedor', 120), ...cambios };
  },
  async prepare(args) {
    const actual = await resolveProveedor(args.proveedor as string, undefined);
    const prev = {
      name: actual.name ?? '',
      cuit: actual.cuit ?? '',
      alias_mp: actual.alias_mp ?? '',
      alias_cbu: actual.alias_cbu ?? '',
      address: actual.address ?? '',
    };
    const next = {
      name: (args.nombre as string | undefined) ?? prev.name,
      cuit: (args.cuit as string | undefined) ?? prev.cuit,
      alias_mp: (args.alias_mp as string | undefined) ?? prev.alias_mp,
      alias_cbu: (args.alias_cbu as string | undefined) ?? prev.alias_cbu,
      address: (args.direccion as string | undefined) ?? prev.address,
    };
    const cambios: string[] = [];
    for (const key of Object.keys(prev) as Array<keyof typeof prev>) {
      if (next[key] !== prev[key]) cambios.push(`${key}: “${prev[key]}” → “${next[key]}”`);
    }
    if (cambios.length === 0) {
      throw new ToolInputError('Los datos son iguales a los actuales; no hay nada que cambiar.');
    }
    return {
      args: { proveedor_id: actual.id, proveedor: actual.name, prev, next },
      summary: [`Editar proveedor: ${actual.name}`, ...cambios].join('\n'),
    };
  },
  async run(args) {
    await api.updateProvider(args.proveedor_id as number, args.next as Record<string, unknown>);
    cacheStore.invalidate('providers');
    cacheStore.invalidate('provider:');
    return { id: args.proveedor_id, ...(args.next as Record<string, unknown>) };
  },
  success(args) {
    return `Listo, actualicé los datos de ${args.proveedor}.`;
  },
  undo(args) {
    return {
      kind: 'proveedor_editado',
      id: Number(args.proveedor_id),
      label: `proveedor ${args.proveedor}`,
      message: `los datos de ${args.proveedor}`,
      data: args.prev as Record<string, string>,
    };
  },
};

const editarEmpleado: ToolDef = {
  name: 'editar_empleado',
  description:
    'Actualiza los datos de un empleado (nombre, teléfono, dirección, CUIT/CBU/alias, horario, tolerancia, sueldo, frecuencia, tipo, días). Pasá solo los campos que cambian.',
  effect: 'write',
  parameters: {
    type: 'object',
    properties: {
      empleado: { type: 'string', description: 'Empleado actual (nombre o parte).' },
      empleado_id: { type: 'integer', description: 'Id si ya lo tenés.' },
      nombre: { type: 'string' },
      telefono: { type: 'string' },
      direccion: { type: 'string' },
      cuit: { type: 'string' },
      cbu: { type: 'string' },
      alias: { type: 'string' },
      entrada: { type: 'string', description: 'HH:MM.' },
      salida: { type: 'string', description: 'HH:MM.' },
      tolerancia: { type: 'integer', description: 'Minutos de tolerancia.' },
      sueldo: { type: 'number', description: 'Sueldo base.' },
      frecuencia: { type: 'string', description: 'Semanal, Mensual o Por Hora.' },
      tipo: { type: 'string', description: 'Nómina u Ocasional.' },
      dias_trabajo: { type: 'string', description: 'Días 0=domingo…4=jueves, separados por coma.' },
    },
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const empleadoId = optionalNumber(obj, 'empleado_id');
    const tolerancia = optionalNumber(obj, 'tolerancia');
    const sueldo = optionalNumber(obj, 'sueldo');
    if (tolerancia !== undefined && (tolerancia < 0 || !Number.isInteger(tolerancia))) {
      throw new ToolInputError('"tolerancia" debe ser un entero ≥ 0.');
    }
    if (sueldo !== undefined && sueldo < 0) throw new ToolInputError('"sueldo" no puede ser negativo.');
    return {
      empleado: optionalText(obj, 'empleado', 120),
      empleado_id: empleadoId !== undefined ? requiredInt(obj, 'empleado_id') : undefined,
      nombre: optionalText(obj, 'nombre', 120),
      telefono: optionalText(obj, 'telefono', 40),
      direccion: optionalText(obj, 'direccion', 200),
      cuit: optionalText(obj, 'cuit', 20),
      cbu: optionalText(obj, 'cbu', 40),
      alias: optionalText(obj, 'alias', 80),
      entrada: optionalText(obj, 'entrada', 5),
      salida: optionalText(obj, 'salida', 5),
      tolerancia,
      sueldo,
      frecuencia: optionalText(obj, 'frecuencia', 20),
      tipo: optionalText(obj, 'tipo', 20),
      dias_trabajo: optionalText(obj, 'dias_trabajo', 40),
    };
  },
  async prepare(args) {
    const actual = await resolveEmpleado(
      args.empleado as string | undefined,
      args.empleado_id as number | undefined,
      false,
    );
    const next: Record<string, unknown> = {};
    const prev: Record<string, string | number | null> = {};
    const cambios: string[] = [];
    const set = (field: string, label: string, value: unknown, anterior: unknown) => {
      if (value === undefined) return;
      next[field] = value;
      prev[field] = typeof anterior === 'number' ? anterior : ((anterior as string | null) ?? null);
      if (String(anterior ?? '') !== String(value)) {
        cambios.push(`${label}: “${anterior ?? '—'}” → “${value}”`);
      }
    };
    set('name', 'nombre', args.nombre, actual.name);
    set('phone', 'teléfono', args.telefono, actual.phone);
    set('address', 'dirección', args.direccion, actual.address);
    set('cuit', 'CUIT', args.cuit, actual.cuit);
    set('cbu', 'CBU', args.cbu, actual.cbu);
    set('alias', 'alias', args.alias, actual.alias);
    set(
      'entry_time',
      'entrada',
      args.entrada ? normalizeTime(args.entrada as string) : undefined,
      actual.entry_time,
    );
    set(
      'exit_time',
      'salida',
      args.salida ? normalizeTime(args.salida as string) : undefined,
      actual.exit_time,
    );
    set('late_threshold', 'tolerancia', args.tolerancia, actual.late_threshold);
    set('base_salary', 'sueldo', args.sueldo, actual.base_salary);
    set(
      'payment_freq',
      'frecuencia',
      args.frecuencia ? parseFrecuenciaPago(args.frecuencia as string) : undefined,
      actual.payment_freq,
    );
    set(
      'job_type',
      'tipo',
      args.tipo ? parseTipoEmpleado(args.tipo as string) : undefined,
      actual.job_type,
    );
    set('work_days', 'días', args.dias_trabajo, actual.work_days);
    if (Object.keys(next).length === 0) {
      throw new ToolInputError('Pasá al menos un campo a cambiar.');
    }
    return {
      args: { empleado_id: actual.id, empleado: actual.name, next, prev },
      summary: [`Editar empleado: ${actual.name}`, ...cambios].join('\n'),
    };
  },
  async run(args) {
    await api.updateEmployee(args.empleado_id as number, args.next as Record<string, unknown>);
    cacheStore.invalidate('employees');
    cacheStore.invalidate('employee:');
    return { id: args.empleado_id };
  },
  success(args) {
    return `Listo, actualicé los datos de ${args.empleado}.`;
  },
  undo(args) {
    return {
      kind: 'empleado_editado',
      id: Number(args.empleado_id),
      label: `empleado ${args.empleado}`,
      message: `los datos de ${args.empleado}`,
      data: args.prev as Record<string, string | number | null>,
    };
  },
};

const editarGasto: ToolDef = {
  name: 'editar_gasto',
  description:
    'Corrige un gasto ya registrado (monto, descripción, fecha, categoría, método o referencia). Necesitás el gasto_id: usá listar_gastos si no lo tenés. El backend sincroniza el movimiento de proveedor o el pago de empleado vinculado.',
  effect: 'write',
  parameters: {
    type: 'object',
    properties: {
      gasto_id: { type: 'integer', description: 'Id del gasto (lo devuelve listar_gastos).' },
      monto: { type: 'number' },
      descripcion: { type: 'string' },
      fecha: { type: 'string', description: 'YYYY-MM-DD.' },
      categoria: { type: 'string' },
      categoria_id: { type: 'integer' },
      metodo: { type: 'string', enum: PAYMENT_METHODS },
      referencia: { type: 'string' },
    },
    required: ['gasto_id'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const monto = optionalNumber(obj, 'monto');
    if (monto !== undefined && monto <= 0) throw new ToolInputError('"monto" debe ser mayor a 0.');
    const categoriaId = optionalNumber(obj, 'categoria_id');
    return {
      gasto_id: requiredInt(obj, 'gasto_id'),
      monto,
      descripcion: optionalText(obj, 'descripcion', 300),
      fecha: optionalDate(obj, 'fecha'),
      categoria: optionalText(obj, 'categoria', 80),
      categoria_id: categoriaId !== undefined ? requiredInt(obj, 'categoria_id') : undefined,
      metodo: optionalText(obj, 'metodo', 30),
      referencia: optionalText(obj, 'referencia', 120),
    };
  },
  async prepare(args) {
    const gastos = await api.listExpenses({ limit: 1000 });
    const actual = gastos.find((g) => g.id === (args.gasto_id as number));
    if (!actual) throw new ToolInputError(`No existe el gasto #${args.gasto_id}.`);

    const next: Record<string, unknown> = {};
    const prev: Record<string, string | number | null> = {};
    const cambios: string[] = [];
    if (args.monto !== undefined) {
      next.amount = args.monto;
      prev.amount = Number(actual.amount) || 0;
      cambios.push(`monto: ${money(prev.amount)} → ${money(args.monto as number)}`);
    }
    if (args.descripcion) {
      next.description = args.descripcion;
      prev.description = actual.description;
      cambios.push(`descripción: “${actual.description}” → “${args.descripcion}”`);
    }
    if (args.fecha) {
      next.date = args.fecha;
      prev.date = actual.date;
      cambios.push(`fecha: ${actual.date} → ${args.fecha}`);
    }
    if (args.categoria || args.categoria_id) {
      const categoria = await resolveCategoria(
        args.categoria as string | undefined,
        args.categoria_id as number | undefined,
      );
      next.category_id = categoria.id;
      prev.category_id = actual.category_id;
      cambios.push(`categoría: #${actual.category_id} → ${categoria.name}`);
    }
    if (args.metodo) {
      next.payment_method = parseMetodoPago(args.metodo as string);
      prev.payment_method = actual.payment_method ?? '';
      cambios.push(`método: ${prev.payment_method} → ${next.payment_method}`);
    }
    if (args.referencia !== undefined) {
      next.reference = args.referencia;
      prev.reference = actual.reference ?? '';
      cambios.push(`referencia: “${prev.reference}” → “${args.referencia}”`);
    }
    if (Object.keys(next).length === 0) {
      throw new ToolInputError('Pasá al menos un campo a cambiar.');
    }
    return {
      args: {
        gasto_id: actual.id,
        descripcion: actual.description,
        next,
        prev,
      },
      summary: [`Editar gasto #${actual.id}: ${actual.description}`, ...cambios].join('\n'),
    };
  },
  async run(args) {
    await api.updateExpense(args.gasto_id as number, args.next as Record<string, unknown>);
    invalidateMoneyCaches();
    return { id: args.gasto_id };
  },
  success(args) {
    return `Listo, actualicé el gasto #${args.gasto_id} (${args.descripcion}).`;
  },
  undo(args) {
    return {
      kind: 'gasto_editado',
      id: Number(args.gasto_id),
      label: `gasto #${args.gasto_id}`,
      message: `el gasto #${args.gasto_id} (${args.descripcion})`,
      data: args.prev as Record<string, string | number | null>,
    };
  },
};

const editarPago: ToolDef = {
  name: 'editar_pago',
  description:
    'Corrige un pago de factura ya registrado (monto, fecha, método o destino). Necesitás el pago_id: usá listar_pagos_facturas si no lo tenés. Para cambiar monto/fecha de un pago con destino, primero deshacelo y registralo de nuevo.',
  effect: 'write',
  parameters: {
    type: 'object',
    properties: {
      pago_id: { type: 'integer', description: 'Id del pago (lo devuelve listar_pagos_facturas).' },
      monto: { type: 'number', description: 'Monto nuevo.' },
      fecha: { type: 'string', description: 'YYYY-MM-DD.' },
      metodo: { type: 'string', enum: ['Efectivo', 'Transferencia'] },
      destino_tipo: { type: 'string', enum: ['proveedor', 'empleado'] },
      destino: { type: 'string', description: 'Nombre del proveedor o empleado.' },
      destino_id: { type: 'integer' },
    },
    required: ['pago_id'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const monto = optionalNumber(obj, 'monto');
    if (monto !== undefined && monto <= 0) throw new ToolInputError('"monto" debe ser mayor a 0.');
    const destinoId = optionalNumber(obj, 'destino_id');
    return {
      pago_id: requiredInt(obj, 'pago_id'),
      monto,
      fecha: optionalDate(obj, 'fecha'),
      metodo: optionalText(obj, 'metodo', 20),
      destino_tipo: parseDestinoTipo(optionalText(obj, 'destino_tipo', 20)),
      destino: optionalText(obj, 'destino', 80),
      destino_id: destinoId !== undefined ? requiredInt(obj, 'destino_id') : undefined,
    };
  },
  async prepare(args) {
    cacheStore.invalidate('pagos');
    cacheStore.invalidate('facturas');
    const [pagos, facturas] = await Promise.all([loadPagos(), loadFacturas()]);
    const actual = pagos.find((p) => p.id === (args.pago_id as number));
    if (!actual) throw new ToolInputError(`No existe el pago #${args.pago_id}.`);
    const factura = facturas.find((f) => f.id === actual.invoice_id);

    const pagosMap = new Map<number, number>();
    for (const p of pagos) {
      pagosMap.set(p.invoice_id, (pagosMap.get(p.invoice_id) ?? 0) + (Number(p.amount) || 0));
    }
    const saldoConEstePago = factura ? saldoOf(factura, pagosMap) : 0;
    const maximo = Math.round((saldoConEstePago + (Number(actual.amount) || 0)) * 100) / 100;
    const nuevoMonto = args.monto !== undefined ? (args.monto as number) : Number(actual.amount) || 0;
    if (nuevoMonto > maximo + 0.01) {
      throw new ToolInputError(
        `El máximo para ese pago es ${money(maximo)} (total de la factura menos los otros pagos).`,
      );
    }

    const metodoActual = normalize(actual.method).startsWith('transf') ? 'Transferencia' : 'Efectivo';
    const nuevoMetodo = ((args.metodo as string | undefined) ?? metodoActual) === 'Transferencia' ? 'Transferencia' : 'Efectivo';
    const nuevaFecha = (args.fecha as string | undefined) ?? actual.date;

    let entidadTipo = actual.entity_type ?? null;
    let entidadId = actual.entity_id ?? null;
    const pideDestino =
      args.destino_tipo !== undefined || args.destino !== undefined || args.destino_id !== undefined;

    if (nuevoMetodo === 'Efectivo') {
      entidadTipo = null;
      entidadId = null;
    } else if (pideDestino) {
      const destinoTipo = args.destino_tipo as 'proveedor' | 'empleado' | undefined;
      if (!destinoTipo) throw new ToolInputError('Indicá destino_tipo: "proveedor" o "empleado".');
      if (destinoTipo === 'proveedor') {
        const proveedor = await resolveProveedor(args.destino as string | undefined, args.destino_id as number | undefined);
        entidadTipo = 'PROVIDER';
        entidadId = proveedor.id;
      } else {
        const empleado = await resolveEmpleado(args.destino as string | undefined, args.destino_id as number | undefined, true);
        entidadTipo = 'EMPLOYEE';
        entidadId = empleado.id;
      }
    } else if (!entidadTipo && !entidadId) {
      throw new ToolInputError('Una transferencia necesita destino: indicá proveedor o empleado.');
    }

    const cambiaEntidad =
      (entidadTipo ?? null) !== (actual.entity_type ?? null) || (entidadId ?? null) !== (actual.entity_id ?? null);
    const cambiaMontoOFecha =
      Math.abs(nuevoMonto - (Number(actual.amount) || 0)) > 0.001 ||
      fechaAISO(nuevaFecha) !== fechaAISO(actual.date);
    if (!cambiaEntidad && cambiaMontoOFecha && actual.entity_type) {
      throw new ToolInputError(
        'Para cambiar monto o fecha de un pago con destino, deshacé el pago y registralo de nuevo con el dato correcto.',
      );
    }

    const prev = {
      invoice_id: actual.invoice_id,
      amount: Number(actual.amount) || 0,
      date: actual.date,
      method: actual.method,
      user_id: actual.user_id ?? 0,
      entity_type: actual.entity_type ?? null,
      entity_id: actual.entity_id ?? null,
    };
    const next = {
      invoice_id: actual.invoice_id,
      amount: nuevoMonto,
      date: nuevaFecha,
      method: nuevoMetodo,
      user_id: actual.user_id ?? appStore.user?.user_id ?? 0,
      entity_type: entidadTipo,
      entity_id: entidadId,
    };

    const cambios: string[] = [];
    if (Math.abs(nuevoMonto - prev.amount) > 0.001) cambios.push(`monto: ${money(prev.amount)} → ${money(nuevoMonto)}`);
    if (fechaAISO(nuevaFecha) !== fechaAISO(prev.date)) cambios.push(`fecha: ${prev.date} → ${nuevaFecha}`);
    if (nuevoMetodo !== metodoActual) cambios.push(`método: ${metodoActual} → ${nuevoMetodo}`);
    if (cambiaEntidad) cambios.push(`destino: ${prev.entity_type ?? '—'} → ${entidadTipo ?? '—'}`);
    if (cambios.length === 0) throw new ToolInputError('No hay cambios para aplicar.');
    if (!factura) cambios.push('la factura ya no existe');

    return {
      args: {
        pago_id: actual.id,
        numero_factura: actual.extra_invoice_num ?? null,
        cliente: actual.extra_client_name ?? null,
        prev,
        next,
      },
      summary: [
        `Editar pago #${actual.id}: ${actual.extra_invoice_num ?? `#${actual.invoice_id}`} · ${actual.extra_client_name ?? ''}`,
        ...cambios,
      ].join('\n'),
    };
  },
  async run(args) {
    await api.updatePago(args.pago_id as number, args.next as Record<string, unknown>);
    invalidateMoneyCaches();
    return { id: args.pago_id };
  },
  success(args) {
    const numero = args.numero_factura ? ` de la factura ${args.numero_factura}` : '';
    return `Listo, actualicé el pago #${args.pago_id}${numero}.`;
  },
  undo(args) {
    return {
      kind: 'pago_editado',
      id: Number(args.pago_id),
      label: `pago #${args.pago_id}`,
      message: `el pago #${args.pago_id}`,
      data: args.prev as Record<string, string | number | null>,
    };
  },
};


const crearProducto: ToolDef = {
  name: 'crear_producto',
  description:
    'Agrega un producto al catálogo (descripción, precio, categoría, medida, variante, stock). Si ya existe uno con la misma descripción, no lo duplica: sugiere editar ese.',
  effect: 'write',
  parameters: {
    type: 'object',
    properties: {
      descripcion: { type: 'string', description: 'Descripción del producto.' },
      precio_unitario: { type: 'number', description: 'Precio en pesos.' },
      categoria: { type: 'string', description: 'Default "Varios".' },
      medida: { type: 'string', description: 'Ej. "30x40".' },
      variante: { type: 'string' },
      stock: { type: 'integer', description: 'Stock inicial. Default 0.' },
    },
    required: ['descripcion', 'precio_unitario'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const precio = optionalNumber(obj, 'precio_unitario');
    if (precio === undefined || precio < 0) {
      throw new ToolInputError('"precio_unitario" debe ser un número mayor o igual a 0.');
    }
    const stock = optionalNumber(obj, 'stock');
    return {
      descripcion: requiredText(obj, 'descripcion', 200),
      precio_unitario: precio,
      categoria: optionalText(obj, 'categoria', 80) ?? 'Varios',
      medida: optionalText(obj, 'medida', 60) ?? '',
      variante: optionalText(obj, 'variante', 120) ?? '',
      stock: stock !== undefined ? Math.trunc(stock) : 0,
    };
  },
  async prepare(args) {
    const productos = await loadProductos();
    const descripcion = args.descripcion as string;
    const existente = productos.find((p) => normalize(p.descripcion) === normalize(descripcion));
    if (existente) {
      throw new ToolInputError(
        `Ya existe un producto con esa descripción (id ${existente.id}). Si querés cambiar precio o stock, usá editar_producto.`,
      );
    }
    return {
      args,
      summary: [
        `Crear producto: ${descripcion}`,
        `${money(args.precio_unitario as number)} · ${args.categoria}`,
        ...(args.medida ? [`Medida: ${args.medida}`] : []),
        ...(args.variante ? [`Variante: ${args.variante}`] : []),
        `Stock inicial: ${args.stock}`,
      ].join('\n'),
    };
  },
  async run(args) {
    const id = `MAN_${Date.now()}_${Math.floor(Math.random() * 900 + 100)}`;
    await api.addProducto({
      id,
      descripcion: args.descripcion,
      precio_unitario: args.precio_unitario,
      categoria: args.categoria,
      medida: args.medida,
      variante: args.variante,
      stock: args.stock,
    });
    cacheStore.invalidate('productos');
    return { id };
  },
  success(args) {
    return `Listo, agregué “${args.descripcion}” al catálogo por ${money(args.precio_unitario as number)}.`;
  },
  undo(args, result) {
    const id = (result as { id?: string } | null | undefined)?.id;
    if (!id) return undefined;
    return {
      kind: 'producto_creado',
      id,
      label: `producto ${args.descripcion}`,
      message: `el producto “${args.descripcion}”`,
    };
  },
};

const editarProducto: ToolDef = {
  name: 'editar_producto',
  description:
    'Edita un producto del catálogo (descripción, precio, categoría, medida, variante o stock). Buscalo por producto_id o por texto; si hay varios, devuelve los candidatos para preguntar. No cambia el id.',
  effect: 'write',
  parameters: {
    type: 'object',
    properties: {
      producto_id: { type: 'string', description: 'Id del producto si ya lo tenés.' },
      producto: { type: 'string', description: 'Texto del producto si no tenés el id.' },
      descripcion: { type: 'string' },
      precio_unitario: { type: 'number' },
      categoria: { type: 'string' },
      medida: { type: 'string' },
      variante: { type: 'string' },
      stock: { type: 'integer' },
    },
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const precio = optionalNumber(obj, 'precio_unitario');
    if (precio !== undefined && precio < 0) throw new ToolInputError('El precio no puede ser negativo.');
    const stock = optionalNumber(obj, 'stock');
    if (stock !== undefined && !Number.isInteger(stock)) throw new ToolInputError('"stock" debe ser un entero.');
    const cambios = {
      descripcion: optionalText(obj, 'descripcion', 200),
      precio_unitario: precio,
      categoria: optionalText(obj, 'categoria', 80),
      medida: optionalText(obj, 'medida', 60),
      variante: optionalText(obj, 'variante', 120),
      stock,
    };
    if (Object.values(cambios).every((value) => value === undefined)) {
      throw new ToolInputError('Pasá al menos un campo a cambiar.');
    }
    return {
      producto_id: optionalText(obj, 'producto_id', 120),
      producto: optionalText(obj, 'producto', 160),
      ...cambios,
    };
  },
  async prepare(args) {
    const actual = await resolveProducto(
      args.producto_id as string | undefined,
      args.producto as string | undefined,
    );
    const prev = {
      id: actual.id,
      descripcion: actual.descripcion ?? '',
      precio_unitario: Number(actual.precio_unitario) || 0,
      categoria: actual.categoria ?? '',
      medida: actual.medida ?? '',
      variante: actual.variante ?? '',
      stock: Number(actual.stock) || 0,
    };
    const next = { ...prev };
    if (args.descripcion) next.descripcion = args.descripcion as string;
    if (args.precio_unitario !== undefined) next.precio_unitario = args.precio_unitario as number;
    if (args.categoria) next.categoria = args.categoria as string;
    if (args.medida) next.medida = args.medida as string;
    if (args.variante) next.variante = args.variante as string;
    if (args.stock !== undefined) next.stock = args.stock as number;

    const cambios: string[] = [];
    if (next.descripcion !== prev.descripcion) {
      cambios.push(`descripción: “${prev.descripcion}” → “${next.descripcion}”`);
    }
    if (next.precio_unitario !== prev.precio_unitario) {
      cambios.push(`precio: ${money(prev.precio_unitario)} → ${money(next.precio_unitario)}`);
    }
    if (next.categoria !== prev.categoria) cambios.push(`categoría: ${prev.categoria} → ${next.categoria}`);
    if (next.medida !== prev.medida) cambios.push(`medida: ${prev.medida || '—'} → ${next.medida || '—'}`);
    if (next.variante !== prev.variante) {
      cambios.push(`variante: ${prev.variante || '—'} → ${next.variante || '—'}`);
    }
    if (next.stock !== prev.stock) cambios.push(`stock: ${prev.stock} → ${next.stock}`);
    if (cambios.length === 0) {
      throw new ToolInputError('Los datos son iguales a los actuales; no hay nada que cambiar.');
    }

    return {
      args: { producto_id: actual.id, text: actual.descripcion, prev, next },
      summary: [`Editar producto: ${actual.descripcion}`, ...cambios].join('\n'),
    };
  },
  async run(args) {
    await api.updateProducto(args.producto_id as string, args.next as Record<string, unknown>);
    cacheStore.invalidate('productos');
    return { id: args.producto_id };
  },
  success(args) {
    return `Listo, actualicé el producto “${args.text}”.`;
  },
  undo(args) {
    return {
      kind: 'producto_editado',
      id: String(args.producto_id),
      label: `producto ${args.text}`,
      message: `el producto “${args.text}”`,
      data: args.prev as Record<string, string | number | null>,
    };
  },
};

const eliminarProducto: ToolDef = {
  name: 'eliminar_producto',
  description:
    'Elimina un producto del catálogo. Es destructivo: se confirma con tarjeta. Buscalo por producto_id o por texto; si hay varios, devuelve candidatos. Se puede deshacer (lo recrea con el mismo id y stock).',
  effect: 'destructive',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      producto_id: { type: 'string' },
      producto: { type: 'string' },
    },
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const productoId = optionalText(obj, 'producto_id', 120);
    const producto = optionalText(obj, 'producto', 160);
    if (!productoId && !producto) throw new ToolInputError('Pasá producto_id o el texto del producto.');
    return { producto_id: productoId, producto };
  },
  async prepare(args) {
    const actual = await resolveProducto(
      args.producto_id as string | undefined,
      args.producto as string | undefined,
    );
    const snapshot = {
      id: actual.id,
      descripcion: actual.descripcion ?? '',
      precio_unitario: Number(actual.precio_unitario) || 0,
      categoria: actual.categoria ?? '',
      medida: actual.medida ?? '',
      variante: actual.variante ?? '',
      stock: Number(actual.stock) || 0,
    };
    const lineas = [
      `Eliminar producto: ${snapshot.descripcion}`,
      `${snapshot.categoria || 'Sin categoría'}${snapshot.medida ? ` · ${snapshot.medida}` : ''} · ${money(snapshot.precio_unitario)}`,
    ];
    if (snapshot.stock > 0) {
      lineas.push(`Tiene stock ${snapshot.stock}: se pierde el conteo (el undo lo recupera).`);
    }
    return { args: { producto_id: actual.id, snapshot }, summary: lineas.join('\n') };
  },
  async run(args) {
    await api.deleteProducto(args.producto_id as string);
    cacheStore.invalidate('productos');
    return { id: args.producto_id };
  },
  success(args) {
    const snapshot = args.snapshot as { descripcion?: string } | undefined;
    return `Listo, eliminé “${snapshot?.descripcion ?? 'el producto'}” del catálogo.`;
  },
  undo(args) {
    const snapshot = args.snapshot as Record<string, string | number | null>;
    return {
      kind: 'producto_eliminado',
      id: String(args.producto_id),
      label: `producto ${snapshot.descripcion ?? ''}`,
      message: `el producto “${snapshot.descripcion ?? ''}”`,
      data: snapshot,
    };
  },
};

const ESTADOS_KANBAN = ['PEDIDO', 'EN_PROCESO', 'LISTO', 'EN_ESPERA', 'ENTREGADO', 'ARCHIVADO', 'NO_CONFIRMADO'];
const ESTADOS_ENTREGA = ['PENDIENTE', 'ENTREGADO'];
const TIPOS_ENTREGA = ['Retira', 'Envio', 'Retiro y Envio'];

function hoyAR(): string {
  const now = new Date();
  return `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;
}

/** Convierte ISO o dd/mm/yyyy al formato que espera el backend (dd/mm/yyyy). */
function toARDate(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return hoyAR();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  const ar = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (ar) return `${ar[1]}/${ar[2]}/${ar[3]}`;
  return raw;
}

/** dd/mm/yyyy o ISO → yyyy-mm-dd (para comparar rangos). */
function fechaAISO(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const ar = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (ar) return `${ar[3]}-${ar[2].padStart(2, '0')}-${ar[1].padStart(2, '0')}`;
  return raw.slice(0, 10);
}

function mesActual(): { desde: string; hasta: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { desde: iso(first), hasta: iso(now) };
}

function isoHoy(): string {
  return mesActual().hasta;
}

/** Fecha de hace N meses (rolling), en ISO. */
function isoMesesAtras(meses: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - Math.max(0, meses));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Fecha ordenable de una factura: fecha_iso o el dd/mm/yyyy convertido. */
function fechaOrden(f: FacturaRow): string {
  return f.fecha_iso || fechaAISO(f.fecha) || '';
}

const ITEM_STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'con', 'para', 'por', 'en', 'y', 'a', 'al',
]);

/** Normaliza medidas: × → x y ordena el par para que 140x108 = 108x140. */
function normalizeDims(text: string): string {
  return normalize(text)
    .replace(/[×✕✖]/g, 'x')
    .replace(/(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)/g, (_match, a: string, b: string) => {
      const na = Number(a.replace(',', '.'));
      const nb = Number(b.replace(',', '.'));
      if (!Number.isFinite(na) || !Number.isFinite(nb)) return `${a}x${b}`;
      return `${Math.min(na, nb)}x${Math.max(na, nb)}`;
    });
}

function itemTokens(text: string): string[] {
  return normalizeDims(text)
    .split(/\s+/)
    .map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
    .filter((token) => token.length >= 2 && !ITEM_STOPWORDS.has(token));
}

/** Todas las palabras de la consulta deben aparecer en la descripción del ítem. */
function itemMatches(descripcion: string, consulta: string): boolean {
  const item = normalizeDims(descripcion);
  const tokens = itemTokens(consulta);
  if (tokens.length === 0) return false;
  return tokens.every((token) => {
    if (item.includes(token)) return true;
    const singular = token.replace(/es$/, '').replace(/s$/, '');
    return singular.length >= 3 && item.includes(singular);
  });
}

type CatalogoPrecios = {
  productos: Producto[];
  refs: PrecioReferencia[];
  rules: PricingRule[];
  estimations: EstimationRule[];
};

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

/** Misma normalización que usa Facturación para las reglas de precio. */
function normalizePricingRules(raw: unknown[]): PricingRule[] {
  return (raw || []).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const r = entry as Record<string, unknown>;
    return [
      {
        id: typeof r.id === 'number' ? r.id : undefined,
        name: String(r.name ?? ''),
        matchTokens: parseJsonArray(r.matchTokens ?? r.match_tokens).map(String),
        baseCategoria: String(r.baseCategoria ?? r.base_categoria ?? ''),
        baseVariante: String(r.baseVariante ?? r.base_variante ?? ''),
        operation: String(r.operation ?? 'direct') as PricingRule['operation'],
        operationValue: Number(r.operationValue ?? r.operation_value ?? 0) || 0,
        conditions: parseJsonArray(r.conditions) as PricingRule['conditions'],
        enabled: r.enabled !== false,
        rounding: Number(r.rounding ?? 1000) || 1000,
      },
    ];
  });
}

function normalizeEstimationRules(raw: unknown[]): EstimationRule[] {
  return (raw || []).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const r = entry as Record<string, unknown>;
    const params = r.params;
    return [
      {
        id: typeof r.id === 'number' ? r.id : undefined,
        name: String(r.name ?? ''),
        matchTokens: parseJsonArray(r.matchTokens ?? r.match_tokens).map(String),
        refCategoria: String(r.refCategoria ?? r.ref_categoria ?? ''),
        refVariante: String(r.refVariante ?? r.ref_variante ?? ''),
        refMedida: String(r.refMedida ?? r.ref_medida ?? ''),
        method: String(r.method ?? 'perimetro') as EstimationRule['method'],
        params: normalizeEstimationParams(typeof params === 'string' ? safeJson(params) : params),
        priority: Number(r.priority ?? 0) || 0,
        enabled: r.enabled !== false,
      },
    ];
  });
}

async function loadProductos(): Promise<Producto[]> {
  return cacheStore.fetch<Producto[]>('productos', () => api.listProductos() as Promise<Producto[]>, 1_800_000);
}

async function loadPreciosReferencia(): Promise<PrecioReferencia[]> {
  return cacheStore.fetch<PrecioReferencia[]>('preciosReferencia', () => api.getPreciosReferencia(), 1_800_000);
}

async function loadCatalogoPrecios(): Promise<CatalogoPrecios> {
  const [productos, refs, rulesRaw, estimationsRaw] = await Promise.all([
    loadProductos().catch(() => [] as Producto[]),
    loadPreciosReferencia().catch(() => [] as PrecioReferencia[]),
    api.getPricingRules().catch(() => []),
    cacheStore.fetch<unknown[]>('estimationRules', () => api.getEstimationRules(), 1_800_000).catch(() => []),
  ]);
  return {
    productos,
    refs,
    rules: normalizePricingRules(rulesRaw),
    estimations: normalizeEstimationRules(estimationsRaw),
  };
}

/** Producto único por id o texto; error con candidatos si hay ambigüedad. */
async function resolveProducto(id: string | undefined, texto: string | undefined): Promise<Producto> {
  const productos = await loadProductos();
  if (id) {
    const found = productos.find((p) => p.id === id);
    if (!found) throw new ToolInputError(`No existe el producto con id ${id}.`);
    return found;
  }
  const query = String(texto ?? '').trim();
  if (!query) throw new ToolInputError('Pasá producto_id o el texto del producto.');
  const refs = await loadPreciosReferencia().catch(() => [] as PrecioReferencia[]);
  const encontrados = smartProductSearch(query, productos, 6, refs);
  if (encontrados.length === 0) {
    throw new ToolInputError(`No encontré productos con "${query}".`);
  }
  if (encontrados.length > 1) {
    const lista = encontrados
      .map(
        (p) =>
          `${p.descripcion} · ${p.categoria}${p.medida ? ` · ${p.medida}` : ''} · ${money(
            Number(p.precio_unitario) || 0,
          )} (id ${p.id})`,
      )
      .join('\n');
    throw new ToolInputError(`Hay varios productos que coinciden:\n${lista}\n¿Cuál? Pasá producto_id.`);
  }
  return encontrados[0];
}

/** Precio de un ítem: reglas/estimaciones primero, catálogo después. null si no hay. */
function resolverPrecioItem(
  descripcion: string,
  catalogo: CatalogoPrecios,
): { precio: number; fuente: 'reglas' | 'catalogo'; referencia?: string } | null {
  const base = catalogo.refs.length > 0 ? refsToProductos(catalogo.refs) : catalogo.productos;
  const sugerencias = suggestPrice(descripcion, base, catalogo.rules, catalogo.estimations);
  const mejor = sugerencias.find((s) => s.suggested) ?? sugerencias[0];
  if (mejor && Number.isFinite(mejor.price) && mejor.price > 0) {
    return {
      precio: Math.round(mejor.price * 100) / 100,
      fuente: 'reglas',
      referencia: mejor.basedOn || mejor.description,
    };
  }
  const producto = smartProductSearch(descripcion, catalogo.productos, 1, catalogo.refs)[0];
  if (producto && Number.isFinite(producto.precio_unitario) && producto.precio_unitario > 0) {
    return { precio: producto.precio_unitario, fuente: 'catalogo', referencia: producto.descripcion };
  }
  return null;
}

/** Cliente único para facturar; error con candidatos si hay ambigüedad. */
async function resolveClienteUnico(nombre: string): Promise<ClienteRow> {
  const clientes = await loadClientes();
  const id = await resolvePaymentClientId(nombre);
  if (id !== null) {
    const found = clientes.find((c) => c.id === id);
    if (found) return found;
  }
  const matches = matchClients(nombre, clientes);
  if (matches.length === 0) {
    throw new ToolInputError(
      `No encontré un cliente que coincida con "${nombre}". Si es nuevo, crealo primero con crear_cliente.`,
    );
  }
  if (matches.length > 1 && matches[1].score >= matches[0].score) {
    const lista = matches
      .slice(0, 6)
      .map((m) => `${m.cliente.nombre} (#${m.cliente.id})`)
      .join(', ');
    throw new ToolInputError(`Hay varios clientes que coinciden con "${nombre}": ${lista}. ¿Cuál es?`);
  }
  return matches[0].cliente;
}

/** Facturas con cliente_id nulo (viejas) se comparan por nombre. */
function facturaEsDelCliente(f: FacturaRow, cliente: ClienteRow): boolean {
  if (f.cliente_id === cliente.id) return true;
  return f.cliente_id === null && normalize(f.cliente_nombre) === normalize(cliente.nombre);
}

function resumenFactura(f: FacturaRow, pagos: Map<number, number>): Record<string, unknown> {
  const entrega = parseFechasEntrega(f.fecha_entrega);
  return {
    id: f.id,
    numero: f.numero_factura,
    cliente: f.cliente_nombre,
    fecha: f.fecha,
    total: Number(f.total) || 0,
    saldo: saldoOf(f, pagos),
    estado_kanban: f.estado_kanban,
    estado_entrega: f.estado_entrega ?? 'PENDIENTE',
    tipo_entrega: f.tipo_entrega ?? 'Retira',
    fecha_entrega: entrega.desde || undefined,
  };
}

const listarFacturas: ToolDef = {
  name: 'listar_facturas',
  description:
    'Lista facturas por estado del tablero (PEDIDO, EN_PROCESO, LISTO, EN_ESPERA, ENTREGADO, ARCHIVADO, NO_CONFIRMADO), estado de entrega (PENDIENTE/ENTREGADO), rango de fechas, cliente o texto. Devuelve número, cliente, total, saldo y estados. Usala para "qué está para entregar" o "qué hay en producción".',
  effect: 'read',
  parameters: {
    type: 'object',
    properties: {
      estado_kanban: { type: 'string', enum: ESTADOS_KANBAN, description: 'Estado del tablero.' },
      estado_entrega: { type: 'string', enum: ESTADOS_ENTREGA, description: 'Pendiente o entregado.' },
      desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD.' },
      hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD.' },
      cliente: { type: 'string', description: 'Nombre del cliente.' },
      texto: { type: 'string', description: 'Texto en número o cliente.' },
      limite: { type: 'integer', description: 'Máximo de resultados (1-50). Default 20.' },
    },
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const kanban = optionalText(obj, 'estado_kanban', 20)?.toUpperCase();
    if (kanban && !ESTADOS_KANBAN.includes(kanban)) {
      throw new ToolInputError(`"estado_kanban" inválido. Usá: ${ESTADOS_KANBAN.join(', ')}.`);
    }
    const entrega = optionalText(obj, 'estado_entrega', 20)?.toUpperCase();
    if (entrega && !ESTADOS_ENTREGA.includes(entrega)) {
      throw new ToolInputError(`"estado_entrega" inválido. Usá: ${ESTADOS_ENTREGA.join(', ')}.`);
    }
    return {
      estado_kanban: kanban,
      estado_entrega: entrega,
      desde: optionalDate(obj, 'desde'),
      hasta: optionalDate(obj, 'hasta'),
      cliente: optionalText(obj, 'cliente', 120),
      texto: optionalText(obj, 'texto', 120),
      limite: Math.min(50, Math.max(1, Math.trunc(optionalNumber(obj, 'limite') ?? 20))),
    };
  },
  async run(args) {
    const limite = args.limite as number;
    const facturas = (await api.listFacturas({
      start: args.desde as string | undefined,
      end: args.hasta as string | undefined,
      estado_kanban: args.estado_kanban as string | undefined,
      estado_entrega: args.estado_entrega as string | undefined,
      search: args.texto as string | undefined,
      limit: Math.max(limite, 200),
      with_items: false,
    })) as FacturaRow[];

    let list = facturas;
    const cliente = args.cliente as string | undefined;
    if (cliente) {
      const clienteId = await resolvePaymentClientId(cliente);
      if (clienteId !== null) {
        const clientes = await loadClientes();
        const encontrado = clientes.find((c) => c.id === clienteId);
        if (encontrado) list = list.filter((f) => facturaEsDelCliente(f, encontrado));
      } else {
        const query = normalize(cliente);
        list = list.filter((f) => normalize(f.cliente_nombre).includes(query));
      }
    }
    const pagos = await loadPagosMap();
    return {
      total: list.length,
      facturas: list.slice(0, limite).map((f) => resumenFactura(f, pagos)),
    };
  },
};

const verFactura: ToolDef = {
  name: 'ver_factura',
  description:
    'Detalle de una factura de un cliente: ítems, total, pagado, saldo, estados, entrega y pagos. Por defecto busca por cliente; si tiene varias facturas y no alcanza con numero o monto, devuelve las candidatas en vez de elegir. Usala para "qué tiene la factura de Fabricio" o "cuándo se entrega".',
  effect: 'read',
  parameters: {
    type: 'object',
    properties: {
      cliente: { type: 'string', description: 'Nombre o parte del nombre del cliente.' },
      numero: { type: 'string', description: 'Número de factura (opcional).' },
      monto: { type: 'number', description: 'Saldo o total exacto (opcional).' },
      incluir_entregadas: { type: 'boolean', description: 'Incluir facturas ya entregadas. Default false.' },
    },
    required: ['cliente'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const monto = optionalNumber(obj, 'monto');
    if (monto !== undefined && monto < 0) throw new ToolInputError('"monto" no puede ser negativo.');
    return {
      cliente: requiredText(obj, 'cliente', 120),
      numero: optionalText(obj, 'numero', 40),
      monto,
      incluir_entregadas: optionalBool(obj, 'incluir_entregadas') ?? false,
    };
  },
  async run(args) {
    const cliente = await resolveClienteUnico(args.cliente as string);
    const pagos = await loadPagosMap();
    const todas = await loadFacturas();

    let propias = todas.filter((f) => facturaEsDelCliente(f, cliente));
    if (args.incluir_entregadas !== true) {
      propias = propias.filter((f) => (f.estado_entrega ?? 'PENDIENTE') !== 'ENTREGADO');
    }
    const numero = normalize(args.numero as string | undefined);
    if (numero) propias = propias.filter((f) => normalize(f.numero_factura).includes(numero));
    const monto = args.monto as number | undefined;
    if (monto !== undefined) {
      propias = propias.filter(
        (f) => Math.abs(saldoOf(f, pagos) - monto) <= 0.01 || Math.abs(Number(f.total) - monto) <= 0.01,
      );
    }

    if (propias.length === 0) {
      return { encontrado: false, mensaje: `No encontré facturas de ${cliente.nombre} con esos criterios.` };
    }
    if (propias.length > 1) {
      return {
        encontrado: true,
        varias: true,
        mensaje: `${cliente.nombre} tiene ${propias.length} facturas: elegí con numero o monto.`,
        candidatas: propias.slice(0, 8).map((f) => resumenFactura(f, pagos)),
      };
    }

    const target = propias[0];
    const detalle = await api.getInvoiceDetail(target.id);
    const factura = (detalle.factura ?? target) as Record<string, unknown>;
    const saldo = saldoOf(target, pagos);
    const entrega = parseFechasEntrega((factura.fecha_entrega as string | null) ?? target.fecha_entrega);
    const pagosFactura = (await loadPagos())
      .filter((p) => p.invoice_id === target.id)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((p) => ({ id: p.id, fecha: p.date, monto: Number(p.amount) || 0, metodo: p.method }));

    return {
      encontrado: true,
      factura: {
        id: target.id,
        numero: factura.numero_factura ?? target.numero_factura,
        fecha: factura.fecha ?? target.fecha,
        cliente: factura.cliente_nombre ?? target.cliente_nombre,
        telefono: factura.cliente_telefono ?? null,
        domicilio: factura.cliente_domicilio ?? null,
        piso_depto: factura.cliente_piso_depto ?? null,
        total: Number(factura.total ?? target.total) || 0,
        envio: Number(factura.envio ?? 0) || 0,
        pagado: Math.round((Number(factura.total ?? target.total) - saldo) * 100) / 100,
        saldo,
        estado_kanban: factura.estado_kanban ?? target.estado_kanban,
        estado_entrega: factura.estado_entrega ?? 'PENDIENTE',
        tipo_entrega: factura.tipo_entrega ?? 'Retira',
        fecha_entrega: entrega.desde || undefined,
        items: detalle.items,
        pagos: pagosFactura,
      },
    };
  },
};

const resumenNegocio: ToolDef = {
  name: 'resumen_negocio',
  description:
    'Resumen del negocio en un período: facturado, cobrado, deuda, gastos y resultado (cobrado - gastos), más el total histórico. Sin fechas usa el mes actual.',
  effect: 'read',
  parameters: {
    type: 'object',
    properties: {
      desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD. Default inicio del mes.' },
      hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD. Default hoy.' },
    },
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    return { desde: optionalDate(obj, 'desde'), hasta: optionalDate(obj, 'hasta') };
  },
  async run(args) {
    const rango = mesActual();
    const desde = (args.desde as string | undefined) ?? rango.desde;
    const hasta = (args.hasta as string | undefined) ?? rango.hasta;

    const [facturasRaw, noConfirmadasRaw, pagos, global, gastos] = await Promise.all([
      api.listFacturas({ start: desde, end: hasta, limit: 5000, with_items: false }) as Promise<FacturaRow[]>,
      api.listFacturas({ estado_kanban: 'NO_CONFIRMADO', limit: 5000, with_items: false }) as Promise<FacturaRow[]>,
      loadPagos(),
      api.getInvoicesResumen(),
      api.getExpensesSummary(desde, hasta, 'category'),
    ]);

    const noConfirmadas = new Set(noConfirmadasRaw.map((f) => f.id));
    const facturas = facturasRaw.filter((f) => !noConfirmadas.has(f.id) && f.estado_kanban !== 'NO_CONFIRMADO');
    const pagosMap = new Map<number, number>();
    for (const p of pagos) {
      pagosMap.set(p.invoice_id, (pagosMap.get(p.invoice_id) ?? 0) + (Number(p.amount) || 0));
    }

    const facturado = Math.round(facturas.reduce((acc, f) => acc + (Number(f.total) || 0), 0) * 100) / 100;
    const deuda = Math.round(facturas.reduce((acc, f) => acc + Math.max(0, saldoOf(f, pagosMap)), 0) * 100) / 100;
    const cobrado = Math.round(
      pagos
        .filter((p) => !noConfirmadas.has(p.invoice_id))
        .filter((p) => {
          const fecha = fechaAISO(p.date);
          return fecha >= desde && fecha <= hasta;
        })
        .reduce((acc, p) => acc + (Number(p.amount) || 0), 0) * 100,
    ) / 100;

    const grupos = Object.entries(gastos.groups ?? {})
      .map(([nombre, monto]) => ({ categoria: nombre, monto: Number(monto) || 0 }))
      .sort((a, b) => b.monto - a.monto)
      .slice(0, 6);

    return {
      periodo: { desde, hasta },
      facturas: facturas.length,
      facturado,
      cobrado,
      deuda,
      gastos: Math.round((Number(gastos.total) || 0) * 100) / 100,
      resultado: Math.round((cobrado - (Number(gastos.total) || 0)) * 100) / 100,
      gastos_por_categoria: grupos,
      historico: {
        facturado: Number(global.facturado) || 0,
        cobrado: Number(global.cobrado) || 0,
        deuda: Number(global.deuda) || 0,
        facturas: Number(global.count) || 0,
      },
    };
  },
};

const crearFactura: ToolDef = {
  name: 'crear_factura',
  description:
    'Crea una factura/presupuesto para un cliente. Los precios que no vienen se resuelven con las reglas de precio y el catálogo; si no hay precio, la tool pide que lo digas. Siempre se confirma con tarjeta (muestra ítems, precios, total y número probable). Usala para "hacé una factura a Fabricio por un bastidor 30x40".',
  effect: 'write',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      cliente: { type: 'string', description: 'Nombre o parte del nombre del cliente.' },
      items: {
        type: 'array',
        description: 'Ítems de la factura (1-20).',
        items: {
          type: 'object',
          properties: {
            descripcion: { type: 'string', description: 'Ej. "Bastidor 30x40 fondo 3".' },
            cantidad: { type: 'integer', description: 'Default 1.' },
            precio_unitario: { type: 'number', description: 'Si falta, se resuelve con reglas/catálogo.' },
          },
          required: ['descripcion'],
          additionalProperties: false,
        },
      },
      envio: { type: 'number', description: 'Costo de envío. Default 0.' },
      tipo_entrega: { type: 'string', enum: TIPOS_ENTREGA, description: 'Default el último del cliente.' },
      fecha_entrega: { type: 'string', description: 'YYYY-MM-DD (opcional).' },
      fecha: { type: 'string', description: 'YYYY-MM-DD. Default hoy.' },
      estado_kanban: { type: 'string', enum: ['PEDIDO', 'NO_CONFIRMADO'], description: 'Default PEDIDO.' },
    },
    required: ['cliente', 'items'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const itemsRaw = obj.items;
    if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
      throw new ToolInputError('Pasá al menos un ítem.');
    }
    if (itemsRaw.length > 20) throw new ToolInputError('Máximo 20 ítems por factura.');
    const items = itemsRaw.map((entry) => {
      const item = asObject(entry);
      const cantidad = Math.trunc(optionalNumber(item, 'cantidad') ?? 1);
      if (cantidad <= 0) throw new ToolInputError('La cantidad de cada ítem debe ser mayor a 0.');
      const precio = optionalNumber(item, 'precio_unitario');
      if (precio !== undefined && precio < 0) throw new ToolInputError('El precio no puede ser negativo.');
      return {
        descripcion: requiredText(item, 'descripcion', 200),
        cantidad: Math.min(999, cantidad),
        precio_unitario: precio,
      };
    });
    const envio = optionalNumber(obj, 'envio');
    if (envio !== undefined && envio < 0) throw new ToolInputError('"envio" no puede ser negativo.');
    const tipoEntrega = optionalText(obj, 'tipo_entrega', 20);
    if (tipoEntrega && !TIPOS_ENTREGA.includes(tipoEntrega)) {
      throw new ToolInputError(`"tipo_entrega" inválido. Usá: ${TIPOS_ENTREGA.join(', ')}.`);
    }
    const estado = optionalText(obj, 'estado_kanban', 20)?.toUpperCase();
    if (estado && estado !== 'PEDIDO' && estado !== 'NO_CONFIRMADO') {
      throw new ToolInputError('"estado_kanban" debe ser PEDIDO o NO_CONFIRMADO.');
    }
    return {
      cliente: requiredText(obj, 'cliente', 120),
      items,
      envio: envio ?? 0,
      tipo_entrega: tipoEntrega,
      fecha_entrega: optionalDate(obj, 'fecha_entrega'),
      fecha: optionalDate(obj, 'fecha'),
      estado_kanban: estado,
    };
  },
  async prepare(args) {
    const catalogo = await loadCatalogoPrecios();
    const cliente = await resolveClienteUnico(args.cliente as string);
    const direcciones = (await api.listAddresses(cliente.id).catch(() => [])) ?? [];
    const direccion = direcciones.find((a) => a.is_default) ?? direcciones[0];

    let subtotal = 0;
    const items = (args.items as Array<{ descripcion: string; cantidad: number; precio_unitario?: number }>).map(
      (item) => {
        let precio = item.precio_unitario;
        let fuente: 'usuario' | 'reglas' | 'catalogo' = 'usuario';
        if (precio === undefined) {
          const resuelto = resolverPrecioItem(item.descripcion, catalogo);
          if (!resuelto) {
            throw new ToolInputError(
              `No tengo precio para «${item.descripcion}». Decime cuánto sale o cargalo en el catálogo.`,
            );
          }
          precio = resuelto.precio;
          fuente = resuelto.fuente;
        }
        const total = Math.round(precio * item.cantidad * 100) / 100;
        subtotal += total;
        return { ...item, precio_unitario: precio, total, fuente };
      },
    );

    const envio = Number(args.envio) || 0;
    const total = Math.round((subtotal + envio) * 100) / 100;
    const tipoEntregaRaw =
      (args.tipo_entrega as string | undefined) || cliente.ultimo_tipo_entrega || 'Retira';
    const tipoEntrega = TIPOS_ENTREGA.includes(tipoEntregaRaw) ? tipoEntregaRaw : 'Retira';
    const fecha = toARDate(args.fecha as string | undefined);
    const fechaEntrega = args.fecha_entrega ? toARDate(args.fecha_entrega as string) : '';
    const estado = (args.estado_kanban as string | undefined) ?? 'PEDIDO';
    const preview = await api.nextInvoiceNumber('F').catch(() => 'F-00000');

    const lineas = [`Crear factura ${preview} · ${cliente.nombre}`];
    for (const item of items) {
      const sugerido = item.fuente === 'usuario' ? '' : ' (precio sugerido)';
      lineas.push(
        `${item.cantidad}× ${item.descripcion} · ${money(item.precio_unitario)} c/u = ${money(item.total)}${sugerido}`,
      );
    }
    if (envio > 0) lineas.push(`Envío: ${money(envio)}`);
    lineas.push(`Total: ${money(total)}`);
    if (tipoEntrega !== 'Retira') lineas.push(`${tipoEntrega}${fechaEntrega ? ` · ${fechaEntrega}` : ''}`);
    if (estado === 'NO_CONFIRMADO') lineas.push('Queda como NO CONFIRMADO');

    return {
      args: {
        preview_numero: preview,
        cliente_id: cliente.id,
        cliente: cliente.nombre,
        cliente_domicilio: direccion?.address ?? cliente.domicilio ?? '',
        cliente_piso_depto: direccion?.extra ?? '',
        cliente_telefono: cliente.telefono || '',
        cliente_taller: cliente.taller || '',
        items,
        envio,
        total,
        fecha,
        fecha_entrega: fechaEntrega,
        tipo_entrega: tipoEntrega,
        estado_kanban: estado,
      },
      summary: lineas.join('\n'),
    };
  },
  async run(args) {
    const items = args.items as Array<{ descripcion: string; cantidad: number; precio_unitario: number; total: number }>;
    const payload = {
      numero_factura: args.preview_numero,
      numero_presupuesto: String(args.preview_numero ?? '').replace('F', 'P'),
      fecha: args.fecha,
      cliente_id: args.cliente_id,
      cliente_nombre: args.cliente,
      cliente_domicilio: args.cliente_domicilio,
      cliente_piso_depto: args.cliente_piso_depto,
      cliente_telefono: args.cliente_telefono,
      cliente_taller: args.cliente_taller,
      items: items.map((item) => ({
        cantidad: item.cantidad,
        descripcion: item.descripcion,
        precio_unitario: item.precio_unitario,
        total: item.total,
      })),
      total: args.total,
      envio: args.envio,
      tipo: 'PRESUPUESTO',
      user_id: appStore.user?.user_id || 0,
      tipo_entrega: args.tipo_entrega,
      fecha_entrega: args.fecha_entrega
        ? serializeFechasEntrega({
            desde: args.fecha_entrega as string,
            hasta: args.fecha_entrega as string,
            extras: [],
          })
        : '',
      estado_kanban: args.estado_kanban,
    };
    const created = (await api.saveFactura(payload)) as { id: number; numero_factura?: string; total?: number };
    cacheStore.invalidate('facturas');
    return {
      id: created.id,
      numero_factura: created.numero_factura ?? args.preview_numero,
      total: Number(created.total) || Number(args.total) || 0,
    };
  },
  success(args, result) {
    const created = result as { numero_factura?: string; total?: number };
    return `Listo, creé la factura ${created.numero_factura ?? args.preview_numero} para ${args.cliente} por ${money(
      Number(created.total ?? args.total) || 0,
    )}.`;
  },
  undo(args, result) {
    const created = result as { id?: number; numero_factura?: string } | null | undefined;
    const id = created?.id;
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return undefined;
    const numero = String(created?.numero_factura ?? args.preview_numero ?? '');
    const total = money(Number(args.total) || 0);
    return {
      kind: 'factura',
      id,
      label: `factura ${numero} · ${total}`,
      message: `la factura ${numero} de ${args.cliente} por ${total}`,
      invoiceId: id,
    };
  },
};

const cambiarEstadoFactura: ToolDef = {
  name: 'cambiar_estado_factura',
  description:
    'Cambia el estado de una factura: entrega (PENDIENTE/ENTREGADO) o tablero (PEDIDO, EN_PROCESO, LISTO, EN_ESPERA, ENTREGADO, ARCHIVADO, NO_CONFIRMADO). Marcar ENTREGADO ajusta también moldura y orden de tela, igual que la app. Usala para "pasá la de Fabricio a entregado" o "marcá F-11033 en producción".',
  effect: 'write',
  parameters: {
    type: 'object',
    properties: {
      cliente: { type: 'string', description: 'Cliente (si no pasás numero).' },
      numero: { type: 'string', description: 'Número de factura.' },
      estado_entrega: { type: 'string', enum: ESTADOS_ENTREGA },
      estado_kanban: { type: 'string', enum: ESTADOS_KANBAN },
    },
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const entrega = optionalText(obj, 'estado_entrega', 20)?.toUpperCase();
    const kanban = optionalText(obj, 'estado_kanban', 20)?.toUpperCase();
    if (entrega && !ESTADOS_ENTREGA.includes(entrega)) {
      throw new ToolInputError(`"estado_entrega" inválido. Usá: ${ESTADOS_ENTREGA.join(', ')}.`);
    }
    if (kanban && !ESTADOS_KANBAN.includes(kanban)) {
      throw new ToolInputError(`"estado_kanban" inválido. Usá: ${ESTADOS_KANBAN.join(', ')}.`);
    }
    if (!entrega && !kanban) throw new ToolInputError('Indicá estado_entrega o estado_kanban.');
    return {
      cliente: optionalText(obj, 'cliente', 120),
      numero: optionalText(obj, 'numero', 40),
      estado_entrega: entrega,
      estado_kanban: kanban,
    };
  },
  async prepare(args) {
    cacheStore.invalidate('facturas');
    let factura: FacturaRow;
    const numero = args.numero as string | undefined;
    if (numero) {
      factura = await resolveFactura(undefined, numero, args.cliente as string | undefined);
    } else {
      const nombre = args.cliente as string | undefined;
      if (!nombre) throw new ToolInputError('Pasá numero o cliente.');
      const cliente = await resolveClienteUnico(nombre);
      const facturas = await loadFacturas();
      const propias = facturas.filter(
        (f) => facturaEsDelCliente(f, cliente) && (f.estado_entrega ?? 'PENDIENTE') !== 'ENTREGADO',
      );
      if (propias.length === 0) {
        throw new ToolInputError(`${cliente.nombre} no tiene facturas pendientes de entrega.`);
      }
      if (propias.length > 1) {
        const lista = propias
          .slice(0, 6)
          .map((f) => `${f.numero_factura} (${money(Number(f.total) || 0)})`)
          .join(', ');
        throw new ToolInputError(`${cliente.nombre} tiene varias facturas pendientes: ${lista}. ¿Cuál?`);
      }
      factura = propias[0];
    }

    const patch: Record<string, string> = {};
    const prev: Record<string, string> = {};
    const estadoEntrega = args.estado_entrega as string | undefined;
    const estadoKanban = args.estado_kanban as string | undefined;
    if (estadoEntrega) {
      const entregado = estadoEntrega === 'ENTREGADO';
      patch.estado_entrega = estadoEntrega;
      patch.estado_kanban = entregado ? 'ENTREGADO' : 'PEDIDO';
      patch.estado_moldura = entregado ? 'DELETED' : 'PENDING';
      patch.estado_orden_tela = entregado ? 'DELETED' : 'PENDING';
    }
    if (estadoKanban) patch.estado_kanban = estadoKanban;
    for (const field of Object.keys(patch)) {
      const value = (factura as unknown as Record<string, unknown>)[field];
      prev[field] = typeof value === 'string' ? value : '';
    }

    const lineas = [`Cambiar estado: ${factura.numero_factura} · ${factura.cliente_nombre}`];
    if (patch.estado_entrega) {
      lineas.push(`Entrega: ${prev.estado_entrega || 'PENDIENTE'} → ${patch.estado_entrega}`);
    }
    if (!patch.estado_entrega && patch.estado_kanban) {
      lineas.push(`Tablero: ${prev.estado_kanban || '—'} → ${patch.estado_kanban}`);
    }

    return {
      args: {
        invoice_id: factura.id,
        numero_factura: factura.numero_factura,
        cliente: factura.cliente_nombre,
        patch,
        prev,
        estado_entrega: patch.estado_entrega ?? null,
        estado_kanban: patch.estado_kanban ?? null,
      },
      summary: lineas.join('\n'),
    };
  },
  async run(args) {
    const patch = args.patch as Record<string, string>;
    for (const [field, value] of Object.entries(patch)) {
      await api.patchInvoiceField(args.invoice_id as number, field, value);
    }
    cacheStore.invalidate('facturas');
    return { aplicados: Object.keys(patch).length };
  },
  success(args) {
    const estado = args.estado_entrega
      ? args.estado_entrega === 'ENTREGADO'
        ? 'como entregada'
        : 'como pendiente de entrega'
      : `en ${args.estado_kanban}`;
    return `Listo, marqué la factura ${args.numero_factura} de ${args.cliente} ${estado}.`;
  },
  undo(args, result) {
    const id = Number(args.invoice_id);
    if (!Number.isInteger(id) || id <= 0) return undefined;
    const prev = (args.prev ?? {}) as Record<string, string>;
    return {
      kind: 'estado_factura',
      id,
      label: `estado de ${args.numero_factura}`,
      message: `el cambio de estado de la factura ${args.numero_factura} de ${args.cliente}`,
      data: prev,
    };
  },
};

/* ------------------------------------------------------------------ */
/* Lectura genérica y pedidos no cumplidos                             */
/* ------------------------------------------------------------------ */

const catalogoDatos: ToolDef = {
  name: 'catalogo_datos',
  description:
    'Lista los datasets que se pueden leer con leer_datos (clientes, facturas, pagos, gastos, proveedores, empleados, asistencias, tareas, notas, mapa, molduras, precios, análisis, vouchers, etc.). Usala cuando no exista una tool específica o no sepas qué dataset consultar. Con "dataset" devuelve solo ese.',
  effect: 'read',
  parameters: {
    type: 'object',
    properties: {
      dataset: { type: 'string', description: 'Id de dataset para ver solo ese (opcional).' },
    },
    required: [],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const dataset = optionalText(obj, 'dataset', 60);
    if (dataset && !datasetIds().includes(dataset)) {
      throw new ToolInputError(
        `No existe el dataset "${dataset}". Llamá a catalogo_datos sin argumentos para ver la lista.`,
      );
    }
    return dataset ? { dataset } : {};
  },
  async run(args) {
    return { datasets: datasetCatalog(args.dataset as string | undefined) };
  },
};

const leerDatos: ToolDef = {
  name: 'leer_datos',
  description:
    'Lectura genérica de solo lectura sobre cualquier dato de la app. Usala cuando no exista una tool específica para la pregunta o para dar una respuesta parcial. Devuelve como máximo 200 filas: usá filtros, campos y modo resumen para no traer de más. Si no sabés el dataset, llamá primero a catalogo_datos. Después de una respuesta parcial, registrá el pedido con registrar_pedido_no_cumplido.',
  effect: 'read',
  parameters: {
    type: 'object',
    properties: {
      dataset: { type: 'string', description: 'Id del dataset (ver catalogo_datos).' },
      filtros: {
        type: 'object',
        description:
          'Filtros de igualdad y búsqueda. Ej: { search, desde, hasta, cliente_id, estado_kanban, fecha, month }.',
        properties: {
          search: { type: 'string', description: 'Texto a buscar en los campos del dataset.' },
          desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD.' },
          hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD.' },
          cliente_id: { type: 'integer' },
          proveedor_id: { type: 'integer' },
          empleado_id: { type: 'integer' },
          factura_id: { type: 'integer' },
          tarea_id: { type: 'integer' },
          usuario_id: { type: 'integer' },
          fecha: { type: 'string', description: 'Fecha exacta YYYY-MM-DD cuando el dataset la requiere.' },
          month: { type: 'string', description: 'Mes YYYY-MM para asistencias.' },
          estado: { type: 'string' },
          estado_kanban: { type: 'string' },
          estado_entrega: { type: 'string' },
          status: { type: 'string' },
        },
        additionalProperties: true,
      },
      campos: {
        type: 'array',
        items: { type: 'string' },
        description: 'Campos a devolver (opcional).',
      },
      limite: { type: 'integer', description: 'Filas a devolver (1-200, default 25).' },
      offset: { type: 'integer', description: 'Desde qué fila empezar.' },
      orden: { type: 'string', description: 'Orden, ej. "fecha:desc" o "total:asc".' },
      modo: {
        type: 'string',
        enum: ['filas', 'resumen'],
        description: 'filas (default) o resumen agrupado.',
      },
      agrupar: { type: 'string', description: 'Campo para agrupar en modo resumen.' },
      sumar: { type: 'string', description: 'Campo numérico a sumar en modo resumen.' },
    },
    required: ['dataset'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const dataset = optionalText(obj, 'dataset', 60);
    if (!dataset) {
      throw new ToolInputError('Falta "dataset". Usá catalogo_datos para ver los disponibles.');
    }
    if (!datasetIds().includes(dataset)) {
      throw new ToolInputError(
        `No existe el dataset "${dataset}". Usá catalogo_datos para ver los disponibles.`,
      );
    }

    let campos: string[] | undefined;
    if (obj.campos !== undefined) {
      if (!Array.isArray(obj.campos)) throw new ToolInputError('"campos" debe ser una lista de nombres.');
      campos = obj.campos
        .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
        .map((value) => value.trim())
        .slice(0, 30);
    }

    const modo = optionalText(obj, 'modo', 12);
    if (modo && modo !== 'filas' && modo !== 'resumen') {
      throw new ToolInputError('"modo" debe ser "filas" o "resumen".');
    }

    const limite = optionalNumber(obj, 'limite');
    const offset = optionalNumber(obj, 'offset');
    const orden = optionalText(obj, 'orden', 80);
    const agrupar = optionalText(obj, 'agrupar', 60);
    const sumar = optionalText(obj, 'sumar', 60);

    return {
      dataset,
      filtros: normalizeFilters(obj.filtros),
      ...(campos && campos.length > 0 ? { campos } : {}),
      ...(limite !== undefined ? { limite } : {}),
      ...(offset !== undefined ? { offset } : {}),
      ...(orden ? { orden } : {}),
      ...(modo ? { modo } : {}),
      ...(agrupar ? { agrupar } : {}),
      ...(sumar ? { sumar } : {}),
    };
  },
  async run(args) {
    return readDataset(args as unknown as DatasetReadOptions);
  },
};

const registrarPedidoNoCumplido: ToolDef = {
  name: 'registrar_pedido_no_cumplido',
  description:
    'Guarda un pedido que no se pudo resolver del todo. Usala al final del turno cuando: diste una respuesta parcial, tuviste que usar leer_datos porque no había tool específica, faltó un dato o la acción no existe. No pidas confirmación: se guarda directo en la lista de pendientes.',
  effect: 'write',
  parameters: {
    type: 'object',
    properties: {
      pregunta: { type: 'string', description: 'Pregunta o pedido original del usuario.' },
      motivo: { type: 'string', description: 'Qué faltó: tool, dato, acción, etc.' },
      respuesta_parcial: { type: 'string', description: 'Lo que sí se pudo responder.' },
      datasets: {
        type: 'array',
        items: { type: 'string' },
        description: 'Datasets leídos con leer_datos.',
      },
      tools: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tools que se intentaron usar.',
      },
    },
    required: ['pregunta'],
    additionalProperties: false,
  },
  validate(raw) {
    const obj = asObject(raw);
    const list = (key: string): string[] => {
      const value = obj[key];
      if (!Array.isArray(value)) return [];
      return value
        .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
        .map((item) => item.trim())
        .slice(0, 20);
    };
    return {
      pregunta: requiredText(obj, 'pregunta', 2000),
      motivo: optionalText(obj, 'motivo', 1000) ?? '',
      respuesta_parcial: optionalText(obj, 'respuesta_parcial', 4000) ?? '',
      datasets: list('datasets'),
      tools: list('tools'),
    };
  },
  async prepare(args) {
    return {
      args,
      summary: `Guardar pedido pendiente: “${String(args.pregunta ?? '').slice(0, 90)}”`,
    };
  },
  async run(args) {
    const gap = assistant.addGap({
      pregunta: String(args.pregunta ?? ''),
      motivo: String(args.motivo ?? ''),
      respuestaParcial: String(args.respuesta_parcial ?? ''),
      datasets: (args.datasets as string[] | undefined) ?? [],
      tools: (args.tools as string[] | undefined) ?? [],
    });
    return { ok: true, id: gap?.id ?? null };
  },
  success(args) {
    return `Guardé el pedido como pendiente: “${String(args.pregunta ?? '').slice(0, 80)}”.`;
  },
};

/* ------------------------------------------------------------------ */
/* Registro                                                            */
/* ------------------------------------------------------------------ */

export const TOOLS: ToolDef[] = [
  listarTareas,
  buscarClientes,
  consultarDeudasCliente,
  consultarFacturas,
  listarFacturas,
  verFactura,
  resumenNegocio,
  consultarPrecio,
  listarDeudores,
  listarPagosFacturas,
  analizarComprobante,
  catalogoDatos,
  leerDatos,
  registrarPedidoNoCumplido,
  resumenGastos,
  listarGastos,
  listarCategoriasGasto,
  listarEmpleados,
  consultarAsistencia,
  listarProveedores,
  consultarProveedor,
  listarPagosSueldos,
  crearCliente,
  crearProveedor,
  crearEmpleado,
  editarCliente,
  editarProveedor,
  editarEmpleado,
  crearTarea,
  editarTarea,
  marcarTarea,
  fijarTarea,
  registrarAsistencia,
  registrarPagoSueldo,
  registrarMovimientoProveedor,
  registrarGasto,
  editarGasto,
  registrarPagoFactura,
  editarPago,
  crearProducto,
  editarProducto,
  eliminarProducto,
  crearFactura,
  cambiarEstadoFactura,
  deshacerPago,
  deshacerUltimo,
  eliminarTarea,
];

const byName = new Map(TOOLS.map((t) => [t.name, t]));

export function findTool(name: string): ToolDef | undefined {
  return byName.get(name);
}

export function toolDefinitions() {
  return TOOLS.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
