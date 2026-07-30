import type { GrupoCliente, PlanDeViaje } from '$lib/types';

let _fecha = $state(new Date().toISOString().split('T')[0]);
let _busqueda = $state('');
let _origenDireccion = $state('Bermudez 331');
let _origenCoords = $state<{ lat: number; lng: number } | null>(null);
let _editandoOrigen = $state(false);
let _geocodificandoOrigen = $state(false);
let _pendientesCount = $state(0);
let _filtroPendientes = $state(false);
let _filtroRecencia = $state(0);
let _planAutoGenerado = $state(false);
let _busquedaCoords = $state<{ lat: number; lng: number } | null>(null);

let _modoProgramar = $state(false);
let _grupos = $state<Map<string, GrupoCliente>>(new Map());
let _grupoActivoId = $state<string | null>(null);
let _planViajeId = $state<string | null>(null);

let _algoMinPorGrupo = $state(2);
let _algoMaxPorGrupo = $state(0);
let _algoEpsKm = $state(4);
let _algoMostrarPanel = $state(false);

let _mostrarCercanos = $state(false);
let _cargandoCercanos = $state(false);
let _reporteCercanos = $state<Map<number, { factura: any; cercanos: { cliente: any; distanciaKm: number; coords: { lat: number; lng: number } }[] }>>(new Map());

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

	get algoMostrarPanel() { return _algoMostrarPanel; },
	set algoMostrarPanel(v: boolean) { _algoMostrarPanel = v; },

	get mostrarCercanos() { return _mostrarCercanos; },
	set mostrarCercanos(v: boolean) { _mostrarCercanos = v; },

	get cargandoCercanos() { return _cargandoCercanos; },
	set cargandoCercanos(v: boolean) { _cargandoCercanos = v; },

	get reporteCercanos() { return _reporteCercanos; },
	set reporteCercanos(v: Map<number, { factura: any; cercanos: { cliente: any; distanciaKm: number; coords: { lat: number; lng: number } }[] }>) { _reporteCercanos = v; },

	get geocodificarOrigen() { return _geocodificarFn; },
	set geocodificarOrigen(fn: (() => Promise<void>) | null) { _geocodificarFn = fn; },

	get guardarOrigen() { return _guardarFn; },
	set guardarOrigen(fn: (() => Promise<void>) | null) { _guardarFn = fn; },
};
