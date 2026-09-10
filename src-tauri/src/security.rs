use crate::{config, database, ReaderError, Result};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn allow_file(scope: &tauri::scope::fs::Scope, path: &Path) -> Result<()> {
    scope
        .allow_file(path)
        .map_err(|error| ReaderError::Internal(format!("Failed to scope asset file: {error}")))
}

fn allow_directory(scope: &tauri::scope::fs::Scope, path: &Path) -> Result<()> {
    scope
        .allow_directory(path, true)
        .map_err(|error| ReaderError::Internal(format!("Failed to scope asset directory: {error}")))
}

fn model_asset_directory(configured_path: &str) -> Option<PathBuf> {
    let path = PathBuf::from(configured_path.trim().trim_start_matches("file://"));
    if path.is_dir() {
        return Some(path);
    }
    if path.is_file() {
        return path
            .parent()
            .filter(|parent| parent.is_dir())
            .map(Path::to_path_buf);
    }
    None
}

pub fn restore_asset_protocol_scope(app: &AppHandle) -> Result<()> {
    let scope = app.asset_protocol_scope();
    let connection = database::get_connection(app)?;
    for document in database::list_documents(&connection)? {
        if document.file_type == "pdf" {
            let path = Path::new(&document.file_path);
            if path.is_file() {
                allow_file(&scope, path)?;
            }
        }
    }

    if let Some(path) = config::load_config()?
        .embedding_local_model_path
        .as_deref()
        .and_then(model_asset_directory)
    {
        allow_directory(&scope, &path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::Value;
    use std::collections::HashMap;

    use super::model_asset_directory;

    fn security_config() -> Value {
        let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        config["app"]["security"].clone()
    }

    fn directives(csp: &str) -> HashMap<&str, Vec<&str>> {
        csp.split(';')
            .filter_map(|directive| {
                let mut parts = directive.split_whitespace();
                let name = parts.next()?;
                Some((name, parts.collect()))
            })
            .collect()
    }

    #[test]
    fn resolves_only_existing_or_explicit_config_model_directories() {
        let temp =
            std::env::temp_dir().join(format!("reader-security-test-{}", uuid::Uuid::new_v4()));
        let model = temp.join("model");
        std::fs::create_dir_all(&model).unwrap();
        let config_file = model.join("config.json");
        std::fs::write(&config_file, "{}").unwrap();

        assert_eq!(
            model_asset_directory(model.to_str().unwrap()),
            Some(model.clone())
        );
        assert_eq!(
            model_asset_directory(config_file.to_str().unwrap()),
            Some(model)
        );
        assert_eq!(model_asset_directory("/path/that/does/not/exist"), None);
        assert_eq!(model_asset_directory(""), None);
        assert_eq!(model_asset_directory("file://"), None);
        std::fs::remove_dir_all(temp).unwrap();
    }

    #[test]
    fn production_csp_blocks_publication_active_content_and_remote_subresources() {
        let security = security_config();
        let csp = security["csp"]
            .as_str()
            .expect("production CSP must be enabled");
        let rules = directives(csp);

        assert_eq!(rules.get("object-src"), Some(&vec!["'none'"]));
        assert_eq!(rules.get("form-action"), Some(&vec!["'none'"]));
        assert!(!rules["script-src"].iter().any(|source| {
            matches!(
                *source,
                "'unsafe-inline'" | "'unsafe-eval'" | "blob:" | "data:"
            ) || source.starts_with("http")
        }));
        for directive in ["img-src", "font-src", "media-src", "frame-src"] {
            assert!(
                !rules[directive]
                    .iter()
                    .any(|source| source.starts_with("http") && !source.contains("asset.localhost")),
                "{directive} must not allow remote publication subresources"
            );
        }
        assert!(
            !rules["connect-src"].contains(&"https:"),
            "connect-src must list audited hosts instead of all HTTPS origins"
        );
    }

    #[test]
    fn asset_protocol_has_no_global_filesystem_wildcard() {
        let security = security_config();
        let scope = security["assetProtocol"]["scope"]
            .as_array()
            .expect("asset protocol scope must be an array");
        assert!(!scope.is_empty());
        assert!(scope.iter().all(|entry| {
            entry
                .as_str()
                .is_some_and(|pattern| pattern.starts_with("$APP") && pattern != "**")
        }));
    }
}
