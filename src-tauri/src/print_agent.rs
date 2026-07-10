use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::AppHandle;
use tauri::Emitter;
use tauri::Manager;

use crate::config::AppState;

const API_URL: &str = "https://api-bastidores.onrender.com";
const POLL_INTERVAL_SECS: u64 = 10;
const HEARTBEAT_INTERVAL_SECS: u64 = 300;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrintAgentStatus {
    pub running: bool,
    pub last_poll: Option<String>,
    pub jobs_processed: u32,
    pub last_error: Option<String>,
}

pub struct PrintAgentHandle {
    pub running: Arc<Mutex<bool>>,
    pub status: Arc<Mutex<PrintAgentStatus>>,
    pub stop_sender: Arc<Mutex<Option<tokio::sync::oneshot::Sender<()>>>>,
}

impl PrintAgentHandle {
    pub fn new() -> Self {
        Self {
            running: Arc::new(Mutex::new(false)),
            status: Arc::new(Mutex::new(PrintAgentStatus {
                running: false,
                last_poll: None,
                jobs_processed: 0,
                last_error: None,
            })),
            stop_sender: Arc::new(Mutex::new(None)),
        }
    }

    pub fn status_arc(&self) -> Arc<Mutex<PrintAgentStatus>> {
        self.status.clone()
    }
}

#[derive(Debug, Deserialize)]
struct PendingJob {
    id: u32,
    file_name: Option<String>,
    created_by: Option<String>,
}

pub fn start_agent(app: AppHandle, handle: tauri::State<PrintAgentHandle>) {
    let mut running = handle.running.lock().unwrap();
    if *running {
        return;
    }

    let (stop_tx, mut stop_rx) = tokio::sync::oneshot::channel();
    *handle.stop_sender.lock().unwrap() = Some(stop_tx);
    *running = true;

    {
        let mut status = handle.status.lock().unwrap();
        status.running = true;
        status.last_error = None;
    }

    // Cleanup stale print queue files
    if let Ok(data_dir) = app.path().app_data_dir() {
        let print_queue_dir = data_dir.join("print_queue");
        if print_queue_dir.exists() {
            let _ = std::fs::remove_dir_all(&print_queue_dir);
        }
    }

    let agent_app = app.clone();
    let agent_status = handle.status_arc();

    tauri::async_runtime::spawn(async move {
        let client = reqwest::Client::new();
        let mut poll_interval = tokio::time::interval(Duration::from_secs(POLL_INTERVAL_SECS));
        let mut heartbeat_interval = tokio::time::interval(Duration::from_secs(HEARTBEAT_INTERVAL_SECS));

        loop {
            tokio::select! {
                _ = &mut stop_rx => {
                    break;
                }
                _ = poll_interval.tick() => {
                    if let Err(e) = poll_and_print(&client, &agent_app, &agent_status).await {
                        log::error!("Print agent poll error: {}", e);
                    }
                }
                _ = heartbeat_interval.tick() => {
                    if let Err(e) = send_heartbeat(&client, &agent_app).await {
                        log::error!("Print agent heartbeat error: {}", e);
                    }
                }
            }
        }

        log::info!("Print agent stopped");
    });
}

pub fn stop_agent(handle: tauri::State<PrintAgentHandle>) {
    let mut running = handle.running.lock().unwrap();
    if !*running {
        return;
    }

    if let Some(stop_tx) = handle.stop_sender.lock().unwrap().take() {
        let _ = stop_tx.send(());
    }
    *running = false;

    let mut status = handle.status.lock().unwrap();
    status.running = false;
}

pub fn get_status(handle: tauri::State<PrintAgentHandle>) -> PrintAgentStatus {
    handle.status.lock().unwrap().clone()
}

async fn poll_and_print(client: &reqwest::Client, app: &AppHandle, agent_status: &Arc<Mutex<PrintAgentStatus>>) -> Result<(), String> {
    let config = {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().map_err(|e| e.to_string())?;
        cfg.clone()
    };

    let api_key = match config.station_api_key.as_deref() {
        Some(k) => k,
        None => return Ok(()),
    };
    let station_id = match config.station_id {
        Some(id) => id,
        None => return Ok(()),
    };

    // Poll for pending jobs
    let pending_url = format!("{}/print-jobs/pending?station_id={}", API_URL, station_id);
    let resp = client
        .get(&pending_url)
        .header("X-Api-Key", api_key)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Poll request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Poll returned status: {}", resp.status()));
    }

    let jobs: Vec<PendingJob> = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse pending jobs: {}", e))?;

    if jobs.is_empty() {
        {
            let mut status = agent_status.lock().unwrap();
            status.last_poll = Some(chrono::Local::now().to_rfc3339());
        }
        return Ok(());
    }

    log::info!("Print agent: found {} pending jobs", jobs.len());

    for job in jobs {
        process_job(client, app, api_key, agent_status, job).await?;
    }

    Ok(())
}

async fn process_job(
    client: &reqwest::Client,
    app: &AppHandle,
    api_key: &str,
    agent_status: &Arc<Mutex<PrintAgentStatus>>,
    job: PendingJob,
) -> Result<(), String> {
    log::info!("Processing print job #{}", job.id);

    // 1. Claim the job
    let claim_url = format!("{}/print-jobs/{}/claim", API_URL, job.id);
    let claim_resp = client
        .patch(&claim_url)
        .header("X-Api-Key", api_key)
        .timeout(Duration::from_secs(5))
        .send()
        .await;

    match claim_resp {
        Ok(r) if !r.status().is_success() => {
            let msg = format!("Failed to claim job #{}: {}", job.id, r.status());
            report_failure(client, api_key, job.id, &msg).await;
            return Err(msg);
        }
        Err(e) => {
            return Err(format!("Claim request failed for job #{}: {}", job.id, e));
        }
        _ => {}
    }

    // 2. Download the PDF
    let file_url = format!("{}/print-jobs/{}/file", API_URL, job.id);
    let file_resp = client
        .get(&file_url)
        .header("X-Api-Key", api_key)
        .timeout(Duration::from_secs(30))
        .send()
        .await;

    let pdf_bytes = match file_resp {
        Ok(r) if r.status().is_success() => {
            r.bytes()
                .await
                .map_err(|e| format!("Failed to download PDF: {}", e))?
                .to_vec()
        }
        Ok(r) => {
            let msg = format!("Download returned status {} for job #{}", r.status(), job.id);
            report_failure(client, api_key, job.id, &msg).await;
            return Err(msg);
        }
        Err(e) => {
            let msg = format!("Download request failed for job #{}: {}", job.id, e);
            report_failure(client, api_key, job.id, &msg).await;
            return Err(msg);
        }
    };

    // 3. Save PDF to temp file
    let print_queue_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("print_queue");

    std::fs::create_dir_all(&print_queue_dir).map_err(|e| e.to_string())?;
    let pdf_path = print_queue_dir.join(format!("job_{}.pdf", job.id));
    std::fs::write(&pdf_path, &pdf_bytes).map_err(|e| format!("Failed to write PDF: {}", e))?;

    // 4. Normalize path (remove \\?\ prefix) and print
    let pdf_path = dunce::simplified(&pdf_path);
    let print_result = print_pdf_file(app, &pdf_path.to_string_lossy());

    match print_result {
        Ok(_) => {
            log::info!("Print job #{} completed successfully", job.id);
            let complete_url = format!("{}/print-jobs/{}/complete", API_URL, job.id);
            let _ = client
                .patch(&complete_url)
                .header("X-Api-Key", api_key)
                .timeout(Duration::from_secs(5))
                .send()
                .await;

            let _ = app.emit(
                "print-job-completed",
                serde_json::json!({
                    "job_id": job.id,
                    "file_name": job.file_name,
                    "created_by": job.created_by,
                }),
            );

            {
                let mut status = agent_status.lock().unwrap();
                status.jobs_processed += 1;
                status.last_poll = Some(chrono::Local::now().to_rfc3339());
            }
        }
        Err(e) => {
            log::error!("Print job #{} failed: {}", job.id, e);
            report_failure(client, api_key, job.id, &e).await;

            let _ = app.emit(
                "print-job-failed",
                serde_json::json!({
                    "job_id": job.id,
                    "error": e,
                    "file_name": job.file_name,
                }),
            );

            {
                let mut status = agent_status.lock().unwrap();
                status.last_error = Some(e);
                status.last_poll = Some(chrono::Local::now().to_rfc3339());
            }
        }
    }

    Ok(())
}

fn print_pdf_file(app: &AppHandle, path: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let printer_name = {
            let state = app.state::<AppState>();
            let config = state.config.lock().map_err(|e| e.to_string())?;
            config.selected_printer.clone()
        };

        let resource_dir = app
            .path()
            .resource_dir()
            .map_err(|e| format!("Resource dir error: {}", e))?;
        let sumatra = resource_dir.join("SumatraPDF.exe");

        if sumatra.exists() {
            let mut args: Vec<&str> = vec![];
            let printer_str;
            if let Some(ref printer) = printer_name {
                printer_str = printer.clone();
                args.push("-print-to");
                args.push(&printer_str);
            } else {
                args.push("-print-to-default");
            }
            args.push(&path);

            let result = std::process::Command::new(&sumatra)
                .args(&args)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn();
            if result.is_ok() {
                return Ok(());
            }
        }

        // Fallback
        let fallback = std::process::Command::new("powershell")
            .args(&[
                "-NoProfile",
                "-WindowStyle", "Hidden",
                "-Command",
                &format!("Start-Process -FilePath '{}' -Verb Print", &path),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();

        match fallback {
            Ok(_) => Ok(()),
            Err(e) => Err(format!("Print failed: {}", e)),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::process::Command::new("lp")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Print failed: {}", e))?;
        Ok(())
    }
}

async fn report_failure(client: &reqwest::Client, api_key: &str, job_id: u32, error: &str) {
    let fail_url = format!("{}/print-jobs/{}/fail", API_URL, job_id);
    let _ = client
        .patch(&fail_url)
        .header("X-Api-Key", api_key)
        .query(&[("error_message", error)])
        .timeout(Duration::from_secs(5))
        .send()
        .await;
}

async fn send_heartbeat(client: &reqwest::Client, app: &AppHandle) -> Result<(), String> {
    let config = {
        let state = app.state::<AppState>();
        let cfg = state.config.lock().map_err(|e| e.to_string())?;
        cfg.clone()
    };

    let api_key = match config.station_api_key.as_deref() {
        Some(k) => k,
        None => return Ok(()),
    };

    let heartbeat_url = format!("{}/stations/heartbeat", API_URL);
    let _ = client
        .post(&heartbeat_url)
        .header("X-Api-Key", api_key)
        .timeout(Duration::from_secs(5))
        .send()
        .await;

    Ok(())
}
