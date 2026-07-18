<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api/client';
  import { appStore } from '$lib/stores/appStore.svelte';
  import type { VoucherReview } from '$lib/types';

  let loading = $state(false);
  let rows = $state<VoucherReview[]>([]);
  let deleting = $state<Set<number>>(new Set());
  let cleaning = $state(false);
  let offset = $state(0);
  let hasMore = $state(false);
  let status = $state<'pending' | 'seen' | 'all'>('pending');
  let fromDate = $state('');
  let toDate = $state('');
  const PAGE_SIZE = 10;

  function formatDate(value?: string | null): string {
    if (!value) return '—';
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return d.toLocaleString('es-AR');
  }

  function formatMoney(value?: number | null): string {
    if (value === null || value === undefined) return '—';
    return '$' + value.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function mediaUrl(id: number): string {
    return api.getVoucherReviewMediaUrl(id);
  }

  async function deleteRow(id: number) {
    if (!confirm('¿Eliminar este registro definitivamente?')) return;
    deleting.add(id);
    try {
      await api.deleteVoucherReview(id);
      rows = rows.filter(r => r.id !== id);
      appStore.showToast('Registro eliminado', 'success');
    } catch (e) {
      appStore.alert('Error al eliminar: ' + (e as Error).message);
    } finally {
      const s = new Set(deleting);
      s.delete(id);
      deleting = s;
    }
  }

  async function loadRows() {
    loading = true;
    offset = 0;
    try {
      const data = await api.listVoucherReviews({
        status,
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
        limit: PAGE_SIZE + 1,
      });
      hasMore = data.length > PAGE_SIZE;
      rows = data.slice(0, PAGE_SIZE);
    } catch (e) {
      appStore.alert('Error al cargar revisiones: ' + (e as Error).message);
    } finally {
      loading = false;
    }
  }

  async function loadMore() {
    const newOffset = offset + PAGE_SIZE;
    try {
      const data = await api.listVoucherReviews({
        status,
        from_date: fromDate || undefined,
        to_date: toDate || undefined,
        limit: PAGE_SIZE + 1,
        offset: newOffset,
      });
      hasMore = data.length > PAGE_SIZE;
      rows = [...rows, ...data.slice(0, PAGE_SIZE)];
      offset = newOffset;
    } catch (e) {
      appStore.alert('Error al cargar más: ' + (e as Error).message);
    }
  }

  async function cleanupOld() {
    if (!confirm('¿Eliminar registros viejos? Se mantendrán los últimos 200.')) return;
    cleaning = true;
    try {
      const result = await api.cleanupVoucherReviews(200);
      appStore.showToast(`Se eliminaron ${result.deleted} registro(s) viejos. Quedan ${result.kept}.`, 'success');
      await loadRows();
    } catch (e) {
      appStore.alert('Error al limpiar: ' + (e as Error).message);
    } finally {
      cleaning = false;
    }
  }

  onMount(loadRows);
</script>

<div class="revision-vouchers">
  <div class="toolbar">
    <div class="filters">
      <select bind:value={status}>
        <option value="pending">Pendientes</option>
        <option value="seen">Vistos</option>
        <option value="all">Todos</option>
      </select>
      <input type="date" bind:value={fromDate} />
      <input type="date" bind:value={toDate} />
      <button class="btn" onclick={loadRows} disabled={loading}>{loading ? 'Actualizando...' : 'Actualizar'}</button>
      <button class="btn btn-cleanup" onclick={cleanupOld} disabled={cleaning}>
        {cleaning ? 'Limpiando...' : '🧹 Limpiar viejos'}
      </button>
    </div>
    <div class="count">{rows.length} registro(s)</div>
  </div>

  {#if loading && rows.length === 0}
    <div class="empty">Cargando revisiones...</div>
  {:else if rows.length === 0}
    <div class="empty">No hay comprobantes para los filtros actuales.</div>
  {:else}
    <div class="cards">
      {#each rows as row (row.id)}
        <article class="card">
          <div class="media">
            {#if row.media_mime_type.startsWith('image/')}
              <img src={mediaUrl(row.id)} alt={`Comprobante ${row.id}`} loading="lazy" />
            {:else}
              <a href={mediaUrl(row.id)} target="_blank" rel="noreferrer">Abrir archivo</a>
            {/if}
          </div>
          <div class="body">
            <div class="header-row">
              <span class={`badge status-${row.match_status}`}>{row.match_status.toUpperCase()}</span>
              <span class="meta">#{row.id} · {formatDate(row.created_at)}</span>
              <button class="btn-delete" onclick={() => deleteRow(row.id)} disabled={deleting.has(row.id)} title="Eliminar">
                {deleting.has(row.id) ? '...' : '🗑'}
              </button>
            </div>

            <div class="grid">
              <div><b>Telefono:</b> {row.wa_id}</div>
              <div><b>Contacto:</b> {row.contact_name || '—'}</div>
              <div><b>Cliente extraído (IA):</b> {row.extracted_nombre_cliente || '—'}</div>
              <div><b>Monto IA:</b> {formatMoney(row.extracted_monto)}</div>
              <div><b>Fecha IA:</b> {row.extracted_fecha || '—'}</div>
              <div><b>Referencia:</b> {row.extracted_referencia || '—'}</div>
              <div><b>Banco:</b> {row.extracted_banco || '—'}</div>
              <div><b>CBU destino (IA):</b> {row.extracted_cbu_destino || '—'}</div>
              <div><b>CUIT destino (IA):</b> {row.extracted_cuit_destino || '—'}</div>
            </div>

            <div class="target">
              <div><b>Pagó (Origen):</b> {row.extracted_nombre_origen || row.extracted_nombre_cliente || '—'}</div>
              <div><b>Cliente apuntado:</b> {row.matched_cliente_nombre || '—'}</div>
              <div><b>Factura apuntada:</b> {row.matched_invoice_numero || '—'}</div>
              <div><b>Saldo apuntado:</b> {formatMoney(row.matched_saldo_pendiente)}</div>
              <div><b>Cobró (Destino):</b>
                {#if row.extracted_nombre_destino}
                  {row.extracted_nombre_destino}
                {:else}
                  <span class="destino-pendiente">No detectado</span>
                {/if}
                {#if row.entity_name}
                  → {row.entity_type === 'PROVIDER' ? 'Proveedor' : 'Empleado'}: {row.entity_name}
                {/if}
                {#if row.entity_cuit}<div class="destino-detalle"><b>CUIT:</b> {row.entity_cuit}</div>{/if}
                {#if row.entity_cbu}<div class="destino-detalle"><b>CBU:</b> {row.entity_cbu}</div>{/if}
                {#if row.entity_match_field}<div class="destino-detalle"><b>Match por:</b> {row.entity_match_field === 'cbu' ? 'CBU exacto' : row.entity_match_field === 'cuit' ? 'CUIT exacto' : row.entity_match_field === 'alias' ? 'Alias' : 'Nombre'}</div>{/if}
              </div>
            </div>

            {#if row.candidatas.length > 0}
              <div class="candidates">
                <b>Candidatas:</b>
                {#each row.candidatas as c}
                  <span class="candidate-item">{c.numero_factura} ({c.cliente_nombre || '—'} — {formatMoney(c.saldo_pendiente)})</span>
                {/each}
              </div>
            {/if}
          </div>
        </article>
      {/each}
    </div>
    {#if hasMore}
      <div class="load-more-wrap">
        <button class="btn btn-load-more" onclick={loadMore}>Cargar más</button>
      </div>
    {/if}
  {/if}
</div>

<style>
  .revision-vouchers {
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--bg-page);
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    background: var(--bg-card);
    border-radius: 0.5rem;
    padding: 0.65rem 0.8rem;
  }
  .filters {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }
  .filters input,
  .filters select {
    border: 1px solid var(--border);
    border-radius: 0.4rem;
    padding: 0.35rem 0.5rem;
    font-size: 0.88rem;
    background: var(--bg-card);
    color: var(--text-primary);
  }
  .btn {
    border: none;
    border-radius: 0.4rem;
    padding: 0.4rem 0.8rem;
    background: var(--accent);
    color: white;
    cursor: pointer;
  }
  .count { color: var(--text-muted); font-size: 0.9rem; }
  .btn-cleanup { background: #e67e22; color: white; }
  .btn-cleanup:hover { filter: brightness(0.9); }
  .btn-load-more {
    display: block; margin: 0.5rem auto; padding: 0.5rem 2rem;
    border: 1px solid var(--border); border-radius: 0.4rem;
    background: var(--bg-card); color: var(--text-secondary); cursor: pointer;
  }
  .btn-load-more:hover { background: var(--bg-hover); }
  .load-more-wrap { text-align: center; }
  .empty {
    flex: 1;
    display: grid;
    place-items: center;
    color: var(--text-muted);
    background: var(--bg-card);
    border-radius: 0.6rem;
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    overflow: auto;
    padding-right: 0.25rem;
  }
  .card {
    display: grid;
    grid-template-columns: 160px 1fr;
    gap: 0.8rem;
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: 0.6rem;
    padding: 0.75rem;
  }
  .media {
    background: var(--bg-page);
    border-radius: 0.5rem;
    min-height: 140px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  .media img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .body { display: flex; flex-direction: column; gap: 0.55rem; }
  .header-row { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
  .badge {
    font-size: 0.75rem;
    font-weight: 700;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
  }
  .status-matched { background: #e8f7ee; color: #1e7f45; }
  .status-ambiguous { background: #fff5df; color: #9a6a00; }
  .status-no_match { background: #fdecec; color: #ad2a2a; }
  .meta { color: var(--text-muted); font-size: 0.82rem; }
  .btn-delete {
    background: none; border: none; cursor: pointer; font-size: 0.9rem;
    padding: 0.15rem 0.3rem; border-radius: 0.3rem; color: var(--text-muted);
    margin-left: auto; opacity: 0.5; transition: opacity 0.15s;
  }
  .btn-delete:hover { opacity: 1; background: #fdecec; }
  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.35rem 0.8rem;
    font-size: 0.9rem;
  }
  .target {
    font-size: 0.92rem;
    background: var(--accent-light);
    border-radius: 0.45rem;
    padding: 0.45rem 0.55rem;
    display: grid;
    gap: 0.25rem;
  }
  .candidates {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.35rem;
    font-size: 0.86rem;
  }
  .destino-pendiente { color: var(--text-muted); font-style: italic; font-size: 0.85rem; }
  .candidate-item {
    background: var(--bg-page);
    border: 1px solid var(--border-light);
    border-radius: 0.35rem;
    padding: 0.2rem 0.45rem;
  }
  @media (max-width: 900px) {
    .card { grid-template-columns: 1fr; }
    .media { min-height: 180px; }
    .grid { grid-template-columns: 1fr; }
  }
</style>
