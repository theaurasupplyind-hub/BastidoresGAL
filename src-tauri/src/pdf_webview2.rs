use std::{
    ptr,
    sync::mpsc,
    sync::OnceLock,
    time::{Duration, Instant},
};

use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2Controller, ICoreWebView2Environment, ICoreWebView2Environment6,
    ICoreWebView2NavigationCompletedEventArgs, ICoreWebView2PrintSettings,
    ICoreWebView2PrintSettings2, ICoreWebView2_7,
};
use webview2_com::{
    CreateCoreWebView2ControllerCompletedHandler, CreateCoreWebView2EnvironmentCompletedHandler,
    NavigationCompletedEventHandler, PrintToPdfCompletedHandler,
};
use windows::{
    core::*,
    Win32::{
        Foundation::*,
        System::Com::*,
        UI::WindowsAndMessaging::*,
    },
};

use std::result::Result as StdResult;

const WND_CLASS_NAME: &str = "GAL_PDF_WEBVIEW2_4082";

/// Opciones de un render: margen en pulgadas (None = 0) y timeout por operacion.
#[derive(Clone, Copy)]
pub struct Webview2PdfOptions {
    pub margin_in: Option<f64>,
    pub timeout: Duration,
}

impl Default for Webview2PdfOptions {
    fn default() -> Self {
        Self {
            margin_in: None,
            timeout: Duration::from_secs(30),
        }
    }
}

/// Peticion hacia el worker de WebView2. Render genera un PDF real; Warm
/// hace una navegacion trivial para dejar el proceso de browser listo.
enum PdfRequest {
    Render {
        html: String,
        output_path: String,
        opts: Webview2PdfOptions,
        result_tx: mpsc::Sender<StdResult<(), String>>,
    },
    Warm {
        result_tx: mpsc::Sender<StdResult<(), String>>,
    },
}

struct WorkerState {
    hwnd: HWND,
    controller: ICoreWebView2Controller,
    env: ICoreWebView2Environment,
}

static WORKER: OnceLock<mpsc::Sender<PdfRequest>> = OnceLock::new();

unsafe extern "system" fn def_wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

unsafe fn register_window_class() -> StdResult<(), String> {
    let class_name: HSTRING = WND_CLASS_NAME.into();
    let wc = WNDCLASSEXW {
        cbSize: std::mem::size_of::<WNDCLASSEXW>() as u32,
        lpfnWndProc: Some(def_wnd_proc),
        lpszClassName: PCWSTR(class_name.as_ptr()),
        ..Default::default()
    };

    let atom = RegisterClassExW(&wc);
    if atom == 0 {
        let err = std::io::Error::last_os_error();
        // ERROR_CLASS_ALREADY_EXISTS (1410) es normal si ya se registro antes
        if err.raw_os_error() == Some(1410) {
            return Ok(());
        }
        return Err(format!("RegisterClassExW: {:?}", err));
    }
    Ok(())
}

unsafe fn create_message_window() -> StdResult<HWND, String> {
    register_window_class()?;

    let class_name: HSTRING = WND_CLASS_NAME.into();
    let window_name: HSTRING = "_gal_pdf_render".into();

    let hwnd = CreateWindowExW(
        WINDOW_EX_STYLE(0),
        PCWSTR(class_name.as_ptr()),
        PCWSTR(window_name.as_ptr()),
        WS_POPUP,
        0,
        0,
        10,
        10,
        None,
        Some(HMENU(ptr::null_mut())),
        Some(HINSTANCE(ptr::null_mut())),
        None,
    )
    .map_err(|e| format!("CreateWindowExW: {:?}", e))?;

    Ok(hwnd)
}

unsafe fn pump_messages() {
    let mut msg = MSG::default();
    while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
        let _ = TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
}

/// Espera el resultado de un canal mientras bombea mensajes de ventana.
/// WebView2 despacha sus callbacks por el message loop del thread que creo
/// el entorno, asi que sin este pump nunca se reciben los resultados.
fn pump_wait<T>(rx: &mpsc::Receiver<T>, timeout: Duration) -> StdResult<T, String> {
    let deadline = Instant::now() + timeout;
    loop {
        unsafe { pump_messages() };

        match rx.try_recv() {
            Ok(v) => return Ok(v),
            Err(mpsc::TryRecvError::Disconnected) => {
                return Err("Canal WebView2 cerrado inesperadamente".to_string());
            }
            Err(mpsc::TryRecvError::Empty) => {}
        }

        if Instant::now() >= deadline {
            return Err(format!("Timeout esperando a WebView2 ({}s)", timeout.as_secs()));
        }
        std::thread::sleep(Duration::from_millis(2));
    }
}

unsafe fn create_controller(
    hwnd: HWND,
) -> StdResult<(ICoreWebView2Controller, ICoreWebView2Environment), String> {
    let (env_tx, env_rx) = mpsc::channel();
    let env_handler = CreateCoreWebView2EnvironmentCompletedHandler::create(Box::new(
        move |error_code, env_opt| {
            let result = error_code
                .and_then(|_| env_opt.ok_or_else(|| windows::core::Error::from(E_POINTER)));
            let _ = env_tx.send(result);
            Ok(())
        },
    ));

    webview2_com::Microsoft::Web::WebView2::Win32::CreateCoreWebView2Environment(&env_handler)
        .map_err(|e| format!("CreateCoreWebView2Environment: {:?}", e))?;

    let env = pump_wait(&env_rx, Duration::from_secs(30))?
        .map_err(|e| format!("Environment error: {:?}", e))?;

    let (ctrl_tx, ctrl_rx) = mpsc::channel();
    let ctrl_handler = CreateCoreWebView2ControllerCompletedHandler::create(Box::new(
        move |error_code, ctrl_opt| {
            let result = error_code
                .and_then(|_| ctrl_opt.ok_or_else(|| windows::core::Error::from(E_POINTER)));
            let _ = ctrl_tx.send(result);
            Ok(())
        },
    ));

    env.CreateCoreWebView2Controller(hwnd, &ctrl_handler)
        .map_err(|e| format!("CreateCoreWebView2Controller call: {:?}", e))?;

    let ctrl = pump_wait(&ctrl_rx, Duration::from_secs(30))?
        .map_err(|e| format!("Controller error: {:?}", e))?;

    Ok((ctrl, env))
}

unsafe fn navigate_and_wait(
    controller: &ICoreWebView2Controller,
    html: &str,
    timeout: Duration,
) -> StdResult<(), String> {
    let webview = controller.CoreWebView2().map_err(|e| e.to_string())?;

    // Escribir el HTML a un archivo temporal y navegar por file:// evita el
    // limite de tamanio de NavigateToString (E_INVALIDARG con HTML grande,
    // como el batch de muchas facturas).
    let temp_path = std::env::temp_dir().join(format!("gal_pdf_{}.html", std::process::id()));
    std::fs::write(&temp_path, html)
        .map_err(|e| format!("No se pudo escribir HTML temporal: {}", e))?;
    let url = format!("file:///{}", temp_path.to_string_lossy().replace('\\', "/"));
    let url_hstring: HSTRING = url.into();

    let (nav_tx, nav_rx) = mpsc::channel::<bool>();
    let nav_handler = NavigationCompletedEventHandler::create(Box::new(
        move |_webview: Option<ICoreWebView2>,
              args: Option<ICoreWebView2NavigationCompletedEventArgs>|
              -> windows::core::Result<()> {
            let mut ok = BOOL(0);
            let success = args
                .map(|a| a.IsSuccess(&mut ok).is_ok() && ok.as_bool())
                .unwrap_or(false);
            let _ = nav_tx.send(success);
            Ok(())
        },
    ));

    let mut token: i64 = 0;
    webview
        .add_NavigationCompleted(&nav_handler, &mut token)
        .map_err(|e| format!("add_NavigationCompleted: {}", e))?;
    webview
        .Navigate(PCWSTR(url_hstring.as_ptr()))
        .map_err(|e| format!("Navigate: {}", e))?;

    let result = match pump_wait(&nav_rx, timeout)? {
        true => Ok(()),
        false => Err("La pagina no cargo correctamente en WebView2".to_string()),
    };

    let _ = webview.remove_NavigationCompleted(token);
    result
}

fn build_print_settings(
    env: &ICoreWebView2Environment,
    margin_in: Option<f64>,
) -> StdResult<ICoreWebView2PrintSettings, String> {
    let env6: ICoreWebView2Environment6 = env
        .cast()
        .map_err(|e| format!("Environment6 cast: {}", e))?;
    let settings = unsafe { env6.CreatePrintSettings().map_err(|e| e.to_string())? };
    let m = margin_in.unwrap_or(0.0);
    unsafe {
        settings
            .SetShouldPrintBackgrounds(true)
            .map_err(|e| e.to_string())?;
        settings
            .SetShouldPrintHeaderAndFooter(false)
            .map_err(|e| e.to_string())?;
        settings.SetMarginTop(m).map_err(|e| e.to_string())?;
        settings.SetMarginBottom(m).map_err(|e| e.to_string())?;
        settings.SetMarginLeft(m).map_err(|e| e.to_string())?;
        settings.SetMarginRight(m).map_err(|e| e.to_string())?;
    }

    let settings2: ICoreWebView2PrintSettings2 = settings
        .cast()
        .map_err(|e| format!("PrintSettings2 cast: {}", e))?;
    // A4 en pulgadas (210mm x 297mm) para coincidir con el output de Chrome
    unsafe {
        settings2.SetPageWidth(8.268).map_err(|e| e.to_string())?;
        settings2.SetPageHeight(11.693).map_err(|e| e.to_string())?;
    }

    Ok(settings)
}

unsafe fn build_worker_state() -> StdResult<WorkerState, String> {
    let hwnd = create_message_window()?;
    let (controller, env) = match create_controller(hwnd) {
        Ok(pair) => pair,
        Err(e) => {
            let _ = DestroyWindow(hwnd);
            return Err(e);
        }
    };
    Ok(WorkerState {
        hwnd,
        controller,
        env,
    })
}

/// Navega a una pagina vacia y espera la navegacion, para dejar listo
/// el proceso/browser de WebView2 antes del primer uso real.
unsafe fn warm_one(state: &WorkerState) -> StdResult<(), String> {
    let started = Instant::now();
    let result = navigate_and_wait(
        &state.controller,
        "<html><body></body></html>",
        Duration::from_secs(30),
    );
    eprintln!("[pdf] warm: {:.0}ms", started.elapsed().as_millis());
    result
}

unsafe fn render_one(
    state: &WorkerState,
    html: String,
    output_path: String,
    opts: Webview2PdfOptions,
) -> StdResult<(), String> {
    let t0 = Instant::now();
    navigate_and_wait(&state.controller, &html, opts.timeout)
        .map_err(|e| format!("navegacion: {}", e))?;
    eprintln!("[pdf] navegar: {:.0}ms", t0.elapsed().as_millis());

    let settings = build_print_settings(&state.env, opts.margin_in)
        .map_err(|e| format!("print settings: {}", e))?;

    let t1 = Instant::now();
    let (tx, rx) = mpsc::channel::<StdResult<(), String>>();

    let handler = PrintToPdfCompletedHandler::create(Box::new(
        move |_hr_result: windows::core::Result<()>, is_success: bool| -> windows::core::Result<()> {
            let result = if is_success {
                Ok(())
            } else {
                Err("WebView2 PrintToPdf no fue exitoso".to_string())
            };
            let _ = tx.send(result);
            Ok(())
        },
    ));

    let path_hstring: HSTRING = output_path.into();
    let path_pcwstr = PCWSTR(path_hstring.as_ptr());

    let webview7: ICoreWebView2_7 = state
        .controller
        .CoreWebView2()
        .map_err(|e| e.to_string())?
        .cast()
        .map_err(|e| e.to_string())?;
    webview7
        .PrintToPdf(path_pcwstr, Some(&settings), &handler)
        .map_err(|e| format!("PrintToPdf call: {}", e))?;

    let recv = pump_wait(&rx, opts.timeout);
    eprintln!(
        "[pdf] imprimir: {:.0}ms (total {:.0}ms)",
        t1.elapsed().as_millis(),
        t0.elapsed().as_millis()
    );

    match recv {
        Ok(Ok(())) => Ok(()),
        Ok(Err(e)) => Err(e),
        Err(_) => Err(format!("PrintToPdf timeout ({}s)", opts.timeout.as_secs())),
    }
}

fn fail_all(rx: mpsc::Receiver<PdfRequest>, msg: String) {
    while let Ok(req) = rx.recv() {
        let result_tx = match req {
            PdfRequest::Render { result_tx, .. } | PdfRequest::Warm { result_tx } => result_tx,
        };
        let _ = result_tx.send(Err(msg.clone()));
    }
}

fn worker_main(rx: mpsc::Receiver<PdfRequest>) {
    unsafe {
        if let Err(e) = CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok() {
            eprintln!("[pdf] CoInitializeEx: {:?}", e);
            fail_all(rx, format!("CoInitializeEx: {:?}", e));
            return;
        }
    }

    let state = match unsafe { build_worker_state() } {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[pdf] init error: {}", e);
            unsafe { CoUninitialize() };
            fail_all(rx, e);
            return;
        }
    };
    eprintln!("[pdf] worker WebView2 listo");

    loop {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(PdfRequest::Render {
                html,
                output_path,
                opts,
                result_tx,
            }) => {
                let result = unsafe { render_one(&state, html, output_path, opts) };
                let _ = result_tx.send(result);
            }
            Ok(PdfRequest::Warm { result_tx }) => {
                let result = unsafe { warm_one(&state) };
                let _ = result_tx.send(result);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                unsafe { pump_messages() };
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    unsafe {
        let _ = state.controller.Close();
        let _ = DestroyWindow(state.hwnd);
        CoUninitialize();
    }
}

fn worker_sender() -> StdResult<&'static mpsc::Sender<PdfRequest>, String> {
    Ok(WORKER.get_or_init(|| {
        let (tx, rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("pdf-webview2".to_string())
            .spawn(move || worker_main(rx))
            .expect("no se pudo iniciar el worker de WebView2");
        tx
    }))
}

pub fn warm() -> StdResult<(), String> {
    let sender = worker_sender()?;
    let (result_tx, result_rx) = mpsc::channel();
    sender
        .send(PdfRequest::Warm { result_tx })
        .map_err(|_| "Worker de WebView2 no disponible".to_string())?;
    match result_rx.recv_timeout(Duration::from_secs(30)) {
        Ok(inner) => inner,
        Err(_) => Err("WebView2 warm timeout (30s)".to_string()),
    }
}

pub fn generate_pdf_webview2_opts(
    html: String,
    output_path: String,
    opts: Webview2PdfOptions,
) -> StdResult<(), String> {
    let sender = worker_sender()?;
    let (result_tx, result_rx) = mpsc::channel();
    sender
        .send(PdfRequest::Render {
            html,
            output_path,
            opts,
            result_tx,
        })
        .map_err(|_| "Worker de WebView2 no disponible".to_string())?;
    match result_rx.recv_timeout(opts.timeout) {
        Ok(inner) => inner,
        Err(_) => Err(format!("WebView2 timeout ({}s)", opts.timeout.as_secs())),
    }
}

pub fn generate_pdf_webview2_sync(html: String, output_path: String) -> StdResult<(), String> {
    generate_pdf_webview2_opts(html, output_path, Webview2PdfOptions::default())
}
