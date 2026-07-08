mod config;
mod pdf;

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
fn print_pdf(app: tauri::AppHandle, path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        // 1. Verificar si hay impresora predeterminada
        let check = std::process::Command::new("powershell")
            .args(&[
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle", "Hidden",
                "-Command",
                "if (Get-Printer -Default) { exit 0 } else { exit 1 }",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output();

        let has_printer = check
            .map(|o| o.status.success())
            .unwrap_or(true);

        if !has_printer {
            return Err(
                "NO_PRINTER:❌ No se encontró una impresora predeterminada.\nPara configurar una: Windows → Configuración → Bluetooth y dispositivos → Impresoras y escáneres → Agregar impresora.".to_string()
            );
        }

        // 2. Intentar con SumatraPDF (impresión silenciosa)
        let resource_dir = app.path()
            .resource_dir()
            .map_err(|e| format!("Error al acceder a recursos de la aplicación: {}", e))?;
        let sumatra = resource_dir.join("SumatraPDF.exe");

        if sumatra.exists() {
            let result = std::process::Command::new(&sumatra)
                .args(["-print-to-default", &path])
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
                "NO_SE_PUDO_IMPRIMIR:❌ No se pudo imprimir.\n\
                 SumatraPDF no disponible y el intento con PowerShell falló: {}\n\
                 Verificá la impresora en: Windows → Configuración → Bluetooth y dispositivos → Impresoras y escáneres.",
                e
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

#[derive(serde::Deserialize)]
pub struct InvoiceItemParam {
    cantidad: f64,
    descripcion: String,
    precio_unitario: f64,
    total: f64,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_process::init())
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
            open_pdf,
            print_pdf,
            open_whatsapp,
            show_whatsapp_helper,
            close_whatsapp_helper,
            paste_and_send_to_whatsapp,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
