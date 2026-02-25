use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct UpdateTarget {
    pub os: String,
    pub arch: String,
}

#[tauri::command]
pub fn get_update_target() -> UpdateTarget {
    UpdateTarget {
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}
