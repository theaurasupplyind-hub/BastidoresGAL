# Guía de Release — Bastidores GAL

## Historial de problemas resueltos

### 1. URL del instalador incorrecta (`latest.json`)

**Síntoma**: `signature verification failed` al buscar actualización.

**Causa**: El `release.ps1` original generaba la URL del instalador con el nombre extraído del disco (`Bastidores GAL_2.2.x_x64-setup.exe` con espacio), pero `gh release upload` guarda los archivos en GitHub reemplazando espacios por puntos (`Bastidores.GAL_2.2.x_x64-setup.exe`). La URL apuntaba a un nombre que no existía en GitHub, descargando un HTML 404, y la firma no coincidía.

**Fix** (`release.ps1` línea 67):
```powershell
$exeName = $exeFile.Name -replace ' ','.'
```
Reemplaza espacios por puntos en el nombre del archivo para que coincida con lo que GitHub almacena.

---

### 2. JSON malformado en el backend

**Síntoma**: `error decoding response body for url`.

**Causa**: `ConvertTo-Json` de PowerShell 5.1 produce JSON inválido cuando hay caracteres UTF-8 (ej. `ó` en "Actualización"). El backend almacena el JSON tal cual y lo sirve, pero el updater de Tauri no puede parsearlo.

**Fix** (`release.ps1` línea 70): Reemplazar `ConvertTo-Json` por construcción manual del string JSON:
```powershell
$latestJson = '{"version":"v' + $Version + '",...}'
```

---

### 3. Firma incorrecta en el manifest

**Síntoma**: `The signature could not be decoded`.

**Causa**: Se intentó usar solo la línea 2 del `.sig` (la firma base64 pura), pero Tauri espera el contenido **completo** del `.sig` (con las líneas `untrusted comment` y `trusted comment` incluidas).

**Fix** (`release.ps1` línea 60): Usar el contenido completo del `.sig`:
```powershell
$signature = (Get-Content $sigFile.FullName -Raw).Trim()
```

---

### 4. Archivo en GitHub diferente al firmado

**Síntoma**: `signature verification failed` a pesar de tener URL y firma correctas.

**Causa**: El `.exe` en GitHub tenía un hash diferente al archivo local que se firmó. Probablemente el build se ejecutó dos veces y el `.sig` correspondía al primer build, mientras que el `.exe` se re-subió de un segundo build.

**Fix**: Re-subir AMBOS archivos juntos con `--clobber`:
```powershell
gh release upload $Tag $exeFile.FullName $sigFile.FullName --clobber
```

---

## Proceso de release (pasos)

1. Editar `src-tauri/tauri.conf.json` → incrementar `version`
2. Commitear los cambios
3. Cerrar PowerShell y abrir uno nuevo
4. Ejecutar: `. C:\Users\jesus\.tauri\release.ps1`
5. El script:
   - Lee la versión de `tauri.conf.json`
   - Configura la clave de firma
   - Compila la app (`npm run tauri build`)
   - Extrae la firma del `.sig`
   - Construye el JSON del manifest
   - Sube el manifest al backend vía API
   - Hace git commit + push + tag
   - Sube `.exe` y `.sig` al release de GitHub

---

## Componentes clave

| Componente | Ubicación |
|-----------|-----------|
| Script de release | `~\.tauri\release.ps1` |
| Clave privada (firma) | `~\.tauri\galv2.key` (contraseña: `jesus90`) |
| Clave pública (verificación) | `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` |
| Key ID | `2758D35578273AD3` |
| Backend (API) | `https://api-bastidores.onrender.com` |
| Endpoint manifest | `POST /updater/manifest` (token: `de0cc63994894c43a3f21a96281ccfc5`) |
| Endpoint público | `GET /latest.json` |
| Código backend | `D:\jesus\Documents\Desarrollo\backend_gal\main.py` (líneas 3361-3382) |

---

## Notas importantes

- **Siempre cerrar y reabrir PowerShell** antes de ejecutar `release.ps1` para asegurar que se carga la última versión del script.
- `gh release upload` reemplaza espacios por puntos en los nombres de archivo en GitHub.
- El backend almacena el JSON en una tabla `update_manifest` con `id=1`. Solo hay un manifest activo.
- La app instalada con v2.2.3 o anterior tiene una pubkey diferente (`2B8408392103D940`). Esas versiones JAMÁS podrán actualizar por el updater. Deben instalar manualmente v2.2.7+.
- Al hacer un release, el script sube el `.exe` y `.sig` al mismo tiempo. Si se corre el script dos veces, el segundo build puede producir un `.exe` con hash diferente al del `.sig` original. Siempre usar `--clobber` para sobrescribir ambos archivos.
