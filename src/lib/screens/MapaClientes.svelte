<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api } from '$lib/api/client';
  import { open as shellOpen } from '@tauri-apps/plugin-shell';
  import { mapaStore } from '$lib/stores/mapaStore.svelte';
  import RecomendacionRutasModal from '$lib/components/RecomendacionRutasModal.svelte';

  let mapContainer;
  let map;
  let L;

  let todosLosClientes = $state([]);
  let clientesDelDia = $state([]);
  let seleccionados = $state(new Set());
  let ordenRuta = $state([]);
  let editandoOrdenId = $state(null);
  let ordenInputValue = $state('');

  let fecha = $state(mapaStore.fecha);
  let cargando = $state(false);
  let error = $state('');
  let busqueda = $state(mapaStore.busqueda);

  let marcadores = {};
  let marcadorOrigen = null;

  let origenDireccion = $state(mapaStore.origenDireccion);
  let origenCoords = $state(mapaStore.origenCoords);
  let editandoOrigen = $state(mapaStore.editandoOrigen);
  let geocodificandoOrigen = $state(mapaStore.geocodificandoOrigen);
  let menuContextual = $state(null);
  let showRecomendarModal = $state(false);

  let clientesSeleccionados = $derived.by(() => {
    const seen = new Set();
    const todos = [...clientesDelDia, ...todosLosClientes];
    return todos.filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return seleccionados.has(c.id);
    });
  });

  let clientesFiltrados = $derived.by(() => {
    if (!busqueda.trim()) return todosLosClientes;
    const q = busqueda.toLowerCase();
    return todosLosClientes.filter(c =>
      c.nombre.toLowerCase().includes(q) ||
      (c.domicilio && c.domicilio.toLowerCase().includes(q))
    );
  });

  let entregasFiltradas = $derived.by(() => {
    if (!busqueda.trim()) return clientesDelDia;
    const q = busqueda.toLowerCase();
    return clientesDelDia.filter(c =>
      c.nombre.toLowerCase().includes(q) ||
      (c.domicilio && c.domicilio.toLowerCase().includes(q))
    );
  });

  let clientesPanel = $derived.by(() => {
    const idsHoy = new Set(clientesDelDia.map(c => c.id));
    const q = busqueda.trim().toLowerCase();

    const hoy = clientesDelDia
      .filter(c => !q || c.nombre.toLowerCase().includes(q) || (c.domicilio && c.domicilio.toLowerCase().includes(q)))
      .map(c => ({ ...c, tipo_marcador: 'hoy' }));

    const pendientes = todosLosClientes
      .filter(c =>
        c.pedidos_pendientes > 0 &&
        !idsHoy.has(c.id) &&
        (!q || c.nombre.toLowerCase().includes(q) || (c.domicilio && c.domicilio.toLowerCase().includes(q)))
      )
      .map(c => ({ ...c, tipo_marcador: 'pendiente' }));

    const idsEnPanel = new Set([...hoy, ...pendientes].map(c => c.id));
    const agregadosRuta = todosLosClientes
      .filter(c =>
        seleccionados.has(c.id) &&
        !idsEnPanel.has(c.id) &&
        (!q || c.nombre.toLowerCase().includes(q) || (c.domicilio && c.domicilio.toLowerCase().includes(q)))
      )
      .map(c => ({ ...c, tipo_marcador: 'ruta' }));

    return [...hoy, ...pendientes, ...agregadosRuta];
  });

  $effect(() => {
    const f = mapaStore.fecha;
    if (f !== fecha) {
      fecha = f;
      cargarEntregasDelDia();
    }
  });

  $effect(() => {
    const b = mapaStore.busqueda;
    if (b !== busqueda) {
      busqueda = b;
      renderizarMarcadores();
    }
  });

  $effect(() => {
    const od = mapaStore.origenDireccion;
    if (od !== origenDireccion) {
      origenDireccion = od;
    }
  });

  $effect(() => {
    const oc = mapaStore.origenCoords;
    if (oc !== origenCoords) {
      origenCoords = oc;
      renderizarMarcadorOrigen();
    }
  });

  $effect(() => {
    const eo = mapaStore.editandoOrigen;
    if (eo !== editandoOrigen) {
      editandoOrigen = eo;
    }
  });

  $effect(() => {
    const idsHoy = new Set(clientesDelDia.map(c => c.id));
    mapaStore.pendientesCount = todosLosClientes.filter(c => c.pedidos_pendientes > 0 && !idsHoy.has(c.id)).length;
  });

  function crearIcono(color, glow = false) {
    const shadow = glow
      ? `0 0 8px ${color}88, 0 1px 4px rgba(0,0,0,0.4)`
      : `0 1px 4px rgba(0,0,0,0.4)`;
    return L.divIcon({
      className: '',
      html: `<div style="width:14px;height:14px;background:${color};border:2px solid white;border-radius:50%;box-shadow:${shadow};"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
  }

  function crearIconoPendiente(seleccionado = false) {
    const color = seleccionado ? '#f59e0b' : '#ef4444';
    const size = seleccionado ? 20 : 18;
    return L.divIcon({
      className: 'pin-pendiente',
      html: `<div class="pin-dot" style="width:${size}px;height:${size}px;background:${color};" data-seleccionado="${seleccionado}"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  function crearIconoSeleccionado(numero) {
    return L.divIcon({
      className: '',
      html: `<div style="width:32px;height:32px;background:#f59e0b;border:2.5px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:white;box-shadow:0 0 0 3px rgba(245,158,11,0.35);animation:pulso-mapa-global 1.5s infinite;">${numero}</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
  }

  function crearIconoOrigen() {
    return L.divIcon({
      className: '',
      html: `<div style="width:32px;height:32px;background:#2563eb;border:3px solid white;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 2px 8px rgba(0,0,0,0.5);">🏠</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
  }

  async function initMapa() {
    L = await import('leaflet');

    map = L.map(mapContainer).setView([-34.6037, -58.3816], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    await cargarTodosLosClientes();
    await cargarEntregasDelDia();
    await cargarOrigen();
  }

  async function cargarTodosLosClientes() {
    try {
      todosLosClientes = await api.getMapaClientes();
      renderizarMarcadores();
    } catch (e) {
      error = 'No se pudieron cargar los clientes.';
    }
  }

  async function cargarEntregasDelDia() {
    cargando = true;
    try {
      clientesDelDia = await api.getMapaEntregas(fecha);
      seleccionados = new Set(clientesDelDia.map(c => c.id));
      ordenRuta = clientesDelDia.map(c => c.id);
      renderizarMarcadores();
    } catch (e) {
      error = 'No se pudieron cargar las entregas.';
    } finally {
      cargando = false;
    }
  }

  async function cargarOrigen() {
    try {
      const data = await api.getMapaOrigen();
      if (data) {
        origenDireccion = data.direccion;
        mapaStore.origenDireccion = data.direccion;
        origenCoords = data.lat && data.lng ? { lat: data.lat, lng: data.lng } : null;
        mapaStore.origenCoords = origenCoords;
        renderizarMarcadorOrigen();
      }
    } catch (e) {}
  }

  async function geocodificarOrigen() {
    if (!origenDireccion.trim()) return;
    geocodificandoOrigen = true;
    mapaStore.geocodificandoOrigen = true;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(origenDireccion)}, Buenos Aires, Argentina&format=json&limit=1&countrycodes=ar`,
        { headers: { 'User-Agent': 'BastidoresGal/1.0' } }
      );
      const data = await res.json();
      if (data.length) {
        origenCoords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
        mapaStore.origenCoords = origenCoords;
        await api.updateMapaOrigen({ direccion: origenDireccion, lat: origenCoords.lat, lng: origenCoords.lng });
        map?.setView([origenCoords.lat, origenCoords.lng], 15);
        renderizarMarcadorOrigen();
      }
    } catch {}
    finally {
      geocodificandoOrigen = false;
      mapaStore.geocodificandoOrigen = false;
    }
  }

  async function guardarOrigen() {
    await api.updateMapaOrigen({ direccion: origenDireccion, lat: origenCoords?.lat ?? null, lng: origenCoords?.lng ?? null });
    mapaStore.origenDireccion = origenDireccion;
    mapaStore.origenCoords = origenCoords;
    editandoOrigen = false;
    mapaStore.editandoOrigen = false;
    renderizarMarcadorOrigen();
  }

  function renderizarMarcadorOrigen() {
    if (marcadorOrigen) {
      map?.removeLayer(marcadorOrigen);
      marcadorOrigen = null;
    }
    if (!map || !L || !origenCoords) return;
    marcadorOrigen = L.marker([origenCoords.lat, origenCoords.lng], { icon: crearIconoOrigen() })
      .addTo(map)
      .bindPopup(`<div style="font-family:sans-serif;font-size:13px;min-width:120px;"><strong>📍 Salida</strong><br>${origenDireccion}</div>`);
  }

  function mostrarMenuContextual(e, clienteId) {
    e.preventDefault();
    menuContextual = { x: e.clientX, y: e.clientY, id: clienteId };
  }

  function cerrarMenuContextual() {
    menuContextual = null;
  }

  function cerrarEdicion() {
    editandoOrdenId = null;
  }

  function agregarARuta(clienteId) {
    const idMap = {};
    for (const c of todosLosClientes) idMap[c.id] = c;
    for (const c of clientesDelDia) idMap[c.id] = c;
    const cliente = idMap[clienteId];
    if (!cliente) return;
    seleccionados = new Set([...seleccionados, clienteId]);
    if (!ordenRuta.includes(clienteId)) ordenRuta = [...ordenRuta, clienteId];
    menuContextual = null;
    renderizarMarcadores();
  }

  function quitarDeRuta(clienteId) {
    seleccionados.delete(clienteId);
    seleccionados = new Set(seleccionados);
    ordenRuta = ordenRuta.filter(i => i !== clienteId);
    menuContextual = null;
    renderizarMarcadores();
  }

  function renderizarMarcadores() {
    if (!map || !L) return;

    Object.values(marcadores).forEach(m => map.removeLayer(m));
    marcadores = {};

    const idsEntregaHoy = new Set(clientesDelDia.map(c => c.id));

    for (const cliente of clientesFiltrados) {
      if (!cliente.lat || !cliente.lng) continue;

      const esEntregaHoy = idsEntregaHoy.has(cliente.id);
      const estaSeleccionado = seleccionados.has(cliente.id);
      const tienePendientes = cliente.pedidos_pendientes > 0;

      let tipo = 'normal';
      if (esEntregaHoy) {
        tipo = 'hoy';
      } else if (tienePendientes) {
        tipo = 'pendiente';
      }

      let icono;
      if (estaSeleccionado) {
        const num = ordenRuta.indexOf(cliente.id) + 1;
        icono = crearIconoSeleccionado(num);
      } else if (esEntregaHoy) {
        icono = crearIconoPendiente(false);
      } else if (tienePendientes) {
        icono = crearIcono('#22c55e', true);
      } else {
        icono = crearIcono('#3b82f6');
      }

      const marker = L.marker([cliente.lat, cliente.lng], { icon: icono })
        .addTo(map)
        .bindPopup(popupHtml(cliente, tipo));

      marker.on('contextmenu', (e) => {
        L.DomEvent.preventDefault(e.originalEvent);
        mostrarMenuContextual(e.originalEvent, cliente.id);
      });

      if (esEntregaHoy) {
        marker.on('click', () => toggleSeleccion(cliente.id));
      }

      marcadores[cliente.id] = marker;
    }
  }

  function popupHtml(cliente, tipo) {
    if (tipo === 'hoy') {
      const facturasDelDia = clientesDelDia.find(c => c.id === cliente.id)?.facturas ?? [];
      return `<div style="font-family:sans-serif;font-size:13px;min-width:160px;">
        <strong>${cliente.nombre}</strong><br>
        <span style="color:#666;">${cliente.domicilio ?? ''}</span>
        ${cliente.telefono ? `<br>&#128222; ${cliente.telefono}` : ''}
        <hr style="margin:6px 0;border-color:#eee;">
        <span style="color:#f59e0b;font-weight:600;">&#128230; Entrega hoy</span>
        ${facturasDelDia.map(f =>
          `<br><small>Factura ${f.numero_factura} &mdash; $${f.total.toLocaleString('es-AR')}</small>`
        ).join('')}
      </div>`;
    }
    if (tipo === 'pendiente') {
      return `<div style="font-family:sans-serif;font-size:13px;min-width:160px;">
        <strong>${cliente.nombre}</strong><br>
        <span style="color:#666;">${cliente.domicilio ?? ''}</span>
        ${cliente.telefono ? `<br>&#128222; ${cliente.telefono}` : ''}
        <hr style="margin:6px 0;border-color:#eee;">
        <span style="color:#22c55e;font-weight:600;">&#128230; ${cliente.pedidos_pendientes} pedido${cliente.pedidos_pendientes > 1 ? 's' : ''} pendiente${cliente.pedidos_pendientes > 1 ? 's' : ''}</span>
      </div>`;
    }
    return `<div style="font-family:sans-serif;font-size:13px;min-width:160px;">
      <strong>${cliente.nombre}</strong><br>
      <span style="color:#666;">${cliente.domicilio ?? ''}</span>
      ${cliente.telefono ? `<br>&#128222; ${cliente.telefono}` : ''}
    </div>`;
  }

  function toggleSeleccion(id) {
    if (seleccionados.has(id)) {
      seleccionados.delete(id);
      ordenRuta = ordenRuta.filter(i => i !== id);
    } else {
      seleccionados.add(id);
      if (!ordenRuta.includes(id)) ordenRuta = [...ordenRuta, id];
    }
    seleccionados = new Set(seleccionados);
    renderizarMarcadores();
  }

  async function buscarDireccion(e) {
    if (e.key !== 'Enter') return;
    if (clientesFiltrados.length === 1) {
      const c = clientesFiltrados[0];
      if (c.lat && c.lng) {
        map.setView([c.lat, c.lng], 16);
        marcadores[c.id]?.openPopup();
      }
      return;
    }
    if (clientesFiltrados.length > 0) return;

    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(busqueda)}, Buenos Aires, Argentina&format=json&limit=1&countrycodes=ar`,
        { headers: { 'User-Agent': 'BastidoresGal/1.0' } }
      );
      const data = await res.json();
      if (data.length) {
        map.setView([parseFloat(data[0].lat), parseFloat(data[0].lon)], 16);
      }
    } catch {}
  }

  function trazarRuta() {
    if (ordenRuta.length === 0) return;

    const idMap = new Map();
    for (const c of todosLosClientes) idMap.set(c.id, c);
    for (const c of clientesDelDia) idMap.set(c.id, c);

    const clientesRuta = ordenRuta
      .map(id => idMap.get(id))
      .filter(c => c && seleccionados.has(c.id));

    if (clientesRuta.length === 0) return;

    const origen = encodeURIComponent(`${origenDireccion}, Buenos Aires`);
    const [primero, ...resto] = clientesRuta;
    const destino = encodeURIComponent(`${primero.domicilio}, Buenos Aires`);
    const waypoints = resto
      .map(c => encodeURIComponent(`${c.domicilio}, Buenos Aires`))
      .join('|');

    const url = waypoints
      ? `https://www.google.com/maps/dir/?api=1&origin=${origen}&destination=${destino}&waypoints=${waypoints}&travelmode=driving`
      : `https://www.google.com/maps/dir/?api=1&origin=${origen}&destination=${destino}&travelmode=driving`;

    shellOpen(url);
  }

  function empezarEdicionOrden(clienteId) {
    editandoOrdenId = clienteId;
    const idx = ordenRuta.indexOf(clienteId);
    ordenInputValue = String(idx + 1);
  }

  function confirmarOrden(clienteId) {
    if (editandoOrdenId !== clienteId) return;
    const num = parseInt(ordenInputValue, 10);
    if (isNaN(num) || num < 1) {
      editandoOrdenId = null;
      return;
    }
    const fromIdx = ordenRuta.indexOf(clienteId);
    if (fromIdx === -1) { editandoOrdenId = null; return; }

    let toIdx = Math.max(0, Math.min(ordenRuta.length - 1, num - 1));
    if (fromIdx === toIdx) { editandoOrdenId = null; return; }

    const newOrder = [...ordenRuta];
    newOrder.splice(fromIdx, 1);
    const adjToIdx = toIdx > fromIdx ? toIdx - 1 : toIdx;
    newOrder.splice(adjToIdx, 0, clienteId);
    ordenRuta = newOrder;
    editandoOrdenId = null;
    renderizarMarcadores();
  }

  function handleOrdenKeydown(e, clienteId) {
    if (e.key === 'Enter') {
      e.target?.blur();
    } else if (e.key === 'Escape') {
      editandoOrdenId = null;
    }
  }

  function centrarEnCliente(id) {
    const c = todosLosClientes.find(c => c.id === id) ?? clientesDelDia.find(c => c.id === id);
    if (c && c.lat && c.lng) {
      map.setView([c.lat, c.lng], 16);
      marcadores[id]?.openPopup();
    }
  }

  function centrarMapa() {
    map?.setView([-34.6037, -58.3816], 13);
  }

  function onRecomendacionSeleccionar(ids) {
    seleccionados = new Set(ids);
    ordenRuta = ids;
    renderizarMarcadores();
    setTimeout(() => trazarRuta(), 300);
  }

  onMount(() => {
    mapaStore.geocodificarOrigen = geocodificarOrigen;
    mapaStore.guardarOrigen = guardarOrigen;
    initMapa();
  });

  onDestroy(() => {
    map?.remove();
  });
</script>

<div class="mapa-wrapper">
    <aside class="panel">
      <h2 class="panel-titulo">Entregas del día</h2>

      {#if cargando}
        <p class="info-text">Cargando...</p>
      {:else if clientesPanel.length === 0}
        <p class="info-text">Sin resultados.</p>
      {:else}
        {#if clientesDelDia.length > 0}
          <p class="info-text">{entregasFiltradas.length} de {clientesDelDia.length} entrega{clientesDelDia.length > 1 ? 's' : ''} para hoy &middot; Click en el n&uacute;mero para cambiar orden</p>
        {/if}
        {#if clientesPanel.some(c => c.tipo_marcador === 'pendiente')}
          <p class="info-text pendientes-info">{clientesPanel.filter(c => c.tipo_marcador === 'pendiente').length} cliente{clientesPanel.filter(c => c.tipo_marcador === 'pendiente').length > 1 ? 's' : ''} con pedidos pendientes</p>
        {/if}

        <ul class="lista-clientes">
          {#each clientesPanel as cliente}
            <li
              class="cliente-item"
              class:seleccionado={seleccionados.has(cliente.id)}
              onclick={cliente.tipo_marcador === 'hoy' ? () => toggleSeleccion(cliente.id) : () => centrarEnCliente(cliente.id)}
              oncontextmenu={(e) => mostrarMenuContextual(e, cliente.id)}
            >
              <span class="cliente-dot" style="background:{!cliente.lat || !cliente.lng ? '#ef4444' : (seleccionados.has(cliente.id) ? '#f59e0b' : (cliente.tipo_marcador === 'hoy' ? '#ef4444' : (cliente.tipo_marcador === 'normal' ? '#3b82f6' : '#22c55e')))}" title={!cliente.lat || !cliente.lng ? 'Sin geocodificar' : ''}></span>
              {#if seleccionados.has(cliente.id)}
                {#if editandoOrdenId === cliente.id}
                  <input
                    type="number"
                    class="orden-input"
                    bind:value={ordenInputValue}
                    onkeydown={(e) => handleOrdenKeydown(e, cliente.id)}
                    onblur={() => confirmarOrden(cliente.id)}
                    autofocus
                    min="1"
                    max={ordenRuta.length}
                  />
                {:else}
                  <span
                    class="orden-badge"
                    onclick={(e) => { e.stopPropagation(); empezarEdicionOrden(cliente.id); }}
                    role="button"
                    tabindex="0"
                    onkeydown={(e) => e.key === 'Enter' && empezarEdicionOrden(cliente.id)}
                  >{ordenRuta.indexOf(cliente.id) + 1}</span>
                {/if}
              {/if}
              <div>
                <div class="cliente-nombre">{cliente.nombre}</div>
                <div class="cliente-dir">{cliente.domicilio ?? ''}</div>
              </div>
            </li>
          {/each}
        </ul>

        <div class="btn-group">
          <button
            class="btn-ruta flex-1"
            disabled={clientesSeleccionados.length === 0}
            onclick={trazarRuta}
          >
            Trazar ruta ({clientesSeleccionados.length})
          </button>
          {#if clientesPanel.length > 0}
            <button
              class="btn-recomendar"
              onclick={() => showRecomendarModal = true}
            >
              🗺
            </button>
          {/if}
        </div>
      {/if}

      {#if error}
        <p class="error-text">{error}</p>
      {/if}

      <button class="btn-centrar" onclick={centrarMapa}>Centrar en CABA</button>
    </aside>

    <div class="mapa-container" bind:this={mapContainer} onclick={() => { cerrarMenuContextual(); cerrarEdicion(); }}></div>
</div>

{#if menuContextual}
  <div
    class="context-menu"
    style="left:{menuContextual.x}px;top:{menuContextual.y}px;"
    onclick={(e) => e.stopPropagation()}
    role="menu"
  >
    {#if seleccionados.has(menuContextual.id)}
      <button class="context-item" onclick={() => { quitarDeRuta(menuContextual.id); }}>
        ❌ Quitar de ruta
      </button>
      <button class="context-item" onclick={() => { menuContextual = null; empezarEdicionOrden(menuContextual.id); }}>
        🔢 Asignar orden
      </button>
    {:else}
      <button class="context-item" onclick={() => agregarARuta(menuContextual.id)}>
        ➕ Agregar a ruta
      </button>
    {/if}
  </div>
  <div class="context-overlay" onclick={cerrarMenuContextual} oncontextmenu={(e) => { e.preventDefault(); cerrarMenuContextual(); }}></div>
{/if}

<RecomendacionRutasModal
  show={showRecomendarModal}
  clientes={todosLosClientes}
  onclose={() => showRecomendarModal = false}
  onseleccionar={onRecomendacionSeleccionar}
/>

<style>
  :global(.pin-pendiente) { background: transparent !important; border: none !important; }
  :global(.pin-dot) {
    border: 2.5px solid white;
    border-radius: 50%;
    box-shadow: 0 0 0 3px rgba(239,68,68,0.3);
    animation: pulso-mapa-global 1.5s infinite;
  }
  :global(.pin-dot[data-seleccionado="true"]) {
    box-shadow: 0 0 0 3px rgba(245,158,11,0.35);
  }

  .mapa-wrapper {
    display: flex;
    height: 100%;
    width: 100%;
    font-family: var(--font);
  }

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

  .pendientes-info {
    color: #22c55e;
    font-weight: 500;
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

  .cliente-item:hover { background: #f9fafb; }

  .cliente-item.seleccionado {
    background: #fffbeb;
    border-color: #f59e0b;
  }

  .orden-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    min-width: 20px;
    border-radius: 50%;
    background: #2563eb;
    color: white;
    font-size: 11px;
    font-weight: 700;
    border: 2px solid white;
    box-shadow: 0 1px 3px rgba(0,0,0,0.25);
    margin-top: 2px;
    cursor: pointer;
    transition: transform 0.1s;
  }

  .orden-badge:hover {
    transform: scale(1.15);
  }

  .orden-input {
    width: 36px;
    height: 22px;
    border: 1.5px solid #2563eb;
    border-radius: 6px;
    text-align: center;
    font-size: 12px;
    font-weight: 700;
    color: #1e40af;
    background: #eff6ff;
    outline: none;
    padding: 0;
    margin-top: 2px;
    -moz-appearance: textfield;
  }

  .orden-input::-webkit-inner-spin-button,
  .orden-input::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
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

  .btn-ruta:hover:not(:disabled) { background: #1d4ed8; }
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

  .btn-centrar:hover { background: #f3f4f6; }

  .btn-group {
    display: flex;
    gap: 6px;
    width: 100%;
  }

  .flex-1 {
    flex: 1;
    min-width: 0;
  }

  .btn-recomendar {
    padding: 10px;
    background: #059669;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;
  }
  .btn-recomendar:hover:not(:disabled) { background: #047857; }
  .btn-recomendar:disabled {
    background: #a7f3d0;
    cursor: not-allowed;
  }

  .error-text {
    font-size: 12px;
    color: #ef4444;
    margin: 0;
  }

  .mapa-container {
    flex: 1;
    z-index: 1;
  }

  @media (max-width: 640px) {
    .mapa-wrapper { flex-direction: column; }
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

  .context-overlay {
    position: fixed;
    inset: 0;
    z-index: 9998;
    background: transparent;
  }
  .context-menu {
    position: fixed;
    z-index: 9999;
    background: #fff;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    min-width: 160px;
    padding: 4px;
    display: flex;
    flex-direction: column;
  }
  .context-item {
    display: block;
    width: 100%;
    padding: 8px 12px;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 13px;
    text-align: left;
    border-radius: 6px;
    font-family: var(--font);
  }
  .context-item:hover {
    background: #f3f4f6;
  }
</style>
