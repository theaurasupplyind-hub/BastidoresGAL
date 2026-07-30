<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api } from '$lib/api/client';
  import { open as shellOpen } from '@tauri-apps/plugin-shell';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { mapaStore } from '$lib/stores/mapaStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import RecomendacionRutasModal from '$lib/components/RecomendacionRutasModal.svelte';
  import PanelProgramarViajes from '$lib/components/PanelProgramarViajes.svelte';
  import EditClienteModal from '$lib/components/EditClienteModal.svelte';
  import AddressAutocomplete from '$lib/components/AddressAutocomplete.svelte';
  import { nominatimSearchUrl, limpiarDireccion } from '$lib/utils/geocoding';
import { recomendarRutas } from '$lib/utils/barrios';
import { haversine, findCercanosRuta } from '$lib/utils/geo';

  const KANBAN_COLORS: Record<string, string> = {
    PEDIDO: '#ef4444',
    EN_PROCESO: '#3b82f6',
    LISTO: '#22c55e',
    EN_ESPERA: '#22c55e',
    ENTREGADO: '#6b7280',
    ARCHIVADO: '#6b7280',
    NO_CONFIRMADO: '#f59e0b',
  };
  const KANBAN_LABELS: Record<string, string> = {
    PEDIDO: 'Pedido',
    EN_PROCESO: 'En Proceso',
    LISTO: 'Listo',
    EN_ESPERA: 'Listo',
    ENTREGADO: 'Entregado',
    ARCHIVADO: 'Archivado',
    NO_CONFIRMADO: 'No Confirmado',
  };
  function kanbanColor(estado: string) { return KANBAN_COLORS[estado] || '#6b7280'; }
  function kanbanText(estado: string) { return KANBAN_LABELS[estado] || estado; }

  let mapContainer: any;
  let map: any;
  let L: any;

  let todosLosClientes: any[] = $state([]);
  let facturasDelDia: any[] = $state([]);
  let seleccionados = $state(new Set<number>());
  let ordenRuta: number[] = $state([]);
  let editandoOrdenId: number | null = $state(null);
  let ordenInputValue = $state('');

  let modoProgramar = $state(mapaStore.modoProgramar);
  let grupos = $state<Map<string, any>>(mapaStore.grupos);
  let grupoActivoId = $state<string | null>(mapaStore.grupoActivoId);
  let planViajeId = $state<string | null>(mapaStore.planViajeId);
  let guardandoPlan = $state(false);

  const CONSOLA_COLORS = ['#ef4444', '#8b5cf6', '#0ea5e9', '#f59e0b', '#10b981', '#ec4899'];
  let colorIdx = $state(0);

  let fecha = $state(mapaStore.fecha);
  let cargando = $state(false);
  let errorText = $state('');
  let busqueda = $state(mapaStore.busqueda);

  let marcadores: Record<string, any> = {};
  let marcadoresClientes: Record<string, any> = {};
  let marcadorOrigen: any = null;
  let marcadorBusqueda: any = null;
  let rutaLinea: any = null;
  let routingControl: any = null;
  let infoRuta = $state('');
  let calculandoRuta = $state(false);

  let origenDireccion = $state(mapaStore.origenDireccion);
  let origenCoords: { lat: number; lng: number } | null = $state(mapaStore.origenCoords);
  let editandoOrigen = $state(mapaStore.editandoOrigen);
  let geocodificandoOrigen = $state(mapaStore.geocodificandoOrigen);
  let menuContextual: { x: number; y: number; id: number } | null = $state(null);
  let showRecomendarModal = $state(false);
  let showGeoAlert = $state(false);
  let showGeoModal = $state(false);
  let volverAGeoTrasEditar = $state(false);
  let hayRutaActiva = $state(false);
  let rutaCercanos = $state<any[]>([]);
  let showEditClienteModal = $state(false);
  let editClienteData: any = $state(null);
  let geocodificandoFacturaId: number | null = $state(null);
  let filtroKanban: string[] = $state([]);

  let geocodificandoAuto = $state(false);
  let geocodificandoAutoTotal = $state(0);
  let geocodificandoAutoHecho = $state(0);

  function toggleFiltroKanban(estado: string) {
    if (filtroKanban.includes(estado)) {
      filtroKanban = filtroKanban.filter(e => e !== estado);
    } else if (filtroKanban.length < 2) {
      filtroKanban = [...filtroKanban, estado];
    }
  }

  let facturaMap = $derived.by(() => {
    const m = new Map<number, any>();
    for (const f of facturasDelDia) m.set(f.id, f);
    return m;
  });

  let clientesConEntregas = $derived.by(() => {
    const ids = new Set(facturasDelDia.map(f => f.cliente_id).filter(Boolean));
    return todosLosClientes.filter(c => ids.has(c.id)).map(c => {
      const facturasDelCliente = facturasDelDia.filter(f => f.cliente_id === c.id);
      const estados: Record<string, number> = {};
      for (const f of facturasDelCliente) {
        const estado = f.estado_kanban || 'PEDIDO';
        estados[estado] = (estados[estado] || 0) + 1;
      }
      return {
        ...c,
        facturas: facturasDelCliente.map(f => ({
          id: f.id,
          numero_factura: f.numero_factura,
          total: f.total,
          estado_kanban: f.estado_kanban,
          fecha: f.fecha,
          piso_depto: f.cliente_piso_depto || '',
        })),
        facturas_estados: estados,
      };
    });
  });

  let clientesIdsConFactura = $derived.by(() => {
    return new Set(facturasDelDia.map(f => f.cliente_id).filter(Boolean));
  });

  const facturasFiltradas = $derived.by(() => {
    let base = facturasDelDia;
    if (filtroKanban.length > 0) {
      base = base.filter(f =>
        filtroKanban.some(e => {
          if (f.estado_kanban === e) return true;
          if (e === 'LISTO' && f.estado_kanban === 'EN_ESPERA') return true;
          return false;
        })
      );
    }
    if (!busqueda.trim()) return base;
    const q = busqueda.toLowerCase();
    return base.filter(f =>
      f.cliente_nombre?.toLowerCase().includes(q) ||
      (f.cliente_domicilio && f.cliente_domicilio.toLowerCase().includes(q)) ||
      (f.numero_factura && f.numero_factura.toLowerCase().includes(q))
    );
  });

  function esRetira(f: any) {
    return f.cliente_domicilio?.trim().toLowerCase() === 'retira';
  }

  const facturasGeocodificadas = $derived(facturasFiltradas.filter(f => f.lat && f.lng && !esRetira(f)));
  const facturasSinGeocodificar = $derived(facturasFiltradas.filter(f => !esRetira(f) && (!f.lat || !f.lng)));
  const facturasRetira = $derived(facturasFiltradas.filter(esRetira));

  const facturasSeleccionadas = $derived.by(() => {
    return facturasDelDia.filter(f => seleccionados.has(f.id));
  });

  function grupoDelCliente(clienteId: number): any | null {
    for (const g of grupos.values()) {
      if (g.clienteIds.includes(clienteId)) return g;
    }
    return null;
  }

  const grupoArray = $derived([...grupos.values()]);

  const grupoActivo = $derived(
    grupoActivoId ? grupos.get(grupoActivoId) ?? null : null
  );

  const clientesEnActivo = $derived.by(() => {
    if (!grupoActivo) return [];
    return grupoActivo.ordenRuta
      .map((id: number) => {
        const f = facturasDelDia.find((ff: any) => ff.cliente_id === id);
        if (!f) return null;
        return {
          id: f.cliente_id,
          nombre: f.cliente_nombre,
          domicilio: f.cliente_domicilio || '',
          facturas: facturasDelDia.filter((ff: any) => ff.cliente_id === id),
        };
      })
      .filter(Boolean);
  });

  const facturasSinGrupo = $derived(
    facturasGeocodificadas.filter(f => {
      if (!f.cliente_id) return true;
      for (const g of grupos.values()) {
        if (g.clienteIds.includes(f.cliente_id)) return false;
      }
      return true;
    })
  );

  const facturasSinGeoEnActivo = $derived.by(() => {
    if (!grupoActivo) return [];
    return facturasDelDia.filter(
      f => f.cliente_id && grupoActivo.clienteIds.includes(f.cliente_id) && (!f.lat || !f.lng) && !esRetira(f)
    );
  });

  const facturasSinGeocodificarTotal = $derived(
    facturasDelDia.filter(f => (!f.lat || !f.lng) && !esRetira(f))
  );

  $effect(() => { mapaStore.modoProgramar = modoProgramar; });
  $effect(() => {
    const v = mapaStore.modoProgramar;
    if (v !== modoProgramar) {
      modoProgramar = v;
      if (v) {}
      renderizarMarcadores();
    }
  });
  $effect(() => { mapaStore.grupos = grupos; });
  $effect(() => { mapaStore.grupoActivoId = grupoActivoId; });
  $effect(() => { mapaStore.planViajeId = planViajeId; });

  $effect(() => {
    const f = mapaStore.fecha;
    if (f !== fecha) {
      fecha = f;
      cargarDashboard();
      cargarPlan();
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
    const _ = mapaStore.filtroRecencia;
    if (map && fecha) cargarDashboard();
  });

  $effect(() => {
    const coords = mapaStore.busquedaCoords;
    renderizarMarcadorBusqueda();
  });

  $effect(() => {
    const od = mapaStore.origenDireccion;
    if (od !== origenDireccion) origenDireccion = od;
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
    if (eo !== editandoOrigen) editandoOrigen = eo;
  });

  $effect(() => {
    mapaStore.pendientesCount = todosLosClientes.filter(c => c.pedidos_pendientes > 0 && !clientesIdsConFactura.has(c.id)).length;
  });

  // ── Icon creators ──

  function crearIcono(color: string, glow = false, size = 14) {
    const shadow = glow
      ? `0 0 8px ${color}88, 0 1px 4px rgba(0,0,0,0.4)`
      : `0 1px 4px rgba(0,0,0,0.4)`;
    return L.divIcon({
      className: '',
      html: `<div style="width:${size}px;height:${size}px;background:${color};border:2px solid white;border-radius:50%;box-shadow:${shadow};"></div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  function crearIconoClienteFondo() {
    return L.divIcon({
      className: '',
      html: `<div style="width:10px;height:10px;background:#cbd5e1;border:1.5px solid white;border-radius:50%;box-shadow:0 1px 2px rgba(0,0,0,0.15);"></div>`,
      iconSize: [10, 10],
      iconAnchor: [5, 5],
    });
  }

  function crearIconoFacturaPendiente() {
    return L.divIcon({
      className: 'pin-pendiente',
      html: `<div class="pin-dot" style="width:18px;height:18px;background:#ef4444;" data-seleccionado="false"></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
  }

  function crearIconoSeleccionado(numero: number) {
    return L.divIcon({
      className: '',
      html: `<div style="width:32px;height:32px;background:#f59e0b;border:2.5px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:white;box-shadow:0 0 0 3px rgba(245,158,11,0.35);animation:pulso-mapa-global 1.5s infinite;">${numero}</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
  }

  function crearIconoGrupo(color: string, numero: number, glow = false) {
    const shadow = glow
      ? `0 0 8px ${color}88, 0 1px 4px rgba(0,0,0,0.4)`
      : `0 1px 4px rgba(0,0,0,0.4)`;
    return L.divIcon({
      className: '',
      html: `<div style="width:28px;height:28px;background:${color};border:2.5px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:white;box-shadow:${shadow}, 0 0 0 3px ${color}44;">${numero}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
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

  // ── Map init ──

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
      const btns = popupEl.querySelectorAll('[data-action="geocodificar"]');
      for (const btn of btns) {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const id = parseInt((ev.currentTarget as HTMLElement).dataset.id || '');
          if (id) geocodificarFacturaEnMapa(id);
        });
      }
      const editBtns = popupEl.querySelectorAll('[data-action="editar-direccion"]');
      for (const btn of editBtns) {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const id = parseInt((ev.currentTarget as HTMLElement).dataset.id || '');
          if (id) abrirEditarDireccionFactura(id);
        });
      }
    });

    await cargarDashboard();
    await cargarPlan();
    await cargarOrigen();
  }

  async function cargarDashboard() {
    cargando = true;
    try {
      const data = await api.getMapaDashboard(fecha, false, mapaStore.filtroRecencia);
      todosLosClientes = data.clientes;
      cacheStore.set('mapa-clientes', data.clientes, 120000);
      facturasDelDia = data.entregas;
      seleccionados = new Set();
      ordenRuta = [];
      renderizarMarcadores();
      dispararGeocodificacionAuto();
    } catch (e) {
      errorText = 'No se pudieron cargar los datos del mapa.';
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

  // ── Marker rendering ──

  function renderizarMarcadores() {
    if (!map || !L) return;

    Object.values(marcadores).forEach(m => map.removeLayer(m));
    Object.values(marcadoresClientes).forEach(m => map.removeLayer(m));
    marcadores = {};
    marcadoresClientes = {};

    const idsFacturaSeleccionada = new Set(
      ordenRuta.filter(id => seleccionados.has(id))
    );

    // ── Capa 1: Clientes de fondo (solo en Todos) ──
    if (!mapaStore.filtroPendientes) for (const cliente of todosLosClientes) {
      let clat = cliente.lat;
      let clng = cliente.lng;
      if (!clat || !clng) {
        const defaultAddr = cliente.addresses?.find((a: any) => a.is_default);
        if (defaultAddr?.lat && defaultAddr?.lng) {
          clat = defaultAddr.lat;
          clng = defaultAddr.lng;
        } else if (cliente.addresses?.length) {
          const firstGeo = cliente.addresses.find((a: any) => a.lat && a.lng);
          if (firstGeo) { clat = firstGeo.lat; clng = firstGeo.lng; }
        }
      }
      if (!clat || !clng) continue;

      const esFondo = clientesIdsConFactura.has(cliente.id);
      const icono = esFondo ? crearIconoClienteFondo() : crearIcono('#3b82f6', false, 12);

      const marker = L.marker([clat, clng], { icon: icono, interactive: !esFondo, zIndexOffset: esFondo ? -100 : -50 })
        .addTo(map);

      if (!esFondo) {
        marker.bindPopup(clientePopupHtml(cliente));
        marker.bindTooltip(`<strong>${cliente.nombre}</strong>${cliente.domicilio ? '<br>' + cliente.domicilio : ''}`,
          { direction: 'top', offset: [0, -8], className: 'cliente-tooltip' });
        marker.on('click', () => {
          if (!modoProgramar) centrarEnCliente(cliente.id);
        });
      }

      marcadoresClientes[`c-${cliente.id}`] = marker;
    }

    // ── Capa 2: Facturas (primaria) ──
    for (const factura of facturasFiltradas) {
      const lat = factura.lat;
      const lng = factura.lng;
      if (!lat || !lng) continue;

      const estaSeleccionada = seleccionados.has(factura.id);
      const grupo = factura.cliente_id ? grupoDelCliente(factura.cliente_id) : null;

      let icon;
      const ordenIdx = ordenRuta.indexOf(factura.id);

      if (modoProgramar) {
        const color = grupo?.color || '#9ca3af';
        const nombre = factura.cliente_nombre || '';
        icon = L.divIcon({
          className: '',
          html: `<div style="display:flex;align-items:center;gap:5px;background:rgba(255,255,255,0.95);border-radius:20px;padding:3px 10px 3px 5px;box-shadow:0 2px 8px rgba(0,0,0,0.2);border:1.5px solid ${color};max-width:180px;">
            <span style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;flex-shrink:0;box-shadow:0 0 0 2px ${color}44;"></span>
            <span style="font-size:12px;font-weight:600;color:#1f2937;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${nombre}</span>
          </div>`,
          iconSize: [0, 0],
          iconAnchor: [7, 7],
        });
      } else if (estaSeleccionada && ordenIdx >= 0) {
        icon = crearIconoSeleccionado(ordenIdx + 1);
      } else {
        icon = L.divIcon({
          className: '',
          html: '<div style="display:flex;align-items:center;gap:5px;background:rgba(255,255,255,0.95);border-radius:20px;padding:3px 10px 3px 5px;box-shadow:0 2px 8px rgba(0,0,0,0.2);border:1.5px solid #ef4444;max-width:180px;"><span style="width:10px;height:10px;border-radius:50%;background:#ef4444;flex-shrink:0;"></span><span style="font-size:11px;font-weight:500;color:#374151;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (factura.cliente_nombre || '') + '</span></div>',
          iconSize: [0, 0],
          iconAnchor: [7, 7],
        });
      }

      const markerKey = `f-${factura.id}`;
      const marker = L.marker([lat, lng], { icon, zIndexOffset: 100 })
        .addTo(map)
        .bindPopup(facturaPopupHtml(factura))
        .bindTooltip(
          `<strong>${factura.numero_factura}</strong><br>${factura.cliente_nombre}${factura.cliente_domicilio ? '<br>' + factura.cliente_domicilio : ''}`,
          { direction: 'top', offset: [0, -12], className: 'cliente-tooltip' }
        );

      marker.on('contextmenu', (e) => {
        L.DomEvent.preventDefault(e.originalEvent);
        mostrarMenuContextual(e.originalEvent, factura.id);
      });

      if (modoProgramar) {
        marker.on('click', () => { if (factura.cliente_id) toggleClienteEnGrupo(factura.cliente_id); });
      } else {
        marker.on('click', () => toggleSeleccionFactura(factura.id));
      }

      marcadores[markerKey] = marker;
    }
  }

  function colectarUbicacionesCliente(cliente: any) {
    const ubicaciones: Array<{ lat: number; lng: number; label: string; isDefault: boolean; addrId?: number }> = [];
    if (cliente.addresses && cliente.addresses.length > 0) {
      for (const addr of cliente.addresses) {
        if (addr.lat != null && addr.lng != null) {
          ubicaciones.push({ lat: addr.lat, lng: addr.lng, label: addr.label || addr.address, isDefault: addr.is_default, addrId: addr.id });
        }
      }
    }
    if (ubicaciones.length === 0 && cliente.lat && cliente.lng) {
      ubicaciones.push({ lat: cliente.lat, lng: cliente.lng, label: cliente.domicilio || '', isDefault: true });
    }
    return ubicaciones;
  }

  async function generarReporteCercanos() {
    mapaStore.cargandoCercanos = true;
    const RADIO_KM = 4;
    const reporte = new Map();
    const clientesConFacturaHoy = clientesIdsConFactura;

    for (const factura of facturasDelDia) {
      if (!factura.lat || !factura.lng) continue;
      const cercanos: { cliente: any; distanciaKm: number; coords: { lat: number; lng: number } }[] = [];

      for (const cliente of todosLosClientes) {
        if (clientesConFacturaHoy.has(cliente.id)) continue;
        const ubicaciones = colectarUbicacionesCliente(cliente);
        if (ubicaciones.length === 0) continue;
        for (const ubicacion of ubicaciones) {
          const d = haversine({ lat: factura.lat, lng: factura.lng }, ubicacion);
          if (d <= RADIO_KM) {
            cercanos.push({ cliente, distanciaKm: Math.round(d * 100) / 100, coords: { lat: ubicacion.lat, lng: ubicacion.lng } });
            break;
          }
        }
      }

      if (cercanos.length > 0) {
        cercanos.sort((a, b) => a.distanciaKm - b.distanciaKm);
        reporte.set(factura.id, { factura, cercanos });
      }
    }

    mapaStore.reporteCercanos = reporte;
    mapaStore.cargandoCercanos = false;
  }

  function centrarEnCoords(lat: number, lng: number) {
    if (map) map.setView([lat, lng], 16);
  }

  function clientePopupHtml(cliente: any) {
    const items: string[] = [];
    items.push(`<strong>${cliente.nombre}</strong>`);
    items.push(`<span style="color:var(--text-secondary);">${cliente.domicilio ?? ''}</span>`);
    if (cliente.telefono) items.push(`&#128222; ${cliente.telefono}`);
    items.push(`<hr style="margin:6px 0;border-color:#eee;">`);
    items.push(`<span style="color:#9ca3af;font-size:11px;">Cliente sin facturas pendientes</span>`);
    return `<div style="font-family:sans-serif;font-size:13px;min-width:180px;display:flex;flex-direction:column;gap:2px;">${items.join('')}</div>`;
  }

  function facturaPopupHtml(factura: any) {
    const items: string[] = [];
    items.push(`<strong style="font-size:14px;">${factura.numero_factura}</strong>`);
    items.push(`<span style="color:#374151;font-weight:500;">${factura.cliente_nombre}</span>`);
    items.push(`<span style="color:${kanbanColor(factura.estado_kanban)};font-weight:600;">${kanbanText(factura.estado_kanban)}</span>`);

    if (factura.cliente_domicilio) {
      items.push(`<span style="color:var(--text-secondary);">📍 ${factura.cliente_domicilio}${factura.cliente_piso_depto ? ', ' + factura.cliente_piso_depto : ''}</span>`);
    }
    if (factura.cliente_telefono) items.push(`&#128222; ${factura.cliente_telefono}`);

    if (factura.total) {
      items.push(`<span style="color:#059669;font-weight:600;">$${factura.total.toLocaleString('es-AR')}</span>`);
    }

    if (factura.geocode_error) {
      items.push(`<hr style="margin:6px 0;border-color:#fee2e2;">`);
      items.push(`<span style="color:#dc2626;font-size:11px;font-weight:500;">⚠️ ${factura.geocode_error}</span>`);
      items.push(`<button data-action="editar-direccion" data-id="${factura.id}" style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;font-family:var(--font, sans-serif);color:#dc2626;width:100%;margin-top:3px;">✏️ Corregir dirección</button>`);
    } else if (!factura.lat || !factura.lng) {
      items.push(`<hr style="margin:6px 0;border-color:#eee;">`);
      items.push(`<button data-action="geocodificar" data-id="${factura.id}" style="background:transparent;border:1px solid #d1d5db;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;font-family:var(--font, sans-serif);color:#374151;width:100%;">📍 Geocodificar dirección</button>`);
    }

    return `<div style="font-family:sans-serif;font-size:13px;min-width:200px;display:flex;flex-direction:column;gap:2px;">${items.join('')}</div>`;
  }

  // ── Context menu ──

  function mostrarMenuContextual(e: any, facturaId: number) {
    e.preventDefault();
    menuContextual = { x: e.clientX, y: e.clientY, id: facturaId };
  }

  function cerrarMenuContextual() {
    menuContextual = null;
  }

  function cerrarEdicion() {
    editandoOrdenId = null;
  }

  function toggleSeleccionFactura(id: number) {
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

  function quitarDeRuta(facturaId: number) {
    seleccionados.delete(facturaId);
    seleccionados = new Set(seleccionados);
    ordenRuta = ordenRuta.filter(i => i !== facturaId);
    menuContextual = null;
    renderizarMarcadores();
  }

  function empezarEdicionOrden(facturaId: number) {
    editandoOrdenId = facturaId;
    const idx = ordenRuta.indexOf(facturaId);
    ordenInputValue = String(idx + 1);
  }

  function confirmarOrden(facturaId: number) {
    if (editandoOrdenId !== facturaId) return;
    const num = parseInt(ordenInputValue, 10);
    if (isNaN(num) || num < 1) { editandoOrdenId = null; return; }
    const fromIdx = ordenRuta.indexOf(facturaId);
    if (fromIdx === -1) { editandoOrdenId = null; return; }
    let toIdx = Math.max(0, Math.min(ordenRuta.length - 1, num - 1));
    if (fromIdx === toIdx) { editandoOrdenId = null; return; }
    const newOrder = [...ordenRuta];
    newOrder.splice(fromIdx, 1);
    const adjToIdx = toIdx > fromIdx ? toIdx - 1 : toIdx;
    newOrder.splice(adjToIdx, 0, facturaId);
    ordenRuta = newOrder;
    editandoOrdenId = null;
    renderizarMarcadores();
  }

  function handleOrdenKeydown(e: KeyboardEvent, facturaId: number) {
    if (e.key === 'Enter') (e.target as HTMLElement)?.blur();
    else if (e.key === 'Escape') editandoOrdenId = null;
  }

  function centrarEnFactura(facturaId: number) {
    const f = facturaMap.get(facturaId);
    if (!f || !f.lat || !f.lng) return;
    const mk = marcadores[`f-${facturaId}`];
    if (mk) {
      map.setView(mk.getLatLng(), 16);
      mk.openPopup();
    }
  }

  function centrarEnCliente(clienteId: number) {
    const c = todosLosClientes.find(cc => cc.id === clienteId);
    if (!c) return;
    const mk = marcadoresClientes[`c-${clienteId}`];
    if (mk) {
      map.setView(mk.getLatLng(), 16);
      mk.openPopup();
    }
  }

  function centrarMapa() {
    map?.setView([-34.6037, -58.3816], 13);
  }

  // ── Geocoding ──

  async function geocodificarFacturaEnMapa(facturaId: number) {
    geocodificandoFacturaId = facturaId;
    try {
      const res = await api.geocodificarFactura(facturaId);
      if (res?.lat && res?.lng) {
        const f = facturaMap.get(facturaId);
        if (f) { f.lat = res.lat; f.lng = res.lng; f.geocode_error = null; }
        renderizarMarcadores();
      }
    } catch (e: any) {
      const f = facturaMap.get(facturaId);
      if (f) {
        f.geocode_error = e.message || 'Error de geocodificación';
      }
      appStore.showToast('Error al geocodificar: ' + (e.message || e), 'error');
    }
    finally { geocodificandoFacturaId = null; }
  }

  async function geocodificarClienteEnMapa(clienteId: number) {
    try {
      const res = await api.geocodificarCliente(clienteId);
      if (res?.lat && res?.lng) {
        const c = todosLosClientes.find(cc => cc.id === clienteId);
        if (c) { c.lat = res.lat; c.lng = res.lng; }
        renderizarMarcadores();
      }
    } catch (e: any) {
      appStore.showToast('Error al geocodificar cliente: ' + (e.message || e), 'error');
    }
  }

  async function dispararGeocodificacionAuto() {
    const sinGeo = facturasDelDia.filter(f => !f.lat && !f.lng && !f.geocode_error && f.cliente_domicilio);
    if (sinGeo.length === 0) return;

    geocodificandoAuto = true;
    geocodificandoAutoTotal = sinGeo.length;
    geocodificandoAutoHecho = 0;

    for (const factura of sinGeo) {
      try {
        const res = await api.geocodificarFactura(factura.id);
        if (res?.lat && res?.lng) {
          const f = facturaMap.get(factura.id);
          if (f) { f.lat = res.lat; f.lng = res.lng; f.geocode_error = null; }
        }
      } catch (e: any) {
        const f = facturaMap.get(factura.id);
        if (f) {
          f.geocode_error = e.message || 'Error de geocodificación';
        }
      }
      geocodificandoAutoHecho++;
      if (geocodificandoAutoHecho % 5 === 0 || geocodificandoAutoHecho === geocodificandoAutoTotal) {
        renderizarMarcadores();
      }
      await new Promise(r => setTimeout(r, 1100));
    }
    geocodificandoAuto = false;
    renderizarMarcadores();
  }

  // ── Editar dirección de factura ──

  let showEditDireccionModal = $state(false);
  let editDireccionFactura = $state<any>(null);
  let editDireccionValor = $state('');
  let editDireccionGuardando = $state(false);
  let editDireccionPreviewCoords = $state<{ lat: number; lng: number } | null>(null);
  let editDireccionPreviewError = $state('');
  let editDireccionPreviewCargando = $state(false);

  function abrirEditarDireccionFactura(facturaId: number) {
    const f = facturaMap.get(facturaId);
    if (!f) return;
    editDireccionFactura = f;
    editDireccionValor = f.cliente_domicilio || '';
    editDireccionPreviewCoords = null;
    editDireccionPreviewError = '';
    showEditDireccionModal = true;
  }

  function editDireccionLimpia() {
    return limpiarDireccion(editDireccionValor);
  }

  async function probarGeocodificacion() {
    const dir = editDireccionLimpia();
    if (!dir.trim()) return;
    editDireccionPreviewCargando = true;
    editDireccionPreviewError = '';
    editDireccionPreviewCoords = null;
    try {
      const url = nominatimSearchUrl(dir);
      const res = await fetch(url, { headers: { 'User-Agent': 'BastidoresGal/1.0' } });
      const data = await res.json();
      if (data.length > 0) {
        editDireccionPreviewCoords = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      } else {
        editDireccionPreviewError = 'No se encontró la dirección. Probá escribirla de otra forma.';
      }
    } catch {
      editDireccionPreviewError = 'Error de conexión al probar geocodificación.';
    } finally {
      editDireccionPreviewCargando = false;
    }
  }

  async function guardarEditarDireccion() {
    if (!editDireccionFactura) return;
    editDireccionGuardando = true;
    const facturaId = editDireccionFactura.id;
    try {
      await api.patchInvoiceField(facturaId, 'cliente_domicilio', editDireccionValor);
      const f = facturaMap.get(facturaId);
      if (f) {
        f.cliente_domicilio = editDireccionValor;
        f.geocode_error = null;
        f.lat = null;
        f.lng = null;
      }
      showEditDireccionModal = false;
      if (volverAGeoTrasEditar) { showGeoModal = true; volverAGeoTrasEditar = false; }
      editDireccionFactura = null;
      geocodificandoFacturaId = facturaId;
      try {
        const res = await api.geocodificarFactura(facturaId);
        if (res?.lat && res?.lng && f) {
          f.lat = res.lat;
          f.lng = res.lng;
        }
      } catch (e: any) {
        if (f) f.geocode_error = e.message || 'Error';
      }
      geocodificandoFacturaId = null;
      if (f?.cliente_id && editDireccionValor.trim()) {
        try {
          await api.addAddress(f.cliente_id, {
            address: editDireccionValor.trim(),
            lat: f.lat ?? null,
            lng: f.lng ?? null,
          });
        } catch { }
      }
      renderizarMarcadores();
    } catch {
      appStore.showToast('Error al guardar dirección', 'error');
    } finally {
      editDireccionGuardando = false;
    }
  }

  function irAFacturacion(facturaId: number) {
    showEditDireccionModal = false;
    editDireccionFactura = null;
    appStore.pendingInvoiceId = facturaId;
    appStore.currentTab = 'facturacion';
  }

  // ── Edit cliente ──

  function openEditClienteModal(facturaId: number) {
    const f = facturaMap.get(facturaId);
    if (!f) return;
    const c = todosLosClientes.find(cc => cc.id === f.cliente_id);
    if (!c) return;
    editClienteData = c;
    showEditClienteModal = true;
    menuContextual = null;
  }

  function closeEditClienteModal() {
    showEditClienteModal = false;
    editClienteData = null;
  }

  function onClienteSaved() {
    showEditClienteModal = false;
    editClienteData = null;
    cacheStore.invalidate('mapa-clientes');
    renderizarMarcadores();
  }

  // ── Recomendar rutas ──

  function onRecomendacionSeleccionar(ids: number[]) {
    seleccionados = new Set(ids);
    ordenRuta = ids;
    renderizarMarcadores();
    setTimeout(() => trazarRuta(), 300);
  }

  // ── Travel groups ──

  function toggleClienteEnGrupo(clienteId: number) {
    if (!grupoActivoId) return;
    const g = grupos.get(grupoActivoId);
    if (!g) return;
    const updated = new Map(grupos);
    const idx = g.clienteIds.indexOf(clienteId);
    if (idx >= 0) {
      updated.set(grupoActivoId, {
        ...g,
        clienteIds: g.clienteIds.filter((id: number) => id !== clienteId),
        ordenRuta: g.ordenRuta.filter((id: number) => id !== clienteId),
      });
    } else {
      updated.set(grupoActivoId, {
        ...g,
        clienteIds: [...g.clienteIds, clienteId],
        ordenRuta: [...g.ordenRuta, clienteId],
      });
    }
    grupos = updated;
    renderizarMarcadores();
  }

  function crearGrupo() {
    const color = CONSOLA_COLORS[colorIdx % CONSOLA_COLORS.length];
    colorIdx++;
    const id = `grupo-${Date.now()}`;
    const nuevo = { id, nombre: `Viaje ${grupos.size + 1}`, clienteIds: [], ordenRuta: [], color };
    const updated = new Map(grupos);
    updated.set(id, nuevo);
    grupos = updated;
    grupoActivoId = id;
    renderizarMarcadores();
  }

  function eliminarGrupo(id: string) {
    const updated = new Map(grupos);
    updated.delete(id);
    grupos = updated;
    if (grupoActivoId === id) grupoActivoId = updated.size > 0 ? [...updated.keys()][0] : null;
    renderizarMarcadores();
  }

  function quitarClienteDeGrupo(groupId: string, clienteId: number) {
    const g = grupos.get(groupId);
    if (!g) return;
    const updated = new Map(grupos);
    updated.set(groupId, {
      ...g,
      clienteIds: g.clienteIds.filter((id: number) => id !== clienteId),
      ordenRuta: g.ordenRuta.filter((id: number) => id !== clienteId),
    });
    grupos = updated;
    renderizarMarcadores();
  }

  function reordenarGrupo(groupId: string, nuevoOrden: number[]) {
    const g = grupos.get(groupId);
    if (!g) return;
    const updated = new Map(grupos);
    updated.set(groupId, { ...g, ordenRuta: nuevoOrden });
    grupos = updated;
    renderizarMarcadores();
  }

  function renombrarGrupo(groupId: string, newName: string) {
    const g = grupos.get(groupId);
    if (!g) return;
    const updated = new Map(grupos);
    updated.set(groupId, { ...g, nombre: newName });
    grupos = updated;
    renderizarMarcadores();
  }

  function moverClienteAGrupo(clienteId: number, targetGroupId: string) {
    const grupoOrigen = grupoDelCliente(clienteId);
    const updated = new Map(grupos);
    if (grupoOrigen) {
      updated.set(grupoOrigen.id, {
        ...grupoOrigen,
        clienteIds: grupoOrigen.clienteIds.filter((id: number) => id !== clienteId),
        ordenRuta: grupoOrigen.ordenRuta.filter((id: number) => id !== clienteId),
      });
    }
    const target = updated.get(targetGroupId);
    if (target) {
      updated.set(targetGroupId, {
        ...target,
        clienteIds: [...target.clienteIds, clienteId],
        ordenRuta: [...target.ordenRuta, clienteId],
      });
    }
    grupos = updated;
    renderizarMarcadores();
  }

  async function cargarPlan() {
    try {
      const plan = await api.getPlanViaje('plan_permanente');
      if (plan && plan.grupos && plan.grupos.length > 0) {
        const m = new Map();
        for (const g of plan.grupos) m.set(g.id, g);
        grupos = m;
        grupoActivoId = plan.grupos[0].id;
        planViajeId = plan.id;
        modoProgramar = true;
        renderizarMarcadores();
      }
    } catch {}
  }

  async function guardarPlan() {
    guardandoPlan = true;
    try {
      if (grupos.size === 0) {
        if (planViajeId) await api.deletePlanViaje(planViajeId);
        planViajeId = null;
        appStore.showToast('Plan eliminado', 'success');
        return;
      }
      const data = { fecha: 'plan_permanente', grupos: [...grupos.values()] };
      if (planViajeId) {
        await api.updatePlanViaje(planViajeId, data);
      } else {
        const res = await api.savePlanViaje(data);
        planViajeId = res.id;
      }
      appStore.showToast('Plan guardado', 'success');
    } catch {
      appStore.showToast('Error al guardar el plan', 'error');
    } finally {
      guardandoPlan = false;
    }
  }

  function enviarAPanel() {
    guardarPlan();
    appStore.currentTab = 'panel-control';
  }

  function regenerarPlan() {
    mapaStore.planAutoGenerado = false;
    grupos = new Map();
    grupoActivoId = null;
    generarPlanAuto();
    renderizarMarcadores();
  }

  function generarPlanAuto() {
    const geocodificadas = facturasDelDia.filter(f => f.lat && f.lng);
    if (geocodificadas.length === 0) return;

    const clientesUnicos: { id: number; domicilio: string; lat: number; lng: number }[] = [];
    const seen = new Set<number>();
    for (const f of geocodificadas) {
      if (f.cliente_id && !seen.has(f.cliente_id)) {
        seen.add(f.cliente_id);
        clientesUnicos.push({ id: f.cliente_id, domicilio: f.cliente_domicilio || '', lat: f.lat, lng: f.lng });
      }
    }
    if (clientesUnicos.length === 0) return;

    const recomendaciones = recomendarRutas(clientesUnicos, mapaStore.algoMinPorGrupo, mapaStore.algoMaxPorGrupo, mapaStore.algoEpsKm);
    if (recomendaciones.length === 0) return;

    const nuevos = new Map<string, any>();
    recomendaciones.forEach((grupo, i) => {
      const color = CONSOLA_COLORS[i % CONSOLA_COLORS.length];
      const id = `grupo-auto-${Date.now()}-${i}`;
      nuevos.set(id, {
        id,
        nombre: grupo.nombreZona || `Viaje ${i + 1}`,
        clienteIds: grupo.clientesIds,
        ordenRuta: grupo.clientesIds,
        color,
      });
    });
    grupos = nuevos;
    grupoActivoId = nuevos.size > 0 ? [...nuevos.keys()][0] : null;
    mapaStore.planAutoGenerado = true;
    renderizarMarcadores();
  }

  // ── Search ──

  async function buscarDireccion(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    if (facturasFiltradas.length === 1) {
      const f = facturasFiltradas[0];
      if (f.lat && f.lng) {
        map.setView([f.lat, f.lng], 16);
        marcadores[`f-${f.id}`]?.openPopup();
      }
      return;
    }
    if (facturasFiltradas.length > 0) return;

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

  // ── Routing ──

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

    const facturasRuta = ordenRuta
      .map(id => facturaMap.get(id))
      .filter(f => f && seleccionados.has(f.id) && f.lat && f.lng);

    if (facturasRuta.length === 0) return;

    limpiarRuta();

    const waypoints: any[] = [];
    if (origenCoords) {
      waypoints.push(L.latLng(origenCoords.lat, origenCoords.lng));
    }
    for (const f of facturasRuta) {
      waypoints.push(L.latLng(f.lat, f.lng));
    }

    if (waypoints.length < 2) {
      infoRuta = 'Se necesita al menos un origen y un destino.';
      return;
    }

    calculandoRuta = true;
    infoRuta = 'Calculando...';

    if (!L?.Routing) {
      (window as any).L = L;
      await import('leaflet-routing-machine');
    }

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

        if (grupoActivoId && route.coordinates) {
          const coords = route.coordinates.map((c: any) => [c.lat, c.lng] as [number, number]);
          const activeGroup = grupos.get(grupoActivoId);
          const activeClienteIds = new Set(activeGroup?.clienteIds || []);
          const candidatos = facturasDelDia
            .filter(f => f.lat && f.lng && f.cliente_id != null && !activeClienteIds.has(f.cliente_id))
            .map(f => ({ id: f.id, lat: f.lat, lng: f.lng }));
          if (candidatos.length > 0 && coords.length >= 2) {
            const cercanos = findCercanosRuta(coords, candidatos, 300);
            const seenClientes = new Set<number>();
            rutaCercanos = cercanos
              .map(c => facturasDelDia.find(f => f.id === c.id))
              .filter(f => f && f.cliente_id && !seenClientes.has(f.cliente_id) && seenClientes.add(f.cliente_id));
          }
        }
      }
    });

    routingControl.on('routingerror', () => {
      calculandoRuta = false;
      infoRuta = 'Error al calcular ruta';
    });
    hayRutaActiva = true;
  }

  function mejorarCon2opt(puntos: { lat: number; lng: number }[]) {
    if (puntos.length < 3) return puntos;
    let ruta = [...puntos];
    let mejorado = true;
    while (mejorado) {
      mejorado = false;
      for (let i = 0; i < ruta.length - 2; i++) {
        for (let k = i + 1; k < ruta.length - 1; k++) {
          const dAntes = haversine(ruta[i], ruta[i + 1]) + haversine(ruta[k], ruta[k + 1]);
          const dDesp = haversine(ruta[i], ruta[k]) + haversine(ruta[i + 1], ruta[k + 1]);
          if (dDesp < dAntes) {
            ruta = [...ruta.slice(0, i + 1), ...ruta.slice(i + 1, k + 1).reverse(), ...ruta.slice(k + 1)];
            mejorado = true;
          }
        }
      }
    }
    return ruta;
  }

  async function optimizarRuta() {
    if (ordenRuta.length < 2) return;

    const clientes = ordenRuta
      .map(id => facturaMap.get(id))
      .filter(f => f && seleccionados.has(f.id) && f.lat && f.lng);

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
    const mejorados = mejorarCon2opt(ordenRuta.map(id => facturaMap.get(id)).filter(f => f && f.lat && f.lng));
    if (mejorados.length > 1) ordenRuta = mejorados.map(c => c.id);
    renderizarMarcadores();
    renderizarRutaOptimizada();
  }

  async function renderizarRutaOptimizada() {
    const facturasRuta = ordenRuta
      .map(id => facturaMap.get(id))
      .filter(f => f && seleccionados.has(f.id) && f.lat && f.lng);

    if (facturasRuta.length < 2) return;

    limpiarRuta();

    const ghApiKey = 'ca6b67a0-aa56-48ec-83d0-474b861f3259';
    const points: string[] = [];

    if (origenCoords) {
      points.push(`point=${origenCoords.lat},${origenCoords.lng}`);
    }
    for (const f of facturasRuta) {
      points.push(`point=${f.lat},${f.lng}`);
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
      hayRutaActiva = true;
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

  async function trazarRutaGrupo(grupoId: string) {
    const grupo = grupos.get(grupoId);
    if (!grupo) return;

    const facturasGrupo = facturasDelDia.filter(
      f => f.cliente_id && grupo.clienteIds.includes(f.cliente_id) && f.lat && f.lng
    );

    if (facturasGrupo.length === 0) {
      appStore.showToast('No hay facturas geocodificadas en este viaje', 'error');
      return;
    }

    const ids = facturasGrupo.map(f => f.id);
    seleccionados = new Set(ids);
    ordenRuta = ids;
    rutaCercanos = [];

    if (facturasGrupo.length > 1) {
      const origin = origenCoords
        ? { lat: origenCoords.lat, lng: origenCoords.lng }
        : { lat: facturasGrupo[0].lat, lng: facturasGrupo[0].lng };

      const noVisitados = facturasGrupo.map(f => ({ ...f }));
      const ordenados: any[] = [];
      let actual = origin;

      while (noVisitados.length > 0) {
        let menorDist = Infinity;
        let idx = -1;
        for (let i = 0; i < noVisitados.length; i++) {
          const d = haversine(actual, noVisitados[i]);
          if (d < menorDist) { menorDist = d; idx = i; }
        }
        const next = noVisitados.splice(idx, 1)[0];
        ordenados.push(next);
        actual = next;
      }

      const mejorados = mejorarCon2opt(ordenados);
      ordenRuta = mejorados.map(c => c.id);
    }

    renderizarMarcadores();
    trazarRuta();
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
    hayRutaActiva = false;
    rutaCercanos = [];
  }

  function abrirEnGoogleMaps() {
    if (ordenRuta.length === 0) return;

    const facturasRuta = ordenRuta
      .map(id => facturaMap.get(id))
      .filter(f => f && seleccionados.has(f.id));

    if (facturasRuta.length === 0) return;

    const origen = encodeURIComponent(`${origenDireccion}, Buenos Aires`);
    const [primero, ...resto] = facturasRuta;
    const destino = encodeURIComponent(`${primero.cliente_domicilio}, Buenos Aires`);
    const waypoints = resto
      .map(f => encodeURIComponent(`${f.cliente_domicilio}, Buenos Aires`))
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

    const facturasRuta = ordenRuta
      .map(id => facturaMap.get(id))
      .filter(f => f && seleccionados.has(f.id));

    if (facturasRuta.length === 0) { appStore.alert('Primero trazá una ruta'); return; }

    const origen = encodeURIComponent(`${origenDireccion}, Buenos Aires`);
    const [primero, ...resto] = facturasRuta;
    const destino = encodeURIComponent(`${primero.cliente_domicilio}, Buenos Aires`);
    const waypoints = resto
      .map(f => encodeURIComponent(`${f.cliente_domicilio}, Buenos Aires`))
      .join('|');

    const url = waypoints
      ? `https://www.google.com/maps/dir/?api=1&origin=${origen}&destination=${destino}&waypoints=${waypoints}&travelmode=driving`
      : `https://www.google.com/maps/dir/?api=1&origin=${origen}&destination=${destino}&travelmode=driving`;

    navigator.clipboard.writeText(url);
    appStore.showToast('Link de la ruta copiado al portapapeles', 'success');
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

  function toggleProgramar() {
    if (modoProgramar) {
      modoProgramar = false;
    } else {
      const sinGeo = facturasDelDia.filter(f => !f.lat || !f.lng);
      if (sinGeo.length > 0) {
        showGeoModal = true;
        return;
      }
      modoProgramar = true;
      if (!mapaStore.planAutoGenerado) generarPlanAuto();
      if (grupos.size === 0) crearGrupo();
    }
  }

  function omitirDeProgramar(facturaId: number) {
    seleccionados.delete(facturaId);
    seleccionados = new Set(seleccionados);
    ordenRuta = ordenRuta.filter(i => i !== facturaId);
    const pendientes = facturasDelDia.filter(f => seleccionados.has(f.id) && (!f.lat || !f.lng));
    if (pendientes.length === 0) {
      showGeoModal = false;
      modoProgramar = true;
    }
  }

  function cerrarGeoModal() {
    showGeoModal = false;
  }

  function irAProgramar() {
    showGeoModal = false;
    modoProgramar = true;
    if (!mapaStore.planAutoGenerado) generarPlanAuto();
    if (grupos.size === 0) crearGrupo();
  }

  function omitirTodasGeos() {
    const sinGeo = facturasDelDia.filter(f => (!f.lat || !f.lng) && !esRetira(f));
    for (const f of sinGeo) {
      if (seleccionados.has(f.id)) {
        seleccionados.delete(f.id);
      }
    }
    seleccionados = new Set(seleccionados);
    ordenRuta = ordenRuta.filter(id => seleccionados.has(id));
    showGeoModal = false;
    modoProgramar = true;
  }
</script>

<div class="mapa-wrapper">
  <aside class="panel">
    <div class="panel-header">
      <div class="kanban-filtro">
        <button class="kf-btn" class:kf-activo={filtroKanban.length === 0} onclick={() => filtroKanban = []}>Todos</button>
        <button class="kf-btn" class:kf-activo={filtroKanban.includes('PEDIDO')} onclick={() => toggleFiltroKanban('PEDIDO')}>Pedido</button>
        <button class="kf-btn" class:kf-activo={filtroKanban.includes('EN_PROCESO')} onclick={() => toggleFiltroKanban('EN_PROCESO')}>En Proceso</button>
        <button class="kf-btn" class:kf-activo={filtroKanban.includes('LISTO')} onclick={() => toggleFiltroKanban('LISTO')}>Listo</button>
      </div>

      {#if geocodificandoAuto}
        <div class="geo-progress">🌍 Geocodificando {geocodificandoAutoHecho}/{geocodificandoAutoTotal} direcciones...</div>
      {/if}
    </div>

    {#if routingControl || rutaLinea}
    <div class="route-bar">
      <div class="btn-group">
        <button class="btn-google" onclick={abrirEnGoogleMaps} title="Abrir en Google Maps">🗺️</button>
        <button class="btn-copy-link" onclick={copiarRutaAlPortapapeles} title="Copiar link de la ruta">📋</button>
        <button class="btn-clear-ruta" onclick={limpiarRuta} title="Limpiar ruta">✕</button>
      </div>
      {#if infoRuta}
        <div class="ruta-info">{infoRuta}</div>
      {/if}
    </div>
    {/if}

    <div class="panel-scroll">
      {#if cargando}
        <p class="info-text">Cargando...</p>
      {:else if facturasDelDia.length === 0}
        <p class="info-text">Sin resultados.</p>
      {:else if modoProgramar}
        <div class="plan-header">
          <h3>📦 Programar Viajes <button class="btn-sm plan-exit" onclick={() => { modoProgramar = false; renderizarMarcadores(); }}>✕ Cerrar</button></h3>
          <div class="plan-btns">
            <button class="btn-guardar" onclick={guardarPlan} disabled={guardandoPlan}>
              {guardandoPlan ? '⏳ Guardando...' : '💾 Guardar'}
            </button>
            <button class="btn-enviar" onclick={enviarAPanel}>📋 Enviar a panel</button>
          </div>
        </div>

        <div class="grupos-section">
          <div class="grupos-header">
            <span>Viajes</span>
            <div class="grupos-actions">
              <button class="btn-sm" onclick={crearGrupo}>+ Nuevo</button>
              <button class="btn-sm" onclick={regenerarPlan}>🔄 Regenerar</button>
            </div>
          </div>
          {#each grupoArray as grupo (grupo.id)}
            <div
              class="grupo-card"
              class:activo={grupo.id === grupoActivoId}
              onclick={() => { grupoActivoId = grupo.id; renderizarMarcadores(); }}
              role="button"
              tabindex="0"
              onkeydown={(e) => e.key === 'Enter' && (grupoActivoId = grupo.id)}
            >
              <span class="grupo-dot" style="background:{grupo.color}"></span>
              <span class="grupo-nombre">{grupo.nombre}</span>
              <span class="grupo-count">{grupo.clienteIds?.length || 0}</span>
              {#if grupo.clienteIds?.length > 0}
                <button
                  class="grupo-ruta-btn"
                  onclick={(e) => { e.stopPropagation(); trazarRutaGrupo(grupo.id); }}
                  title="Ver ruta optimizada"
                >🗺️</button>
              {/if}
              <button
                class="grupo-del"
                onclick={(e) => { e.stopPropagation(); eliminarGrupo(grupo.id); }}
                title="Eliminar grupo"
              >✕</button>
            </div>
          {:else}
            <p class="info-text">Sin viajes. Crea uno o regenera el plan.</p>
          {/each}
        </div>

        {#if facturasSinGrupo.length > 0}
          <p class="info-text grupo-label">📌 Sin agrupar ({facturasSinGrupo.length})</p>
          <ul class="lista-facturas">
            {#each facturasSinGrupo as factura (factura.id)}
              <li
                class="factura-item"
                onclick={() => { if (factura.cliente_id) toggleClienteEnGrupo(factura.cliente_id); }}
              >
                <span class="factura-geo geo-ok">✓</span>
                <div class="factura-info">
                  <div class="factura-num">{factura.numero_factura}</div>
                  <div class="factura-cliente">{factura.cliente_nombre}</div>
                  <div class="factura-dir">{factura.cliente_domicilio || ''}</div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}

        {#if facturasSinGeocodificar.length > 0}
          <p class="info-text grupo-label">⚠️ Sin geocodificar ({facturasSinGeocodificar.length})</p>
        {/if}
      {:else}
        <p class="info-text">{facturasFiltradas.length} de {facturasDelDia.length} factura{facturasDelDia.length > 1 ? 's' : ''} pendiente{facturasDelDia.length > 1 ? 's' : ''}</p>

        {#if facturasGeocodificadas.length > 0}
          <p class="info-text grupo-label">✅ Geocodificadas ({facturasGeocodificadas.length})</p>
          <ul class="lista-facturas">
            {#each facturasGeocodificadas as factura (factura.id)}
              <li
                class="factura-item"
                class:seleccionado={seleccionados.has(factura.id)}
                onclick={modoProgramar ? () => { if (factura.cliente_id) toggleClienteEnGrupo(factura.cliente_id); } : () => centrarEnFactura(factura.id)}
                oncontextmenu={(e) => mostrarMenuContextual(e, factura.id)}
              >
                {#if modoProgramar}
                  {@const g = factura.cliente_id ? grupoDelCliente(factura.cliente_id) : null}
                  <span
                    class="factura-geo"
                    style={g ? `background:${g.color};color:white;` : ''}
                    title={g ? `En grupo: ${g.nombre}` : 'Geocodificado'}
                  >{g ? g.nombre[0] : '✓'}</span>
                {:else}
                  <span
                    class="factura-geo geo-ok"
                    title="Geocodificado"
                  >✓</span>
                {/if}
                {#if seleccionados.has(factura.id)}
                  {#if editandoOrdenId === factura.id}
                    <input
                      type="number"
                      class="orden-input"
                      bind:value={ordenInputValue}
                      onkeydown={(e) => handleOrdenKeydown(e, factura.id)}
                      onblur={() => confirmarOrden(factura.id)}
                      autofocus
                      min="1"
                      max={ordenRuta.length}
                    />
                  {:else}
                    <span
                      class="orden-badge"
                      onclick={(e) => { e.stopPropagation(); empezarEdicionOrden(factura.id); }}
                      role="button"
                      tabindex="0"
                      onkeydown={(e) => e.key === 'Enter' && empezarEdicionOrden(factura.id)}
                    >{ordenRuta.indexOf(factura.id) + 1}</span>
                  {/if}
                {/if}
                <div class="factura-info">
                  <div class="factura-num">{factura.numero_factura}</div>
                  <div class="factura-cliente">{factura.cliente_nombre}</div>
                  <div class="factura-dir">{factura.cliente_domicilio || ''}{factura.cliente_piso_depto ? ', ' + factura.cliente_piso_depto : ''}</div>
                  <div class="factura-badges">
                    <span class="kanban-badge" style="background:{kanbanColor(factura.estado_kanban)}">{kanbanText(factura.estado_kanban)}</span>
                    {#if factura.total}
                      <span class="total-badge">${factura.total.toLocaleString('es-AR')}</span>
                    {/if}
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}

        {#if facturasRetira.length > 0}
          <p class="info-text grupo-label">📦 Retira ({facturasRetira.length})</p>
          <ul class="lista-facturas">
            {#each facturasRetira as factura (factura.id)}
              <li
                class="factura-item"
                class:seleccionado={seleccionados.has(factura.id)}
                onclick={modoProgramar ? () => { if (factura.cliente_id) toggleClienteEnGrupo(factura.cliente_id); } : () => centrarEnFactura(factura.id)}
                oncontextmenu={(e) => mostrarMenuContextual(e, factura.id)}
              >
                {#if modoProgramar}
                  {@const g = factura.cliente_id ? grupoDelCliente(factura.cliente_id) : null}
                  <span
                    class="factura-geo"
                    style={g ? `background:${g.color};color:white;` : ''}
                    title={g ? `En grupo: ${g.nombre}` : 'Retira'}
                  >{g ? g.nombre[0] : '📦'}</span>
                {:else}
                  <span class="factura-geo" style="background:#8b5cf6;color:white;" title="Retira">📦</span>
                {/if}
                {#if seleccionados.has(factura.id)}
                  {#if editandoOrdenId === factura.id}
                    <input
                      type="number"
                      class="orden-input"
                      bind:value={ordenInputValue}
                      onkeydown={(e) => handleOrdenKeydown(e, factura.id)}
                      onblur={() => confirmarOrden(factura.id)}
                      autofocus
                      min="1"
                      max={ordenRuta.length}
                    />
                  {:else}
                    <span
                      class="orden-badge"
                      onclick={(e) => { e.stopPropagation(); empezarEdicionOrden(factura.id); }}
                      role="button"
                      tabindex="0"
                      onkeydown={(e) => e.key === 'Enter' && empezarEdicionOrden(factura.id)}
                    >{ordenRuta.indexOf(factura.id) + 1}</span>
                  {/if}
                {/if}
                <div class="factura-info">
                  <div class="factura-num">{factura.numero_factura}</div>
                  <div class="factura-cliente">{factura.cliente_nombre}</div>
                  <div class="factura-dir">{factura.cliente_domicilio || ''}{factura.cliente_piso_depto ? ', ' + factura.cliente_piso_depto : ''}</div>
                  <div class="factura-badges">
                    <span class="kanban-badge" style="background:{kanbanColor(factura.estado_kanban)}">{kanbanText(factura.estado_kanban)}</span>
                    {#if factura.total}
                      <span class="total-badge">${factura.total.toLocaleString('es-AR')}</span>
                    {/if}
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}

        {#if facturasSinGeocodificar.length > 0}
          <p class="info-text grupo-label">⚠️ Sin geocodificar ({facturasSinGeocodificar.length})</p>
          <ul class="lista-facturas">
            {#each facturasSinGeocodificar as factura (factura.id)}
              <li
                class="factura-item"
                class:seleccionado={seleccionados.has(factura.id)}
                onclick={modoProgramar ? () => { if (factura.cliente_id) toggleClienteEnGrupo(factura.cliente_id); } : () => centrarEnFactura(factura.id)}
                oncontextmenu={(e) => mostrarMenuContextual(e, factura.id)}
              >
                {#if modoProgramar}
                  {@const g = factura.cliente_id ? grupoDelCliente(factura.cliente_id) : null}
                  <span
                    class="factura-geo"
                    style={g ? `background:${g.color};color:white;` : ''}
                    title={g ? `En grupo: ${g.nombre}` : (!factura.lat || !factura.lng ? (factura.geocode_error ? `Error: ${factura.geocode_error}` : 'Sin geocodificar') : 'Geocodificado')}
                  >{g ? g.nombre[0] : (factura.lat && factura.lng ? '✓' : (factura.geocode_error ? '⚠' : '✗'))}</span>
                {:else}
                  <span
                    class="factura-geo"
                    class:geo-ok={factura.lat && factura.lng}
                    class:geo-bad={!factura.lat || !factura.lng}
                    class:geo-error={!!factura.geocode_error}
                    title={!factura.lat || !factura.lng ? (factura.geocode_error || 'Sin geocodificar') : 'Geocodificado'}
                  >{factura.lat && factura.lng ? '✓' : (factura.geocode_error ? '⚠' : '✗')}</span>
                {/if}
                {#if seleccionados.has(factura.id)}
                  {#if editandoOrdenId === factura.id}
                    <input
                      type="number"
                      class="orden-input"
                      bind:value={ordenInputValue}
                      onkeydown={(e) => handleOrdenKeydown(e, factura.id)}
                      onblur={() => confirmarOrden(factura.id)}
                      autofocus
                      min="1"
                      max={ordenRuta.length}
                    />
                  {:else}
                    <span
                      class="orden-badge"
                      onclick={(e) => { e.stopPropagation(); empezarEdicionOrden(factura.id); }}
                      role="button"
                      tabindex="0"
                      onkeydown={(e) => e.key === 'Enter' && empezarEdicionOrden(factura.id)}
                    >{ordenRuta.indexOf(factura.id) + 1}</span>
                  {/if}
                {/if}
                <div class="factura-info">
                  <div class="factura-num">{factura.numero_factura}</div>
                  <div class="factura-cliente">{factura.cliente_nombre}</div>
                  <div class="factura-dir">{factura.cliente_domicilio || ''}{factura.cliente_piso_depto ? ', ' + factura.cliente_piso_depto : ''}</div>
                  <div class="factura-badges">
                    <span class="kanban-badge" style="background:{kanbanColor(factura.estado_kanban)}">{kanbanText(factura.estado_kanban)}</span>
                    {#if factura.total}
                      <span class="total-badge">${factura.total.toLocaleString('es-AR')}</span>
                    {/if}
                  </div>
                  <div class="factura-actions">
                    <button class="btn-geo-suggest" onclick={(e) => { e.stopPropagation(); abrirEditarDireccionFactura(factura.id); }}>✏️ Corregir dirección</button>
                    <button class="btn-edit-factura" onclick={(e) => { e.stopPropagation(); irAFacturacion(factura.id); }}>📄 Abrir factura</button>
                  </div>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}

      {#if errorText}
        <p class="error-text">{errorText}</p>
      {/if}

      <button class="btn-centrar" onclick={centrarMapa}>Centrar en CABA</button>
    </div>
  </aside>

  <div class="mapa-container-wrap">
    <div class="mapa-container" bind:this={mapContainer} onclick={() => { cerrarMenuContextual(); cerrarEdicion(); }}></div>
    <button
      class="btn-programar-flotante"
      class:activo={modoProgramar}
      onclick={toggleProgramar}
      title={modoProgramar ? 'Cerrar programación' : 'Programar viajes'}
    >📦 {modoProgramar ? 'Cerrar' : 'Programar viajes'}</button>

    {#if modoProgramar && grupoActivo && facturasSinGeoEnActivo.length > 0}
    <div class="geo-alert">
      <div class="geo-alert-header" onclick={() => showGeoAlert = !showGeoAlert} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && (showGeoAlert = !showGeoAlert)}>
        <span>⚠️ {facturasSinGeoEnActivo.length} dirección(es) sin geocodificar</span>
        <span class="geo-alert-chevron">{showGeoAlert ? '▲' : '▼'}</span>
      </div>
      {#if showGeoAlert}
        <div class="geo-alert-body">
          {#each facturasSinGeoEnActivo as factura (factura.id)}
            <div class="geo-alert-item">
              <div class="geo-alert-item-info">
                <strong>{factura.cliente_nombre}</strong>
                <span>{factura.cliente_domicilio || 'Sin dirección'}</span>
              </div>
              <div class="geo-alert-item-actions">
                <button class="geo-alert-btn" onclick={() => { abrirEditarDireccionFactura(factura.id); showGeoAlert = false; }}>✏️ Corregir</button>
                <button class="geo-alert-btn geo-alert-btn-omit" onclick={() => { if (factura.cliente_id) quitarClienteDeGrupo(grupoActivo.id, factura.cliente_id); }}>⏭ Omitir</button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
    {/if}

    {#if modoProgramar && grupoActivo}
    <div class="floating-trip-card">
      <div class="ftc-header">
        <span>🚗 {grupoActivo.nombre}</span>
      </div>
      {#if clientesEnActivo.length > 0}
        <div class="ftc-actions">
          <button class="ftc-ruta-btn" onclick={() => trazarRutaGrupo(grupoActivo.id)}>🗺️ Trazar ruta</button>
          <button class="ftc-cancel-btn" onclick={limpiarRuta} disabled={!hayRutaActiva}>✕ Cancelar ruta</button>
        </div>
        <div class="ftc-clientes">
          {#each clientesEnActivo as cliente (cliente.id)}
            {@const sinGeo = facturasDelDia.some(f => f.cliente_id === cliente.id && (!f.lat || !f.lng))}
            <div class="ftc-cliente" class:ftc-sin-geo={sinGeo}>
              <span class="ftc-cliente-num">{clientesEnActivo.indexOf(cliente) + 1}.</span>
              <div class="ftc-cliente-info">
                <span class="ftc-cliente-nombre">{cliente.nombre}</span>
                <span class="ftc-cliente-dir">{cliente.domicilio}{sinGeo ? ' ⚠️' : ''}</span>
              </div>
              <button class="ftc-cliente-remove" onclick={() => quitarClienteDeGrupo(grupoActivo.id, cliente.id)} title="Quitar del viaje">✕</button>
            </div>
          {/each}
        </div>
        {#if rutaCercanos.length > 0}
          <div class="ftc-cercanos">
            <div class="ftc-cercanos-header">📍 {rutaCercanos.length} cliente(s) cerca de esta ruta</div>
            {#each rutaCercanos as factura (factura.id)}
              <div class="ftc-cercano">
                <div class="ftc-cercano-info">
                  <span class="ftc-cercano-nombre">{factura.cliente_nombre}</span>
                  <span class="ftc-cercano-dir">{factura.cliente_domicilio}</span>
                </div>
                <button class="ftc-cercano-add" onclick={() => { moverClienteAGrupo(factura.cliente_id, grupoActivo.id); rutaCercanos = rutaCercanos.filter(f => f.id !== factura.id); }}>+</button>
              </div>
            {/each}
          </div>
        {/if}
      {:else}
        <p class="ftc-vacio">Sin clientes en este viaje</p>
      {/if}
    </div>
    {/if}
  </div>
    </div>

{#if !modoProgramar}
<PanelProgramarViajes
  {grupos}
  {grupoActivoId}
  {todosLosClientes}
  clientesDelDia={clientesConEntregas}
  {fecha}
  {modoProgramar}
  onclose={() => { modoProgramar = false; renderizarMarcadores(); }}
  oncreategrupo={crearGrupo}
  ondeletergrupo={eliminarGrupo}
  onsetactivo={(id: string | null) => { grupoActivoId = id; renderizarMarcadores(); }}
  onsave={guardarPlan}
  onremovecliente={quitarClienteDeGrupo}
  onreorder={reordenarGrupo}
  onrename={renombrarGrupo}
/>
{/if}

{#if menuContextual}
  <div
    class="context-menu"
    style="left:{menuContextual.x}px;top:{menuContextual.y}px;"
    onclick={(e) => e.stopPropagation()}
    role="menu"
  >
    {#if modoProgramar}
      {@const factura = facturaMap.get(menuContextual.id)}
      {@const clienteId = factura?.cliente_id}
      {#if clienteId}
        {@const grupoCliente = grupoDelCliente(clienteId)}
        {@const grupoActivo = grupoActivoId ? grupos.get(grupoActivoId) : null}
        {#if grupoCliente}
          <button class="context-item" onclick={() => { const cid = facturaMap.get(menuContextual.id)?.cliente_id; menuContextual = null; if (cid) quitarClienteDeGrupo(grupoCliente.id, cid); }}>
            ❌ Quitar de {grupoCliente.nombre}
          </button>
          {#each [...grupos.values()] as g}
            {#if g.id !== grupoCliente.id}
              <button class="context-item" onclick={() => { const cid = facturaMap.get(menuContextual.id)?.cliente_id; menuContextual = null; if (cid) moverClienteAGrupo(cid, g.id); }}>
                ➡️ Mover a {g.nombre}
              </button>
            {/if}
          {/each}
        {:else if grupoActivoId}
          <button class="context-item" onclick={() => { const cid = facturaMap.get(menuContextual.id)?.cliente_id; menuContextual = null; if (cid) toggleClienteEnGrupo(cid); }}>
            ➕ Agregar a {grupoActivo?.nombre ?? 'grupo activo'}
          </button>
        {:else}
          <button class="context-item" disabled style="color:var(--text-muted);cursor:default;">
            ⚠️ Seleccioná un grupo primero
          </button>
        {/if}
      {/if}
      <hr class="context-menu-sep">
    {:else}
      {#if seleccionados.has(menuContextual.id)}
        <button class="context-item" onclick={() => { quitarDeRuta(menuContextual.id); }}>
          ❌ Quitar de ruta
        </button>
        <button class="context-item" onclick={() => { const id = menuContextual.id; menuContextual = null; empezarEdicionOrden(id); }}>
          🔢 Asignar orden
        </button>
      {:else}
        {#if facturaMap.has(menuContextual.id)}
          <button class="context-item" onclick={() => { toggleSeleccionFactura(menuContextual.id); menuContextual = null; }}>
            ➕ Agregar a ruta
          </button>
        {/if}
      {/if}
      <hr class="context-menu-sep">
    {/if}
    {#if facturaMap.has(menuContextual.id)}
      <button class="context-item" onclick={() => { const id = menuContextual.id; menuContextual = null; openEditClienteModal(id); }}>
        ✏️ Editar cliente
      </button>
      <button class="context-item" onclick={() => { const id = menuContextual.id; menuContextual = null; geocodificarFacturaEnMapa(id); }}>
        📍 Geocodificar factura
      </button>
    {:else}
      <button class="context-item" onclick={() => { const id = menuContextual.id; menuContextual = null; geocodificarClienteEnMapa(id); }}>
        📍 Geocodificar cliente
      </button>
    {/if}
  </div>
  <div class="context-overlay" onclick={cerrarMenuContextual} oncontextmenu={(e) => { e.preventDefault(); cerrarMenuContextual(); }}></div>
{/if}

<!-- Modal editar dirección de factura -->
{#if showEditDireccionModal}
  <div class="overlay" onclick={() => { showEditDireccionModal = false; editDireccionFactura = null; if (volverAGeoTrasEditar) { showGeoModal = true; volverAGeoTrasEditar = false; } }} role="dialog">
    <div class="modal edit-dir-modal" onclick={(e) => e.stopPropagation()}>
      <h3>✏️ Corregir dirección</h3>
      <p class="edit-dir-sub">
        Factura {editDireccionFactura?.numero_factura} — {editDireccionFactura?.cliente_nombre}
      </p>

      {#if editDireccionFactura?.geocode_error}
        <p class="edit-dir-error">⚠️ {editDireccionFactura.geocode_error}</p>
      {/if}

      <label for="edit-dir-input" class="edit-dir-label">Dirección</label>
      <AddressAutocomplete
        value={editDireccionValor}
        placeholder="Ej: Av. Corrientes 1234, CABA"
        onchange={(v: string) => { editDireccionValor = v; editDireccionPreviewCoords = null; editDireccionPreviewError = ''; }}
        onselect={(data: { label: string; lat: number; lng: number }) => {
          editDireccionValor = data.label;
          editDireccionPreviewCoords = { lat: data.lat, lng: data.lng };
          editDireccionPreviewError = '';
        }}
      />

      {#if editDireccionValor.trim() && editDireccionLimpia() !== editDireccionValor.trim()}
        <div class="edit-dir-limpia">
          <span class="edit-dir-limpia-label">🔍 Sin ruido:</span>
          <span class="edit-dir-limpia-val">{editDireccionLimpia()}</span>
          <p class="edit-dir-limpia-note">Se eliminan: piso, depto, oficina, local, torre, etc.</p>
        </div>
      {/if}

      <div class="edit-dir-actions-row">
        <button class="btn-test-geo" onclick={probarGeocodificacion} disabled={editDireccionPreviewCargando || !editDireccionValor.trim()}>
          {editDireccionPreviewCargando ? '⏳ Probando...' : '🔎 Probar geocodificación'}
        </button>
      </div>

      {#if editDireccionPreviewCoords}
        <p class="edit-dir-ok">✅ Encontrado: {editDireccionPreviewCoords.lat.toFixed(5)}, {editDireccionPreviewCoords.lng.toFixed(5)}</p>
      {:else if editDireccionPreviewError}
        <p class="edit-dir-error">{editDireccionPreviewError}</p>
      {/if}

      <div class="edit-dir-footer">
        <button class="btn-secondary" onclick={() => { showEditDireccionModal = false; editDireccionFactura = null; if (volverAGeoTrasEditar) { showGeoModal = true; volverAGeoTrasEditar = false; } }}>Cancelar</button>
        <button class="btn-ghost" onclick={() => irAFacturacion(editDireccionFactura?.id)}>
          ✏️ Editar en facturación
        </button>
        <button class="btn-primary" onclick={guardarEditarDireccion} disabled={editDireccionGuardando || !editDireccionValor.trim()}>
          {editDireccionGuardando ? 'Guardando...' : '💾 Guardar y geocodificar'}
        </button>
      </div>
    </div>
  </div>
{/if}

<RecomendacionRutasModal
  show={showRecomendarModal}
  clientes={todosLosClientes}
  onclose={() => showRecomendarModal = false}
  onseleccionar={onRecomendacionSeleccionar}
/>

<EditClienteModal
  show={showEditClienteModal}
  cliente={editClienteData}
  onclose={closeEditClienteModal}
  onsaved={onClienteSaved}
/>

{#if showGeoModal}
<div class="overlay" onclick={cerrarGeoModal} role="dialog">
  <div class="modal geo-modal" onclick={(e) => e.stopPropagation()}>
    <h3>⚠️ Direcciones sin geocodificar</h3>
    <p class="geo-modal-desc">Hay {facturasSinGeocodificarTotal.length} factura(s) sin geocodificar. Corregilas u omitilas para continuar.</p>
    <div class="geo-modal-list">
      {#each facturasSinGeocodificarTotal as factura (factura.id)}
        <div class="geo-modal-item">
          <div class="geo-modal-item-info">
            <strong>{factura.cliente_nombre}</strong>
            <span>{factura.cliente_domicilio || 'Sin dirección'}</span>
          </div>
          <div class="geo-modal-item-actions">
            <button class="geo-alert-btn" onclick={() => { volverAGeoTrasEditar = true; showGeoModal = false; abrirEditarDireccionFactura(factura.id); }}>
              ✏️ Corregir
            </button>
            <button class="geo-alert-btn geo-alert-btn-omit" onclick={() => omitirDeProgramar(factura.id)}>
              ⏭ Omitir
            </button>
          </div>
        </div>
      {/each}
    </div>
    <div class="geo-modal-footer">
      <button class="btn-secondary" onclick={cerrarGeoModal}>❌ Cancelar</button>
      <button class="geo-alert-btn geo-alert-btn-omit" onclick={omitirTodasGeos}>⏭ Omitir todo</button>
      <button class="btn-primary" onclick={irAProgramar} disabled={facturasDelDia.some(f => seleccionados.has(f.id) && (!f.lat || !f.lng) && !esRetira(f))}>
        ✅ Continuar
      </button>
    </div>
  </div>
</div>
{/if}

<style>
  :global(.cliente-tooltip) {
    font-size: 12px;
    line-height: 1.4;
  }
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
    width: 300px;
    min-width: 260px;
    background: var(--bg-card);
    border-right: 1px solid var(--border);
    padding: 1rem;
    display: flex;
    flex-direction: column;
    z-index: 10;
    overflow: hidden;
  }

  .panel-header {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--border);
  }

  .panel-scroll {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-top: 0.75rem;
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

  .info-text { font-size: 13px; color: var(--text-secondary); }
  .grupo-label { font-size: 12px; font-weight: 600; color: var(--text-primary); margin-top: 8px; margin-bottom: 4px; }

  .geo-progress {
    font-size: 11px;
    color: #2563eb;
    font-weight: 500;
    background: #eff6ff;
    padding: 4px 8px;
    border-radius: 6px;
    text-align: center;
  }

  .lista-facturas {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .factura-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 8px;
    cursor: pointer;
    border: 1px solid #e5e7eb;
    transition: background 0.15s;
  }
  .factura-item:hover { background: #f9fafb; }
  .factura-item.seleccionado {
    background: #fffbeb;
    border-color: #f59e0b;
  }

  .factura-geo {
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
  .geo-error { background: #fef3c7; color: #d97706; }

  .factura-num {
    font-size: 12px;
    font-weight: 600;
    color: #2563eb;
  }
  .factura-cliente {
    font-size: 13px;
    font-weight: 500;
    color: #111;
  }
  .factura-dir {
    font-size: 11px;
    color: #9ca3af;
  }
  .factura-info {
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
  .total-badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    color: #059669;
    background: #ecfdf5;
    border: 1px solid #a7f3d0;
    line-height: 1.5;
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
  .orden-badge:hover { transform: scale(1.15); }

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
  .orden-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }

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
  .btn-primary {
    padding: 0.571rem 1.286rem; background: var(--accent); color: white; border: none;
    border-radius: 0.429rem; cursor: pointer; font-size: 0.929rem; font-weight: 500;
  }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary {
    padding: 0.571rem 1.286rem; background: var(--bg-hover); color: var(--text-secondary); border: none;
    border-radius: 0.429rem; cursor: pointer; font-size: 0.929rem;
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

  .btn-group { display: flex; gap: 6px; width: 100%; }
  .flex-1 { flex: 1; min-width: 0; }

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

  .error-text { font-size: 12px; color: #ef4444; margin: 0; }

  .mapa-container-wrap {
    flex: 1;
    position: relative;
    z-index: 1;
  }

  .mapa-container {
    width: 100%;
    height: 100%;
    position: absolute;
    inset: 0;
  }

  .btn-programar-flotante {
    position: absolute;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
    padding: 14px 36px;
    background: #2563eb;
    color: white;
    border: none;
    border-radius: 14px;
    font-size: 17px;
    font-weight: 700;
    font-family: var(--font);
    cursor: pointer;
    box-shadow: 0 6px 24px rgba(37,99,235,0.4);
    transition: all 0.2s;
    white-space: nowrap;
  }
  .btn-programar-flotante:hover {
    background: #1d4ed8;
    box-shadow: 0 8px 28px rgba(37,99,235,0.5);
    transform: translateX(-50%) translateY(-2px);
  }
  .btn-programar-flotante.activo {
    background: #059669;
    box-shadow: 0 6px 24px rgba(5,150,105,0.4);
  }
  .btn-programar-flotante.activo:hover {
    background: #047857;
    box-shadow: 0 8px 28px rgba(5,150,105,0.5);
  }

  .route-bar {
    flex-shrink: 0;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }
  .route-bar .btn-group {
    justify-content: center;
  }

  .grupo-ruta-btn {
    padding: 2px 6px;
    font-size: 13px;
    border: none;
    background: none;
    cursor: pointer;
    color: var(--text-tertiary);
    border-radius: 4px;
    transition: all 0.15s;
    line-height: 1;
  }
  .grupo-ruta-btn:hover {
    background: #eff6ff;
    color: #2563eb;
  }

  .geo-alert {
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 500;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    min-width: 320px;
    max-width: 400px;
    max-height: 50vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .geo-alert-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 16px;
    background: #fffbeb;
    border-bottom: 1px solid #fde68a;
    font-size: 13px;
    font-weight: 600;
    color: #92400e;
    cursor: pointer;
    user-select: none;
  }
  .geo-alert-header:hover { background: #fef3c7; }
  .geo-alert-chevron { font-size: 10px; color: #d97706; }
  .geo-alert-body {
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .geo-alert-item {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border-radius: 8px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
  }
  .geo-alert-item-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
  }
  .geo-alert-item-info strong { font-size: 13px; color: #111; }
  .geo-alert-item-info span { color: #6b7280; }
  .geo-alert-item-actions {
    display: flex;
    gap: 4px;
  }
  .geo-alert-btn {
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 500;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: #fff;
    cursor: pointer;
    font-family: var(--font);
    color: #374151;
    transition: all 0.12s;
  }
  .geo-alert-btn:hover { background: #f3f4f6; border-color: #9ca3af; }
  .geo-alert-btn-omit { color: #dc2626; border-color: #fecaca; }
  .geo-alert-btn-omit:hover { background: #fef2f2; border-color: #fca5a5; }

  .floating-trip-card {
    position: absolute;
    bottom: 80px;
    right: 16px;
    z-index: 500;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    width: 320px;
    max-height: 45vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .ftc-header {
    display: flex;
    align-items: center;
    padding: 12px 16px;
    font-size: 14px;
    font-weight: 600;
    color: #111;
    border-bottom: 1px solid #e5e7eb;
  }
  .ftc-ruta-btn {
    margin: 10px 16px;
    padding: 8px 16px;
    background: #2563eb;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    font-family: var(--font);
    cursor: pointer;
    transition: background 0.15s;
  }
  .ftc-ruta-btn:hover { background: #1d4ed8; }
  .ftc-clientes {
    overflow-y: auto;
    padding: 0 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .ftc-cliente {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    border-radius: 6px;
    background: #f9fafb;
    border: 1px solid #e5e7eb;
  }
  .ftc-cliente.ftc-sin-geo {
    background: #fffbeb;
    border-color: #fde68a;
  }
  .ftc-cliente-num {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #d1d5db;
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .ftc-sin-geo .ftc-cliente-num { background: #f59e0b; }
  .ftc-cliente-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .ftc-cliente-nombre {
    font-size: 12px;
    font-weight: 500;
    color: #111;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ftc-cliente-dir {
    font-size: 11px;
    color: #6b7280;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ftc-cliente-remove {
    padding: 2px 5px;
    font-size: 11px;
    border: none;
    background: none;
    cursor: pointer;
    color: #9ca3af;
    border-radius: 4px;
    flex-shrink: 0;
    line-height: 1;
  }
  .ftc-cliente-remove:hover { color: #dc2626; background: #fef2f2; }
  .ftc-vacio {
    padding: 16px;
    text-align: center;
    font-size: 12px;
    color: #9ca3af;
  }

  .ftc-actions {
    display: flex;
    gap: 6px;
    padding: 10px 16px;
  }
  .ftc-actions .ftc-ruta-btn {
    flex: 1;
    margin: 0;
  }
  .ftc-cancel-btn {
    padding: 8px 12px;
    background: #fef2f2;
    color: #dc2626;
    border: 1px solid #fecaca;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    font-family: var(--font);
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
  }
  .ftc-cancel-btn:hover { background: #fee2e2; border-color: #fca5a5; }
  .ftc-cancel-btn:disabled { opacity: 0.4; cursor: not-allowed; background: #f9fafb; color: #9ca3af; border-color: #e5e7eb; }
  .ftc-cancel-btn:disabled:hover { background: #f9fafb; border-color: #e5e7eb; }

  .ftc-cercanos { border-top: 1px solid #e5e7eb; margin-top: 10px; padding-top: 10px; }
  .ftc-cercanos-header { font-size: 12px; font-weight: 600; color: #2563eb; margin-bottom: 8px; }
  .ftc-cercano { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
  .ftc-cercano-info { flex: 1; min-width: 0; }
  .ftc-cercano-nombre { font-size: 12px; font-weight: 600; color: var(--text-primary); display: block; }
  .ftc-cercano-dir { font-size: 11px; color: var(--text-tertiary); display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ftc-cercano-add { width: 24px; height: 24px; border: none; border-radius: 50%; background: #2563eb; color: white; font-size: 14px; font-weight: 700; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: background 0.12s; }
  .ftc-cercano-add:hover { background: #1d4ed8; }

  .geo-modal { width: 480px; max-width: 92vw; max-height: 70vh; display: flex; flex-direction: column; }
  .geo-modal h3 { margin: 0 0 4px; }
  .geo-modal-desc { font-size: 13px; color: var(--text-secondary); margin-bottom: 16px; }
  .geo-modal-list {
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    margin-bottom: 16px;
  }
  .geo-modal-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 8px;
    background: #fffbeb;
    border: 1px solid #fde68a;
  }
  .geo-modal-item-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
    min-width: 0;
    flex: 1;
  }
  .geo-modal-item-info strong { font-size: 13px; color: #111; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .geo-modal-item-info span { color: #6b7280; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .geo-modal-item-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
  .geo-modal-footer {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-top: 12px;
    border-top: 1px solid var(--border);
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
    .mapa-container-wrap {
      flex: 1;
      min-height: 60vh;
    }
    .mapa-container {
      min-height: 60vh;
    }
  }

  .context-menu-sep { border: none; border-top: 1px solid #e5e7eb; margin: 4px 0; }
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
  .context-item:hover { background: var(--bg-hover); }

  /* ── Edit direction modal ── */
  .edit-dir-modal { width: 460px; max-width: 92vw; }
  .edit-dir-sub { font-size: 13px; color: var(--text-secondary); margin-bottom: 12px; }
  .edit-dir-label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--text-primary); }
  .edit-dir-error { font-size: 12px; color: #dc2626; background: #fef2f2; padding: 8px; border-radius: 6px; margin-bottom: 12px; }
  .edit-dir-ok { font-size: 12px; color: #059669; background: #ecfdf5; padding: 8px; border-radius: 6px; margin-bottom: 8px; }
  .edit-dir-limpia { margin-top: 8px; margin-bottom: 8px; padding: 8px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; }
  .edit-dir-limpia-label { font-size: 12px; font-weight: 600; color: #92400e; }
  .edit-dir-limpia-val { font-size: 12px; color: #92400e; font-weight: 500; margin-left: 4px; }
  .edit-dir-limpia-note { font-size: 11px; color: #a16207; margin-top: 4px; }
  .edit-dir-actions-row { margin-top: 8px; margin-bottom: 8px; }
  .btn-test-geo { padding: 6px 14px; font-size: 12px; font-weight: 500; border: 1px solid #d1d5db; border-radius: 6px; background: var(--bg-card); cursor: pointer; font-family: var(--font); color: var(--text-primary); }
  .btn-test-geo:hover { background: var(--bg-hover); }
  .btn-test-geo:disabled { opacity: 0.5; cursor: not-allowed; }
  .edit-dir-footer { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border); }
  .btn-ghost { padding: 0.571rem 1rem; background: transparent; border: 1px solid #d1d5db; border-radius: 6px; cursor: pointer; font-size: 13px; font-family: var(--font); color: var(--text-secondary); }
  .btn-ghost:hover { background: var(--bg-hover); color: var(--text-primary); }

  /* ── Factura actions in sidebar ── */
  .factura-actions { display: flex; gap: 4px; margin-top: 6px; }
  .btn-geo-suggest, .btn-edit-factura { padding: 3px 8px; font-size: 11px; border: 1px solid #d1d5db; border-radius: 5px; background: var(--bg-card); cursor: pointer; font-family: var(--font); color: var(--text-secondary); }
  .btn-geo-suggest:hover, .btn-edit-factura:hover { background: var(--bg-hover); color: var(--text-primary); }
  .btn-geo-suggest { border-color: #fde68a; color: #92400e; }
  .btn-geo-suggest:hover { background: #fffbeb; }
  .btn-edit-factura { border-color: #bfdbfe; color: #1e40af; }
  .btn-edit-factura:hover { background: #eff6ff; }

  /* ── Planning mode UI ── */
  .plan-header { padding: 0 0 12px 0; }
  .plan-header h3 { font-size: 15px; font-weight: 700; margin: 0 0 8px 0; display: flex; align-items: center; gap: 8px; }
  .plan-exit { font-size: 11px; padding: 2px 8px; margin-left: auto; }
  .plan-btns { display: flex; gap: 6px; }
  .btn-guardar, .btn-enviar { flex: 1; padding: 8px 12px; font-size: 13px; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; font-family: var(--font); }
  .btn-guardar { background: #059669; color: white; }
  .btn-guardar:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-enviar { background: #3b82f6; color: white; }
  .grupos-section { margin-bottom: 16px; }
  .grupos-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; font-size: 13px; font-weight: 600; color: var(--text-secondary); }
  .grupos-actions { display: flex; gap: 4px; }
  .btn-sm { padding: 4px 10px; font-size: 12px; border: 1px solid #d1d5db; border-radius: 5px; background: var(--bg-card); cursor: pointer; font-family: var(--font); color: var(--text-primary); }
  .btn-sm:hover { background: var(--bg-hover); }
  .grupo-card { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 6px; cursor: pointer; margin-bottom: 4px; background: var(--bg-card); border: 1.5px solid transparent; transition: border-color 0.15s; }
  .grupo-card:hover { border-color: #d1d5db; }
  .grupo-card.activo { border-color: #3b82f6; background: #eff6ff; }
  .grupo-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
  .grupo-nombre { flex: 1; font-size: 13px; font-weight: 500; }
  .grupo-count { font-size: 11px; color: var(--text-secondary); background: var(--bg-hover); padding: 2px 8px; border-radius: 10px; }
  .grupo-del { padding: 2px 6px; font-size: 12px; border: none; background: none; cursor: pointer; color: var(--text-tertiary); border-radius: 4px; }
  .grupo-del:hover { color: #dc2626; background: #fef2f2; }
  .grupo-detalle { margin-bottom: 16px; padding: 12px; background: var(--bg-card); border-radius: 8px; border: 1px solid var(--border); }
  .grupo-detalle h4 { font-size: 14px; font-weight: 600; margin: 0 0 8px 0; }
  .cliente-orden-item { display: flex; align-items: center; gap: 6px; padding: 6px 8px; border-radius: 5px; margin-bottom: 3px; background: var(--bg); border: 1px solid var(--border); }
  .orden-num { width: 20px; height: 20px; border-radius: 50%; background: #3b82f6; color: white; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .cliente-nombre { flex: 1; font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cliente-dir { font-size: 11px; color: var(--text-secondary); flex: 0 0 auto; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cliente-facts { font-size: 10px; color: var(--text-tertiary); background: var(--bg-hover); padding: 2px 6px; border-radius: 8px; flex-shrink: 0; }
  .cliente-remove { padding: 2px 6px; font-size: 12px; border: none; background: none; cursor: pointer; color: var(--text-tertiary); border-radius: 4px; flex-shrink: 0; }
  .cliente-remove:hover { color: #dc2626; background: #fef2f2; }
</style>

