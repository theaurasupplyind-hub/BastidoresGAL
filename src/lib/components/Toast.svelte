<script lang="ts">
  import { appStore } from '$lib/stores/appStore.svelte';
</script>

{#if appStore.toast}
  <div class="toast" class:success={appStore.toast.type === 'success'} class:error={appStore.toast.type === 'error'} class:info={appStore.toast.type === 'info'}>
    {#if appStore.toast.type === 'success'} ✔
    {:else if appStore.toast.type === 'error'} ✗
    {:else} ℹ
    {/if}
    {appStore.toast.message}
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    top: 1.143rem;
    right: 1.143rem;
    padding: 0.857rem 1.429rem;
    border-radius: 0.571rem;
    color: white;
    font-weight: 500;
    font-size: 1rem;
    z-index: 9999;
    box-shadow: 0 0.286rem 0.857rem rgba(0,0,0,0.15);
    animation: slideIn 0.25s ease-out;
  }
  .success { background: var(--success); }
  .error { background: var(--danger); }
  .info { background: var(--accent); }
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
</style>
