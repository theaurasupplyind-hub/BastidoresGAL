<!-- MapaClientes.svelte -->
<!-- 
  Instalación: npm install leaflet
  En tu app.css o main.css agregar:
  @import 'leaflet/dist/leaflet.css';
-->

<script>
  import { onMount, onDestroy } from 'svelte';

  // URL base de tu API en Render — cambiá por tu URL real
  const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

  let mapContainer;
  let map;
  let L; // instancia de Leaflet

  let todosLosClientes = [];
  let clientesDelDia = [];
  let seleccionados = new Set(); // IDs de clientes marcados para la ruta

  let fecha = new Date().toISOString().split('T')[0]; // hoy por defecto
  let cargando = false;
  let error = '';

  // Marcadores activos en el mapa
  let marcadores = {};

  // --- Íconos ---
  function crearIcono(color) {
    return L.divIcon({
      className: '',
      html: `
        <div style="
          width: 14px; height: 14px;
          background: ${color};
          border: 2px solid white;
          border-radius: 50%;
          box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        "></div>
      `,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
  }

  function crearIconoPendiente(seleccionado = false) {
    return L.divIcon({
      className: '',
      html: `
        <div style="
          width: ${seleccionado ? 20 : 18}px;
          height: ${seleccionado ? 20 : 18}px;
          background: ${seleccionado ? '#f59e0b' : '#ef4444'};
          border: 2.5px solid white;
          border-radius: 50%;
          box-shadow: 0 0 0 3px ${seleccionado ? 'rgba(245,158,11,0.35)' : 'rgba(239,68,68,0.3)'};
          animation: pulso 1.5s infinite;
        "></div>
        <style>
          @keyframes pulso {
            0%, 100% { box-shadow: 0 0 0 3px ${seleccionado ? 'rgba(245,158,11,0.35)' : 'rgba(239,68,68,0.3)'}; }
            50% { box-shadow: 0 0 0 6px ${seleccionado ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)'}; }
          }
        </style>
      `,
      iconSize: [seleccionado ? 20 : 18, seleccionado ? 20 : 18],
      iconAnchor: [seleccionado ? 10 : 9, seleccionado ? 10 : 9],
    });
  }

  // --- Inicializar mapa ---
  async function initMapa() {
    L = await import('leaflet');

    map = L.map(mapContainer).setView([-34.6037, -58.3816], 13); // CABA

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    await cargarTodosLosClientes();
    await cargarEntregasDelDia();
  }

  // --- Cargar todos los clientes ---
  async function cargarTodosLosClientes() {
    try {
      const res = await fetch(`${API_BASE}/mapa/clientes`);
      todosLosClientes = await res.json();
      renderizarMarcadores();
    } catch (e) {
      error = 'No se pudieron cargar los clientes.';
    }
  }

  // --- Cargar entregas del día ---
  async function cargarEntregasDelDia() {
    cargando = true;
    try {
      const res = await fetch(`${API_BASE}/mapa/entregas?fecha=${fecha}`);
      clientesDelDia = await res.json();
      seleccionados = new Set(clientesDelDia.map(c => c.id));
      renderizarMarcadores();
    } catch (e) {
      error = 'No se pudieron cargar las entregas.';
    } finally {
      cargando = false;
    }
  }

  // --- Renderizar todos los marcadores ---
  function renderizarMarcadores() {
    if (!map || !L) return;

    // Limpiar marcadores anteriores
    Object.values(marcadores).forEach(m => map.removeLayer(m));
    marcadores = {};

    const idsPendientes = new Set(clientesDelDia.map(c => c.id));

    for (const cliente of todosLosClientes) {
      const esPendiente = idsPendientes.has(cliente.id);
      const estaSeleccionado = seleccionados.has(cliente.id);

      const icono = esPendiente
        ? crearIconoPendiente(estaSeleccionado)
        : crearIcono('#3b82f6');

      const marker = L.marker([cliente.lat, cliente.lng], { icon: icono })
        .addTo(map)
        .bindPopup(popupHtml(cliente, esPendiente));

      if (esPendiente) {
        marker.on('click', () => toggleSeleccion(cliente.id));
      }

      marcadores[cliente.id] = marker;
    }
  }

  function popupHtml(cliente, esPendiente) {
    const facturasDelDia = clientesDelDia.find(c => c.id === cliente.id)?.facturas ?? [];
    return `
      <div style="font-family:sans-serif; font-size:13px; min-width:160px;">
        <strong>${cliente.nombre}</strong><br>
        <span style="color:#666;">${cliente.domicilio ?? ''}</span>
        ${cliente.telefono ? `<br>📞 ${cliente.telefono}` : ''}
        ${esPendiente ? `
          <hr style="margin:6px 0; border-color:#eee;">
          <span style="color:#ef4444; font-weight:600;">📦 Entrega hoy</span>
          ${facturasDelDia.map(f =>
            `<br><small>Factura ${f.numero_factura} — $${f.total.toLocaleString('es-AR')}</small>`
          ).join('')}
        ` : ''}
      </div>
    `;
  }

  // --- Toggle selección para la ruta ---
  function toggleSeleccion(id) {
    if (seleccionados.has(id)) {
      seleccionados.delete(id);
    } else {
      seleccionados.add(id);
    }
    seleccionados = seleccionados; // trigger reactivity
    renderizarMarcadores();
  }

  // --- Trazar ruta en Google Maps ---
  function trazarRuta() {
    const clientesRuta = clientesDelDia.filter(c => seleccionados.has(c.id));
    if (clientesRuta.length === 0) return;

    // Primer cliente como destino inicial, resto como waypoints
    const [primero, ...resto] = clientesRuta;
    const destino = encodeURIComponent(`${primero.domicilio}, Buenos Aires`);
    const waypoints = resto
      .map(c => encodeURIComponent(`${c.domicilio}, Buenos Aires`))
      .join('|');

    const url = waypoints
      ? `https://www.google.com/maps/dir/?api=1&destination=${destino}&waypoints=${waypoints}&travelmode=driving`
      : `https://www.google.com/maps/dir/?api=1&destination=${destino}&travelmode=driving`;

    window.open(url, '_blank');
  }

  // --- Centrar mapa en CABA ---
  function centrarMapa() {
    map?.setView([-34.6037, -58.3816], 13);
  }

  onMount(() => {
    initMapa();
  });

  onDestroy(() => {
    map?.remove();
  });

  $: clientesSeleccionados = clientesDelDia.filter(c => seleccionados.has(c.id));
</script>

<!-- MARKUP -->
<div class="mapa-wrapper">

  <!-- Panel lateral -->
  <aside class="panel">
    <h2 class="panel-titulo">Entregas del día</h2>

    <label class="label" for="fecha-input">Fecha</label>
    <input
      id="fecha-input"
      type="date"
      bind:value={fecha}
      on:change={cargarEntregasDelDia}
      class="input-fecha"
    />

    {#if cargando}
      <p class="info-text">Cargando...</p>
    {:else if clientesDelDia.length === 0}
      <p class="info-text">Sin entregas para esta fecha.</p>
    {:else}
      <p class="info-text">{clientesDelDia.length} entrega{clientesDelDia.length > 1 ? 's' : ''} — hacé click en el pin para seleccionar</p>

      <ul class="lista-clientes">
        {#each clientesDelDia as cliente}
          <li
            class="cliente-item"
            class:seleccionado={seleccionados.has(cliente.id)}
            on:click={() => toggleSeleccion(cliente.id)}
          >
            <span class="cliente-dot" style="background:{seleccionados.has(cliente.id) ? '#f59e0b' : '#ef4444'}"></span>
            <div>
              <div class="cliente-nombre">{cliente.nombre}</div>
              <div class="cliente-dir">{cliente.domicilio ?? ''}</div>
            </div>
          </li>
        {/each}
      </ul>

      <button
        class="btn-ruta"
        disabled={clientesSeleccionados.length === 0}
        on:click={trazarRuta}
      >
        🗺️ Trazar ruta ({clientesSeleccionados.length})
      </button>
    {/if}

    {#if error}
      <p class="error-text">{error}</p>
    {/if}

    <button class="btn-centrar" on:click={centrarMapa}>Centrar en CABA</button>
  </aside>

  <!-- Mapa -->
  <div class="mapa-container" bind:this={mapContainer}></div>

</div>

<style>
  .mapa-wrapper {
    display: flex;
    height: 100vh;
    width: 100%;
    font-family: sans-serif;
  }

  /* Panel lateral */
  .panel {
    width: 280px;
    min-width: 240px;
    background: #fff;
    border-right: 1px solid #e5e7eb;
    padding: 1rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    z-index: 10;
  }

  .panel-titulo {
    font-size: 16px;
    font-weight: 600;
    margin: 0;
    color: #111;
  }

  .label {
    font-size: 12px;
    color: #6b7280;
    margin-bottom: 2px;
  }

  .input-fecha {
    width: 100%;
    padding: 6px 10px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 14px;
    box-sizing: border-box;
  }

  .info-text {
    font-size: 13px;
    color: #6b7280;
    margin: 0;
  }

  .lista-clientes {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .cliente-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    cursor: pointer;
    border: 1px solid #e5e7eb;
    transition: background 0.15s;
  }

  .cliente-item:hover {
    background: #f9fafb;
  }

  .cliente-item.seleccionado {
    background: #fffbeb;
    border-color: #f59e0b;
  }

  .cliente-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 3px;
  }

  .cliente-nombre {
    font-size: 13px;
    font-weight: 500;
    color: #111;
  }

  .cliente-dir {
    font-size: 11px;
    color: #9ca3af;
  }

  .btn-ruta {
    padding: 10px;
    background: #2563eb;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    width: 100%;
    transition: background 0.15s;
  }

  .btn-ruta:hover:not(:disabled) {
    background: #1d4ed8;
  }

  .btn-ruta:disabled {
    background: #93c5fd;
    cursor: not-allowed;
  }

  .btn-centrar {
    padding: 8px;
    background: transparent;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    font-size: 12px;
    color: #6b7280;
    cursor: pointer;
    width: 100%;
  }

  .btn-centrar:hover {
    background: #f3f4f6;
  }

  .error-text {
    font-size: 12px;
    color: #ef4444;
    margin: 0;
  }

  /* Mapa */
  .mapa-container {
    flex: 1;
    z-index: 1;
  }

  /* Móvil: panel encima del mapa */
  @media (max-width: 640px) {
    .mapa-wrapper {
      flex-direction: column;
    }
    .panel {
      width: 100%;
      height: auto;
      max-height: 40vh;
      border-right: none;
      border-bottom: 1px solid #e5e7eb;
    }
    .mapa-container {
      flex: 1;
      min-height: 60vh;
    }
  }
</style>
