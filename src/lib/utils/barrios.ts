import clustersDbscan from '@turf/clusters-dbscan';
import clustersKmeans from '@turf/clusters-kmeans';
import { featureCollection, point } from '@turf/helpers';
import { haversine } from '$lib/utils/geo';

type Zona = 'norte' | 'centro-norte' | 'centro' | 'oeste' | 'sur' | 'norte-gba' | 'oeste-gba' | 'sur-gba';

const BARRIO_ZONA: Record<string, Zona> = {
  // === CABA Norte ===
  'Núñez': 'norte',
  'Belgrano': 'norte',
  'Coghlan': 'norte',
  'Saavedra': 'norte',
  'Villa Urquiza': 'norte',

  // === CABA Centro-Norte ===
  'Palermo': 'centro-norte',
  'Colegiales': 'centro-norte',
  'Chacarita': 'centro-norte',
  'Villa Crespo': 'centro-norte',
  'La Paternal': 'centro-norte',
  'Villa del Parque': 'centro-norte',
  'Villa Devoto': 'centro-norte',
  'Villa Santa Rita': 'centro-norte',
  'Villa General Mitre': 'centro-norte',
  'Agronomía': 'centro-norte',
  'Parque Chas': 'centro-norte',
  'Villa Pueyrredón': 'centro-norte',
  'Villa Ortúzar': 'centro-norte',

  // === CABA Centro ===
  'Recoleta': 'centro',
  'Retiro': 'centro',
  'San Nicolás': 'centro',
  'Monserrat': 'centro',
  'Puerto Madero': 'centro',
  'Constitución': 'centro',
  'San Telmo': 'centro',
  'Balvanera': 'centro',
  'San Cristóbal': 'centro',

  // === CABA Oeste ===
  'Almagro': 'oeste',
  'Caballito': 'oeste',
  'Boedo': 'oeste',
  'Flores': 'oeste',
  'Parque Chacabuco': 'oeste',
  'Floresta': 'oeste',
  'Monte Castro': 'oeste',
  'Versalles': 'oeste',
  'Villa Luro': 'oeste',
  'Vélez Sarsfield': 'oeste',
  'Liniers': 'oeste',
  'Villa Real': 'oeste',

  // === CABA Sur ===
  'La Boca': 'sur',
  'Barracas': 'sur',
  'Parque Patricios': 'sur',
  'Nueva Pompeya': 'sur',
  'Parque Avellaneda': 'sur',
  'Mataderos': 'sur',
  'Villa Soldati': 'sur',
  'Villa Lugano': 'sur',
  'Villa Riachuelo': 'sur',

  // === GBA Norte ===
  'Vicente López': 'norte-gba',
  'Olivos': 'norte-gba',
  'Florida': 'norte-gba',
  'Munro': 'norte-gba',
  'Villa Adelina': 'norte-gba',
  'San Isidro': 'norte-gba',
  'Martínez': 'norte-gba',
  'Acassuso': 'norte-gba',
  'Beccar': 'norte-gba',
  'Boulogne': 'norte-gba',
  'San Fernando': 'norte-gba',
  'Victoria': 'norte-gba',
  'Virreyes': 'norte-gba',
  'Tigre': 'norte-gba',
  'Don Torcuato': 'norte-gba',
  'El Talar': 'norte-gba',
  'General Pacheco': 'norte-gba',
  'San Martín': 'norte-gba',
  'Villa Ballester': 'norte-gba',
  'San Andrés': 'norte-gba',
  'Villa Maipú': 'norte-gba',
  'Tres de Febrero': 'norte-gba',
  'Caseros': 'norte-gba',
  'Ciudadela': 'norte-gba',
  'Villa Bosch': 'norte-gba',
  'Villa Raffo': 'norte-gba',
  'El Palomar': 'norte-gba',

  // === GBA Oeste ===
  'Hurlingham': 'oeste-gba',
  'Villa Tesei': 'oeste-gba',
  'William C. Morris': 'oeste-gba',
  'Ituzaingó': 'oeste-gba',
  'Morón': 'oeste-gba',
  'Castelar': 'oeste-gba',
  'Haedo': 'oeste-gba',
  'La Matanza': 'oeste-gba',
  'San Justo': 'oeste-gba',
  'Ramos Mejía': 'oeste-gba',
  'Villa Luzuriaga': 'oeste-gba',
  'Isidro Casanova': 'oeste-gba',
  'Rafael Castillo': 'oeste-gba',
  'Laferrere': 'oeste-gba',
  'González Catán': 'oeste-gba',
  'Merlo': 'oeste-gba',
  'Pontevedra': 'oeste-gba',
  'Moreno': 'oeste-gba',
  'Paso del Rey': 'oeste-gba',

  // === GBA Sur ===
  'Avellaneda': 'sur-gba',
  'Wilde': 'sur-gba',
  'Dock Sud': 'sur-gba',
  'Sarandí': 'sur-gba',
  'Lanús': 'sur-gba',
  'Remedios de Escalada': 'sur-gba',
  'Gerli': 'sur-gba',
  'Monte Chingolo': 'sur-gba',
  'Valentín Alsina': 'sur-gba',
  'Lomas de Zamora': 'sur-gba',
  'Banfield': 'sur-gba',
  'Temperley': 'sur-gba',
  'Llavallol': 'sur-gba',
  'Almirante Brown': 'sur-gba',
  'Adrogué': 'sur-gba',
  'Burzaco': 'sur-gba',
  'Longchamps': 'sur-gba',
  'Glew': 'sur-gba',
  'Claypole': 'sur-gba',
  'Ministro Rivadavia': 'sur-gba',
  'Quilmes': 'sur-gba',
  'Bernal': 'sur-gba',
  'Ezpeleta': 'sur-gba',
  'San Francisco Solano': 'sur-gba',
  'Berazategui': 'sur-gba',
  'Hudson': 'sur-gba',
  'Plátanos': 'sur-gba',
  'Florencio Varela': 'sur-gba',
  'Esteban Echeverría': 'sur-gba',
  'Monte Grande': 'sur-gba',
  'El Jagüel': 'sur-gba',
  'Ezeiza': 'sur-gba',
  'Tristán Suárez': 'sur-gba',
  'José C. Paz': 'sur-gba',
  'Malvinas Argentinas': 'sur-gba',
  'Presidente Perón': 'sur-gba',
  'San Vicente': 'sur-gba',
  'Cañuelas': 'sur-gba',
};

const ZONA_NOMBRES: Record<Zona, string> = {
  'norte': 'Norte',
  'centro-norte': 'Centro-Norte',
  'centro': 'Centro',
  'oeste': 'Oeste',
  'sur': 'Sur',
  'norte-gba': 'GBA Norte',
  'oeste-gba': 'GBA Oeste',
  'sur-gba': 'GBA Sur',
};

const ZONA_CENTROID: Record<Zona, { lat: number; lng: number }> = {
  norte: { lat: -34.55, lng: -58.48 },
  'centro-norte': { lat: -34.59, lng: -58.45 },
  centro: { lat: -34.6, lng: -58.39 },
  oeste: { lat: -34.63, lng: -58.47 },
  sur: { lat: -34.65, lng: -58.43 },
  'norte-gba': { lat: -34.52, lng: -58.55 },
  'oeste-gba': { lat: -34.66, lng: -58.63 },
  'sur-gba': { lat: -34.75, lng: -58.4 },
};

const BARRIOS_ORDERED = Object.keys(BARRIO_ZONA).sort((a, b) => b.length - a.length);
const BARRIOS_NORM = BARRIOS_ORDERED.map(normalizar);

function normalizar(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function extraerBarrio(domicilio: string): string | null {
  if (!domicilio) return null;
  const norm = normalizar(domicilio);
  for (let i = 0; i < BARRIOS_ORDERED.length; i++) {
    const esc = BARRIOS_NORM[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^a-z0-9ñ])${esc}($|[^a-z0-9ñ])`).test(norm)) {
      return BARRIOS_ORDERED[i];
    }
  }
  return null;
}

export function zonaDeDomicilio(domicilio: string): { barrio: string | null; zona: string | null } {
  const barrio = extraerBarrio(domicilio);
  if (!barrio) return { barrio: null, zona: null };
  const zona = BARRIO_ZONA[barrio] ?? null;
  return { barrio, zona: zona ? ZONA_NOMBRES[zona] : null };
}

// Partidos/localidades GBA (y algunas ciudades del interior) que suelen aparecer
// como "ciudad" en el domicilio y no están cubiertos por BARRIO_ZONA.
const CIUDAD_ZONA: Record<string, Zona> = {
  // === GBA Norte ===
  'San Miguel': 'norte-gba',
  'Muñiz': 'norte-gba',
  'Pilar': 'norte-gba',
  'Del Viso': 'norte-gba',
  'Fatima': 'norte-gba',
  'Escobar': 'norte-gba',
  'Belén de Escobar': 'norte-gba',
  'Ingeniero Maschwitz': 'norte-gba',
  'Garín': 'norte-gba',
  'Matheu': 'norte-gba',
  'Campana': 'norte-gba',
  'Zárate': 'norte-gba',
  'Tortuguitas': 'norte-gba',
  'Los Polvorines': 'norte-gba',
  'Grand Bourg': 'norte-gba',
  'Ingeniero Pablo Nogués': 'norte-gba',
  'Villa de Mayo': 'norte-gba',
  'San Antonio de Areco': 'norte-gba',
  'Carmen de Areco': 'norte-gba',

  // === GBA Oeste ===
  'Marcos Paz': 'oeste-gba',
  'General Las Heras': 'oeste-gba',
  'General Rodríguez': 'oeste-gba',
  'Lomas del Mirador': 'oeste-gba',
  'Ciudad Evita': 'oeste-gba',
  'Villa Madero': 'oeste-gba',
  'La Tablada': 'oeste-gba',
  'Parque San Martín': 'oeste-gba',
  'Libertad': 'oeste-gba',
  'Villa Sarmiento': 'oeste-gba',
  'Billinghurst': 'oeste-gba',
  'Luján': 'oeste-gba',

  // === GBA Sur ===
  'La Plata': 'sur-gba',
  'Berisso': 'sur-gba',
  'Ensenada': 'sur-gba',
  'City Bell': 'sur-gba',
  'Villa Elisa': 'sur-gba',
  'Tolosa': 'sur-gba',
  'Ringuelet': 'sur-gba',
  'Gonnet': 'sur-gba',
  'Los Hornos': 'sur-gba',
  'Brandsen': 'sur-gba',
  'Lobos': 'sur-gba',
  'Rafael Calzada': 'sur-gba',
  'Don Bosco': 'sur-gba',
  'Villa Domínico': 'sur-gba',
  'Crucería': 'sur-gba',
  'Ranelagh': 'sur-gba',
  'Villa Fiorito': 'sur-gba',
  'Villa Diamante': 'sur-gba',
  'Virrey del Pino': 'sur-gba',
};

const CIUDADES_ORDERED = Object.keys(CIUDAD_ZONA).sort((a, b) => b.length - a.length);
const CIUDADES_NORM = CIUDADES_ORDERED.map(normalizar);

export function extraerCiudad(domicilio: string): string | null {
  if (!domicilio) return null;
  const norm = normalizar(domicilio);
  for (let i = 0; i < CIUDADES_ORDERED.length; i++) {
    const esc = CIUDADES_NORM[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^a-z0-9ñ])${esc}($|[^a-z0-9ñ])`).test(norm)) {
      return CIUDADES_ORDERED[i];
    }
  }
  return null;
}

export function ciudadDeDomicilio(domicilio: string): { ciudad: string | null; zona: string | null } {
  const ciudad = extraerCiudad(domicilio);
  if (!ciudad) return { ciudad: null, zona: null };
  const zona = CIUDAD_ZONA[ciudad] ?? null;
  return { ciudad, zona: zona ? ZONA_NOMBRES[zona] : null };
}

export interface GrupoRuta {
  barrios: string[];
  totalClientes: number;
  clientesIds: number[];
  nombreZona?: string;
}

type GrupoInterno = { barrios: string[]; clientesIds: number[]; zona: Zona | null };

export interface Trazo {
  fase: 'entrada' | 'dbscan' | 'zona' | 'split' | 'merge' | 'grupo' | 'orden' | 'absorbe';
  texto: string;
  ids?: number[];
  viajeIdx?: number;
  id?: number;
  distKm?: number;
  lado?: 'ida' | 'vuelta';
  origenViaje?: number;
}

export type ClienteParaAgrupar = { id: number; domicilio?: string; lat?: number; lng?: number };

function nombreZona(zona: Zona | null, barrios: string[]): string {
  return zona ? ZONA_NOMBRES[zona] : (barrios.length > 0 ? barrios[0] : 'General');
}

function barrioDominante(ids: number[], clientePorId: Map<number, ClienteParaAgrupar>): string | null {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const c = clientePorId.get(id);
    if (!c) continue;
    const barrio = extraerBarrio(c.domicilio || '');
    if (barrio) counts.set(barrio, (counts.get(barrio) || 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [barrio, count] of counts) {
    if (count > bestCount) { best = barrio; bestCount = count; }
  }
  return best;
}

function ciudadDominante(ids: number[], clientePorId: Map<number, ClienteParaAgrupar>): string | null {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const c = clientePorId.get(id);
    if (!c) continue;
    const ciudad = extraerCiudad(c.domicilio || '');
    if (ciudad) counts.set(ciudad, (counts.get(ciudad) || 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [ciudad, count] of counts) {
    if (count > bestCount) { best = ciudad; bestCount = count; }
  }
  return best;
}

function nombreGrupoFinal(g: GrupoInterno, clientePorId: Map<number, ClienteParaAgrupar>): string {
  const barrio = barrioDominante(g.clientesIds, clientePorId);
  if (barrio) return barrio;
  if (g.zona) return ZONA_NOMBRES[g.zona];
  const ciudad = ciudadDominante(g.clientesIds, clientePorId);
  if (ciudad) return ciudad;
  return g.barrios.length > 0 ? g.barrios[0] : 'General';
}

function partirGrupo(g: GrupoInterno, max: number, clientePorId: Map<number, ClienteParaAgrupar>, trace: Trazo[] | null): GrupoInterno[] {
  if (g.clientesIds.length <= max) return [g];

  const pts = g.clientesIds.map(id => {
    const c = clientePorId.get(id);
    return c && c.lat != null && c.lng != null ? { id, lat: c.lat, lng: c.lng } : null;
  });

  // Sin coordenadas: no queda otra que trocear
  if (pts.some(p => p === null)) {
    const out: GrupoInterno[] = [];
    for (let i = 0; i < g.clientesIds.length; i += max) {
      out.push({ barrios: g.barrios, clientesIds: g.clientesIds.slice(i, i + max), zona: g.zona });
    }
    trace?.push({
      fase: 'split',
      texto: `Grupo ${nombreZona(g.zona, g.barrios)} (${g.clientesIds.length} clientes > máx ${max}) sin coordenadas → troceado en ${out.map(p => p.clientesIds.length).join('/')}`,
    });
    return out;
  }

  const k = Math.ceil(g.clientesIds.length / max);
  const fc = featureCollection(pts.map(p => point([p!.lng, p!.lat], { id: p!.id })));
  const km = clustersKmeans(fc, { numberOfClusters: k });
  const subMap = new Map<number, number[]>();
  for (const f of km.features) {
    const props = f.properties as any;
    const cid = props.cluster ?? 0;
    if (!subMap.has(cid)) subMap.set(cid, []);
    subMap.get(cid)!.push(props.id);
  }
  const partes: GrupoInterno[] = [];
  for (const ids of subMap.values()) {
    partes.push({ barrios: g.barrios, clientesIds: ids, zona: g.zona });
  }

  trace?.push({
    fase: 'split',
    texto: `Grupo ${nombreZona(g.zona, g.barrios)} (${g.clientesIds.length} clientes > máx ${max}) → k-means en ${k} parte${k !== 1 ? 's' : ''}: [${partes.map(p => p.clientesIds.length).join(', ')}]`,
    ids: g.clientesIds,
  });

  // Garantía de máximo: re-partir cualquier parte que siga excediendo
  if (partes.length < 2 && partes[0].clientesIds.length > max) {
    const out: GrupoInterno[] = [];
    for (let i = 0; i < partes[0].clientesIds.length; i += max) {
      out.push({ barrios: g.barrios, clientesIds: partes[0].clientesIds.slice(i, i + max), zona: g.zona });
    }
    return out;
  }
  const out: GrupoInterno[] = [];
  for (const p of partes) {
    out.push(...partirGrupo(p, max, clientePorId, trace));
  }
  return out;
}

export function recomendarRutas(
  clientes: ClienteParaAgrupar[],
  minPorGrupo = 2,
  maxPorGrupo = 0,
  epsKm = 4,
  trace: Trazo[] | null = null
): GrupoRuta[] {
  if (clientes.length === 0) return [];

  const clientePorId = new Map(clientes.map(c => [c.id, c]));

  const conCoord = clientes.filter(c => c.lat != null && c.lng != null);
  const sinCoord = clientes.filter(c => c.lat == null || c.lng == null);

  trace?.push({ fase: 'entrada', texto: `${clientes.length} cliente(s) · ${conCoord.length} con coordenadas · ${sinCoord.length} sin coordenadas` });

  const grupos: GrupoInterno[] = [];
  const generalIds: number[] = [];

  // ── 1) DBSCAN (Turf, índice espacial) sobre clientes con coordenadas ──
  if (conCoord.length > 0) {
    const fc = featureCollection(
      conCoord.map(c => point([c.lng!, c.lat!], { id: c.id, domicilio: c.domicilio || '' }))
    );
    const clustered = clustersDbscan(fc, epsKm, { units: 'kilometers', minPoints: 2 });

    const clusterMap = new Map<number, number[]>();
    for (let i = 0; i < clustered.features.length; i++) {
      const props = clustered.features[i].properties as any;
      const label = props.dbscan === 'noise' ? -1 : (props.cluster ?? 0);
      if (!clusterMap.has(label)) clusterMap.set(label, []);
      clusterMap.get(label)!.push(i);
    }

    for (const [label, indices] of clusterMap) {
      const ids = indices.map(i => conCoord[i].id);
      if (label === -1) {
        trace?.push({ fase: 'dbscan', texto: `Ruido DBSCAN (sin vecinos a ≤ ${epsKm} km) → General`, ids });
        generalIds.push(...ids);
        continue;
      }
      const barrioCounts = new Map<string, number>();
      for (const idx of indices) {
        const barrio = extraerBarrio(conCoord[idx].domicilio || '');
        if (barrio) barrioCounts.set(barrio, (barrioCounts.get(barrio) || 0) + 1);
      }
      let zona: Zona | null = null;
      let maxCount = 0;
      for (const [barrio, count] of barrioCounts) {
        if (count > maxCount) { maxCount = count; zona = BARRIO_ZONA[barrio] || null; }
      }
      const zonaNombre = nombreZona(zona, Array.from(barrioCounts.keys()));
      trace?.push({
        fase: 'dbscan',
        texto: `Cluster DBSCAN (radio ≤ ${epsKm} km, mín 2): ${ids.length} cliente(s) agrupados → ${zonaNombre}`,
        ids,
      });
      grupos.push({ barrios: Array.from(barrioCounts.keys()), clientesIds: ids, zona });
    }
  }

  // ── 2) Fallback por barrio/zona para clientes sin coordenadas ──
  if (sinCoord.length > 0) {
    const zonaClientes: Record<string, { ids: number[]; barrios: Set<string> }> = {};
    for (const c of sinCoord) {
      const barrio = extraerBarrio(c.domicilio || '');
      if (barrio) {
        const zona = BARRIO_ZONA[barrio];
        if (zona) {
          if (!zonaClientes[zona]) zonaClientes[zona] = { ids: [], barrios: new Set() };
          zonaClientes[zona].ids.push(c.id);
          zonaClientes[zona].barrios.add(barrio);
          continue;
        }
      }
      generalIds.push(c.id);
    }
    const ordenZonas: Zona[] = ['norte', 'centro-norte', 'centro', 'oeste', 'sur', 'norte-gba', 'oeste-gba', 'sur-gba'];
    for (const zona of ordenZonas) {
      const zc = zonaClientes[zona];
      if (zc) {
        trace?.push({
          fase: 'zona',
          texto: `Sin coordenadas → zona ${ZONA_NOMBRES[zona]} por barrio (${Array.from(zc.barrios).join(', ')})`,
          ids: zc.ids,
        });
        grupos.push({ barrios: Array.from(zc.barrios), clientesIds: zc.ids, zona });
      }
    }
  }

  // ── 3) Grupo General: ruido de DBSCAN + clientes sin zona reconocida ──
  if (generalIds.length > 0) {
    trace?.push({ fase: 'zona', texto: `Sin zona reconocida → grupo General`, ids: generalIds });
    grupos.push({ barrios: [], clientesIds: generalIds, zona: null });
  }

  // ── 4) Partir grupos grandes de forma espacial (k-means), garantizando el máximo ──
  const expandidos: GrupoInterno[] = [];
  for (const g of grupos) {
    if (maxPorGrupo > 0 && g.clientesIds.length > maxPorGrupo) {
      expandidos.push(...partirGrupo(g, maxPorGrupo, clientePorId, trace));
    } else {
      expandidos.push(g);
    }
  }

  // ── 5) Fusionar grupos chicos con el vecino más cercano (por centroide) ──
  function centroide(g: GrupoInterno): { lat: number; lng: number } | null {
    const pts: { lat: number; lng: number }[] = [];
    for (const id of g.clientesIds) {
      const c = clientePorId.get(id);
      if (c && c.lat != null && c.lng != null) pts.push({ lat: c.lat, lng: c.lng });
    }
    if (pts.length === 0) return g.zona ? ZONA_CENTROID[g.zona] : null;
    const sum = pts.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
    return { lat: sum.lat / pts.length, lng: sum.lng / pts.length };
  }

  const finales: GrupoInterno[] = [...expandidos];
  let changed = true;
  let round = 0;
  while (changed) {
    changed = false;
    round++;
    for (let i = 0; i < finales.length; i++) {
      const g = finales[i];
      if (g.clientesIds.length >= minPorGrupo) continue;
      const gc = centroide(g);
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let j = 0; j < finales.length; j++) {
        if (j === i) continue;
        const o = finales[j];
        if (maxPorGrupo > 0 && o.clientesIds.length + g.clientesIds.length > maxPorGrupo) continue;
        const oc = centroide(o);
        if (!oc) continue;
        const d = gc ? haversine(gc, oc) : 0;
        if (d < bestDist) { bestDist = d; bestIdx = j; }
      }
      if (bestIdx >= 0 && (gc === null || bestDist <= epsKm)) {
        const target = finales[bestIdx];
        const distStr = gc ? `${Math.round(bestDist * 100) / 100} km` : 'sin coords';
        trace?.push({
          fase: 'merge',
          texto: `Grupo chico ${nombreZona(g.zona, g.barrios)} (${g.clientesIds.length} cliente(s), < mín ${minPorGrupo}) fusionado con ${nombreZona(target.zona, target.barrios)} · centroides a ${distStr}`,
          ids: g.clientesIds,
        });
        target.barrios = [...new Set([...target.barrios, ...g.barrios])];
        target.clientesIds = [...target.clientesIds, ...g.clientesIds];
        if (target.zona === null) target.zona = g.zona;
        finales.splice(i, 1);
        changed = true;
        break;
      }
    }
    if (round > finales.length + 2) break;
  }

  return finales.map(g => ({
    barrios: g.barrios,
    totalClientes: g.clientesIds.length,
    clientesIds: g.clientesIds,
    nombreZona: nombreGrupoFinal(g, clientePorId),
  }));
}
