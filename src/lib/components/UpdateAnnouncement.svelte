<script lang="ts">
  let { version, notes, show, onclose } = $props<{
    version: string;
    notes: string;
    show: boolean;
    onclose: () => void;
  }>();

  let lines = $derived((notes || '').split('\n').filter(Boolean));
</script>

{#if show}
  <div class="update-overlay" onclick={onclose} role="presentation">
    <div class="update-modal" onclick={(e) => e.stopPropagation()} role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && onclose()}>
      <div class="update-header">
        <div class="update-icon">🎉</div>
        <h2>Novedades {version}</h2>
        <button class="update-close" onclick={onclose}>✕</button>
      </div>
      <div class="update-body">
        {#each lines as line}
          <p>{line}</p>
        {/each}
      </div>
      <div class="update-footer">
        <button class="btn btn-primary" onclick={onclose}>Entendido</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .update-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 2000;
  }
  .update-modal {
    background: var(--bg-card, #fff);
    border-radius: 12px;
    padding: 1.5rem;
    min-width: 20rem;
    max-width: 28rem;
    width: 90vw;
    box-shadow: 0 8px 30px rgba(0,0,0,0.2);
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .update-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .update-icon {
    font-size: 1.5rem;
  }
  .update-header h2 {
    flex: 1;
    margin: 0;
    font-size: 1.1rem;
    color: var(--text-primary, #111827);
  }
  .update-close {
    width: 1.5rem;
    height: 1.5rem;
    border: none;
    background: none;
    color: var(--text-muted, #9ca3af);
    cursor: pointer;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1rem;
  }
  .update-close:hover { background: rgba(0,0,0,0.06); color: #ef4444; }
  .update-body {
    max-height: 40vh;
    overflow-y: auto;
    padding: 0.5rem 0;
  }
  .update-body p {
    margin: 0 0 0.5rem;
    font-size: 0.9rem;
    color: var(--text-secondary, #6b7280);
    line-height: 1.5;
  }
  .update-body p:last-child { margin-bottom: 0; }
  .update-footer {
    display: flex;
    justify-content: flex-end;
  }
  :global(.btn.btn-primary) {
    padding: 0.5rem 1.2rem;
    background: #3b82f6;
    color: white;
    border: none;
    border-radius: 6px;
    font-size: 0.9rem;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  :global(.btn.btn-primary:hover) { background: #2563eb; }
</style>
