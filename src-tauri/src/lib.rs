mod config;
mod pdf;
mod print_agent;

use config::{AppConfig, AppState};
use pdf::InvoiceStyle;
use tauri::Manager;

#[tauri::command]
fn get_config(state: tauri::State<AppState>) -> Result<AppConfig, String> {
    state.config.lock().map(|c| c.clone()).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_config(state: tauri::State<AppState>, config: AppConfig) -> Result<(), String> {
    state.save_config(&config)
}

#[tauri::command]
fn get_user(state: tauri::State<AppState>) -> Result<Option<config::UserState>, String> {
    state.user.lock().map(|u| u.clone()).map_err(|e| e.to_string())
}

#[tauri::command]
fn login(state: tauri::State<AppState>, username: String) -> Result<config::UserState, String> {
    state.save_session(&username)?;
    state
        .user
        .lock()
        .map(|u| u.clone().unwrap())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn logout(state: tauri::State<AppState>) -> Result<(), String> {
    let path = state.data_dir.join("session.json");
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    if let Ok(mut u) = state.user.lock() {
        *u = None;
    }
    Ok(())
}

#[tauri::command]
fn get_data_dir(state: tauri::State<AppState>) -> Result<String, String> {
    Ok(state.data_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn get_log_path(state: tauri::State<AppState>) -> Result<String, String> {
    let path = state.data_dir.join("app_debug.log");
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn wake_server() -> Result<String, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get("https://api-bastidores.onrender.com/sync/status")
        .send()
        .map_err(|e| format!("Servidor no disponible: {}", e))?;

    if res.status().is_success() {
        Ok("Servidor listo".into())
    } else {
        Err(format!("Servidor respondió: {}", res.status()))
    }
}

#[tauri::command]
fn generate_pdf(
    state: tauri::State<AppState>,
    num_presupuesto: String,
    num_factura: String,
    fecha: String,
    cliente_nombre: String,
    cliente_domicilio: String,
    cliente_telefono: String,
    items: Vec<InvoiceItemParam>,
    total: f64,
    envio: f64,
    is_presupuesto: bool,
    style_name: String,
) -> Result<String, String> {
    let style = InvoiceStyle::from_name(&style_name);
    let pdf_items: Vec<pdf::InvoiceItem> = items
        .into_iter()
        .map(|i| pdf::InvoiceItem {
            cantidad: i.cantidad,
            descripcion: i.descripcion,
            precio_unitario: i.precio_unitario,
            total: i.total,
        })
        .collect();

    let data = pdf::InvoiceData {
        num_presupuesto,
        num_factura,
        fecha,
        cliente_nombre,
        cliente_domicilio,
        cliente_telefono,
        items: pdf_items,
        total,
        envio,
        is_presupuesto,
        style,
    };

    // Output path in app data dir
    let output_dir = state.data_dir.join("generated_invoices");
    std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;
    let output_path = output_dir.join(format!("factura_{}.pdf", data.num_factura));
    let output_str = output_path.to_string_lossy().to_string();

    // Asset paths from resource
    let asset = |name: &str| -> Option<String> {
        std::env::current_dir().ok().and_then(|cwd| {
            let p = cwd.join("assets").join(name);
            if p.exists() { Some(p.to_string_lossy().to_string()) } else { None }
        })
    };

    let logo_path = asset("brand-logo.png");
    let ign_path = asset("ign.png");
    let header_path = asset("headercompleto.png");

    pdf::generate_invoice(&data, &output_str, logo_path.as_deref(), ign_path.as_deref(), header_path.as_deref())?;
    Ok(output_str)
}

#[tauri::command]
fn generate_molduras_pdf(
    state: tauri::State<AppState>,
    html: String,
) -> Result<String, String> {
    let output_dir = state.data_dir.join("generated_invoices");
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let output_path = output_dir.join(format!("molduras_{}.pdf", timestamp));
    let output_str = output_path.to_string_lossy().to_string();
    pdf::generate_molduras_pdf(&html, &output_str)?;
    Ok(output_str)
}

#[tauri::command]
fn generate_invoices_pdf(
    state: tauri::State<AppState>,
    invoices: Vec<BatchInvoiceParam>,
) -> Result<String, String> {
    if invoices.is_empty() {
        return Err("No se seleccionaron facturas".to_string());
    }

    let pdf_invoices: Vec<pdf::InvoiceData> = invoices
        .into_iter()
        .map(|inv| {
            let style = pdf::InvoiceStyle::from_name(&inv.style_name);
            let pdf_items: Vec<pdf::InvoiceItem> = inv
                .items
                .into_iter()
                .map(|i| pdf::InvoiceItem {
                    cantidad: i.cantidad,
                    descripcion: i.descripcion,
                    precio_unitario: i.precio_unitario,
                    total: i.total,
                })
                .collect();
            pdf::InvoiceData {
                num_presupuesto: inv.num_presupuesto,
                num_factura: inv.num_factura,
                fecha: inv.fecha,
                cliente_nombre: inv.cliente_nombre,
                cliente_domicilio: inv.cliente_domicilio,
                cliente_telefono: inv.cliente_telefono,
                items: pdf_items,
                total: inv.total,
                envio: inv.envio,
                is_presupuesto: inv.is_presupuesto,
                style,
            }
        })
        .collect();

    let output_dir = state.data_dir.join("generated_invoices");
    std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let output_path = output_dir.join(format!("facturas_batch_{}.pdf", timestamp));
    let output_str = output_path.to_string_lossy().to_string();

    pdf::generate_invoices_batch(&pdf_invoices, &output_str)?;
    Ok(output_str)
}

#[tauri::command]
fn open_whatsapp(phone: String) -> Result<String, String> {
    open_whatsapp_desktop(&phone)
}

#[tauri::command]
fn close_whatsapp_helper(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("whatsapp-helper") {
        win.close().map_err(|e| format!("Error al cerrar helper: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn paste_and_send_to_whatsapp(app: tauri::AppHandle) -> Result<(), String> {
    // Hide helper so focus returns to WhatsApp
    if let Some(win) = app.get_webview_window("whatsapp-helper") {
        let _ = win.hide();
    }
    std::thread::sleep(std::time::Duration::from_millis(400));

    #[cfg(target_os = "windows")]
    {
        use enigo::{Enigo, Keyboard, Key, Direction, Settings};
        let mut enigo = Enigo::new(&Settings::default())
            .map_err(|e| format!("enigo init: {:?}", e))?;

        enigo.key(Key::Control, Direction::Press)
            .map_err(|e| format!("ctrl press: {:?}", e))?;
        enigo.key(Key::Unicode('v'), Direction::Click)
            .map_err(|e| format!("v: {:?}", e))?;
        enigo.key(Key::Control, Direction::Release)
            .map_err(|e| format!("ctrl release: {:?}", e))?;

        std::thread::sleep(std::time::Duration::from_millis(200));

        enigo.key(Key::Return, Direction::Click)
            .map_err(|e| format!("enter: {:?}", e))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
    }

    Ok(())
}

#[tauri::command]
async fn show_whatsapp_helper(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("whatsapp-helper") {
        let _ = win.set_always_on_top(true);
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    let mut builder = tauri::WebviewWindowBuilder::new(
        &app,
        "whatsapp-helper",
        tauri::WebviewUrl::App("whatsapp-helper.html".into()),
    )
    .title("")
    .inner_size(320.0, 200.0)
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(true)
    .visible(false);

    if let Some(main) = app.get_webview_window("main") {
        if let (Ok(pos), Ok(size), Ok(scale)) = (
            main.outer_position(),
            main.outer_size(),
            main.scale_factor(),
        ) {
            let x = (pos.x as f64 / scale) + (size.width as f64 / scale) - 340.0;
            let y = (pos.y as f64 / scale) + (size.height as f64 / scale) - 240.0;
            builder = builder.position(x, y);
        }
    }

    let win = builder
        .build()
        .map_err(|e| format!("No se pudo abrir el helper de WhatsApp: {e}"))?;

    let _ = win.set_always_on_top(true);
    let _ = win.show();
    let _ = win.set_focus();
    Ok(())
}

#[cfg(target_os = "windows")]
fn open_whatsapp_desktop(phone: &str) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    use std::path::PathBuf;

    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let phone_digits: String = phone.chars().filter(|c| c.is_ascii_digit()).collect();
    let uri = if phone_digits.is_empty() {
        "whatsapp://".to_string()
    } else {
        format!("whatsapp://send?phone={phone_digits}")
    };

    let protocol_registered = std::process::Command::new("reg")
        .args(["query", r"HKEY_CLASSES_ROOT\whatsapp"])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map(|status| status.success())
        .unwrap_or(false);

    if protocol_registered {
        std::process::Command::new("cmd.exe")
            .args(["/C", "start", "", &uri])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Error al abrir WhatsApp Desktop: {}", e))?;
        return Ok("desktop".into());
    }

    let mut desktop_paths = Vec::new();
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        desktop_paths.push(PathBuf::from(&local_app_data).join(r"WhatsApp\WhatsApp.exe"));
        desktop_paths.push(PathBuf::from(&local_app_data).join(r"Programs\WhatsApp\WhatsApp.exe"));
    }
    if let Ok(program_files) = std::env::var("ProgramFiles") {
        desktop_paths.push(PathBuf::from(&program_files).join(r"WhatsApp\WhatsApp.exe"));
    }

    if let Some(desktop_path) = desktop_paths.into_iter().find(|path| path.exists()) {
        std::process::Command::new(desktop_path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Error al lanzar WhatsApp Desktop: {}", e))?;
        return Ok("desktop".into());
    }

    Ok("web".into())
}

#[cfg(not(target_os = "windows"))]
fn open_whatsapp_desktop(_phone: &str) -> Result<String, String> {
    Ok("web".into())
}

#[tauri::command]
fn open_pdf(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        std::process::Command::new("cmd.exe")
            .args(["/C", "start", "", &path])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| format!("Error al abrir PDF: {}", e))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Error al abrir PDF: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
fn print_pdf(app: tauri::AppHandle, state: tauri::State<AppState>, path: String) -> Result<(), String> {
    let path = if cfg!(target_os = "windows") {
        path.trim_start_matches("\\\\?\\").to_string()
    } else {
        path
    };
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let config = state.config.lock().map_err(|e| e.to_string())?;
        let selected = config.selected_printer.clone();
        drop(config);

        // 1. Obtener nombre de la impresora a usar
        let printer_name = if let Some(name) = selected {
            name
        } else {
            // Detectar impresora default via WMI
            let check = std::process::Command::new("powershell")
                .args(&[
                    "-NoProfile",
                    "-NonInteractive",
                    "-WindowStyle", "Hidden",
                    "-Command",
                    "Get-CimInstance Win32_Printer -Filter 'Default=True' | Select-Object -ExpandProperty Name",
                ])
                .creation_flags(CREATE_NO_WINDOW)
                .output();

            match check {
                Ok(output) => {
                    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    if stdout.is_empty() {
                        return Err(
                            "NO_PRINTER:❌ No se encontró una impresora predeterminada.\n\
                             Configurala en: Configuración → Impresora, o seleccioná una en Configuración de la app.".to_string()
                        );
                    }
                    stdout
                }
                Err(_) => {
                    return Err(
                        "NO_PRINTER:❌ No se pudo verificar la impresora.\n\
                         Configurala en: Configuración → Impresora.".to_string()
                    );
                }
            }
        };

        // 2. Intentar con SumatraPDF (impresión silenciosa)
        let resource_dir = app.path()
            .resource_dir()
            .map_err(|e| format!("Error al acceder a recursos de la aplicación: {}", e))?;
        let sumatra = resource_dir.join("SumatraPDF.exe");

        if sumatra.exists() {
            let result = std::process::Command::new(&sumatra)
                .args(["-print-to", &printer_name, &path])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn();
            if result.is_ok() {
                return Ok(());
            }
        }

        // 3. Fallback: PowerShell Start-Process -Verb Print (diálogo nativo de Windows)
        let fallback = std::process::Command::new("powershell")
            .args(&[
                "-NoProfile",
                "-WindowStyle", "Hidden",
                "-Command",
                &format!("Start-Process -FilePath '{}' -Verb Print", path),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();

        match fallback {
            Ok(_) => Ok(()),
            Err(e) => Err(format!(
                "NO_SE_PUDO_IMPRIMIR:❌ No se pudo imprimir con '{}' SumatraPDF no disponible y el intento con PowerShell falló: {}\n\
                 Verificá la impresora en: Windows → Configuración → Impresoras y escáneres.",
                printer_name, e
            )),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("lp")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Error al ejecutar lp: {}", e))?;
        Ok(())
    }
}

#[tauri::command]
fn list_printers() -> Result<Vec<String>, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let output = std::process::Command::new("powershell")
            .args(&[
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle", "Hidden",
                "-Command",
                "Get-CimInstance Win32_Printer | Select-Object -ExpandProperty Name",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("Error al listar impresoras: {}", e))?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let printers: Vec<String> = stdout
            .lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect();

        Ok(printers)
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(vec![])
    }
}

#[derive(serde::Deserialize)]
pub struct InvoiceItemParam {
    cantidad: f64,
    descripcion: String,
    precio_unitario: f64,
    total: f64,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct BatchInvoiceParam {
    num_presupuesto: String,
    num_factura: String,
    fecha: String,
    cliente_nombre: String,
    cliente_domicilio: String,
    cliente_telefono: String,
    items: Vec<InvoiceItemParam>,
    total: f64,
    envio: f64,
    is_presupuesto: bool,
    style_name: String,
}

// ==========================================
// PRINT AGENT COMMANDS
// ==========================================

#[tauri::command]
fn start_print_agent(
    app: tauri::AppHandle,
    agent_state: tauri::State<print_agent::PrintAgentHandle>,
) -> Result<(), String> {
    print_agent::start_agent(app, agent_state);
    Ok(())
}

#[tauri::command]
fn stop_print_agent(agent_state: tauri::State<print_agent::PrintAgentHandle>) -> Result<(), String> {
    print_agent::stop_agent(agent_state);
    Ok(())
}

#[tauri::command]
fn get_print_agent_status(agent_state: tauri::State<print_agent::PrintAgentHandle>) -> print_agent::PrintAgentStatus {
    print_agent::get_status(agent_state)
}

#[tauri::command]
fn register_station(
    state: tauri::State<AppState>,
    name: String,
) -> Result<serde_json::Value, String> {
    {
        let config = state.config.lock().map_err(|e| e.to_string())?;
        if config.station_id.is_some() {
            return Err("Ya hay una estación registrada en esta PC. Desvinculá la estación actual primero.".into());
        }
    }

    let user = state.user.lock().map_err(|e| e.to_string())?;
    let user_id = user.as_ref().map(|u| u.user_id);
    let user_name = user.as_ref().map(|u| u.user_name.clone());
    drop(user);

    let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    rt.block_on(async {
        let client = reqwest::Client::new();
        let resp = client
            .post("https://api-bastidores.onrender.com/stations")
            .json(&serde_json::json!({
                "name": name,
                "user_id": user_id,
                "user_name": user_name,
            }))
            .timeout(std::time::Duration::from_secs(60))
            .send()
            .await
            .map_err(|e| format!("Error de red: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("HTTP {}: {}", status, text));
        }

        let data: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

        // Save to config
        if let Some(api_key) = data.get("api_key").and_then(|v| v.as_str()) {
            if let Some(id) = data.get("id").and_then(|v| v.as_u64()) {
                let mut config = state.config.lock().map_err(|e| e.to_string())?;
                config.station_id = Some(id as u32);
                config.station_api_key = Some(api_key.to_string());
                config.station_name = Some(name);
                let cfg_clone = config.clone();
                drop(config);
                state.save_config(&cfg_clone).map_err(|e| e.to_string())?;
            }
        }

        Ok(data)
    })
}

#[tauri::command]
fn unregister_station(state: tauri::State<AppState>) -> Result<(), String> {
    let mut config = state.config.lock().map_err(|e| e.to_string())?;
    config.station_id = None;
    config.station_api_key = None;
    config.station_name = None;
    let cfg_clone = config.clone();
    drop(config);
    state.save_config(&cfg_clone).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_print_stations() -> Result<Vec<serde_json::Value>, String> {
    let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    rt.block_on(async {
        let client = reqwest::Client::new();
        let resp = client
            .get("https://api-bastidores.onrender.com/stations")
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Error de red: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }

        resp.json().await.map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn submit_print_job(
    state: tauri::State<AppState>,
    pdf_path: String,
    created_by: String,
    api_key: Option<String>,
) -> Result<serde_json::Value, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    let api_key = api_key
        .or_else(|| config.station_api_key.clone())
        .ok_or("No hay API key configurada. Registre esta estación primero.")?;
    drop(config);

    let pdf_bytes = std::fs::read(&pdf_path).map_err(|e| format!("Error al leer PDF: {}", e))?;
    let file_name = std::path::Path::new(&pdf_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("documento.pdf")
        .to_string();

    let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    rt.block_on(async {
        let client = reqwest::Client::new();
        let form = reqwest::multipart::Form::new()
            .part(
                "file",
                reqwest::multipart::Part::bytes(pdf_bytes)
                    .file_name(file_name)
                    .mime_str("application/pdf")
                    .map_err(|e| e.to_string())?,
            )
            .text("created_by", created_by);

        let resp = client
            .post("https://api-bastidores.onrender.com/print-jobs")
            .header("X-Api-Key", &api_key)
            .multipart(form)
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .map_err(|e| format!("Error de red: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("HTTP {}: {}", status, text));
        }

        resp.json().await.map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn check_print_job_status(
    state: tauri::State<AppState>,
    job_id: u32,
) -> Result<serde_json::Value, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    let api_key = config
        .station_api_key
        .as_deref()
        .ok_or("No hay API key configurada")?
        .to_string();
    drop(config);

    let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    rt.block_on(async {
        let client = reqwest::Client::new();
        let resp = client
            .get(format!("https://api-bastidores.onrender.com/print-jobs/{}/status", job_id))
            .header("X-Api-Key", &api_key)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Error de red: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("HTTP {}: {}", status, text));
        }

        resp.json().await.map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn delete_station(
    state: tauri::State<AppState>,
    station_id: u32,
) -> Result<serde_json::Value, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    let api_key = config.station_api_key.clone().unwrap_or_default();
    drop(config);

    let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    rt.block_on(async {
        let client = reqwest::Client::new();
        let resp = client
            .delete(format!("https://api-bastidores.onrender.com/stations/{}", station_id))
            .header("X-Api-Key", &api_key)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Error de red: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("HTTP {}: {}", status, text));
        }

        resp.json().await.map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn get_print_job_history(
    state: tauri::State<AppState>,
    station_key: Option<String>,
) -> Result<Vec<serde_json::Value>, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    let api_key = station_key
        .or_else(|| config.station_api_key.clone())
        .ok_or("No hay API key. ¿Registraste la estación o seleccionaste una estación destino?")?;
    drop(config);

    let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    rt.block_on(async {
        let client = reqwest::Client::new();
        let resp = client
            .get("https://api-bastidores.onrender.com/print-jobs/history")
            .header("X-Api-Key", &api_key)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Error de red: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("HTTP {}: {}", status, text));
        }

        resp.json().await.map_err(|e| e.to_string())
    })
}

#[tauri::command]
fn cancel_print_job(
    state: tauri::State<AppState>,
    job_id: u32,
    station_key: Option<String>,
) -> Result<serde_json::Value, String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    let api_key = station_key
        .or_else(|| config.station_api_key.clone())
        .ok_or("No hay API key")?;
    drop(config);

    let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    rt.block_on(async {
        let client = reqwest::Client::new();
        let resp = client
            .patch(format!("https://api-bastidores.onrender.com/print-jobs/{}/cancel", job_id))
            .header("X-Api-Key", &api_key)
            .timeout(std::time::Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| format!("Error de red: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("HTTP {}: {}", status, text));
        }

        resp.json().await.map_err(|e| e.to_string())
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new())
        .manage(print_agent::PrintAgentHandle::new())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            get_user,
            login,
            logout,
            get_data_dir,
            get_log_path,
            wake_server,
            generate_pdf,
            generate_molduras_pdf,
            generate_invoices_pdf,
            open_pdf,
            print_pdf,
            list_printers,
            open_whatsapp,
            show_whatsapp_helper,
            close_whatsapp_helper,
            paste_and_send_to_whatsapp,
            start_print_agent,
            stop_print_agent,
            get_print_agent_status,
            register_station,
            unregister_station,
            list_print_stations,
            submit_print_job,
            check_print_job_status,
            delete_station,
            get_print_job_history,
            cancel_print_job,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
