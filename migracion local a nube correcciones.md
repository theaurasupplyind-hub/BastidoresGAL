# Plan: Migrar correcciones de molduras de localStorage → Backend

## Objetivo
Trasladar el almacenamiento de correcciones de molduras del localStorage al backend, **manteniendo la lógica de coincidencia/normalización en la app** (enfoque B). El backend queda como fuente única de verdad (compartido entre estaciones). Incluye migración one-time de los datos existentes en localStorage.

## Contexto
- App Tauri: `D:\jesus\Documents\Desarrollo\galv2-tauri`
- Backend FastAPI: `D:\jesus\Documents\Desarrollo\backend_gal\main.py`
- El store actual `src/lib/stores/molduraCorrectionsLocal.ts` usa localStorage y expone:
  `getByInvoice, getAll, save, removeForItem, match, effectiveFor, applyCorrectionsToCard`.
  Los lectores (`match/effectiveFor/applyCorrectionsToCard/getAll/getByInvoice`) son síncronos y se usan en
  `Molduras.svelte`, `Kanban.svelte` (x2) y `MoldurasModal.svelte`.

## Decisiones
- **Enfoque B**: datos en backend; matching/normalización en la app leyendo un **caché en memoria** cargado desde el backend.
- Coincidencia por **medida exacta** (mismo w/h, tolera rotación y formato); la regla más reciente gana; `effectiveFor` prioriza la corrección de la misma factura, luego hereda por medida exacta y normaliza `larguero_qty/travesano_qty` al qty nuevo.
- El endpoint backend `/match` (tol ±5) queda sin uso; no se toca (opcional limpiarlo).

---

## 1) Backend — `backend_gal/main.py`

### Modelo/Schema (ya existen)
- `MolduraCorrection` (línea 411): `id, invoice_id, item_descripcion, width, height, qty, larguero_qty, larguero_cm, travesano_qty, travesano_cm, created_at, updated_at`.
- `MolduraCorrectionCreate` (línea 784): mismo subset (sin id/dates).

### Cambios en endpoints (sección `# ===== MOLDURA CORRECTIONS =====`, ~línea 5279)
1. **`POST /moldura-corrections`** (`save_moldura_correction`, 5283):
   - Mantener upsert por `(invoice_id, item_descripcion)`.
   - Devolver el **objeto guardado/actualizado** completo (incl. `id`, `invoice_id`, `item_descripcion`, `updated_at`, `created_at`) en vez de `{"status":"ok"}`.
   - Tras `db.commit()`, reconstruir el dict desde `existing` o el nuevo registro (o re-consultar por id) y `return { ... }` con fechas en ISO.
2. **Nuevo `GET /moldura-corrections`** (listar todas):
   - Declarar **antes** de la ruta `/{invoice_id}` (orden de FastAPI).
   - `db.query(MolduraCorrection).order_by(MolduraCorrection.updated_at.desc()).all()`.
   - Devolver cada corrección con **todos los campos**: `id, invoice_id, item_descripcion, width, height, qty, larguero_qty, larguero_cm, travesano_qty, travesano_cm, updated_at`.
3. **`GET /moldura-corrections/{invoice_id}`** (5348): agregar `invoice_id` y `updated_at` a cada item devuelto.
4. **`DELETE /moldura-corrections/{correction_id}`** (5368): sin cambios.
5. `/match` (5314): sin cambios (queda sin uso).

---

## 2) Cliente API — `src/lib/api/client.ts`

- **`saveMolduraCorrection`** (375-386): cambiar el tipo de retorno al objeto corrección (ya no `{status}`).
- **Nuevo `getAllMolduraCorrections(): Promise<MolduraCorrection[]>`** → `GET /moldura-corrections`.
- `deleteMolduraCorrection` (394): sin cambios.
- `findMolduraCorrection`, `getInvoiceCorrections`: se mantienen (posible que queden sin uso).

---

## 3) Store — `src/lib/stores/molduraCorrectionsLocal.ts`

Reescribir la capa de datos: reemplazar localStorage por **caché en memoria** + llamadas al backend.

- `let cache: MolduraCorrection[] = []` (scope de módulo) y `let loaded = false`.
- **`async load()`**: ejecuta migración one-time (ver §5) y luego `cache = await api.getAllMolduraCorrections(); loaded = true;`.
- **`async ensureLoaded()`**: si `!loaded`, `await load()`.
- **Lectores síncronos** (misma lógica que hoy, pero sobre `cache`):
  - `getAll()` → copia ordenada por `updated_at DESC`.
  - `getByInvoice(id)` → filtro.
  - `match(w, h)` → medida exacta, más reciente.
  - `effectiveFor(invoiceId, medida, w, h, qty)` → exacta de la factura primero; si no, `match`; normaliza al qty.
  - `applyCorrectionsToCard(card)` → sin cambios.
- **Escritores async**:
  - `async save(input)` → `const saved = await api.saveMolduraCorrection(input)`; upsert en `cache` por `(invoice_id, item_descripcion)`; devolver `saved`.
  - `async removeForItem(invoiceId, medida)` → buscar id en `cache`; si no existe devolver `false`; `await api.deleteMolduraCorrection(id)` (tolerar 404); quitar de `cache`; devolver `true`.
- **Migración** (ver §5): función `migrateIfNeeded()` que lee localStorage y hace POST de cada registro, limpiando la clave solo si todos OK.

### Firmas de import/export a conservar
El resto del código usa `molduraStore.getByInvoice/match/effectiveFor/applyCorrectionsToCard/getAll/save/removeForItem`. Mantener los mismos nombres para minimizar cambios (los escritores pasan a async).

---

## 4) Pantallas — agregar `await` de carga antes de renderizar

### `src/lib/screens/Molduras.svelte`
- `loadCards()`: `await molduraStore.load();` antes del `pending.map(parseCardLocal)` (ya es async).
- `saveCorrection()`: `await molduraStore.save({...})`.
- `restoreFormula()` y `revertCorrection()`: `await molduraStore.removeForItem(...)`.
- `openCorrectionsModal()`: hacer async → `await molduraStore.load(); correctionsList = molduraStore.getAll();`.
- `updateDetailItem()` y `buildCardMaterials()`: **sin cambios** (leen el caché síncrono).

### `src/lib/screens/Kanban.svelte`
- En `generateColumnPdf` y `sendToRemotePrintCol` (líneas ~596 y ~640): `await molduraStore.load();` antes del `cards.map(...)`.

### `src/lib/components/MoldurasModal.svelte`
- En `loadFacturas()` (o `onMount`): `await molduraStore.load();`.
- `getParsed()` (línea 36): sin cambios (lee caché síncrono).

---

## 5) Migración one-time de localStorage → backend

- Clave: `'moldura-corrections'` (formato actual del store).
- `migrateIfNeeded()`: leer la clave; si no existe o está vacía, no hacer nada.
- Por cada registro: `await api.saveMolduraCorrection({...})` (upsert idempotente; retry seguro).
- Solo si **todos** los POST tienen éxito: `localStorage.removeItem('moldura-corrections')`.
- Si alguno falla: dejar la clave intacta (se reintenta en el próximo `load()`).
- Llamar al inicio de `load()` (antes de fetch de all), para que el GET all ya incluya los migrados.
- (Opcional) reportar en toast/log la cantidad migrada.

---

## 6) Comportamiento y riesgos
- **Depende de red**: sin backend no hay correcciones (antes localStorage funcionaba offline).
- **Compartidas entre estaciones**: corrección guardada en una estación aplica en todas (fuente única backend).
- **Caché**: se refresca al cargar/refrescar Molduras y al abrir Correcciones. Cambios de otra estación aparecen en el próximo refresh.
- **Backend `POST` devuelve objeto**: requiere actualizar el cliente en el mismo release (cambio coordinado).

## 7) Verificación
- **Backend**: probar con curl/Postman → POST devuelve objeto completo; GET all lista todo con `updated_at`; GET por invoice incluye `invoice_id` y `updated_at`; DELETE por id funciona.
- **Frontend**: `npm run check` (baseline esperado: 71 errores / 30 archivos, **sin errores nuevos** en los archivos tocados).
- **Manual E2E**:
  1. Migración: tener correcciones en localStorage → arrancar app → verificar que aparecen en el modal Correcciones (ahora desde backend) y que la clave localStorage quedó vacía.
  2. Guardar una corrección → refrescar → se mantiene (backend).
  3. Nueva factura con la misma medida exacta → hereda la corrección (✏️ / ↪️).
  4. Revertir desde el modal → desaparece en todas las tarjetas cargadas.
  5. Generar PDF con template `clasico-modificado` desde Molduras, Kanban y MoldurasModal → muestra valores corregidos.

## 8) Fuera de alcance / notas
- No mover el matching a backend (decisión: enfoque B).
- Endpoint `/match` del backend queda sin uso; no se elimina salvo pedido.
- Archivo store conserva su nombre `molduraCorrectionsLocal.ts` (renombrar es opcional y requiere actualizar 4 imports).
