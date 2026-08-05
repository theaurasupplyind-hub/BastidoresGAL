<script lang="ts">
  let { impresaAt = null, impresaPor = null }: {
    impresaAt?: string | null;
    impresaPor?: string | null;
  } = $props();
</script>

<span
  class="printer-badge"
  title={`Impreso el ${impresaAt ?? ''}${impresaPor ? ` por ${impresaPor}` : ''}`}
>
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M19 8H5a3 3 0 0 0-3 3v6a1 1 0 0 0 1 1h2v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3h2a1 1 0 0 0 1-1v-6a3 3 0 0 0-3-3Zm-4 10H9v-4h6v4Zm4-7a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm-2-7H7a1 1 0 0 0-1 1v2h12V5a1 1 0 0 0-1-1Z"/>
  </svg>
</span>

<style>
  .printer-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    padding: 0.143rem 0.286rem;
    background: #d4edda;
    color: #155724;
    border: 1px solid #c3e6cb;
    border-radius: 0.286rem;
  }
</style>
