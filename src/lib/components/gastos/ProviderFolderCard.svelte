<script lang="ts">
  import type { Provider } from '$lib/types';
  import { appStore } from '$lib/stores/appStore.svelte';

  interface FolderCardInfo {
    debt: number;
    stockQty: number;
    lastMoveDesc: string;
  }

  interface Props {
    provider: Provider;
    info?: FolderCardInfo;
    colorIndex: number;
    onOpenDetail: () => void;
    onPay: () => void;
    onPurchase: () => void;
  }

  let { provider, info, colorIndex, onOpenDetail, onPay, onPurchase }: Props = $props();

  const PALETTE = [
    { front1: '#ff5f6d', front2: '#ff9068', back: '#d64a57' }, // coral
    { front1: '#ffc371', front2: '#ff9a5a', back: '#e5a04e' }, // ámbar
    { front1: '#4facfe', front2: '#00c6fb', back: '#3d8fd6' }, // azul
    { front1: '#43e97b', front2: '#38d9a9', back: '#34c968' }, // verde
    { front1: '#b39ddb', front2: '#8e6fc9', back: '#9078c0' }, // violeta
    { front1: '#f093fb', front2: '#f5576c', back: '#d97ace' }, // rosa
    { front1: '#667eea', front2: '#764ba2', back: '#5568d3' }, // índigo
    { front1: '#11998e', front2: '#38ef7d', back: '#0e8577' }, // teal
  ];

  let color = $derived(PALETTE[((colorIndex % PALETTE.length) + PALETTE.length) % PALETTE.length]);
  let gradId = $derived(`pfc-grad-${provider.id}`);
  let debt = $derived(info?.debt ?? 0);

  function onCardKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpenDetail();
    }
  }

  function onFileKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      onOpenDetail();
    }
  }

  function copyProvider() {
    const lines = [`Proveedor: ${provider.name}`];
    if (provider.cuit) lines.push(`CUIT: ${provider.cuit}`);
    if (provider.alias_mp) lines.push(`Alias MP: ${provider.alias_mp}`);
    if (provider.alias_cbu) lines.push(`Alias CBU: ${provider.alias_cbu}`);
    if (provider.address) lines.push(`Dirección: ${provider.address}`);
    navigator.clipboard
      .writeText(lines.join('\n'))
      .then(() => appStore.showToast(`Datos de ${provider.name} copiados`, 'success'))
      .catch(() => appStore.alert('No se pudo copiar la información'));
  }

  function formatCurrency(n: number): string {
    return '$' + n.toLocaleString('es-AR', { minimumFractionDigits: 2 });
  }
</script>

<div
  class="folder-card"
  role="button"
  tabindex="0"
  aria-label="Carpeta de {provider.name}"
  onclick={onOpenDetail}
  onkeydown={onCardKeydown}
>
  <div class="folder-container">
    <!-- Carpeta: parte trasera -->
    <svg class="folder-back" viewBox="0 0 170 112" aria-hidden="true">
      <path d="M10 24 V16 Q10 8 18 8 H58 L70 20 H150 Q160 20 160 30 V100 Q160 110 150 110 H20 Q10 110 10 100 Z" fill={color.back} />
    </svg>

    <!-- El archivo que brinca -->
    <div
      class="file"
      role="button"
      tabindex="0"
      aria-label="Abrir detalle de {provider.name}"
      onclick={(e) => { e.stopPropagation(); onOpenDetail(); }}
      onkeydown={onFileKeydown}
    >
      <div class="file-body">
        {#if provider.cuit}<span class="file-data"><b>CUIT</b> {provider.cuit}</span>{/if}
        {#if provider.address}<span class="file-data"><b>Dir</b> {provider.address}</span>{/if}
        {#if provider.alias_cbu}<span class="file-data"><b>CBU</b> {provider.alias_cbu}</span>{/if}
        {#if provider.alias_mp}<span class="file-data"><b>MP</b> {provider.alias_mp}</span>{/if}
        <button
          class="file-btn file-btn-copy"
          tabindex="0"
          onclick={(e) => { e.stopPropagation(); copyProvider(); }}
        >📋 Copiar Información</button>
        <div class="file-extra-actions">
          <button
            class="file-btn file-btn-pay"
            tabindex="0"
            onclick={(e) => { e.stopPropagation(); onPay(); }}
          >💸 Pago Rápido</button>
          <button
            class="file-btn file-btn-buy"
            tabindex="0"
            onclick={(e) => { e.stopPropagation(); onPurchase(); }}
          >🛒 Compra Rápida</button>
        </div>
      </div>
    </div>

    <!-- Carpeta: solapa frontal -->
    <div class="folder-front-wrapper">
      <svg viewBox="0 0 170 78" width="100%" aria-hidden="true">
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color={color.front1} />
            <stop offset="100%" stop-color={color.front2} />
          </linearGradient>
        </defs>
        <path d="M4 14 Q4 6 12 6 H158 Q166 6 166 14 V70 Q166 78 158 78 H12 Q4 78 4 70 Z" fill="url(#{gradId})" />
      </svg>
      <span class="folder-label-bar"></span>
      <span class="folder-name">{provider.name}</span>
    </div>
  </div>

  <!-- Caption siempre visible -->
  <div class="folder-caption">
    <span class="cap-name">{provider.name}</span>
    <div class="cap-row">
      <span class="cap-debt" class:owe={debt > 0}>{formatCurrency(debt)}</span>
      <span class="cap-stock">{info?.stockQty ?? 0} u.</span>
    </div>
  </div>
</div>

<style>
  .folder-card {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 9.5rem;
    perspective: 115rem;
    cursor: pointer;
    outline: none;
    -webkit-tap-highlight-color: transparent;
  }
  .folder-card:hover,
  .folder-card:focus-within { z-index: 40; }

  /* ── Contenedor 3D ── */
  .folder-container {
    position: relative;
    width: 15.4rem;
    height: 11.2rem;
    transform-style: preserve-3d;
    transition: transform 0.6s cubic-bezier(0.23, 1, 0.32, 1);
    will-change: transform;
  }
  .folder-card:hover .folder-container,
  .folder-card:focus-within .folder-container { transform: rotateX(10deg) rotateY(-5deg); }
  .folder-card:focus-visible .folder-container {
    outline: 2px solid var(--border-focus);
    outline-offset: 4px;
    border-radius: 8px;
  }

  /* ── Carpeta trasera ── */
  .folder-back {
    position: absolute;
    bottom: 0.7rem;
    left: 0;
    width: 15.4rem;
    z-index: 10;
    filter: drop-shadow(0 10px 18px rgba(0, 0, 0, 0.35));
  }

  /* ── El archivo que brinca ── */
  .file {
    position: absolute;
    bottom: 1.2rem;
    left: 1.7rem;
    width: 11.9rem;
    height: 5rem;
    display: flex;
    flex-direction: column;
    background: linear-gradient(180deg, #ffffff, #f2f3f5);
    border-radius: 0.5rem;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3), inset 0 1px 0 #ffffff;
    z-index: 25;
    overflow: hidden;
    pointer-events: none;
    transition:
      transform 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55),
      height 0.45s cubic-bezier(0.68, -0.55, 0.265, 1.55),
      box-shadow 0.2s ease;
  }
  .folder-card:hover .file,
  .folder-card:focus-within .file {
    transform: translateY(-4rem) rotate(-4deg);
    height: 11.2rem;
    box-shadow: 0 14px 26px rgba(0, 0, 0, 0.35);
    pointer-events: auto;
    cursor: pointer;
  }
  .file-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 0.32rem;
    padding: 0.6rem 0.7rem;
  }
  .file-data {
    font-size: 0.72rem;
    color: #5b616a;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-data b { font-weight: 800; color: #4a4f57; margin-right: 0.29rem; }
  .file-btn-copy {
    flex: 0 0 auto;
    margin-top: auto;
    background: #9ca3af;
    color: #ffffff;
  }
  .file-extra-actions { display: flex; gap: 0.36rem; margin-top: 0.29rem; }
  .file-btn {
    flex: 1;
    border: none;
    border-radius: 0.36rem;
    font-size: 0.78rem;
    font-weight: 800;
    padding: 0.36rem 0;
    cursor: pointer;
    font-family: inherit;
    transition: filter 0.12s;
  }
  .file-btn:hover { filter: brightness(1.08); }
  .file-btn-pay { background: #ffc107; color: #333; }
  .file-btn-buy { background: #dc3545; color: #ffffff; }

  /* ── Solapa frontal ── */
  .folder-front-wrapper {
    position: absolute;
    bottom: 0.4rem;
    left: 0;
    width: 15.4rem;
    z-index: 40;
    transform-origin: bottom center;
    transition: transform 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    filter: drop-shadow(0 -2px 6px rgba(0, 0, 0, 0.15));
  }
  .folder-card:hover .folder-front-wrapper,
  .folder-card:focus-within .folder-front-wrapper { transform: rotateX(-50deg); }
  .folder-label-bar {
    position: absolute;
    top: 1.1rem;
    left: 1.1rem;
    width: 2.7rem;
    height: 0.36rem;
    background: rgba(255, 255, 255, 0.55);
    border-radius: 0.71rem;
  }
  .folder-name {
    position: absolute;
    bottom: 0.86rem;
    left: 1.1rem;
    right: 1.1rem;
    color: #ffffff;
    font-size: 0.95rem;
    font-weight: 800;
    text-align: left;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Caption bajo la carpeta ── */
  .folder-caption {
    width: 15.4rem;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.29rem;
    padding-top: 0.57rem;
  }
  .cap-name {
    font-size: 1.05rem;
    font-weight: 800;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
  }
  .cap-row {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 0.43rem;
  }
  .cap-debt { font-size: 1.3rem; font-weight: 800; color: #28a745; }
  .cap-debt.owe { color: #dc3545; }
  .cap-stock { font-size: 0.9rem; color: var(--text-muted); }
</style>
