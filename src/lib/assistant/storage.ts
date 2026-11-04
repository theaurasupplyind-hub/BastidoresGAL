import type {
  AssistantAttachment,
  AssistantState,
  AssistantSyncData,
  AssistantTombstones,
  ChatMessage,
  Clarification,
  ComprobanteCandidate,
  ComprobantePending,
  Conversation,
  GapItem,
  MemoryItem,
  Proposal,
  ProposalBatch,
} from './types';

const STORAGE_KEY = 'galv2.assistant.v1';

export const DEFAULT_MODEL = 'google/gemini-2.5-flash';

export const MODEL_SUGGESTIONS = [
  'anthropic/claude-haiku-5.5',
  'google/gemini-2.5-flash',
  'google/gemini-3.8-flash',
  'google/gemini-3.5-flash-lite',
  'openai/gpt-5.6-luna',
  'anthropic/claude-sonnet-5.5',
  'deepseek/deepseek-v4.1-flash',
];

export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newConversation(title = 'Nueva conversación'): Conversation {
  const now = Date.now();
  return { id: newId(), title, messages: [], createdAt: now, updatedAt: now };
}

export function emptyTombstones(): AssistantTombstones {
  return { conversations: {}, memory: {}, gaps: {} };
}

export function defaultState(): AssistantState {
  const conv = newConversation();
  return {
    version: 1,
    settings: { apiKey: '', model: DEFAULT_MODEL, temperature: 0.2 },
    conversations: [conv],
    activeId: conv.id,
    memory: [],
    pending: null,
    clarification: null,
    gaps: [],
    comprobante: null,
    deleted: emptyTombstones(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeProposal(raw: unknown): Proposal | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.id !== 'string' ||
    typeof raw.tool !== 'string' ||
    !isRecord(raw.args) ||
    typeof raw.summary !== 'string' ||
    typeof raw.createdAt !== 'number' ||
    typeof raw.expiresAt !== 'number' ||
    (raw.effect !== 'write' && raw.effect !== 'destructive')
  ) {
    return null;
  }
  return {
    id: raw.id,
    tool: raw.tool,
    args: raw.args,
    summary: raw.summary,
    effect: raw.effect,
    createdAt: raw.createdAt,
    expiresAt: raw.expiresAt,
    status: 'pending',
  };
}

/** Acepta el formato nuevo (batch) y el viejo (una sola propuesta). */
function normalizePending(raw: unknown): ProposalBatch | null {
  if (!isRecord(raw)) return null;

  if (Array.isArray(raw.proposals)) {
    const proposals = raw.proposals
      .map(normalizeProposal)
      .filter((p): p is Proposal => p !== null);
    if (proposals.length === 0) return null;
    return {
      id: typeof raw.id === 'string' ? raw.id : newId(),
      proposals,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
      expiresAt: typeof raw.expiresAt === 'number' ? raw.expiresAt : Date.now() + 600_000,
    };
  }

  const single = normalizeProposal(raw);
  if (!single) return null;
  return {
    id: newId(),
    proposals: [single],
    createdAt: single.createdAt,
    expiresAt: single.expiresAt,
  };
}

function normalizeAttachments(raw: unknown): AssistantAttachment[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const attachments = raw.filter(isRecord).flatMap((a) => {
    if (typeof a.id !== 'string' || typeof a.name !== 'string' || typeof a.mime !== 'string') return [];
    return [{
      id: a.id,
      name: a.name,
      mime: a.mime,
      size: typeof a.size === 'number' ? a.size : 0,
      width: typeof a.width === 'number' ? a.width : 0,
      height: typeof a.height === 'number' ? a.height : 0,
    }];
  });
  return attachments.length > 0 ? attachments : undefined;
}

function normalizeClarification(raw: unknown): Clarification | null {
  if (!isRecord(raw)) return null;
  if (
    typeof raw.id !== 'string' ||
    typeof raw.tool !== 'string' ||
    !isRecord(raw.args) ||
    !isRecord(raw.overrides) ||
    typeof raw.question !== 'string' ||
    typeof raw.expiresAt !== 'number'
  ) {
    return null;
  }
  return {
    id: raw.id,
    tool: raw.tool,
    args: raw.args,
    question: raw.question,
    overrides: raw.overrides,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    expiresAt: raw.expiresAt,
  };
}

/** Normaliza los pedidos no cumplidos guardados. */
export function normalizeGaps(raw: unknown): GapItem[] {
  if (!Array.isArray(raw)) return [];
  const out: GapItem[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    if (typeof item.pregunta !== 'string' || !item.pregunta.trim()) continue;
    const status =
      item.status === 'revisado' || item.status === 'resuelto' || item.status === 'descartado'
        ? item.status
        : 'nuevo';
    const at = typeof item.at === 'number' ? item.at : Date.now();
    out.push({
      id: typeof item.id === 'string' ? item.id : newId(),
      pregunta: item.pregunta.trim().slice(0, 2000),
      motivo: typeof item.motivo === 'string' ? item.motivo.trim().slice(0, 1000) : '',
      respuestaParcial:
        typeof item.respuestaParcial === 'string' ? item.respuestaParcial.trim().slice(0, 4000) : '',
      datasets: Array.isArray(item.datasets)
        ? item.datasets.filter((d): d is string => typeof d === 'string').slice(0, 20)
        : [],
      tools: Array.isArray(item.tools)
        ? item.tools.filter((t): t is string => typeof t === 'string').slice(0, 20)
        : [],
      at,
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : at,
      status,
    });
  }
  return out.slice(0, 200);
}

/** Normaliza un comprobante pendiente de elección de factura. */
function normalizeComprobante(raw: unknown): ComprobantePending | null {
  if (!isRecord(raw)) return null;
  const candidatasRaw = Array.isArray(raw.candidates) ? raw.candidates : [];
  const candidates: ComprobanteCandidate[] = [];
  for (const item of candidatasRaw) {
    if (!isRecord(item) || typeof item.invoiceId !== 'number' || item.invoiceId <= 0) continue;
    candidates.push({
      invoiceId: item.invoiceId,
      numero: typeof item.numero === 'string' ? item.numero : String(item.invoiceId),
      clienteId: typeof item.clienteId === 'number' ? item.clienteId : null,
      clienteNombre: typeof item.clienteNombre === 'string' ? item.clienteNombre : '',
      saldo: typeof item.saldo === 'number' ? item.saldo : 0,
    });
  }
  if (candidates.length === 0) return null;

  const metodo =
    raw.metodo === 'Efectivo' || raw.metodo === 'Transferencia' ? raw.metodo : null;
  const destinoRaw = isRecord(raw.destino) ? raw.destino : null;
  const destino =
    destinoRaw &&
    (destinoRaw.tipo === 'proveedor' || destinoRaw.tipo === 'empleado') &&
    typeof destinoRaw.id === 'number'
      ? {
          tipo: destinoRaw.tipo as 'proveedor' | 'empleado',
          id: destinoRaw.id,
          nombre: typeof destinoRaw.nombre === 'string' ? destinoRaw.nombre : '',
        }
      : undefined;
  const selectedRaw = isRecord(raw.selected) ? raw.selected : null;
  const selected =
    selectedRaw && typeof selectedRaw.invoiceId === 'number'
      ? candidates.find((item) => item.invoiceId === selectedRaw.invoiceId) ?? null
      : null;

  return {
    id: typeof raw.id === 'string' ? raw.id : newId(),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    expiresAt:
      typeof raw.expiresAt === 'number' ? raw.expiresAt : Date.now() + 10 * 60 * 1000,
    metodo,
    ...(typeof raw.fecha === 'string' && raw.fecha ? { fecha: raw.fecha } : {}),
    ...(destino ? { destino } : {}),
    candidates,
    ...(selected ? { selected } : {}),
  };
}

/** Normaliza una lista de conversaciones (sin agregar una vacía). */
export function normalizeConversations(raw: unknown): Conversation[] {
  if (!Array.isArray(raw)) return [];
  const out: Conversation[] = [];
  for (const item of raw) {
    if (!isRecord(item)) continue;
    const messages = Array.isArray(item.messages) ? item.messages : [];
    const clean = messages.filter(isRecord).map((m) => ({
      id: typeof m.id === 'string' ? m.id : newId(),
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      content: typeof m.content === 'string' ? m.content : '',
      at: typeof m.at === 'number' ? m.at : Date.now(),
      toolCalls: Array.isArray(m.toolCalls) ? (m.toolCalls as never[]) : undefined,
      attachments: normalizeAttachments(m.attachments),
      error: m.error === true,
    }));
    out.push({
      id: typeof item.id === 'string' ? item.id : newId(),
      title: typeof item.title === 'string' && item.title ? item.title : 'Conversación',
      messages: clean,
      createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
    });
  }
  return out;
}

/** Normaliza una lista de recuerdos. */
export function normalizeMemory(raw: unknown): MemoryItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).flatMap((m) => {
    if (typeof m.content !== 'string' || !m.content.trim()) return [];
    const category = m.category;
    return [{
      id: typeof m.id === 'string' ? m.id : newId(),
      category:
        category === 'correction' || category === 'preference' || category === 'context' || category === 'fact'
          ? category
          : ('fact' as const),
      content: m.content.trim(),
      at: typeof m.at === 'number' ? m.at : Date.now(),
    }];
  });
}

function normalizeTombstoneMap(raw: unknown): Record<string, number> {
  if (!isRecord(raw)) return {};
  const out: Record<string, number> = {};
  for (const [id, ts] of Object.entries(raw)) {
    if (typeof ts === 'number' && Number.isFinite(ts) && ts > 0) out[id] = ts;
  }
  return out;
}

export function normalizeTombstones(raw: unknown): AssistantTombstones {
  if (!isRecord(raw)) return emptyTombstones();
  return {
    conversations: normalizeTombstoneMap(raw.conversations),
    memory: normalizeTombstoneMap(raw.memory),
    gaps: normalizeTombstoneMap(raw.gaps),
  };
}

/** Normaliza lo leído de localStorage para tolerar versiones viejas o datos rotos. */
export function normalizeState(raw: unknown): AssistantState {
  const base = defaultState();
  if (!isRecord(raw)) return base;

  const settings = isRecord(raw.settings) ? raw.settings : {};

  const cleanConversations = normalizeConversations(raw.conversations);
  if (cleanConversations.length === 0) cleanConversations.push(base.conversations[0]);

  const activeId =
    typeof raw.activeId === 'string' && cleanConversations.some((c) => c.id === raw.activeId)
      ? raw.activeId
      : cleanConversations[0].id;

  return {
    version: 1,
    settings: {
      apiKey: typeof settings.apiKey === 'string' ? settings.apiKey : '',
      model: typeof settings.model === 'string' && settings.model ? settings.model : DEFAULT_MODEL,
      temperature:
        typeof settings.temperature === 'number' && Number.isFinite(settings.temperature)
          ? Math.min(2, Math.max(0, settings.temperature))
          : 0.2,
    },
    conversations: cleanConversations,
    activeId,
    memory: normalizeMemory(raw.memory),
    pending: normalizePending(raw.pending),
    clarification: normalizeClarification(raw.clarification),
    gaps: normalizeGaps(raw.gaps),
    comprobante: normalizeComprobante(raw.comprobante),
    deleted: normalizeTombstones(raw.deleted),
  };
}

export function loadState(): AssistantState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

export function saveState(state: AssistantState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[assistant] no se pudo guardar el estado', err);
  }
}

/* ---- Sincronización con el backend ---- */

const MIGRATED_KEY = 'galv2.assistant.v1.migrated';
const BACKUP_KEY = 'galv2.assistant.v1.backup';
const PENDING_SETTINGS_KEY = 'galv2.assistant.v1.pending-settings';
const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface PendingAssistantSettings {
  model?: string;
  temperature?: number;
}

export function loadPendingSettings(): PendingAssistantSettings | null {
  try {
    const raw = localStorage.getItem(PENDING_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const out: PendingAssistantSettings = {};
    if (typeof parsed.model === 'string' && parsed.model.trim()) {
      out.model = parsed.model.trim();
    }
    if (typeof parsed.temperature === 'number' && Number.isFinite(parsed.temperature)) {
      out.temperature = Math.min(2, Math.max(0, parsed.temperature));
    }
    return out.model || typeof out.temperature === 'number' ? out : null;
  } catch {
    return null;
  }
}

export function savePendingSettings(pending: PendingAssistantSettings | null): void {
  try {
    if (!pending) localStorage.removeItem(PENDING_SETTINGS_KEY);
    else localStorage.setItem(PENDING_SETTINGS_KEY, JSON.stringify(pending));
  } catch {
    // sin storage: no es fatal
  }
}

export function emptySyncData(): AssistantSyncData {
  return {
    version: 1,
    conversations: [],
    memory: [],
    gaps: [],
    deleted: emptyTombstones(),
  };
}

export function normalizeSyncData(raw: unknown): AssistantSyncData {
  if (!isRecord(raw)) return emptySyncData();
  return {
    version: 1,
    conversations: normalizeConversations(raw.conversations),
    memory: normalizeMemory(raw.memory),
    gaps: normalizeGaps(raw.gaps),
    deleted: normalizeTombstones(raw.deleted),
  };
}

export function syncDataFromState(state: AssistantState): AssistantSyncData {
  return normalizeSyncData({
    // Las conversaciones vacías son placeholders locales, no se sincronizan.
    conversations: state.conversations.filter((c) => c.messages.length > 0),
    memory: state.memory,
    gaps: state.gaps,
    deleted: state.deleted,
  });
}

function mergeTombstones(
  a: AssistantTombstones,
  b: AssistantTombstones
): AssistantTombstones {
  const cutoff = Date.now() - TOMBSTONE_TTL_MS;
  const mergeMap = (x: Record<string, number>, y: Record<string, number>) => {
    const out: Record<string, number> = { ...y };
    for (const [id, ts] of Object.entries(x)) out[id] = Math.max(out[id] ?? 0, ts);
    return Object.fromEntries(
      Object.entries(out)
        .filter(([, ts]) => ts >= cutoff)
        .sort((m, n) => m[1] - n[1])
        .slice(-2000)
    );
  };
  return {
    conversations: mergeMap(a.conversations, b.conversations),
    memory: mergeMap(a.memory, b.memory),
    gaps: mergeMap(a.gaps, b.gaps),
  };
}

function mergeConversation(a: Conversation, b: Conversation): Conversation {
  const byId = new Map<string, ChatMessage>();
  for (const m of a.messages) byId.set(m.id, m);
  for (const m of b.messages) {
    const prev = byId.get(m.id);
    if (!prev) byId.set(m.id, m);
    else if ((m.at ?? 0) >= (prev.at ?? 0)) byId.set(m.id, { ...prev, ...m });
    else byId.set(m.id, { ...m, ...prev });
  }
  const messages = [...byId.values()]
    .sort((x, y) => x.at - y.at)
    .slice(-400);
  const newer = (a.updatedAt ?? 0) >= (b.updatedAt ?? 0) ? a : b;
  const older = newer === a ? b : a;
  return {
    id: newer.id,
    title: newer.title || older.title,
    createdAt: Math.min(a.createdAt, b.createdAt),
    updatedAt: Math.max(a.updatedAt ?? 0, b.updatedAt ?? 0),
    messages,
  };
}

/**
 * Une dos documentos del asistente.
 *
 * - Conversaciones: por id; si está en ambos se unen los mensajes por id.
 * - Memoria y gaps: por id; gana el `updatedAt` más nuevo.
 * - Tombstones: gana el timestamp más nuevo, así un borrado no se resucita.
 */
export function mergeSyncData(
  local: AssistantSyncData,
  remote: AssistantSyncData
): AssistantSyncData {
  const deleted = mergeTombstones(local.deleted, remote.deleted);

  const convMap = new Map<string, Conversation>();
  for (const c of [...remote.conversations, ...local.conversations]) {
    const prev = convMap.get(c.id);
    convMap.set(c.id, prev ? mergeConversation(prev, c) : c);
  }
  const conversations = [...convMap.values()]
    .filter((c) => (deleted.conversations[c.id] ?? 0) < (c.updatedAt ?? 0))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    .slice(0, 200);

  const memMap = new Map<string, MemoryItem>();
  for (const m of [...remote.memory, ...local.memory]) {
    const prev = memMap.get(m.id);
    if (!prev || (m.at ?? 0) > (prev.at ?? 0)) memMap.set(m.id, m);
  }
  const memory = [...memMap.values()]
    .filter((m) => (deleted.memory[m.id] ?? 0) < (m.at ?? 0))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, 500);

  const gapMap = new Map<string, GapItem>();
  for (const g of [...remote.gaps, ...local.gaps]) {
    const prev = gapMap.get(g.id);
    const gTs = g.updatedAt ?? g.at;
    const pTs = prev ? (prev.updatedAt ?? prev.at) : -1;
    if (!prev || gTs > pTs) gapMap.set(g.id, g);
  }
  const gaps = [...gapMap.values()]
    .filter((g) => (deleted.gaps[g.id] ?? 0) < (g.updatedAt ?? g.at))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, 200);

  return { version: 1, conversations, memory, gaps, deleted };
}

/** true si el estado local tiene algo que valga la pena migrar. */
export function hasMeaningfulState(state: AssistantState): boolean {
  return (
    state.conversations.some((c) => c.messages.length > 0) ||
    state.memory.length > 0 ||
    state.gaps.length > 0 ||
    state.settings.apiKey.trim().length > 0
  );
}

export function stripAssistantApiKey(state: AssistantState): AssistantState {
  return { ...state, settings: { ...state.settings, apiKey: '' } };
}

export function isLocalMigrationDone(): boolean {
  try {
    return !!localStorage.getItem(MIGRATED_KEY);
  } catch {
    return false;
  }
}

/** Guarda un respaldo local (sin la key) y marca la migración como hecha. */
export function markLocalMigrationDone(state: AssistantState): void {
  try {
    const backup = stripAssistantApiKey(state);
    const serialized = JSON.stringify(backup);
    localStorage.setItem(BACKUP_KEY, serialized);
    // Limpia la key del cache vivo ya mismo (no esperar al debounce).
    localStorage.setItem(STORAGE_KEY, serialized);
    localStorage.setItem(MIGRATED_KEY, new Date().toISOString());
  } catch {
    // sin storage: la migración ya se subió, no es fatal
  }
}
