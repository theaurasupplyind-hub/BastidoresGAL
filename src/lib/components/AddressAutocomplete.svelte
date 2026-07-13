<script lang="ts">
  interface Suggestion {
    label: string;
    lat: number;
    lng: number;
  }

  let { value = '', placeholder = '', className = '', onchange, onselect }: {
    value?: string;
    placeholder?: string;
    className?: string;
    onchange?: (v: string) => void;
    onselect?: (data: { label: string; lat: number; lng: number }) => void;
  } = $props();

  let suggestions: Suggestion[] = $state([]);
  let open = $state(false);
  let selectedIndex = $state(-1);
  let loading = $state(false);
  let inputEl: HTMLInputElement;
  let containerEl: HTMLDivElement;
  let debounceTimer: ReturnType<typeof setTimeout>;

  function handleInput(e: Event) {
    const target = e.target as HTMLInputElement;
    value = target.value;
    onchange?.(value);

    clearTimeout(debounceTimer);
    if (value.length < 2) {
      suggestions = [];
      open = false;
      return;
    }
    debounceTimer = setTimeout(() => fetchSuggestions(value), 300);
  }

  async function fetchSuggestions(q: string) {
    loading = true;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q + ', Buenos Aires, Argentina')}&format=json&limit=5&countrycodes=ar`,
        { headers: { 'User-Agent': 'BastidoresGal/1.0' } }
      );
      const data = await res.json();
      suggestions = (data || []).map((r: any) => ({
        label: r.display_name,
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
      }));
      open = suggestions.length > 0 && value.length >= 2;
      selectedIndex = -1;
    } catch {
      suggestions = [];
      open = false;
    } finally {
      loading = false;
    }
  }

  function selectSuggestion(s: Suggestion) {
    value = s.label;
    open = false;
    suggestions = [];
    onchange?.(s.label);
    onselect?.({ label: s.label, lat: s.lat, lng: s.lng });
    inputEl?.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, suggestions.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, -1);
    } else if (e.key === 'Enter') {
      if (selectedIndex >= 0 && suggestions[selectedIndex]) {
        e.preventDefault();
        selectSuggestion(suggestions[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      open = false;
    }
  }

  function handleFocus() {
    if (suggestions.length > 0) open = true;
  }

  function handleBlur() {
    setTimeout(() => { open = false; }, 200);
  }
</script>

<div class="ac-wrapper" bind:this={containerEl}>
  <input
    bind:this={inputEl}
    type="text"
    {placeholder}
    {value}
    oninput={handleInput}
    onkeydown={handleKeydown}
    onfocus={handleFocus}
    onblur={handleBlur}
    class="ac-input {className}"
    autocomplete="off"
  />
  {#if loading}
    <span class="ac-loading">⏳</span>
  {/if}
  {#if open && suggestions.length > 0}
    <ul class="ac-dropdown" role="listbox">
      {#each suggestions as s, i}
        <li
          role="option"
          aria-selected={i === selectedIndex}
          class="ac-item"
          class:ac-selected={i === selectedIndex}
          onmousedown={(e) => { e.preventDefault(); selectSuggestion(s); }}
        >
          <span class="ac-icon">📍</span>
          <span class="ac-text">{s.label}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .ac-wrapper {
    position: relative;
    display: flex;
    align-items: center;
    width: 100%;
  }
  .ac-input {
    flex: 1;
    min-width: 0;
  }
  .ac-loading {
    position: absolute;
    right: 8px;
    font-size: 12px;
    pointer-events: none;
  }
  .ac-dropdown {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 1000;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.12);
    list-style: none;
    margin: 4px 0 0;
    padding: 4px;
    max-height: 220px;
    overflow-y: auto;
  }
  .ac-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    cursor: pointer;
    border-radius: 6px;
    font-size: 13px;
    color: var(--text-primary);
    transition: background 0.1s;
  }
  .ac-item:hover,
  .ac-selected {
    background: var(--bg-page);
  }
  .ac-icon {
    flex-shrink: 0;
    font-size: 14px;
  }
  .ac-text {
    line-height: 1.4;
  }
</style>
