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

export interface Cliente {
  id: number;
  nombre: string;
  domicilio: string;
  telefono: string;
  taller: string;
  estudiante: string;
  lat?: number | null;
  lng?: number | null;
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
  estado_moldura: string;
  estado_orden_tela: string;
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
  hire_date: string;
  job_type: string;
  payment_freq: string;
  base_salary: number;
  attendance_bonus: number;
  work_days: string;
  active: boolean;
}

export interface Attendance {
  id: number;
  employee_id: number;
  date: string;
  status: string;
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

export type TabId = 'kanban' | 'facturacion' | 'ficha-semanal' | 'tela' | 'molduras' | 'productos' | 'clientes' | 'estadisticas' | 'gastos' | 'papelera' | 'mapa' | 'analisis-usd' | 'gasto-rapido' | 'caja' | 'print-agent' | 'panel-control';
