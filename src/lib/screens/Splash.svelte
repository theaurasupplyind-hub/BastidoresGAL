<script lang="ts">
  import { onMount } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { appStore } from '$lib/stores/appStore.svelte';

  let { onDone }: { onDone: () => void } = $props();

  let statusMsg = $state('Iniciando conexión...');
  let statusColor = $state('#f39c12');
  let ready = $state(false);

  function sleep(ms: number) {
    return new Promise(r => setTimeout(r, ms));
  }

  onMount(() => {
    wakeLoop();
  });

  async function wakeLoop() {
    for (let i = 0; i < 15; i++) {
      statusMsg = `Despertando servidor nube... (Intento ${i + 1}/15)`;
      try {
        await invoke('wake_server');
        ready = true;
        statusMsg = '¡Servidor listo!';
        statusColor = '#27ae60';
        break;
      } catch { }
      await sleep(2000);
    }

    if (!ready) {
      statusMsg = 'El servidor tarda en responder, abriendo igual...';
      statusColor = '#e74c3c';
    }

    await sleep(1000);
    onDone();
  }
</script>

<div class="splash-container">
  <div class="splash-card">
    <h1>Bastidores GAL</h1>
    <p class="user-greeting">Hola {appStore.user?.user_name}</p>
    <div class="status" style="color: {statusColor}">
      {statusMsg}
    </div>
    {#if !ready}
      <div class="spinner"></div>
    {/if}
  </div>
</div>

<style>
  .splash-container {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100vh;
    background: #2c3e50;
  }
  .splash-card {
    text-align: center;
    color: white;
  }
  h1 {
    font-size: 2.286rem;
    margin: 0 0 0.571rem;
  }
  .user-greeting {
    color: #bdc3c7;
    font-size: 1rem;
    margin: 0 0 1.714rem;
  }
  .status {
    font-size: 0.929rem;
    font-style: italic;
    margin-bottom: 1.143rem;
  }
  .spinner {
    width: 2.286rem;
    height: 2.286rem;
    border: 0.214rem solid rgba(255,255,255,0.2);
    border-top-color: #f39c12;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
