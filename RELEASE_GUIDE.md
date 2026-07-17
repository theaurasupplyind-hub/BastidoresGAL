# Guía de Release — Bastidores GAL

## Historial de problemas resueltos

### 5. (CAUSA RAÍZ) Espacio en `productName`

**Síntoma**: `signature verification failed` persistente a pesar de aplicar los parches #1-#4.

**Causa raíz**: El `productName` en `tauri.conf.json` era `"Bastidores GAL"` (con espacio). Esto provocaba que:
  - El build generara `Bastidores GAL_2.2.x_x64-setup.exe` (con espacio)
  - La firma (`.sig`) incluyera `file:Bastidores GAL_2.2.x_x64-setup.exe` en su `trusted comment`
  - GitHub almacenara el archivo como `Bastidores.GAL_2.2.x_x64-setup.exe` (espacio → punto)
  - La URL se parcheaba para usar puntos, pero la firma internamente seguía teniendo espacios
  - Al descargar, el filename real (con puntos) no coincidía con el filename firmado (con espacios), causando el error de verificación

**Fix definitivo** (v2.2.10+): Cambiar `productName` de `"Bastidores GAL"` a `"BastidoresGAL"` en `tauri.conf.json`. Al no haber espacios:
  - El build produce `BastidoresGAL_2.2.x_x64-setup.exe`
  - La firma contiene `file:BastidoresGAL_2.2.x_x64-setup.exe`
  - GitHub almacena exactamente el mismo nombre (no hay espacios que convertir)
  - El release script ya no necesita el `-replace ' ','.'`

**Nota**: Los parches #1, #3 y #4 ya no son necesarios tras este cambio. Se mantienen documentados por referencia histórica.

---

### 6. JSON mangling con `curl.exe` en PowerShell 5.1

**Síntoma**: `error decoding response body for url` — el backend devuelve JSON sin comillas en las claves/valores (`{version:v2.2.10...}`).

**Causa**: PowerShell 5.1 al pasar un string con comillas dobles a `curl.exe` (native EXE) manglea los quotes. El JSON llega al backend corrupto y se almacena tal cual.

**Fix** (`release.ps1` líneas 71-79): Reemplazar `curl.exe --data-binary "$latestJson"` con `Invoke-RestMethod -Body $latestJson`, que envía el string directamente sin pasarlo por un proceso externo.

---

### 1. URL del instalador incorrecta (`latest.json`)

**Síntoma**: `signature verification failed` al buscar actualización.

**Causa**: El `release.ps1` original generaba la URL del instalador con el nombre extraído del disco (`Bastidores GAL_2.2.x_x64-setup.exe` con espacio), pero `gh release upload` guarda los archivos en GitHub reemplazando espacios por puntos (`Bastidores.GAL_2.2.x_x64-setup.exe`). La URL apuntaba a un nombre que no existía en GitHub, descargando un HTML 404, y la firma no coincidía.

**Fix anterior** (`release.ps1` línea 67):
```powershell
$exeName = $exeFile.Name -replace ' ','.'
```
Reemplazaba espacios por puntos en el nombre del archivo para que coincida con lo que GitHub almacena.

**⚠️ Ya no es necesario desde v2.2.10**: el `productName` ahora es `BastidoresGAL` (sin espacios), por lo que el filename no necesita transformación.

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

### 7. URL con punto + firma desincronizada (v2.2.11)

**Síntomas**: Primero `Download request failed with status: 404 Not Found`, luego de corregir la URL aparece `signature verification failed`.

**Causa**:
- **URL**: El `latest.json` se generó con `Bastidores.**GAL**` (con punto) cuando el archivo real en GitHub es `BastidoresGAL` (sin punto). A pesar de que el `release.ps1` ya no tiene el `-replace`, la URL se generó incorrectamente por una versión anterior del script o edición manual.
- **Firma**: El `.exe` subido a GitHub tiene un hash diferente al que se firmó localmente. Ocurre cuando el build se ejecuta dos veces: el `.sig` corresponde al primer build y el `.exe` al segundo.

**Fix completo** (refirmar el `.exe` desde GitHub):
```powershell
$Tag     = "v2.2.11"
$Version = "2.2.11"
$Repo    = "theaurasupplyind-hub/BastidoresGAL"
$Token   = "de0cc63994894c43a3f21a96281ccfc5"

# 1. Descargar el .exe de GitHub
$tmpDir = "$env:TEMP\sigfix"
Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
$exePath = "$tmpDir\BastidoresGAL_$($Version)_x64-setup.exe"
$exeUrl = "https://github.com/$Repo/releases/download/$Tag/BastidoresGAL_$($Version)_x64-setup.exe"
Invoke-WebRequest -Uri $exeUrl -OutFile $exePath -TimeoutSec 120

# 2. Firmar con la clave privada
$key = (Get-Content "$env:USERPROFILE\.tauri\galv2.key" -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY          = $key
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "jesus90"
Push-Location "D:\jesus\Documents\Desarrollo\galv2-tauri"
npx tauri signer sign "$exePath"
Pop-Location

# 3. Subir el nuevo .sig a GitHub
$sigPath = "$exePath.sig"
gh release upload $Tag "$sigPath" --repo $Repo --clobber

# 4. Actualizar backend con nueva firma y URL correcta
$newSig = (Get-Content $sigPath -Raw).Trim()
$correctUrl = "https://github.com/$Repo/releases/download/$Tag/BastidoresGAL_$($Version)_x64-setup.exe"
$now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$latestJson = '{"version":"v' + $Version + '","notes":"Actualizacion v' + $Version + '","pub_date":"' + $now + '","platforms":{"windows-x86_64":{"signature":"' + $newSig + '","url":"' + $correctUrl + '"}}}'
Invoke-RestMethod -Uri "https://api-bastidores.onrender.com/updater/manifest" -Method Post -Headers @{ Authorization = "Bearer $Token"; "Content-Type" = "application/json" } -Body $latestJson -TimeoutSec 120

# 5. Verificar sincronización
$backendSig = (Invoke-RestMethod "https://api-bastidores.onrender.com/latest.json").platforms.'windows-x86_64'.signature
$ghSig = (Invoke-RestMethod -Uri "https://github.com/$Repo/releases/download/$Tag/BastidoresGAL_$($Version)_x64-setup.exe.sig" -Headers @{"Accept"="application/octet-stream"})
"Backend == GitHub: " + ($backendSig -eq $ghSig.Trim())
```

**Prevención**: Al ejecutar `release.ps1`, el script sube `.exe` y `.sig` **juntos** con `--clobber` en el mismo comando (linea 112). Si el build se corre dos veces, asegurarse de que ambos archivos se sobrescriban juntos.

---

## Proceso de release (pasos)

1. Editar `src-tauri/tauri.conf.json` → incrementar `version`
2. Agregar entrada en `src/lib/data/changelog.ts` con las notas de la nueva versión
3. Commitear los cambios
4. Cerrar PowerShell y abrir uno nuevo
5. **Verificar** que `C:\Users\jesus\.tauri\release.ps1` NO tenga ningún `-replace` en la línea de la URL (debe usar `$exeFile.Name` directamente)
6. Ejecutar: `. C:\Users\jesus\.tauri\release.ps1`
7. El script:
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
| Código backend (updater) | `D:\jesus\Documents\Desarrollo\backend_gal\main.py` (líneas 3631-3652) |

---

## Notas importantes

- **Siempre cerrar y reabrir PowerShell** antes de ejecutar `release.ps1` para asegurar que se carga la última versión del script.
- `gh release upload` reemplaza espacios por puntos en los nombres de archivo en GitHub.
- El backend almacena el JSON en una tabla `update_manifest` con `id=1`. Solo hay un manifest activo.
- La app instalada con v2.2.3 o anterior tiene una pubkey diferente (`2B8408392103D940`). Esas versiones JAMÁS podrán actualizar por el updater. Deben instalar manualmente v2.2.7+.
- Al hacer un release, el script sube el `.exe` y `.sig` al mismo tiempo. Si se corre el script dos veces, el segundo build puede producir un `.exe` con hash diferente al del `.sig` original. Siempre usar `--clobber` para sobrescribir ambos archivos.
- El `release.ps1` usa `Invoke-RestMethod` para subir el manifest al backend. **NUNCA uses `curl.exe`** para esto desde PowerShell 5.1, porque manglea los quotes del JSON. Siempre usa `Invoke-RestMethod -Body`.
- La contraseña de la clave privada es `jesus90`. Está documentada aquí para emergencias, pero no compartas este archivo.

---

## Recuperación de emergencia

Cuando el release ya se subió a GitHub pero la firma no coincide (`signature verification failed`), usá estos comandos para refirmar el `.exe` y sincronizar todo.

> **Antes de empezar**: Cerrá PowerShell y abrí uno nuevo para evitar caché de variables.

### Variables (cambiá SOLO estos valores según tu versión)

```powershell
$Tag     = "v2.2.11"
$Version = "2.2.11"
$Repo    = "theaurasupplyind-hub/BastidoresGAL"
$Token   = "de0cc63994894c43a3f21a96281ccfc5"
```

### Diagnóstico rápido

```powershell
# 1. Verificar que la firma del backend coincide con el .sig de GitHub
$backendSig = (Invoke-RestMethod "https://api-bastidores.onrender.com/latest.json").platforms.'windows-x86_64'.signature
$ghSig = (Invoke-RestMethod "https://github.com/$Repo/releases/download/$Tag/BastidoresGAL_$($Version)_x64-setup.exe.sig")
"Backend == GitHub .sig: " + ($backendSig -eq $ghSig)

# 2. Verificar la URL del instalador
$url = (Invoke-RestMethod "https://api-bastidores.onrender.com/latest.json").platforms.'windows-x86_64'.url
$url

# 3. Probar que la URL responde (debe dar 200 OK y mostrar size)
curl.exe -sI $url | Select-String "Content-Length"

# 4. Si el backend y GitHub no coinciden, puede ser caché de GitHub CDN.
#    Reintentar con Header Accept para evitar caché:
$ghSigFresh = (Invoke-RestMethod -Uri "https://github.com/$Repo/releases/download/$Tag/BastidoresGAL_$($Version)_x64-setup.exe.sig" -Headers @{"Accept"="application/octet-stream"})
```

### Fix completo — refirmar el `.exe` desde GitHub

```powershell
# 1. Descargar el .exe de GitHub
$tmpDir = "$env:TEMP\sigfix"
Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
$exePath = "$tmpDir\BastidoresGAL_$($Version)_x64-setup.exe"
$exeUrl = "https://github.com/$Repo/releases/download/$Tag/BastidoresGAL_$($Version)_x64-setup.exe"
Invoke-WebRequest -Uri $exeUrl -OutFile $exePath -TimeoutSec 120

# 2. Firmar con la clave privada
$key = (Get-Content "$env:USERPROFILE\.tauri\galv2.key" -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY          = $key
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "jesus90"
Push-Location "D:\jesus\Documents\Desarrollo\galv2-tauri"
npx tauri signer sign "$exePath"
Pop-Location

# 3. Leer la firma generada
$sigPath = "$exePath.sig"
$newSig = (Get-Content $sigPath -Raw).Trim()
"Nueva firma generada: $($newSig.Length) chars"

# 4. Subir el .sig a GitHub (reemplaza el existente)
gh release upload $Tag "$sigPath" --repo $Repo --clobber
".sig subido a GitHub"

# 5. Construir el JSON y subirlo al backend
$correctUrl = "https://github.com/$Repo/releases/download/$Tag/BastidoresGAL_$($Version)_x64-setup.exe"
$now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$latestJson = '{"version":"v' + $Version + '","notes":"Actualizacion v' + $Version + '","pub_date":"' + $now + '","platforms":{"windows-x86_64":{"signature":"' + $newSig + '","url":"' + $correctUrl + '"}}}'
Invoke-RestMethod -Uri "https://api-bastidores.onrender.com/updater/manifest" -Method Post -Headers @{ Authorization = "Bearer $Token"; "Content-Type" = "application/json" } -Body $latestJson -TimeoutSec 120
"Backend actualizado"

# 6. Verificar sincronización (usar Header para evitar caché de GitHub)
$backendSig = (Invoke-RestMethod "https://api-bastidores.onrender.com/latest.json").platforms.'windows-x86_64'.signature
$ghSig = (Invoke-RestMethod -Uri "https://github.com/$Repo/releases/download/$Tag/BastidoresGAL_$($Version)_x64-setup.exe.sig" -Headers @{"Accept"="application/octet-stream"})
$ghSig = $ghSig.Trim()
"Sincronizado: " + ($backendSig -eq $ghSig)

# 7. Limpiar
Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
```

### Fix solo URL (si el filename y la firma están bien pero la URL apunta mal)

```powershell
$correctUrl = "https://github.com/theaurasupplyind-hub/BastidoresGAL/releases/download/v2.2.11/BastidoresGAL_2.2.11_x64-setup.exe"
$now = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$sig = (Invoke-RestMethod "https://api-bastidores.onrender.com/latest.json").platforms.'windows-x86_64'.signature
$latestJson = '{"version":"v2.2.11","notes":"Actualizacion v2.2.11","pub_date":"' + $now + '","platforms":{"windows-x86_64":{"signature":"' + $sig + '","url":"' + $correctUrl + '"}}}'
Invoke-RestMethod -Uri "https://api-bastidores.onrender.com/updater/manifest" -Method Post -Headers @{ Authorization = "Bearer de0cc63994894c43a3f21a96281ccfc5"; "Content-Type" = "application/json" } -Body $latestJson -TimeoutSec 120
"URL corregida"
```
