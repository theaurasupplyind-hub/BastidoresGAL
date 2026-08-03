# Reporte de ideación: UI del Mapa y flujo de programación de viajes

Generado por ideagen (metodología IDEAgent — Quality-Diversity search) · 2026-08-02

## Contexto

- **App**: galv2-tauri (BastidoresGal), Tauri + Svelte 5 + Leaflet.
- **Pantalla analizada**: `src/lib/screens/MapaClientes.svelte` (3222 líneas, monolito), `Dashboard.svelte`, `TitleBar.svelte`, `PanelControl.svelte`, `mapaStore`, `planViajes.ts`, `MAPAnuevo.md`.
- **Flujo actual**: Tab "Mapa" → facturas del día → modo "Programar viajes" (grupos por barrio) → Guardar/Enviar a panel → Panel de control.
- **Fricciones detectadas** (10): monolito; click en pin con conflicto popup/toggle; geocodificación serial 1.1s/factura; 5 vías de corrección de dirección; sin clustering; auto-absorción sin consentimiento; sin undo; botón "Centrar en CABA" oculto en scroll; pila de 6 overlays sobre el mapa; render condicional invertido de PanelProgramarViajes.
- **Mejores prácticas investigadas**: Eleken (clustering, jerarquía visual, ocultar panel para foco), UXPin (layouts, gestos, accesibilidad), Mapbox (route preview, waypoints), casos INVOLI/Astraea (agrupación inteligente, estado de color universal).

## Ideas aceptadas (ordenadas por calidad: soundness + no-obviedad)

### 1. seed-B — "Edición directa con semántica de drop definida" (146 pts)
- **Ángulo de novedad**: invierte la relación sidebar-primario/mapa-pasivo; convierte la auto-absorción silenciosa (mutación sin consentimiento) en una sugerencia visible y accionable anclada al route preview en vivo.
- **Solidez**: 78 — 4 gestos sin colisión implementables en Leaflet (click=toggle sin popup en modo programar; drag con targets explícitos: tarjetas de grupo + snap de ~40px sobre pin de otro grupo; marquee como herramienta de toolbar; preview debounced 700ms).
- **Claridad**: 72 — trigger/target/outcome por gesto, con umbrales numéricos.
- **Divergencia mutua**: complementa a D (usa el panel como zona de drop) y a E (la aceptación de sugerencias es una mutación de borrador undoable); no se solapa con A ni C.

### 2. seed-A — "Clustering por paradas preservando urgencia" (136 pts)
- **Ángulo de novedad**: no es clustering "estándar": la unidad de agregación es la **parada** (cliente+coordenada) con doble conteo "N paradas · M paquetes", y el color de burbuja es el estado **más urgente presente** con anillo de mezcla (un PEDIDO rojo nunca queda oculto en una mayoría azul/verde). Resuelve el hack `facturasPorCoord` y fusiona la capa de fondo con la de facturas a zoom bajo.
- **Solidez**: 72 — viable con leaflet.markercluster + divIcon custom; vista derivada, sin estado global nuevo.
- **Claridad**: 74.
- **Divergencia mutua**: territorio de render/percepción; única idea que toca la densidad visual y la performance por zoom.

### 3. seed-E — "Dos capas: borrador local reversible + commit explícito" (135 pts)
- **Ángulo de novedad**: separa borrador local (memoria + localStorage por fecha, con undo/redo) del plan commiteado, resolviendo la carrera con el Panel de control como **segundo escritor**; define la unidad de deshacer y una política de fusión (conservar-mío/ajeno/mezclar) ante cambios ajenos al publicar.
- **Solidez**: 72 — implementable con la API existente (getPlanViaje/savePlanViaje/updatePlanViaje/deletePlanViaje); hueco menor: blindar TOCTOU con versión/etag.
- **Claridad**: 78 — la más clara del set.
- **Divergencia mutua**: territorio de persistencia/estado/confianza en el dato; ninguna otra idea toca el guardado ni el undo.

### 4. seed-D — "Un solo panel anclado + cluster de controles + colapso por señal de fase" (134 pts)
- **Ángulo de novedad**: colapso del panel disparado por **señal de fase** (entrar a modo programar con grupo activo), no por interacción con el mapa — preservando el loop escanear-lista→actuar-mapa; consolida los 6 overlays en un cluster único abajo-derecha y elimina la duplicación de UI de grupos.
- **Solidez**: 72 — señal derivable del store existente (modo programar && grupo activo).
- **Claridad**: 70.
- **Divergencia mutua**: territorio de arquitectura de información/layout; base física para B (zona de drop en panel) y para C (panel de resolución por lotes dockable).

### 5. seed-C — "Flujo contextual colapsable, no wizard obligatorio" (127 pts)
- **Ángulo de novedad**: los 3 pasos (Ubicar → Agrupar → Confirmar) son **estados colapsables**, no pantallas obligatorias; corrección siempre local al contexto (mini-form anclado para 1-3 pendientes, panel dockable por lotes con paralelización calibrada al rate limit real para >3); botón único "Publicar y enviar al Panel".
- **Solidez**: 65 — dos asunciones calibrables (anclaje del mini-form sin pin; concurrencia de geocodificación vs rate limit).
- **Claridad**: 72.
- **Divergencia mutua**: territorio de estructura del flujo de tarea y pipeline de geocodificación; la única que ataca el cuello de botella serial de geocodificación.

## Nota de cobertura del espacio de diseño

Las 5 ideas cubren territorios mutuamente disjuntos: **percepción** (A), **interacción** (B), **flujo de tarea** (C), **layout/IA** (D) y **persistencia** (E). Combinables sin solapamiento: A+B (mapa denso y editable), C+E (flujo colapsable con borrador), D como base estructural para B/C/E.

Archivo de trabajo: `.ideagent/mapa-entrega-flujo-ui/` (`archive.jsonl` con las 5 ideas, puntajes, linaje de desafíos; `rejected.jsonl` sin rechazos; este reporte).
