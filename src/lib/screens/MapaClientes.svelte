<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api } from '$lib/api/client';
  import { open as shellOpen } from '@tauri-apps/plugin-shell';
  import { appStore } from '$lib/stores/appStore.svelte';
  import { mapaStore } from '$lib/stores/mapaStore.svelte';
  import { cacheStore } from '$lib/stores/cacheStore.svelte';
  import RecomendacionRutasModal from '$lib/components/RecomendacionRutasModal.svelte';
  import EditClienteModal from '$lib/components/EditClienteModal.svelte';
  import AddressAutocomplete from '$lib/components/AddressAutocomplete.svelte';
  import { nominatimSearchUrl, limpiarDireccion } from '$lib/utils/geocoding';
  import { facturasActivas } from '$lib/utils/facturas';
  import { decodePolyline, findCercanosRuta, haversine } from '$lib/utils/geo';
  import { recomendarRutas, type ClienteParaAgrupar } from '$lib/utils/barrios';
  import type { RecomendacionCliente } from '$lib/types';

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

  const ESTILOS_MAPA = [
    { id: 'positron', label: 'Positron', light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' },
    { id: 'voyager', label: 'Voyager', light: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', dark: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png' },
    { id: 'dark', label: 'Dark Matter', light: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png' },
    { id: 'esri-street', label: 'Esri Street', light: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', dark: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}' },
    { id: 'osm', label: 'OSM', light: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', dark: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' },
  ];
  function estiloDe(id: string) {
    return ESTILOS_MAPA.find(e => e.id === id) || ESTILOS_MAPA[0];
  }
  function temaActual() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }
  function URL_TILES(estiloId: string, tema: string) {
    const e = estiloDe(estiloId);
    return e ? (tema === 'dark' ? e.dark : e.light) : ESTILOS_MAPA[0].light;
  }
  function ATTRIBUCION(estiloId: string) {
    const esEsri = estiloId === 'esri-street';
    return esEsri
      ? '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> &copy; <a href="https://www.esri.com/">Esri</a>'
      : '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';
  }
  let temaMapa = $state(temaActual());
  let tileLayerActual: any = null;
  let observerTema: MutationObserver | null = null;
  let estiloMapa = $state(mapaStore.estiloMapa);
  let mostrarSelectorEstilo = $state(false);

  let todosLosClientes: any[] = $state([]);
  let facturasDelDia: any[] = $state([]);
  let seleccionados = $state(new Set<number>());
  let ordenRuta: number[] = $state([]);

  let modoProgramar = $state(true);
  let grupos = $state<Map<string, any>>(mapaStore.grupos);
  let grupoActivoId = $state<string | null>(mapaStore.grupoActivoId);
  let planViajeId = $state<string | null>(mapaStore.planViajeId);
  let guardandoPlan = $state(false);

  let recomendaciones = $state<RecomendacionCliente[]>(mapaStore.recomendaciones);
  let recomendando = $state(mapaStore.recomendando);
  let mostrarRecomendados = $state(mapaStore.mostrarRecomendados);
  let clientesRecomendables = $state<any[]>([]);
  let recomendacionListo = $state(false);
  let recomendacionTimer: ReturnType<typeof setTimeout> | undefined;

  const CONSOLA_COLORS = ['#ef4444', '#8b5cf6', '#0ea5e9', '#f59e0b', '#10b981', '#ec4899'];
  let colorIdx = $state(0);

  let fecha = $state(mapaStore.fecha);
  let errorText = $state('');
  let busqueda = $state(mapaStore.busqueda);

  let marcadores: Record<string, any> = {};
  let marcadorPorFactura: Record<number, any> = {};
  let marcadoresClientes: Record<string, any> = {};
  let marcadorOrigen: any = null;
  let marcadorBusqueda: any = null;
  let rutaLinea: any = null;
  let infoRuta = $state('');
  let calculandoRuta = $state(false);
  let tiempoEstimado = $state('');
  let calculandoTiempo = $state(false);
  let ultimoTiempoKey = '';
  let tiempoRequestSeq = 0;
  let tiempoTimer: ReturnType<typeof setTimeout> | undefined;

  let origenDireccion = $state(mapaStore.origenDireccion);
  let origenCoords: { lat: number; lng: number } | null = $state(mapaStore.origenCoords);
  let editandoOrigen = $state(mapaStore.editandoOrigen);
  let geocodificandoOrigen = $state(mapaStore.geocodificandoOrigen);
  let menuContextual: { x: number; y: number; id: number; tipo: 'factura' | 'cliente' } | null = $state(null);
  let showConfigAgrupamiento = $state(false);
  let renombrandoId = $state<string | null>(null);
  let renombrarValue = $state('');
  let showGeoAlert = $state(false);
  let geoAlertReadOculto = $state(mapaStore.geoAlertReadOculto);
  let geoAlertReadColapsado = $state(mapaStore.geoAlertReadColapsado);
  let showGeoModal = $state(false);
  let volverAGeoTrasEditar = $state(false);
  let hayRutaActiva = $state(false);
  let mostrarLeyenda = $state(true);
  let mostrarFiltros = $state(false);
  let showEditClienteModal = $state(false);
  let editClienteData: any = $state(null);
  let geocodificandoFacturaId: number | null = $state(null);

  let facturaMap = $derived.by(() => {
    const m = new Map<number, any>();
    for (const f of facturasDelDia) m.set(f.id, f);
    return m;
  });

  let clientesIdsConFactura = $derived.by(() => {
    return new Set(facturasDelDia.map(f => f.cliente_id).filter(Boolean));
  });

  const recomendacionPorCliente = $derived.by(() => {
    const m = new Map<number, RecomendacionCliente>();
    for (const r of recomendaciones) m.set(r.cliente_id, r);
    return m;
  });
  const idsRecomendados = $derived(new Set(recomendacionPorCliente.keys()));
  const recomendacionesPorGrupo = $derived.by(() => {
    const m = new Map<string, RecomendacionCliente[]>();
    for (const r of recomendaciones) {
      if (!m.has(r.grupo_id)) m.set(r.grupo_id, []);
      m.get(r.grupo_id)!.push(r);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.distancia_km - b.distancia_km);
    return m;
  });

  const firmaViajes = $derived.by(() => {
    const g = [...grupos.values()].map(x => `${x.id}:${(x.clienteIds || []).join(',')}`).join('|');
    const f = facturasDelDia.map(x => x.id).join(',');
    return `${fecha}|${g}|${f}`;
  });

  const facturasFiltradas = $derived.by(() => {
    let base = facturasDelDia;
    if (mapaStore.filtroKanban.length > 0) {
      base = base.filter(f =>
        mapaStore.filtroKanban.some(e => {
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

  function grupoDelCliente(clienteId: number): any | null {
    for (const g of grupos.values()) {
      if (g.clienteIds.includes(clienteId)) return g;
    }
    return null;
  }

  const grupoArray = $derived([...grupos.values()]);

  function calcularIniciales(items: Array<{ id: string; nombre?: string }>): Map<string, string> {
    const m = new Map<string, string>();
    for (let i = 0; i < items.length; i++) {
      const g = items[i];
      const nombre = (g.nombre || '').trim();
      if (!nombre) { m.set(g.id, String(i + 1)); continue; }
      let badge = '';
      for (let len = 1; len <= nombre.length; len++) {
        const prefix = nombre.slice(0, len).toLowerCase();
        const choca = items.some((o, oi) => {
          if (oi === i) return false;
          return (o.nombre || '').trim().toLowerCase().startsWith(prefix);
        });
        if (!choca) { badge = nombre.slice(0, len); break; }
      }
      if (!badge || badge.length > 3) badge = String(i + 1);
      m.set(g.id, badge);
    }
    return m;
  }

  const inicialesGrupo = $derived(calcularIniciales(grupoArray));

  const grupoActivo = $derived(
    grupoActivoId ? grupos.get(grupoActivoId) ?? null : null
  );

  function idsOrdenadosDe(g: any): number[] {
    const visto = new Set<number>();
    const out: number[] = [];
    for (const id of g.ordenRuta || []) {
      if (!visto.has(id)) { visto.add(id); out.push(id); }
    }
    for (const id of g.clienteIds || []) {
      if (!visto.has(id)) { visto.add(id); out.push(id); }
    }
    return out;
  }

  function infoCliente(id: number): any {
    const f = facturasDelDia.find((ff: any) => ff.cliente_id === id);
    if (f) return { id: f.cliente_id, nombre: f.cliente_nombre, domicilio: f.cliente_domicilio || '', facturaId: f.id };
    return null;
  }

  const clientesEnActivo = $derived.by(() => {
    if (!grupoActivo) return [];
    return idsOrdenadosDe(grupoActivo)
      .map((id: number) => {
        const base = infoCliente(id);
        if (!base) return null;
        return {
          ...base,
          facturas: facturasDelDia.filter((ff: any) => ff.cliente_id === id),
        };
      })
      .filter(Boolean);
  });

  const clientesPorGrupo = $derived.by(() => {
    const m = new Map<string, any[]>();
    for (const g of grupos.values()) {
      m.set(g.id, idsOrdenadosDe(g)
        .map((id: number) => infoCliente(id))
        .filter(Boolean));
    }
    return m;
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

  const gruposBajoMinimo = $derived(
    mapaStore.algoMinPorGrupo > 0
      ? grupoArray.filter(g => (clientesPorGrupo.get(g.id)?.length ?? (g.clienteIds?.length || 0)) < mapaStore.algoMinPorGrupo)
      : []
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
  $effect(() => { mapaStore.geoAlertReadOculto = geoAlertReadOculto; });
  $effect(() => { mapaStore.geoAlertReadColapsado = geoAlertReadColapsado; });
  $effect(() => { mapaStore.estiloMapa = estiloMapa; });

  $effect(() => { mapaStore.recomendaciones = recomendaciones; });
  $effect(() => { mapaStore.recomendando = recomendando; });
  $effect(() => { mapaStore.mostrarRecomendados = mostrarRecomendados; });

  $effect(() => {
    const _ = firmaViajes;
    if (!map || !L || !recomendacionListo || mapaStore.cargando) return;
    clearTimeout(recomendacionTimer);
    recomendacionTimer = setTimeout(() => {
      generarRecomendaciones();
    }, 900);
  });

  $effect(() => {
    const e = estiloMapa;
    if (!tileLayerActual) return;
    tileLayerActual.setUrl(URL_TILES(e, temaActual()));
    renderizarMarcadores();
  });

  $effect(() => {
    const g = grupoActivo;
    const ids = g?.ordenRuta ?? [];
    const origen = origenCoords;
    const key = `${g?.id ?? ''}|${ids.join(',')}|${origen ? `${origen.lat},${origen.lng}` : ''}`;
    if (key === ultimoTiempoKey) return;
    ultimoTiempoKey = key;
    if (!origen || ids.length === 0) {
      tiempoEstimado = '';
      calculandoTiempo = false;
      return;
    }
    calculandoTiempo = true;
    tiempoTimer = setTimeout(async () => {
      const seq = ++tiempoRequestSeq;
      const puntos: [number, number][] = [[origen.lng, origen.lat]];
      let contados = 0;
      for (const id of ids) {
        const f = facturasDelDia.find(ff => ff.cliente_id === id);
        if (f && f.lat && f.lng) {
          puntos.push([f.lng, f.lat]);
          contados++;
        }
      }
      puntos.push([origen.lng, origen.lat]);
      if (contados === 0 || seq !== tiempoRequestSeq) {
        if (seq === tiempoRequestSeq) {
          tiempoEstimado = '';
          calculandoTiempo = false;
        }
        return;
      }
      try {
        const res = await api.mapaRuta({ puntos });
        if (seq !== tiempoRequestSeq) return;
        const distKm = (res.distance / 1000).toFixed(1);
        const mins = Math.round(res.duration / 60);
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        tiempoEstimado = h > 0 ? `~${h}h ${m}m · ${distKm} km` : `~${m} min · ${distKm} km`;
      } catch {
        if (seq === tiempoRequestSeq) tiempoEstimado = '—';
      } finally {
        if (seq === tiempoRequestSeq) calculandoTiempo = false;
      }
    }, 700);
    return () => { clearTimeout(tiempoTimer); };
  });

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
    const _ = mapaStore.filtroKanban;
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

  const PIN_SCALE = 0.6;
  const PIN_W = 44 * PIN_SCALE;
  const PIN_H = 56 * PIN_SCALE;
  const PIN_PATH = 'M22 2C11.5 2 3 10.5 3 21c0 14 19 33 19 33s19-19 19-33C41 10.5 32.5 2 22 2z';
  const PIN_STATE_ICONS: Record<string, string> = {
    PEDIDO: `<circle cx="22" cy="21" r="6.5" fill="none" stroke="#111" stroke-width="2"/>
      <line x1="22" y1="21" x2="22" y2="16" stroke="#111" stroke-width="2" stroke-linecap="round"/>
      <line x1="22" y1="21" x2="25.8" y2="21" stroke="#111" stroke-width="2" stroke-linecap="round"/>`,
    EN_PROCESO: `<path d="M28.5 21a6.5 6.5 0 1 1-2.1-4.8" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M28.9 15.8 L28.5 19.2 L25.2 18.6 Z" fill="#111"/>`,
    LISTO: `<path d="M17 21.3 L20.2 24.6 L27 17" fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
    EN_ESPERA: `<path d="M17 21.3 L20.2 24.6 L27 17" fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`,
    DEFAULT: `<circle cx="22" cy="21" r="6.5" fill="none" stroke="#111" stroke-width="2"/>`,
  };

  function estadoMasUrgente(facturas: any[]): string {
    const prioridad: Record<string, number> = { PEDIDO: 0, EN_PROCESO: 1, LISTO: 2, EN_ESPERA: 2 };
    let mejor = 'PEDIDO';
    let mejorP = Infinity;
    for (const f of facturas) {
      const estado = f.estado_kanban || 'PEDIDO';
      const p = prioridad[estado] ?? 3;
      if (p < mejorP) { mejorP = p; mejor = estado; }
    }
    return mejor;
  }

  function crearPinEstado(color: string, estado: string, glow = false, hoverable = true) {
    const icon = PIN_STATE_ICONS[estado] || PIN_STATE_ICONS.DEFAULT;
    const shadow = glow
      ? `0 0 8px ${color}88, 0 2px 3px rgba(0,0,0,0.35)`
      : `0 2px 3px rgba(0,0,0,0.35)`;
    const cls = hoverable ? ' pin-estado' : '';
    const halo = temaMapa === 'dark'
      ? 'drop-shadow(0 0 2px rgba(255,255,255,0.95)) drop-shadow(0 0 5px rgba(255,255,255,0.7)) '
      : '';
    return L.divIcon({
      className: '',
      html: `<div class="pin-wrap${cls}" style="filter:${halo}drop-shadow(${shadow});">
        <svg width="${PIN_W.toFixed(2)}" height="${PIN_H.toFixed(2)}" viewBox="0 0 44 56" xmlns="http://www.w3.org/2000/svg">
          <path d="${PIN_PATH}" fill="${color}" stroke="#111" stroke-width="2.5"/>
          <circle cx="22" cy="21" r="9.5" fill="#fff" stroke="#111" stroke-width="2"/>
          ${icon}
        </svg>
      </div>`,
      iconSize: [PIN_W, PIN_H],
      iconAnchor: [PIN_W / 2, PIN_H - 2],
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
      html: `<div style="filter:drop-shadow(0 2px 3px rgba(0,0,0,0.4));">
        <svg width="22" height="20" viewBox="0 0 44 40" xmlns="http://www.w3.org/2000/svg">
          <path d="M22 3 L4 17 L6 17 L6 36 L38 36 L38 17 L40 17 Z" fill="#2563eb" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
          <rect x="20" y="24" width="5" height="12" rx="0.5" fill="#fff"/>
        </svg>
      </div>`,
      iconSize: [22, 20],
      iconAnchor: [11, 18],
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

  function crearIconoRecomendado() {
    return L.divIcon({
      className: '',
      html: `<div style="width:20px;height:20px;background:#14b8a6;border:2px solid white;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:white;box-shadow:0 0 10px #14b8a688, 0 1px 4px rgba(0,0,0,0.4);">★</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
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

    map = L.map(mapContainer).setView([-34.6037, -58.3816], 13);

    tileLayerActual = L.tileLayer(URL_TILES(estiloMapa, temaActual()), {
      attribution: ATTRIBUCION(estiloMapa),
      maxZoom: 20,
    }).addTo(map);

    observerTema = new MutationObserver(() => {
      const t = temaActual();
      if (t !== temaMapa) {
        temaMapa = t;
        tileLayerActual?.setUrl(URL_TILES(estiloMapa, t));
        renderizarMarcadores();
      }
    });
    observerTema.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

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
    await cargarConfig();
    await asegurarPlan();
    await cargarRecomendaciones();
    recomendacionListo = true;
    generarRecomendaciones();
  }

  function invalidarMapaBase() {
    cacheStore.invalidate('mapa-base');
  }

  async function cargarDashboard() {
    mapaStore.cargando = true;
    try {
      // Caché compartida con PanelControl (clientes + entregas). El `plan` no se
      // cachea acá: Mapa usa el plan de la fecha y PanelControl el permanente.
      // La clave incluye recencia porque el backend filtra clientes con ella.
      const base = await cacheStore.fetch(`mapa-base:${mapaStore.filtroRecencia}`, async () => {
        const data = await api.getMapaDashboard(fecha, false, mapaStore.filtroRecencia);
        return { clientes: data.clientes, entregas: data.entregas };
      }, 60000);
      todosLosClientes = base.clientes;
      facturasDelDia = facturasActivas(base.entregas);
      seleccionados = new Set();
      ordenRuta = [];
      renderizarMarcadores();
    } catch (e) {
      errorText = 'No se pudieron cargar los datos del mapa.';
    } finally {
      mapaStore.cargando = false;
    }
  }

  export async function recargarMapa() {
    invalidarMapaBase();
    await cargarDashboard();
    await cargarPlan();
    await asegurarPlan();
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
    marcadorPorFactura = {};
    marcadoresClientes = {};

    const idsFacturaSeleccionada = new Set(
      ordenRuta.filter(id => seleccionados.has(id))
    );

    // ── Capa 1: Clientes de fondo (solo en Todos) ──
    if (!mapaStore.filtroPendientes) for (const cliente of todosLosClientes) {
      if (idsRecomendados.has(cliente.id)) continue; // se dibujan en su capa propia

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
        marker.on('contextmenu', (e: any) => {
          L.DomEvent.preventDefault(e.originalEvent);
          mostrarMenuContextualCliente(e.originalEvent, cliente.id);
        });
      }

      marcadoresClientes[`c-${cliente.id}`] = marker;
    }

    // ── Capa 1b: Clientes recomendados (siempre visible, estrella teal) ──
    for (const rec of recomendaciones) {
      const cliente = clientesRecomendables.find((c: any) => c.id === rec.cliente_id)
        ?? todosLosClientes.find((c: any) => c.id === rec.cliente_id);
      if (!cliente) continue;

      const r = resolverCoordsCliente(cliente);
      if (!r) continue;

      const grupo = grupos.get(rec.grupo_id);
      const marker = L.marker([r.lat, r.lng], { icon: crearIconoRecomendado(), zIndexOffset: 150 })
        .addTo(map)
        .bindPopup(recomendadoPopupHtml(cliente, rec.distancia_km, grupo?.nombre || '', nombreClientePorId(rec.cerca_de_cliente_id)))
        .bindTooltip(
          `★ <strong>${cliente.nombre}</strong>${grupo?.nombre ? '<br>Recomendado para: ' + grupo.nombre : ''}`,
          { direction: 'top', offset: [0, -8], className: 'cliente-tooltip' }
        );

      marker.on('click', () => {
        if (!modoProgramar) centrarEnCliente(cliente.id);
      });

      marker.on('contextmenu', (e: any) => {
        L.DomEvent.preventDefault(e.originalEvent);
        mostrarMenuContextualCliente(e.originalEvent, cliente.id);
      });

      marcadoresClientes[`c-${cliente.id}`] = marker;
    }

    // ── Capa 2: Facturas (primaria) ──
    const facturasPorCoord = new Map<string, any[]>();
    for (const factura of facturasFiltradas) {
      const lat = factura.lat;
      const lng = factura.lng;
      if (!lat || !lng) continue;
      const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
      if (!facturasPorCoord.has(key)) facturasPorCoord.set(key, []);
      facturasPorCoord.get(key)!.push(factura);
    }

    for (const [coordKey, facturas] of facturasPorCoord) {
      const [lat, lng] = coordKey.split(',').map(Number);
      const primary = facturas[0];
      const seleccionadasEnCoord = facturas.filter(f => seleccionados.has(f.id));
      const estaSeleccionada = seleccionadasEnCoord.length > 0;
      const ordenIdx = estaSeleccionada
        ? Math.min(...seleccionadasEnCoord.map(f => ordenRuta.indexOf(f.id)).filter(i => i >= 0))
        : -1;
      const grupo = primary.cliente_id ? grupoDelCliente(primary.cliente_id) : null;

      let icon;
      if (estaSeleccionada && ordenIdx >= 0) {
        icon = crearIconoSeleccionado(ordenIdx + 1);
      } else {
        const color = grupo?.color || '#9ca3af';
        const estado = estadoMasUrgente(facturas);
        const noEntregado = estado !== 'ENTREGADO' && estado !== 'ARCHIVADO';
        icon = crearPinEstado(color, estado, false, noEntregado);
      }

      const markerKey = `c-${coordKey}`;
      const marker = L.marker([lat, lng], { icon, zIndexOffset: 100 })
        .addTo(map)
        .bindPopup(facturas.length > 1 ? facturasPopupHtml(facturas) : facturaPopupHtml(primary))
        .bindTooltip(
          `${facturas.map(f => f.numero_factura).join(' · ')}<br>${primary.cliente_nombre}${primary.cliente_domicilio ? '<br>' + primary.cliente_domicilio : ''}`,
          { direction: 'top', offset: [0, -18], className: 'cliente-tooltip' }
        );

      marker.on('contextmenu', (e) => {
        L.DomEvent.preventDefault(e.originalEvent);
        mostrarMenuContextual(e.originalEvent, primary.id);
      });

      if (modoProgramar) {
        marker.on('click', () => { if (primary.cliente_id) toggleClienteEnGrupo(primary.cliente_id); });
      }

      marcadores[markerKey] = marker;
      for (const f of facturas) marcadorPorFactura[f.id] = marker;
    }
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

  function recomendadoPopupHtml(cliente: any, distKm?: number, grupoNombre = '', cercaDeNombre = '') {
    const items: string[] = [];
    items.push(`★ <strong>${cliente.nombre}</strong>`);
    if (grupoNombre) items.push(`<span style="color:#0d9488;font-weight:600;">Recomendado para: ${grupoNombre}</span>`);
    if (distKm != null) items.push(`<span style="color:var(--text-secondary);">A ${distKm.toFixed(2)} km de ${cercaDeNombre || 'la parada más cercana'}</span>`);
    items.push(`<span style="color:var(--text-secondary);">${cliente.domicilio ?? ''}</span>`);
    items.push(`<span style="color:#9ca3af;font-size:11px;">Cliente sin facturas pendientes (compró en los últimos 2 meses)</span>`);
    return `<div style="font-family:sans-serif;font-size:13px;min-width:200px;display:flex;flex-direction:column;gap:2px;">${items.join('')}</div>`;
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
      items.push(`<button data-action="geocodificar" data-id="${factura.id}" style="background:transparent;border:1px solid #d1d5db;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;font-family:var(--font, sans-serif);color:#374151;width:100%;">📍 Ubicar dirección</button>`);
    }

    return `<div style="font-family:sans-serif;font-size:13px;min-width:200px;display:flex;flex-direction:column;gap:2px;">${items.join('')}</div>`;
  }

  function facturasPopupHtml(facturas: any[]) {
    const blocks = facturas.map(f => {
      const rows: string[] = [];
      rows.push(`<strong style="font-size:14px;">${f.numero_factura}</strong> <span style="display:inline-block;background:${kanbanColor(f.estado_kanban)};color:#fff;font-size:10px;font-weight:600;padding:1px 6px;border-radius:4px;margin-left:4px;line-height:1.5;">${kanbanText(f.estado_kanban)}</span>`);
      rows.push(`<span style="color:#374151;font-weight:500;">${f.cliente_nombre}</span>`);
      if (f.cliente_domicilio) rows.push(`<span style="color:var(--text-secondary);">📍 ${f.cliente_domicilio}${f.cliente_piso_depto ? ', ' + f.cliente_piso_depto : ''}</span>`);
      if (f.total) rows.push(`<span style="color:#059669;font-weight:600;">$${f.total.toLocaleString('es-AR')}</span>`);
      if (f.geocode_error) {
        rows.push(`<hr style="margin:6px 0;border-color:#fee2e2;">`);
        rows.push(`<span style="color:#dc2626;font-size:11px;font-weight:500;">⚠️ ${f.geocode_error}</span>`);
        rows.push(`<button data-action="editar-direccion" data-id="${f.id}" style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;font-family:var(--font, sans-serif);color:#dc2626;width:100%;margin-top:3px;">✏️ Corregir dirección</button>`);
      } else if (!f.lat || !f.lng) {
        rows.push(`<hr style="margin:6px 0;border-color:#eee;">`);
        rows.push(`<button data-action="geocodificar" data-id="${f.id}" style="background:transparent;border:1px solid #d1d5db;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;font-family:var(--font, sans-serif);color:#374151;width:100%;">📍 Ubicar dirección</button>`);
      }
      const sep = facturas.length > 1 ? 'border-bottom:1px solid #f3f4f6;padding:6px 0;' : '';
      return `<div style="display:flex;flex-direction:column;gap:2px;${sep}">${rows.join('')}</div>`;
    });
    return `<div style="font-family:sans-serif;font-size:13px;min-width:220px;display:flex;flex-direction:column;">${blocks.join('')}</div>`;
  }

  // ── Context menu ──

  function mostrarMenuContextual(e: any, facturaId: number) {
    e.preventDefault();
    menuContextual = { x: e.clientX, y: e.clientY, id: facturaId, tipo: 'factura' };
  }

  function mostrarMenuContextualCliente(e: any, clienteId: number) {
    e.preventDefault();
    menuContextual = { x: e.clientX, y: e.clientY, id: clienteId, tipo: 'cliente' };
  }

  function cerrarMenuContextual() {
    menuContextual = null;
  }

  function copiarTelefono(texto: string) {
    const t = (texto || '').trim();
    if (!t) {
      appStore.showToast('Sin teléfono registrado', 'error');
      return;
    }
    navigator.clipboard.writeText(t);
    appStore.showToast('Teléfono copiado', 'success');
  }

  function clientePorId(id: number): any {
    return clientesRecomendables.find((c: any) => c.id === id)
      ?? todosLosClientes.find((c: any) => c.id === id);
  }

  function toggleFiltroKanban(estado: string) {
    if (mapaStore.filtroKanban.includes(estado)) {
      mapaStore.filtroKanban = mapaStore.filtroKanban.filter(e => e !== estado);
    } else {
      mapaStore.filtroKanban = [...mapaStore.filtroKanban, estado];
    }
  }

  function centrarEnFactura(facturaId: number) {
    const f = facturaMap.get(facturaId);
    if (!f || !f.lat || !f.lng) return;
    const mk = marcadorPorFactura[facturaId];
    if (mk) {
      map.setView(mk.getLatLng(), 16);
      mk.openPopup();
    }
  }

  function abrirDetalleFactura(facturaId: number) {
    const mk = marcadorPorFactura[facturaId];
    if (mk) mk.openPopup();
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
      appStore.showToast('Error al ubicar: ' + (e.message || e), 'error');
    }
    finally {
      geocodificandoFacturaId = null;
      invalidarMapaBase();
    }
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
      appStore.showToast('Error al ubicar cliente: ' + (e.message || e), 'error');
    } finally {
      invalidarMapaBase();
    }
  }

  // ── Editar dirección de factura ──

  let showEditDireccionModal = $state(false);
  let editDireccionFactura = $state<any>(null);
  let editDireccionValor = $state('');
  let editDireccionPiso = $state('');
  let editDireccionGuardando = $state(false);
  let direccionEditadaIds = $state(new Set<number>());
  let editDireccionPreviewCoords = $state<{ lat: number; lng: number } | null>(null);
  let editDireccionPreviewError = $state('');
  let editDireccionPreviewCargando = $state(false);

  function abrirEditarDireccionFactura(facturaId: number) {
    const f = facturaMap.get(facturaId);
    if (!f) return;
    editDireccionFactura = f;
    editDireccionValor = f.cliente_domicilio || '';
    editDireccionPiso = f.cliente_piso_depto || '';
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
      editDireccionPreviewError = 'Error de conexión al probar la ubicación.';
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
      if (editDireccionPiso !== (editDireccionFactura.cliente_piso_depto || '')) {
        await api.patchInvoiceField(facturaId, 'cliente_piso_depto', editDireccionPiso);
      }
      direccionEditadaIds.add(facturaId);
      direccionEditadaIds = new Set(direccionEditadaIds);
      const f = facturaMap.get(facturaId);
      if (f) {
        f.cliente_domicilio = editDireccionValor;
        f.cliente_piso_depto = editDireccionPiso;
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
            extra: editDireccionPiso,
            lat: f.lat ?? null,
            lng: f.lng ?? null,
          });
        } catch { }
      }
      renderizarMarcadores();
      // Reagrupar si la dirección corregida lo amerita (factura nueva o cambio de dirección)
      await asegurarPlan();
    } catch {
      appStore.showToast('Error al guardar dirección', 'error');
    } finally {
      editDireccionGuardando = false;
      invalidarMapaBase();
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
    invalidarMapaBase();
    renderizarMarcadores();
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
        const idsActuales = new Set<number>();
        for (const f of facturasDelDia) {
          if (f.cliente_id) idsActuales.add(f.cliente_id);
        }
        const m = new Map();
        for (const g of plan.grupos) {
          const clienteIds = (g.clienteIds || []).filter((id: number) => idsActuales.has(id));
          const ordenRuta = (g.ordenRuta || []).filter((id: number) => idsActuales.has(id));
          if (clienteIds.length === 0) continue;
          m.set(g.id, { ...g, clienteIds, ordenRuta });
        }
        if (m.size > 0) {
          grupos = m;
          grupoActivoId = m.keys().next().value;
          planViajeId = plan.id;
          renderizarMarcadores();
        }
      }
    } catch {}
  }

  async function cargarConfig() {
    try {
      const cfg = await api.getMapaConfig();
      mapaStore.algoMinPorGrupo = cfg.cluster_min;
      mapaStore.algoMaxPorGrupo = cfg.cluster_max;
      mapaStore.algoEpsKm = cfg.cluster_eps_km;
    } catch {}
  }

  async function asegurarPlan() {
    // Sin plan previo → el agrupamiento lo hace recomendarRutas desde cero
    if (grupos.size === 0) {
      await generarPlanAuto();
      return;
    }

    // Detectar clientes con dirección cambiada (el backend compara el domicilio de la
    // factura contra el del cliente). Se tratan como factura nueva: salen de su viaje
    // actual y se reasignan según recomendarRutas.
    const cambioDireccion = new Map<number, boolean>();
    try {
      const pending = await api.getClusterPending('plan_permanente');
      for (const p of pending) {
        if (p.cliente_id != null && p.ya_en_plan && p.cambio_direccion) cambioDireccion.set(p.cliente_id, true);
      }
    } catch {}

    const clientesDia = clientesParaPlan();
    if (clientesDia.length === 0) return;
    const idsFacturaDia = new Set(facturasDelDia.map(f => f.cliente_id).filter(Boolean));

    // Snapshot de los viajes actuales: preserva ediciones manuales (nombre, color, orden)
    const prev = new Map<string, { color: string; nombre: string; clientes: number[]; orden: number[] }>();
    const grupoAnterior = new Map<number, string>();
    for (const [id, g] of grupos) {
      const cs = g.clienteIds || [];
      prev.set(id, {
        color: g.color || CONSOLA_COLORS[0],
        nombre: g.nombre || '',
        clientes: [...cs],
        orden: g.ordenRuta || [...cs],
      });
      for (const cid of cs) if (!grupoAnterior.has(cid)) grupoAnterior.set(cid, id);
    }

    // Sueltos = clientes sin viaje (factura nueva) + clientes con dirección cambiada.
    // Si no hay ninguno, NO se recomputa nada: el plan queda tal cual.
    const sueltosSet = new Set<number>();
    for (const c of clientesDia) {
      if (!grupoAnterior.has(c.id) || cambioDireccion.get(c.id)) sueltosSet.add(c.id);
    }
    if (sueltosSet.size === 0) return;

    // Recompute con recomendarRutas (determinístico) respetando min/máx/eps
    const recomputados = recomendarRutas(
      clientesDia,
      mapaStore.algoMinPorGrupo,
      mapaStore.algoMaxPorGrupo,
      mapaStore.algoEpsKm
    );
    if (recomputados.length === 0) return;

    const nuevos = new Map<string, any>();

    // 1) Los que no cambiaron y ya tienen viaje → se quedan donde están (respetar manual)
    for (const [id, e] of prev) {
      const miembros = e.clientes.filter(cid => idsFacturaDia.has(cid) && !sueltosSet.has(cid));
      if (miembros.length === 0) continue;
      nuevos.set(id, {
        id,
        color: e.color,
        nombre: e.nombre || 'General',
        clienteIds: [...miembros],
        ordenRuta: e.orden.filter(cid => miembros.includes(cid)),
      });
    }

    // 2) Sueltos → se insertan en el viaje al que recomendarRutas los agrupa,
    //    sin superar algoMaxPorGrupo. Los que no entran van a sinTarget.
    const sinTarget: number[] = [];
    for (const r of recomputados) {
      const sueltos = r.clientesIds.filter(cid => sueltosSet.has(cid));
      if (sueltos.length === 0) continue;

      // Viaje existente con el que recompute más se solapa → ahí van los sueltos
      let mejorId: string | null = null;
      let mejorOverlap = 0;
      for (const [id, e] of prev) {
        const overlap = r.clientesIds.filter(cid => e.clientes.includes(cid)).length;
        if (overlap > mejorOverlap) { mejorOverlap = overlap; mejorId = id; }
      }

      const target = mejorId && nuevos.has(mejorId) ? mejorId : null;
      const g = target ? nuevos.get(target) : null;
      const agregar = g ? sueltos.filter(cid => !g.clienteIds.includes(cid)) : sueltos;
      const cupoOK = g != null && (mapaStore.algoMaxPorGrupo === 0 || g.clienteIds.length + agregar.length <= mapaStore.algoMaxPorGrupo);
      if (g && cupoOK && agregar.length > 0) {
        nuevos.set(target!, { ...g, clienteIds: [...g.clienteIds, ...agregar], ordenRuta: [...g.ordenRuta, ...agregar] });
      } else {
        sinTarget.push(...sueltos);
      }
    }

    // 2b) Sueltos sin destino válido → viajes nuevos respetando min/máx/eps
    if (sinTarget.length > 0) {
      const porId = new Map(clientesDia.map(c => [c.id, c]));
      const sinTargetClientes: ClienteParaAgrupar[] = sinTarget
        .map(id => porId.get(id))
        .filter((c): c is ClienteParaAgrupar => !!c);
      if (sinTargetClientes.length > 0) {
        const gruposNuevos = recomendarRutas(sinTargetClientes, mapaStore.algoMinPorGrupo, mapaStore.algoMaxPorGrupo, mapaStore.algoEpsKm);
        for (const gr of gruposNuevos) {
          if (gr.clientesIds.length === 0) continue;
          const id = `grupo-auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          nuevos.set(id, {
            id,
            color: CONSOLA_COLORS[nuevos.size % CONSOLA_COLORS.length],
            nombre: gr.nombreZona || 'General',
            clienteIds: gr.clientesIds,
            ordenRuta: gr.clientesIds,
          });
        }
      }
    }

    // 3) Contar reasignados por cambio de dirección
    let reasignados = 0;
    if (cambioDireccion.size > 0) {
      const nuevoGrupoDe = new Map<number, string>();
      for (const [id, g] of nuevos) for (const cid of g.clienteIds) if (!nuevoGrupoDe.has(cid)) nuevoGrupoDe.set(cid, id);
      for (const [cid] of cambioDireccion) {
        const antes = grupoAnterior.get(cid);
        const ahora = nuevoGrupoDe.get(cid);
        if (antes && ahora && antes !== ahora) reasignados++;
      }
    }

    // 4) Limpiar vacíos y asignar
    for (const [id, g] of nuevos) {
      if ((g.clienteIds || []).length === 0) nuevos.delete(id);
    }
    grupos = nuevos;
    if (!grupos.has(grupoActivoId!)) grupoActivoId = grupos.size > 0 ? [...grupos.keys()][0] : null;
    renderizarMarcadores();
    if (reasignados > 0) {
      appStore.showToast(`🔀 ${reasignados} cliente(s) reasignado(s) a un viaje más cercano por cambio de dirección`, 'success');
    }
  }

  const RADIO_RECOMENDACION_KM = 1;

  function resolverCoordsCliente(c: any): { lat: number; lng: number } | null {
    if (c.lat != null && c.lng != null) return { lat: c.lat, lng: c.lng };
    const defaultAddr = c.addresses?.find((a: any) => a.is_default);
    if (defaultAddr?.lat != null && defaultAddr?.lng != null) return { lat: defaultAddr.lat, lng: defaultAddr.lng };
    const firstGeo = c.addresses?.find((a: any) => a.lat != null && a.lng != null);
    if (firstGeo) return { lat: firstGeo.lat, lng: firstGeo.lng };
    return null;
  }

  function nombreClientePorId(id: number | null | undefined): string {
    if (id == null) return '';
    const c = clientesRecomendables.find((c: any) => c.id === id)
      ?? todosLosClientes.find((c: any) => c.id === id)
      ?? facturasDelDia.find((f: any) => f.cliente_id === id);
    return c?.nombre || c?.cliente_nombre || `Cliente ${id}`;
  }

  function coordsRecomendacionPorCliente(): Map<number, { lat: number; lng: number }> {
    const m = new Map<number, { lat: number; lng: number }>();
    for (const f of facturasDelDia) {
      if (f.cliente_id && f.lat && f.lng && !m.has(f.cliente_id)) {
        m.set(f.cliente_id, { lat: f.lat, lng: f.lng });
      }
    }
    for (const c of clientesRecomendables) {
      const r = resolverCoordsCliente(c);
      if (r && !m.has(c.id)) m.set(c.id, r);
    }
    return m;
  }

  async function generarRecomendaciones() {
    if (recomendando) return;
    recomendando = true;
    try {
      // 1) Clientes con compras en los últimos 2 meses (siempre, sin depender del filtro del top bar)
      let clientes2m: any[] = todosLosClientes;
      if (mapaStore.filtroRecencia !== 2) {
        const dash = await cacheStore.fetch(`mapa-base:2`, () => api.getMapaDashboard(fecha, false, 2), 60000);
        clientes2m = dash.clientes;
      }
      clientesRecomendables = clientes2m;

      // 2) Candidatos: con coordenadas (directas o de sus direcciones) y sin factura el día de hoy
      const conFacturaHoy = clientesIdsConFactura;
      const candidatos = clientes2m
        .filter(c => !conFacturaHoy.has(c.id) && resolverCoordsCliente(c))
        .map(c => ({ c, coords: resolverCoordsCliente(c) as { lat: number; lng: number } }));

      if (candidatos.length === 0 || grupos.size === 0) {
        await api.saveRecomendaciones('plan_permanente', []);
        recomendaciones = [];
        renderizarMarcadores();
        return;
      }

      const coords = coordsRecomendacionPorCliente();
      const porCliente = new Map<number, { grupoId: string; dist: number; paradaId: number }>();

      // 3) Cada viaje tira un radio de 5 km SOLO sobre sus facturas/clientes activos (sin la salida).
      //    La distancia es a la PARADA más cercana (no al segmento entre paradas).
      for (const g of grupos.values()) {
        const paradas = idsOrdenadosDe(g)
          .map(id => ({ id, coords: coords.get(id) }))
          .filter((x): x is { id: number; coords: { lat: number; lng: number } } => !!x.coords);
        if (paradas.length === 0) continue;

        for (const cand of candidatos) {
          let mejorParada: { id: number; coords: { lat: number; lng: number } } | null = null;
          let d = Infinity;
          for (const par of paradas) {
            const dd = haversine({ lat: cand.coords.lat, lng: cand.coords.lng }, par.coords);
            if (dd < d) { d = dd; mejorParada = par; }
          }
          if (d > RADIO_RECOMENDACION_KM || !mejorParada) continue;
          const exist = porCliente.get(cand.c.id);
          if (!exist || d < exist.dist) {
            porCliente.set(cand.c.id, { grupoId: g.id, dist: d, paradaId: mejorParada.id });
          }
        }
      }

      const items: RecomendacionCliente[] = [];
      for (const [clienteId, v] of porCliente) {
        items.push({
          grupo_id: v.grupoId,
          cliente_id: clienteId,
          distancia_km: Math.round(v.dist * 100) / 100,
          cerca_de_cliente_id: v.paradaId,
        });
      }
      items.sort((a, b) => a.distancia_km - b.distancia_km);

      await api.saveRecomendaciones('plan_permanente', items);
      recomendaciones = items;
      renderizarMarcadores();
    } catch {
      // silencioso: si falla, se mantienen las recomendaciones previas
    } finally {
      recomendando = false;
    }
  }

  async function cargarRecomendaciones() {
    try {
      const items = await api.getRecomendaciones('plan_permanente');
      recomendaciones = items;
      renderizarMarcadores();
    } catch {}
  }

  async function guardarPlan() {
    guardandoPlan = true;
    try {
      if (grupos.size === 0) {
        if (planViajeId) await api.deletePlanViaje(planViajeId);
        planViajeId = null;
        appStore.showToast('Plan eliminado', 'success');
        return true;
      }
      const data = { fecha: 'plan_permanente', grupos: [...grupos.values()] };
      if (planViajeId) {
        await api.updatePlanViaje(planViajeId, data);
      } else {
        const res = await api.savePlanViaje(data);
        planViajeId = res.id;
      }
      invalidarMapaBase();
      appStore.showToast('Plan guardado', 'success');
      return true;
    } catch {
      appStore.showToast('Error al guardar el plan', 'error');
      return false;
    } finally {
      guardandoPlan = false;
    }
  }

  async function enviarAPanel() {
    const ok = await guardarPlan();
    if (ok) appStore.currentTab = 'panel-control';
  }

  async function guardarConfigAgrupamiento() {
    await generarPlanAuto();
    renderizarMarcadores();
    appStore.showToast('✅ Plan regenerado con la configuración de agrupamiento', 'success');
  }

  function iniciarRenombrar(grupoId: string) {
    const g = grupos.get(grupoId);
    if (!g) return;
    renombrandoId = grupoId;
    renombrarValue = g.nombre;
  }

  function confirmarRenombrar() {
    if (!renombrandoId) return;
    const g = grupos.get(renombrandoId);
    if (g && renombrarValue.trim()) {
      renombrarGrupo(renombrandoId, renombrarValue.trim());
    }
    renombrandoId = null;
  }

  function clientesParaPlan(): ClienteParaAgrupar[] {
    const geocodificadas = facturasDelDia.filter(f => f.lat && f.lng);
    const clientesUnicos: ClienteParaAgrupar[] = [];
    const seen = new Set<number>();
    for (const f of geocodificadas) {
      if (f.cliente_id && !seen.has(f.cliente_id)) {
        seen.add(f.cliente_id);
        clientesUnicos.push({
          id: f.cliente_id,
          domicilio: f.cliente_domicilio || '',
          lat: f.lat,
          lng: f.lng,
        });
      }
    }
    return clientesUnicos;
  }

  async function generarPlanAuto(): Promise<boolean> {
    const clientesUnicos = clientesParaPlan();
    if (clientesUnicos.length === 0) return false;

    const gruposRuta = recomendarRutas(
      clientesUnicos,
      mapaStore.algoMinPorGrupo,
      mapaStore.algoMaxPorGrupo,
      mapaStore.algoEpsKm
    );
    if (gruposRuta.length === 0) return false;

    const nuevos = new Map<string, any>();
    gruposRuta.forEach((g, i) => {
      const color = CONSOLA_COLORS[i % CONSOLA_COLORS.length];
      const id = `grupo-auto-${Date.now()}-${i}`;
      nuevos.set(id, {
        id,
        nombre: g.nombreZona || `Viaje ${i + 1}`,
        clienteIds: g.clientesIds,
        ordenRuta: g.clientesIds,
        color,
      });
    });
    grupos = nuevos;
    grupoActivoId = nuevos.size > 0 ? [...nuevos.keys()][0] : null;
    mapaStore.planAutoGenerado = true;
    renderizarMarcadores();
    return true;
  }

  // ── Search ──

  async function buscarDireccion(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    if (facturasFiltradas.length === 1) {
      const f = facturasFiltradas[0];
      if (f.lat && f.lng) {
        map.setView([f.lat, f.lng], 16);
        marcadorPorFactura[f.id]?.openPopup();
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

  async function trazarRuta(conVuelta = true) {
    if (ordenRuta.length === 0) return;

    const facturasRuta = ordenRuta
      .map(id => facturaMap.get(id))
      .filter(f => f && seleccionados.has(f.id) && f.lat && f.lng);

    if (facturasRuta.length === 0) return;

    limpiarLineaRuta();

    const puntos: [number, number][] = [];
    if (origenCoords) {
      puntos.push([origenCoords.lng, origenCoords.lat]);
    }
    for (const f of facturasRuta) {
      puntos.push([f.lng, f.lat]);
    }
    if (conVuelta && origenCoords && facturasRuta.length > 0) {
      const ultimo = puntos[puntos.length - 1];
      if (!(ultimo[0] === origenCoords.lng && ultimo[1] === origenCoords.lat)) {
        puntos.push([origenCoords.lng, origenCoords.lat]);
      }
    }

    if (puntos.length < 2) {
      infoRuta = 'Se necesita al menos un origen y un destino.';
      return;
    }

    calculandoRuta = true;
    infoRuta = 'Calculando...';

    try {
      const res = await api.mapaRuta({ puntos });
      const latlngs = decodePolyline(res.geometry);
      const ll = latlngs.map(([lat, lng]) => L.latLng(lat, lng));

      rutaLinea = L.polyline(ll, { color: '#2563eb', weight: 5, opacity: 0.8 }).addTo(map);
      hayRutaActiva = true;
      map.fitBounds(rutaLinea.getBounds().pad(0.1));

      const distKm = (res.distance / 1000).toFixed(1);
      const mins = Math.round(res.duration / 60);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      infoRuta = h > 0 ? `${distKm} km \xB7 ${h}h ${m}m` : `${distKm} km \xB7 ${m} min`;

      if (grupoActivoId && latlngs.length >= 2) {
        autoAbsorberCercanos(latlngs);
      }
    } catch (e) {
      calculandoRuta = false;
      infoRuta = `Error al calcular ruta: ${(e as Error)?.message || 'intentá de nuevo'}`;
      return;
    }
    calculandoRuta = false;
    hayRutaActiva = true;
  }

  function autoAbsorberCercanos(latlngs: [number, number][]) {
    if (!grupoActivoId) return;
    const activeGroup = grupos.get(grupoActivoId);
    if (!activeGroup) return;
    const maxPorGrupo = mapaStore.algoMaxPorGrupo;
    const bufferM = mapaStore.algoRadioCercanosM || 300;
    const activeClienteIds = new Set(activeGroup.clienteIds);
    const candidatos = facturasDelDia
      .filter(f => f.lat && f.lng && f.cliente_id != null && !activeClienteIds.has(f.cliente_id))
      .map(f => ({ id: f.id, lat: f.lat, lng: f.lng, cliente_id: f.cliente_id }));
    if (candidatos.length === 0 || latlngs.length < 2) return;

    const cercanos = findCercanosRuta(latlngs, candidatos, bufferM);
    if (cercanos.length === 0) return;

    const seenClientes = new Set<number>();
    const idsAAgregar: number[] = [];
    for (const c of cercanos) {
      const f = facturasDelDia.find(ff => ff.id === c.id);
      if (!f || !f.cliente_id || seenClientes.has(f.cliente_id)) continue;
      if (maxPorGrupo > 0 && activeGroup.clienteIds.length + idsAAgregar.length >= maxPorGrupo) break;
      seenClientes.add(f.cliente_id);
      idsAAgregar.push(f.cliente_id);
    }
    for (const cid of idsAAgregar) {
      moverClienteAGrupo(cid, grupoActivoId);
    }
    if (idsAAgregar.length > 0) {
      appStore.showToast(`➕ ${idsAAgregar.length} cliente(s) agregado(s) al viaje por estar sobre la ruta`, 'success');
    }
  }

  function fechaEntregaValor(f: any): number {
    const fecha = f?.fecha || f?.fechaMin || f?.fecha_entrega || '';
    if (!fecha) return Infinity;
    const p = fecha.split('/');
    if (p.length === 3) {
      const t = new Date(+p[2], +p[1] - 1, +p[0]).getTime();
      return isNaN(t) ? Infinity : t;
    }
    const d = new Date(fecha);
    return isNaN(d.getTime()) ? Infinity : d.getTime();
  }

  async function optimizarRuta() {
    if (ordenRuta.length < 2) return;

    const clientes = ordenRuta
      .map(id => facturaMap.get(id))
      .filter(f => f && seleccionados.has(f.id) && f.lat && f.lng);

    if (clientes.length < 2) return;

    const origin = origenCoords ? { lat: origenCoords.lat, lng: origenCoords.lng } : { lat: clientes[0].lat, lng: clientes[0].lng };

    const destinos: [number, number][] = clientes.map(f => [f.lng, f.lat]);
    const prioridades: Record<string, number> = {};
    const conFechas = clientes.map(f => fechaEntregaValor(f));
    const conFechaValida = conFechas.some(v => v !== Infinity);
    if (conFechaValida) {
      const ordenPrioridad = clientes
        .map((f, i) => ({ i, v: conFechas[i] }))
        .sort((a, b) => (a.v - b.v) || (b.i - a.i));
      ordenPrioridad.forEach(({ i }, rank) => {
        prioridades[`j${i}`] = clientes.length > 1 ? Math.round((1 - rank / (clientes.length - 1)) * 10) : 0;
      });
    }

    calculandoRuta = true;
    infoRuta = 'Optimizando...';

    try {
      const res = await api.mapaOptimizar({ origen: [origin.lng, origin.lat], destinos, prioridades: Object.keys(prioridades).length ? prioridades : undefined });

      const posPorJob = new Map<string, number>();
      res.orden.forEach((jobId, pos) => posPorJob.set(jobId, pos));
      const conPos = clientes.map((f, i) => ({ f, pos: posPorJob.get(`j${i}`) ?? i }));
      conPos.sort((a, b) => a.pos - b.pos);
      ordenRuta = conPos.map(x => x.f.id);

      renderizarMarcadores();

      // La geometría del VROOM ya incluye ida y vuelta (start=end=origen en el backend).
      limpiarLineaRuta();
      const latlngs = decodePolyline(res.geometry || '');
      const ll = latlngs.map(([lat, lng]) => L.latLng(lat, lng));

      if (ll.length >= 2) {
        rutaLinea = L.polyline(ll, { color: '#8b5cf6', weight: 5, opacity: 0.8 }).addTo(map);
        hayRutaActiva = true;
        map.fitBounds(rutaLinea.getBounds().pad(0.1));
      }

      const distKm = ((res.distance || 0) / 1000).toFixed(1);
      const mins = Math.round((res.duration || 0) / 60);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      infoRuta = h > 0 ? `${distKm} km \xB7 ${h}h ${m}m (ida y vuelta)` : `${distKm} km \xB7 ${m} min (ida y vuelta)`;

      if (grupoActivoId && ll.length >= 2) {
        autoAbsorberCercanos(latlngs);
      }
    } catch (e) {
      calculandoRuta = false;
      infoRuta = `Error al optimizar: ${(e as Error)?.message || 'intentá de nuevo'}`;
    }
  }

  async function trazarRutaGrupo(grupoId: string) {
    const grupo = grupos.get(grupoId);
    if (!grupo) return;

    const facturasGrupo = facturasDelDia.filter(
      f => f.cliente_id && grupo.clienteIds.includes(f.cliente_id) && f.lat && f.lng
    );

    if (facturasGrupo.length === 0) {
      appStore.showToast('No hay facturas ubicadas en este viaje', 'error');
      return;
    }

    const ids = facturasGrupo.map(f => f.id);
    seleccionados = new Set(ids);
    ordenRuta = ids;

    renderizarMarcadores();
    if (facturasGrupo.length > 1) {
      optimizarRuta();
    } else {
      trazarRuta();
    }
  }

  function limpiarLineaRuta() {
    if (rutaLinea) {
      map?.removeLayer(rutaLinea);
      rutaLinea = null;
    }
    infoRuta = '';
    calculandoRuta = false;
    hayRutaActiva = false;
  }

  function limpiarRuta() {
    limpiarLineaRuta();
    seleccionados = new Set();
    ordenRuta = [];
    renderizarMarcadores();
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
    if (ordenRuta.length === 0 || !rutaLinea) {
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
    observerTema?.disconnect();
    observerTema = null;
    limpiarLineaRuta();
    map?.remove();
  });

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

  async function irAProgramar() {
    showGeoModal = false;
    modoProgramar = true;
    if (grupos.size === 0) {
      const ok = await generarPlanAuto();
      if (!ok) crearGrupo();
    }
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
      <div class="panel-controls">
        {#if editandoOrigen}
          <div class="panel-control-row panel-origen-editing">
            <AddressAutocomplete
              value={origenDireccion}
              onchange={(v: string) => { origenDireccion = v; }}
              onselect={(data: { label: string; lat: number; lng: number }) => { origenDireccion = data.label; origenCoords = { lat: data.lat, lng: data.lng }; }}
              className="panel-origen-input"
              placeholder="Dirección..."
            />
            <button class="panel-btn-geo" onclick={geocodificarOrigen} disabled={geocodificandoOrigen || !origenDireccion.trim()} title="Ubicar salida">🌍</button>
            <button class="panel-btn-save" onclick={guardarOrigen} title="Guardar salida">💾</button>
          </div>
        {/if}
      </div>
    </div>

    {#if rutaLinea}
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
      {#if mapaStore.cargando}
        <p class="info-text">Cargando...</p>
      {:else if facturasDelDia.length === 0}
        <p class="info-text">Sin resultados.</p>
      {:else}
        <div class="resumen-wrap">
          <span class="resumen-nums">
            <span class="resumen-num">
              <svg class="resumen-ico ico-doc" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              {facturasFiltradas.length}
            </span>
            <span class="resumen-sep">·</span>
            <span class="resumen-num">
              <svg class="resumen-ico ico-ok" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              {facturasGeocodificadas.length}
            </span>
            <span class="resumen-sep">·</span>
            <span class="resumen-num">
              <svg class="resumen-ico ico-warn" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
              {facturasSinGeocodificar.length}
            </span>
            <span class="resumen-sep">·</span>
            <span class="resumen-num">
              <svg class="resumen-ico ico-box" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
              {facturasRetira.length}
            </span>
          </span>
        </div>

        <div class="plan-header">
          <h3>Viajes</h3>
        </div>

        <div class="grupos-section">
          <div class="grupos-header">
            <div class="grupos-actions">
              <button class="btn-sm" onclick={crearGrupo}>+ Nuevo</button>
              <button class="btn-sm" onclick={() => showConfigAgrupamiento = true} title="Configurar el agrupamiento automático de viajes">⚙️ Configuración de Agrupamiento</button>
            </div>
          </div>
          {#if gruposBajoMinimo.length > 0}
            <div class="grupo-alert-bajo" role="note">
              <span class="grupo-alert-text">⚠️ {gruposBajoMinimo.length} viaje(s) con menos de {mapaStore.algoMinPorGrupo} cliente(s). Aumentá el máximo o reducí el mínimo para una ruta más certera.</span>
              <button class="grupo-alert-btn" onclick={() => showConfigAgrupamiento = true}>⚙️ Ajustar</button>
            </div>
          {/if}
          {#each grupoArray as grupo (grupo.id)}
            <div
              class="grupo-card"
              class:activo={grupo.id === grupoActivoId}
            >
              <div class="grupo-card-header">
                <span class="grupo-dot" style="background:{grupo.color}">{inicialesGrupo.get(grupo.id) ?? ''}</span>
                {#if renombrandoId === grupo.id}
                  <input
                    class="grupo-nombre-input"
                    bind:value={renombrarValue}
                    onkeydown={(e) => { if (e.key === 'Enter') confirmarRenombrar(); if (e.key === 'Escape') renombrandoId = null; e.stopPropagation(); }}
                    onblur={confirmarRenombrar}
                    autofocus
                    onclick={(e) => e.stopPropagation()}
                  />
                {:else}
                  <button
                    type="button"
                    class="grupo-nombre"
                    onclick={() => { grupoActivoId = grupo.id; renderizarMarcadores(); }}
                    title="Seleccionar viaje"
                  >{grupo.nombre}</button>
                {/if}
                <span class="grupo-count">{clientesPorGrupo.get(grupo.id)?.length ?? (grupo.clienteIds?.length || 0)}</span>
                <button
                  class="grupo-rename"
                  onclick={(e) => { e.stopPropagation(); iniciarRenombrar(grupo.id); }}
                  title="Renombrar grupo"
                >✏️</button>
                <button
                  class="grupo-del"
                  onclick={(e) => { e.stopPropagation(); eliminarGrupo(grupo.id); }}
                  title="Eliminar grupo"
                >✕</button>
              </div>
              {#if (clientesPorGrupo.get(grupo.id)?.length ?? 0) > 0}
                <div class="grupo-card-clientes">
                  {#each clientesPorGrupo.get(grupo.id) as cliente, i}
                    <div
                      class="grupo-card-cliente"
                      role="button"
                      tabindex="0"
                      onclick={() => { if (cliente.facturaId) abrirDetalleFactura(cliente.facturaId); }}
                      onkeydown={(e) => { if (e.key === 'Enter' && cliente.facturaId) abrirDetalleFactura(cliente.facturaId); }}
                      title="Ver detalle de la factura"
                    >
                      <span class="grupo-card-cliente-num">{i + 1}</span>
                      <div class="grupo-card-cliente-info">
                        <span class="grupo-card-cliente-nombre">{cliente.nombre}</span>
                        <span class="grupo-card-cliente-dir">{cliente.domicilio}</span>
                      </div>
                      {#if cliente.facturaId}
                        <div class="grupo-card-cliente-actions">
                          <button
                            class="grupo-card-cliente-btn"
                            onclick={(e) => { e.stopPropagation(); abrirEditarDireccionFactura(cliente.facturaId); }}
                            title="Editar dirección"
                            aria-label="Editar dirección"
                          ><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>
                          <button
                            class="grupo-card-cliente-btn grupo-card-btn-text"
                            onclick={(e) => { e.stopPropagation(); irAFacturacion(cliente.facturaId); }}
                            title="Ver factura en facturación"
                          >Ver factura</button>
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
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
                  <div class="factura-actions">
                    <button class="btn-geo-suggest" onclick={(e) => { e.stopPropagation(); abrirEditarDireccionFactura(factura.id); }}>✏️ Editar dirección</button>
                    {#if direccionEditadaIds.has(factura.id)}
                      <button class="btn-geo-suggest" onclick={(e) => { e.stopPropagation(); geocodificarFacturaEnMapa(factura.id); }} disabled={geocodificandoFacturaId === factura.id}>
                        {geocodificandoFacturaId === factura.id ? '⏳' : '📍 Ubicar'}
                      </button>
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
              {@const g = factura.cliente_id ? grupoDelCliente(factura.cliente_id) : null}
              <li
                class="factura-item"
                onclick={() => { if (factura.cliente_id) toggleClienteEnGrupo(factura.cliente_id); }}
                oncontextmenu={(e) => mostrarMenuContextual(e, factura.id)}
              >
                <span class="factura-geo" style={g ? `background:${g.color};color:white;` : 'background:#8b5cf6;color:white;'} title={g ? `En grupo: ${g.nombre}` : 'Retira'}>{g ? g.nombre[0] : '📦'}</span>
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
                    <button class="btn-geo-suggest" onclick={(e) => { e.stopPropagation(); abrirEditarDireccionFactura(factura.id); }}>✏️ Editar dirección</button>
                    {#if direccionEditadaIds.has(factura.id)}
                      <button class="btn-geo-suggest" onclick={(e) => { e.stopPropagation(); geocodificarFacturaEnMapa(factura.id); }} disabled={geocodificandoFacturaId === factura.id}>
                        {geocodificandoFacturaId === factura.id ? '⏳' : '📍 Ubicar'}
                      </button>
                    {/if}
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
    <div class="mapa-container" bind:this={mapContainer} onclick={() => { cerrarMenuContextual(); }}></div>

    <div class="estilo-selector" onclick={(e) => e.stopPropagation()}>
      <button
        class="btn-estilo"
        onclick={() => mostrarSelectorEstilo = !mostrarSelectorEstilo}
        title="Estilo del mapa"
        aria-label="Cambiar estilo del mapa"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 2 17 12 22 22 17 22 7 12 2"/><line x1="2" y1="7" x2="12" y2="12"/><line x1="12" y1="12" x2="22" y2="7"/><line x1="12" y1="12" x2="12" y2="22"/></svg>
      </button>
      {#if mostrarSelectorEstilo}
        <div class="estilo-menu">
          {#each ESTILOS_MAPA as est}
            <button
              class="estilo-item"
              class:activo={est.id === estiloMapa}
              onclick={() => { estiloMapa = est.id; mostrarSelectorEstilo = false; }}
            >
              <span class="estilo-dot" style="background:{(est.id === 'positron' || est.id === 'voyager' || est.id === 'osm') ? '#e5e7eb' : (est.id === 'dark' ? '#1f2937' : '#3b82f6')};"></span>
              <span class="estilo-nombre">{est.label}</span>
              {#if est.id === estiloMapa}
                <span class="estilo-check">✓</span>
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="mapa-search-group" onclick={(e) => e.stopPropagation()}>
      <button
        class="mapa-btn-side mapa-btn-reload"
        onclick={() => recargarMapa()}
        title="Recargar mapa"
        aria-label="Recargar mapa"
        disabled={mapaStore.cargando}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
      </button>

      <div class="mapa-search-bar">
        <svg class="mapa-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <AddressAutocomplete
          value={mapaStore.busqueda}
          onchange={(v: string) => { mapaStore.busqueda = v; if (!v) mapaStore.busquedaCoords = null; }}
          onselect={(data: { label: string; lat: number; lng: number }) => { mapaStore.busqueda = data.label; mapaStore.busquedaCoords = { lat: data.lat, lng: data.lng }; }}
          className="mapa-search-input"
          placeholder="Buscar cliente..."
        />
      </div>

      <div class="mapa-filtros-wrap">
        <button
          class="mapa-btn-side"
          class:activo={mostrarFiltros}
          onclick={() => { mostrarFiltros = !mostrarFiltros; }}
          title="Filtros"
          aria-label="Filtros"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
        </button>
        {#if mostrarFiltros}
          <div class="filtro-popover">
            <div class="filtro-header">
              <span>Filtros</span>
              <button class="filtro-close" onclick={() => mostrarFiltros = false} aria-label="Cerrar filtros">✕</button>
            </div>
            <div class="filtro-group">
              <button class="filtro-btn" class:activo={!mapaStore.filtroPendientes && mapaStore.filtroRecencia === 0} onclick={() => { mapaStore.filtroPendientes = false; mapaStore.filtroRecencia = 0; mapaStore.filtroKanban = []; }}>Todos</button>
              <button class="filtro-btn" class:activo={mapaStore.filtroPendientes} onclick={() => { mapaStore.filtroPendientes = true; mapaStore.filtroRecencia = 0; }}>Pendientes</button>
              <button class="filtro-btn" class:activo={!mapaStore.filtroPendientes && mapaStore.filtroRecencia === 2} onclick={() => { mapaStore.filtroPendientes = false; mapaStore.filtroRecencia = mapaStore.filtroRecencia === 2 ? 0 : 2; mapaStore.filtroKanban = []; }}>2 meses</button>
            </div>
            {#if mapaStore.filtroPendientes}
              <div class="filtro-divider"></div>
              <div class="filtro-group">
                <button class="filtro-btn" class:activo={mapaStore.filtroKanban.length === 0} onclick={() => mapaStore.filtroKanban = []}>Todos</button>
                <button class="filtro-btn" class:activo={mapaStore.filtroKanban.includes('PEDIDO')} onclick={() => toggleFiltroKanban('PEDIDO')}>Pedido</button>
                <button class="filtro-btn" class:activo={mapaStore.filtroKanban.includes('EN_PROCESO')} onclick={() => toggleFiltroKanban('EN_PROCESO')}>En Proceso</button>
                <button class="filtro-btn" class:activo={mapaStore.filtroKanban.includes('LISTO')} onclick={() => toggleFiltroKanban('LISTO')}>Listo</button>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <div class="mapa-salida-bar" onclick={() => editandoOrigen = true} title="Cambiar salida">
        <svg class="mapa-salida-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <span class="mapa-salida-text">{origenDireccion || '(sin definir)'}</span>
      </div>
    </div>

    <div class="mapa-bottom-left">
      <div class="leyenda-map" onclick={(e) => e.stopPropagation()}>
        {#if mostrarLeyenda}
        <div class="leyenda-header">
          <span>ℹ️ Leyenda</span>
          <button class="leyenda-close" onclick={() => mostrarLeyenda = false} title="Ocultar leyenda">✕</button>
        </div>
        <div class="leyenda-body">
          <div class="leyenda-item">
            <svg width="14" height="13" viewBox="0 0 44 40" xmlns="http://www.w3.org/2000/svg" class="leyenda-svg">
              <path d="M22 3 L4 17 L6 17 L6 36 L38 36 L38 17 L40 17 Z" fill="#2563eb" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>
              <rect x="20" y="24" width="5" height="12" rx="0.5" fill="#fff"/>
            </svg>
            <span class="leyenda-texto">Salida (origen de los viajes)</span>
          </div>
          <div class="leyenda-item">
            <span class="leyenda-dot" style="background:#3b82f6;"></span>
            <span class="leyenda-texto">Cliente sin pedido</span>
          </div>
          <div class="leyenda-item">
            <span class="leyenda-dot" style="background:#14b8a6;display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700;">★</span>
            <span class="leyenda-texto">Cliente recomendado (sin factura, cerca de un viaje)</span>
          </div>
          <div class="leyenda-item">
            <svg width="16" height="18" viewBox="14 12 18 20" xmlns="http://www.w3.org/2000/svg"><circle cx="22" cy="21" r="6.5" fill="none" stroke="#111" stroke-width="2"/><line x1="22" y1="21" x2="22" y2="16" stroke="#111" stroke-width="2" stroke-linecap="round"/><line x1="22" y1="21" x2="25.8" y2="21" stroke="#111" stroke-width="2" stroke-linecap="round"/></svg>
            <span class="leyenda-texto">Pedido</span>
          </div>
          <div class="leyenda-item">
            <svg width="16" height="18" viewBox="14 12 18 20" xmlns="http://www.w3.org/2000/svg"><path d="M28.5 21a6.5 6.5 0 1 1-2.1-4.8" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round"/><path d="M28.9 15.8 L28.5 19.2 L25.2 18.6 Z" fill="#111"/></svg>
            <span class="leyenda-texto">En Proceso</span>
          </div>
          <div class="leyenda-item">
            <svg width="16" height="18" viewBox="14 12 18 20" xmlns="http://www.w3.org/2000/svg"><path d="M17 21.3 L20.2 24.6 L27 17" fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span class="leyenda-texto">Listo</span>
          </div>
          <div class="leyenda-item">
            <span class="leyenda-estilo">🗺️</span>
            <span class="leyenda-texto">Cambiá el estilo del mapa con el botón de capas (arriba izquierda)</span>
          </div>
        </div>
      {:else}
        <button class="leyenda-reopen" onclick={() => mostrarLeyenda = true} title="Mostrar leyenda">ℹ️</button>
      {/if}
      </div>

      <div class="mapa-fecha-chip" onclick={(e) => e.stopPropagation()}>
        <label class="panel-control-label" for="mapa-fecha-input">Fecha</label>
        <input id="mapa-fecha-input" type="date" bind:value={mapaStore.fecha} class="panel-fecha-input" />
      </div>
    </div>

    <div class="recomendados-wrap" onclick={(e) => e.stopPropagation()}>
      {#if mostrarRecomendados}
        <div class="recomendados-panel">
          <div class="recomendados-header">
            <span>★ Recomendados</span>
            <button class="recomendados-close" onclick={() => mostrarRecomendados = false} title="Cerrar" aria-label="Cerrar recomendados">✕</button>
          </div>
          {#if recomendando}
            <p class="recomendados-empty">Calculando clientes cercanos...</p>
          {:else if recomendaciones.length === 0}
            <p class="recomendados-empty">Sin recomendados dentro de 1 km. Con los viajes armados se buscan clientes sin factura que compraron en los últimos 2 meses.</p>
          {:else}
            <div class="recomendados-list">
              {#each [...recomendacionesPorGrupo.entries()] as [grupoId, items]}
                {@const g = grupos.get(grupoId)}
                <div class="recomendados-grupo">
                  <div class="recomendados-grupo-title">
                    <span class="recomendados-grupo-dot" style="background:{g?.color || '#14b8a6'}"></span>
                    <span class="recomendados-grupo-nombre">{g?.nombre || 'Viaje'}</span>
                    <span class="recomendados-grupo-count">{items.length}</span>
                  </div>
                  {#each items as rec}
                    {@const cliente = clientesRecomendables.find((c: any) => c.id === rec.cliente_id) ?? todosLosClientes.find((c: any) => c.id === rec.cliente_id)}
                    <div class="recomendados-item" onclick={() => centrarEnCliente(rec.cliente_id)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && centrarEnCliente(rec.cliente_id)}>
                      <span class="recomendados-star">★</span>
                      <div class="recomendados-info">
                        <span class="recomendados-nombre">{cliente?.nombre ?? ('Cliente ' + rec.cliente_id)}</span>
                        <span class="recomendados-dir">{cliente?.domicilio ?? ''}</span>
                        {#if rec.cerca_de_cliente_id != null}
                          <span class="recomendados-cerca">A {rec.distancia_km.toFixed(2)} km de {nombreClientePorId(rec.cerca_de_cliente_id)}</span>
                        {/if}
                      </div>
                      <div class="recomendados-item-actions">
                        <span class="recomendados-km">{rec.distancia_km.toFixed(2)} km</span>
                        {#if cliente?.telefono}
                          <button
                            class="recomendados-copy"
                            onclick={(e) => { e.stopPropagation(); copiarTelefono(cliente.telefono); }}
                            title="Copiar teléfono"
                            aria-label="Copiar teléfono"
                          >📋</button>
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        <button class="recomendados-btn" onclick={() => mostrarRecomendados = true} title="Clientes recomendados (sin factura) cerca de los viajes">
          ★ {recomendaciones.length}
        </button>
      {/if}
    </div>

    {#if facturasSinGeocodificar.length > 0 && !geoAlertReadOculto}
    <div class="geo-alert geo-alert-read">
      <div class="geo-alert-header" onclick={() => geoAlertReadColapsado = !geoAlertReadColapsado} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && (geoAlertReadColapsado = !geoAlertReadColapsado)}>
        <span>⚠️ {facturasSinGeocodificar.length} dirección(es) no encontradas</span>
        <div class="geo-alert-header-actions">
          <span class="geo-alert-chevron">{geoAlertReadColapsado ? '▲' : '▼'}</span>
          <button class="geo-alert-btn geo-alert-btn-omit" onclick={(e) => { e.stopPropagation(); geoAlertReadOculto = true; }} title="Ocultar">✕</button>
        </div>
      </div>
      {#if !geoAlertReadColapsado}
        <div class="geo-alert-body">
          {#each facturasSinGeocodificar as factura (factura.id)}
            <div class="geo-alert-item">
              <div class="geo-alert-item-info">
                <strong>{factura.cliente_nombre}</strong>
                <span>{factura.cliente_domicilio || 'Sin dirección'}</span>
              </div>
              <div class="geo-alert-item-actions">
                <button class="geo-alert-btn" onclick={() => abrirEditarDireccionFactura(factura.id)}>✏️ Corregir</button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
    {:else if facturasSinGeocodificar.length > 0 && geoAlertReadOculto}
    <button class="geo-alert-reopen" onclick={() => geoAlertReadOculto = false} title="Ver direcciones no encontradas">
      ⚠️ {facturasSinGeocodificar.length}
    </button>
    {/if}

    {#if grupoActivo && facturasSinGeoEnActivo.length > 0}
    <div class="geo-alert">
      <div class="geo-alert-header" onclick={() => showGeoAlert = !showGeoAlert} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && (showGeoAlert = !showGeoAlert)}>
        <span>⚠️ {facturasSinGeoEnActivo.length} dirección(es) no encontradas</span>
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

    {#if grupoActivo}
    <div class="trip-cluster">
      {#if tiempoEstimado || calculandoTiempo}
        <div
          class="tiempo-chip"
          title="Tiempo estimado del viaje activo (ida y vuelta)"
        >
          {#if calculandoTiempo && !tiempoEstimado}
            <span class="tiempo-chip-spin">⏳</span> Calculando...
          {:else if tiempoEstimado}
            ⏱ {tiempoEstimado}
          {/if}
        </div>
      {/if}
      <div class="floating-trip-card">
      <div class="ftc-header">
        <div class="ftc-grupos-nav" role="tablist" aria-label="Viajes">
          {#each grupoArray as grupo}
            <button
              class="ftc-grupo-pill"
              class:activo={grupo.id === grupoActivoId}
              title={grupo.nombre}
              aria-label={grupo.nombre}
              aria-pressed={grupo.id === grupoActivoId}
              onclick={() => { grupoActivoId = grupo.id; renderizarMarcadores(); }}
            >
              <span class="ftc-grupo-dot" style="background:{grupo.color}">{inicialesGrupo.get(grupo.id) ?? ''}</span>
              {#if grupo.id === grupoActivoId}
                <span class="ftc-grupo-nombre">{grupo.nombre}</span>
              {/if}
            </button>
          {/each}
        </div>
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
      {:else}
        <p class="ftc-vacio">Sin clientes en este viaje</p>
      {/if}
      </div>
    </div>
    {/if}

    <div class="mapa-bottom-center">
      <button class="btn-guardar" onclick={guardarPlan} disabled={guardandoPlan || grupos.size === 0}>
        {guardandoPlan ? '⏳ Guardando...' : '💾 Guardar'}
      </button>
      <button class="btn-enviar" onclick={enviarAPanel} disabled={grupos.size === 0}>📋 Enviar a panel</button>
    </div>
  </div>
    </div>

{#if menuContextual}
  <div
    class="context-menu"
    style="left:{menuContextual.x}px;top:{menuContextual.y}px;"
    onclick={(e) => e.stopPropagation()}
    role="menu"
  >
    {#if menuContextual.tipo === 'factura'}
      {@const factura = facturaMap.get(menuContextual.id)}
      {#if modoProgramar}
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
      {/if}
      <button class="context-item" onclick={() => { const id = menuContextual.id; menuContextual = null; openEditClienteModal(id); }}>
        ✏️ Editar cliente
      </button>
      <button class="context-item" onclick={() => { const id = menuContextual.id; menuContextual = null; geocodificarFacturaEnMapa(id); }}>
        📍 Ubicar factura
      </button>
      {#if factura?.cliente_telefono}
        <button class="context-item" onclick={() => { const id = menuContextual!.id; menuContextual = null; copiarTelefono(facturaMap.get(id)?.cliente_telefono || ''); }}>
          📋 Copiar teléfono
        </button>
      {/if}
    {:else}
      {@const cliente = clientePorId(menuContextual.id)}
      <button class="context-item" onclick={() => { const id = menuContextual.id; menuContextual = null; geocodificarClienteEnMapa(id); }}>
        📍 Ubicar cliente
      </button>
      {#if cliente?.telefono}
        <button class="context-item" onclick={() => { const id = menuContextual!.id; menuContextual = null; copiarTelefono(clientePorId(id)?.telefono || ''); }}>
          📋 Copiar teléfono
        </button>
      {/if}
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

      <label for="edit-dir-piso" class="edit-dir-label edit-dir-label-piso">Piso / Depto</label>
      <input
        id="edit-dir-piso"
        type="text"
        bind:value={editDireccionPiso}
        placeholder="Ej: Piso 3, Dto B (opcional)"
        class="edit-dir-piso"
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
          {editDireccionPreviewCargando ? '⏳ Probando...' : '🔎 Probar ubicación'}
        </button>
      </div>

      {#if editDireccionPreviewCoords}
        <p class="edit-dir-ok">✅ Encontrado: {editDireccionPreviewCoords.lat.toFixed(5)}, {editDireccionPreviewCoords.lng.toFixed(5)}</p>
      {:else if editDireccionPreviewError}
        <p class="edit-dir-error">{editDireccionPreviewError}</p>
      {/if}

      <div class="edit-dir-footer">
        <button class="btn-secondary" onclick={() => { showEditDireccionModal = false; editDireccionFactura = null; if (volverAGeoTrasEditar) { showGeoModal = true; volverAGeoTrasEditar = false; } }}>Cancelar</button>
        <button class="btn-primary" onclick={guardarEditarDireccion} disabled={editDireccionGuardando || !editDireccionValor.trim()}>
          {editDireccionGuardando ? 'Guardando...' : '💾 Guardar y ubicar'}
        </button>
      </div>
    </div>
  </div>
{/if}

<RecomendacionRutasModal
  show={showConfigAgrupamiento}
  onclose={() => showConfigAgrupamiento = false}
  onsave={guardarConfigAgrupamiento}
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
    <h3>⚠️ Direcciones no encontradas</h3>
    <p class="geo-modal-desc">Hay {facturasSinGeocodificarTotal.length} dirección(es) no encontrada(s). Corregilas u omitilas para continuar.</p>
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

  :global(.pin-wrap) {
    transform-origin: bottom center;
    transition: transform 0.18s ease;
  }
  :global(.pin-wrap.pin-estado:hover) {
    transform: scale(1.45);
    z-index: 1000;
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
    padding: 0.5rem 0.75rem 0.75rem;
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
    padding-bottom: 0;
  }

  .panel-controls {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .panel-control-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }
  .panel-control-label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .panel-fecha-input {
    padding: 0.214rem 0.357rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 0.82rem;
    font-family: var(--font);
    background: var(--bg-card);
    color: var(--text-primary);
  }
  .panel-origen-editing {
    flex-wrap: wrap;
  }
  .panel-origen-editing :global(.ac-wrapper) {
    flex: 1;
    min-width: 120px;
  }
  .panel-btn-geo {
    padding: 0.214rem 0.357rem;
    font-size: 0.78rem;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-hover);
    cursor: pointer;
  }
  .panel-btn-geo:hover:not(:disabled) { background: var(--border); }
  .panel-btn-geo:disabled { opacity: 0.5; cursor: not-allowed; }
  .panel-btn-save {
    padding: 0.214rem 0.357rem;
    font-size: 0.78rem;
    border: none;
    border-radius: var(--radius-sm);
    background: #2563eb;
    color: white;
    cursor: pointer;
  }
  .panel-btn-save:hover { background: #1d4ed8; }

  .panel-scroll {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding-top: 0.25rem;
  }

  .info-text { font-size: 13px; color: var(--text-secondary); }
  .grupo-label { font-size: 12px; font-weight: 600; color: var(--text-primary); margin-top: 8px; margin-bottom: 4px; }

  .resumen-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--border);
  }
  .resumen-nums {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    flex-wrap: wrap;
    flex: 1;
    min-width: 0;
  }
  .resumen-num {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 14px;
    font-weight: 700;
    color: var(--text-primary);
    white-space: nowrap;
  }
  .resumen-ico {
    flex-shrink: 0;
    vertical-align: middle;
  }
  .resumen-ico.ico-doc { color: var(--text-secondary); }
  .resumen-ico.ico-ok { color: #10b981; }
  .resumen-ico.ico-warn { color: #f59e0b; }
  .resumen-ico.ico-box { color: #2563eb; }
  .resumen-sep {
    font-size: 12px;
    color: var(--text-secondary);
  }

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

  .mapa-bottom-left {
    position: absolute;
    bottom: 16px;
    left: 16px;
    z-index: 600;
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }

  .recomendados-wrap {
    position: absolute;
    top: 16px;
    left: 102px;
    z-index: 700;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
  }
  .recomendados-btn {
    width: 38px;
    height: 38px;
    border: none;
    border-radius: 50%;
    background: #14b8a6;
    color: white;
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    transition: transform 0.15s, background 0.15s;
  }
  .recomendados-btn:hover { transform: scale(1.08); background: #0d9488; }
  .recomendados-panel {
    width: 320px;
    max-width: 85vw;
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 8px 28px rgba(0,0,0,0.18);
    overflow: hidden;
    font-family: var(--font);
  }
  .recomendados-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-page);
    flex-shrink: 0;
  }
  .recomendados-header span {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary);
  }
  .recomendados-close {
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary);
  }
  .recomendados-close:hover { background: var(--bg-hover); }
  .recomendados-list {
    overflow-y: auto;
    padding: 6px 8px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .recomendados-grupo {
    display: flex;
    flex-direction: column;
  }
  .recomendados-grupo-title {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 4px;
  }
  .recomendados-grupo-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .recomendados-grupo-nombre {
    font-size: 12px;
    font-weight: 700;
    color: var(--text-primary);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .recomendados-grupo-count {
    font-size: 10px;
    font-weight: 700;
    color: #0d9488;
    background: #ccfbf1;
    padding: 1px 7px;
    border-radius: 10px;
    flex-shrink: 0;
  }
  .recomendados-item {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    padding: 6px 8px;
    border-radius: 8px;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background 0.12s, border-color 0.12s;
  }
  .recomendados-item:hover { background: var(--bg-hover); border-color: var(--border); }
  .recomendados-star {
    color: #14b8a6;
    font-size: 13px;
    line-height: 1.4;
    flex-shrink: 0;
  }
  .recomendados-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .recomendados-nombre {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }
  .recomendados-dir {
    font-size: 11px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .recomendados-cerca {
    font-size: 11px;
    font-weight: 600;
    color: #0d9488;
  }
  .recomendados-km {
    font-size: 11px;
    font-weight: 600;
    color: #0d9488;
    background: #ccfbf1;
    padding: 1px 6px;
    border-radius: 8px;
    flex-shrink: 0;
  }
  .recomendados-item-actions {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    flex-shrink: 0;
  }
  .recomendados-copy {
    width: 26px;
    height: 26px;
    border: 1px solid #99f6e4;
    background: #ccfbf1;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.12s, transform 0.12s;
  }
  .recomendados-copy:hover { background: #99f6e4; transform: scale(1.08); }
  .recomendados-empty {
    padding: 20px 16px;
    margin: 0;
    font-size: 12px;
    color: var(--text-muted);
    text-align: center;
  }
  .leyenda-map {
    max-width: 260px;
  }
  .mapa-fecha-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.12);
  }
  .mapa-fecha-chip .panel-control-label {
    color: var(--text-secondary);
  }
  .leyenda-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary);
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px 10px 0 0;
  }
  .leyenda-close {
    width: 20px;
    height: 20px;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 11px;
    color: var(--text-secondary);
    border-radius: 4px;
    font-family: var(--font);
    line-height: 1;
  }
  .leyenda-close:hover { background: var(--bg-hover); color: #dc2626; }
  .leyenda-body {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-top: none;
    border-radius: 0 0 10px 10px;
    padding: 6px 12px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  }
  .leyenda-item {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .leyenda-svg { flex-shrink: 0; }
  .leyenda-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1.5px solid #fff;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.15);
    flex-shrink: 0;
  }
  .leyenda-estilo { font-size: 14px; flex-shrink: 0; }
  .leyenda-texto {
    font-size: 12px;
    color: var(--text-primary);
    line-height: 1.35;
  }
  .leyenda-reopen {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--bg-card);
    color: var(--text-primary);
    font-size: 14px;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    font-family: var(--font);
  }
  .leyenda-reopen:hover { background: var(--bg-hover); }

  .estilo-selector {
    position: absolute;
    top: 16px;
    left: 56px;
    z-index: 600;
  }
  .btn-estilo {
    width: 38px;
    height: 38px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--bg-card);
    color: var(--text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    transition: background 0.15s;
    font-family: var(--font);
  }
  .btn-estilo:hover { background: var(--bg-hover); }
  .estilo-menu {
    margin-top: 6px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.15);
    min-width: 180px;
    padding: 4px;
    display: flex;
    flex-direction: column;
  }
  .estilo-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: none;
    background: none;
    cursor: pointer;
    border-radius: 6px;
    font-size: 13px;
    font-family: var(--font);
    color: var(--text-primary);
    text-align: left;
    transition: background 0.12s;
  }
  .estilo-item:hover { background: var(--bg-hover); }
  .estilo-item.activo { background: #eff6ff; }
  .estilo-dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.15);
    flex-shrink: 0;
  }
  .estilo-nombre { flex: 1; }
  .estilo-check { color: #2563eb; font-weight: 700; }

  .mapa-search-group {
    position: absolute;
    top: 10px;
    left: 32%;
    z-index: 600;
    display: flex;
    align-items: stretch;
    height: 38px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    max-width: calc(100% - 220px);
  }
  .mapa-btn-side {
    width: 38px;
    flex-shrink: 0;
    border: none;
    background: transparent;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    font-family: var(--font);
  }
  .mapa-btn-side:hover { background: var(--bg-hover); }
  .mapa-btn-side.activo {
    background: #2563eb;
    color: white;
  }
  .mapa-btn-side.activo:hover { background: #1d4ed8; }
  .mapa-btn-side:disabled { opacity: 0.5; cursor: not-allowed; }
  .mapa-btn-reload {
    border-right: 1px solid var(--border);
    border-top-left-radius: 9px;
    border-bottom-left-radius: 9px;
  }
  .mapa-search-bar {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    padding: 0 8px;
  }
  .mapa-search-icon {
    flex-shrink: 0;
    color: #9ca3af;
    margin-right: 6px;
  }
  :global(.mapa-search-bar .ac-input) {
    width: 100%;
    padding: 0.286rem 0.25rem;
    border: none !important;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    font-family: var(--font);
    background: transparent;
    color: var(--text-primary);
    outline: none;
    box-shadow: none !important;
  }
  .mapa-salida-bar {
    position: absolute;
    top: calc(100% + 2px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 600;
    display: flex;
    align-items: center;
    gap: 4px;
    max-width: 320px;
    cursor: pointer;
  }
  .mapa-salida-bar:hover .mapa-salida-text { color: #2563eb; }
  .mapa-salida-icon {
    flex-shrink: 0;
    color: #2563eb;
  }
  .mapa-salida-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.8rem;
    color: var(--text-primary);
    text-shadow: 0 1px 2px rgba(255,255,255,0.8);
  }
  .mapa-filtros-wrap {
    position: relative;
    display: flex;
    align-items: stretch;
  }
  .mapa-filtros-wrap .mapa-btn-side {
    border-left: 1px solid var(--border);
    border-top-right-radius: 9px;
    border-bottom-right-radius: 9px;
  }
  .filtro-popover {
    position: absolute;
    left: calc(100% + 6px);
    top: 0;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.15);
    min-width: 210px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .filtro-group {
    display: flex;
    flex-wrap: nowrap;
    gap: 4px;
  }
  .filtro-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    padding-bottom: 4px;
  }
  .filtro-close {
    width: 20px;
    height: 20px;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 12px;
    color: var(--text-secondary);
    border-radius: 4px;
    font-family: var(--font);
    line-height: 1;
  }
  .filtro-close:hover { background: var(--bg-hover); color: #dc2626; }
  .filtro-btn {
    padding: 4px 10px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: #fff;
    font-size: 12px;
    font-weight: 500;
    font-family: var(--font);
    color: #6b7280;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .filtro-btn:hover { background: #f3f4f6; }
  .filtro-btn.activo {
    background: #2563eb;
    border-color: #2563eb;
    color: white;
    font-weight: 600;
  }
  .filtro-btn.activo:hover { background: #1d4ed8; }
  .filtro-divider {
    height: 1px;
    background: var(--border);
    margin: 2px 0;
  }

  .trip-cluster {
    position: absolute;
    bottom: 80px;
    right: 16px;
    z-index: 500;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 8px;
  }

  .tiempo-chip {
    background: #ffffff;
    border: 1px solid var(--border);
    border-radius: 999px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.15);
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 600;
    color: #2563eb;
    display: flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
    font-family: var(--font);
  }
  .tiempo-chip-spin { color: var(--text-muted); }

  .route-bar {
    flex-shrink: 0;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
  }
  .route-bar .btn-group {
    justify-content: center;
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
  .geo-alert-header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .geo-alert-header-actions .geo-alert-btn {
    padding: 2px 8px;
    font-size: 11px;
    line-height: 1.4;
  }
  .geo-alert-reopen {
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 500;
    padding: 8px 14px;
    background: #fff7ed;
    color: #c2410c;
    border: 1px solid #fdba74;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    font-family: var(--font);
    box-shadow: 0 4px 14px rgba(0,0,0,0.15);
    transition: background 0.12s;
  }
  .geo-alert-reopen:hover { background: #ffedd5; }

  .floating-trip-card {
    position: relative;
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    width: 380px;
    height: 45vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .ftc-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    font-size: 14px;
    font-weight: 600;
    color: #111;
    border-bottom: 1px solid #e5e7eb;
  }
  .ftc-grupos-nav {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    overflow-x: auto;
    flex: 1;
  }
  .ftc-grupo-pill {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 6px;
    border: none;
    background: none;
    cursor: pointer;
    border-radius: 999px;
    font-family: var(--font);
    transition: background 0.12s;
    flex-shrink: 0;
  }
  .ftc-grupo-pill:hover { background: #f3f4f6; }
  .ftc-grupo-pill.activo { background: #eff6ff; }
  .ftc-grupo-dot {
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.2);
    color: #fff;
    font-size: 10px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    text-transform: uppercase;
    flex-shrink: 0;
    line-height: 1;
  }
  .ftc-grupo-pill.activo .ftc-grupo-dot {
    width: 26px;
    height: 26px;
    box-shadow: 0 0 0 2px #2563eb;
  }
  .ftc-grupo-nombre {
    font-size: 13px;
    font-weight: 600;
    color: #111;
    white-space: nowrap;
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
    flex: 1;
    min-height: 0;
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
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
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
  .edit-dir-label-piso { margin-top: 12px; }
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

  /* ── Factura actions in sidebar ── */
  .factura-actions { display: flex; gap: 4px; margin-top: 6px; }
  .btn-geo-suggest, .btn-edit-factura { padding: 3px 8px; font-size: 11px; border: 1px solid #d1d5db; border-radius: 5px; background: var(--bg-card); cursor: pointer; font-family: var(--font); color: var(--text-secondary); }
  .btn-geo-suggest:hover, .btn-edit-factura:hover { background: var(--bg-hover); color: var(--text-primary); }
  .btn-geo-suggest { border-color: #fde68a; color: #92400e; }
  .btn-geo-suggest:hover { background: #fffbeb; }
  .btn-edit-factura { border-color: #bfdbfe; color: #1e40af; }
  .btn-edit-factura:hover { background: #eff6ff; }
  .btn-ver-factura { padding: 3px 8px; font-size: 11px; background: transparent; border: none; border-radius: 5px; cursor: pointer; font-family: var(--font); color: #9ca3af; }
  .btn-ver-factura:hover { color: #6b7280; }

  /* ── Planning mode UI ── */
  .plan-header { padding: 0; }
  .plan-header h3 { font-size: 21px; font-weight: 700; margin: 0 0 4px 0; display: flex; align-items: center; justify-content: center; gap: 8px; }
  .mapa-bottom-center {
    position: absolute;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
    display: flex;
    gap: 8px;
  }
  .mapa-bottom-center .btn-guardar,
  .mapa-bottom-center .btn-enviar {
    padding: 12px 28px;
    font-size: 14px;
    font-weight: 700;
    border: none;
    border-radius: 12px;
    cursor: pointer;
    font-family: var(--font);
    box-shadow: 0 6px 22px rgba(0,0,0,0.3);
    transition: all 0.2s;
  }
  .mapa-bottom-center .btn-guardar { background: #059669; color: white; }
  .mapa-bottom-center .btn-guardar:hover:not(:disabled) { background: #047857; }
  .mapa-bottom-center .btn-guardar:disabled,
  .mapa-bottom-center .btn-enviar:disabled { opacity: 0.5; cursor: not-allowed; }
  .mapa-bottom-center .btn-enviar { background: #3b82f6; color: white; }
  .mapa-bottom-center .btn-enviar:hover:not(:disabled) { background: #2563eb; }
  .grupos-section { margin-bottom: 16px; }
  .grupos-header { display: flex; align-items: center; justify-content: flex-end; margin-bottom: 8px; font-size: 13px; font-weight: 600; color: var(--text-secondary); }
  .grupos-actions { display: flex; gap: 4px; }
  .btn-sm { padding: 4px 10px; font-size: 12px; border: 1px solid #d1d5db; border-radius: 5px; background: var(--bg-card); cursor: pointer; font-family: var(--font); color: var(--text-primary); }
  .btn-sm:hover { background: var(--bg-hover); }
  .grupo-card { display: flex; flex-direction: column; gap: 0; padding: 8px 10px; border-radius: 6px; cursor: pointer; margin-bottom: 4px; background: var(--bg-card); border: 1.5px solid transparent; transition: border-color 0.15s; }
  .grupo-card:hover { border-color: #d1d5db; }
  .grupo-card.activo { border-color: #3b82f6; background: #eff6ff; }
  .grupo-card-header { display: flex; align-items: center; gap: 8px; width: 100%; }
  .grupo-dot {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    flex-shrink: 0;
    color: #fff;
    font-size: 9px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    text-transform: uppercase;
    letter-spacing: 0.2px;
    border: 2px solid #fff;
    box-shadow: 0 0 0 1px rgba(0,0,0,0.12);
  }
  .grupo-nombre {
    flex: 1;
    min-width: 0;
    font-size: 13px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: none;
    background: none;
    padding: 0;
    text-align: left;
    cursor: pointer;
    font-family: var(--font);
    color: inherit;
  }
  .grupo-nombre:hover { color: #2563eb; }
  .grupo-nombre-input { flex: 1; min-width: 0; font-size: 13px; font-weight: 500; padding: 2px 6px; border: 1px solid #3b82f6; border-radius: 4px; font-family: var(--font); background: #fff; color: #111; }
  .grupo-count { font-size: 11px; color: var(--text-secondary); background: var(--bg-hover); padding: 2px 8px; border-radius: 10px; flex-shrink: 0; }
  .grupo-alert-bajo { display: flex; align-items: flex-start; gap: 8px; background: #fef3c7; border: 1px solid #fcd34d; color: #92400e; border-radius: 8px; padding: 8px 10px; margin: 0 0 8px; font-size: 12px; line-height: 1.4; }
  .grupo-alert-text { flex: 1; }
  .grupo-alert-btn { flex-shrink: 0; padding: 4px 10px; border: none; border-radius: 6px; background: #b45309; color: #fff; font-size: 12px; font-weight: 600; cursor: pointer; }
  .grupo-alert-btn:hover { background: #92400e; }
  .grupo-rename { padding: 2px 6px; font-size: 12px; border: none; background: none; cursor: pointer; color: var(--text-tertiary); border-radius: 4px; line-height: 1; flex-shrink: 0; }
  .grupo-rename:hover { color: #2563eb; background: #eff6ff; }
  .grupo-del { padding: 2px 6px; font-size: 12px; border: none; background: none; cursor: pointer; color: var(--text-tertiary); border-radius: 4px; flex-shrink: 0; }
  .grupo-del:hover { color: #dc2626; background: #fef2f2; }
  .grupo-card-clientes {
    margin-top: 6px;
    padding-top: 6px;
    border-top: 1px dashed var(--border);
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .grupo-card-cliente {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 5px;
    background: var(--bg);
    border: 1px solid var(--border);
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
  }
  .grupo-card-cliente:hover { background: var(--bg-hover); border-color: #d1d5db; }
  .grupo-card-cliente-num {
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
  .grupo-card-cliente-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .grupo-card-cliente-nombre {
    font-size: 12px;
    font-weight: 500;
    color: #111;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .grupo-card-cliente-dir {
    font-size: 11px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .grupo-card-cliente-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }
  .grupo-card-cliente-btn {
    padding: 2px 4px;
    font-size: 11px;
    border: none;
    background: none;
    cursor: pointer;
    border-radius: 4px;
    line-height: 1;
    font-family: var(--font);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .grupo-card-cliente-btn:hover { background: var(--bg-hover); }
  .grupo-card-btn-text {
    color: #9ca3af;
    font-weight: 500;
    white-space: nowrap;
  }
  .grupo-card-btn-text:hover { color: #6b7280; }
</style>

