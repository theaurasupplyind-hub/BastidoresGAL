type Zona = 'norte' | 'centro-norte' | 'centro' | 'oeste' | 'sur' | 'norte-gba' | 'oeste-gba' | 'sur-gba';

const ZONAS_PROXIMAS: Record<Zona, Zona[]> = {
  'norte': ['centro-norte', 'norte-gba'],
  'centro-norte': ['norte', 'centro', 'oeste'],
  'centro': ['centro-norte', 'sur', 'oeste'],
  'oeste': ['centro-norte', 'centro', 'oeste-gba', 'sur'],
  'sur': ['centro', 'oeste', 'sur-gba'],
  'norte-gba': ['norte'],
  'oeste-gba': ['oeste'],
  'sur-gba': ['sur'],
};

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

export function estanCerca(barrio1: string, barrio2: string): boolean {
  const z1 = BARRIO_ZONA[barrio1];
  const z2 = BARRIO_ZONA[barrio2];
  if (!z1 || !z2) return false;
  if (z1 === z2) return true;
  return ZONAS_PROXIMAS[z1]?.includes(z2) || ZONAS_PROXIMAS[z2]?.includes(z1);
}

export interface GrupoRuta {
  barrios: string[];
  totalClientes: number;
  clientesIds: number[];
}

export function recomendarRutas(
  clientes: { id: number; domicilio: string }[]
): GrupoRuta[] {
  const barrioCount: Record<string, number[]> = {};

  for (const c of clientes) {
    const barrio = extraerBarrio(c.domicilio);
    if (barrio) {
      if (!barrioCount[barrio]) barrioCount[barrio] = [];
      barrioCount[barrio].push(c.id);
    }
  }

  const barrios = Object.keys(barrioCount);
  const grupos: { barrios: string[]; clientesIds: number[]; zona: Zona }[] = [];
  const asignado = new Set<string>();

  for (const barrio of barrios) {
    if (asignado.has(barrio)) continue;
    const zona = BARRIO_ZONA[barrio];
    if (!zona) continue;

    const cercanos = [barrio];
    const ids = new Set(barrioCount[barrio]);
    asignado.add(barrio);

    const zonasProximas = new Set([zona, ...(ZONAS_PROXIMAS[zona] || [])]);

    for (const otro of barrios) {
      if (cercanos.length >= 3) break;
      if (asignado.has(otro)) continue;
      if (otro === barrio) continue;

      const otraZona = BARRIO_ZONA[otro];
      if (otraZona && zonasProximas.has(otraZona)) {
        cercanos.push(otro);
        asignado.add(otro);
        for (const id of barrioCount[otro]) ids.add(id);
      }
    }

    grupos.push({
      barrios: cercanos,
      clientesIds: Array.from(ids),
      zona,
    });
  }

  grupos.sort((a, b) => b.clientesIds.length - a.clientesIds.length);

  return grupos.map(g => ({
    barrios: g.barrios,
    totalClientes: g.clientesIds.length,
    clientesIds: g.clientesIds,
  }));
}
