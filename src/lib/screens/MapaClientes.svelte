<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api } from '$lib/api/client';
  import { open as shellOpen } from '@tauri-apps/plugin-shell';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { mapaStore } from '$lib/stores/mapaStore.svelte';
  import RecomendacionRutasModal from '$lib/components/RecomendacionRutasModal.svelte';
  import { nominatimSearchUrl } from '$lib/utils/geocoding';

  const KANBAN_COLORS: Record<string, string> = {
    PEDIDO: '#ef4444',
    EN_PROCESO: '#3b82f6',
    LISTO: '#22c55e',
    ENTREGADO: '#6b7280',
    ARCHIVADO: '#6b7280',
  };
  const KANBAN_LABELS: Record<string, string> = {
    PEDIDO: 'Pedido',
    EN_PROCESO: 'En Proceso',
    LISTO: 'Listo',
    ENTREGADO: 'Entregado',
    ARCHIVADO: 'Archivado',
  };
  function kanbanColor(estado: string) { return KANBAN_COLORS[estado] || '#6b7280'; }
  function kanbanText(estado: string) { return KANBAN_LABELS[estado] || estado; }

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
  let marcadorBusqueda = null;
  let rutaLinea = null;
  let routingControl = null;
  let infoRuta = $state('');
  let calculandoRuta = $state(false);

  let origenDireccion = $state(mapaStore.origenDireccion);
  let origenCoords = $state(mapaStore.origenCoords);
  let editandoOrigen = $state(mapaStore.editandoOrigen);
  let geocodificandoOrigen = $state(mapaStore.geocodificandoOrigen);
  let menuContextual = $state(null);
  let showRecomendarModal = $state(false);
  let showEditClienteModal = $state(false);
  let editClienteData = $state(null);
  let editClienteForm = $state({ nombre: '', domicilio: '', telefono: '', taller: '', estudiante: '' });
  let geocodificandoClienteId = $state(null);
  let filtroKanban = $state('TODOS');

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
    let base = todosLosClientes;
    if (mapaStore.filtroPendientes) {
      const idsHoy = new Set(clientesDelDia.map(c => c.id));
      base = base.filter(c => c.pedidos_pendientes > 0 || idsHoy.has(c.id));
    }
    if (!busqueda.trim()) return base;
    const q = busqueda.toLowerCase();
    return base.filter(c =>
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
      .map(c => {
        const tc = todosLosClientes.find(t => t.id === c.id);
        return { ...c, tipo_marcador: 'hoy', facturas_estados: tc?.facturas_estados };
      });

    const pendientes = todosLosClientes
      .filter(c =>
        c.pedidos_pendientes > 0 &&
        !idsHoy.has(c.id) &&
        (!q || c.nombre.toLowerCase().includes(q) || (c.domicilio && c.domicilio.toLowerCase().includes(q)))
      )
      .map(c => ({ ...c, tipo_marcador: 'pendiente', facturas_estados: c.facturas_estados }));

    const idsEnPanel = new Set([...hoy, ...pendientes].map(c => c.id));
    const agregadosRuta = todosLosClientes
      .filter(c =>
        seleccionados.has(c.id) &&
        !idsEnPanel.has(c.id) &&
        (!q || c.nombre.toLowerCase().includes(q) || (c.domicilio && c.domicilio.toLowerCase().includes(q)))
      )
      .map(c => ({ ...c, tipo_marcador: 'ruta', facturas_estados: c.facturas_estados }));

    let resultado = [...hoy, ...pendientes, ...agregadosRuta];

    if (filtroKanban !== 'TODOS') {
      resultado = resultado.filter(c =>
        c.facturas_estados && (c.facturas_estados[filtroKanban] ?? 0) > 0
      );
    }

    return resultado;
  });

  let totalPendientes = $derived.by(() =>
    clientesPanel.filter(c => c.tipo_marcador === 'pendiente')
      .reduce((s, c) => s + (c.pedidos_pendientes || 0), 0)
  );

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
    const _ = mapaStore.filtroPendientes;
    if (map) renderizarMarcadores();
  });

  $effect(() => {
    const coords = mapaStore.busquedaCoords;
    renderizarMarcadorBusqueda();
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

  function crearIconoBusqueda() {
    return L.divIcon({
      className: '',
      html: `<div style="width:28px;height:28px;background:#0ea5e9;border:3px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;box-shadow:0 0 0 4px rgba(14,165,233,0.3), 0 2px 8px rgba(0,0,0,0.4);animation:pulso-mapa-global 1.5s infinite;">📍</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
  }

  function renderizarMarcadorBusqueda() {
    if (marcadorBusqueda) {
      map?.removeLayer(marcadorBusqueda);
      marcadorBusqueda = null;
    }
    const coords = mapaStore.busquedaCoords;
    if (!map || !L || !coords) return;
    marcadorBusqueda = L.marker([coords.lat, coords.lng], { icon: crearIconoBusqueda() })
      .addTo(map)
      .bindPopup(`<div style="font-family:sans-serif;font-size:13px;"><strong>${mapaStore.busqueda}</strong></div>`)
      .openPopup();
    map.setView([coords.lat, coords.lng], 16);
  }

  async function initMapa() {
    L = await import('leaflet');
    (window as any).L = L;
    await import('leaflet-routing-machine');

    map = L.map(mapContainer).setView([-34.6037, -58.3816], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    map.on('popupopen', (e) => {
      const popupEl = e.popup.getElement();
      if (!popupEl) return;
      const btn = popupEl.querySelector('[data-action="geocodificar"]');
      if (btn) {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const id = parseInt((ev.currentTarget as HTMLElement).dataset.id || '');
          if (id) geocodificarClienteEnMapa(id);
        });
      }
    });

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
      const url = nominatimSearchUrl(origenDireccion);
      const res = await fetch(url, { headers: { 'User-Agent': 'BastidoresGal/1.0' } });
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
    const items: string[] = [];
    items.push(`<strong>${cliente.nombre}</strong>`);
    items.push(`<span style="color:var(--text-secondary);">${cliente.domicilio ?? ''}</span>`);
    if (cliente.telefono) items.push(`&#128222; ${cliente.telefono}`);
    items.push(`<hr style="margin:6px 0;border-color:#eee;">`);

    if (tipo === 'hoy') {
      const facturasDelDia = clientesDelDia.find(c => c.id === cliente.id)?.facturas ?? [];
      items.push(`<span style="color:#f59e0b;font-weight:600;">&#128230; Entrega hoy</span>`);
      for (const f of facturasDelDia) {
        items.push(
          `<span style="display:inline-flex;align-items:center;gap:4px;margin:2px 0;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${kanbanColor(f.estado_kanban)};flex-shrink:0;"></span>
            <small>Factura ${f.numero_factura} &mdash; $${f.total.toLocaleString('es-AR')} &middot; <b>${kanbanText(f.estado_kanban)}</b></small>
          </span>`
        );
      }
    } else if (tipo === 'pendiente') {
      items.push(`<span style="color:#22c55e;font-weight:600;">&#128230; ${cliente.pedidos_pendientes} pedido${cliente.pedidos_pendientes > 1 ? 's' : ''} pendiente${cliente.pedidos_pendientes > 1 ? 's' : ''}</span>`);
    }

    items.push(`<hr style="margin:6px 0;border-color:#eee;">`);
    items.push(`<button data-action="geocodificar" data-id="${cliente.id}" style="background:transparent;border:1px solid #d1d5db;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;font-family:var(--font, sans-serif);color:#374151;width:100%;">📍 Geocodificar</button>`);

    return `<div style="font-family:sans-serif;font-size:13px;min-width:180px;display:flex;flex-direction:column;gap:2px;">${items.join('')}</div>`;
  }

  function kanbanLabel(estado: string) {
    return `<span style="color:${kanbanColor(estado)};font-weight:600;">${kanbanText(estado)}</span>`;
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
      const url = nominatimSearchUrl(busqueda);
      const res = await fetch(url, { headers: { 'User-Agent': 'BastidoresGal/1.0' } });
      const data = await res.json();
      if (data.length) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        mapaStore.busquedaCoords = { lat, lng };
      }
    } catch {}
  }

  function decodePolyline(encoded: string) {
    const coords: [number, number][] = [];
    let index = 0, lat = 0, lng = 0;
    while (index < encoded.length) {
      let shift = 0, result = 0, byte;
      do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 31) << shift; shift += 5; } while (byte >= 32);
      const dLat = (result & 1) ? ~(result >> 1) : (result >> 1);
      lat += dLat;
      shift = 0; result = 0;
      do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 31) << shift; shift += 5; } while (byte >= 32);
      const dLng = (result & 1) ? ~(result >> 1) : (result >> 1);
      lng += dLng;
      coords.push([lat * 1e-5, lng * 1e-5]);
    }
    return coords;
  }

  async function trazarRuta() {
    if (ordenRuta.length === 0) return;

    const idMap = new Map();
    for (const c of todosLosClientes) idMap.set(c.id, c);
    for (const c of clientesDelDia) idMap.set(c.id, c);

    const clientesRuta = ordenRuta
      .map(id => idMap.get(id))
      .filter(c => c && seleccionados.has(c.id) && c.lat && c.lng);

    if (clientesRuta.length === 0) return;

    limpiarRuta();

    const waypoints: any[] = [];
    if (origenCoords) {
      waypoints.push(L.latLng(origenCoords.lat, origenCoords.lng));
    }
    for (const c of clientesRuta) {
      waypoints.push(L.latLng(c.lat, c.lng));
    }

    if (waypoints.length < 2) {
      infoRuta = 'Se necesita al menos un origen y un destino.';
      return;
    }

    calculandoRuta = true;
    infoRuta = 'Calculando...';

    routingControl = L.Routing.control({
      waypoints,
      router: L.Routing.osrmv1({
        serviceUrl: 'https://router.project-osrm.org/route/v1',
        profile: 'driving'
      }),
      routeWhileDragging: false,
      showAlternatives: false,
      addWaypoints: false,
      fitSelectedRoutes: true,
      lineOptions: {
        styles: [{ color: '#2563eb', weight: 5, opacity: 0.8 }],
        extendToWaypoints: true,
        missingRouteTolerance: 0
      },
      createMarker: () => null,
      collapsible: true,
      show: true
    }).addTo(map);

    routingControl.on('routesfound', (e) => {
      calculandoRuta = false;
      const route = e.routes[0];
      if (route) {
        const distKm = (route.summary.totalDistance / 1000).toFixed(1);
        const mins = Math.round(route.summary.totalTime / 60);
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        infoRuta = h > 0 ? `${distKm} km \xB7 ${h}h ${m}m` : `${distKm} km \xB7 ${m} min`;
      }
    });

    routingControl.on('routingerror', () => {
      calculandoRuta = false;
      infoRuta = 'Error al calcular ruta';
    });
  }

  function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    const R = 6371;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const sinDLat = Math.sin(dLat / 2);
    const sinDLng = Math.sin(dLng / 2);
    const h = sinDLat * sinDLat + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinDLng * sinDLng;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  async function optimizarRuta() {
    if (ordenRuta.length < 2) return;

    const idMap = new Map();
    for (const c of todosLosClientes) idMap.set(c.id, c);
    for (const c of clientesDelDia) idMap.set(c.id, c);

    const clientes = ordenRuta
      .map(id => idMap.get(id))
      .filter(c => c && seleccionados.has(c.id) && c.lat && c.lng);

    if (clientes.length < 2) return;

    const origin = origenCoords ? { lat: origenCoords.lat, lng: origenCoords.lng } : clientes.shift();
    if (!origin) return;

    const noVisitados = [...clientes];
    const ordenados = [origin];

    while (noVisitados.length > 0) {
      const ultimo = ordenados[ordenados.length - 1];
      let menorDist = Infinity;
      let idx = -1;
      for (let i = 0; i < noVisitados.length; i++) {
        const d = haversine(ultimo, noVisitados[i]);
        if (d < menorDist) { menorDist = d; idx = i; }
      }
      ordenados.push(noVisitados.splice(idx, 1)[0]);
    }

    const newOrder = ordenados.map(c => c.id);
    if (origenCoords) newOrder.shift();
    ordenRuta = newOrder;
    renderizarMarcadores();
    renderizarRutaOptimizada();
  }

  async function renderizarRutaOptimizada() {
    const idMap = new Map();
    for (const c of todosLosClientes) idMap.set(c.id, c);
    for (const c of clientesDelDia) idMap.set(c.id, c);

    const clientesRuta = ordenRuta
      .map(id => idMap.get(id))
      .filter(c => c && seleccionados.has(c.id) && c.lat && c.lng);

    if (clientesRuta.length < 2) return;

    limpiarRuta();

    const ghApiKey = 'ca6b67a0-aa56-48ec-83d0-474b861f3259';
    const points: string[] = [];

    if (origenCoords) {
      points.push(`point=${origenCoords.lat},${origenCoords.lng}`);
    }
    for (const c of clientesRuta) {
      points.push(`point=${c.lat},${c.lng}`);
    }

    if (points.length < 2) {
      infoRuta = 'Se necesita al menos un origen y un destino.';
      return;
    }

    calculandoRuta = true;
    infoRuta = 'Calculando...';

    try {
      const url = `https://graphhopper.com/api/1/route?${points.join('&')}&vehicle=car&key=${ghApiKey}&instructions=false&points_encoded=true`;
      const res = await fetch(url);

      if (!res.ok) {
        const errText = await res.text();
        console.error('GraphHopper error', res.status, errText);
        infoRuta = 'Error al calcular ruta';
        calculandoRuta = false;
        return;
      }

      const data = await res.json();

      if (!data.paths || !data.paths[0]) {
        infoRuta = 'Error al calcular ruta';
        calculandoRuta = false;
        return;
      }

      const route = data.paths[0];
      const latlngs = decodePolyline(route.points);
      const ll = latlngs.map(([lat, lng]) => L.latLng(lat, lng));

      rutaLinea = L.polyline(ll, { color: '#8b5cf6', weight: 5, opacity: 0.8 }).addTo(map);
      map.fitBounds(rutaLinea.getBounds().pad(0.1));

      const distKm = (route.distance / 1000).toFixed(1);
      const mins = Math.round(route.time / 60000);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      infoRuta = h > 0 ? `${distKm} km \xB7 ${h}h ${m}m` : `${distKm} km \xB7 ${m} min`;
    } catch {
      infoRuta = 'Error al calcular ruta';
    }
    calculandoRuta = false;
  }

  function limpiarRuta() {
    if (routingControl) {
      map?.removeControl(routingControl);
      routingControl = null;
    }
    if (rutaLinea) {
      map?.removeLayer(rutaLinea);
      rutaLinea = null;
    }
    infoRuta = '';
    calculandoRuta = false;
  }

  function abrirEnGoogleMaps() {
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

  export function copiarRutaAlPortapapeles() {
    if (ordenRuta.length === 0 || (!routingControl && !rutaLinea)) {
      appStore.alert('Primero trazá una ruta');
      return;
    }

    const idMap = new Map();
    for (const c of todosLosClientes) idMap.set(c.id, c);
    for (const c of clientesDelDia) idMap.set(c.id, c);

    const clientesRuta = ordenRuta
      .map(id => idMap.get(id))
      .filter(c => c && seleccionados.has(c.id));

    if (clientesRuta.length === 0) { appStore.alert('Primero trazá una ruta'); return; }

    const origen = encodeURIComponent(`${origenDireccion}, Buenos Aires`);
    const [primero, ...resto] = clientesRuta;
    const destino = encodeURIComponent(`${primero.domicilio}, Buenos Aires`);
    const waypoints = resto
      .map(c => encodeURIComponent(`${c.domicilio}, Buenos Aires`))
      .join('|');

    const url = waypoints
      ? `https://www.google.com/maps/dir/?api=1&origin=${origen}&destination=${destino}&waypoints=${waypoints}&travelmode=driving`
      : `https://www.google.com/maps/dir/?api=1&origin=${origen}&destination=${destino}&travelmode=driving`;

    navigator.clipboard.writeText(url);
    appStore.showToast('Link de la ruta copiado al portapapeles', 'success');
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

  async function geocodificarClienteEnMapa(clienteId: number) {
    geocodificandoClienteId = clienteId;
    try {
      const res = await api.geocodificarCliente(clienteId);
      if (res?.lat && res?.lng) {
        const c = todosLosClientes.find(c => c.id === clienteId);
        if (c) { c.lat = res.lat; c.lng = res.lng; }
        const cd = clientesDelDia.find(c => c.id === clienteId);
        if (cd) { cd.lat = res.lat; cd.lng = res.lng; }
        renderizarMarcadores();
      }
    } catch {}
    finally { geocodificandoClienteId = null; }
  }

  function openEditClienteModal(clienteId: number) {
    const c = todosLosClientes.find(cc => cc.id === clienteId) ?? clientesDelDia.find(cc => cc.id === clienteId);
    if (!c) return;
    editClienteData = c;
    editClienteForm = {
      nombre: c.nombre || '',
      domicilio: c.domicilio || '',
      telefono: c.telefono || '',
      taller: c.taller || '',
      estudiante: c.estudiante || '',
    };
    showEditClienteModal = true;
    menuContextual = null;
  }

  async function saveEditCliente() {
    if (!editClienteData) return;
    if (!editClienteForm.nombre.trim()) return;
    try {
      await api.updateCliente(editClienteData.id, editClienteForm);
      const c = todosLosClientes.find(cc => cc.id === editClienteData.id);
      if (c) Object.assign(c, editClienteForm);
      const cd = clientesDelDia.find(cc => cc.id === editClienteData.id);
      if (cd) Object.assign(cd, editClienteForm);
      showEditClienteModal = false;
      editClienteData = null;
      renderizarMarcadores();
    } catch {}
  }

  function closeEditClienteModal() {
    showEditClienteModal = false;
    editClienteData = null;
  }

  async function geocodificarClienteModal() {
    if (!editClienteData || !editClienteForm.domicilio.trim()) return;
    geocodificandoClienteId = editClienteData.id;
    try {
      const res = await api.geocodificarCliente(editClienteData.id);
      if (res?.lat && res?.lng) {
        const c = todosLosClientes.find(cc => cc.id === editClienteData.id);
        if (c) { c.lat = res.lat; c.lng = res.lng; }
        const cd = clientesDelDia.find(cc => cc.id === editClienteData.id);
        if (cd) { cd.lat = res.lat; cd.lng = res.lng; }
      }
    } catch {}
    finally { geocodificandoClienteId = null; }
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
    limpiarRuta();
    map?.remove();
  });
</script>

<div class="mapa-wrapper">
    <aside class="panel">
      <div class="kanban-filtro">
        <button class="kf-btn" class:kf-activo={filtroKanban === 'TODOS'} onclick={() => filtroKanban = 'TODOS'}>Todos</button>
        <button class="kf-btn" class:kf-activo={filtroKanban === 'PEDIDO'} onclick={() => filtroKanban = 'PEDIDO'}>Pedido</button>
        <button class="kf-btn" class:kf-activo={filtroKanban === 'EN_PROCESO'} onclick={() => filtroKanban = 'EN_PROCESO'}>En Proceso</button>
        <button class="kf-btn" class:kf-activo={filtroKanban === 'LISTO'} onclick={() => filtroKanban = 'LISTO'}>Listo</button>
      </div>

      {#if cargando}
        <p class="info-text">Cargando...</p>
      {:else if clientesPanel.length === 0}
        <p class="info-text">Sin resultados.</p>
      {:else}
        {#if clientesDelDia.length > 0}
          <p class="info-text">{entregasFiltradas.length} de {clientesDelDia.length} entrega{clientesDelDia.length > 1 ? 's' : ''} para hoy &middot; Click en el n&uacute;mero para cambiar orden</p>
        {/if}
        {#if clientesPanel.some(c => c.tipo_marcador === 'pendiente')}
          <p class="info-text pendientes-info">{clientesPanel.filter(c => c.tipo_marcador === 'pendiente').length} cliente{clientesPanel.filter(c => c.tipo_marcador === 'pendiente').length > 1 ? 's' : ''} · {totalPendientes} pedido{totalPendientes !== 1 ? 's' : ''} pendiente{totalPendientes !== 1 ? 's' : ''}</p>
        {/if}

        <ul class="lista-clientes">
          {#each clientesPanel as cliente}
            <li
              class="cliente-item"
              class:seleccionado={seleccionados.has(cliente.id)}
              onclick={cliente.tipo_marcador === 'hoy' ? () => toggleSeleccion(cliente.id) : () => centrarEnCliente(cliente.id)}
              oncontextmenu={(e) => mostrarMenuContextual(e, cliente.id)}
            >
              <span
                class="cliente-geo"
                class:geo-ok={cliente.lat && cliente.lng}
                class:geo-bad={!cliente.lat || !cliente.lng}
                title={!cliente.lat || !cliente.lng ? 'Sin geocodificar' : 'Geocodificado'}
              >{cliente.lat && cliente.lng ? '✓' : '✗'}</span>
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
              <div class="cliente-info">
                <div class="cliente-nombre">{cliente.nombre}</div>
                <div class="cliente-dir">{cliente.domicilio ?? ''}</div>
                {#if cliente.facturas_estados}
                  <div class="factura-badges">
                    {#each Object.entries(cliente.facturas_estados) as [estado, count]}
                      {#if (estado === 'PEDIDO' || estado === 'EN_PROCESO' || estado === 'LISTO') && count > 0}
                        <span class="kanban-badge" style="background:{kanbanColor(estado)}">{kanbanText(estado)}{count > 1 ? ` ${count}` : ''}</span>
                      {/if}
                    {/each}
                  </div>
                {/if}
              </div>
            </li>
          {/each}
        </ul>

        <div class="btn-group">
          <button
            class="btn-ruta flex-1"
            disabled={clientesSeleccionados.length === 0 || calculandoRuta}
            onclick={trazarRuta}
          >
            {calculandoRuta ? '⏳ Calculando...' : `🗺️ Ruta (${clientesSeleccionados.length})`}
          </button>
          <button
            class="btn-optimizar"
            disabled={clientesSeleccionados.length < 2 || calculandoRuta}
            onclick={optimizarRuta}
          >
            ✨ Optimizar
          </button>
          {#if routingControl || rutaLinea}
            <button class="btn-google" onclick={abrirEnGoogleMaps} title="Abrir en Google Maps">🗺️</button>
            <button class="btn-copy-link" onclick={copiarRutaAlPortapapeles} title="Copiar link de la ruta">📋</button>
            <button class="btn-clear-ruta" onclick={limpiarRuta} title="Limpiar ruta">✕</button>
          {/if}
        </div>
        {#if infoRuta}
          <div class="ruta-info">{infoRuta}</div>
        {/if}
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
      <button class="context-item" onclick={() => { const id = menuContextual.id; menuContextual = null; empezarEdicionOrden(id); }}>
        🔢 Asignar orden
      </button>
    {:else}
      <button class="context-item" onclick={() => agregarARuta(menuContextual.id)}>
        ➕ Agregar a ruta
      </button>
    {/if}
    <hr class="context-menu-sep">
    <button class="context-item" onclick={() => { const id = menuContextual.id; menuContextual = null; openEditClienteModal(id); }}>
      ✏️ Editar cliente
    </button>
    <button class="context-item" onclick={() => { const id = menuContextual.id; menuContextual = null; geocodificarClienteEnMapa(id); }}>
      📍 Geocodificar
    </button>
  </div>
  <div class="context-overlay" onclick={cerrarMenuContextual} oncontextmenu={(e) => { e.preventDefault(); cerrarMenuContextual(); }}></div>
{/if}

<RecomendacionRutasModal
  show={showRecomendarModal}
  clientes={todosLosClientes}
  onclose={() => showRecomendarModal = false}
  onseleccionar={onRecomendacionSeleccionar}
/>

{#if showEditClienteModal && editClienteData}
  <div class="overlay" onclick={closeEditClienteModal}>
    <div class="modal" onclick={(e) => e.stopPropagation()}>
      <h3>Editar Cliente</h3>
      <form onsubmit={(e) => { e.preventDefault(); saveEditCliente(); }}>
        <label>Nombre *</label>
        <input type="text" bind:value={editClienteForm.nombre} required />
        <label>Teléfono</label>
        <input type="text" bind:value={editClienteForm.telefono} />
        <label>Domicilio</label>
        <input type="text" bind:value={editClienteForm.domicilio} />
        <label>Taller</label>
        <input type="text" bind:value={editClienteForm.taller} />
        <label>Estudiante / Galería</label>
        <input type="text" bind:value={editClienteForm.estudiante} />
        <div class="modal-actions">
          {#if editClienteForm.domicilio}
            <button
              type="button"
              class="btn-geo-modal"
              onclick={geocodificarClienteModal}
              disabled={geocodificandoClienteId === editClienteData.id}
            >
              {geocodificandoClienteId === editClienteData.id ? '⏳ Geocodificando...' : '📍 Geocodificar ubicación'}
            </button>
          {/if}
          <button type="submit" class="btn-primary">Guardar</button>
          <button type="button" class="btn-secondary" onclick={closeEditClienteModal}>Cancelar</button>
        </div>
      </form>
    </div>
  </div>
{/if}

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
    background: var(--bg-card);
    border-right: 1px solid var(--border);
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
    color: var(--text-primary);
  }
  .kanban-filtro {
    display: flex;
    gap: 2px;
    background: var(--bg-page);
    border-radius: 6px;
    padding: 2px;
  }
  .kf-btn {
    flex: 1;
    padding: 3px 6px;
    border: none;
    border-radius: 5px;
    background: transparent;
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    cursor: pointer;
    font-family: var(--font);
    transition: all 0.12s;
  }
  .kf-btn:hover { color: #111; }
  .kf-activo {
    background: var(--bg-card);
    color: var(--text-primary);
    font-weight: 600;
    box-shadow: 0 1px 2px rgba(0,0,0,0.08);
  }

  .pendientes-info {
    color: #22c55e;
    font-weight: 500;
  }

  .info-text {
    font-size: 13px;
    color: var(--text-secondary);
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

  .cliente-geo {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 700;
    flex-shrink: 0;
    margin-top: 3px;
    line-height: 1;
  }
  .geo-ok { background: #e8f5e9; color: #2e7d32; }
  .geo-bad { background: #fbe9e7; color: #c62828; }

  .cliente-nombre {
    font-size: 13px;
    font-weight: 500;
    color: #111;
  }

  .cliente-dir {
    font-size: 11px;
    color: #9ca3af;
  }

  .cliente-info {
    min-width: 0;
    flex: 1;
  }

  .factura-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    margin-top: 4px;
  }
  .kanban-badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    color: #fff;
    line-height: 1.5;
  }

  .overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.4);
    display: flex; align-items: center; justify-content: center; z-index: 1000;
  }
  .modal {
    background: var(--bg-card); border-radius: 0.857rem; padding: 1.714rem; width: 28.571rem;
    box-shadow: 0 0.571rem 2.286rem rgba(0,0,0,0.2); max-width: 90vw;
  }
  .modal h3 { margin: 0 0 1.143rem; color: var(--text-primary); font-size: 1.1rem; }
  .modal label { display: block; font-size: 0.929rem; color: var(--text-secondary); margin: 0.571rem 0 0.286rem; }
  .modal input {
    width: 100%; padding: 0.571rem 0.714rem; border: 1px solid var(--border); border-radius: 0.429rem;
    font-size: 0.929rem; box-sizing: border-box;
  }
  .modal-actions { display: flex; gap: 0.571rem; justify-content: flex-end; margin-top: 1.143rem; }
  .btn-geo-modal {
    padding: 0.571rem 1rem; background: #10b981; color: white; border: none;
    border-radius: 0.429rem; cursor: pointer; font-size: 0.857rem; font-weight: 500;
    margin-right: auto;
  }
  .btn-geo-modal:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn-geo-modal:hover:not(:disabled) { background: #059669; }
  .btn-primary {
    padding: 0.571rem 1.286rem; background: var(--accent); color: white; border: none;
    border-radius: 0.429rem; cursor: pointer; font-size: 0.929rem; font-weight: 500;
  }
  .btn-secondary {
    padding: 0.571rem 1.286rem; background: var(--bg-hover); color: var(--text-secondary); border: none;
    border-radius: 0.429rem; cursor: pointer; font-size: 0.929rem;
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

  .btn-centrar:hover { background: var(--bg-hover); }

  .btn-group {
    display: flex;
    gap: 6px;
    width: 100%;
  }

  .flex-1 {
    flex: 1;
    min-width: 0;
  }

  .btn-optimizar {
    padding: 10px 12px;
    background: #8b5cf6;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;
  }
  .btn-optimizar:hover:not(:disabled) { background: #7c3aed; }
  .btn-optimizar:disabled {
    background: #c4b5fd;
    cursor: not-allowed;
  }

  .btn-google {
    padding: 10px 12px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    transition: background 0.15s;
  }
  .btn-google:hover { background: var(--bg-hover); }

  .btn-copy-link {
    padding: 10px 12px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    transition: background 0.15s;
  }
  .btn-copy-link:hover { background: var(--bg-hover); }



  .btn-clear-ruta {
    padding: 10px 12px;
    background: var(--bg-card);
    color: #ef4444;
    border: 1px solid #fecaca;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 600;
    transition: background 0.15s;
  }
  .btn-clear-ruta:hover { background: #fef2f2; }

  .ruta-info {
    font-size: 13px;
    color: #2563eb;
    font-weight: 600;
    text-align: center;
    padding: 4px 0;
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

  .context-menu-sep {
    border: none;
    border-top: 1px solid #e5e7eb;
    margin: 4px 0;
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
    background: var(--bg-card);
    border: 1px solid var(--border);
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
    background: var(--bg-hover);
  }
</style>
