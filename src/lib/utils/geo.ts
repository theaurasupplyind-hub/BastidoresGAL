import { lineString, point } from '@turf/helpers';
import buffer from '@turf/buffer';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';

export function decodePolyline(encoded: string): [number, number][] {
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

export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinDLng * sinDLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function distanciaAPolilinea(punto: { lat: number; lng: number }, coords: { lat: number; lng: number }[]): number {
  if (coords.length === 0) return Infinity;
  if (coords.length === 1) return haversine(punto, coords[0]);
  let min = Infinity;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    const d = distanciaPuntoSegmentoKm(punto, a, b);
    if (d < min) min = d;
  }
  return min;
}

function distanciaPuntoSegmentoKm(p: { lat: number; lng: number }, a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const pLat = p.lat * Math.PI / 180;
  const pLng = p.lng * Math.PI / 180;
  const aLat = a.lat * Math.PI / 180;
  const aLng = a.lng * Math.PI / 180;
  const bLat = b.lat * Math.PI / 180;
  const bLng = b.lng * Math.PI / 180;

  const cos = Math.cos;
  const acos = Math.acos;
  const sin = Math.sin;

  const dA = acos(Math.max(-1, Math.min(1, cos(pLat) * cos(aLat) * cos(pLng - aLng) + sin(pLat) * sin(aLat))));
  const dB = acos(Math.max(-1, Math.min(1, cos(pLat) * cos(bLat) * cos(pLng - bLng) + sin(pLat) * sin(bLat))));
  const dAB = acos(Math.max(-1, Math.min(1, cos(aLat) * cos(bLat) * cos(aLng - bLng) + sin(aLat) * sin(bLat))));

  if (dA > dAB || dB > dAB) return Math.min(dA, dB) * 6371;

  const num = Math.abs(
    (bLat - aLat) * (aLng - pLng) - (aLat - pLat) * (bLng - pLng)
  );
  const den = Math.sqrt(Math.pow(bLat - aLat, 2) + Math.pow(bLng - aLng, 2));
  if (den === 0) return dA * 6371;

  const h = Math.asin(num / den);
  return h * 6371;
}

export function findCercanosRuta(
  routeLatLngs: [number, number][],
  candidatos: { id: number; lat: number; lng: number }[],
  bufferMeters = 300
): { id: number }[] {
  if (routeLatLngs.length < 2 || candidatos.length === 0) return [];

  const coords = routeLatLngs.map(([lat, lng]) => [lng, lat]);
  const line = lineString(coords);
  const buf = buffer(line, bufferMeters, { units: 'meters' });

  const result: { id: number }[] = [];
  for (const c of candidatos) {
    if (c.lat == null || c.lng == null) continue;
    const pt = point([c.lng, c.lat]);
    try {
      if (booleanPointInPolygon(pt, buf)) {
        result.push({ id: c.id });
      }
    } catch {
      // skip invalid geometries
    }
  }
  return result;
}


