<script lang="ts">
  import { getCurrentWindow } from '@tauri-apps/api/window';

  let maximized = $state(false);

  const win = getCurrentWindow();

  async function checkMaximized() {
    maximized = await win.isMaximized();
  }

  $effect(() => {
    checkMaximized();
    const unlisten = win.onResized(checkMaximized);
    return () => { unlisten.then(fn => fn()); };
  });

  function minimize() { win.minimize(); }
  function toggleMax() { win.toggleMaximize(); }
  function close() { win.close(); }
</script>

<div class="titlebar" data-tauri-drag-region>
  <span class="titlebar-label">Bastidores GAL</span>
  <div class="titlebar-controls">
    <button class="ctrl-btn" onclick={minimize} title="Minimizar">
      <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="4" width="10" height="1.5" rx="0.5" fill="currentColor"/></svg>
    </button>
    <button class="ctrl-btn" onclick={toggleMax} title={maximized ? 'Restaurar' : 'Maximizar'}>
      {#if maximized}
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1.5" y="0" width="7" height="7" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="0.5" y="2.5" width="7" height="7" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
      {:else}
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
      {/if}
    </button>
    <button class="ctrl-btn ctrl-close" onclick={close} title="Cerrar">
      <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.5"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.5"/></svg>
    </button>
  </div>
</div>

<style>
  .titlebar {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 2.143rem;
    padding: 0 0.857rem;
    background: linear-gradient(180deg, #1a252f, #2c3e50);
    color: #bdc3c7;
    user-select: none;
    flex-shrink: 0;
    position: relative;
    z-index: 1000;
  }
  .titlebar-label {
    font-size: 0.857rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    opacity: 0.75;
  }
  .titlebar-controls {
    display: flex;
    align-items: center;
    gap: 0;
    height: 100%;
    position: absolute;
    right: 0;
    top: 0;
  }
  .ctrl-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3.143rem;
    height: 100%;
    border: none;
    background: none;
    color: #bdc3c7;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
  }
  .ctrl-btn:hover { background: rgba(255,255,255,0.1); color: #fff; }
  .ctrl-close:hover { background: #e81123; color: #fff; }
</style>
