let _fecha = $state(new Date().toISOString().split('T')[0]);
let _busqueda = $state('');
let _origenDireccion = $state('Bermudez 331');
let _origenCoords = $state<{ lat: number; lng: number } | null>(null);
let _editandoOrigen = $state(false);
let _geocodificandoOrigen = $state(false);
let _pendientesCount = $state(0);
let _filtroPendientes = $state(false);
let _busquedaCoords = $state<{ lat: number; lng: number } | null>(null);

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

	get geocodificarOrigen() { return _geocodificarFn; },
	set geocodificarOrigen(fn: (() => Promise<void>) | null) { _geocodificarFn = fn; },

	get guardarOrigen() { return _guardarFn; },
	set guardarOrigen(fn: (() => Promise<void>) | null) { _guardarFn = fn; },
};
