<script lang="ts">
  import { appStore } from '$lib/stores/appStore.svelte';
  import GastosDashboard from '$lib/components/gastos/GastosDashboard.svelte';
  import ProveedoresTab from '$lib/components/gastos/ProveedoresTab.svelte';
  import SueldosTab from '$lib/components/gastos/SueldosTab.svelte';
  import AsistenciaTab from '$lib/components/gastos/AsistenciaTab.svelte';
  import ExpenseCategoriesTab from '$lib/components/gastos/ExpenseCategoriesTab.svelte';
</script>

<div class="gastos">
  {#if appStore.gastosTab === 'dashboard'}
    <GastosDashboard />
  {:else if appStore.gastosTab === 'proveedores'}
    <ProveedoresTab />
  {:else if appStore.gastosTab === 'sueldos'}
    <SueldosTab />
  {:else if appStore.gastosTab === 'asistencia'}
    <AsistenciaTab />
  {:else if appStore.gastosTab === 'categorias'}
    <ExpenseCategoriesTab />
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
</style>
