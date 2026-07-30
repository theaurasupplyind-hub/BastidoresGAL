import { lineString, point } from '@turf/helpers';
import buffer from '@turf/buffer';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';

export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * sinDLng * sinDLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
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

export function dbscan(
  points: { lat: number; lng: number }[],
  epsKm: number,
  minPts: number
): number[] {
  const n = points.length;
  const labels = new Array<number>(n).fill(-1);
  let clusterId = 0;

  for (let i = 0; i < n; i++) {
    if (labels[i] !== -1) continue;
    const neighbors = rangeQuery(points, i, epsKm);
    if (neighbors.length < minPts) {
      labels[i] = -2;
      continue;
    }
    labels[i] = clusterId;
    const seedSet = [...neighbors];
    for (let j = 0; j < seedSet.length; j++) {
      const q = seedSet[j];
      if (labels[q] === -2) { labels[q] = clusterId; }
      if (labels[q] !== -1) continue;
      labels[q] = clusterId;
      const qNeighbors = rangeQuery(points, q, epsKm);
      if (qNeighbors.length >= minPts) {
        for (const n of qNeighbors) {
          if (!seedSet.includes(n)) seedSet.push(n);
        }
      }
    }
    clusterId++;
  }
  return labels;
}

function rangeQuery(points: { lat: number; lng: number }[], idx: number, epsKm: number): number[] {
  const neighbors: number[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i === idx) continue;
    if (haversine(points[idx], points[i]) <= epsKm) {
      neighbors.push(i);
    }
  }
  return neighbors;
}
