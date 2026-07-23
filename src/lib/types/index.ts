export interface UserState {
  user_id: number;
  user_name: string;
}

export interface AppConfig {
  theme: string;
  font_size: number;
  hotkey_save: string;
  hotkey_new: string;
  selected_template_name: string;
  selected_template_file: string;
  moldura_template: string;
  selected_printer?: string | null;
  print_agent_enabled?: boolean;
  station_id?: number | null;
  station_api_key?: string | null;
  station_name?: string | null;
}

export interface ClientAddress {
  id: number;
  client_id: number;
  address: string;
  extra: string;
  label: string;
  lat?: number | null;
  lng?: number | null;
  is_default: boolean;
}

export interface Cliente {
  id: number;
  nombre: string;
  domicilio: string;
  telefono: string;
  taller: string;
  estudiante: string;
  lat?: number | null;
  lng?: number | null;
  addresses?: ClientAddress[];
}

export interface Producto {
  id: string;
  descripcion: string;
  precio_unitario: number;
  categoria: string;
  medida: string;
  variante: string;
  stock: number;
}

export interface PrecioReferencia {
  id?: number;
  categoria: string;
  medida: string;
  variante: string;
  precio: number;
}

export interface InvoiceItem {
  cantidad: number;
  descripcion: string;
  precio_unitario: number;
  total: number;
}

export interface FechasEntrega {
  desde: string;
  hasta: string;
  extras: string[];
}

export function defaultFechasEntrega(): FechasEntrega {
  return { desde: '', hasta: '', extras: [] };
}

export function parseFechasEntrega(val: string | undefined | null): FechasEntrega {
  if (!val) return defaultFechasEntrega();
  try {
    const parsed = JSON.parse(val);
    if (parsed && typeof parsed === 'object' && 'desde' in parsed) {
      return {
        desde: parsed.desde || '',
        hasta: parsed.hasta || '',
        extras: Array.isArray(parsed.extras) ? parsed.extras : [],
      };
    }
  } catch {}
  if (val.includes('/')) {
    return { desde: val, hasta: val, extras: [] };
  }
  return defaultFechasEntrega();
}

export function serializeFechasEntrega(fe: FechasEntrega): string {
  if (!fe.desde && !fe.hasta && fe.extras.length === 0) return '';
  return JSON.stringify(fe);
}

export function getEffectiveDates(fe: FechasEntrega): string[] {
  const dates: string[] = [];
  if (fe.desde && fe.hasta) {
    const [dD, mM, yY] = fe.desde.split('/').map(Number);
    const [dH, mH, yH] = fe.hasta.split('/').map(Number);
    const start = new Date(yY, mM - 1, dD);
    const end = new Date(yH, mH - 1, dH);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(`${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`);
    }
  }
  for (const e of fe.extras) {
    if (!dates.includes(e)) dates.push(e);
  }
  return dates;
}

export function hasFechaEntrega(fe: FechasEntrega, date: string): boolean {
  return getEffectiveDates(fe).includes(date);
}

export function formatFechasEntregaDisplay(fe: FechasEntrega): string {
  if (!fe.desde && !fe.hasta) return '';
  let s = '';
  if (fe.desde === fe.hasta) {
    s = fe.desde;
  } else if (fe.desde && fe.hasta) {
    s = `${fe.desde} al ${fe.hasta}`;
  }
  if (fe.extras.length === 1) {
    s += s ? ` · ${fe.extras[0]}` : fe.extras[0];
  } else if (fe.extras.length > 1) {
    s += s ? ` · ${fe.extras.slice(0, 2).join(', ')}` : fe.extras.slice(0, 2).join(', ');
    if (fe.extras.length > 2) s += ` +${fe.extras.length - 2}`;
  }
  return s;
}

export function getDiaSemana(fecha: string): string {
  if (!fecha) return '';
  const dias = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  let d: Date;
  if (fecha.includes('/')) {
    const p = fecha.split('/');
    d = new Date(+p[2], +p[1] - 1, +p[0]);
  } else if (fecha.includes('-')) {
    d = new Date(fecha);
  } else return '';
  return dias[d.getDay()];
}

export function fechaToInput(fecha: string): string {
  if (!fecha) return '';
  const parts = fecha.split('/');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2,'0')}-${parts[0].padStart(2,'0')}`;
  }
  return '';
}

export function inputToFecha(val: string): string {
  if (!val) return '';
  const parts = val.split('-');
  if (parts.length === 3) {
    return `${parseInt(parts[2])}/${parseInt(parts[1])}/${parts[0]}`;
  }
  return '';
}

export function parseFecha(fecha: string): Date {
  if (fecha.includes('/')) {
    const p = fecha.split('/');
    return new Date(+p[2], +p[1] - 1, +p[0]);
  }
  return new Date(fecha);
}

export interface Factura {
  id: number;
  numero_factura: string;
  numero_presupuesto: string;
  fecha: string;
  cliente_id: number | null;
  cliente_nombre: string;
  cliente_domicilio: string;
  cliente_telefono: string;
  items: InvoiceItem[];
  total: number;
  envio: number;
  tipo: string;
  user_id: number;
  tipo_entrega: string;
  fecha_entrega: string;
  estado_entrega: string;
  items_done?: string;
  cliente_piso_depto?: string;
  estado_moldura: string;
  estado_orden_tela: string;
  estado_kanban: string;
}

export interface OnlineUser {
  id: number;
  name: string;
  is_online: boolean;
  activity: string;
}

export interface Pago {
  id: number;
  invoice_id: number;
  amount: number;
  date: string;
  method: string;
  user_id: number;
  username?: string;
  entity_type?: string;
  entity_id?: number;
  created_at?: string;
  updated_at?: string;
}

export interface VoucherReviewCandidate {
  invoice_id: number;
  numero_factura: string;
  saldo_pendiente: number;
  cliente_nombre?: string | null;
  fecha?: string | null;
}

export interface VoucherReview {
  id: number;
  source_message_id?: string | null;
  wa_id: string;
  contact_name?: string | null;
  extracted_monto?: number | null;
  extracted_fecha?: string | null;
  extracted_referencia?: string | null;
  extracted_banco?: string | null;
  extracted_nombre_cliente?: string | null;
  extracted_nombre_origen?: string | null;
  extracted_nombre_destino?: string | null;
  extracted_cbu_destino?: string | null;
  extracted_cuit_destino?: string | null;
  match_status: 'matched' | 'ambiguous' | 'no_match';
  matched_invoice_id?: number | null;
  matched_invoice_numero?: string | null;
  matched_cliente_nombre?: string | null;
  matched_saldo_pendiente?: number | null;
  candidatas: VoucherReviewCandidate[];
  media_mime_type: string;
  media_size_bytes: number;
  review_status: string;
  entity_type?: string | null;
  entity_id?: number | null;
  entity_name?: string | null;
  entity_cuit?: string | null;
  entity_cbu?: string | null;
  entity_match_field?: string | null;
  created_at: string;
}

export interface Kpis {
  v_p: number;
  v_g: number;
  c_p: number;
  c_g: number;
  n_p: number;
  n_g: number;
  d_g: number;
  d_p: number;
}

export interface FichaSemanalRow {
  id: number;
  fecha: string;
  numero: string;
  cliente: string;
  total: number;
  pagado: number;
  saldo: number;
  estado: string;
  estado_entrega: string;
  fecha_entrega: string;
}

export interface Provider {
  id: number;
  name: string;
  cuit: string;
  alias_mp: string;
  alias_cbu: string;
  address: string;
  balance?: number;
  stock_qty?: number;
}

export interface ProviderMovement {
  id: number;
  provider_id: number;
  date: string;
  type: string;
  description: string;
  quantity: number;
  amount: number;
  reference: string;
}

export interface Employee {
  id: number;
  name: string;
  phone: string;
  address: string;
  cuit: string;
  cbu: string;
  alias: string;
  hire_date: string;
  job_type: string;
  payment_freq: string;
  base_salary: number;
  attendance_bonus: number;
  work_days: string;
  active: boolean;
  entry_time?: string;
  exit_time?: string;
  late_threshold?: number;
}

export interface Attendance {
  id: number;
  employee_id: number;
  date: string;
  status: string;
  created_at?: string;
}

export interface AnalisisPeriodo {
  id: number;
  tipo_periodo: string;
  periodo_inicio: string;
  periodo_fin: string;
  facturacion_pesos: number;
  dolar_promedio: number;
  facturacion_usd: number;
  variacion_pct_pesos: number;
  variacion_pct_usd: number;
  etiqueta: string;
  mensaje: string;
}

export interface GrupoCliente {
  id: string;
  nombre: string;
  clienteIds: number[];
  ordenRuta: number[];
  color: string;
}

export interface PlanDeViaje {
  id: string;
  fecha: string;
  grupos: GrupoCliente[];
  created_at: string;
  updated_at: string;
}

export type TabId = 'kanban' | 'facturacion' | 'ficha-semanal' | 'revision-comprobantes' | 'tela' | 'molduras' | 'productos' | 'clientes' | 'estadisticas' | 'gastos' | 'papelera' | 'mapa' | 'analisis-usd' | 'gasto-rapido' | 'caja' | 'print-agent' | 'panel-control';

// ── Reglas de precios ──

export interface ParsedQuery {
  tokens: string[];
  dims: string[];
  base: string;
  grosor: number | null;
}

export interface RuleCondition {
  field: 'grosor' | 'lado_mayor' | 'lado_menor';
  operator: '>' | '<' | '>=' | '<=' | '==';
  value: number;
  adjustmentType: 'percentage' | 'fixed';
  adjustmentValue: number;
}

export interface PricingRule {
  id?: number;
  name: string;
  matchTokens: string[];
  baseCategoria: string;
  baseVariante: string;
  operation: 'direct' | 'percentage' | 'fixed' | 'override';
  operationValue: number;
  conditions: RuleCondition[];
  enabled: boolean;
  rounding: number;
}

export interface ExpenseCategory {
  id: number;
  name: string;
  slug: string;
  color: string;
  icon: string;
  type: string;
  is_default: number;
  created_by: number | null;
  created_at: string;
}

export interface Expense {
  id: number;
  date: string;
  amount: number;
  description: string;
  category_id: number;
  provider_id: number | null;
  employee_id: number | null;
  payment_method: string;
  reference: string | null;
  source: string;
  created_by_user_id: number | null;
  created_by_contact_id: number | null;
  status: string;
  raw_input: string | null;
  media_url: string | null;
  media_id: string | null;
  created_at: string;
  updated_at: string;
}
