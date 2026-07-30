const SUCIEDADES = [
  /P[Bb]\s*\d+/g,
  /Piso\s*\d+°/g,
  /Piso\s*\d+/g,
  /\bP\.?\s*,?\s*\d+/g,
  /\b[1-6]°\s*Piso/g,
  /D[tp]o\.?\s*\w+/g,
  /Oficina\s*\d+/g,
  /Local\s*\d+/g,
  /Casa\s*\d+/g,
  /Torre\s*\w+/g,
  /Edificio\s*\w+/g,
  /Block\s*\w+/g,
  /Manzana\s*\w+/g,
  /Lote\s*\d+/g,
  /Pabell[oó]n\s*\w+/g,
  /Sector\s*\w+/g,
  /M[oó]dulo\s*\w+/g,
  /Departamento\s*\w+/g,
];

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

export function nominatimSearchUrl(direccion: string): string {
  const limpia = limpiarDireccion(direccion);
  const q = encodeURIComponent(`${limpia}, Buenos Aires, Argentina`);
  return `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=ar&addressdetails=1&viewbox=${NOMINATIM_VIEWBOX_AMBA}`;
}

export function nominatimReverseUrl(lat: number, lng: number): string {
  return `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&countrycodes=ar`;
}
