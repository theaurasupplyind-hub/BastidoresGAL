/** Contratos del asistente interno. */

export type MemoryCategory = 'correction' | 'preference' | 'context' | 'fact';

export interface MemoryItem {
  id: string;
  category: MemoryCategory;
  content: string;
  at: number;
}

/** Escrituras que el asistente puede deshacer. */
export type UndoKind =
  | 'pago_factura'
  | 'gasto'
  | 'pago_sueldo'
  | 'movimiento_proveedor'
  | 'factura'
  | 'estado_factura'
  | 'cliente_editado'
  | 'proveedor_editado'
  | 'empleado_editado'
  | 'gasto_editado'
  | 'pago_editado'
  | 'producto_creado'
  | 'producto_editado'
  | 'producto_eliminado';

/** Acción de deshacer guardada en el tool call (sobrevive al reinicio). */
export interface UndoAction {
  kind: UndoKind;
  /** Id del registro en el backend (los productos usan id de texto). */
  id: number | string;
  /** Texto corto para el botón: "pago de $35.000 · F-11033". */
  label: string;
  /** Texto para la confirmación y el mensaje: "el pago de $35.000 de Fabricio...". */
  message: string;
  /** Factura a releer para informar el saldo nuevo (pagos de factura). */
  invoiceId?: number;
  /** Datos para restaurar (ej. estados previos de una factura). */
  data?: Record<string, string | number | null>;
  /** Si está seteado, ya se deshizo. */
  doneAt?: number;
}

export interface ToolCallView {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  /** Resumen legible de la acción (ej. "Marcar como hecha: “Llamar a Juan”"). */
  note?: string;
  /** true si la acción quedó pendiente de confirmación (no se ejecutó). */
  pending?: boolean;
  /** Metadata para deshacer (solo escrituras que lo soportan). */
  undo?: UndoAction;
  ms: number;
  effect: 'read' | 'write' | 'destructive';
}

/** Propuesta de escritura: NO se ejecutó todavía. */
export interface Proposal {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  summary: string;
  effect: 'write' | 'destructive';
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'expired';
}

/** Varias acciones que esperan una confirmación conjunta. */
export interface ProposalBatch {
  id: string;
  proposals: Proposal[];
  createdAt: number;
  expiresAt: number;
}

/** Aclaración pendiente para un sí/no (pago parcial o duplicado), sin tarjeta. */
export interface Clarification {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  question: string;
  overrides: Record<string, unknown>;
  createdAt: number;
  expiresAt: number;
}

export interface AssistantAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  width: number;
  height: number;
}

/** Imagen preparada para enviar al modelo (metadata + blob comprimido). */
export interface PendingAttachment {
  attachment: AssistantAttachment;
  blob: Blob;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  at: number;
  toolCalls?: ToolCallView[];
  attachments?: AssistantAttachment[];
  /** true si el mensaje es un aviso de error del asistente. */
  error?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface AssistantSettings {
  apiKey: string;
  model: string;
  temperature: number;
}

/** Pedido que el asistente no pudo resolver del todo: queda como backlog de tools. */
export type GapStatus = 'nuevo' | 'revisado' | 'resuelto' | 'descartado';

export interface GapItem {
  id: string;
  /** Pregunta original del usuario. */
  pregunta: string;
  /** Por qué quedó incompleto (falta de tool, datos, etc.). */
  motivo: string;
  /** Respuesta parcial que se le dio al usuario. */
  respuestaParcial: string;
  /** Datasets leídos con la herramienta genérica. */
  datasets: string[];
  /** Tools que se intentaron usar. */
  tools: string[];
  at: number;
  /** Última modificación (estado, texto). Se usa para mezclar entre estaciones. */
  updatedAt?: number;
  status: GapStatus;
}

/** Factura candidata de un comprobante que todavía no se eligió. */
export interface ComprobanteCandidate {
  invoiceId: number;
  numero: string;
  clienteId: number | null;
  clienteNombre: string;
  saldo: number;
}

/**
 * Comprobante con varias facturas posibles. El runtime guarda las candidatas
 * para que la respuesta del usuario ("Claudia", "F-11041", "la primera") se
 * resuelva contra ellas y no contra toda la base de clientes.
 */
export interface ComprobantePending {
  id: string;
  createdAt: number;
  expiresAt: number;
  metodo: 'Efectivo' | 'Transferencia' | null;
  fecha?: string;
  destino?: { tipo: 'proveedor' | 'empleado'; id: number; nombre: string };
  candidates: ComprobanteCandidate[];
  selected?: ComprobanteCandidate | null;
}

/** Tombstones por id (ms). Evitan que una estación resucite algo borrado en otra. */
export interface AssistantTombstones {
  conversations: Record<string, number>;
  memory: Record<string, number>;
  gaps: Record<string, number>;
}

export interface AssistantState {
  version: 1;
  settings: AssistantSettings;
  conversations: Conversation[];
  activeId: string;
  memory: MemoryItem[];
  pending: ProposalBatch | null;
  clarification: Clarification | null;
  gaps: GapItem[];
  comprobante: ComprobantePending | null;
  deleted?: AssistantTombstones;
}

/** Documento que se sincroniza con el backend (sin datos efímeros ni settings). */
export interface AssistantSyncData {
  version: 1;
  conversations: Conversation[];
  memory: MemoryItem[];
  gaps: GapItem[];
  deleted: AssistantTombstones;
}

/* ---- Formato wire de OpenRouter (compatible OpenAI) ---- */

export interface WireToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface WireTextPart {
  type: 'text';
  text: string;
}

export interface WireImagePart {
  type: 'image_url';
  image_url: { url: string };
}

export type WireContent = string | Array<WireTextPart | WireImagePart>;

export interface WireSystemMessage {
  role: 'system' | 'user' | 'assistant';
  content: WireContent;
  tool_calls?: WireToolCall[];
}

export interface WireToolMessage {
  role: 'tool';
  content: string;
  tool_call_id: string;
}

export type WireMessage = WireSystemMessage | WireToolMessage;
