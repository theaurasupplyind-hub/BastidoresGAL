# Plan: Simplificar Mapas → Programar Viajes

## Objetivo

Convertir el tab **Mapas** en una herramienta centrada exclusivamente en **Programar Viajes**.  
El usuario entra, ve los viajes generados automáticamente por cercanía de barrios, los modifica con drag & drop, y los envía al Panel de Control.

---

## Resumen de cambios

| Actual | Nuevo |
|--------|-------|
| Sidebar con lista de facturas + botones de ruta | Sidebar con grupos de viaje (modo planificación) o facturas (modo normal) |
| Botones: 🗺️ Ruta + ✨ Optimizar + 🗺️ Google Maps + ✕ Limpiar | **Eliminados** |
| Búsqueda en barra superior | Botón 🔍 flotante en el mapa |
| PanelProgramarViajes flotante (superpuesto al mapa) | Integrado en la sidebar izquierda |
| Auto-geocoding + plan manual | Auto-geocoding + auto-generación de grupos por barrio (una sola vez) |
| Dos motores de ruta (OSRM + GraphHopper) | Eliminados ambos |
| Botón 📋 (copiar link) en top bar | Eliminado |

---

## Archivos a modificar

### 1. `src/lib/stores/mapaStore.svelte.ts`

**Agregar propiedad:**

```typescript
let _planAutoGenerado = $state(false);

// En el export:
get planAutoGenerado() { return _planAutoGenerado; },
set planAutoGenerado(v: boolean) { _planAutoGenerado = v; },
```

**Propósito:** Controlar que `generarPlanAuto()` se ejecute solo la primera vez que se activa el modo Programar Viajes, no en cada toggle.

---

### 2. `src/lib/screens/Dashboard.svelte`

**Antes (top bar en modo mapa):**

```
[Fecha] [Todos|Pendientes|2meses]  [🔍 Buscar...]  [📍 Salida] [✏️] [📋] [📦 Viajes]
```

**Después:**

```
[Fecha] [Todos|Pendientes|2meses]  [📍 Salida] [✏️] [📦 Programar]
```

**Cambios concretos:**

1. **Eliminar** el bloque `.mapa-bar-center` completo (search-wrap + AddressAutocomplete)
2. **Eliminar** el botón `.mapa-bar-btn-wa` (📋 copiar link)
3. **Renombrar** el botón `.mapa-bar-btn-viajes`:
   - Texto: `📦 Viajes` → `📦 Programar`
   - Title: `"Programar Viajes"` (ya está)
   - Mantener misma lógica de toggle (`mapaStore.modoProgramar`)
4. Ajustar CSS si es necesario: `.mapa-bar-center`, `.search-wrap`, `.mapa-bar-btn-wa` se pueden eliminar

---

### 3. `src/lib/screens/MapaClientes.svelte` — Cambio principal

#### 3a. Eliminar imports y variables

**Imports a eliminar:**
- `import { open as shellOpen } from '@tauri-apps/plugin-shell'` (solo se usaba en `abrirEnGoogleMaps`)

**Variables de estado a eliminar (~10 líneas menos):**
```typescript
let rutaLinea: any = null;         // eliminar
let routingControl: any = null;    // eliminar
let infoRuta = $state('');         // eliminar
let calculandoRuta = $state(false);// eliminar
```

**Derived/state que ya no se usan (verificar):**
- `ordenRuta` → Se mantiene para el orden dentro de grupos, pero se inicializa vacío
- `seleccionados` → Se mantiene para saber qué facturas están "activas"

#### 3b. Eliminar funciones de ruta

Eliminar las siguientes funciones completas (~170 líneas menos):

| Función | Líneas aprox |
|---------|-------------|
| `trazarRuta()` | ~60 |
| `haversine()` | ~10 |
| `optimizarRuta()` | ~30 |
| `renderizarRutaOptimizada()` | ~65 |
| `limpiarRuta()` | ~15 |
| `abrirEnGoogleMaps()` | ~20 |
| `copiarRutaAlPortapapeles()` | ~25 |

#### 3c. Eliminar export de `copiarRutaAlPortapapeles`

Cambiar:
```typescript
export function copiarRutaAlPortapapeles() { ... }
```
→
Eliminar la palabra `export` (o eliminar toda la función).

#### 3d. Simplificar `initMapa()`

**Antes:**
```typescript
async function initMapa() {
    L = await import('leaflet');
    (window as any).L = L;
    await import('leaflet-routing-machine');  // ← eliminar esta línea
    ...
```

**Después:**
```typescript
async function initMapa() {
    L = await import('leaflet');
    ...
```

#### 3e. Simplificar `onDestroy`

**Antes:**
```typescript
onDestroy(() => {
    limpiarRuta();
    map?.remove();
});
```

**Después:**
```typescript
onDestroy(() => {
    map?.remove();
});
```

#### 3f. Agregar función `generarPlanAuto()`

Nueva función que genera grupos a partir de las facturas geocodificadas activas:

```typescript
function generarPlanAuto() {
    const activas = facturasDelDia.filter(f => f.lat && f.lng);
    if (activas.length === 0) return;

    const clientes = activas.map(f => ({
        id: f.id,
        domicilio: f.cliente_domicilio || ''
    }));

    const recomendaciones = recomendarRutas(clientes);
    if (recomendaciones.length === 0) return;

    const nuevos = new Map<string, any>();
    recomendaciones.forEach((grupo, i) => {
        const color = CONSOLA_COLORS[i % CONSOLA_COLORS.length];
        const id = `grupo-auto-${Date.now()}-${i}`;
        nuevos.set(id, {
            id,
            nombre: `Viaje ${i + 1}`,
            clienteIds: grupo.clientesIds,
            ordenRuta: grupo.clientesIds,
            color,
        });
    });

    grupos = nuevos;
    if (nuevos.size > 0) {
        grupoActivoId = [...nuevos.keys()][0];
    }
    mapaStore.planAutoGenerado = true;
    renderizarMarcadores();
}
```

**Nota:** Importar `recomendarRutas` de `$lib/utils/barrios`:
```typescript
import { recomendarRutas } from '$lib/utils/barrios';
```

#### 3g. Modificar el toggle de `modoProgramar`

En el `$effect` que observa `mapaStore.modoProgramar`, agregar la llamada a `generarPlanAuto()`:

```typescript
$effect(() => {
    const v = mapaStore.modoProgramar;
    if (v !== modoProgramar) {
        modoProgramar = v;
        if (v) {
            if (!mapaStore.planAutoGenerado) {
                generarPlanAuto();
            }
            if (grupos.size === 0) crearGrupo();
        }
        renderizarMarcadores();
    }
});
```

#### 3h. Rediseñar sidebar

La sidebar cambia según `modoProgramar`:

##### Modo Normal (`modoProgramar = false`)

Se mantiene igual que hoy:

```
┌─────────────────────┐
│ Kanban filter        │
│ ─────────────────── │
│ Stats: "X de Y facturas" │
│ ─────────────────── │
│ ✅ Geocodificadas    │
│  • factura items     │
│ ─────────────────── │
│ ⚠️ Sin geocodificar  │
│  • factura items     │
└─────────────────────┘
```

**Único cambio:** Eliminar el bloque de botones de ruta (`.btn-group` con Ruta/Optimizar/etc.) e `infoRuta`.

##### Modo Programar Viajes (`modoProgramar = true`)

Nuevo layout:

```
┌─────────────────────┐
│ [📦 Programar Viajes] │
│ -------------------- │
│ GRUPOS               │
│ [🟦 Viaje 1]  5 cl.  │  ← click para seleccionar
│ [🟪 Viaje 2]  3 cl.  │
│ [+ Nuevo grupo]      │
│ [🔄 Regenerar]       │
│ -------------------- │
│ [VIAJE SELECCIONADO] │
│  1. Cliente A  ✕     │  ← drag & drop para reordenar
│  2. Cliente B  ✕     │
│  3. Cliente C  ✕     │
│ -------------------- │
│ 📌 Sin agrupar (2)    │
│  • Cliente D         │  ← click para asignar al grupo activo
│  • Cliente E         │
│ -------------------- │
│ ⚠️ Sin geocodificar   │
│  • Cliente F         │
│ -------------------- │
│ [💾 Guardar]          │
│ [📋 Enviar a panel]   │
└─────────────────────┘
```

**Detalles de implementación:**

1. **Grupos list:** Iterar `grupos` Map, cada card muestra color, nombre, cantidad de clientes. Click → `grupoActivoId`.
2. **Grupo activo:** Muestra `clientesEnActivo` (derivado de `grupoActivo.ordenRuta` mapeado a facturas).
   - Cada item muestra: número de orden, nombre del cliente, dirección.
   - Botón ✕ para quitar del grupo (llama a `quitarClienteDeGrupo`).
   - **Drag & drop** para reordenar dentro del grupo (usar la misma lógica de `PanelProgramarViajes`).
3. **Sin agrupar:** Facturas geocodificadas que NO están en ningún grupo.
   - Click → asigna al grupo activo (llama a `toggleClienteEnGrupo(clienteId)`).
4. **Sin geocodificar:** Facturas sin lat/lng (igual que hoy).
5. **Botones:**
   - `+ Nuevo grupo` → `crearGrupo()`
   - `🔄 Regenerar` → reinicia `mapaStore.planAutoGenerado = false` y llama `generarPlanAuto()`
   - `💾 Guardar` → `guardarPlan()`
   - `📋 Enviar a panel` → `guardarPlan()` + `appStore.currentTab = 'panel-control'`

**Eliminar el bloque de ruta actual (líneas ~1237-1262):**

El bloque actual:
```svelte
<div class="btn-group">
    <button class="btn-ruta flex-1" ...>🗺️ Ruta...</button>
    <button class="btn-optimizar" ...>✨ Optimizar</button>
    {#if routingControl || rutaLinea}
        <button class="btn-google" ...>🗺️</button>
        <button class="btn-copy-link" ...>📋</button>
        <button class="btn-clear-ruta" ...>✕</button>
    {/if}
</div>
{#if infoRuta}
    <div class="ruta-info">{infoRuta}</div>
{/if}
```

Se reemplaza por los botones de planificación descritos arriba (condicional a `modoProgramar`).

#### 3i. Búsqueda flotante 🔍

Agregar al final del template (dentro de `.mapa-wrapper`, fuera del panel y el mapa):

```svelte
<div class="search-floating">
    {#if showSearchFloating}
        <div class="search-popover">
            <AddressAutocomplete
                value={mapaStore.busqueda}
                onchange={(v: string) => { mapaStore.busqueda = v; if (!v) mapaStore.busquedaCoords = null; }}
                onselect={(data: { label: string; lat: number; lng: number }) => {
                    mapaStore.busqueda = data.label;
                    mapaStore.busquedaCoords = { lat: data.lat, lng: data.lng };
                    showSearchFloating = false;
                }}
                className="mapa-bar-buscar"
                placeholder="Buscar cliente..."
            />
        </div>
    {:else}
        <button class="search-float-btn" onclick={() => showSearchFloating = true}>
            🔍
        </button>
    {/if}
</div>
```

**Estado:**
```typescript
let showSearchFloating = $state(false);
```

**CSS (agregar al final del `<style>`):**
```css
.search-floating {
    position: absolute;
    bottom: 24px;
    right: 16px;
    z-index: 1000;
}
.search-float-btn {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: #2563eb;
    color: white;
    border: none;
    font-size: 18px;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s;
}
.search-float-btn:hover {
    transform: scale(1.08);
}
.search-popover {
    position: absolute;
    bottom: 52px;
    right: 0;
    width: 280px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.15);
}
```

**Nota:** `.mapa-wrapper` debe tener `position: relative` para que el flotante se posicione correctamente (ya lo tiene).

#### 3j. Renderizado de marcadores en modo planificación

En `renderizarMarcadores()`, modificar el renderizado de clientes/facturas para cuando `modoProgramar` está activo:

**Clientes de fondo (Capa 1):** Ya está condicional con `!mapaStore.filtroPendientes`.  
En modo planificación, los clientes que pertenecen a un grupo se colorean con el color del grupo.

**Facturas (Capa 2):** Se mantiene igual, renderiza `facturasFiltradas`.

**Colorear clientes por grupo:**

En el loop de clientes (Capa 1), cuando `modoProgramar`:
```typescript
if (modoProgramar) {
    // Buscar a qué grupo pertenece este cliente
    let grupoColor = null;
    for (const g of grupos.values()) {
        if (g.clienteIds.includes(cliente.id)) {
            grupoColor = g.color;
            break;
        }
    }
    if (grupoColor) {
        icono = crearIcono(grupoColor, false, 14);  // círculo coloreado más grande
    } else {
        icono = crearIcono('#9ca3af', false, 10);    // gris = sin grupo
    }
}
```

---

### 4. `src/lib/components/PanelProgramarViajes.svelte`

**No se elimina**, pero se simplifica y adapta para ser usado dentro de la sidebar en lugar de como panel flotante.

#### Cambios:

1. **Eliminar el panel flotante** (position: fixed, right, etc.)
   - El componente recibe un prop `compact` o se renderiza sin los estilos de panel flotante
   - Los estilos de `.programar-panel` (position: fixed, top, right, etc.) se reemplazan por estilos inline/sidebar

2. **Mantener la lógica interna**:
   - Drag & drop de clientes (`handleDragStart`, `handleDragOver`, `handleDrop`, `handleDragEnd`)
   - Renombrar grupos (`iniciarRenombrar`, `confirmarRenombrar`)
   - Lista de grupos y clientes del grupo activo
   - Botones de eliminar grupo y quitar cliente

3. **Simplificar el template**:
   - Eliminar el header "📦 Programar Viajes" y botón de cerrar (la sidebar no necesita cerrarse)
   - Eliminar la animación de entrada (`transform: translateY(-12px)`)
   - Mantener: grupos list, grupo activo con clientes, drag & drop

4. **Props:**

```typescript
let {
    grupos,
    grupoActivoId,
    todosLosClientes,
    clientesDelDia,
    fecha,
    modoProgramar,
    oncreategrupo,
    ondeletergrupo,
    onsetactivo,
    onsave,
    onremovecliente,
    onreorder,
    onrename,
    onenviarpanel,
}: { ... } = $props();
```

Agregar `onenviarpanel` prop (nuevo).

---

## Resumen de líneas

| Archivo | Líneas actuales | Líneas estimadas después | Diferencia |
|---------|----------------|--------------------------|-----------|
| `MapaClientes.svelte` | ~1920 | ~1700 | **-220** |
| `Dashboard.svelte` | ~654 | ~630 | **-24** |
| `mapaStore.svelte.ts` | 70 | 75 | **+5** |
| `PanelProgramarViajes.svelte` | 615 | ~550 | **-65** |
| **Total** | **~3259** | **~2955** | **-304** |

---

## Pendientes / No Cambia

- ✅ Filtro Kanban (Pedido/En Proceso/Listo) — se mantiene
- ✅ Filtro Todos/Pendientes/2meses — se mantiene en top bar
- ✅ Mapa con OpenStreetMap tiles — se mantiene
- ✅ Marcadores de clientes y facturas — se mantienen
- ✅ Geocodificación automática — se mantiene
- ✅ Origen/Dirección de salida — se mantiene en top bar
- ✅ PanelControl — no se modifica (recibe los planes guardados)
- ✅ `barrios.ts` — no se modifica (ya tiene `recomendarRutas`)
- ✅ API calls (`getMapaDashboard`, `savePlanViaje`, etc.) — no cambian

---

## Orden de implementación sugerido

1. **mapaStore.svelte.ts** — agregar `planAutoGenerado` (5 min)
2. **Dashboard.svelte** — eliminar búsqueda + 📋, renombrar botón (15 min)
3. **MapaClientes.svelte** — eliminar toda la lógica de rutas (30 min)
4. **MapaClientes.svelte** — agregar `generarPlanAuto()` + import `recomendarRutas` (20 min)
5. **MapaClientes.svelte** — rediseñar sidebar condicional (60 min)
6. **MapaClientes.svelte** — búsqueda flotante 🔍 (20 min)
7. **MapaClientes.svelte** — colorear clientes por grupo en el mapa (15 min)
8. **PanelProgramarViajes.svelte** — simplificar para sidebar (30 min)
9. **Prueba y ajustes** — verificar que todo funcione (30 min)

**Total estimado: ~3.5 horas**
