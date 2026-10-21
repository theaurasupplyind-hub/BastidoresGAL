@echo off
rem ---------------------------------------------------------------------------
rem with-msvc.cmd - Carga el entorno de MSVC (vcvars64.bat) y ejecuta un comando.
rem
rem Por que existe: esta PC tiene Visual Studio instalado en disco pero SIN
rem registrar en el Visual Studio Installer (no existe
rem C:\ProgramData\Microsoft\VisualStudio\Packages\_Instances ni la clave
rem HKLM\...\VisualStudio\SxS\VS7). Por eso vswhere no ve nada y rustc no puede
rem autodetectar el linker: "error: linker `link.exe` not found".
rem
rem Uso:
rem   scripts\with-msvc.cmd tauri dev
rem   scripts\with-msvc.cmd tauri build
rem   scripts\with-msvc.cmd cargo build --manifest-path src-tauri\Cargo.toml
rem   scripts\with-msvc.cmd            (abre una consola con el entorno cargado)
rem
rem Se puede forzar la ruta con la variable de entorno MSVC_VCVARS64.
rem ---------------------------------------------------------------------------
setlocal EnableExtensions EnableDelayedExpansion

set "VCVARS="
if defined MSVC_VCVARS64 if exist "%MSVC_VCVARS64%" set "VCVARS=%MSVC_VCVARS64%"

rem 1) Deteccion estandar: vswhere (funciona cuando VS esta registrado).
if not defined VCVARS set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not defined VCVARS if exist "!VSWHERE!" for /f "usebackq delims=" %%I in (`"!VSWHERE!" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2^>nul`) do if not defined VCVARS if exist "%%I\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=%%I\VC\Auxiliary\Build\vcvars64.bat"

rem 2) Fallback: instalaciones presentes en disco pero no registradas.
if not defined VCVARS for %%P in (
  "%ProgramFiles%\Microsoft Visual Studio\2022\Community"
  "%ProgramFiles%\Microsoft Visual Studio\2022\Professional"
  "%ProgramFiles%\Microsoft Visual Studio\2022\Enterprise"
  "%ProgramFiles%\Microsoft Visual Studio\2022\BuildTools"
  "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools"
  "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\Community"
  "%ProgramFiles(x86)%\Microsoft Visual Studio\2019\Community"
  "%ProgramFiles(x86)%\Microsoft Visual Studio\2019\BuildTools"
) do if not defined VCVARS if exist "%%~P\VC\Auxiliary\Build\vcvars64.bat" set "VCVARS=%%~P\VC\Auxiliary\Build\vcvars64.bat"

if not defined VCVARS (
  echo [with-msvc] ERROR: no se encontro vcvars64.bat.
  echo [with-msvc] Instale "Desarrollo de escritorio con C++" o defina MSVC_VCVARS64.
  exit /b 1
)

if "%~1"=="" (
  echo [with-msvc] Entorno MSVC cargado: "!VCVARS!"
  echo [with-msvc] Escriba "exit" para salir de esta consola.
  call "!VCVARS!" >nul
  cmd /k
  exit /b 0
)

echo [with-msvc] Entorno MSVC: "!VCVARS!"
call "!VCVARS!" >nul
if errorlevel 1 (
  echo [with-msvc] ERROR: fallo la carga de vcvars64.bat.
  exit /b 1
)

rem "call" es imprescindible: si el comando es un .cmd (p.ej. los shims de
rem node_modules\.bin, como tauri.cmd) y se invoca sin call, cmd transfiere el
rem contexto de batch y el SETLOCAL/ENDLOCAL interno del shim restaura el entorno
rem previo a vcvars -> cargo/cc-rs se quedan sin variables de MSVC.
call %*
exit /b !ERRORLEVEL!
