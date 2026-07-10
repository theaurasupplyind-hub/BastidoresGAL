use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AppConfig {
    pub theme: String,
    pub font_size: u32,
    pub hotkey_save: String,
    pub hotkey_new: String,
    pub selected_template_name: String,
    pub selected_template_file: String,
    pub moldura_template: String,
    #[serde(default)]
    pub selected_printer: Option<String>,
    #[serde(default)]
    pub print_agent_enabled: bool,
    #[serde(default)]
    pub station_id: Option<u32>,
    #[serde(default)]
    pub station_api_key: Option<String>,
    #[serde(default)]
    pub station_name: Option<String>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            theme: "flatly".into(),
            font_size: 10,
            hotkey_save: "F12".into(),
            hotkey_new: "F4".into(),
            selected_template_name: "Original".into(),
            selected_template_file: "invoice_template.html".into(),
            moldura_template: "clasico".into(),
            selected_printer: None,
            print_agent_enabled: false,
            station_id: None,
            station_api_key: None,
            station_name: None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionData {
    pub username: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserState {
    pub user_id: u64,
    pub user_name: String,
}

pub struct AppState {
    pub config: Mutex<AppConfig>,
    pub user: Mutex<Option<UserState>>,
    pub data_dir: PathBuf,
}

impl AppState {
    pub fn new() -> Self {
        let data_dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("FacBal");

        fs::create_dir_all(&data_dir).ok();
        fs::create_dir_all(data_dir.join("generated_invoices")).ok();

        let config = Self::load_config_file(&data_dir);
        let last_user = Self::load_session_file(&data_dir);

        Self {
            config: Mutex::new(config),
            user: Mutex::new(last_user),
            data_dir,
        }
    }

    fn config_path(data_dir: &PathBuf) -> PathBuf {
        data_dir.join("config.json")
    }

    fn session_path(data_dir: &PathBuf) -> PathBuf {
        data_dir.join("session.json")
    }

    fn load_config_file(data_dir: &PathBuf) -> AppConfig {
        let path = Self::config_path(data_dir);
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(config) = serde_json::from_str(&content) {
                    return config;
                }
            }
        }
        AppConfig::default()
    }

    fn load_session_file(data_dir: &PathBuf) -> Option<UserState> {
        let path = Self::session_path(data_dir);
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(session) = serde_json::from_str::<SessionData>(&content) {
                    let hash = blake3_hash(&session.username);
                    return Some(UserState {
                        user_id: hash,
                        user_name: session.username,
                    });
                }
            }
        }
        None
    }

    pub fn save_config(&self, config: &AppConfig) -> Result<(), String> {
        let path = Self::config_path(&self.data_dir);
        let content = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
        fs::write(&path, content).map_err(|e| e.to_string())?;
        if let Ok(mut c) = self.config.lock() {
            *c = config.clone();
        }
        Ok(())
    }

    pub fn save_session(&self, username: &str) -> Result<(), String> {
        let path = Self::session_path(&self.data_dir);
        let session = SessionData {
            username: username.to_string(),
        };
        let content = serde_json::to_string_pretty(&session).map_err(|e| e.to_string())?;
        fs::write(&path, content).map_err(|e| e.to_string())?;

        let hash = blake3_hash(username);
        if let Ok(mut u) = self.user.lock() {
            *u = Some(UserState {
                user_id: hash,
                user_name: username.to_string(),
            });
        }
        Ok(())
    }
}

fn blake3_hash(input: &str) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    input.to_lowercase().hash(&mut hasher);
    hasher.finish() % 10u64.pow(8)
}
