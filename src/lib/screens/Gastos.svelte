<script lang="ts">
  import GastosDashboard from '$lib/components/gastos/GastosDashboard.svelte';
  import ProveedoresTab from '$lib/components/gastos/ProveedoresTab.svelte';
  import SueldosTab from '$lib/components/gastos/SueldosTab.svelte';
  import AsistenciaTab from '$lib/components/gastos/AsistenciaTab.svelte';

  type GTab = 'dashboard' | 'proveedores' | 'sueldos' | 'asistencia';
  let currentGTab = $state<GTab>('dashboard');
</script>

<div class="gastos">
  <div class="gastos-header">
    <h2>Gastos</h2>
    <div class="gastos-tabs">
      <button class="g-tab-btn" class:active={currentGTab === 'dashboard'} onclick={() => currentGTab = 'dashboard'}>📊 Dashboard</button>
      <button class="g-tab-btn" class:active={currentGTab === 'proveedores'} onclick={() => currentGTab = 'proveedores'}>📂 Proveedores</button>
      <button class="g-tab-btn" class:active={currentGTab === 'sueldos'} onclick={() => currentGTab = 'sueldos'}>👷 Sueldos</button>
      <button class="g-tab-btn" class:active={currentGTab === 'asistencia'} onclick={() => currentGTab = 'asistencia'}>📅 Asistencia</button>
    </div>
  </div>

  {#if currentGTab === 'dashboard'}
    <GastosDashboard />
  {:else if currentGTab === 'proveedores'}
    <ProveedoresTab />
  {:else if currentGTab === 'sueldos'}
    <SueldosTab />
  {:else if currentGTab === 'asistencia'}
    <AsistenciaTab />
  {/if}
</div>

<style>
  .gastos {
    padding: 1.143rem;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 0.714rem;
    background: #f5f6fa;
    overflow: auto;
  }

  .gastos-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.571rem;
  }
  .gastos-header h2 { margin: 0; font-size: 1.3rem; color: #2c3e50; }
  .gastos-tabs { display: flex; gap: 0.143rem; background: #e9ecef; border-radius: 0.429rem; padding: 0.143rem; }
  .g-tab-btn {
    padding: 0.429rem 1rem;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 0.8rem;
    color: var(--text-secondary);
    border-radius: 0.286rem;
    transition: all 0.12s;
  }
  .g-tab-btn:hover { background: var(--bg-card); }
  .g-tab-btn.active { background: var(--bg-card); color: var(--text-primary); font-weight: 600; box-shadow: 0 0.071rem 0.214rem rgba(0,0,0,0.08); }
</style>
