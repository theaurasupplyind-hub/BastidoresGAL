import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

// Se marcan con /i: en facturas suelen venir en minúscula ("piso 3", "dto b")
// y con el flag original no se limpiaban.
const SUCIEDADES = [
  /P[Bb]\s*\d+/gi,
  /Piso\s*\d+°/gi,
  /Piso\s*\d+/gi,
  /\bP\.?\s*,?\s*\d+/gi,
  /\b[1-6]°\s*Piso/gi,
  /D[tp]o\.?\s*\w+/gi,
  /Oficina\s*\d+/gi,
  /Local\s*\d+/gi,
  /Casa\s*\d+/gi,
  /Torre\s*\w+/gi,
  /Edificio\s*\w+/gi,
  /Block\s*\w+/gi,
  /Manzana\s*\w+/gi,
  /Lote\s*\d+/gi,
  /Pabell[oó]n\s*\w+/gi,
  /Sector\s*\w+/gi,
  /M[oó]dulo\s*\w+/gi,
  /Departamento\s*\w+/gi,
];

// Direcciones por kilómetro: el "50" no es un número de puerta.
const ES_POR_KILOMETRO = /\b(km|kil[oó]metro[s]?)\b/i;

const LOCALIDAD_CABA = /\b(caba|capital federal|ciudad aut[oó]noma)\b/i;

const NOMINATIM_VIEWBOX_AMBA = '-58.85,-34.42,-58.15,-34.85';

const NOMINATIM_CACHE_TTL_MS = 10 * 60 * 1000;
// Política de uso de Nominatim: como máximo 1 consulta por segundo.
const NOMINATIM_MIN_INTERVALO_MS = 1050;
const NOMINATIM_CACHE_MAX = 120;

// Palabras que no aportan al comparar el nombre de una calle.
const PALABRAS_GENERICAS = new Set([
  'de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'do', 'dos', 'das',
  'av', 'avda', 'avenida', 'calle', 'pasaje', 'pje', 'diagonal', 'boulevard',
  'caba', 'capital', 'federal', 'ciudad', 'autonoma', 'buenos', 'aires', 'argentina',
]);

// Conectores que se mantienen completos al abreviar un nombre de calle.
const CONECTORES_CALLE = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e', 'da', 'das', 'do', 'dos']);

export interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  class?: string;
  type?: string;
  address?: Record<string, string>;
  [key: string]: unknown;
}

export interface BuscarDireccionesOptions {
  limit?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxConsultas?: number;
}

function normalizar(texto: string): string {
  return (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function abortError(): DOMException {
  return new DOMException('Búsqueda cancelada', 'AbortError');
}

export function limpiarDireccion(dir: string): string {
  if (!dir) return '';
  let limpia = dir.trim();
  for (const re of SUCIEDADES) {
    limpia = limpia.replace(re, '');
  }
  limpia = limpia.replace(/,+/g, ',');
  limpia = limpia.replace(/\s+,/g, ',');
  limpia = limpia.replace(/,\s+/g, ',');
  limpia = limpia.replace(/\s{2,}/g, ' ');
  limpia = limpia.replace(/,\s*$/, '');
  limpia = limpia.trim();
  return limpia || dir.trim();
}

export function formatearDireccionNominatim(r: { display_name: string; name?: string; address?: Record<string, string> }): string {
  const addr = r.address;
  if (addr) {
    const calle = addr.road || addr.pedestrian || addr.street || addr.footway || '';
    const numero = addr.house_number || '';
    const estado = addr.state || '';
    const ciudad = addr.city || addr.town || addr.village || addr.municipality || '';

    let direccion = '';
    if (calle && numero) {
      direccion = `${calle} ${numero}`;
    } else if (calle) {
      direccion = calle;
    } else if (r.name) {
      direccion = r.name;
    } else {
      const parts = r.display_name.split(',').map(s => s.trim());
      direccion = parts.slice(0, 2).join(' ');
    }

    const barrio = addr.suburb || addr.neighbourhood || '';
    if (barrio) {
      direccion += `, ${barrio}`;
    }

    if (estado.includes('Ciudad Autónoma de Buenos Aires')) {
      direccion += ', CABA';
    } else if (ciudad) {
      direccion += `, ${ciudad}`;
    } else if (estado) {
      direccion += `, ${estado.replace(/^Provincia de /, '')}`;
    }

    return direccion;
  }

  const parts = r.display_name.split(',').map(s => s.trim());
  const calle = parts[1] || '';
  const numero = parts[0] || '';
  let direccion = calle && numero ? `${calle} ${numero}` : (calle || numero);

  if (parts[2]) {
    direccion += `, ${parts[2].trim()}`;
  }

  const estado = parts[5] || '';
  if (estado.includes('Ciudad Autónoma de Buenos Aires')) {
    direccion += ', CABA';
  } else if (parts[3]) {
    direccion += `, ${parts[3].trim()}`;
  }

  return direccion;
}

/**
 * Nominatim ignora el número de puerta cuando el texto va "calle número"
 * (busca "Junín 1173" como si fuera un lugar y devuelve la calle o un local).
 * Enviando "1173 Junín" sí devuelve la dirección exacta.
 * Devuelve el texto tal cual si no hay número de puerta.
 */
export function normalizarQueryDireccion(direccion: string): string {
  const limpia = limpiarDireccion(direccion);
  const partes = limpia.split(',');
  const primerTramo = (partes[0] ?? '').trim();
  const resto = partes.slice(1).join(',').trim();
  if (!primerTramo || ES_POR_KILOMETRO.test(limpia)) return limpia;

  // Ya viene con el número adelante → no tocar.
  if (/^\d{1,5}(?:\s*bis)?\s+\S/i.test(primerTramo)) return limpia;

  const fin = primerTramo.match(/^(.+?)\s+(\d{1,5})(\s*bis)?$/i);
  if (!fin) return limpia;

  const numero = `${fin[2]}${fin[3] ?? ''}`.trim();
  const tramo = `${numero} ${fin[1].trim()}`;
  return resto ? `${tramo}, ${resto}` : tramo;
}

export function esResultadoCABA(r: { address?: Record<string, string> }): boolean {
  const addr = r.address;
  if (!addr) return false;
  return (addr.state ?? '').includes('Ciudad Autónoma de Buenos Aires') || addr['ISO3166-2-lvl4'] === 'AR-C';
}

function numeroDeDireccion(texto: string): string {
  const limpio = limpiarDireccion(texto || '');
  if (!limpio || ES_POR_KILOMETRO.test(limpio)) return '';
  const primerTramo = (limpio.split(',')[0] ?? '').trim();
  // "Calle 1234" o "1234 Calle" (con o sin bis). Se ignora "9 de Julio".
  const fin = primerTramo.match(/^(.+?)\s+(\d{1,5})(?:\s*bis)?$/i);
  if (fin) return fin[2];
  const inicio = primerTramo.match(/^(\d{1,5})(?:\s*bis)?\s+(.+)$/i);
  if (inicio && !/^(de|del)\b/i.test(inicio[2].trim())) return inicio[1];
  return '';
}

function coincideAltura(r: NominatimResult, numero: string): boolean {
  if (!numero) return false;
  const hn = String(r.address?.house_number ?? '').replace(/\D/g, '');
  return !!hn && hn === numero;
}

/**
 * "Marcelo Torcuato de Alvear" → "Marcelo T. de Alvear".
 * En OSM muchas calles de CABA están abreviadas, así que la búsqueda con el
 * nombre completo no las encuentra. Se mantienen la primera y la última
 * palabra y se abrevian las del medio.
 */
export function abreviarNombreCalle(calle: string): string {
  const palabras = (calle || '').trim().split(/\s+/).filter(Boolean);
  if (palabras.length < 3) return calle;
  return palabras
    .map((palabra, i) => {
      if (i === 0 || i === palabras.length - 1) return palabra;
      const norm = normalizar(palabra);
      if (CONECTORES_CALLE.has(norm) || palabra.length <= 2 || /\d/.test(palabra)) return palabra;
      return `${palabra[0].toUpperCase()}.`;
    })
    .join(' ');
}

function ultimaPalabraCalle(calle: string): string {
  const palabras = (calle || '').trim().split(/\s+/).filter(Boolean);
  for (let i = palabras.length - 1; i >= 0; i--) {
    const norm = normalizar(palabras[i]);
    if (palabras[i].length > 2 && !CONECTORES_CALLE.has(norm) && !PALABRAS_GENERICAS.has(norm)) {
      return palabras[i];
    }
  }
  return '';
}

function separarCalleYNumero(tramo: string): { calle: string; numero: string } {
  if (!tramo || ES_POR_KILOMETRO.test(tramo)) return { calle: tramo, numero: '' };

  const fin = tramo.match(/^(.*?)[\s,]+(\d{1,5})(?:\s*bis)?$/i);
  if (fin && fin[1].trim()) return { calle: fin[1].trim(), numero: fin[2] };

  const inicio = tramo.match(/^(\d{1,5})(?:\s*bis)?\s+(.+)$/i);
  if (inicio && !/^(de|del)\b/i.test(inicio[2].trim())) {
    return { calle: inicio[2].trim(), numero: inicio[1] };
  }
  return { calle: tramo, numero: '' };
}

/**
 * Lista ordenada de consultas para Nominatim. Prueba primero el texto tal
 * cual, después el nombre abreviado de la calle (OSM suele tener "Marcelo T.
 * de Alvear" y no el nombre completo), luego el número adelante y, por
 * último, sin altura. El sufijo por defecto es CABA (no "Buenos Aires",
 * que hacía que direcciones de CABA cayeran en Quilmes).
 */
export function construirConsultasDireccion(direccion: string): string[] {
  const limpia = limpiarDireccion(direccion);
  if (!limpia) return [];

  const teniaLocalidad = limpia.includes(',');
  const esCaba = LOCALIDAD_CABA.test(limpia);

  // "caba"/"capital federal" se reemplazan por el nombre completo; si no, la
  // consulta queda "..., caba, Buenos Aires, Argentina" y Nominatim no la
  // encuentra.
  const sinAlias = limpia
    .replace(/\b(caba|capital federal)\b/gi, '')
    .replace(/\s*,\s*/g, ', ')
    .replace(/(?:,\s*)+/g, ', ')
    .replace(/^,\s*|,\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const base = sinAlias || limpia;
  const partes = base.split(',');
  const tramo = (partes[0] ?? '').trim();
  const resto = partes.slice(1).join(', ').trim();
  if (!tramo) return [];

  const { calle, numero } = separarCalleYNumero(tramo);
  if (!calle) return [];

  const sufijoPrincipal = esCaba || !teniaLocalidad
    ? 'Ciudad Autónoma de Buenos Aires, Argentina'
    : 'Argentina';

  const armar = (nombreCalle: string, nro: string, orden: 'calle' | 'numero', sufijo: string): string => {
    const cuerpo = orden === 'numero' && nro
      ? `${nro} ${nombreCalle}`.trim()
      : `${nombreCalle} ${nro}`.trim();
    const conResto = [cuerpo, resto].filter(Boolean).join(', ');
    return `${conResto}, ${sufijo}`
      .replace(/\s+/g, ' ')
      .replace(/\s+,/g, ',')
      .replace(/,\s*,/g, ',')
      .trim();
  };

  const variantes = Array.from(new Set([
    calle,
    abreviarNombreCalle(calle),
    ultimaPalabraCalle(calle),
  ].map(s => s.trim()).filter(Boolean)));

  const consultas: string[] = [];
  const push = (q: string) => {
    const consulta = q.replace(/\s+/g, ' ').trim();
    if (consulta && !consultas.includes(consulta)) consultas.push(consulta);
  };

  if (numero) {
    // Tal cual y con la calle abreviada: los dos casos más frecuentes.
    for (const nombre of variantes.slice(0, 2)) push(armar(nombre, numero, 'calle', sufijoPrincipal));
    for (const nombre of variantes.slice(0, 2)) push(armar(nombre, numero, 'numero', sufijoPrincipal));
    for (const nombre of variantes.slice(2)) push(armar(nombre, numero, 'calle', sufijoPrincipal));
    // Último recurso: la calle sin altura (Nominatim devuelve la vía).
    for (const nombre of variantes.slice(0, 2)) push(armar(nombre, '', 'calle', sufijoPrincipal));
  } else {
    for (const nombre of variantes.slice(0, 2)) push(armar(nombre, '', 'calle', sufijoPrincipal));
  }

  // Si asumimos CABA y no apareció nada, reintentar como Provincia de Buenos
  // Aires (clientes de GBA que no escribieron la localidad).
  if (sufijoPrincipal.startsWith('Ciudad')) {
    const sufijoProvincia = 'Buenos Aires, Argentina';
    for (const nombre of variantes.slice(0, 2)) {
      push(armar(nombre, numero, 'calle', sufijoProvincia));
    }
  }

  return consultas;
}

/**
 * CABA primero cuando el usuario lo pidió (caba/capital) o cuando no nombró
 * ninguna localidad ("Corrientes 1234" → CABA, "Mitre 500, Ramos Mejía" → se
 * respeta el orden de Nominatim). Se limpia antes para no confundir la coma de
 * "piso 3" con una localidad.
 *
 * Ya no descarta las coincidencias sin altura: las ordena debajo de las que
 * tienen la altura exacta. Descartarlas hacía desaparecer la calle correcta
 * cuando otra localidad tenía una altura parecida.
 */
export function mejoresResultados<T extends { address?: Record<string, string>; display_name?: string; class?: string; type?: string }>(results: T[], texto: string): T[] {
  const limpio = limpiarDireccion(texto || '');
  const numero = numeroDeDireccion(limpio);
  const prefiereCaba = LOCALIDAD_CABA.test(limpio) || !limpio.includes(',');
  const calleTexto = normalizar((limpio.split(',')[0] ?? '').replace(/\b\d{1,5}(?:\s*bis)?\b/gi, ' '));
  const tokensCalle = calleTexto.split(/\s+/).filter(t => t.length > 2 && !PALABRAS_GENERICAS.has(t));

  const puntaje = (r: T): number => {
    const addr = r.address ?? {};
    let s = 0;

    const hn = String(addr.house_number ?? '').replace(/\D/g, '');
    if (numero) {
      if (hn === numero) s += 200;
      else if (hn) s += 20;
      else s -= 20;
    } else if (hn) {
      s += 10;
    }

    const via = normalizar([
      addr.road, addr.pedestrian, addr.street, addr.footway, addr.historic,
    ].filter(Boolean).join(' '));
    const campo = normalizar(String(r.display_name ?? ''));

    if (calleTexto && via.includes(calleTexto)) s += 80;
    for (const token of tokensCalle) {
      if (via.includes(token)) s += 25;
      else if (campo.includes(token)) s += 12;
    }

    if (prefiereCaba) s += esResultadoCABA(r) ? 80 : -20;

    // Con altura pedida, una vía/dirección vale más que un POI (una tumba,
    // un hotel) que casualmente se llama igual.
    if (numero && !hn && r.class && /^(highway|place|building|address)$/.test(r.class)) {
      s += 25;
    }

    return s;
  };

  const ordenados = [...results].sort((a, b) => puntaje(b) - puntaje(a));
  if (!numero) return ordenados;

  // Si hay resultados que son direcciones de verdad, los POIs solo agregan
  // ruido (ej. la tumba de Marcelo Torcuato de Alvear en Recoleta).
  const soloDirecciones = ordenados.filter(r => !/^(historic|tourism|amenity|office|shop|leisure|man_made)$/.test(String(r.class ?? '')));
  return soloDirecciones.length > 0 ? soloDirecciones : ordenados;
}

function nominatimUrl(consulta: string, limit: number): string {
  const params = new URLSearchParams({
    q: consulta,
    format: 'json',
    limit: String(limit),
    countrycodes: 'ar',
    addressdetails: '1',
    'accept-language': 'es',
    viewbox: NOMINATIM_VIEWBOX_AMBA,
  });
  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
}

export function nominatimSearchUrl(direccion: string): string {
  const consultas = construirConsultasDireccion(direccion);
  const q = consultas[0] ?? normalizarQueryDireccion(direccion);
  return nominatimUrl(q, 8);
}

export function nominatimReverseUrl(lat: number, lng: number): string {
  return `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&countrycodes=ar`;
}

function esperar(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const limpiar = () => {
      clearTimeout(id);
      signal?.removeEventListener('abort', alAbortar);
    };
    const alAbortar = () => {
      limpiar();
      reject(abortError());
    };
    const id = setTimeout(() => {
      limpiar();
      resolve();
    }, ms);
    if (signal?.aborted) {
      alAbortar();
      return;
    }
    signal?.addEventListener('abort', alAbortar, { once: true });
  });
}

const cacheConsultas = new Map<string, { t: number; data: NominatimResult[] }>();
const cacheResultados = new Map<string, { t: number; data: NominatimResult[] }>();
let ultimaConsulta = 0;

function guardarCache(cache: Map<string, { t: number; data: NominatimResult[] }>, clave: string, data: NominatimResult[]) {
  cache.set(clave, { t: Date.now(), data });
  while (cache.size > NOMINATIM_CACHE_MAX) {
    const primera = cache.keys().next().value;
    if (primera === undefined) break;
    cache.delete(primera);
  }
}

function leerCache(cache: Map<string, { t: number; data: NominatimResult[] }>, clave: string): NominatimResult[] | null {
  const entry = cache.get(clave);
  if (!entry) return null;
  if (Date.now() - entry.t > NOMINATIM_CACHE_TTL_MS) {
    cache.delete(clave);
    return null;
  }
  return entry.data;
}

async function pedirJson(url: string, timeoutMs: number, signal?: AbortSignal): Promise<NominatimResult[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const alAbortar = () => controller.abort();
  signal?.addEventListener('abort', alAbortar, { once: true });

  try {
    const init: RequestInit = {
      headers: { 'User-Agent': 'BastidoresGal/1.0 (facturación; contacto: soporte@bastidores.local)' },
      signal: controller.signal,
    };
    let res: Response;
    try {
      // En la app usamos el plugin-http (User-Agent real y sin CORS). En
      // navegación/dev caemos al fetch normal.
      res = await tauriFetch(url, init);
    } catch (e) {
      if (signal?.aborted) throw e;
      res = await fetch(url, init);
    }
    if (!res.ok) throw new Error(`Nominatim respondió ${res.status}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', alAbortar);
  }
}

async function consultarNominatim(consulta: string, limit: number, timeoutMs: number, signal?: AbortSignal): Promise<NominatimResult[]> {
  const url = nominatimUrl(consulta, limit);
  const cacheado = leerCache(cacheConsultas, url);
  if (cacheado) return cacheado;

  const espera = NOMINATIM_MIN_INTERVALO_MS - (Date.now() - ultimaConsulta);
  if (espera > 0) await esperar(espera, signal);
  if (signal?.aborted) throw abortError();
  ultimaConsulta = Date.now();

  const data = await pedirJson(url, timeoutMs, signal);
  guardarCache(cacheConsultas, url, data);
  return data;
}

/**
 * Busca una dirección en Nominatim probando varias formas de la consulta y
 * quedándose con la mejor. Corta apenas encuentra la altura exacta para no
 * gastar consultas (Nominatim permite 1 por segundo).
 */
export async function buscarDirecciones(direccion: string, opts: BuscarDireccionesOptions = {}): Promise<NominatimResult[]> {
  const { limit = 8, signal, timeoutMs = 8000, maxConsultas = 4 } = opts;
  const consultas = construirConsultasDireccion(direccion);
  if (consultas.length === 0) return [];

  const clave = normalizar(direccion);
  const memorizado = leerCache(cacheResultados, clave);
  if (memorizado) return memorizado;

  const numero = numeroDeDireccion(direccion);
  const acumulados: NominatimResult[] = [];
  const vistos = new Set<string>();
  let conResultados = 0;

  for (let i = 0; i < consultas.length && i < maxConsultas; i++) {
    if (signal?.aborted) throw abortError();

    let data: NominatimResult[];
    try {
      data = await consultarNominatim(consultas[i], limit, timeoutMs, signal);
    } catch (e) {
      if (signal?.aborted) throw e;
      continue;
    }

    if (data.length > 0) conResultados++;
    for (const r of data) {
      const claveResultado = normalizar(String(r.display_name ?? ''));
      if (!claveResultado || vistos.has(claveResultado)) continue;
      vistos.add(claveResultado);
      acumulados.push(r);
    }

    const hayAlturaExacta = numero ? acumulados.some(r => coincideAltura(r, numero)) : false;
    if (hayAlturaExacta) break;
    if (!numero && acumulados.length > 0) break;
    // Dos consultas con resultados y ninguna altura exacta: ya no vale la
    // pena seguir probando variantes.
    if (conResultados >= 2) break;
  }

  const finales = mejoresResultados(acumulados, direccion).slice(0, limit);
  guardarCache(cacheResultados, clave, finales);
  return finales;
}
