<script lang="ts">
  import { pdfTimer } from '$lib/stores/pdfTimerStore.svelte';
</script>

{#if pdfTimer.visible}
  <div class="invoice-loader">
    <svg
      class="invoice-icon"
      width="200"
      height="200"
      viewBox="0 0 240 240"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        class="paper"
        d="M38,15 L182,15 A18,18 0 0 1 200,33 L200,207 A18,18 0 0 1 182,225 L38,225 A18,18 0 0 1 20,207 L20,33 A18,18 0 0 1 38,15 Z"
      />
      <path class="fold" d="M20,15 L64,15 L20,59 Z" />
      <text class="dollar" x="168" y="58">$</text>
      <text class="title" x="34" y="98">INVOICE</text>
      <rect class="rule" x="34" y="108" width="140" height="6" rx="3" />

      <rect class="row-bar r1" x="34" y="138" width="122" height="9" rx="4" />
      <g class="row-dots d1">
        <rect x="168" y="134" width="18" height="5" rx="2.5" />
        <rect x="168" y="143" width="18" height="5" rx="2.5" />
      </g>

      <rect class="row-bar r2" x="34" y="163" width="132" height="9" rx="4" />
      <g class="row-dots d2">
        <rect x="168" y="159" width="18" height="5" rx="2.5" />
        <rect x="168" y="168" width="18" height="5" rx="2.5" />
      </g>

      <rect class="row-bar r3" x="34" y="188" width="96" height="9" rx="4" />
      <g class="row-dots d3">
        <rect x="168" y="184" width="18" height="5" rx="2.5" />
        <rect x="168" y="193" width="18" height="5" rx="2.5" />
      </g>

      <circle class="check-circle" cx="195" cy="195" r="34" />
      <path class="check-mark" d="M180,196 L191,207 L212,182" />
    </svg>
  </div>
{/if}

<style>
  .invoice-loader {
    position: fixed;
    right: 1.25rem;
    bottom: 1.25rem;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
    border-radius: 1rem;
    background: rgba(255, 255, 255, 0.85);
    box-shadow: 0 0.375rem 1.5rem rgba(0, 0, 0, 0.18);
    user-select: none;
    pointer-events: none;
    backdrop-filter: blur(6px);
  }

  .invoice-icon {
    --ink: #1e2433;
    --paper: #eaf1ff;
    --paper-fold: #cfe1ff;
    --check-bg: #8fd66f;
    --dur: 4.2s;
  }

  .invoice-icon .paper {
    fill: var(--paper);
    stroke: var(--ink);
    stroke-width: 8;
    stroke-linejoin: round;
    stroke-linecap: round;
    stroke-dasharray: 756;
    stroke-dashoffset: 756;
    fill-opacity: 0;
    animation: ii-paper-stroke var(--dur) ease-out infinite,
      ii-paper-fill var(--dur) ease-out infinite;
  }
  @keyframes ii-paper-stroke {
    0% { stroke-dashoffset: 756; }
    20% { stroke-dashoffset: 0; }
    100% { stroke-dashoffset: 0; }
  }
  @keyframes ii-paper-fill {
    0%, 14% { fill-opacity: 0; }
    24% { fill-opacity: 1; }
    100% { fill-opacity: 1; }
  }

  .invoice-icon .fold {
    fill: var(--paper-fold);
    stroke: var(--ink);
    stroke-width: 8;
    stroke-linejoin: round;
    opacity: 0;
    animation: ii-fold var(--dur) ease-out infinite;
  }
  @keyframes ii-fold {
    0%, 20% { opacity: 0; transform: scale(0.6); transform-box: fill-box; transform-origin: 20px 20px; }
    28% { opacity: 1; transform: scale(1); transform-box: fill-box; transform-origin: 20px 20px; }
    100% { opacity: 1; transform: scale(1); transform-box: fill-box; transform-origin: 20px 20px; }
  }

  .invoice-icon .dollar {
    fill: var(--ink);
    font-family: Arial, sans-serif;
    font-size: 40px;
    font-weight: 800;
    text-anchor: middle;
    opacity: 0;
    animation: ii-dollar var(--dur) ease-out infinite;
  }
  @keyframes ii-dollar {
    0%, 26% { opacity: 0; transform: scale(0.3); transform-box: fill-box; transform-origin: center; }
    36% { opacity: 1; transform: scale(1); transform-box: fill-box; transform-origin: center; }
    100% { opacity: 1; transform: scale(1); transform-box: fill-box; transform-origin: center; }
  }

  .invoice-icon .title {
    fill: var(--ink);
    font-family: Arial, sans-serif;
    font-size: 25px;
    font-weight: 800;
    letter-spacing: 1px;
    opacity: 0;
    animation: ii-title var(--dur) ease-out infinite;
  }
  @keyframes ii-title {
    0%, 30% { opacity: 0; transform: translateX(-8px); }
    40% { opacity: 1; transform: translateX(0); }
    100% { opacity: 1; transform: translateX(0); }
  }

  .invoice-icon .rule,
  .invoice-icon .row-bar {
    fill: var(--ink);
    transform-origin: 34px 0;
    transform: scaleX(0);
    animation-timing-function: ease-out;
    animation-duration: var(--dur);
    animation-iteration-count: infinite;
  }
  .invoice-icon .rule { animation-name: ii-rule; }
  @keyframes ii-rule {
    0%, 36% { transform: scaleX(0); }
    45% { transform: scaleX(1); }
    100% { transform: scaleX(1); }
  }
  .invoice-icon .row-bar.r1 { animation-name: ii-row1; }
  @keyframes ii-row1 {
    0%, 44% { transform: scaleX(0); }
    52% { transform: scaleX(1); }
    100% { transform: scaleX(1); }
  }
  .invoice-icon .row-bar.r2 { animation-name: ii-row2; }
  @keyframes ii-row2 {
    0%, 52% { transform: scaleX(0); }
    60% { transform: scaleX(1); }
    100% { transform: scaleX(1); }
  }
  .invoice-icon .row-bar.r3 { animation-name: ii-row3; }
  @keyframes ii-row3 {
    0%, 60% { transform: scaleX(0); }
    68% { transform: scaleX(1); }
    100% { transform: scaleX(1); }
  }

  .invoice-icon .row-dots {
    fill: var(--ink);
    opacity: 0;
    animation-duration: var(--dur);
    animation-timing-function: ease-out;
    animation-iteration-count: infinite;
  }
  .invoice-icon .row-dots.d1 { animation-name: ii-dots1; }
  @keyframes ii-dots1 { 0%, 50% { opacity: 0; } 58% { opacity: 1; } 100% { opacity: 1; } }
  .invoice-icon .row-dots.d2 { animation-name: ii-dots2; }
  @keyframes ii-dots2 { 0%, 58% { opacity: 0; } 66% { opacity: 1; } 100% { opacity: 1; } }
  .invoice-icon .row-dots.d3 { animation-name: ii-dots3; }
  @keyframes ii-dots3 { 0%, 66% { opacity: 0; } 74% { opacity: 1; } 100% { opacity: 1; } }

  .invoice-icon .check-circle {
    fill: var(--check-bg);
    stroke: var(--ink);
    stroke-width: 8;
    opacity: 0;
    transform: scale(0);
    transform-box: fill-box;
    transform-origin: center;
    animation: ii-check-pop var(--dur) cubic-bezier(0.34, 1.56, 0.64, 1) infinite;
  }
  @keyframes ii-check-pop {
    0%, 76% { opacity: 0; transform: scale(0); }
    88% { opacity: 1; transform: scale(1.12); }
    94% { transform: scale(1); }
    100% { opacity: 1; transform: scale(1); }
  }

  .invoice-icon .check-mark {
    fill: none;
    stroke: var(--ink);
    stroke-width: 9;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 50;
    stroke-dashoffset: 50;
    animation: ii-check-draw var(--dur) ease-out infinite;
  }
  @keyframes ii-check-draw {
    0%, 88% { stroke-dashoffset: 50; }
    98% { stroke-dashoffset: 0; }
    100% { stroke-dashoffset: 0; }
  }

  :global([data-theme='dark']) .invoice-loader {
    background: rgba(30, 33, 43, 0.85);
  }
  :global([data-theme='dark']) .invoice-icon {
    --ink: #e8ecf1;
    --paper: #2b3448;
    --paper-fold: #3b4a6b;
    --check-bg: #2f9e44;
  }

  @media (prefers-reduced-motion: reduce) {
    .invoice-icon * {
      animation: none !important;
      opacity: 1 !important;
      transform: none !important;
    }
    .invoice-icon .paper {
      stroke-dashoffset: 0 !important;
      fill-opacity: 1 !important;
    }
    .invoice-icon .check-mark {
      stroke-dashoffset: 0 !important;
    }
  }
</style>
