<script lang="ts">
  import Modal from '$lib/components/Modal.svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';

  type TaskImageRef = { id: number; created_at?: string | null; url?: string | null };
  type TaskLike = {
    id: number;
    text: string;
    done: boolean;
    pinned: boolean;
    created_at?: string | null;
    assigned_by?: string | null;
    images?: TaskImageRef[];
  };

  let {
    open,
    task,
    pinnedCount,
    initialConfirmDelete = false,
    onclose,
    onsaved,
  }: {
    open: boolean;
    task: TaskLike | null;
    pinnedCount: number;
    initialConfirmDelete?: boolean;
    onclose: () => void;
    onsaved: () => void | Promise<void>;
  } = $props();

  const MAX_PINNED = 3;

  let text = $state('');
  let pinned = $state(false);
  let images = $state<TaskImageRef[]>([]);
  let pending = $state<File | null>(null);
  let pendingUrl = $state<string | null>(null);
  let saving = $state(false);
  let deleting = $state(false);
  let confirmingDelete = $state(false);
  let error = $state('');
  let fileInput = $state<HTMLInputElement | null>(null);
  let initializedFor = $state<string | null>(null);

  const busy = $derived(saving || deleting);
  const isEdit = $derived(task !== null);
  const canPin = $derived(!!pinned || pinnedCount < MAX_PINNED);
  const dirty = $derived(
    isEdit
      ? text !== (task?.text ?? '') || pinned !== !!task?.pinned || pending !== null
      : text.trim().length > 0 || pinned || pending !== null
  );

  function clearPending() {
    if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    pending = null;
    pendingUrl = null;
  }

  $effect(() => {
    const key = open ? (task ? `task:${task.id}` : 'new') : null;
    if (key === null) {
      initializedFor = null;
      return;
    }
    if (initializedFor === key) return;
    initializedFor = key;

    text = task?.text ?? '';
    pinned = !!task?.pinned;
    images = task?.images ? [...task.images] : [];
    confirmingDelete = initialConfirmDelete && !!task;
    error = '';
    saving = false;
    deleting = false;
    clearPending();
  });

  $effect(() => {
    return () => {
      if (pendingUrl) URL.revokeObjectURL(pendingUrl);
    };
  });

  function requestClose() {
    if (busy) return;
    if (confirmingDelete) {
      confirmingDelete = false;
      return;
    }
    onclose();
  }

  function formatMeta(t: TaskLike): string {
    const parts: string[] = [];
    if (t.assigned_by) parts.push(t.assigned_by);
    const raw = t.created_at;
    if (raw) {
      const d = new Date(String(raw).replace(' ', 'T'));
      if (!Number.isNaN(d.getTime())) {
        parts.push(d.toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }));
      }
    }
    return parts.join(' · ');
  }

  function addFile(file: File | null | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      error = 'Solo se aceptan imágenes PNG, JPG o WEBP.';
      return;
    }
    clearPending();
    pending = file;
    pendingUrl = URL.createObjectURL(file);
    error = '';
  }

  function onFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    addFile(input.files?.[0]);
    input.value = '';
  }

  function onPaste(event: ClipboardEvent) {
    const item = Array.from(event.clipboardData?.items ?? []).find(i => i.type.startsWith('image/'));
    if (!item) return;
    event.preventDefault();
    addFile(item.getAsFile());
  }

  function onDrop(event: DragEvent) {
    const file = event.dataTransfer?.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    event.preventDefault();
    addFile(file);
  }

  function onDragOver(event: DragEvent) {
    if (event.dataTransfer?.types?.includes('Files')) event.preventDefault();
  }

  async function save() {
    if (busy) return;
    const clean = text.trim();
    if (!clean && !pending) {
      error = 'Escribe la tarea o adjunta una imagen.';
      return;
    }

    saving = true;
    error = '';
    try {
      if (!task) {
        const created = await api.createTask({
          text: clean || '(imagen)',
          assigned_by: appStore.user?.user_name || undefined,
          pinned,
        });
        if (pending) await api.uploadTaskImage(created.id, new Uint8Array(await pending.arrayBuffer()), pending.name);
        appStore.showToast('Tarea creada', 'success');
      } else {
        const changes: { text?: string; pinned?: boolean } = {};
        if (clean !== task.text) changes.text = clean;
        if (pinned !== !!task.pinned) changes.pinned = pinned;
        if (Object.keys(changes).length > 0) await api.updateTask(task.id, changes);
        if (pending) await api.uploadTaskImage(task.id, new Uint8Array(await pending.arrayBuffer()), pending.name);
        appStore.showToast('Tarea actualizada', 'success');
      }
      await onsaved();
      onclose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      error = 'No se pudo guardar: ' + msg;
    } finally {
      saving = false;
    }
  }

  async function removeExistingImage(img: TaskImageRef) {
    if (!task || busy) return;
    try {
      await api.deleteTaskImage(task.id, img.id);
      images = images.filter(i => i.id !== img.id);
      await onsaved();
      appStore.showToast('Imagen eliminada', 'success');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      error = 'No se pudo eliminar la imagen: ' + msg;
    }
  }

  async function confirmDelete() {
    if (!task || busy) return;
    deleting = true;
    error = '';
    try {
      await api.deleteTask(task.id);
      appStore.showToast('Tarea eliminada', 'success');
      await onsaved();
      onclose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      error = 'No se pudo eliminar: ' + msg;
    } finally {
      deleting = false;
    }
  }

  function onTextKeydown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.isComposing) return;
    if (event.altKey) return;
    event.preventDefault();
    void save();
  }

  function togglePin() {
    if (!canPin) {
      error = `Máximo ${MAX_PINNED} tareas fijadas. Desfijá otra primero.`;
      return;
    }
    pinned = !pinned;
    error = '';
  }
</script>

<Modal
  {open}
  title={isEdit ? 'Editar tarea' : 'Nueva tarea'}
  subtitle={isEdit && task ? formatMeta(task) : 'Se agrega al final de la lista'}
  size="md"
  {busy}
  closeOnBackdrop={!dirty}
  onclose={requestClose}
>
  {#snippet children()}
    <label class="field">
      <span class="sr-only">Texto de la tarea</span>
      <textarea
        class="task-textarea"
        rows="4"
        placeholder="¿Qué hay que hacer?"
        bind:value={text}
        data-autofocus
        disabled={busy}
        onkeydown={onTextKeydown}
        onpaste={onPaste}
        ondrop={onDrop}
        ondragover={onDragOver}
      ></textarea>
    </label>

    <div class="task-tools">
      <button
        type="button"
        class="tool-chip"
        class:active={pinned}
        aria-pressed={pinned}
        title={canPin ? (pinned ? 'Quitar de fijadas' : 'Fijar arriba en el panel') : `Máximo ${MAX_PINNED} fijadas`}
        onclick={togglePin}
        disabled={busy}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        {pinned ? 'Fijada' : 'Fijar'}
      </button>

      <button type="button" class="tool-chip" onclick={() => fileInput?.click()} disabled={busy}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
        </svg>
        Imagen
      </button>

      <span class="tool-hint">Enter guarda · Shift+Enter salto de línea</span>
    </div>

    {#if images.length > 0 || pendingUrl}
      <div class="task-images" aria-label="Imágenes de la tarea">
        {#each images as img (img.id)}
          <div class="task-image">
            <img src={img.url ?? api.getTaskImageViewUrl(task!.id, img.id)} alt="" loading="lazy" />
            <button
              type="button"
              class="task-image-remove"
              onclick={() => removeExistingImage(img)}
              aria-label="Eliminar imagen"
              disabled={busy}
            >✕</button>
          </div>
        {/each}
        {#if pendingUrl}
          <div class="task-image pending">
            <img src={pendingUrl} alt="" />
            <button type="button" class="task-image-remove" onclick={clearPending} aria-label="Quitar imagen adjunta" disabled={busy}>✕</button>
          </div>
        {/if}
      </div>
    {/if}

    {#if error}
      <p class="task-error" role="alert">{error}</p>
    {/if}

    <input
      type="file"
      accept="image/png,image/jpeg,image/webp"
      class="task-file"
      bind:this={fileInput}
      onchange={onFileChange}
    />
  {/snippet}

  {#snippet footer()}
    {#if confirmingDelete}
      <span class="confirm-text">¿Eliminar esta tarea?</span>
      <span class="footer-spacer"></span>
      <button class="btn btn-secondary btn-sm" type="button" onclick={() => (confirmingDelete = false)} disabled={busy}>
        Cancelar
      </button>
      <button class="btn btn-danger btn-sm" type="button" onclick={confirmDelete} disabled={busy}>
        {deleting ? 'Eliminando…' : 'Eliminar'}
      </button>
    {:else}
      {#if isEdit}
        <button class="delete-link" type="button" onclick={() => (confirmingDelete = true)} disabled={busy}>
          Eliminar
        </button>
      {/if}
      <span class="footer-spacer"></span>
      <button class="btn btn-secondary btn-sm" type="button" onclick={requestClose} disabled={busy}>
        Cancelar
      </button>
      <button class="btn btn-primary btn-sm" type="button" onclick={save} disabled={busy || (!text.trim() && !pending)}>
        {saving ? 'Guardando…' : isEdit ? 'Guardar' : 'Crear'}
      </button>
    {/if}
  {/snippet}
</Modal>

<style>
  .field { display: block; }

  .task-textarea {
    width: 100%;
    min-height: 6.5rem;
    max-height: 16rem;
    resize: vertical;
    padding: 0.714rem 0.857rem;
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    background: var(--bg-card);
    color: var(--text-primary);
    font: inherit;
    font-size: 0.95rem;
    line-height: 1.45;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .task-textarea:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 0.143rem color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .task-textarea:disabled { opacity: 0.7; }

  .task-tools {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.429rem;
  }

  .tool-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.286rem;
    padding: 0.286rem 0.571rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: none;
    color: var(--text-secondary);
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s, color 0.12s;
  }

  .tool-chip:hover:not(:disabled) { background: var(--bg-hover); color: var(--text-primary); }
  .tool-chip:disabled { opacity: 0.55; cursor: default; }
  .tool-chip.active {
    border-color: color-mix(in srgb, var(--warning, #f59e0b) 55%, var(--border));
    background: color-mix(in srgb, var(--warning, #f59e0b) 12%, transparent);
    color: var(--warning, #b45309);
  }

  .tool-hint {
    margin-left: auto;
    font-size: 0.74rem;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .task-images {
    display: flex;
    flex-wrap: wrap;
    gap: 0.429rem;
  }

  .task-image {
    position: relative;
    width: 4rem;
    height: 4rem;
    border-radius: 0.5rem;
    overflow: hidden;
    border: 1px solid var(--border);
    background: var(--bg-hover);
  }

  .task-image.pending { border-style: dashed; border-color: var(--accent); }

  .task-image img { width: 100%; height: 100%; object-fit: cover; display: block; }

  .task-image-remove {
    position: absolute;
    top: 0.143rem;
    right: 0.143rem;
    width: 1.15rem;
    height: 1.15rem;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.62);
    color: #fff;
    font-size: 0.68rem;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .task-file { display: none; }

  .task-error {
    margin: 0;
    padding: 0.429rem 0.571rem;
    border-radius: 0.429rem;
    background: var(--danger-soft, rgba(220, 38, 38, 0.08));
    color: var(--danger, #dc2626);
    font-size: 0.82rem;
  }

  .confirm-text { font-size: 0.88rem; color: var(--text-secondary); }
  .footer-spacer { flex: 1; }

  .delete-link {
    padding: 0.286rem 0;
    border: none;
    background: none;
    color: var(--danger, #dc2626);
    font: inherit;
    font-size: 0.8rem;
    cursor: pointer;
    opacity: 0.85;
  }

  .delete-link:hover:not(:disabled) { opacity: 1; text-decoration: underline; }
  .delete-link:disabled { opacity: 0.5; cursor: default; }
  .delete-link:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; border-radius: 0.214rem; }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
