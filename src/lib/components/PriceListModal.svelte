<script lang="ts">
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
  import { invoke } from '@tauri-apps/api/core';
  import { Image } from '@tauri-apps/api/image';
  import { writeImage } from '@tauri-apps/plugin-clipboard-manager';
  import { open as shellOpen } from '@tauri-apps/plugin-shell';

  let { show, onclose }: { show: boolean; onclose: () => void } = $props();

  let images = $state<any[]>([]);
  let currentPos = $state(0);
  let currentName = $state('');
  let uploading = $state(false);
  let fileInput = $state<HTMLInputElement>();
  let nameChanged = $state(false);
  let zoomPercent = $state(0);
  let dragging = $state(false);
  let sharingWhatsApp = $state(false);
  let imgRef = $state<HTMLImageElement>();
  let didDrag = false;
  let dragStartX = $state(0);
  let dragStartY = $state(0);
  let scrollStartX = $state(0);
  let scrollStartY = $state(0);

  const defaultNames = ['Lista 1', 'Lista 2', 'Lista 3', 'Lista 4'];

  let currentImage = $derived(images.find(img => img.position === currentPos) ?? null);

  $effect(() => {
    if (show) {
      loadImages();
      zoomPercent = 0;
    }
  });

  $effect(() => {
    currentName = currentImage?.name || defaultNames[currentPos];
    nameChanged = false;
    zoomPercent = 0;
  });

  async function loadImages() {
    try {
      images = await api.listPriceListImages();
    } catch (e) {
      appStore.alert('Error al cargar imágenes: ' + (e as Error).message);
    }
  }

  function triggerUpload() {
    fileInput?.click();
  }

  async function onFileSelected(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    try {
      uploading = true;
      const buffer = await file.arrayBuffer();
      const data = new Uint8Array(buffer);
      await api.uploadPriceListImage(currentPos, currentName, data);
      await loadImages();
      appStore.showToast('Imagen subida', 'success');
    } catch (err) {
      appStore.alert('Error al subir: ' + (err as Error).message);
    } finally {
      uploading = false;
      target.value = '';
    }
  }

  async function handleRename() {
    if (!currentImage || !nameChanged) return;
    try {
      await api.updatePriceListImage(currentImage.id, { name: currentName });
      await loadImages();
      nameChanged = false;
    } catch (e) {
      appStore.alert('Error al renombrar: ' + (e as Error).message);
    }
  }

  function onNameInput(e: Event) {
    currentName = (e.target as HTMLInputElement).value;
    nameChanged = true;
  }

  async function handleDelete() {
    if (!currentImage) return;
    if (!confirm(`¿Eliminar "${currentImage.name}"?`)) return;
    try {
      await api.deletePriceListImage(currentImage.id);
      await loadImages();
      appStore.showToast('Imagen eliminada', 'success');
    } catch (e) {
      appStore.alert('Error al eliminar: ' + (e as Error).message);
    }
  }

  async function handleDownload() {
    if (!currentImage) return;
    try {
      const url = api.getPriceListDownloadUrl(currentImage.id);
      const resp = await tauriFetch(url, { method: 'GET' });
      if (!resp.ok) throw new Error('Error al descargar');
      const buf = await resp.arrayBuffer();
      const blob = new Blob([buf]);
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${currentImage.name || 'lista-precio'}.png`;
      a.click();
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      appStore.alert('Error al descargar: ' + (e as Error).message);
    }
  }

  async function bitmapToRGBA(source: ImageBitmap | HTMLImageElement): Promise<{ data: Uint8Array; width: number; height: number }> {
    const canvas = document.createElement('canvas');
    canvas.width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
    canvas.height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(source, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { data: new Uint8Array(imageData.data.buffer), width: canvas.width, height: canvas.height };
  }

  async function sharePriceListWhatsApp() {
    console.log('[sharePriceList] iniciando...', currentImage);
    if (!currentImage) return;
    sharingWhatsApp = true;
    try {
      let rgba: { data: Uint8Array; width: number; height: number } | null = null;

      if (imgRef?.complete && imgRef.naturalWidth > 0) {
        try {
          console.log('[sharePriceList] leyendo del DOM...');
          rgba = await bitmapToRGBA(imgRef);
          console.log('[sharePriceList] OK DOM', rgba.width, 'x', rgba.height);
        } catch {
          console.log('[sharePriceList] DOM tainted, descargando...');
        }
      }

      if (!rgba) {
        const url = api.getPriceListDownloadUrl(currentImage.id);
        const resp = await tauriFetch(url, { method: 'GET' });
        if (!resp.ok) throw new Error('Error al descargar imagen');
        const bitmap = await createImageBitmap(new Blob([await resp.arrayBuffer()]));
        try {
          console.log('[sharePriceList] decodificada', bitmap.width, 'x', bitmap.height);
          rgba = await bitmapToRGBA(bitmap);
        } finally {
          bitmap.close();
        }
      }

      console.log('[sharePriceList] copiando al portapapeles...');
      const tauriImg = await Image.new(rgba.data, rgba.width, rgba.height);
      await writeImage(tauriImg);
      console.log('[sharePriceList] imagen copiada, abriendo WhatsApp...');

      const result = await invoke<string>('open_whatsapp', { phone: 'none' });
      if (result === 'web') {
        await shellOpen('https://web.whatsapp.com/send');
      }

      await invoke('show_whatsapp_helper');

      appStore.showToast('Lista de precios copiada al portapapeles', 'success');
    } catch (e: any) {
      console.error('[sharePriceList] error:', e);
      appStore.showToast('Error al compartir: ' + (e.message || 'error desconocido'), 'error');
    } finally {
      sharingWhatsApp = false;
    }
  }

  function toggleZoom() {
    if (didDrag) return;
    zoomPercent = zoomPercent === 0 ? 100 : 0;
  }

  function onWheel(e: WheelEvent) {
    if (e.ctrlKey) {
      e.preventDefault();
      zoomPercent = Math.max(0, Math.min(100, zoomPercent - Math.sign(e.deltaY) * 10));
    }
  }

  function startDrag(e: MouseEvent) {
    if (!isZoomed) return;
    dragging = true;
    didDrag = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const wrap = e.currentTarget as HTMLElement;
    scrollStartX = wrap.scrollLeft;
    scrollStartY = wrap.scrollTop;
  }

  function doDrag(e: MouseEvent) {
    if (!dragging) return;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag = true;
    const wrap = e.currentTarget as HTMLElement;
    wrap.scrollLeft = scrollStartX - dx;
    wrap.scrollTop = scrollStartY - dy;
  }

  function endDrag() {
    dragging = false;
  }

  let isZoomed = $derived(zoomPercent > 0);
</script>

{#if show}
  <div class="price-panel">
    <header class="panel-header">
      <h3>Listas de Precio</h3>
      <button class="panel-close" onclick={onclose} aria-label="Cerrar">✕</button>
    </header>

    <nav class="nav-dots">
      {#each [0, 1, 2, 3] as pos}
        {@const img = images.find(i => i.position === pos)}
        <button
          class="nav-dot"
          class:active={currentPos === pos}
          class:has-image={!!img}
          onclick={() => { currentPos = pos; handleRename(); }}
          title={img?.name || defaultNames[pos]}
        ></button>
      {/each}
    </nav>

    <div class="image-area" class:zoom-mode={isZoomed}>
      {#if currentImage}
        <div class="image-wrap" class:scrollable={isZoomed} class:grabbing={dragging}
          onwheel={onWheel}
          onmousedown={startDrag}
          onmousemove={doDrag}
          onmouseup={endDrag}
          onmouseleave={endDrag}
        >
          <img
            src={api.getPriceListViewUrl(currentImage.id)}
            alt={currentImage.name}
            bind:this={imgRef}
            crossorigin="anonymous"
            style={isZoomed ? `transform: scale(${1 + zoomPercent / 100}); transform-origin: 0 0; max-width: none; max-height: none;` : ''}
            onclick={toggleZoom}
            title={isZoomed ? 'Click para ajustar - Ctrl+rueda zoom' : 'Click para hacer zoom'}
            draggable="false"
          />
        </div>
      {:else}
        <div class="placeholder">
          <span class="placeholder-icon">🖼</span>
          <span class="placeholder-text">Posición {currentPos + 1} vacía</span>
          <span class="placeholder-hint">1252 × 1600</span>
        </div>
      {/if}
    </div>

    <div class="controls">
      <div class="name-field">
        <label>Nombre</label>
        <input
          type="text"
          value={currentName}
          oninput={onNameInput}
          onblur={handleRename}
          placeholder={defaultNames[currentPos]}
          maxlength="100"
        />
      </div>

      {#if currentImage}
        <div class="zoom-control">
          <svg class="zoom-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
          <input
            type="range"
            min="0"
            max="100"
            bind:value={zoomPercent}
            class="zoom-slider"
          />
          <span class="zoom-label">{zoomPercent}%</span>
        </div>
      {/if}

      <div class="btn-group">
        <button class="btn btn-upload" onclick={triggerUpload} disabled={uploading}>
          {uploading ? 'Subiendo...' : currentImage ? 'Reemplazar' : 'Subir imagen'}
        </button>
        {#if currentImage}
          <button class="btn btn-download" onclick={handleDownload} title="Descargar PNG">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <button class="btn btn-whatsapp" onclick={sharePriceListWhatsApp} disabled={sharingWhatsApp} title="Compartir por WhatsApp">
            {#if sharingWhatsApp}
              <span class="btn-whatsapp-loading">Enviando...</span>
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
            {/if}
          </button>
          <button class="btn btn-delete" onclick={handleDelete} title="Eliminar">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        {/if}
      </div>

      <button class="btn btn-cerrar" onclick={onclose}>Cerrar</button>
    </div>
  </div>

  <input
    type="file"
    accept="image/png,image/jpeg,image/webp,image/bmp"
    class="file-hidden"
    bind:this={fileInput}
    onchange={onFileSelected}
  />

  <style>
    .price-panel {
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      width: 480px;
      max-width: 90vw;
      background: var(--bg-card, #fff);
      border-left: 1px solid var(--border, #e0e0e0);
      box-shadow: -4px 0 24px rgba(0,0,0,0.12);
      z-index: 51;
      display: flex;
      flex-direction: column;
      animation: slideIn 0.2s ease;
    }
    @keyframes slideIn {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.714rem 1.286rem;
      border-bottom: 1px solid var(--border-light, #eee);
    }
    .panel-header h3 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      color: var(--text-primary, #1a1a1a);
    }
    .panel-close { background: none; border: none; font-size: 1.2rem; cursor: pointer; color: var(--text-muted); padding: 0.2rem 0.3rem; border-radius: 0.3rem; }
    .panel-close:hover { background: var(--bg-hover); color: var(--text-primary); }

    .nav-dots {
      display: flex;
      justify-content: center;
      gap: 0.857rem;
      padding: 0.714rem;
      border-bottom: 1px solid var(--border-light, #eee);
    }
    .nav-dot {
      width: 0.857rem;
      height: 0.857rem;
      border-radius: 50%;
      border: 2px solid var(--border, #ccc);
      background: transparent;
      cursor: pointer;
      padding: 0;
      transition: all 0.15s;
    }
    .nav-dot.active {
      border-color: var(--accent);
      background: var(--accent);
    }
    .nav-dot.has-image {
      border-color: #818cf8;
      background: #e0e7ff;
    }
    .nav-dot.has-image.active {
      background: var(--accent);
    }

    .image-area {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f8f9fb;
      min-height: 0;
    }
    .image-area.zoom-mode {
      align-items: flex-start;
      justify-content: flex-start;
    }
    .image-wrap {
      max-width: 100%;
      max-height: 100%;
      display: flex;
      padding: 1rem;
    }
    .image-wrap.scrollable {
      overflow: auto;
      max-width: 100%;
      max-height: 100%;
      width: 100%;
      height: 100%;
      padding: 0;
      cursor: grab;
    }
    .image-wrap.scrollable.grabbing {
      cursor: grabbing;
    }
    .image-wrap img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      border-radius: 0.429rem;
      box-shadow: 0 0.143rem 0.857rem rgba(0,0,0,0.1);
      transition: transform 0.15s ease;
      user-select: none;
      -webkit-user-select: none;
    }
    .image-wrap.scrollable img {
      border-radius: 0;
      box-shadow: none;
    }

    .placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      color: var(--text-muted, #999);
      padding: 1rem;
    }
    .placeholder-icon {
      font-size: 2.857rem;
      opacity: 0.5;
    }
    .placeholder-text {
      font-size: 0.9rem;
      font-weight: 500;
    }
    .placeholder-hint {
      font-size: 0.75rem;
      opacity: 0.5;
    }

    .controls {
      padding: 1rem 1.286rem;
      border-top: 1px solid var(--border-light, #eee);
      display: flex;
      flex-direction: column;
      gap: 0.714rem;
    }

    .name-field {
      display: flex;
      flex-direction: column;
      gap: 0.286rem;
    }
    .name-field label {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-muted, #888);
      text-transform: uppercase;
      letter-spacing: 0.036rem;
    }
    .name-field input {
      padding: 0.5rem 0.714rem;
      border: 1px solid var(--border, #ddd);
      border-radius: 0.357rem;
      font-size: 0.88rem;
      color: var(--text-primary, #1a1a1a);
      background: var(--bg-card, #fff);
    }
    .name-field input:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(99,102,241,0.15);
    }

    .zoom-control {
      display: flex;
      align-items: center;
      gap: 0.571rem;
    }
    .zoom-icon {
      flex-shrink: 0;
      color: var(--text-muted, #888);
    }
    .zoom-slider {
      flex: 1;
      height: 4px;
      accent-color: var(--accent);
      cursor: pointer;
    }
    .zoom-label {
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--text-secondary, #666);
      min-width: 2.571rem;
      text-align: right;
      font-variant-numeric: tabular-nums;
    }

    .btn-group {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .btn {
      padding: 0.5rem 1rem;
      border: 1px solid var(--border, #ddd);
      border-radius: 0.357rem;
      font-size: 0.82rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.12s;
      white-space: nowrap;
    }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-upload {
      background: var(--accent);
      color: #fff;
      border-color: var(--accent);
      flex: 1;
    }
    .btn-upload:hover:not(:disabled) { background: #5558e6; }
    .btn-download {
      background: #f0fdf4;
      color: #16a34a;
      border-color: #bbf7d0;
      padding: 0.429rem 0.643rem;
    }
    .btn-download:hover { background: #dcfce7; }
    .btn-whatsapp {
      background: #f0fdf4;
      color: #25D366;
      border-color: #b7f0d1;
      padding: 0.429rem 0.643rem;
    }
    .btn-whatsapp:hover:not(:disabled) { background: #dcfce7; }
    .btn-whatsapp:disabled { opacity: 0.7; cursor: not-allowed; }
    .btn-whatsapp-loading {
      font-size: 0.78rem;
      font-weight: 600;
      animation: pulse 1.2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .btn-delete {
      background: var(--bg-card);
      color: #ef4444;
      border-color: #fecaca;
      padding: 0.429rem 0.643rem;
    }
    .btn-delete:hover { background: #fef2f2; }
    .btn-cerrar {
      background: var(--bg-page);
      color: var(--text-primary);
      border-color: #d1d5db;
      width: 100%;
      justify-content: center;
    }
    .btn-cerrar:hover { background: #e5e7eb; }

    .file-hidden { display: none; }
  </style>
{/if}
