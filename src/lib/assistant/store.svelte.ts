import { api } from '$lib/api/client';
import { appStore } from '$lib/stores/appStore.svelte';
import {
  emptyTombstones,
  hasMeaningfulState,
  isLocalMigrationDone,
  loadPendingSettings,
  loadState,
  markLocalMigrationDone,
  mergeSyncData,
  newConversation,
  newId,
  normalizeSyncData,
  savePendingSettings,
  saveState,
  syncDataFromState,
} from './storage';
import type { AssistantSyncData } from './types';
import { deleteImages } from './imageStore';
import type {
  AssistantSettings,
  AssistantState,
  ChatMessage,
  Clarification,
  ComprobantePending,
  Conversation,
  GapItem,
  GapStatus,
  MemoryCategory,
  MemoryItem,
  ProposalBatch,
  UndoKind,
} from './types';

export type AssistantView = 'chat' | 'settings' | 'memory' | 'history' | 'gaps';

let state = $state<AssistantState>(loadState());
let isOpen = $state(false);
let isBusy = $state(false);
let view = $state<AssistantView>('chat');
let lastError = $state<string | null>(null);
let lastRun = $state<{ model: string; ms: number; tokens: number } | null>(null);
let hasApiKey = $state(false);
let syncing = $state(false);
let syncError = $state<string | null>(null);
let slow = $state(false);

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let remoteTimer: ReturnType<typeof setTimeout> | null = null;
let revision = 0;
let syncReady = false;
let remoteInFlight = false;
let remoteDirty = false;

function snapshot(): AssistantState {
  return $state.snapshot(state) as AssistantState;
}

/** Guarda solo en el cache local (rápido, funciona sin red). */
function persistLocal(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveState(snapshot());
  }, 180);
}

/** Cualquier cambio local: cache + push remoto debounced. */
function persist(): void {
  persistLocal();
  scheduleRemote();
}

function scheduleRemote(): void {
  if (!syncReady) return;
  if (remoteTimer) clearTimeout(remoteTimer);
  remoteTimer = setTimeout(() => {
    remoteTimer = null;
    void pushRemote();
  }, 1200);
}

function isEmptySyncData(data: AssistantSyncData): boolean {
  return (
    data.conversations.length === 0 &&
    data.memory.length === 0 &&
    data.gaps.length === 0 &&
    Object.keys(data.deleted.conversations).length === 0 &&
    Object.keys(data.deleted.memory).length === 0 &&
    Object.keys(data.deleted.gaps).length === 0
  );
}

function canonicalSyncData(data: AssistantSyncData): string {
  const sortTomb = (m: Record<string, number>) =>
    Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify({
    conversations: [...data.conversations]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((c) => ({
        ...c,
        messages: [...c.messages].sort((a, b) => a.id.localeCompare(b.id)),
      })),
    memory: [...data.memory].sort((a, b) => a.id.localeCompare(b.id)),
    gaps: [...data.gaps].sort((a, b) => a.id.localeCompare(b.id)),
    deleted: {
      conversations: sortTomb(data.deleted.conversations),
      memory: sortTomb(data.deleted.memory),
      gaps: sortTomb(data.deleted.gaps),
    },
  });
}

function applyRemoteSettings(settings: {
  model?: string;
  temperature?: number;
  has_api_key?: boolean;
}): void {
  if (typeof settings.has_api_key === 'boolean') hasApiKey = settings.has_api_key;
  if (typeof settings.model === 'string' && settings.model.trim()) {
    state.settings.model = settings.model.trim();
  }
  if (typeof settings.temperature === 'number' && Number.isFinite(settings.temperature)) {
    state.settings.temperature = Math.min(2, Math.max(0, settings.temperature));
  }
}

/** Reemplaza conversaciones/memoria/gaps con el documento mezclado. */
function applySyncData(data: AssistantSyncData, activeId: string): void {
  const conversations =
    data.conversations.length > 0 ? data.conversations : [newConversation()];
  state.conversations = conversations;
  state.memory = data.memory;
  state.gaps = data.gaps;
  state.deleted = data.deleted;
  state.activeId = conversations.some((c) => c.id === activeId)
    ? activeId
    : conversations[0].id;
}

/**
 * Si el usuario siguió escribiendo mientras viajaba el request, mezcla lo
 * nuevo con el resultado remoto en vez de pisarlo.
 */
function mergeWithLive(
  base: AssistantSyncData,
  target: AssistantSyncData
): { data: AssistantSyncData; changed: boolean } {
  const live = syncDataFromState(snapshot());
  if (canonicalSyncData(live) === canonicalSyncData(base)) {
    return { data: target, changed: false };
  }
  return { data: mergeSyncData(live, target), changed: true };
}

async function pushRemote(): Promise<void> {
  if (!syncReady || syncing) return;
  if (remoteInFlight) {
    remoteDirty = true;
    return;
  }
  remoteInFlight = true;
  try {
    const data = syncDataFromState(snapshot());
    // No crear una fila vacía solo por abrir el drawer.
    if (revision === 0 && isEmptySyncData(data)) return;
    let saved = await api.assistantPutState(data, revision, appStore.user?.user_name);

    if (saved.conflict) {
      revision = Number(saved.revision) || revision;
      const merged = mergeSyncData(data, normalizeSyncData(saved.data));
      saved = await api.assistantPutState(merged, revision, appStore.user?.user_name);
      revision = Number(saved.revision) || revision;
      if (saved.conflict) {
        const current = mergeSyncData(merged, normalizeSyncData(saved.data));
        revision = Number(saved.revision) || revision;
        const next = mergeWithLive(data, current);
        applySyncData(next.data, state.activeId);
        persistLocal();
        remoteDirty = true;
        return;
      }
      const next = mergeWithLive(data, merged);
      applySyncData(next.data, state.activeId);
      persistLocal();
      if (next.changed) remoteDirty = true;
      return;
    }

    revision = Number(saved.revision) || revision;
    syncError = null;
  } catch (err: any) {
    syncError = err?.message ?? 'No se pudo guardar el asistente en la nube.';
  } finally {
    remoteInFlight = false;
    if (remoteDirty) {
      remoteDirty = false;
      scheduleRemote();
    }
  }
}

async function pushSettings(patch: {
  model?: string;
  temperature?: number;
  api_key?: string;
}): Promise<boolean> {
  try {
    const saved = await api.assistantPutSettings(patch);
    applyRemoteSettings(saved);
    if (patch.api_key !== undefined) state.settings.apiKey = '';
    if (patch.model !== undefined || patch.temperature !== undefined) {
      savePendingSettings(null);
    }
    persistLocal();
    syncError = null;
    return true;
  } catch (err: any) {
    syncError = err?.message ?? 'No se pudieron guardar los ajustes.';
    return false;
  }
}

/**
 * Trae el estado de la nube, migra el localStorage la primera vez y mezcla
 * los cambios locales hechos sin conexión. Se llama al abrir el asistente.
 */
async function syncNow(): Promise<void> {
  if (syncing) return;
  syncing = true;
  syncError = null;
  try {
    // Guardar cómo estaba el cache antes de aplicar lo remoto: si hay que
    // migrar, sus conversaciones y su modelo/temperatura son los que valen.
    const localBefore = snapshot();
    const remote = await api.assistantGetState();

    // Si quedó un cambio de modelo/temperatura sin subir, gana sobre el remoto.
    const pendingSettings = loadPendingSettings();
    if (pendingSettings) {
      const ok = await pushSettings({
        model: pendingSettings.model,
        temperature: pendingSettings.temperature,
      });
      if (!ok) {
        applyRemoteSettings(remote.settings);
        if (pendingSettings.model) state.settings.model = pendingSettings.model;
        if (typeof pendingSettings.temperature === 'number') {
          state.settings.temperature = pendingSettings.temperature;
        }
      }
    } else {
      applyRemoteSettings(remote.settings);
    }

    revision = Number(remote.revision) || 0;

    const localSnapshot = localBefore;
    const localSync = syncDataFromState(localSnapshot);
    const remoteSync = normalizeSyncData(remote.data);
    let merged = mergeSyncData(localSync, remoteSync);

    const migrating = !isLocalMigrationDone() && hasMeaningfulState(localSnapshot);
    const legacyKey = localSnapshot.settings.apiKey.trim();
    const legacyModel = localSnapshot.settings.model;
    const legacyTemperature = localSnapshot.settings.temperature;
    const needsPush =
      migrating || canonicalSyncData(merged) !== canonicalSyncData(remoteSync);
    let retryPending = false;

    if (needsPush) {
      let saved = await api.assistantPutState(
        merged,
        revision,
        appStore.user?.user_name
      );
      revision = Number(saved.revision) || revision;
      if (saved.conflict) {
        merged = mergeSyncData(merged, normalizeSyncData(saved.data));
        saved = await api.assistantPutState(
          merged,
          revision,
          appStore.user?.user_name
        );
        revision = Number(saved.revision) || revision;
        if (saved.conflict) {
          merged = mergeSyncData(merged, normalizeSyncData(saved.data));
          retryPending = true;
        }
      }

      if (migrating) {
        // En la primera migración (backend vacío) conservamos modelo/temperatura
        // del cache. Si el backend ya tiene datos, manda lo remoto (otra estación).
        const patch: { model?: string; temperature?: number; api_key?: string } = {};
        if (remote.revision === 0) {
          patch.model = legacyModel;
          patch.temperature = legacyTemperature;
        }
        // Si el backend ya tiene una key, no la pisamos.
        if (legacyKey && !remote.settings.has_api_key) {
          patch.api_key = legacyKey;
        }
        if (Object.keys(patch).length > 0) {
          const settings = await api.assistantPutSettings(patch);
          applyRemoteSettings(settings);
        }
        markLocalMigrationDone(localSnapshot);
        state.settings.apiKey = '';
      }
    }

    const applied = mergeWithLive(localSync, merged);
    applySyncData(applied.data, state.activeId);
    syncReady = true;
    persistLocal();
    if (applied.changed || retryPending) scheduleRemote();
  } catch (err: any) {
    syncError = err?.message ?? 'No se pudo sincronizar el asistente.';
  } finally {
    syncing = false;
  }
}

function activeConversation(): Conversation {
  return state.conversations.find((c) => c.id === state.activeId) ?? state.conversations[0];
}

export const assistant = {
  get open() {
    return isOpen;
  },
  openDrawer(next: AssistantView = 'chat') {
    view = next;
    isOpen = true;
    void syncNow();
  },
  closeDrawer() {
    if (isBusy) return;
    isOpen = false;
    view = 'chat';
  },
  toggle() {
    if (isOpen) this.closeDrawer();
    else this.openDrawer('chat');
  },

  get view() {
    return view;
  },
  setView(next: AssistantView) {
    view = next;
  },

  get busy() {
    return isBusy;
  },
  setBusy(value: boolean) {
    isBusy = value;
  },

  get error() {
    return lastError;
  },
  setError(message: string | null) {
    lastError = message;
  },

  get lastRun() {
    return lastRun;
  },
  setLastRun(run: { model: string; ms: number; tokens: number } | null) {
    lastRun = run;
  },

  get hasApiKey() {
    return hasApiKey;
  },
  get syncing() {
    return syncing;
  },
  get syncError() {
    return syncError;
  },
  get slow() {
    return slow;
  },
  setSlow(value: boolean) {
    slow = value;
  },
  async syncNow(): Promise<void> {
    await syncNow();
  },

  get settings(): AssistantSettings {
    return state.settings;
  },
  updateSettings(patch: Partial<AssistantSettings>) {
    const apiKey = typeof patch.apiKey === 'string' ? patch.apiKey.trim() : '';
    if (typeof patch.model === 'string' && patch.model.trim()) {
      state.settings.model = patch.model.trim();
    }
    if (typeof patch.temperature === 'number' && Number.isFinite(patch.temperature)) {
      state.settings.temperature = Math.min(2, Math.max(0, patch.temperature));
    }
    // La key no se guarda en el estado local: viaja directo al backend.
    persistLocal();
    // Modelo/temperatura sí se reintentan al volver la conexión.
    savePendingSettings({
      model: state.settings.model,
      temperature: state.settings.temperature,
    });
    const body: { model: string; temperature: number; api_key?: string } = {
      model: state.settings.model,
      temperature: state.settings.temperature,
    };
    if (apiKey) body.api_key = apiKey;
    void pushSettings(body);
  },
  clearApiKey(): void {
    hasApiKey = false;
    state.settings.apiKey = '';
    persistLocal();
    void pushSettings({ model: state.settings.model, temperature: state.settings.temperature, api_key: '' });
  },
  get configured() {
    return hasApiKey || state.settings.apiKey.trim().length > 0;
  },

  get conversations(): Conversation[] {
    return state.conversations;
  },
  get activeId() {
    return state.activeId;
  },
  get active(): Conversation {
    return activeConversation();
  },
  get messages(): ChatMessage[] {
    return activeConversation().messages;
  },

  newChat(): void {
    const current = activeConversation();
    isBusy = false;
    state.pending = null;
    state.clarification = null;
    state.comprobante = null;
    if (current.messages.length === 0) {
      view = 'chat';
      persist();
      return;
    }
    const created = newConversation();
    state.conversations.unshift(created);
    state.activeId = created.id;
    view = 'chat';
    persist();
  },

  selectChat(id: string): void {
    if (isBusy) return;
    if (!state.conversations.some((c) => c.id === id)) return;
    state.activeId = id;
    state.pending = null;
    state.clarification = null;
    state.comprobante = null;
    view = 'chat';
    persist();
  },

  deleteChat(id: string): void {
    if (isBusy) return;
    const idx = state.conversations.findIndex((c) => c.id === id);
    if (idx < 0) return;
    const removed = state.conversations[idx];
    const imageIds = removed.messages.flatMap(
      (m) => m.attachments?.map((a) => a.id) ?? [],
    );
    if (imageIds.length > 0) void deleteImages(imageIds).catch(() => {});
    if (removed.messages.length > 0) {
      state.deleted = state.deleted ?? emptyTombstones();
      state.deleted.conversations[id] = Date.now();
    }
    state.conversations.splice(idx, 1);
    if (state.conversations.length === 0) state.conversations.push(newConversation());
    if (state.activeId === id) {
      state.activeId = state.conversations[0].id;
      state.pending = null;
      state.clarification = null;
      state.comprobante = null;
    }
    persist();
  },

  pushMessage(
    role: ChatMessage['role'],
    content: string,
    extra: Partial<Pick<ChatMessage, 'toolCalls' | 'attachments' | 'error'>> = {},
  ): ChatMessage {
    const conv = activeConversation();
    const message: ChatMessage = {
      id: newId(),
      role,
      content,
      at: Date.now(),
      ...extra,
    };
    conv.messages.push(message);
    conv.updatedAt = message.at;
    if (role === 'user' && conv.title === 'Nueva conversación') {
      const title = content.trim().replace(/\s+/g, ' ').slice(0, 48);
      conv.title = title || (extra.attachments?.length ? 'Comprobante' : 'Nueva conversación');
    }
    persist();
    return message;
  },

  patchMessage(id: string, patch: Partial<ChatMessage>): void {
    const conv = activeConversation();
    const message = conv.messages.find((m) => m.id === id);
    if (!message) return;
    Object.assign(message, patch);
    conv.updatedAt = Date.now();
    persist();
  },

  /** Marca como deshecho cualquier tool call que haya registrado esa escritura (todas las conversaciones). */
  markUndoDone(kind: UndoKind, id: number | string): number {
    let changed = 0;
    for (const conv of state.conversations) {
      for (const message of conv.messages) {
        for (const call of message.toolCalls ?? []) {
          const undo = call.undo as unknown as
            | { kind?: string; id?: number | string; paymentId?: number; doneAt?: number }
            | undefined;
          if (!undo || undo.doneAt) continue;
          const matches =
            (undo.kind === kind && undo.id === id) || (kind === 'pago_factura' && undo.paymentId === id);
          if (matches) {
            undo.doneAt = Date.now();
            changed++;
          }
        }
      }
    }
    if (changed > 0) persist();
    return changed;
  },

  get memory(): MemoryItem[] {
    return state.memory;
  },
  addMemory(category: MemoryCategory, content: string): MemoryItem | null {
    const clean = content.trim();
    if (!clean) return null;
    const norm = clean.toLowerCase();
    const existing = state.memory.find((m) => m.content.toLowerCase() === norm);
    if (existing) {
      existing.category = category;
      existing.at = Date.now();
      persist();
      return existing;
    }
    const item: MemoryItem = { id: newId(), category, content: clean, at: Date.now() };
    state.memory.unshift(item);
    persist();
    return item;
  },
  removeMemory(id: string): void {
    const idx = state.memory.findIndex((m) => m.id === id);
    if (idx < 0) return;
    state.memory.splice(idx, 1);
    state.deleted = state.deleted ?? emptyTombstones();
    state.deleted.memory[id] = Date.now();
    persist();
  },
  clearMemory(): void {
    state.deleted = state.deleted ?? emptyTombstones();
    const now = Date.now();
    for (const item of state.memory) state.deleted.memory[item.id] = now;
    state.memory.splice(0, state.memory.length);
    persist();
  },

  get pending(): ProposalBatch | null {
    const batch = state.pending;
    if (!batch || batch.proposals.length === 0 || batch.expiresAt <= Date.now()) return null;
    return batch;
  },
  get rawPending(): ProposalBatch | null {
    return state.pending;
  },
  setPending(batch: ProposalBatch): void {
    state.pending = batch;
    state.clarification = null;
    persist();
  },
  removeProposal(id: string): void {
    const batch = state.pending;
    if (!batch) return;
    const idx = batch.proposals.findIndex((p) => p.id === id);
    if (idx < 0) return;
    batch.proposals.splice(idx, 1);
    if (batch.proposals.length === 0) state.pending = null;
    persist();
  },
  updateProposalDestination(
    id: string,
    destination: { type: 'PROVIDER' | 'EMPLOYEE' | null; id: number | null; name: string | null },
  ): void {
    const batch = state.pending;
    if (!batch) return;
    const proposal = batch.proposals.find((p) => p.id === id);
    if (!proposal || proposal.tool !== 'registrar_pago_factura') return;

    proposal.args = {
      ...proposal.args,
      entity_type: destination.type,
      entity_id: destination.id,
      destino_nombre: destination.name,
    };

    const lines = proposal.summary
      .split('\n')
      .filter((line) => !line.startsWith('Destino:') && line !== 'Sin destino de fondos.');
    if (destination.type && destination.name) {
      lines.push(
        `Destino: ${destination.type === 'PROVIDER' ? 'Proveedor' : 'Empleado'} ${destination.name}`,
      );
    } else {
      lines.push('Sin destino de fondos.');
    }
    proposal.summary = lines.join('\n');
    persist();
  },
  get clarification(): Clarification | null {
    const clarification = state.clarification;
    if (!clarification || clarification.expiresAt <= Date.now()) return null;
    return clarification;
  },
  get rawClarification(): Clarification | null {
    return state.clarification;
  },
  setClarification(clarification: Clarification): void {
    state.clarification = clarification;
    state.comprobante = null;
    persist();
  },
  clearClarification(): Clarification | null {
    const current = state.clarification;
    state.clarification = null;
    persist();
    return current;
  },
  clearPending(): ProposalBatch | null {
    const current = state.pending;
    state.pending = null;
    persist();
    return current;
  },

  /** Comprobante con varias facturas posibles, esperando la elección del usuario. */
  get comprobante(): ComprobantePending | null {
    const pending = state.comprobante;
    if (!pending || pending.expiresAt <= Date.now() || pending.candidates.length === 0) {
      return null;
    }
    return pending;
  },
  get rawComprobante(): ComprobantePending | null {
    return state.comprobante;
  },
  setComprobante(pending: ComprobantePending): void {
    state.comprobante = pending;
    state.pending = null;
    state.clarification = null;
    persist();
  },
  clearComprobante(): ComprobantePending | null {
    const current = state.comprobante;
    state.comprobante = null;
    persist();
    return current;
  },

  get gaps(): GapItem[] {
    return state.gaps;
  },
  get newGapsCount(): number {
    return state.gaps.filter((gap) => gap.status === 'nuevo').length;
  },
  /** Guarda un pedido no cumplido. Evita duplicados idénticos recientes. */
  addGap(input: {
    pregunta: string;
    motivo?: string;
    respuestaParcial?: string;
    datasets?: string[];
    tools?: string[];
  }): GapItem | null {
    const pregunta = input.pregunta.trim().slice(0, 2000);
    if (!pregunta) return null;
    const norm = pregunta.toLowerCase().replace(/\s+/g, ' ');
    const now = Date.now();
    const existing = state.gaps.find(
      (gap) =>
        gap.status === 'nuevo' &&
        gap.pregunta.trim().toLowerCase().replace(/\s+/g, ' ') === norm &&
        now - gap.at < 15 * 60 * 1000,
    );
    if (existing) {
      if (input.motivo) existing.motivo = input.motivo.trim().slice(0, 1000);
      if (input.respuestaParcial) {
        existing.respuestaParcial = input.respuestaParcial.trim().slice(0, 4000);
      }
      if (input.datasets?.length) {
        existing.datasets = [...new Set([...existing.datasets, ...input.datasets])].slice(0, 20);
      }
      if (input.tools?.length) {
        existing.tools = [...new Set([...existing.tools, ...input.tools])].slice(0, 20);
      }
      existing.at = now;
      existing.updatedAt = now;
      persist();
      return existing;
    }
    const item: GapItem = {
      id: newId(),
      pregunta,
      motivo: (input.motivo ?? '').trim().slice(0, 1000),
      respuestaParcial: (input.respuestaParcial ?? '').trim().slice(0, 4000),
      datasets: [...new Set(input.datasets ?? [])].slice(0, 20),
      tools: [...new Set(input.tools ?? [])].slice(0, 20),
      at: now,
      updatedAt: now,
      status: 'nuevo',
    };
    state.gaps.unshift(item);
    if (state.gaps.length > 200) state.gaps.length = 200;
    persist();
    return item;
  },
  setGapStatus(id: string, status: GapStatus): void {
    const gap = state.gaps.find((item) => item.id === id);
    if (!gap) return;
    gap.status = status;
    gap.updatedAt = Date.now();
    persist();
  },
  removeGap(id: string): void {
    const idx = state.gaps.findIndex((gap) => gap.id === id);
    if (idx < 0) return;
    state.gaps.splice(idx, 1);
    state.deleted = state.deleted ?? emptyTombstones();
    state.deleted.gaps[id] = Date.now();
    persist();
  },
  clearGaps(status?: GapStatus): void {
    state.deleted = state.deleted ?? emptyTombstones();
    const now = Date.now();
    if (status) {
      for (let i = state.gaps.length - 1; i >= 0; i--) {
        if (state.gaps[i].status === status) {
          state.deleted.gaps[state.gaps[i].id] = now;
          state.gaps.splice(i, 1);
        }
      }
    } else {
      for (const gap of state.gaps) state.deleted.gaps[gap.id] = now;
      state.gaps.splice(0, state.gaps.length);
    }
    persist();
  },
};
