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

export function formatearDireccionNominatim(r: { display_name: string; address?: Record<string, string> }): string {
  const addr = r.address;
  if (addr) {
    const calle = addr.road || addr.pedestrian || addr.street || '';
    const numero = addr.house_number || '';
    const estado = addr.state || '';
    const ciudad = addr.city || addr.town || addr.village || addr.municipality || '';

    let direccion = '';
    if (calle && numero) {
      direccion = `${calle} ${numero}`;
    } else if (calle) {
      direccion = calle;
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

/**
 * CABA primero cuando el usuario lo pidió (caba/capital) o cuando no nombró
 * ninguna localidad ("Corrientes 1234" → CABA, "Mitre 500, Ramos Mejía" → se
 * respeta el orden de Nominatim). Se limpia antes para no confundir la coma de
 * "piso 3" con una localidad.
 *
 * Si la búsqueda trae número de puerta, descarta las coincidencias que vienen
 * solo con la calle (el clásico "Junín 1173" → "Junín, Balvanera" sin número).
 */
export function mejoresResultados<T extends { address?: Record<string, string> }>(results: T[], texto: string): T[] {
  const limpio = limpiarDireccion(texto || '');
  const ordenados = LOCALIDAD_CABA.test(limpio) || !limpio.includes(',')
    ? [...results].sort((a, b) => Number(esResultadoCABA(b)) - Number(esResultadoCABA(a)))
    : results;

  if (/\d{1,5}/.test(limpio)) {
    const conNumero = ordenados.filter(r => !!r.address?.house_number);
    if (conNumero.length > 0) return conNumero;
  }
  return ordenados;
}

export function nominatimSearchUrl(direccion: string): string {
  const limpia = normalizarQueryDireccion(direccion);
  const q = encodeURIComponent(`${limpia}, Buenos Aires, Argentina`);
  return `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=8&countrycodes=ar&addressdetails=1&viewbox=${NOMINATIM_VIEWBOX_AMBA}`;
}

export function nominatimReverseUrl(lat: number, lng: number): string {
  return `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&countrycodes=ar`;
}
