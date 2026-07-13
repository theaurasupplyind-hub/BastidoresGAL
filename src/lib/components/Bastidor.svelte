<script lang="ts">
  import { calcLargueros, calcFilas } from '$lib/utils/molduras';

  let { w, h, largueroQty, travesanoQty }: {
    w: number;
    h: number;
    largueroQty?: number;
    travesanoQty?: number;
  } = $props();

  let longer = $derived(Math.max(w, h));
  let shorter = $derived(Math.min(w, h));
  let largueros = $derived(largueroQty ?? calcLargueros(longer));
  let filas = $derived(travesanoQty ?? calcFilas(shorter));
  let isLandscape = $derived(w >= h);

  let cols = $derived(isLandscape ? largueros + 1 : filas + 1);
  let rows = $derived(isLandscape ? filas + 1 : largueros + 1);

  let larCm = $derived(Math.round((shorter - 5.2) * 10) / 10);

  let discount = $derived(largueros === 1 ? 9.0 : largueros === 2 ? 12.8 : 16.5);
  let travCm = $derived(filas > 0 ? Math.round(((longer - discount) / (largueros + 1)) * 10) / 10 : 0);

  let horzVar = $derived(isLandscape ? w : h);
  let vertVar = $derived(isLandscape ? h : w);
</script>

<div class="bastidor-wrapper">
  <div
    class="bastidor"
    style="aspect-ratio: {w} / {h}; grid-template-columns: repeat({cols}, 1fr); grid-template-rows: repeat({rows}, 1fr);"
  >
    {#each Array(rows) as _, row}
      {#each Array(cols) as _, col}
        {@const isLargueroLine = isLandscape ? col < largueros : row < largueros}
        {@const isTravesanoCell = isLandscape ? row < filas : col < filas}
        <div
          class="celda {isLandscape ? 'celda-land' : 'celda-port'}"
          style:border-right={isLargueroLine && isLandscape ? '3px solid var(--bc-lar, #3b82f6)' : 'none'}
          style:border-bottom={isLargueroLine && !isLandscape ? '3px solid var(--bc-lar, #3b82f6)' : 'none'}
        >
          {#if isTravesanoCell && filas > 0}
            <div class="barrita {isLandscape ? 'barrita-h' : 'barrita-v'}"></div>
          {/if}
        </div>
      {/each}
    {/each}

    <!-- Varilla labels -->
    <span class="lbl lbl-var" style="left:50%;top:-15px;transform:translateX(-50%)">{horzVar}</span>
    <span class="lbl lbl-var" style="left:50%;bottom:-15px;transform:translateX(-50%)">{horzVar}</span>
    <span class="lbl lbl-var" style="left:-17px;top:50%;transform:translateY(-50%) rotate(-90deg)">{vertVar}</span>
    <span class="lbl lbl-var" style="right:-17px;top:50%;transform:translateY(-50%) rotate(-90deg)">{vertVar}</span>

    <!-- Larguero labels -->
    {#each Array(largueros) as _, i}
      {#if isLandscape}
        <span class="lbl lbl-lar" style="left:{((i+1)/cols*100)}%;bottom:-15px;transform:translateX(-50%)">{larCm}</span>
      {:else}
        <span class="lbl lbl-lar" style="top:{((i+1)/rows*100)}%;right:-15px;transform:translateY(-50%)">{larCm}</span>
      {/if}
    {/each}

    <!-- Travesaño labels -->
    {#if filas > 0}
      {#each Array(cols) as _, col}
        {#each Array(filas) as _, j}
          {#if isLandscape}
            <span class="lbl lbl-tra" style="left:{((col + 0.5) / cols * 100)}%;top:{((j+1) / rows * 100)}%;transform:translate(-50%, -120%)">{travCm}</span>
          {:else}
            <span class="lbl lbl-tra" style="top:{((col + 0.5) / rows * 100)}%;left:{((j+1) / cols * 100)}%;transform:translate(4px, -50%)">{travCm}</span>
          {/if}
        {/each}
      {/each}
    {/if}
  </div>
  <div class="rotulo">{w} × {h}</div>
</div>

<style>
  .bastidor-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 100%;
    max-width: 280px;
    padding: 20px 22px 0 22px;
    box-sizing: border-box;
  }
  .bastidor {
    display: grid;
    width: 100%;
    gap: 0;
    border: 3px solid var(--border);
    border-radius: 4px;
    background: var(--bg-page);
    overflow: visible;
    position: relative;
  }
  .celda {
    min-width: 8px;
    min-height: 8px;
    box-sizing: border-box;
    position: relative;
    display: flex;
  }
  .celda-land {
    align-items: flex-end;
    justify-content: center;
  }
  .celda-port {
    align-items: center;
    justify-content: flex-end;
  }
  .barrita {
    background: var(--bc-tra, #ef4444);
    border-radius: 1px;
  }
  .barrita-h {
    width: 88%;
    height: 4px;
    margin-bottom: -2px;
  }
  .barrita-v {
    width: 4px;
    height: 88%;
    margin-right: -2px;
  }
  .lbl {
    position: absolute;
    font-size: 7.5px;
    font-weight: 600;
    white-space: nowrap;
    pointer-events: none;
    z-index: 2;
    line-height: 1;
  }
  .lbl-var { color: var(--text-primary); }
  .lbl-lar { color: #3b82f6; }
  .lbl-tra { color: #ef4444; }
  .rotulo {
    margin-top: 0.35rem;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--text-secondary);
  }
</style>
