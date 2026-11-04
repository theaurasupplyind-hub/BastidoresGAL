import { api } from '$lib/api/client';
import { appStore } from '$lib/stores/appStore.svelte';
import { taskEvents } from '$lib/stores/taskEvents';
import { assistant } from './store.svelte';
import { buildHistory, buildPaymentContextBlock, buildSystemPrompt, detectMemory } from './prompts';
import { blobToDataUrl } from './image';
import { newId } from './storage';
import {
  buildPaymentContext,
  ClarificationError,
  DESTINATION_TEXT_RE,
  detectPaymentMethod,
  findTool,
  hasExplicitAmount,
  normalizeText,
  performUndo,
  resolveDestinoFromText,
  resolveMentionedClientId,
  resolvePaymentClientId,
  resolveRecentClientMention,
  toolDefinitions,
  ToolInputError,
  undoOf,
} from './tools';
import type { PaymentContext } from './tools';
import type {
  AssistantAttachment,
  ChatMessage,
  Clarification,
  ComprobanteCandidate,
  ComprobantePending,
  PendingAttachment,
  Proposal,
  ToolCallView,
  UndoAction,
  WireContent,
  WireMessage,
  WireToolCall,
} from './types';

const MAX_ITERS = 8;
const MAX_ACTIONS = 10;
const PENDING_TTL_MS = 10 * 60 * 1000;
const CLARIFICATION_TTL_MS = 5 * 60 * 1000;
/** Ventana para arrastrar el cliente de un mensaje anterior del usuario dentro del mismo intento de pago. */
const RECENT_CONTEXT_MS = 10 * 60 * 1000;
const NO_IMAGE_RE =
  /no\s+(me\s+)?lleg[oó]|no\s+recib[ií]|no\s+(puedo|pude)\s+ver|no\s+veo|no\s+hay\s+(ninguna\s+)?imagen|adjunt[aá]|reenvi[aá]/i;
const PROPOSAL_EXECUTED_RE =
  /se\s+registr[oó]|qued[oó]\s+registrad|ya\s+(lo\s+)?registr[eé]|listo,\s*registr[eé]|se\s+guard[oó]/i;
/** Preguntas por datos que el runtime ya resolvió (no debería hacerlas). */
const ASKS_PAYMENT_DATA_RE =
  /¿?\s*(?:cu[aá]l(?:es)?\s+(?:de\s+las\s+)?facturas?|a\s+qu[eé]\s+factura|qu[eé]\s+factura|cu[aá]nto\s+(?:pag|abon|cobr|sali|fue|es\s+el\s+monto)|qu[eé]\s+monto|monto\s+(?:del\s+)?pago|me\s+pas[aá]s\s+el\s+monto|cu[aá]l\s+es\s+el\s+saldo)/i;
/** El asistente admite que no pudo resolver todo: se registra como pedido pendiente. */
const CAPABILITY_FAIL_RE =
  /\b(?:no\s+(?:puedo|podr[ií]a|tengo\s+(?:acceso|forma|una\s+(?:tool|herramienta))|dispongo)|no\s+est[aá]\s+(?:implementad[oa]|disponible)|respuesta\s+parcial|solo\s+pude|me\s+falta\s+(?:una\s+)?(?:tool|herramienta|dato))\b/i;
/** Faltante duro de capacidad: se registra aunque no se haya usado leer_datos. */
const HARD_CAPABILITY_RE =
  /\b(?:no\s+(?:tengo\s+una\s+(?:tool|herramienta)|puedo\s+acceder|dispongo)|no\s+est[aá]\s+implementad[oa])\b/i;

interface ModelResult {
  content: string;
  toolCalls: WireToolCall[];
  totalTokens: number;
  latencyMs: number;
}

interface CompletionResponse {
  choices?: Array<{ message?: { content?: string | null; tool_calls?: WireToolCall[] } }>;
  usage?: { total_tokens?: number };
  error?: { message?: string; code?: number | string };
}

function errorText(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'AbortError' || /abort/i.test(err.message)) {
      return 'La consulta tardó demasiado y se canceló. Probá de nuevo.';
    }
    return err.message;
  }
  return String(err);
}

function describeHttpError(status: number, data: CompletionResponse | null, raw: string): string {
  if (status === 401) return 'La API key de OpenRouter no es válida. Revisala en Ajustes.';
  if (status === 402) return 'La cuenta de OpenRouter no tiene crédito suficiente.';
  if (status === 429) return 'OpenRouter está limitando los pedidos. Esperá unos segundos.';
  if (status === 404) return 'El modelo elegido no existe en OpenRouter. Probá con otro.';
  const detail = data?.error?.message || raw.slice(0, 300);
  if (/no endpoints? found.*image|does not support image|image input.*not supported|unsupported.*image|vision.*not supported/i.test(detail)) {
    return 'El modelo elegido no acepta imágenes. Cambiá a google/gemini-2.5-flash en Ajustes.';
  }
  return detail ? `OpenRouter respondió ${status}: ${detail}` : `OpenRouter respondió ${status}.`;
}

async function callModel(messages: WireMessage[], toolChoice: 'auto' | 'none'): Promise<ModelResult> {
  const slowTimer = setTimeout(() => assistant.setSlow(true), 3000);
  const started = performance.now();

  try {
    const res = await api.assistantChatRaw({
      model: assistant.settings.model,
      messages,
      tools: toolDefinitions(),
      tool_choice: toolChoice,
      temperature: assistant.settings.temperature,
      max_tokens: 900,
    });

    const raw = res.raw;
    const data = (res.data ?? null) as CompletionResponse | null;

    if (res.status < 200 || res.status >= 300) {
      // Errores del backend (token, proxy, ruta): traen `detail` legible.
      // Los de OpenRouter traen `error.message`, que describeHttpError entiende.
      if ((data as any)?.detail) {
        throw new Error(String((data as any).detail));
      }
      throw new Error(describeHttpError(res.status, data, raw));
    }

    const message = data?.choices?.[0]?.message;
    if (!message) throw new Error('OpenRouter devolvió una respuesta vacía.');

    return {
      content: typeof message.content === 'string' ? message.content : '',
      toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
      totalTokens: Number(data?.usage?.total_tokens) || 0,
      latencyMs: Math.round(performance.now() - started),
    };
  } finally {
    clearTimeout(slowTimer);
    assistant.setSlow(false);
  }
}

/** El chat guarda una vista recortada de las lecturas genéricas para no inflar localStorage. */
function trimStoredReadResult(name: string, value: unknown): unknown {
  if (name === 'catalogo_datos') {
    const data = value as { datasets?: Array<{ dataset?: unknown }> };
    return { datasets: (data.datasets ?? []).map((item) => item.dataset) };
  }
  if (name !== 'leer_datos') return value;
  const data = value as {
    dataset?: unknown;
    total?: unknown;
    devueltos?: unknown;
    truncado?: unknown;
    filas?: unknown;
    resumen?: unknown;
  };
  return {
    dataset: data.dataset,
    total: data.total,
    devueltos: data.devueltos,
    truncado: data.truncado,
    ...(Array.isArray(data.filas)
      ? { filas: data.filas.slice(0, 3), nota: 'Vista recortada en el chat; el modelo recibió el resultado completo.' }
      : {}),
    ...(Array.isArray(data.resumen) ? { resumen: data.resumen.slice(0, 6) } : {}),
  };
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ToolInputError('Los argumentos de la tool no son JSON válido.');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolInputError('Los argumentos de la tool deben ser un objeto JSON.');
  }
  return value as Record<string, unknown>;
}

function finishTurn(content: string, views: ToolCallView[], proposals: Proposal[]): void {
  assistant.pushMessage('assistant', content.trim() || 'Listo.', {
    toolCalls: views.length > 0 ? views : undefined,
  });
  if (proposals.length > 0) {
    const now = Date.now();
    assistant.setPending({
      id: newId(),
      proposals,
      createdAt: now,
      expiresAt: now + PENDING_TTL_MS,
    });
  }
}

/** Cierre determinístico si el modelo no devuelve texto tras ejecutar escrituras. */
function summarizeWrites(views: ToolCallView[]): string {
  const lines: string[] = [];
  for (const view of views) {
    if (view.effect === 'read' || view.pending) continue;
    if (view.error) {
      lines.push(`Falló ${view.name}: ${view.error}`);
      continue;
    }
    const tool = findTool(view.name);
    const line = tool?.success?.(view.args, view.result) ?? view.note;
    if (line) lines.push(line);
  }
  return lines.join('\n');
}

function proposalsFallback(proposals: Proposal[]): string {
  if (proposals.length === 1) {
    const summary = proposals[0].summary.replace(/\.\s*$/, '');
    return `${summary}. ¿Confirmás?`;
  }
  return `Preparé ${proposals.length} acciones para confirmar:\n${proposals
    .map((p) => `• ${p.summary.replace(/\n+/g, ' · ')}`)
    .join('\n')}`;
}

function fallbackText(views: ToolCallView[], proposals: Proposal[], lastContent: string): string {
  const parts: string[] = [];
  const auto = summarizeWrites(views);
  if (auto) parts.push(auto);
  if (proposals.length > 0) parts.push(proposalsFallback(proposals));
  if (parts.length === 0) parts.push(lastContent || 'No pude completar la consulta.');
  return parts.join('\n\n');
}

/**
 * Si el cierre del turno admite una respuesta parcial, guarda el pedido como
 * pendiente aunque el modelo no haya llamado a registrar_pedido_no_cumplido.
 */
function maybeRegisterGap(
  question: string,
  text: string,
  usedReadData: boolean,
  readDatasets: Set<string>,
  views: ToolCallView[],
  gapRegistered: boolean,
): void {
  if (gapRegistered || !CAPABILITY_FAIL_RE.test(text)) return;
  if (!usedReadData && !HARD_CAPABILITY_RE.test(text)) return;
  assistant.addGap({
    pregunta: question.trim() || 'Consulta con comprobante',
    motivo: usedReadData
      ? 'Respuesta parcial con lectura genérica (leer_datos)'
      : 'El asistente no pudo completar el pedido',
    respuestaParcial: text.slice(0, 2000),
    datasets: [...readDatasets],
    tools: [...new Set(views.map((view) => view.name))].slice(0, 12),
  });
}

/** Registra los clientes que resolvió una lectura de pago en el turno. */
function collectPaymentLookup(name: string, value: unknown, clientIds: Set<number>): boolean {
  if (name === 'buscar_clientes') {
    const data = value as { clientes?: Array<{ id?: number }> };
    for (const cliente of data.clientes ?? []) {
      if (typeof cliente.id === 'number') clientIds.add(cliente.id);
    }
    return true;
  }

  if (name === 'consultar_facturas') {
    const data = value as { facturas?: Array<{ cliente_id?: number | null }> };
    for (const factura of data.facturas ?? []) {
      if (typeof factura.cliente_id === 'number') clientIds.add(factura.cliente_id);
    }
    return true;
  }

  if (name === 'consultar_deudas_cliente') {
    const data = value as { cliente?: { id?: number } };
    if (typeof data.cliente?.id === 'number') clientIds.add(data.cliente.id);
    return true;
  }

  if (name === 'analizar_comprobante') {
    const data = value as {
      cliente_resuelto?: { id?: number } | null;
      clientes?: Array<{ id?: number }>;
      facturas_exactas?: Array<{ cliente_id?: number | null }>;
      facturas_cliente?: Array<{ cliente_id?: number | null }>;
      facturas_cercanas?: Array<{ cliente_id?: number | null }>;
      combinaciones?: Array<{ facturas?: Array<{ cliente_id?: number | null }> }>;
    };
    if (typeof data.cliente_resuelto?.id === 'number') clientIds.add(data.cliente_resuelto.id);
    for (const cliente of data.clientes ?? []) {
      if (typeof cliente.id === 'number') clientIds.add(cliente.id);
    }
    const facturas = [
      ...(data.facturas_exactas ?? []),
      ...(data.facturas_cliente ?? []),
      ...(data.facturas_cercanas ?? []),
      ...(data.combinaciones ?? []).flatMap((combo) => combo.facturas ?? []),
    ];
    for (const factura of facturas) {
      if (typeof factura.cliente_id === 'number') clientIds.add(factura.cliente_id);
    }
    return true;
  }

  return false;
}

/** Textos de los últimos mensajes del usuario dentro de la ventana de contexto. */
function recentUserTexts(messages: ChatMessage[], limit = 3): string[] {
  const now = Date.now();
  return messages
    .filter((m) => m.role === 'user' && !m.error && m.content.trim() && now - m.at <= RECENT_CONTEXT_MS)
    .slice(-limit)
    .reverse()
    .map((m) => m.content.trim());
}

/** Recordatorio con los datos ya resueltos: el modelo no debe volver a preguntarlos. */
function paymentDataNudge(ctx: PaymentContext, method?: 'Efectivo' | 'Transferencia'): string {
  if (ctx.invoices.length === 0) {
    return `${ctx.clientName} no tiene facturas pendientes. No registres ningún pago: decile que no debe nada y no pidas monto ni factura.`;
  }
  if (ctx.invoices.length === 1) {
    const factura = ctx.invoices[0];
    const faltaMetodo = method ? '' : ' Si falta el método, preguntá solo el método.';
    return `Los datos ya están resueltos: ${ctx.clientName} tiene una sola factura pendiente, ${factura.numero} (id ${factura.id}), con saldo de ${factura.saldo}. No preguntes cuál factura ni el monto.${faltaMetodo} Llamá ahora a registrar_pago_factura con factura_id=${factura.id} y monto=${factura.saldo}.`;
  }
  return `Los datos ya están resueltos: ${ctx.clientName} tiene ${ctx.invoices.length} facturas pendientes. No vuelvas a pedir el cliente. Si el monto coincide exacto con una factura o combinación, ejecutá; si no, preguntá cuál.`;
}

/** Pago inequívoco ejecutado por el runtime cuando el modelo insiste en preguntar en vez de ejecutar. */
async function runPaymentFallback(
  ctx: PaymentContext,
  method: 'Efectivo',
  views: ToolCallView[],
): Promise<string | null> {
  const factura = ctx.invoices[0];
  const tool = findTool('registrar_pago_factura');
  if (!tool?.prepare || !tool.success) return null;

  const started = performance.now();
  let args: Record<string, unknown> = { factura_id: factura.id, monto: factura.saldo, metodo: method };
  try {
    const prepared = await tool.prepare(tool.validate(args));
    args = prepared.args;
    const result = await tool.run(args);
    const undo = tool.undo?.(args, result);
    views.push({
      id: newId(),
      name: tool.name,
      args,
      result,
      note: prepared.summary,
      ...(undo ? { undo } : {}),
      ms: Math.round(performance.now() - started),
      effect: tool.effect,
    });
    return tool.success(args, result);
  } catch (err) {
    if (err instanceof ClarificationError) {
      if (!assistant.pending) {
        assistant.setClarification({
          id: newId(),
          tool: tool.name,
          args: err.args,
          question: err.question,
          overrides: err.overrides,
          createdAt: Date.now(),
          expiresAt: Date.now() + CLARIFICATION_TTL_MS,
        });
      }
      views.push({
        id: newId(),
        name: tool.name,
        args: err.args,
        note: err.question,
        result: { needs_confirmation: true },
        pending: true,
        ms: Math.round(performance.now() - started),
        effect: tool.effect,
      });
      return err.question;
    }
    const message = err instanceof Error ? err.message : String(err);
    views.push({
      id: newId(),
      name: tool.name,
      args,
      note: message,
      error: message,
      ms: Math.round(performance.now() - started),
      effect: tool.effect,
    });
    return message;
  }
}

interface ComprobantePlan {
  clientId: number;
  clientName: string;
  metodo: 'Efectivo' | 'Transferencia';
  fecha?: string;
  destino?: { tipo: 'proveedor' | 'empleado'; id: number; nombre: string };
  invoices: Array<{ id: number; numero: string; saldo: number }>;
}

/**
 * Datos listos para registrar un cobro detectado en un comprobante. Solo se arma
 * cuando el análisis ya resolvió todo: una única combinación del mismo cliente,
 * sin duplicado ni aclaración, con método y (si es transferencia) destino único.
 */
function buildComprobantePlan(value: unknown): ComprobantePlan | null {
  const data = value as {
    tipo?: string;
    fecha?: string | null;
    cliente_resuelto?: { id?: number; nombre?: string } | null;
    requiere_aclaracion?: string | null;
    posible_duplicado?: boolean;
    combinaciones?: Array<{
      facturas?: Array<{ id?: number; numero?: string; saldo?: number; cliente_id?: number | null }>;
    }>;
    destino_probable?: { tipo?: string; id?: number; nombre?: string } | null;
    metodo_sugerido?: string | null;
  };

  if (data.tipo !== 'cobro') return null;
  if (data.requiere_aclaracion != null) return null;
  if (data.posible_duplicado === true) return null;

  const cliente = data.cliente_resuelto;
  if (!cliente || typeof cliente.id !== 'number') return null;

  const combos = data.combinaciones ?? [];
  if (combos.length !== 1) return null;
  const facturas = combos[0].facturas ?? [];
  if (facturas.length === 0) return null;

  const invoices: ComprobantePlan['invoices'] = [];
  for (const factura of facturas) {
    if (
      typeof factura.id !== 'number' ||
      typeof factura.saldo !== 'number' ||
      factura.saldo <= 0 ||
      factura.cliente_id !== cliente.id
    ) {
      return null;
    }
    invoices.push({
      id: factura.id,
      numero: String(factura.numero ?? ''),
      saldo: Math.round(factura.saldo * 100) / 100,
    });
  }

  const metodo =
    data.metodo_sugerido === 'Efectivo' || data.metodo_sugerido === 'Transferencia'
      ? data.metodo_sugerido
      : null;
  if (!metodo) return null;

  let destino: ComprobantePlan['destino'];
  if (metodo === 'Transferencia') {
    const candidate = data.destino_probable;
    if (
      !candidate ||
      (candidate.tipo !== 'proveedor' && candidate.tipo !== 'empleado') ||
      typeof candidate.id !== 'number'
    ) {
      return null;
    }
    destino = { tipo: candidate.tipo, id: candidate.id, nombre: String(candidate.nombre ?? '') };
  }

  return {
    clientId: cliente.id,
    clientName: String(cliente.nombre ?? ''),
    metodo,
    fecha: typeof data.fecha === 'string' && data.fecha ? data.fecha : undefined,
    destino,
    invoices,
  };
}

function comprobanteNudge(plan: ComprobantePlan | null): string {
  if (!plan) {
    return 'El análisis encontró una coincidencia exacta. Llamá a registrar_pago_factura para cada factura de la combinación. No pidas permiso para preparar la propuesta.';
  }
  const facturas = plan.invoices
    .map((invoice) => `${invoice.numero} (id ${invoice.id}) por ${invoice.saldo}`)
    .join(', ');
  const destino = plan.destino
    ? ` · destino ${plan.destino.tipo} ${plan.destino.nombre} (id ${plan.destino.id})`
    : '';
  const fecha = plan.fecha ? ` · fecha ${plan.fecha}` : '';
  const objetivo = plan.invoices.length === 1 ? 'esa factura' : 'cada factura';
  return `El comprobante ya está analizado: ${plan.clientName} · ${facturas} · método ${plan.metodo}${fecha}${destino}. Llamá ahora a registrar_pago_factura para ${objetivo} con esos datos. No pidas confirmación, no preguntes el cliente ni el monto.`;
}

/** Ejecuta el cobro del comprobante sin esperar otra confirmación. */
async function runComprobanteFallback(
  plan: ComprobantePlan,
  views: ToolCallView[],
): Promise<string | null> {
  const tool = findTool('registrar_pago_factura');
  if (!tool?.prepare || !tool.success) return null;

  const started = performance.now();
  const preparados: Array<{ args: Record<string, unknown>; summary: string }> = [];

  // Primero valida todas: si alguna pide aclaración (duplicado/parcial) no se ejecuta nada.
  for (const invoice of plan.invoices) {
    const raw: Record<string, unknown> = {
      factura_id: invoice.id,
      monto: invoice.saldo,
      metodo: plan.metodo,
      ...(plan.fecha ? { fecha: plan.fecha } : {}),
      ...(plan.metodo === 'Transferencia' && plan.destino
        ? { destino_tipo: plan.destino.tipo, destino_id: plan.destino.id, destino: plan.destino.nombre }
        : {}),
    };
    try {
      const prepared = await tool.prepare(tool.validate(raw));
      preparados.push({ args: prepared.args, summary: prepared.summary });
    } catch (err) {
      if (err instanceof ClarificationError) {
        if (!assistant.pending) {
          assistant.setClarification({
            id: newId(),
            tool: tool.name,
            args: err.args,
            question: err.question,
            overrides: err.overrides,
            createdAt: Date.now(),
            expiresAt: Date.now() + CLARIFICATION_TTL_MS,
          });
        }
        views.push({
          id: newId(),
          name: tool.name,
          args: err.args,
          note: err.question,
          result: { needs_confirmation: true },
          pending: true,
          ms: Math.round(performance.now() - started),
          effect: tool.effect,
        });
        return err.question;
      }
      const message = err instanceof Error ? err.message : String(err);
      views.push({
        id: newId(),
        name: tool.name,
        args: raw,
        note: message,
        error: message,
        ms: Math.round(performance.now() - started),
        effect: tool.effect,
      });
      return message;
    }
  }

  const lines: string[] = [];
  for (const item of preparados) {
    try {
      const result = await tool.run(item.args);
      const undo = tool.undo?.(item.args, result);
      views.push({
        id: newId(),
        name: tool.name,
        args: item.args,
        result,
        note: item.summary,
        ...(undo ? { undo } : {}),
        ms: Math.round(performance.now() - started),
        effect: tool.effect,
      });
      const line = tool.success(item.args, result);
      if (line) lines.push(line);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      views.push({
        id: newId(),
        name: tool.name,
        args: item.args,
        note: message,
        error: message,
        ms: Math.round(performance.now() - started),
        effect: tool.effect,
      });
      return message;
    }
  }

  return lines.join('\n') || null;
}

/* ------------------------------------------------------------------ */
/* Comprobante pendiente: elegir factura y destino sin depender del LLM */
/* ------------------------------------------------------------------ */

function buildComprobantePending(value: unknown): ComprobantePending | null {
  const data = value as {
    tipo?: string;
    fecha?: string | null;
    facturas_exactas?: Array<{
      id?: number;
      numero?: string;
      cliente_id?: number | null;
      cliente?: string;
      saldo?: number;
    }>;
    combinaciones?: Array<{
      facturas?: Array<{
        id?: number;
        numero?: string;
        cliente_id?: number | null;
        cliente?: string;
        saldo?: number;
      }>;
    }>;
    destino_probable?: { tipo?: string; id?: number; nombre?: string } | null;
    metodo_sugerido?: string | null;
  };

  if (data.tipo !== 'cobro') return null;

  const source: Array<{
    id?: number;
    numero?: string;
    cliente_id?: number | null;
    cliente?: string;
    saldo?: number;
  }> = [];
  const exactas = Array.isArray(data.facturas_exactas) ? data.facturas_exactas : [];
  if (exactas.length >= 2) {
    source.push(...exactas);
  } else if (Array.isArray(data.combinaciones)) {
    for (const combo of data.combinaciones) {
      const facturas = Array.isArray(combo.facturas) ? combo.facturas : [];
      if (facturas.length === 1) source.push(facturas[0]);
    }
  }
  if (source.length < 2) return null;

  const seen = new Set<number>();
  const candidates: ComprobanteCandidate[] = [];
  for (const factura of source) {
    if (typeof factura.id !== 'number' || factura.id <= 0 || seen.has(factura.id)) continue;
    const saldo = typeof factura.saldo === 'number' ? factura.saldo : 0;
    if (saldo <= 0) continue;
    seen.add(factura.id);
    candidates.push({
      invoiceId: factura.id,
      numero: typeof factura.numero === 'string' ? factura.numero : `#${factura.id}`,
      clienteId: typeof factura.cliente_id === 'number' ? factura.cliente_id : null,
      clienteNombre: typeof factura.cliente === 'string' ? factura.cliente : '',
      saldo: Math.round(saldo * 100) / 100,
    });
  }
  if (candidates.length < 2) return null;

  const metodo =
    data.metodo_sugerido === 'Efectivo' || data.metodo_sugerido === 'Transferencia'
      ? data.metodo_sugerido
      : null;
  const destinoRaw = data.destino_probable;
  const destino: ComprobantePending['destino'] =
    destinoRaw &&
    (destinoRaw.tipo === 'proveedor' || destinoRaw.tipo === 'empleado') &&
    typeof destinoRaw.id === 'number'
      ? {
          tipo: destinoRaw.tipo as 'proveedor' | 'empleado',
          id: destinoRaw.id,
          nombre: String(destinoRaw.nombre ?? ''),
        }
      : undefined;

  return {
    id: newId(),
    createdAt: Date.now(),
    expiresAt: Date.now() + PENDING_TTL_MS,
    metodo,
    ...(typeof data.fecha === 'string' && data.fecha ? { fecha: data.fecha } : {}),
    ...(destino ? { destino } : {}),
    candidates,
  };
}

const ORDINAL_INDEX: Record<string, number> = {
  primera: 0, primero: 0, '1': 0,
  segunda: 1, segundo: 1, '2': 1,
  tercera: 2, tercero: 2, '3': 2,
  cuarta: 3, cuarto: 3, '4': 3,
};

/** Matchea la respuesta del usuario contra las facturas candidatas del comprobante. */
function selectComprobanteCandidate(
  candidates: ComprobanteCandidate[],
  text: string,
): ComprobanteCandidate | null {
  const raw = normalizeText(text);
  if (!raw.trim()) return null;
  const clean = raw
    .replace(/\b(?:la|el|las|los|de|del|factura|pago|pagar|es|esa|ese|numero|número|cliente|del|corresponde)\b/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const rawDigits = raw.replace(/\D/g, '');
  const tokens = clean.split(/\s+/).filter((token) => token.length >= 3);
  const ordinal = ORDINAL_INDEX[clean];

  const scored = candidates
    .map((candidate, index) => {
      const numero = normalizeText(candidate.numero).replace(/\s+/g, '');
      const numeroDigits = numero.replace(/\D/g, '');
      const nombre = normalizeText(candidate.clienteNombre);
      let score = 0;

      if (numero && raw.includes(numero)) score = 100;
      if (rawDigits && numeroDigits && rawDigits === numeroDigits) score = Math.max(score, 100);
      if (rawDigits && String(candidate.invoiceId) === rawDigits) score = Math.max(score, 100);
      if (tokens.length > 0 && tokens.every((token) => nombre.includes(token))) {
        score = Math.max(score, 80 + Math.min(10, tokens.length * 2));
      }
      if (ordinal === index) score = Math.max(score, 90);
      return { candidate, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0].candidate;
}

async function executeComprobanteSelection(
  pending: ComprobantePending,
  selected: ComprobanteCandidate,
  destino: ComprobantePending['destino'],
): Promise<void> {
  const metodo = pending.metodo;
  if (!metodo) {
    assistant.pushMessage('assistant', `Elegí ${selected.numero} de ${selected.clienteNombre}. ¿El pago fue en efectivo o transferencia?`);
    assistant.setComprobante({ ...pending, selected });
    return;
  }
  if (metodo === 'Transferencia' && !destino) {
    assistant.pushMessage('assistant', `Elegí ${selected.numero} de ${selected.clienteNombre}. ¿A qué proveedor o empleado se destinaron los fondos?`);
    assistant.setComprobante({ ...pending, selected });
    return;
  }

  const plan: ComprobantePlan = {
    clientId: selected.clienteId ?? 0,
    clientName: selected.clienteNombre,
    metodo,
    fecha: pending.fecha,
    destino,
    invoices: [{ id: selected.invoiceId, numero: selected.numero, saldo: selected.saldo }],
  };

  assistant.clearComprobante();
  assistant.setBusy(true);
  assistant.setError(null);
  try {
    const views: ToolCallView[] = [];
    const text = await runComprobanteFallback(plan, views);
    assistant.pushMessage('assistant', text ?? 'No pude registrar el pago.', {
      toolCalls: views,
      error: views.some((view) => Boolean(view.error)),
    });
  } finally {
    assistant.setBusy(false);
  }
}

/** Devuelve true si consumió el turno (eligió factura, pidió destino o registró). */
async function handleComprobanteReply(
  text: string,
  pending: ComprobantePending,
  meta: AssistantAttachment[] | undefined,
): Promise<boolean> {
  // Si es una pregunta o un pedido largo, no es la respuesta al comprobante.
  if (
    text.length > 90 ||
    /[?¿]/.test(text) ||
    /\b(?:cu[aá]nto|debe|deuda|saldo|qui[eé]n|resumen|list[aá]|mostr[aá]|busc[aá])\b/i.test(text)
  ) {
    return false;
  }
  const intent = normalizeText(text);
  if (CANCEL_RE.test(intent) && text.length < 12) {
    assistant.pushMessage('user', text, { attachments: meta });
    assistant.clearComprobante();
    assistant.pushMessage('assistant', 'Listo, no registré nada.');
    return true;
  }

  // Primero: si nombra otra factura candidata, cambia la selección.
  const selection = selectComprobanteCandidate(pending.candidates, text);
  if (selection) {
    assistant.pushMessage('user', text, { attachments: meta });
    const metodo = pending.metodo ?? detectPaymentMethod(text);
    if (!metodo) {
      assistant.setComprobante({ ...pending, selected: selection });
      assistant.pushMessage('assistant', `Elegí ${selection.numero} de ${selection.clienteNombre}. ¿El pago fue en efectivo o transferencia?`);
      return true;
    }
    if (metodo === 'Transferencia' && !pending.destino) {
      assistant.setComprobante({ ...pending, metodo, selected: selection });
      assistant.pushMessage('assistant', `Elegí ${selection.numero} de ${selection.clienteNombre}. ¿A qué proveedor o empleado se destinaron los fondos?`);
      return true;
    }
    await executeComprobanteSelection({ ...pending, metodo }, selection, pending.destino);
    return true;
  }

  // Después: si ya hay factura elegida y falta el destino, la respuesta es el destino.
  if (pending.selected) {
    if (!pending.metodo) {
      const method = detectPaymentMethod(text);
      if (method) {
        assistant.pushMessage('user', text, { attachments: meta });
        await executeComprobanteSelection({ ...pending, metodo: method }, pending.selected, pending.destino);
        return true;
      }
    }
    const lookup = await resolveDestinoFromText(text);
    if (lookup && lookup.ok) {
      assistant.pushMessage('user', text, { attachments: meta });
      await executeComprobanteSelection(pending, pending.selected, lookup.destino);
      return true;
    }
    if (lookup && !lookup.ok) {
      assistant.pushMessage('user', text, { attachments: meta });
      const opciones = lookup.candidatos
        .map((destino) => `${destino.tipo} ${destino.nombre}`)
        .join(', ');
      assistant.pushMessage('assistant', `Hay varios destinos que coinciden: ${opciones}. ¿Cuál?`);
      return true;
    }
    if (text.trim()) {
      assistant.pushMessage('user', text, { attachments: meta });
      assistant.pushMessage('assistant', `No encontré el destino “${text}” para ${pending.selected.numero}. Decime el nombre del empleado o proveedor.`);
      return true;
    }
  }

  return false;
}

/**
 * El runtime solo ejecuta por su cuenta cuando el caso es inequívoco:
 * una sola factura, método efectivo explícito y sin monto (si dio monto puede ser parcial).
 */
function canAutoPay(
  ctx: PaymentContext | null,
  method: 'Efectivo' | 'Transferencia' | undefined,
  text: string,
): ctx is PaymentContext {
  return ctx !== null && ctx.invoices.length === 1 && method === 'Efectivo' && !hasExplicitAmount(text);
}

/** Último cambio ejecutado por el asistente en la conversación que se puede deshacer. */
function lastUndoableAction(views: ToolCallView[]): UndoAction | null {
  const ordered: ToolCallView[] = [...views].reverse();
  for (let i = assistant.messages.length - 1; i >= 0; i--) {
    const calls = assistant.messages[i].toolCalls ?? [];
    for (let j = calls.length - 1; j >= 0; j--) ordered.push(calls[j]);
  }
  const call = ordered.find((entry) => entry.effect !== 'read' && !entry.pending && !entry.error);
  return call ? undoOf(call) : null;
}

async function runLoop(userText: string, attachments: PendingAttachment[]): Promise<void> {
  const intentText = normalizeText(userText);
  const isPaymentIntent =
    attachments.length === 0 && userText
      ? PAYMENT_INTENT_RE.test(intentText) &&
        !UNDO_INTENT_RE.test(intentText) &&
        !/^\s*(¿|cu[aá]nto|saldo|deuda|qui[eé]n|cu[aá]les)/i.test(intentText)
      : false;
  // "el empleado es Tobi" / "a Textil Muñoz" hablan del destino, no de un cliente nuevo.
  const mentionsDestination = DESTINATION_TEXT_RE.test(intentText);
  const expectedClientId =
    attachments.length === 0 && userText && isPaymentIntent && !mentionsDestination
      ? await resolveMentionedClientId(userText)
      : null;
  const earlierMessages = assistant.messages.slice(0, -1);
  const previousUserTexts = attachments.length === 0 ? recentUserTexts(earlierMessages) : [];
  const previousPaymentText =
    previousUserTexts.find((text) => {
      const clean = normalizeText(text);
      return PAYMENT_INTENT_RE.test(clean) && !UNDO_INTENT_RE.test(clean);
    }) ?? null;
  // Un turno que sigue a un intento de pago reciente ("es 35mil") hereda el cliente para los guards.
  const followsPaymentIntent =
    isPaymentIntent ||
    (!UNDO_INTENT_RE.test(intentText) && previousPaymentText !== null && hasExplicitAmount(userText));

  let paymentContext: PaymentContext | null = null;
  if (attachments.length === 0 && followsPaymentIntent && !mentionsDestination) {
    const clientId =
      expectedClientId ??
      (await resolvePaymentClientId(userText)) ??
      (await resolveRecentClientMention(previousUserTexts));
    if (clientId !== null) {
      paymentContext = await buildPaymentContext(clientId, expectedClientId !== null ? 'turno' : 'reciente');
    }
  }
  const guardClientId = expectedClientId ?? paymentContext?.clientId ?? null;
  const paymentMethod = detectPaymentMethod(userText) ?? detectPaymentMethod(previousPaymentText);

  const history = buildHistory(earlierMessages);
  const imageParts = await Promise.all(
    attachments.map(async ({ blob }) => ({
      type: 'image_url' as const,
      image_url: { url: await blobToDataUrl(blob) },
    })),
  );
  const userContent: WireContent =
    attachments.length === 0
      ? userText
      : [
          ...(userText ? [{ type: 'text' as const, text: userText }] : []),
          ...imageParts,
        ];
  const wire: WireMessage[] = [
    {
      role: 'system',
      content:
        buildSystemPrompt(assistant.memory, appStore.user?.user_name) +
        (paymentContext ? buildPaymentContextBlock(paymentContext, paymentMethod) : ''),
    },
    ...history,
    { role: 'user', content: userContent },
  ];

  const views: ToolCallView[] = [];
  const proposals: Proposal[] = [];
  const writeSignatures = new Set<string>();
  const turnClientIds = new Set<number>();
  if (paymentContext) turnClientIds.add(paymentContext.clientId);
  let didPaymentLookup = paymentContext !== null;
  let lastContent = '';
  let lastModelMs = 0;
  let lastTokens = 0;
  let actionCount = 0;
  let didTaskWrite = false;
  let imageNudged = false;
  let comprobanteListo = false;
  let comprobantePlan: ComprobantePlan | null = null;
  let comprobanteFallbackDone = false;
  let proposalNudged = false;
  let paymentNudged = false;
  let paymentContextNudged = false;
  let paymentFallbackDone = false;
  let lookupNudgeCount = 0;
  let lookupNudgePending = false;
  let usedReadData = false;
  const readDatasets = new Set<string>();
  let gapRegistered = false;

  try {
    for (let iter = 0; iter < MAX_ITERS; iter++) {
      const result = await callModel(wire, 'auto');
      lastModelMs = result.latencyMs;
      lastTokens += result.totalTokens;
      if (result.content.trim()) lastContent = result.content.trim();

      if (result.toolCalls.length === 0) {
        const pagoComprobanteEjecutado = views.some(
          (view) => view.name === 'registrar_pago_factura' && !view.error && !view.pending,
        );
        if (comprobanteListo && proposals.length === 0 && !proposalNudged && !pagoComprobanteEjecutado) {
          proposalNudged = true;
          wire.push({ role: 'assistant', content: result.content ?? '' });
          wire.push({ role: 'user', content: comprobanteNudge(comprobantePlan) });
          continue;
        }
        if (
          comprobantePlan !== null &&
          proposalNudged &&
          !comprobanteFallbackDone &&
          proposals.length === 0 &&
          !assistant.clarification &&
          views.every((view) => view.effect === 'read')
        ) {
          comprobanteFallbackDone = true;
          const fallback = await runComprobanteFallback(comprobantePlan, views);
          if (fallback) {
            assistant.setLastRun({ model: assistant.settings.model, ms: lastModelMs, tokens: lastTokens });
            finishTurn(fallback, views, []);
            return;
          }
        }
        if (attachments.length > 0 && !imageNudged && views.length === 0 && proposals.length === 0) {
          imageNudged = true;
          wire.push({ role: 'assistant', content: result.content ?? '' });
          wire.push({
            role: 'user',
            content:
              'El mensaje incluye un comprobante. Analizalo con analizar_comprobante (el caption puede estar vacío o ser de un reenvío; priorizá la imagen) y, si hay una acción clara, proponela. No pidas permiso ni digas que no llegó la imagen.',
          });
          continue;
        }
        if (
          paymentContext &&
          !paymentContextNudged &&
          views.length === 0 &&
          proposals.length === 0 &&
          ASKS_PAYMENT_DATA_RE.test(normalizeText(result.content))
        ) {
          paymentContextNudged = true;
          wire.push({ role: 'assistant', content: result.content ?? '' });
          wire.push({ role: 'user', content: paymentDataNudge(paymentContext, paymentMethod) });
          continue;
        }
        const executedWrite = views.some((view) => view.effect !== 'read' && !view.error);
        if (
          !paymentFallbackDone &&
          paymentMethod === 'Efectivo' &&
          canAutoPay(paymentContext, paymentMethod, userText) &&
          !executedWrite &&
          proposals.length === 0 &&
          !assistant.clarification
        ) {
          paymentFallbackDone = true;
          const fallback = await runPaymentFallback(paymentContext, paymentMethod, views);
          if (fallback) {
            assistant.setLastRun({ model: assistant.settings.model, ms: lastModelMs, tokens: lastTokens });
            finishTurn(fallback, views, []);
            return;
          }
        }
        if (
          followsPaymentIntent &&
          didPaymentLookup &&
          proposals.length === 0 &&
          !executedWrite &&
          !paymentNudged &&
          CONFIRM_QUESTION_RE.test(normalizeText(result.content))
        ) {
          paymentNudged = true;
          wire.push({ role: 'assistant', content: result.content ?? '' });
          wire.push({
            role: 'user',
            content:
              'No pidas confirmación por texto. Ejecutá registrar_pago_factura ahora con la factura y el monto; si hay ambigüedad, preguntá. Cuando el cliente y el monto son inequívocos, se registra directo.',
          });
          continue;
        }
        let text = result.content.trim();
        if (proposals.length > 0 && !text) {
          try {
            const closing = await callModel(
              wire.concat([
                {
                  role: 'user',
                  content: `Escribí en una o dos frases qué ${proposals.length} acciones quedaron pendientes de confirmar y que el usuario puede confirmarlas juntas. No vuelvas a llamar tools.`,
                },
              ]),
              'none',
            );
            lastModelMs += closing.latencyMs;
            lastTokens += closing.totalTokens;
            text = closing.content.trim();
          } catch {
            text = '';
          }
        }
        if (!text) text = fallbackText(views, proposals, lastContent);
        if (NO_IMAGE_RE.test(text)) {
          if (proposals.length > 0) {
            text = proposalsFallback(proposals);
          } else if (assistant.clarification) {
            text = assistant.clarification.question;
          } else {
            const summary = summarizeWrites(views);
            if (summary) text = summary;
          }
        }
        if (proposals.length > 0 && PROPOSAL_EXECUTED_RE.test(text)) {
          text = proposalsFallback(proposals);
        }
        if (assistant.clarification && PROPOSAL_EXECUTED_RE.test(text)) {
          text = assistant.clarification.question;
        }
        assistant.setLastRun({ model: assistant.settings.model, ms: lastModelMs, tokens: lastTokens });
        maybeRegisterGap(userText, text, usedReadData, readDatasets, views, gapRegistered);
        finishTurn(text, views, proposals);
        return;
      }

      const calls = result.toolCalls.map((call) => ({ ...call, id: call.id || newId() }));
      wire.push({
        role: 'assistant',
        content: result.content ?? '',
        tool_calls: calls,
      });

      for (const call of calls) {
        const started = performance.now();
        const name = call.function?.name ?? 'desconocida';
        const tool = findTool(name);
        let args: Record<string, unknown> = {};
        let note: string | undefined;
        let content: string;

        try {
          if (!tool) throw new ToolInputError(`No existe la tool "${name}".`);
          args = tool.validate(parseArgs(call.function?.arguments));

          if (tool.effect === 'read') {
            const value = await tool.run(args);
            if (collectPaymentLookup(name, value, turnClientIds)) didPaymentLookup = true;
            if (name === 'leer_datos') {
              usedReadData = true;
              if (typeof args.dataset === 'string') readDatasets.add(args.dataset);
              if (args.dataset === 'clientes' || args.dataset === 'facturas') {
                didPaymentLookup = true;
                const data = value as { filas?: Array<Record<string, unknown>> };
                for (const row of data.filas ?? []) {
                  if (args.dataset === 'clientes' && typeof row.id === 'number') {
                    turnClientIds.add(row.id);
                  }
                  if (typeof row.cliente_id === 'number') turnClientIds.add(row.cliente_id);
                }
              }
            }
            content = JSON.stringify(value);
            views.push({
              id: call.id,
              name,
              args,
              result: trimStoredReadResult(name, value),
              ms: Math.round(performance.now() - started),
              effect: 'read',
            });

            if (name === 'analizar_comprobante') {
              const analysis = value as {
                requiere_aclaracion?: string | null;
                combinaciones?: unknown[];
                posible_duplicado?: boolean;
              };
              if (
                analysis.posible_duplicado !== true &&
                analysis.requiere_aclaracion == null &&
                Array.isArray(analysis.combinaciones) &&
                analysis.combinaciones.length > 0
              ) {
                comprobanteListo = true;
              }
              comprobantePlan = buildComprobantePlan(value);
              const comprobantePendiente = buildComprobantePending(value);
              if (comprobantePendiente && !comprobantePlan) {
                assistant.setComprobante(comprobantePendiente);
              } else {
                assistant.clearComprobante();
              }
            }
          } else {
            if (actionCount >= MAX_ACTIONS) {
              throw new ToolInputError(`Límite de ${MAX_ACTIONS} acciones por turno. Pedí el resto en otro mensaje.`);
            }
            if (!tool.prepare) throw new ToolInputError(`La tool "${name}" no está disponible.`);

            if (name === 'registrar_pago_factura' && !didPaymentLookup) {
              throw new ToolInputError(
                'Antes de proponer un pago, buscá el cliente y sus facturas en este turno con buscar_clientes y consultar_facturas. No reutilices facturas de pagos anteriores.',
                'payment_lookup_required',
              );
            }

            if (
              name === 'registrar_pago_factura' &&
              assistant.rawComprobante &&
              !assistant.rawComprobante.selected
            ) {
              throw new ToolInputError(
                'El comprobante tiene varias facturas candidatas. Preguntá al usuario cuál antes de registrar; no elijas una por tu cuenta.',
                'payment_choice_required',
              );
            }

            if (
              name === 'registrar_pago_factura' &&
              guardClientId !== null &&
              !turnClientIds.has(guardClientId)
            ) {
              throw new ToolInputError(
                'El cliente que nombró el usuario todavía no está resuelto. Buscalo con buscar_clientes y sus facturas con consultar_facturas antes de proponer el pago.',
                'payment_lookup_required',
              );
            }

            if (name === 'deshacer_ultimo') {
              const accion = lastUndoableAction(views);
              if (!accion) {
                throw new ToolInputError(
                  'No hay un cambio reciente que se pueda deshacer: el último cambio no es un pago, gasto, sueldo o movimiento de proveedor.',
                );
              }
              if (accion.doneAt) {
                throw new ToolInputError('Ese cambio ya está deshecho; no hay nada más para deshacer.');
              }
              args = { ...args, accion };
            }

            const prepared = await tool.prepare(args);
            args = prepared.args;
            note = prepared.summary;

            if (name === 'registrar_pago_factura') {
              const clienteId = args.cliente_id;
              if (
                guardClientId !== null &&
                typeof clienteId === 'number' &&
                clienteId !== guardClientId
              ) {
                throw new ToolInputError(
                  'La factura no corresponde al cliente que nombró el usuario. Buscá el cliente correcto y sus facturas antes de proponer el pago.',
                  'payment_lookup_required',
                );
              }
              if (typeof clienteId === 'number' && !turnClientIds.has(clienteId)) {
                throw new ToolInputError(
                  'La factura no pertenece a ningún cliente resuelto en este turno. Buscá el cliente y sus facturas antes de proponer el pago.',
                  'payment_lookup_required',
                );
              }
            }

            const signature = `${name}:${JSON.stringify(args)}`;
            if (writeSignatures.has(signature)) {
              if (name === 'registrar_pedido_no_cumplido') gapRegistered = true;
              content = JSON.stringify({
                status: tool.requiresConfirmation ? 'pending_confirmation' : 'ok',
                duplicado: true,
                resumen: prepared.summary,
                nota: 'Ya estaba en la lista o ya se ejecutó en este turno; no se repitió.',
              });
              views.push({
                id: call.id,
                name,
                args,
                note,
                result: { duplicado: true },
                pending: tool.requiresConfirmation === true,
                ms: Math.round(performance.now() - started),
                effect: tool.effect,
              });
            } else {
              writeSignatures.add(signature);
              actionCount++;

              if (tool.requiresConfirmation) {
                proposals.push({
                  id: newId(),
                  tool: name,
                  args,
                  summary: prepared.summary,
                  effect: tool.effect,
                  createdAt: Date.now(),
                  expiresAt: Date.now() + PENDING_TTL_MS,
                  status: 'pending',
                });
                content = JSON.stringify({
                  status: 'pending_confirmation',
                  resumen: prepared.summary,
                  nota: 'Quedó en la lista de acciones pendientes. NO se ejecutó todavía; el usuario confirma todas juntas.',
                });
                views.push({
                  id: call.id,
                  name,
                  args,
                  note,
                  result: { pendiente_de_confirmacion: true },
                  pending: true,
                  ms: Math.round(performance.now() - started),
                  effect: tool.effect,
                });
              } else {
                const value = await tool.run(args);
                if (name === 'registrar_pedido_no_cumplido') gapRegistered = true;
                if (name.endsWith('_tarea')) didTaskWrite = true;
                const undo = tool.undo?.(args, value);
                content = JSON.stringify({ ok: true, resumen: prepared.summary, resultado: value });
                views.push({
                  id: call.id,
                  name,
                  args,
                  note,
                  result: value,
                  ...(undo ? { undo } : {}),
                  ms: Math.round(performance.now() - started),
                  effect: tool.effect,
                });
              }
            }
          }
        } catch (err) {
          if (err instanceof ClarificationError) {
            if (!assistant.pending) {
              assistant.setClarification({
                id: newId(),
                tool: name,
                args: err.args,
                question: err.question,
                overrides: err.overrides,
                createdAt: Date.now(),
                expiresAt: Date.now() + CLARIFICATION_TTL_MS,
              });
            }
            content = JSON.stringify({
              status: 'needs_confirmation',
              question: err.question,
              nota: 'Preguntale al usuario. No ejecutes nada todavía.',
            });
            views.push({
              id: call.id,
              name,
              args: err.args,
              note: err.question,
              result: { needs_confirmation: true },
              pending: true,
              ms: Math.round(performance.now() - started),
              effect: tool?.effect ?? 'write',
            });
          } else {
            const message = err instanceof Error ? err.message : String(err);
            if (err instanceof ToolInputError && err.code === 'payment_lookup_required') {
              lookupNudgePending = true;
            }
            content = JSON.stringify({ error: message });
            views.push({
              id: call.id,
              name,
              args,
              note,
              error: message,
              ms: Math.round(performance.now() - started),
              effect: tool?.effect ?? 'read',
            });
          }
        }

        wire.push({ role: 'tool', tool_call_id: call.id, content });
      }

      if (lookupNudgePending && lookupNudgeCount < 2) {
        lookupNudgeCount++;
        wire.push({
          role: 'user',
          content:
            lookupNudgeCount === 1
              ? 'La búsqueda de pago de este turno todavía no se hizo. Hacela ahora con buscar_clientes y consultar_facturas y reintentá registrar_pago_factura con la factura y el monto en este mismo turno. No le pidas al usuario que busque, que confirme ni que ejecute tools.'
              : 'Segundo bloqueo de pago. El cliente del pago es el que surge de la factura y del comprobante, no el nombre del empleado o proveedor destino. Si el usuario respondió con un nombre suelto o con el destino, usá la factura del análisis anterior; no vuelvas a resolver el cliente desde ese texto. Reintentá registrar_pago_factura en este turno con la factura correcta.',
        });
      }
      lookupNudgePending = false;
    }

    // Se agotaron las iteraciones: pedimos un cierre en texto.
    let text = '';
    try {
      const prompt =
        proposals.length > 0
          ? `Resumí en una o dos frases las ${proposals.length} acciones que quedaron pendientes de confirmar. No vuelvas a llamar tools.`
          : 'Resumí el resultado en una respuesta breve para el usuario, sin tools.';
      const closing = await callModel(wire.concat([{ role: 'user', content: prompt }]), 'none');
      assistant.setLastRun({
        model: assistant.settings.model,
        ms: lastModelMs + closing.latencyMs,
        tokens: lastTokens + closing.totalTokens,
      });
      text = closing.content.trim();
    } catch {
      assistant.setLastRun({ model: assistant.settings.model, ms: lastModelMs, tokens: lastTokens });
    }
    let finalText = text || fallbackText(views, proposals, lastContent);
    if (NO_IMAGE_RE.test(finalText)) {
      if (proposals.length > 0) {
        finalText = proposalsFallback(proposals);
      } else if (assistant.clarification) {
        finalText = assistant.clarification.question;
      } else {
        const summary = summarizeWrites(views);
        if (summary) finalText = summary;
      }
    }
    if (proposals.length > 0 && PROPOSAL_EXECUTED_RE.test(finalText)) {
      finalText = proposalsFallback(proposals);
    }
    if (assistant.clarification && PROPOSAL_EXECUTED_RE.test(finalText)) {
      finalText = assistant.clarification.question;
    }
    maybeRegisterGap(userText, finalText, usedReadData, readDatasets, views, gapRegistered);
    finishTurn(finalText, views, proposals);
  } finally {
    if (didTaskWrite) taskEvents.notify();
  }
}

const CONFIRM_RE = /^(s[ií]|dale|confirm\w*|ok|okey|hazlo|adelante|de una|perfecto|correcto|listo|de acuerdo|ejecut[aá]|aplicalo|aplic[aá])\b/i;
const CANCEL_RE = /^(no|cancel[aá]|cancelar|dej[aá]|olvidalo|olvídalo|nada|mejor no|descart[aá])\b/i;
const PAYMENT_INTENT_RE = /\b(pag[oó]|pago|abon[oó]|cobr[oó]|transfer|efectivo|dep[oó]sito)\b/i;
/** El usuario pide deshacer/anular un pago: no es un intento de pago. */
const UNDO_INTENT_RE =
  /\b(deshac(?:e|é|er|elo|ela)|anul(?:a|á|ar|alo|ala)|revert(?:i|í|ir)|borr(?:a|á|ar)|elimin(?:a|á|ar)|cancel(?:a|á|ar))\b/i;
const CONFIRM_QUESTION_RE =
  /¿?\s*(confirmo|confirmás|confirmas|confirmamos|registro\b|registrar\b|registramos|parcial|duplicado|querés que registre|quieres que registre|lo registro)\b/i;

async function executeClarification(): Promise<void> {
  const clarification = assistant.clarification;
  if (!clarification) {
    if (assistant.rawClarification) assistant.clearClarification();
    return;
  }
  const tool = findTool(clarification.tool);
  assistant.clearClarification();
  if (!tool) {
    assistant.pushMessage('assistant', 'No encontré la acción a ejecutar.', { error: true });
    return;
  }

  assistant.setBusy(true);
  assistant.setError(null);
  const started = performance.now();
  const args = { ...clarification.args, ...clarification.overrides };
  try {
    const result = await tool.run(args);
    const undo = tool.undo?.(args, result);
    const text = tool.success?.(args, result) ?? 'Listo.';
    assistant.pushMessage('assistant', text, {
      toolCalls: [
        {
          id: newId(),
          name: tool.name,
          args,
          result,
          note: clarification.question,
          ...(undo ? { undo } : {}),
          ms: Math.round(performance.now() - started),
          effect: tool.effect,
        },
      ],
    });
  } catch (err) {
    assistant.setError(errorText(err));
    assistant.pushMessage('assistant', `No pude completar la acción: ${errorText(err)}`, { error: true });
  } finally {
    assistant.setBusy(false);
  }
}

/** Deshace una escritura ya ejecutada desde el botón del chat. */
export async function undoCall(messageId: string, callId: string): Promise<void> {
  if (assistant.busy) return;
  const message = assistant.messages.find((m) => m.id === messageId);
  const call = message?.toolCalls?.find((c) => c.id === callId);
  const accion = call ? undoOf(call) : null;
  if (!message || !call || !accion || accion.doneAt) return;

  assistant.setBusy(true);
  assistant.setError(null);
  try {
    if (!call.undo) {
      assistant.patchMessage(messageId, {
        toolCalls: (message.toolCalls ?? []).map((entry) =>
          entry.id === callId ? { ...entry, undo: accion } : entry,
        ),
      });
    }
    const text = await performUndo(accion);
    assistant.markUndoDone(accion.kind, accion.id);
    assistant.pushMessage('assistant', text);
  } catch (err) {
    const text = errorText(err);
    if (/^Error 404\b/.test(text)) {
      assistant.markUndoDone(accion.kind, accion.id);
      assistant.pushMessage('assistant', 'Ese cambio ya no estaba registrado; lo dejé como deshecho.');
    } else {
      assistant.setError(text);
      assistant.pushMessage('assistant', `No pude deshacer el cambio: ${text}`, { error: true });
    }
  } finally {
    assistant.setBusy(false);
  }
}

export async function sendMessage(input: string, attachments: PendingAttachment[] = []): Promise<void> {
  const text = input.trim();
  if ((!text && attachments.length === 0) || assistant.busy) return;

  const meta = attachments.length > 0 ? attachments.map((a) => a.attachment) : undefined;
  // Los regex de confirmación usan \b: hay que comparar sin acentos ("sí", "cancelá").
  const intent = normalizeText(text);

  if (assistant.pending) {
    if (CONFIRM_RE.test(intent) || CANCEL_RE.test(intent)) {
      assistant.pushMessage('user', text, { attachments: meta });
      if (CANCEL_RE.test(intent)) await cancelPending();
      else await confirmPending();
      return;
    }
    // Cualquier otra cosa es una corrección: se descarta la propuesta y se replanifica.
    assistant.clearPending();
  }

  const clarification = assistant.clarification;
  if (clarification) {
    if (CONFIRM_RE.test(intent)) {
      assistant.pushMessage('user', text);
      await executeClarification();
      return;
    }
    if (CANCEL_RE.test(intent)) {
      assistant.pushMessage('user', text);
      assistant.clearClarification();
      assistant.pushMessage('assistant', 'Listo, no hice nada.');
      return;
    }
    // Otra cosa: se descarta la aclaración y se sigue con la conversación normal.
    assistant.clearClarification();
  } else if (assistant.rawClarification) {
    assistant.clearClarification();
  }

  const comprobante = assistant.comprobante;
  if (comprobante) {
    if (text || meta) {
      const handled = await handleComprobanteReply(text, comprobante, meta);
      if (handled) return;
    }
    assistant.clearComprobante();
  } else if (assistant.rawComprobante) {
    assistant.clearComprobante();
  }

  const content = text;
  assistant.setError(null);
  const remembered = detectMemory(content);
  if (remembered) assistant.addMemory(remembered.category, remembered.content);

  assistant.pushMessage('user', content, { attachments: meta });

  if (!assistant.configured) {
    assistant.setError('Configurá tu API key de OpenRouter para empezar.');
    assistant.setView('settings');
    return;
  }

  assistant.setBusy(true);
  try {
    await runLoop(content, attachments);
  } catch (err) {
    assistant.setError(errorText(err));
  } finally {
    assistant.setBusy(false);
  }
}

export async function confirmPending(): Promise<void> {
  const batch = assistant.pending;
  if (!batch) {
    if (assistant.rawPending) {
      assistant.clearPending();
      assistant.pushMessage('assistant', 'La propuesta expiró. Pedime la acción de nuevo.', { error: true });
    }
    return;
  }
  if (assistant.busy) return;

  assistant.setBusy(true);
  assistant.setError(null);

  const views: ToolCallView[] = [];
  const okLines: string[] = [];
  const failLines: string[] = [];
  let didTaskWrite = false;

  try {
    for (const proposal of batch.proposals) {
      const started = performance.now();
      const tool = findTool(proposal.tool);

      if (!tool) {
        failLines.push(`Falló ${proposal.summary.replace(/\n+/g, ' · ')}: tool no encontrada.`);
        views.push({
          id: newId(),
          name: proposal.tool,
          args: proposal.args,
          note: proposal.summary,
          error: 'Tool no encontrada',
          ms: 0,
          effect: proposal.effect,
        });
        continue;
      }

      try {
        const result = await tool.run(proposal.args);
        if (tool.name.endsWith('_tarea')) didTaskWrite = true;
        if (tool.name === 'deshacer_pago') {
          const pagoId = Number(proposal.args.pago_id);
          if (Number.isInteger(pagoId) && pagoId > 0) assistant.markUndoDone('pago_factura', pagoId);
        } else if (tool.name === 'deshacer_ultimo') {
          const accion = proposal.args.accion as UndoAction | undefined;
          if (accion) assistant.markUndoDone(accion.kind, accion.id);
        }
        const undo = tool.undo?.(proposal.args, result);
        okLines.push(tool.success?.(proposal.args, result) ?? 'Listo.');
        views.push({
          id: newId(),
          name: tool.name,
          args: proposal.args,
          result,
          note: proposal.summary,
          ...(undo ? { undo } : {}),
          ms: Math.round(performance.now() - started),
          effect: tool.effect,
        });
      } catch (err) {
        const message = errorText(err);
        failLines.push(`Falló ${proposal.summary.replace(/\n+/g, ' · ')}: ${message}`);
        views.push({
          id: newId(),
          name: tool.name,
          args: proposal.args,
          note: proposal.summary,
          error: message,
          ms: Math.round(performance.now() - started),
          effect: tool.effect,
        });
      }
    }

    assistant.clearPending();

    const total = batch.proposals.length;
    let content: string;
    if (total === 1) {
      content = failLines[0] ?? okLines[0] ?? 'Listo.';
    } else if (failLines.length === 0) {
      content = `Listo, completé ${total} acciones:\n${okLines
        .map((line) => `• ${line.replace(/^Listo,\s*/i, '')}`)
        .join('\n')}`;
    } else {
      const done = okLines.map((line) => `• ${line.replace(/^Listo,\s*/i, '')}`);
      content = `Completé ${okLines.length} de ${total} acciones.\n${[...done, ...failLines.map((line) => `• ${line}`)].join('\n')}`;
    }

    assistant.pushMessage('assistant', content, {
      toolCalls: views,
      error: failLines.length > 0 && okLines.length === 0,
    });

    if (failLines.length > 0) assistant.setError(`${failLines.length} acción(es) no se pudieron completar.`);
    if (didTaskWrite) taskEvents.notify();
  } finally {
    assistant.setBusy(false);
  }
}

export async function cancelPending(): Promise<void> {
  const batch = assistant.clearPending();
  if (assistant.busy) return;
  assistant.pushMessage('assistant', batch ? 'Listo, no hice nada.' : 'No había nada pendiente.');
}
