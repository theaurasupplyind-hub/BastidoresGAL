<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { AssistantAttachment } from '$lib/assistant/types';
  import { getImage } from '$lib/assistant/imageStore';

  let {
    attachment,
    onopen,
  }: { attachment: AssistantAttachment; onopen: (url: string) => void } = $props();

  let url = $state<string | null>(null);
  let missing = $state(false);

  onMount(async () => {
    try {
      const blob = await getImage(attachment.id);
      if (blob) url = URL.createObjectURL(blob);
      else missing = true;
    } catch {
      missing = true;
    }
  });

  onDestroy(() => {
    if (url) URL.revokeObjectURL(url);
  });
</script>

{#if url}
  <button
    type="button"
    class="att-thumb"
    title={`Ver ${attachment.name}`}
    aria-label={`Ver imagen ${attachment.name}`}
    onclick={() => {
      if (url) onopen(url);
    }}
  >
    <img src={url} alt={attachment.name} loading="lazy" />
  </button>
{:else if missing}
  <div class="att-thumb missing" title="Imagen no disponible">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" />
    </svg>
  </div>
{:else}
  <div class="att-thumb loading" aria-hidden="true"></div>
{/if}

<style>
  .att-thumb {
    width: 4rem;
    height: 4rem;
    border-radius: 0.5rem;
    overflow: hidden;
    border: 1px solid var(--border);
    background: var(--bg-hover);
    flex: none;
    padding: 0;
    cursor: zoom-in;
  }

  .att-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .att-thumb.missing,
  .att-thumb.loading {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .att-thumb.loading {
    background: linear-gradient(
      100deg,
      var(--bg-hover) 30%,
      var(--bg-subtle) 50%,
      var(--bg-hover) 70%
    );
    background-size: 200% 100%;
    animation: shimmer 1.2s infinite linear;
  }

  @keyframes shimmer {
    from { background-position: 200% 0; }
    to { background-position: -200% 0; }
  }
</style>
