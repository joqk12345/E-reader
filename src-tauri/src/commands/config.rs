use crate::config::{load_config, save_config, Config};
use crate::error::Result;

/// Gets the current configuration
///
/// Returns the LM Studio URL and model settings
#[tauri::command]
pub async fn get_config() -> Result<Config> {
    let config = load_config()?;
    Ok(config)
}

/// Saves the configuration
///
/// Updates the LM Studio URL and model settings
#[tauri::command]
pub async fn update_config(config: Config) -> Result<()> {
    save_config(&config)?;
    Ok(())
}
