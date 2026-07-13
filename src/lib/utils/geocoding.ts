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

export function nominatimSearchUrl(direccion: string): string {
  const limpia = limpiarDireccion(direccion);
  const q = encodeURIComponent(`${limpia}, Buenos Aires, Argentina`);
  return `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=ar&viewbox=${NOMINATIM_VIEWBOX_AMBA}`;
}

export function nominatimReverseUrl(lat: number, lng: number): string {
  return `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&countrycodes=ar`;
}
