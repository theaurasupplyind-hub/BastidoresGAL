<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { assistant } from '$lib/assistant/store.svelte';
  import { sendMessage, confirmPending, cancelPending, undoCall } from '$lib/assistant/agent';
  import { undoOf } from '$lib/assistant/tools';
  import { MAX_ATTACHMENTS, prepareAttachment } from '$lib/assistant/image';
  import { putImage } from '$lib/assistant/imageStore';
  import { MODEL_SUGGESTIONS } from '$lib/assistant/storage';
  import { api } from '$lib/api/client';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import AssistantAttachmentThumb from '$lib/components/AssistantAttachmentThumb.svelte';
  import type { ChatMessage, PendingAttachment, Proposal, ToolCallView } from '$lib/assistant/types';

  type PendingImage = PendingAttachment & { url: string };

  let draft = $state('');
  let inputEl = $state<HTMLTextAreaElement | null>(null);
  let scrollEl = $state<HTMLDivElement | null>(null);
  let confirmDeleteChat = $state<string | null>(null);
  let undoConfirm = $state<string | null>(null);
  let showKey = $state(false);
  let settingsSaved = $state(false);
  let memoryDraft = $state('');
  let menuOpen = $state(false);
  let menuEl = $state<HTMLDivElement | null>(null);

  let pendingImages = $state<PendingImage[]>([]);
  let imageInput = $state<HTMLInputElement | null>(null);
  let processingImages = $state(false);
  let imageError = $state('');
  let previewUrl = $state<string | null>(null);
  let destroyed = false;

  type Position = { x: number; y: number };
  type Size = { w: number; h: number };
  type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

  /* El grip visible cubre 'se'; los demás son zonas invisibles. */
  const RESIZE_DIRS: ResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'sw'];
  const RESIZE_CURSORS: Record<ResizeDir, string> = {
    n: 'ns-resize',
    s: 'ns-resize',
    e: 'ew-resize',
    w: 'ew-resize',
    ne: 'nesw-resize',
    sw: 'nesw-resize',
    nw: 'nwse-resize',
    se: 'nwse-resize',
  };

  const POSITION_KEY = 'assistant:position';
  const SIZE_KEY = 'assistant:size';
  const EDGE = 16;

  const MAX_WIDTH_REM = 27;
  const MAX_HEIGHT_REM = 42;
  const MIN_WIDTH_REM = 20;
  const MIN_BODY_REM = 4.75;

  let panelEl = $state<HTMLDivElement | null>(null);
  let headEl = $state<HTMLElement | null>(null);
  let footEl = $state<HTMLElement | null>(null);
  let pos = $state<Position | null>(null);
  let size = $state<Size | null>(null);
  let entering = $state(true);
  let dragging = $state(false);
  let resizing = $state(false);
  let resizeDir = $state<ResizeDir | null>(null);
  let dragDelta = $state<Position>({ x: 0, y: 0 });
  let dragStart: Position = { x: 0, y: 0 };
  let resizeStart: { x: number; y: number; px: number; py: number; w: number; h: number } | null = null;
  let onWindowResize: (() => void) | null = null;
  let entranceTimer: ReturnType<typeof setTimeout> | null = null;

  let rafId = 0;
  let pendingPointer: Position | null = null;

  function rootPx(): number {
    const computed = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return Number.isFinite(computed) && computed > 0 ? computed : 16;
  }

  /** Tamaño máximo permitido: exactamente el que tenía la tarjeta por defecto. */
  function maxSize(): Size {
    const rem = rootPx();
    return {
      w: Math.max(EDGE * 2, Math.min(MAX_WIDTH_REM * rem, Math.round(window.innerWidth * 0.92))),
      h: Math.max(EDGE * 2, Math.min(MAX_HEIGHT_REM * rem, window.innerHeight - 3 * rem)),
    };
  }

  /** Alto mínimo: header + footer actuales + el espacio de un mensaje. */
  function minSize(): Size {
    const rem = rootPx();
    const max = maxSize();
    const chrome =
      headEl && footEl
        ? headEl.offsetHeight + footEl.offsetHeight
        : (headEl?.offsetHeight ?? 0) + 11.5 * rem;
    return {
      w: Math.min(MIN_WIDTH_REM * rem, max.w),
      h: Math.min(chrome + MIN_BODY_REM * rem, max.h),
    };
  }

  function clampSize(next: Size): Size {
    const max = maxSize();
    const min = minSize();
    return {
      w: Math.min(Math.max(min.w, next.w), max.w),
      h: Math.min(Math.max(min.h, next.h), max.h),
    };
  }

  function clampPosFor(next: Position, box: Size): Position {
    const maxX = Math.max(EDGE, window.innerWidth - box.w - EDGE);
    const maxY = Math.max(EDGE, window.innerHeight - box.h - EDGE);
    return {
      x: Math.min(Math.max(EDGE, next.x), maxX),
      y: Math.min(Math.max(EDGE, next.y), maxY),
    };
  }

  function currentSize(): Size {
    return size ?? {
      w: panelEl?.offsetWidth ?? Math.round(MAX_WIDTH_REM * rootPx()),
      h: panelEl?.offsetHeight ?? Math.round(MAX_HEIGHT_REM * rootPx()),
    };
  }

  function clampPos(next: Position): Position {
    return clampPosFor(next, currentSize());
  }

  /** Limita el desplazamiento del arrastre para que la tarjeta no salga de la pantalla. */
  function clampDragDelta(dx: number, dy: number): Position {
    const base = pos ?? { x: EDGE, y: EDGE };
    const box = currentSize();
    const maxX = Math.max(EDGE, window.innerWidth - box.w - EDGE);
    const maxY = Math.max(EDGE, window.innerHeight - box.h - EDGE);
    return {
      x: Math.min(Math.max(EDGE - base.x, dx), maxX - base.x),
      y: Math.min(Math.max(EDGE - base.y, dy), maxY - base.y),
    };
  }

  function cancelFrame() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    pendingPointer = null;
  }

  function schedulePointerUpdate() {
    if (rafId) return;
    rafId = requestAnimationFrame(flushPointerUpdate);
  }

  function flushPointerUpdate() {
    rafId = 0;
    const pointer = pendingPointer;
    pendingPointer = null;
    if (!pointer) return;
    if (dragging) {
      dragDelta = clampDragDelta(pointer.x - dragStart.x, pointer.y - dragStart.y);
      return;
    }
    if (resizing && resizeStart) {
      applyResize(pointer.x - resizeStart.x, pointer.y - resizeStart.y);
    }
  }

  function defaultPos(withSize: Size = currentSize()): Position {
    return clampPosFor(
      {
        x: window.innerWidth - withSize.w - 28,
        y: window.innerHeight - withSize.h - 28,
      },
      withSize,
    );
  }

  function loadPos(): Position | null {
    try {
      const raw = localStorage.getItem(POSITION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<Position>;
      if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return null;
      if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
      return { x: parsed.x, y: parsed.y };
    } catch {
      return null;
    }
  }

  function savePos(next: Position) {
    try {
      localStorage.setItem(POSITION_KEY, JSON.stringify(next));
    } catch {
      /* sin persistencia: la posición sigue funcionando en esta sesión */
    }
  }

  function loadSize(): Size | null {
    try {
      const raw = localStorage.getItem(SIZE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<Size>;
      if (typeof parsed.w !== 'number' || typeof parsed.h !== 'number') return null;
      if (!Number.isFinite(parsed.w) || !Number.isFinite(parsed.h)) return null;
      return { w: parsed.w, h: parsed.h };
    } catch {
      return null;
    }
  }

  function saveSize(next: Size) {
    try {
      localStorage.setItem(SIZE_KEY, JSON.stringify(next));
    } catch {
      /* sin persistencia: el tamaño sigue funcionando en esta sesión */
    }
  }

  function applySize(next: Size) {
    size = next;
    if (pos) pos = clampPosFor(pos, next);
  }

  function resetPos() {
    pos = defaultPos();
    savePos(pos);
  }

  function resetSize() {
    const next = clampSize(maxSize());
    applySize(next);
    saveSize(next);
  }

  function onHeaderPointerDown(event: PointerEvent) {
    if (event.button !== 0 || !panelEl) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, textarea, select, a, summary, .head-menu')) return;
    entering = false;
    dragging = true;
    dragStart = { x: event.clientX, y: event.clientY };
    dragDelta = { x: 0, y: 0 };
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      /* sin captura: el arrastre igual funciona mientras el puntero siga sobre la cabecera */
    }
    event.preventDefault();
  }

  function onHeaderPointerMove(event: PointerEvent) {
    if (!dragging) return;
    pendingPointer = { x: event.clientX, y: event.clientY };
    schedulePointerUpdate();
  }

  function onHeaderPointerUp(event: PointerEvent) {
    if (!dragging) return;
    cancelFrame();
    const delta = clampDragDelta(event.clientX - dragStart.x, event.clientY - dragStart.y);
    const base = pos ?? { x: EDGE, y: EDGE };
    pos = { x: base.x + delta.x, y: base.y + delta.y };
    dragDelta = { x: 0, y: 0 };
    dragging = false;
    const el = event.currentTarget as HTMLElement;
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
    if (pos) savePos(pos);
  }

  /** Si se pierde la captura (alt-tab, cambio de ventana) se finaliza el gesto sin salto. */
  function onHeaderLostCapture() {
    if (!dragging) return;
    cancelFrame();
    const base = pos ?? { x: EDGE, y: EDGE };
    pos = { x: base.x + dragDelta.x, y: base.y + dragDelta.y };
    dragDelta = { x: 0, y: 0 };
    dragging = false;
    savePos(pos);
  }

  function onHeaderDblClick(event: MouseEvent) {
    if ((event.target as HTMLElement).closest('button, .head-menu')) return;
    resetPos();
  }

  function onHeaderKeydown(event: KeyboardEvent) {
    const step = event.shiftKey ? 40 : 12;
    const deltas: Record<string, Position> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    const start = pos ?? defaultPos();
    pos = clampPos({ x: start.x + delta.x, y: start.y + delta.y });
    savePos(pos);
  }

  /**
   * Redimensiona desde cualquier lado: el borde opuesto queda fijo, la
   * posición se mueve al arrastrar desde izquierda o arriba y se respeta
   * el tamaño mínimo/máximo y los márgenes de pantalla (EDGE).
   */
  function applyResize(dx: number, dy: number) {
    if (!resizeStart || !resizeDir) return;
    const min = minSize();
    const max = maxSize();
    const { px, py, w: startW, h: startH } = resizeStart;
    let width = startW;
    let height = startH;

    if (resizeDir.includes('e')) width = startW + dx;
    if (resizeDir.includes('w')) width = startW - dx;
    if (resizeDir.includes('s')) height = startH + dy;
    if (resizeDir.includes('n')) height = startH - dy;

    /* No cruzar el margen opuesto de la pantalla. */
    if (resizeDir.includes('e')) width = Math.min(width, window.innerWidth - EDGE - px);
    if (resizeDir.includes('w')) width = Math.min(width, px + startW - EDGE);
    if (resizeDir.includes('s')) height = Math.min(height, window.innerHeight - EDGE - py);
    if (resizeDir.includes('n')) height = Math.min(height, py + startH - EDGE);

    width = Math.min(Math.max(min.w, width), max.w);
    height = Math.min(Math.max(min.h, height), max.h);

    size = { w: width, h: height };
    pos = {
      x: resizeDir.includes('w') ? px + startW - width : px,
      y: resizeDir.includes('n') ? py + startH - height : py,
    };
  }

  function onResizePointerDown(dir: ResizeDir, event: PointerEvent) {
    if (event.button !== 0 || !panelEl) return;
    const box = currentSize();
    const start = pos ?? defaultPos(box);
    entering = false;
    resizing = true;
    resizeDir = dir;
    resizeStart = {
      x: event.clientX,
      y: event.clientY,
      px: start.x,
      py: start.y,
      w: box.w,
      h: box.h,
    };
    document.body.style.cursor = RESIZE_CURSORS[dir];
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      /* sin captura: el redimensionado sigue mientras el puntero esté sobre la zona */
    }
    event.preventDefault();
    event.stopPropagation();
  }

  function onResizePointerMove(event: PointerEvent) {
    if (!resizing) return;
    pendingPointer = { x: event.clientX, y: event.clientY };
    schedulePointerUpdate();
  }

  function onResizePointerUp(event: PointerEvent) {
    if (!resizing) return;
    cancelFrame();
    if (resizeStart) {
      applyResize(event.clientX - resizeStart.x, event.clientY - resizeStart.y);
      if (size) saveSize(size);
      if (pos) savePos(pos);
    } else if (size) {
      saveSize(size);
    }
    resizing = false;
    resizeDir = null;
    resizeStart = null;
    document.body.style.cursor = '';
    const el = event.currentTarget as HTMLElement;
    if (el.hasPointerCapture(event.pointerId)) el.releasePointerCapture(event.pointerId);
  }

  function onResizeKeydown(event: KeyboardEvent) {
    const step = event.shiftKey ? 40 : 12;
    const deltas: Record<string, Position> = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    const start = currentSize();
    const next = clampSize({ w: start.w + delta.x, h: start.h + delta.y });
    applySize(next);
    saveSize(next);
  }

  function onResizeDblClick() {
    resetSize();
  }

  function onResizeBlur() {
    if (!resizing) return;
    cancelFrame();
    resizing = false;
    resizeDir = null;
    resizeStart = null;
    document.body.style.cursor = '';
    if (size) saveSize(size);
    if (pos) savePos(pos);
  }

  let destinationEditFor = $state<string | null>(null);
  let destinationOptions = $state<{
    providers: Array<{ id: number; name: string }>;
    employees: Array<{ id: number; name: string }>;
  } | null>(null);
  let destinationLoading = $state(false);
  let destinationError = $state('');

  let apiKeyDraft = $state('');
  let modelDraft = $state('');
  let tempDraft = $state(0.2);

  const suggestions = [
    '¿Qué tareas tengo pendientes?',
    '¿Quién vino hoy?',
    '¿A quién le debemos?',
    'Resumen de gastos de este mes',
    '¿Cuánto debe Aldo?',
    '¿Cuántas facturas hay por estado?',
    'Creá una tarea: llamar a Juan por las molduras',
  ];

  $effect(() => {
    if (assistant.open && assistant.view === 'settings') {
      // La key real nunca vuelve del backend: el campo es solo para reemplazarla.
      apiKeyDraft = '';
      modelDraft = assistant.settings.model;
      tempDraft = assistant.settings.temperature;
    }
  });

  /* Cierra el menú al hacer clic afuera. */
  $effect(() => {
    if (!menuOpen) return;
    const onDocPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (menuEl?.contains(target) || target.closest('.menu-toggle')) return;
      menuOpen = false;
    };
    document.addEventListener('pointerdown', onDocPointerDown, true);
    return () => document.removeEventListener('pointerdown', onDocPointerDown, true);
  });

  /* Al salir del chat no puede quedar abierto el menú. */
  $effect(() => {
    if (assistant.view !== 'chat') menuOpen = false;
  });

  $effect(() => {
    const last = assistant.messages[assistant.messages.length - 1];
    const pending = assistant.pending;
    void last;
    void pending;
    tick().then(scrollToBottom);
  });

  $effect(() => {
    const el = inputEl;
    if (!el) return;
    const value = draft;
    void size;
    el.style.height = 'auto';
    el.style.height = `${Math.min(132, Math.max(40, el.scrollHeight))}px`;
    void value;
  });

  onMount(() => {
    tick().then(() => {
      const next = clampSize(loadSize() ?? maxSize());
      size = next;
      pos = clampPosFor(loadPos() ?? defaultPos(next), next);
      scrollToBottom();
      inputEl?.focus();
    });
    onWindowResize = () => {
      const next = clampSize(size ?? maxSize());
      size = next;
      pos = pos ? clampPosFor(pos, next) : defaultPos(next);
    };
    window.addEventListener('resize', onWindowResize);
    /* Red de seguridad: si el navegador no emite animationend, la clase se limpia igual. */
    entranceTimer = setTimeout(() => {
      entranceTimer = null;
      entering = false;
    }, 400);
  });

  onDestroy(() => {
    destroyed = true;
    cancelFrame();
    if (entranceTimer) clearTimeout(entranceTimer);
    if (onWindowResize) window.removeEventListener('resize', onWindowResize);
    for (const img of pendingImages) URL.revokeObjectURL(img.url);
  });

  function scrollToBottom() {
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  async function addFiles(files: FileList | File[] | null) {
    if (!files || assistant.busy || processingImages) return;
    const all = Array.from(files);
    const list = all.filter((file) => file.type.startsWith('image/'));
    if (list.length === 0) {
      imageError = 'Solo se aceptan imágenes JPG, PNG o WEBP.';
      return;
    }
    if (list.length < all.length) {
      imageError = 'Algunos archivos no son imágenes y se ignoraron.';
    }

    const remaining = MAX_ATTACHMENTS - pendingImages.length;
    if (remaining <= 0) {
      imageError = `Máximo ${MAX_ATTACHMENTS} imágenes por mensaje.`;
      return;
    }

    imageError = '';
    processingImages = true;
    try {
      for (const file of list.slice(0, remaining)) {
        try {
          const prepared = await prepareAttachment(file);
          const url = URL.createObjectURL(prepared.blob);
          if (destroyed) {
            URL.revokeObjectURL(url);
            break;
          }
          pendingImages.push({ ...prepared, url });
        } catch (err) {
          imageError = err instanceof Error ? err.message : String(err);
        }
      }
      if (list.length > remaining) {
        imageError = `Máximo ${MAX_ATTACHMENTS} imágenes por mensaje.`;
      }
    } finally {
      processingImages = false;
    }
  }

  function onImageInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    void addFiles(input.files);
    input.value = '';
  }

  function removePendingImage(id: string) {
    const index = pendingImages.findIndex((img) => img.attachment.id === id);
    if (index < 0) return;
    URL.revokeObjectURL(pendingImages[index].url);
    pendingImages.splice(index, 1);
    imageError = '';
  }

  function onComposerPaste(event: ClipboardEvent) {
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (files.length === 0) return;
    event.preventDefault();
    void addFiles(files);
  }

  function onComposerDrop(event: DragEvent) {
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    event.preventDefault();
    void addFiles(files);
  }

  function onComposerDragOver(event: DragEvent) {
    if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
  }

  async function send(text?: string) {
    const value = (text ?? draft).trim();
    if (assistant.busy || processingImages) return;
    if (!value && pendingImages.length === 0) return;

    const images = [...pendingImages];
    if (images.length > 0) {
      try {
        await Promise.all(images.map((img) => putImage(img.attachment.id, img.blob)));
      } catch {
        imageError = 'No se pudo guardar la imagen. Probá de nuevo.';
        return;
      }
    }

    draft = '';
    pendingImages = [];
    imageError = '';
    for (const img of images) URL.revokeObjectURL(img.url);

    await sendMessage(
      value,
      images.map(({ attachment, blob }) => ({ attachment, blob })),
    );
    await tick();
    scrollToBottom();
    inputEl?.focus();
  }

  function onComposerKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    void send();
  }

  function onPanelKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (menuOpen) {
      event.preventDefault();
      menuOpen = false;
      return;
    }
    if (previewUrl) {
      event.preventDefault();
      previewUrl = null;
      return;
    }
    if (assistant.busy) return;
    event.preventDefault();
    assistant.closeDrawer();
  }

  function saveSettings() {
    assistant.updateSettings({
      apiKey: apiKeyDraft,
      model: modelDraft.trim() || assistant.settings.model,
      temperature: tempDraft,
    });
    apiKeyDraft = '';
    settingsSaved = true;
    setTimeout(() => (settingsSaved = false), 1600);
  }

  function forgetKey() {
    if (!confirm('¿Quitar la API key de OpenRouter del backend? El asistente deja de responder.')) {
      return;
    }
    assistant.clearApiKey();
  }

  function forgetAll() {
    assistant.clearMemory();
  }

  function addMemory() {
    const text = memoryDraft.trim();
    if (!text) return;
    assistant.addMemory('fact', text);
    memoryDraft = '';
  }

  function timeOf(at: number): string {
    return new Date(at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }

  function dateOf(at: number): string {
    return new Date(at).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
  }

  function modelLabel(model: string): string {
    return model.split('/').pop() ?? model;
  }

  function previewJson(value: unknown): string {
    try {
      const text = JSON.stringify(value, null, 2);
      if (!text) return '';
      return text.length > 1800 ? `${text.slice(0, 1800)}\n…` : text;
    } catch {
      return String(value);
    }
  }

  function hasArgs(call: ToolCallView): boolean {
    return Object.keys(call.args ?? {}).length > 0;
  }

  function toolLine(message: ChatMessage): string {
    return (message.toolCalls ?? []).map((t) => t.name).join(' · ');
  }

  function undoKey(messageId: string, callId: string): string {
    return `${messageId}:${callId}`;
  }

  async function runUndo(messageId: string, callId: string) {
    undoConfirm = null;
    await undoCall(messageId, callId);
  }

  function proposalBadge(proposal: Proposal): string {
    if (proposal.effect === 'destructive') return 'Eliminar';
    switch (proposal.tool) {
      case 'crear_factura':
        return 'Factura';
      case 'registrar_gasto':
        return 'Gasto';
      case 'registrar_pago_sueldo':
        return 'Sueldo';
      case 'registrar_movimiento_proveedor':
        return 'Proveedor';
      case 'registrar_pago_factura':
        return 'Pago';
      default:
        return 'Cambio';
    }
  }

  async function openDestinationEditor(proposalId: string) {
    destinationEditFor = proposalId;
    destinationLoading = true;
    destinationError = '';
    try {
      const [providers, employees] = await Promise.all([
        cacheStore.fetch('providers', () => api.listProviders(), 900_000),
        cacheStore.fetch('employees:active', () => api.listEmployees(true), 900_000),
      ]);
      destinationOptions = {
        providers: providers.map((p) => ({ id: p.id, name: p.name })),
        employees: employees.filter((e) => e.active).map((e) => ({ id: e.id, name: e.name })),
      };
    } catch {
      destinationError = 'No se pudieron cargar los destinos.';
    } finally {
      destinationLoading = false;
    }
  }

  function destinationValue(proposal: Proposal): string {
    const type = proposal.args.entity_type;
    const id = proposal.args.entity_id;
    if ((type === 'PROVIDER' || type === 'EMPLOYEE') && typeof id === 'number') {
      return `${type}:${id}`;
    }
    return '';
  }

  function saveDestination(proposalId: string, value: string) {
    if (!value) {
      assistant.updateProposalDestination(proposalId, { type: null, id: null, name: null });
      destinationEditFor = null;
      return;
    }
    const [type, rawId] = value.split(':');
    const id = Number(rawId);
    if ((type !== 'PROVIDER' && type !== 'EMPLOYEE') || !Number.isFinite(id)) return;
    const name =
      type === 'PROVIDER'
        ? (destinationOptions?.providers.find((p) => p.id === id)?.name ?? null)
        : (destinationOptions?.employees.find((e) => e.id === id)?.name ?? null);
    assistant.updateProposalDestination(proposalId, { type, id, name });
    destinationEditFor = null;
  }

  function sortedConversations() {
    return [...assistant.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  }
</script>

<div
  class="assistant-panel"
  class:entering
  class:dragging
  class:resizing
  bind:this={panelEl}
  style:left={pos ? `${pos.x}px` : undefined}
  style:top={pos ? `${pos.y}px` : undefined}
  style:width={size ? `${size.w}px` : undefined}
  style:height={size ? `${size.h}px` : undefined}
  style:transform={dragging && (dragDelta.x !== 0 || dragDelta.y !== 0)
    ? `translate3d(${dragDelta.x}px, ${dragDelta.y}px, 0)`
    : undefined}
  role="dialog"
  aria-label="Asistente de Bastidores GAL"
  tabindex="-1"
  onanimationend={(event) => {
    if (event.target === event.currentTarget) entering = false;
  }}
  onkeydown={onPanelKeydown}
>
  <header
    class="panel-head"
    bind:this={headEl}
    role="toolbar"
    aria-label="Mover asistente"
    tabindex="0"
    title="Arrastrá para mover · doble clic para recentrar"
    onpointerdown={onHeaderPointerDown}
    onpointermove={onHeaderPointerMove}
    onpointerup={onHeaderPointerUp}
    onpointercancel={onHeaderPointerUp}
    onlostpointercapture={onHeaderLostCapture}
    onkeydown={onHeaderKeydown}
    ondblclick={onHeaderDblClick}
  >
    {#if assistant.view === 'chat'}
      <div class="head-actions">
        <button type="button" class="icon-btn tiny" title="Nueva conversación" aria-label="Nueva conversación" onclick={() => assistant.newChat()} disabled={assistant.busy}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button
          type="button"
          class="icon-btn tiny menu-toggle"
          class:active={menuOpen}
          title="Menú"
          aria-label="Menú"
          aria-haspopup="true"
          aria-expanded={menuOpen}
          onclick={() => (menuOpen = !menuOpen)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
        </button>
        <button type="button" class="icon-btn tiny" title="Cerrar (Esc)" aria-label="Cerrar" onclick={() => assistant.closeDrawer()} disabled={assistant.busy}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      {#if menuOpen}
        <div class="head-menu" bind:this={menuEl} title="">
          <button type="button" class="menu-item" onclick={() => { assistant.setView('history'); menuOpen = false; }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 109-9 9 9 0 00-7.5 4" /><path d="M3 4v5h5" /><path d="M12 8v4l3 2" /></svg>
            <span>Historial</span>
          </button>
          <button type="button" class="menu-item" onclick={() => { assistant.setView('memory'); menuOpen = false; }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3a3 3 0 00-3 3 3 3 0 00-2 5.2A3 3 0 005 17a3 3 0 003 3h1V3H9z" /><path d="M15 3a3 3 0 013 3 3 3 0 012 5.2A3 3 0 0119 17a3 3 0 01-3 3h-1V3h0z" /></svg>
            <span>Memoria</span>
          </button>
          <button type="button" class="menu-item" onclick={() => { assistant.setView('gaps'); menuOpen = false; }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></svg>
            <span>Pendientes{assistant.newGapsCount > 0 ? ` (${assistant.newGapsCount})` : ''}</span>
          </button>
          <button type="button" class="menu-item" onclick={() => { assistant.setView('settings'); menuOpen = false; }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg>
            <span>Ajustes</span>
          </button>
          <div class="menu-foot">
            <span class="menu-metrics">
              {modelLabel(assistant.settings.model)}{#if assistant.lastRun}
                · {(assistant.lastRun.ms / 1000).toFixed(1).replace('.', ',')} s{#if assistant.lastRun.tokens}
                  · {assistant.lastRun.tokens} tok{/if}{/if}
            </span>
            <span class="menu-hint">Enter envía · Ctrl+J cierra</span>
          </div>
        </div>
      {/if}
    {:else}
      <div class="head-title">
        <button type="button" class="icon-btn back" title="Volver" aria-label="Volver" onclick={() => assistant.setView('chat')}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div class="head-text">
          <h2>{assistant.view === 'settings' ? 'Ajustes' : assistant.view === 'memory' ? 'Memoria' : assistant.view === 'gaps' ? 'Pendientes' : 'Historial'}</h2>
          <span class="head-sub">
            {assistant.view === 'settings' ? 'OpenRouter · solo prototipo' : assistant.view === 'memory' ? `${assistant.memory.length} recuerdos` : assistant.view === 'gaps' ? `${assistant.newGapsCount} nuevos · ${assistant.gaps.length} total` : `${assistant.conversations.length} conversaciones`}
          </span>
        </div>
      </div>
      <div class="head-actions">
        <button type="button" class="icon-btn" title="Cerrar (Esc)" aria-label="Cerrar" onclick={() => assistant.closeDrawer()} disabled={assistant.busy}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
    {/if}
  </header>

  {#if assistant.view === 'settings'}
    <div class="panel-body settings-body">
      <label class="field">
        <span class="field-label">
          API key de OpenRouter
          {#if assistant.hasApiKey}
            <span class="muted small">· configurada</span>
          {:else}
            <span class="muted small">· sin configurar</span>
          {/if}
        </span>
        <div class="key-row">
          <input
            type={showKey ? 'text' : 'password'}
            bind:value={apiKeyDraft}
            placeholder={assistant.hasApiKey ? 'Escribí una nueva para reemplazarla' : 'sk-or-v1-…'}
            autocomplete="off"
            spellcheck="false"
          />
          <button type="button" class="btn btn-secondary btn-sm" onclick={() => (showKey = !showKey)}>
            {showKey ? 'Ocultar' : 'Ver'}
          </button>
        </div>
      </label>

      <label class="field">
        <span class="field-label">Modelo</span>
        <input bind:value={modelDraft} list="assistant-models" spellcheck="false" placeholder="proveedor/modelo" />
        <datalist id="assistant-models">
          {#each MODEL_SUGGESTIONS as model}
            <option value={model}></option>
          {/each}
        </datalist>
      </label>

      <label class="field">
        <span class="field-label">Temperatura <span class="muted">{tempDraft.toFixed(1)}</span></span>
        <input type="range" min="0" max="1" step="0.1" bind:value={tempDraft} />
      </label>

      <div class="settings-actions">
        <button type="button" class="btn btn-primary btn-sm" onclick={saveSettings}>
          {settingsSaved ? 'Guardado ✓' : 'Guardar'}
        </button>
        {#if assistant.hasApiKey}
          <button type="button" class="btn btn-secondary btn-sm" onclick={forgetKey}>
            Quitar clave
          </button>
        {/if}
        {#if assistant.configured}
          <span class="muted small">Listo para usar</span>
        {/if}
        {#if assistant.syncing}
          <span class="muted small">Sincronizando…</span>
        {/if}
      </div>

      {#if assistant.syncError}
        <p class="note" style="color: var(--danger);">{assistant.syncError}</p>
      {/if}

      <p class="note">
        La clave se guarda en el backend y se comparte entre estaciones; no viaja a este equipo.
        Las llamadas al modelo pasan por el servidor.
      </p>

      <p class="note">
        Las fotos de comprobantes quedan en este equipo (IndexedDB) y se envían al modelo para
        analizarlas. En otras estaciones se ve un placeholder.
      </p>
    </div>
  {:else if assistant.view === 'memory'}
    <div class="panel-body memory-body">
      <div class="memory-add">
        <input
          bind:value={memoryDraft}
          aria-label="Nuevo recuerdo"
          placeholder="Ej: el cliente Aldo paga siempre por transferencia"
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addMemory();
            }
          }}
        />
        <button type="button" class="btn btn-secondary btn-sm" onclick={addMemory} disabled={!memoryDraft.trim()}>
          Agregar
        </button>
      </div>

      {#if assistant.memory.length === 0}
        <p class="empty-note">
          Todavía no hay recuerdos. Escribí “recordá que…” en el chat y se guarda acá.
        </p>
      {:else}
        <ul class="memory-list">
          {#each assistant.memory as item (item.id)}
            <li class="memory-item">
              <div class="memory-main">
                <span class="memory-chip">{item.category}</span>
                <p>{item.content}</p>
              </div>
              <button type="button" class="icon-btn tiny" title="Olvidar" aria-label="Olvidar" onclick={() => assistant.removeMemory(item.id)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </li>
          {/each}
        </ul>
        <button type="button" class="btn btn-danger btn-sm forget" onclick={forgetAll}>Olvidar todo</button>
      {/if}
    </div>
  {:else if assistant.view === 'gaps'}
    <div class="panel-body memory-body">
      {#if assistant.gaps.length === 0}
        <p class="empty-note">
          Todavía no hay pedidos pendientes. Cuando el asistente no pueda resolver algo, lo anota acá
          para revisarlo después.
        </p>
      {:else}
        <div class="gap-toolbar">
          <span>{assistant.newGapsCount} nuevos · {assistant.gaps.length} en total</span>
          {#if assistant.newGapsCount > 0}
            <button type="button" class="btn btn-secondary btn-xs" onclick={() => assistant.clearGaps('nuevo')}>
              Limpiar nuevos
            </button>
          {/if}
        </div>
        <ul class="memory-list">
          {#each assistant.gaps as gap (gap.id)}
            <li class="gap-item" class:closed={gap.status === 'resuelto' || gap.status === 'descartado'}>
              <div class="gap-main">
                <div class="gap-head">
                  <span class="memory-chip">{gap.status}</span>
                  <span class="gap-date">{dateOf(gap.at)} {timeOf(gap.at)}</span>
                </div>
                <p class="gap-question">{gap.pregunta}</p>
                {#if gap.motivo}<p class="gap-meta">{gap.motivo}</p>{/if}
                {#if gap.respuestaParcial}<p class="gap-answer">{gap.respuestaParcial}</p>{/if}
                {#if gap.datasets.length > 0}
                  <p class="gap-meta">Datos leídos: {gap.datasets.join(', ')}</p>
                {/if}
                <div class="gap-actions">
                  <button type="button" class="btn btn-secondary btn-xs" onclick={() => assistant.setGapStatus(gap.id, 'revisado')}>
                    Revisado
                  </button>
                  <button type="button" class="btn btn-secondary btn-xs" onclick={() => assistant.setGapStatus(gap.id, 'resuelto')}>
                    Resuelto
                  </button>
                  <button type="button" class="btn btn-danger btn-xs" onclick={() => assistant.setGapStatus(gap.id, 'descartado')}>
                    Descartar
                  </button>
                </div>
              </div>
              <button
                type="button"
                class="icon-btn tiny"
                title="Eliminar"
                aria-label="Eliminar"
                onclick={() => assistant.removeGap(gap.id)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {:else if assistant.view === 'history'}
    <div class="panel-body history-body">
      {#each sortedConversations() as conv (conv.id)}
        <div class="history-item" class:active={conv.id === assistant.activeId}>
          <button type="button" class="history-main" onclick={() => assistant.selectChat(conv.id)}>
            <span class="history-title">{conv.title}</span>
            <span class="history-meta">{conv.messages.length} mensajes · {dateOf(conv.updatedAt)} {timeOf(conv.updatedAt)}</span>
          </button>
          {#if confirmDeleteChat === conv.id}
            <div class="history-confirm">
              <button type="button" class="btn btn-secondary btn-xs" onclick={() => (confirmDeleteChat = null)}>No</button>
              <button
                type="button"
                class="btn btn-danger btn-xs"
                onclick={() => {
                  assistant.deleteChat(conv.id);
                  confirmDeleteChat = null;
                }}>Borrar</button>
            </div>
          {:else}
            <button type="button" class="icon-btn tiny" title="Borrar conversación" aria-label="Borrar conversación" onclick={() => (confirmDeleteChat = conv.id)}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></svg>
            </button>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <div class="panel-body chat-body" bind:this={scrollEl}>
      {#if !assistant.configured}
        <div class="setup-card">
          <h3>Configurá el asistente</h3>
          <p>Pegá tu API key de OpenRouter. Se guarda solo en esta máquina y la usás para probar el asistente.</p>
          <button type="button" class="btn btn-primary btn-sm" onclick={() => assistant.setView('settings')}>
            Abrir ajustes
          </button>
        </div>
      {:else if assistant.messages.length === 0}
        <div class="empty-state">
          <div class="glow" aria-hidden="true"></div>
          <div class="empty-inner">
            <h3>¿En qué te ayudo?</h3>
            <p>Consulto tareas, clientes, deudas y gastos. Los cambios los confirmás vos.</p>
            <div class="suggestions">
              {#each suggestions as suggestion}
                <button type="button" class="suggestion" onclick={() => send(suggestion)} disabled={assistant.busy}>
                  {suggestion}
                </button>
              {/each}
            </div>
          </div>
        </div>
      {/if}

      {#each assistant.messages as message (message.id)}
        <div class="msg" class:user={message.role === 'user'} class:assistant={message.role === 'assistant'} class:failed={message.error}>
          {#if message.content.trim()}
            <div class="bubble">{message.content}</div>
          {/if}
          {#if message.attachments?.length}
            <div class="msg-attachments">
              {#each message.attachments as attachment (attachment.id)}
                <AssistantAttachmentThumb {attachment} onopen={(url) => (previewUrl = url)} />
              {/each}
            </div>
          {/if}
          {#if message.toolCalls?.some((call) => undoOf(call))}
            <div class="undo-row">
              {#each message.toolCalls as call (call.id)}
                {@const undo = undoOf(call)}
                {#if undo}
                  {#if undo.doneAt}
                    <span class="undo-done">Deshecho</span>
                  {:else if undoConfirm === undoKey(message.id, call.id)}
                    <span class="undo-question">¿Eliminar {undo.message}?</span>
                    <button
                      type="button"
                      class="undo-btn danger"
                      disabled={assistant.busy}
                      onclick={() => runUndo(message.id, call.id)}
                    >
                      Sí, deshacer
                    </button>
                    <button
                      type="button"
                      class="undo-btn"
                      disabled={assistant.busy}
                      onclick={() => (undoConfirm = null)}
                    >
                      Cancelar
                    </button>
                  {:else}
                    <button
                      type="button"
                      class="undo-btn"
                      disabled={assistant.busy}
                      onclick={() => (undoConfirm = undoKey(message.id, call.id))}
                    >
                      Deshacer {undo.label}
                    </button>
                  {/if}
                {/if}
              {/each}
            </div>
          {/if}
          {#if message.toolCalls?.length}
            <details class="tools">
              <summary>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.3 2.3-2-2 2.3-2.3z" />
                </svg>
                <span class="tools-label">{toolLine(message)}</span>
              </summary>
              {#each message.toolCalls as call (call.id)}
                <div class="tool-row">
                  <div class="tool-head">
                    <span class="tool-name">{call.name}</span>
                    <span class="tool-meta">{call.pending ? 'pendiente' : call.effect} · {call.ms} ms</span>
                  </div>
                  {#if call.note}
                    <p class="tool-note">{call.note}</p>
                  {/if}
                  {#if hasArgs(call)}
                    <pre class="tool-json">{previewJson(call.args)}</pre>
                  {/if}
                  {#if call.error}
                    <p class="tool-error">{call.error}</p>
                  {:else if call.result !== undefined}
                    <pre class="tool-json result">{previewJson(call.result)}</pre>
                  {/if}
                </div>
              {/each}
            </details>
          {/if}
          <span class="msg-time">{timeOf(message.at)}</span>
        </div>
      {/each}

      {#if assistant.busy}
        <div class="msg assistant">
          <div class="bubble typing"><span></span><span></span><span></span></div>
        </div>
        {#if assistant.slow}
          <div class="slow-hint">Despertando el servidor…</div>
        {/if}
      {/if}

      {#if assistant.error}
        <div class="assistant-error" role="alert">
          <p>{assistant.error}</p>
          <button type="button" class="icon-btn tiny" title="Cerrar aviso" aria-label="Cerrar aviso" onclick={() => assistant.setError(null)}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
      {/if}

      {#if assistant.pending}
        {@const batch = assistant.pending}
        {@const allDestructive = batch.proposals.every((p) => p.effect === 'destructive')}
        <div class="proposal" class:destructive={allDestructive}>
          <div class="proposal-head">
            <span class="proposal-badge">
              {batch.proposals.length === 1 ? proposalBadge(batch.proposals[0]) : `${batch.proposals.length} acciones`}
            </span>
            <span class="proposal-tool">
              {batch.proposals.length === 1 ? batch.proposals[0].tool : 'confirmación pendiente'}
            </span>
          </div>
          <ul class="proposal-list">
            {#each batch.proposals as proposal (proposal.id)}
              <li class="proposal-item">
                <div class="proposal-item-main">
                  {#if batch.proposals.length > 1}
                    <span class="proposal-item-badge" class:destructive={proposal.effect === 'destructive'}>
                      {proposalBadge(proposal)}
                    </span>
                  {/if}
                  <p class="proposal-summary">{proposal.summary}</p>
                  {#if proposal.tool === 'registrar_pago_factura' && proposal.args.metodo === 'Transferencia'}
                    {#if destinationEditFor === proposal.id}
                      <div class="destination-editor">
                        {#if destinationLoading}
                          <span class="destination-note">Cargando destinos…</span>
                        {:else if destinationOptions}
                          <select
                            aria-label="Destino de fondos"
                            value={destinationValue(proposal)}
                            onchange={(event) => saveDestination(proposal.id, event.currentTarget.value)}
                            disabled={assistant.busy}
                          >
                            <option value="">Sin destino</option>
                            <optgroup label="Proveedores">
                              {#each destinationOptions.providers as provider (provider.id)}
                                <option value={`PROVIDER:${provider.id}`}>{provider.name}</option>
                              {/each}
                            </optgroup>
                            <optgroup label="Empleados">
                              {#each destinationOptions.employees as employee (employee.id)}
                                <option value={`EMPLOYEE:${employee.id}`}>{employee.name}</option>
                              {/each}
                            </optgroup>
                          </select>
                        {:else}
                          <span class="destination-note">{destinationError}</span>
                        {/if}
                        <button type="button" class="proposal-edit-link" onclick={() => (destinationEditFor = null)}>
                          Cerrar
                        </button>
                      </div>
                    {:else}
                      <button
                        type="button"
                        class="proposal-edit-link"
                        onclick={() => openDestinationEditor(proposal.id)}
                        disabled={assistant.busy}
                      >
                        Editar destino
                      </button>
                    {/if}
                  {/if}
                </div>
                <button
                  type="button"
                  class="icon-btn tiny"
                  title="Quitar esta acción"
                  aria-label="Quitar esta acción"
                  onclick={() => assistant.removeProposal(proposal.id)}
                  disabled={assistant.busy}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </li>
            {/each}
          </ul>
          <div class="proposal-actions">
            <button type="button" class="btn btn-secondary btn-sm" onclick={() => cancelPending()} disabled={assistant.busy}>
              Cancelar
            </button>
            <button
              type="button"
              class="btn btn-sm {allDestructive ? 'btn-danger' : 'btn-primary'}"
              onclick={() => confirmPending()}
              disabled={assistant.busy}
            >
              {assistant.busy
                ? 'Ejecutando…'
                : batch.proposals.length === 1
                  ? allDestructive
                    ? 'Eliminar'
                    : 'Confirmar'
                  : `Confirmar ${batch.proposals.length}`}
            </button>
          </div>
        </div>
      {/if}
    </div>

    <footer class="panel-foot" bind:this={footEl}>
      {#if assistant.configured}
        {#if pendingImages.length > 0}
          <div class="composer-attachments" aria-label="Imágenes adjuntas">
            {#each pendingImages as img (img.attachment.id)}
              <div class="composer-thumb">
                <img src={img.url} alt={img.attachment.name} />
                <button
                  type="button"
                  class="composer-thumb-remove"
                  title="Quitar imagen"
                  aria-label="Quitar imagen"
                  onclick={() => removePendingImage(img.attachment.id)}
                  disabled={assistant.busy}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
            {/each}
          </div>
        {/if}
        {#if imageError}
          <p class="composer-error" role="alert">{imageError}</p>
        {/if}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          class="assistant-file-input"
          bind:this={imageInput}
          onchange={onImageInput}
        />
        <div class="composer" role="group" aria-label="Redactar mensaje" ondragover={onComposerDragOver} ondrop={onComposerDrop}>
          <button
            type="button"
            class="attach-btn"
            title="Adjuntar imagen"
            aria-label="Adjuntar imagen"
            onclick={() => imageInput?.click()}
            disabled={assistant.busy || processingImages || pendingImages.length >= MAX_ATTACHMENTS}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
          </button>
          <textarea
            bind:this={inputEl}
            bind:value={draft}
            rows="1"
            aria-label="Mensaje para el asistente"
            placeholder={pendingImages.length > 0
              ? 'Agregá una instrucción (opcional)…'
              : assistant.pending
                ? 'Confirmá, cancelá o corregí…'
                : 'Escribí o pegá una imagen…'}
            onkeydown={onComposerKeydown}
            onpaste={onComposerPaste}
            disabled={assistant.busy}
          ></textarea>
          <button
            type="button"
            class="send-btn"
            title="Enviar (Enter)"
            aria-label="Enviar"
            onclick={() => send()}
            disabled={assistant.busy || processingImages || (!draft.trim() && pendingImages.length === 0)}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        </div>
      {:else}
        <button type="button" class="btn btn-primary" onclick={() => assistant.setView('settings')}>
          Configurar API key
        </button>
      {/if}
    </footer>
  {/if}

  {#if previewUrl}
    <button
      type="button"
      class="image-lightbox"
      aria-label="Cerrar imagen"
      onclick={() => (previewUrl = null)}
    >
      <img src={previewUrl} alt="Imagen adjunta" />
      <span class="lightbox-close" aria-hidden="true">×</span>
    </button>
  {/if}

  {#each RESIZE_DIRS as dir (dir)}
    <button
      type="button"
      class="resize-zone rz-{dir}"
      tabindex="-1"
      aria-hidden="true"
      onpointerdown={(event) => onResizePointerDown(dir, event)}
      onpointermove={onResizePointerMove}
      onpointerup={onResizePointerUp}
      onpointercancel={onResizePointerUp}
      onlostpointercapture={onResizeBlur}
    ></button>
  {/each}

  <button
    type="button"
    class="resize-grip"
    class:active={resizing}
    title="Arrastrar para redimensionar · doble clic para tamaño máximo"
    aria-label="Redimensionar asistente"
    onpointerdown={(event) => onResizePointerDown('se', event)}
    onpointermove={onResizePointerMove}
    onpointerup={onResizePointerUp}
    onpointercancel={onResizePointerUp}
    onlostpointercapture={onResizeBlur}
    onkeydown={onResizeKeydown}
    ondblclick={onResizeDblClick}
  >
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
      <path d="M11 4L4 11" />
      <path d="M11 8L8 11" />
      <path d="M11 11.5h.01" />
    </svg>
  </button>
</div>

<style>
  .assistant-panel {
    position: fixed;
    right: 1.75rem;
    bottom: 1.75rem;
    width: min(27rem, 92vw);
    height: min(42rem, calc(100vh - 3rem));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 2rem;
    background: var(--bg-card);
    color: var(--text-primary);
    border: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
    box-shadow:
      0 24px 70px rgba(15, 23, 42, 0.22),
      0 2px 10px rgba(15, 23, 42, 0.08);
    z-index: 12000;
    transition: box-shadow 0.18s ease;
  }

  .assistant-panel.entering {
    animation: panel-in 0.24s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .assistant-panel.dragging {
    will-change: transform;
  }

  .assistant-panel.dragging,
  .assistant-panel.resizing {
    box-shadow:
      0 32px 90px rgba(15, 23, 42, 0.32),
      0 4px 14px rgba(15, 23, 42, 0.12);
    transition: none;
  }

  .assistant-panel.resizing {
    user-select: none;
  }

  .assistant-panel.dragging .panel-head { cursor: grabbing; }
  .assistant-panel.dragging ::selection { background: transparent; }
  .assistant-panel.resizing ::selection { background: transparent; }

  @keyframes panel-in {
    from { transform: translateY(18px) scale(0.98); opacity: 0; }
    to { transform: translateY(0) scale(1); opacity: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    .assistant-panel.entering { animation: none; }
  }

  :global([data-theme='dark']) .assistant-panel {
    box-shadow:
      0 24px 70px rgba(0, 0, 0, 0.55),
      0 2px 10px rgba(0, 0, 0, 0.4);
  }

  .image-lightbox {
    position: fixed;
    inset: 0;
    z-index: 13000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    border: none;
    background: rgba(8, 10, 16, 0.86);
    cursor: zoom-out;
  }

  .image-lightbox img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    border-radius: 0.5rem;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  }

  .lightbox-close {
    position: absolute;
    top: 1rem;
    right: 1.25rem;
    color: #fff;
    font-size: 1.6rem;
    line-height: 1;
    opacity: 0.85;
  }

  .resize-grip {
    position: absolute;
    right: 0.35rem;
    bottom: 0.3rem;
    z-index: 5;
    display: grid;
    place-items: center;
    width: 1.35rem;
    height: 1.35rem;
    padding: 0;
    border: none;
    border-radius: 0.45rem;
    background: transparent;
    color: var(--text-muted);
    opacity: 0.4;
    cursor: nwse-resize;
    touch-action: none;
    transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
  }

  .resize-grip:hover,
  .resize-grip:focus-visible,
  .resize-grip.active {
    opacity: 1;
    background: var(--bg-hover);
    color: var(--text-secondary);
    outline: none;
  }

  /* Zonas invisibles de redimensionado (bordes y esquinas; la esquina SE
     la cubre el grip). Las esquinas van ligeramente hacia adentro porque
     el border-radius del panel recorta esa zona. */
  .resize-zone {
    position: absolute;
    z-index: 8;
    padding: 0;
    border: none;
    background: transparent;
    touch-action: none;
  }

  .rz-n { top: 0; left: 1.5rem; right: 1.5rem; height: 5px; cursor: ns-resize; }
  .rz-s { bottom: 0; left: 1.5rem; right: 2.1rem; height: 5px; cursor: ns-resize; }
  .rz-e { top: 2rem; right: 0; bottom: 2rem; width: 5px; cursor: ew-resize; }
  .rz-w { top: 2rem; left: 0; bottom: 2rem; width: 5px; cursor: ew-resize; }
  .rz-ne { top: 0.3rem; right: 0.3rem; width: 1rem; height: 0.65rem; cursor: nesw-resize; }
  .rz-nw { top: 0.3rem; left: 0.3rem; width: 1rem; height: 1rem; cursor: nwse-resize; }
  .rz-sw { bottom: 0.3rem; left: 0.3rem; width: 1rem; height: 1rem; cursor: nesw-resize; }

  .panel-head {
    position: relative;
    z-index: 6;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 1rem 0.75rem 0.85rem 1.35rem;
    flex: none;
    cursor: grab;
    user-select: none;
    touch-action: none;
    outline: none;
  }

  .panel-head:focus-visible {
    box-shadow: inset 0 0 0 0.14rem color-mix(in srgb, var(--accent) 32%, transparent);
    border-radius: 2rem;
  }

  .head-title {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
  }

  .head-text { min-width: 0; }

  .head-text h2 {
    margin: 0;
    font-size: 1.12rem;
    font-weight: 650;
    letter-spacing: -0.01em;
    line-height: 1.25;
  }

  .head-sub {
    display: block;
    margin-top: 0.1rem;
    font-size: 0.76rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 12.5rem;
  }

  .head-actions {
    display: flex;
    align-items: center;
    gap: 0.15rem;
    flex: none;
    margin-left: auto;
    opacity: 0.75;
    transition: opacity 0.15s ease;
  }

  .assistant-panel:hover .head-actions,
  .assistant-panel:focus-within .head-actions {
    opacity: 1;
  }

  .icon-btn {
    display: grid;
    place-items: center;
    width: 1.85rem;
    height: 1.85rem;
    padding: 0;
    border: none;
    border-radius: 0.45rem;
    background: none;
    color: var(--text-secondary);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }

  .icon-btn:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
  .icon-btn:disabled { opacity: 0.4; cursor: default; }
  .icon-btn.tiny { width: 1.5rem; height: 1.5rem; }
  .icon-btn.back { margin-right: 0.1rem; }

  .menu-toggle.active {
    background: var(--bg-hover);
    color: var(--text-primary);
    opacity: 1;
  }

  .head-menu {
    position: absolute;
    top: calc(100% - 0.3rem);
    right: 0.75rem;
    z-index: 20;
    min-width: 11.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.3rem;
    border: 1px solid var(--border);
    border-radius: 0.75rem;
    background: var(--bg-card);
    box-shadow: var(--shadow-lg);
    cursor: default;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    width: 100%;
    padding: 0.45rem 0.55rem;
    border: none;
    border-radius: 0.45rem;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.83rem;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }

  .menu-item:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .menu-item svg { flex: none; opacity: 0.85; }

  .menu-foot {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin-top: 0.25rem;
    padding: 0.45rem 0.55rem 0.2rem;
    border-top: 1px solid var(--border-light);
    font-size: 0.68rem;
    line-height: 1.45;
    color: var(--text-muted);
  }

  .menu-metrics { font-family: var(--font-mono); font-size: 0.66rem; }
  .menu-hint { opacity: 0.75; }

  .panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0.9rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    scrollbar-width: thin;
  }

  .chat-body {
    gap: 0.6rem;
    padding: 0 0.9rem 0.4rem;
  }

  .panel-foot {
    flex: none;
    padding: 0.35rem 0.9rem 0.95rem;
    background: transparent;
  }

  .msg {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-width: 100%;
  }

  .msg.user { align-items: flex-end; }
  .msg.assistant { align-items: flex-start; }

  .bubble {
    padding: 0.6rem 0.85rem;
    border-radius: 1.05rem;
    font-size: 0.89rem;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-width: 92%;
  }

  .msg.user .bubble {
    background: color-mix(in srgb, var(--accent) 11%, var(--bg-card));
    color: var(--text-primary);
    border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
    border-bottom-right-radius: 0.4rem;
  }

  .msg.assistant .bubble {
    padding: 0.15rem 0.2rem;
    background: transparent;
    color: var(--text-primary);
    border-radius: 0;
    max-width: 100%;
  }

  .msg.failed .bubble {
    background: var(--danger-soft);
    color: var(--danger);
  }

  .msg-time {
    font-size: 0.68rem;
    color: var(--text-muted);
    padding: 0 0.25rem;
  }

  .undo-row {
    width: 92%;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }

  .undo-btn {
    padding: 0.2rem 0.55rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-card);
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.72rem;
    cursor: pointer;
  }

  .undo-btn:hover:not(:disabled) {
    border-color: var(--border);
    color: var(--text-primary);
  }

  .undo-btn.danger {
    border-color: var(--danger-border);
    background: var(--danger-soft);
    color: var(--danger);
  }

  .undo-btn:disabled { opacity: 0.5; cursor: default; }

  .undo-question {
    font-size: 0.72rem;
    color: var(--text-secondary);
  }

  .undo-done {
    font-size: 0.72rem;
    color: var(--text-muted);
    font-style: italic;
  }

  .tools {
    width: 92%;
    border: 1px solid transparent;
    border-radius: 0.55rem;
    background: transparent;
    overflow: hidden;
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  /* Herramienta del desarrollador: casi imperceptible hasta hover/foco. */
  .tools:hover,
  .tools:focus-within,
  .tools[open] {
    opacity: 1;
  }

  .tools[open] {
    border-color: var(--border-light);
    background: var(--bg-inset);
  }

  .tools summary {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0.35rem;
    font-size: 0.6rem;
    color: var(--text-muted);
    cursor: pointer;
    list-style: none;
    user-select: none;
  }

  .tools:not([open]) summary svg { width: 10px; height: 10px; }

  .tools-label {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .tools summary::-webkit-details-marker { display: none; }

  .tools[open] summary {
    gap: 0.35rem;
    padding: 0.4rem 0.6rem;
    font-size: 0.74rem;
    color: var(--text-secondary);
    border-bottom: 1px solid var(--border-light);
  }

  .tool-row {
    padding: 0.5rem 0.6rem;
    border-top: 1px solid var(--border-light);
  }

  .tool-row:first-of-type { border-top: none; }

  .tool-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }

  .tool-name { font-size: 0.76rem; font-weight: 600; font-family: var(--font-mono); }
  .tool-meta { font-size: 0.68rem; color: var(--text-muted); }

  .tool-note {
    margin: 0 0 0.3rem;
    font-size: 0.76rem;
    line-height: 1.4;
    color: var(--text-primary);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .tool-json {
    margin: 0.2rem 0 0;
    padding: 0.4rem 0.5rem;
    border-radius: 0.35rem;
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    font-family: var(--font-mono);
    font-size: 0.68rem;
    line-height: 1.4;
    color: var(--text-secondary);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    max-height: 12rem;
    overflow: auto;
  }

  .tool-json.result { color: var(--text-primary); }

  .tool-error {
    margin: 0.2rem 0 0;
    font-size: 0.72rem;
    color: var(--danger);
  }

  .slow-hint {
    font-size: 0.72rem;
    color: var(--text-muted);
    padding: 0.15rem 0.6rem 0.4rem;
  }

  .typing {    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    padding: 0.7rem 0.8rem;
  }

  .typing span {
    width: 0.36rem;
    height: 0.36rem;
    border-radius: 50%;
    background: var(--text-muted);
    animation: blink 1.2s infinite ease-in-out;
  }

  .typing span:nth-child(2) { animation-delay: 0.18s; }
  .typing span:nth-child(3) { animation-delay: 0.36s; }

  @keyframes blink {
    0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
    40% { opacity: 1; transform: translateY(-2px); }
  }

  .assistant-error {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--danger-border);
    border-radius: 0.5rem;
    background: var(--danger-soft);
    color: var(--danger);
    font-size: 0.8rem;
  }

  .assistant-error p { margin: 0; flex: 1; }
  .assistant-error .icon-btn { color: var(--danger); }

  .proposal {
    border: 1px solid var(--info-border);
    border-radius: 0.65rem;
    background: var(--info-soft);
    padding: 0.65rem 0.7rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .proposal.destructive {
    border-color: var(--danger-border);
    background: var(--danger-soft);
  }

  .proposal-head {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .proposal-badge {
    padding: 0.12rem 0.42rem;
    border-radius: 999px;
    background: var(--info);
    color: #fff;
    font-size: 0.66rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .proposal.destructive .proposal-badge { background: var(--danger); }

  .proposal-tool {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    color: var(--text-secondary);
  }

  .proposal-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    max-height: 15rem;
    overflow-y: auto;
  }

  .proposal-item {
    display: flex;
    align-items: flex-start;
    gap: 0.35rem;
    padding: 0.35rem 0.45rem;
    border: 1px solid color-mix(in srgb, var(--border) 65%, transparent);
    border-radius: 0.45rem;
    background: color-mix(in srgb, var(--bg-card) 60%, transparent);
  }

  .proposal-item-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .proposal-item-badge {
    align-self: flex-start;
    padding: 0.05rem 0.35rem;
    border-radius: 999px;
    border: 1px solid var(--info-border);
    background: var(--info-soft);
    color: var(--info);
    font-size: 0.6rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .proposal-item-badge.destructive {
    border-color: var(--danger-border);
    background: var(--danger-soft);
    color: var(--danger);
  }

  .proposal-item .proposal-summary { font-size: 0.8rem; }
  .proposal-item .icon-btn { color: var(--text-muted); flex: none; }
  .proposal-item .icon-btn:hover:not(:disabled) { color: var(--danger); }

  .proposal-edit-link {
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 0.72rem;
    cursor: pointer;
  }

  .proposal-edit-link:hover:not(:disabled) { text-decoration: underline; }
  .proposal-edit-link:disabled { opacity: 0.5; cursor: default; }

  .destination-editor {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
    margin-top: 0.1rem;
  }

  .destination-editor select {
    flex: 1;
    min-width: 0;
    padding: 0.25rem 0.35rem;
    border: 1px solid var(--border);
    border-radius: 0.35rem;
    background: var(--bg-card);
    color: var(--text-primary);
    font: inherit;
    font-size: 0.74rem;
  }

  .destination-note {
    font-size: 0.72rem;
    color: var(--text-muted);
  }

  .proposal-summary {
    margin: 0;
    font-size: 0.85rem;
    line-height: 1.4;
    white-space: pre-wrap;
  }

  .proposal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
    margin-top: 0.15rem;
  }

  .composer-attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-bottom: 0.45rem;
  }

  .composer-thumb {
    position: relative;
    width: 3.4rem;
    height: 3.4rem;
    border-radius: 0.45rem;
    overflow: hidden;
    border: 1px solid var(--border);
    background: var(--bg-hover);
  }

  .composer-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .composer-thumb-remove {
    position: absolute;
    top: 0.1rem;
    right: 0.1rem;
    width: 1.1rem;
    height: 1.1rem;
    display: grid;
    place-items: center;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    cursor: pointer;
  }

  .composer-thumb-remove:hover:not(:disabled) { background: rgba(0, 0, 0, 0.85); }
  .composer-thumb-remove:disabled { opacity: 0.5; cursor: default; }

  .composer-error {
    margin: 0 0 0.4rem;
    font-size: 0.76rem;
    color: var(--danger);
  }

  .attach-btn {
    display: grid;
    place-items: center;
    width: 1.95rem;
    height: 1.95rem;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    flex: none;
    transition: background 0.12s, color 0.12s;
  }

  .attach-btn:hover:not(:disabled) {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .attach-btn:disabled { opacity: 0.4; cursor: default; }

  .assistant-file-input { display: none; }

  .msg-attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    max-width: 92%;
  }

  .msg.user .msg-attachments { justify-content: flex-end; }

  .composer {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.4rem 0.4rem 0.4rem 0.5rem;
    border: none;
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg-card) 88%, var(--bg-hover));
    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.06);
    transition: box-shadow 0.15s;
  }

  .composer:focus-within {
    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.12);
  }

  :global([data-theme='dark']) .composer {
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.32);
  }

  :global([data-theme='dark']) .composer:focus-within {
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.38);
  }

  .composer textarea {
    flex: 1;
    border: none;
    background: none;
    color: var(--text-primary);
    font: inherit;
    font-size: 0.89rem;
    line-height: 1.4;
    resize: none;
    outline: none;
    max-height: 8.25rem;
    padding: 0.45rem 0;
  }

  .composer textarea::placeholder { color: var(--text-muted); }

  /* Anula el focus ring global (app.css) para que no dibuje un recuadro
     angular dentro del composer; el foco se marca en el propio pill. */
  .composer textarea:focus {
    outline: none;
    border-color: transparent;
    box-shadow: none;
  }

  .send-btn {
    display: grid;
    place-items: center;
    width: 2.15rem;
    height: 2.15rem;
    border: none;
    border-radius: 50%;
    background: var(--accent);
    color: #fff;
    cursor: pointer;
    flex: none;
    transition: background 0.12s, opacity 0.12s, transform 0.12s;
  }

  .send-btn:hover:not(:disabled) { background: var(--accent-hover); transform: translateY(-1px); }
  .send-btn:disabled { opacity: 0.35; cursor: default; }

  .setup-card,
  .empty-state {
    margin: auto;
    max-width: 20rem;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem 0.5rem;
  }

  .setup-card h3 {
    margin: 0;
    font-size: 1rem;
  }

  .setup-card p {
    margin: 0;
    font-size: 0.83rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .empty-state {
    position: relative;
    flex: 1;
    min-height: 0;
    max-width: none;
    margin: 0.15rem 0 0;
    padding: 1.1rem;
    border-radius: 1.5rem;
    overflow: hidden;
    isolation: isolate;
  }

  .glow {
    position: absolute;
    inset: -12%;
    z-index: 0;
    pointer-events: none;
    background:
      radial-gradient(38% 34% at 16% 20%, rgba(255, 188, 214, 0.95), transparent 72%),
      radial-gradient(34% 32% at 84% 14%, rgba(190, 212, 255, 0.92), transparent 74%),
      radial-gradient(40% 38% at 82% 78%, rgba(196, 184, 255, 0.9), transparent 72%),
      radial-gradient(38% 34% at 16% 82%, rgba(190, 238, 199, 0.9), transparent 74%),
      linear-gradient(155deg, #fdfaff, #f5f7fc);
    filter: blur(10px);
  }

  .empty-state::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: 0;
    background: color-mix(in srgb, var(--bg-card) 42%, transparent);
    pointer-events: none;
  }

  :global([data-theme='dark']) .glow {
    opacity: 0.4;
    filter: blur(18px);
  }

  .empty-inner {
    position: relative;
    z-index: 1;
    margin: auto;
    width: 100%;
    max-width: 21rem;
    max-height: 100%;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    text-align: center;
    scrollbar-width: none;
  }

  .empty-inner::-webkit-scrollbar { display: none; }

  .empty-inner h3 {
    margin: 0;
    font-family: Georgia, 'Times New Roman', serif;
    font-size: 1.75rem;
    font-weight: 400;
    letter-spacing: -0.01em;
    line-height: 1.2;
    color: var(--text-primary);
  }

  .empty-inner p {
    margin: 0;
    max-width: 17rem;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--text-secondary);
  }

  .suggestions {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.4rem;
    margin-top: 0.55rem;
  }

  .suggestion {
    padding: 0.4rem 0.75rem;
    border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--bg-card) 65%, transparent);
    backdrop-filter: blur(6px);
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.76rem;
    line-height: 1.25;
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s, color 0.12s;
  }

  .suggestion:hover:not(:disabled) {
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    background: color-mix(in srgb, var(--bg-card) 90%, transparent);
    color: var(--text-primary);
  }

  .settings-body { gap: 1rem; }

  .field { display: flex; flex-direction: column; gap: 0.35rem; }

  .field-label {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .field input:not([type='range']) {
    width: 100%;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 0.45rem;
    background: var(--bg-card);
    color: var(--text-primary);
    font: inherit;
    font-size: 0.85rem;
    outline: none;
  }

  .field input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 0.14rem color-mix(in srgb, var(--accent) 20%, transparent);
  }

  .key-row { display: flex; gap: 0.4rem; }
  .key-row input { flex: 1; }

  .settings-actions {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .muted { color: var(--text-muted); font-weight: 500; }
  .small { font-size: 0.76rem; }

  .note {
    margin: 0;
    padding: 0.6rem 0.7rem;
    border-radius: 0.5rem;
    background: var(--bg-inset);
    border: 1px solid var(--border-light);
    font-size: 0.76rem;
    line-height: 1.5;
    color: var(--text-secondary);
  }

  .note code {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    background: var(--bg-subtle);
    padding: 0.05rem 0.25rem;
    border-radius: 0.2rem;
  }

  .memory-body, .history-body { gap: 0.5rem; }

  .memory-add { display: flex; gap: 0.4rem; }
  .memory-add input {
    flex: 1;
    padding: 0.5rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 0.45rem;
    background: var(--bg-card);
    color: var(--text-primary);
    font: inherit;
    font-size: 0.82rem;
    outline: none;
  }
  .memory-add input:focus { border-color: var(--accent); }

  .memory-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .memory-item {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    padding: 0.5rem 0.55rem;
    border: 1px solid var(--border-light);
    border-radius: 0.5rem;
    background: var(--bg-inset);
  }

  .memory-main { flex: 1; min-width: 0; }

  .memory-main p {
    margin: 0.2rem 0 0;
    font-size: 0.8rem;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .memory-chip {
    display: inline-block;
    padding: 0.05rem 0.35rem;
    border-radius: 999px;
    background: var(--violet-soft);
    color: var(--violet);
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .empty-note {
    margin: 0;
    padding: 0.8rem;
    border: 1px dashed var(--border);
    border-radius: 0.5rem;
    font-size: 0.8rem;
    color: var(--text-muted);
    text-align: center;
  }

  .forget { align-self: flex-start; }

  .history-item {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    border: 1px solid var(--border-light);
    border-radius: 0.55rem;
    background: var(--bg-inset);
    padding: 0.15rem 0.25rem 0.15rem 0.55rem;
  }

  .history-item.active {
    border-color: var(--accent);
    background: var(--accent-light);
  }

  .history-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.4rem 0.2rem;
    border: none;
    background: none;
    color: var(--text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .history-title {
    font-size: 0.83rem;
    font-weight: 550;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .history-meta { font-size: 0.68rem; color: var(--text-muted); }

  .history-confirm { display: flex; gap: 0.25rem; }

  .gap-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    font-size: 0.72rem;
    color: var(--text-muted);
  }

  .gap-item {
    display: flex;
    align-items: flex-start;
    gap: 0.4rem;
    padding: 0.55rem;
    border: 1px solid var(--border-light);
    border-radius: 0.5rem;
    background: var(--bg-inset);
  }

  .gap-item.closed { opacity: 0.62; }

  .gap-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.18rem; }

  .gap-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.4rem;
  }

  .gap-date { font-size: 0.64rem; color: var(--text-muted); }

  .gap-question {
    margin: 0;
    font-size: 0.82rem;
    font-weight: 600;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .gap-meta {
    margin: 0;
    font-size: 0.7rem;
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }

  .gap-answer {
    margin: 0;
    font-size: 0.74rem;
    line-height: 1.4;
    color: var(--text-secondary);
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .gap-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    margin-top: 0.15rem;
  }
</style>
