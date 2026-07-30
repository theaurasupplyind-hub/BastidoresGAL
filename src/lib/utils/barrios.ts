import { dbscan } from '$lib/utils/geo';

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
  'centro-norte': 'Palermo',
  'centro': 'Centro',
  'oeste': 'Oeste',
  'sur': 'Sur',
  'norte-gba': 'GBA Norte',
  'oeste-gba': 'GBA Oeste',
  'sur-gba': 'GBA Sur',
};

const BARRIOS_ORDERED = Object.keys(BARRIO_ZONA).sort((a, b) => b.length - a.length);

export function extraerBarrio(domicilio: string): string | null {
  if (!domicilio) return null;
  const lower = domicilio.toLowerCase();
  for (const barrio of BARRIOS_ORDERED) {
    if (lower.includes(barrio.toLowerCase())) {
      return barrio;
    }
  }
  return null;
}

export interface GrupoRuta {
  barrios: string[];
  totalClientes: number;
  clientesIds: number[];
  nombreZona?: string;
}

type GrupoInterno = { barrios: string[]; clientesIds: number[]; zona: Zona | null };

export function recomendarRutas(
  clientes: { id: number; domicilio?: string; lat?: number; lng?: number }[],
  minPorGrupo = 2,
  maxPorGrupo = 0,
  epsKm = 4
): GrupoRuta[] {
  if (clientes.length === 0) return [];

  const conCoord = clientes.filter(c => c.lat != null && c.lng != null);
  const sinCoord = clientes.filter(c => c.lat == null || c.lng == null);

  const grupos: GrupoInterno[] = [];

  // --- DBSCAN for clients with coordinates ---
  if (conCoord.length > 0) {
    const points = conCoord.map(c => ({ lat: c.lat!, lng: c.lng! }));
    const labels = dbscan(points, epsKm, 2);

    const clusterMap = new Map<number, number[]>();
    for (let i = 0; i < labels.length; i++) {
      if (!clusterMap.has(labels[i])) clusterMap.set(labels[i], []);
      clusterMap.get(labels[i])!.push(i);
    }

    for (const [label, indices] of clusterMap) {
      const ids = indices.map(i => conCoord[i].id);
      if (label === -2) {
        grupos.push({ barrios: [], clientesIds: ids, zona: null });
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
      grupos.push({ barrios: Array.from(barrioCounts.keys()), clientesIds: ids, zona });
    }
  }

  // --- Fallback: barrio-based for clients w/o coordinates ---
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
      const general = grupos.find(g => g.zona === null && g.barrios.length === 0);
      if (general) { general.clientesIds.push(c.id); }
      else { grupos.push({ barrios: [], clientesIds: [c.id], zona: null }); }
    }
    const ordenZonas: Zona[] = ['norte', 'centro-norte', 'centro', 'oeste', 'sur', 'norte-gba', 'oeste-gba', 'sur-gba'];
    for (const zona of ordenZonas) {
      if (zonaClientes[zona]) {
        const zc = zonaClientes[zona];
        grupos.push({ barrios: Array.from(zc.barrios), clientesIds: zc.ids, zona });
      }
    }
  }

  // --- Split large groups ---
  let expandidos: GrupoInterno[] = [];
  for (const g of grupos) {
    if (maxPorGrupo > 0 && g.clientesIds.length > maxPorGrupo) {
      for (let i = 0; i < g.clientesIds.length; i += maxPorGrupo) {
        expandidos.push({ barrios: g.barrios, clientesIds: g.clientesIds.slice(i, i + maxPorGrupo), zona: g.zona });
      }
    } else {
      expandidos.push(g);
    }
  }

  // --- Merge small groups ---
  const finales: GrupoInterno[] = [];
  for (const g of expandidos) {
    if (g.clientesIds.length >= minPorGrupo) {
      finales.push(g);
    } else if (finales.length > 0) {
      const prev = finales[finales.length - 1];
      prev.barrios = [...new Set([...prev.barrios, ...g.barrios])];
      prev.clientesIds = [...prev.clientesIds, ...g.clientesIds];
      if (prev.zona === null) prev.zona = g.zona;
    } else {
      finales.push(g);
    }
  }

  return finales.map(g => ({
    barrios: g.barrios,
    totalClientes: g.clientesIds.length,
    clientesIds: g.clientesIds,
    nombreZona: g.zona ? ZONA_NOMBRES[g.zona] : (g.barrios.length > 0 ? g.barrios[0] : 'General'),
  }));
}
