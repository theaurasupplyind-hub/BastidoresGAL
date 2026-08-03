import type { GrupoCliente, PlanDeViaje, RecomendacionCliente } from '$lib/types';

let _fecha = $state(new Date().toISOString().split('T')[0]);
let _busqueda = $state('');
let _origenDireccion = $state('Bermudez 331');
let _origenCoords = $state<{ lat: number; lng: number } | null>(null);
let _editandoOrigen = $state(false);
let _geocodificandoOrigen = $state(false);
let _pendientesCount = $state(0);
let _filtroPendientes = $state(false);
let _filtroRecencia = $state(0);
let _filtroKanban = $state<string[]>([]);
let _cargando = $state(false);
let _planAutoGenerado = $state(false);
let _busquedaCoords = $state<{ lat: number; lng: number } | null>(null);

let _modoProgramar = $state(true);
let _grupos = $state<Map<string, GrupoCliente>>(new Map());
let _grupoActivoId = $state<string | null>(null);
let _planViajeId = $state<string | null>(null);

let _algoMinPorGrupo = $state(3);
let _algoMaxPorGrupo = $state(6);
let _algoEpsKm = $state(8);
let _algoRadioCercanosM = $state(500);

let _recomendaciones = $state<RecomendacionCliente[]>([]);
let _recomendando = $state(false);
let _mostrarRecomendados = $state(false);

let _regenerandoPlan = $state(false);

let _geoAlertReadOculto = $state(false);
let _geoAlertReadColapsado = $state(false);

let _estiloMapa = $state<string>(() => {
  try {
    return localStorage.getItem('mapa-estilo') || 'osm';
  } catch {
    return 'osm';
  }
});

let _geocodificarFn: (() => Promise<void>) | null = null;
let _guardarFn: (() => Promise<void>) | null = null;

export const mapaStore = {
	get fecha() { return _fecha; },
	set fecha(v: string) { _fecha = v; },

	get busqueda() { return _busqueda; },
	set busqueda(v: string) { _busqueda = v; },

	get busquedaCoords() { return _busquedaCoords; },
	set busquedaCoords(v: { lat: number; lng: number } | null) { _busquedaCoords = v; },

	get origenDireccion() { return _origenDireccion; },
	set origenDireccion(v: string) { _origenDireccion = v; },

	get origenCoords() { return _origenCoords; },
	set origenCoords(v: { lat: number; lng: number } | null) { _origenCoords = v; },

	get editandoOrigen() { return _editandoOrigen; },
	set editandoOrigen(v: boolean) { _editandoOrigen = v; },

	get geocodificandoOrigen() { return _geocodificandoOrigen; },
	set geocodificandoOrigen(v: boolean) { _geocodificandoOrigen = v; },

	get pendientesCount() { return _pendientesCount; },
	set pendientesCount(v: number) { _pendientesCount = v; },

	get filtroPendientes() { return _filtroPendientes; },
	set filtroPendientes(v: boolean) { _filtroPendientes = v; },

	get filtroRecencia() { return _filtroRecencia; },
	set filtroRecencia(v: number) { _filtroRecencia = v; },

	get filtroKanban() { return _filtroKanban; },
	set filtroKanban(v: string[]) { _filtroKanban = v; },

	get cargando() { return _cargando; },
	set cargando(v: boolean) { _cargando = v; },

	get planAutoGenerado() { return _planAutoGenerado; },
	set planAutoGenerado(v: boolean) { _planAutoGenerado = v; },

	get modoProgramar() { return _modoProgramar; },
	set modoProgramar(v: boolean) { _modoProgramar = v; },

	get grupos() { return _grupos; },
	set grupos(v: Map<string, GrupoCliente>) { _grupos = v; },

	get grupoActivoId() { return _grupoActivoId; },
	set grupoActivoId(v: string | null) { _grupoActivoId = v; },

	get planViajeId() { return _planViajeId; },
	set planViajeId(v: string | null) { _planViajeId = v; },

	get algoMinPorGrupo() { return _algoMinPorGrupo; },
	set algoMinPorGrupo(v: number) { _algoMinPorGrupo = v; },

	get algoMaxPorGrupo() { return _algoMaxPorGrupo; },
	set algoMaxPorGrupo(v: number) { _algoMaxPorGrupo = v; },

	get algoEpsKm() { return _algoEpsKm; },
	set algoEpsKm(v: number) { _algoEpsKm = v; },

	get algoRadioCercanosM() { return _algoRadioCercanosM; },
	set algoRadioCercanosM(v: number) { _algoRadioCercanosM = v; },

	get recomendaciones() { return _recomendaciones; },
	set recomendaciones(v: RecomendacionCliente[]) { _recomendaciones = v; },

	get recomendando() { return _recomendando; },
	set recomendando(v: boolean) { _recomendando = v; },

	get mostrarRecomendados() { return _mostrarRecomendados; },
	set mostrarRecomendados(v: boolean) { _mostrarRecomendados = v; },

	get regenerandoPlan() { return _regenerandoPlan; },
	set regenerandoPlan(v: boolean) { _regenerandoPlan = v; },

	get geoAlertReadOculto() { return _geoAlertReadOculto; },
	set geoAlertReadOculto(v: boolean) { _geoAlertReadOculto = v; },

	get geoAlertReadColapsado() { return _geoAlertReadColapsado; },
	set geoAlertReadColapsado(v: boolean) { _geoAlertReadColapsado = v; },

	get estiloMapa() { return _estiloMapa; },
	set estiloMapa(v: string) {
		_estiloMapa = v;
		try { localStorage.setItem('mapa-estilo', v); } catch {}
	},

	get geocodificarOrigen() { return _geocodificarFn; },
	set geocodificarOrigen(fn: (() => Promise<void>) | null) { _geocodificarFn = fn; },

	get guardarOrigen() { return _guardarFn; },
	set guardarOrigen(fn: (() => Promise<void>) | null) { _guardarFn = fn; },
};
