use crate::error::Result;
use crate::mcp::McpServer;
use serde::Serialize;
use serde_json::{Map, Value};
use std::fs;
use std::fs::OpenOptions;
#[cfg(unix)]
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use std::process::{Command as ProcessCommand, Stdio};
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;
use tokio::process::Command as TokioCommand;
use tokio::time::{timeout, Duration};

#[tauri::command]
pub fn mcp_request(app_handle: AppHandle, request: Value) -> Result<Value> {
    tauri::async_runtime::block_on(McpServer::new(app_handle).handle_request(request))
}

#[derive(Serialize)]
pub struct McpStatus {
    pub project_root: String,
    pub config_path: String,
    pub config_exists: bool,
    pub launcher_path: String,
    pub launcher_exists: bool,
    pub reader_configured: bool,
    pub configured_command: Option<String>,
    pub configured_args: Vec<String>,
    pub tool_names: Vec<String>,
    pub tools_available: usize,
    pub resources_available: usize,
    pub connected_clients: Option<usize>,
    pub transport: String,
    pub server_version: Option<String>,
    pub test_ok: bool,
    pub test_error: Option<String>,
    pub checked_at: i64,
}

struct McpPaths {
    project_root: PathBuf,
    config_path: PathBuf,
    launcher_path: PathBuf,
    tools_path: PathBuf,
    server_package_path: PathBuf,
}

#[tauri::command]
pub async fn get_mcp_status(check_connection: Option<bool>) -> Result<McpStatus> {
    let paths = resolve_mcp_paths();
    let project_root = paths.project_root;
    let config_path = paths.config_path;
    let launcher_path = paths.launcher_path;
    let tools_path = paths.tools_path;
    let server_package_path = paths.server_package_path;

    let config_exists = config_path.exists();
    let launcher_exists = launcher_path.exists();

    let (reader_configured, configured_command, configured_args) =
        read_reader_server_config(&config_path);
    let tool_names = read_tool_names(&tools_path);
    let resource_uris = read_resource_uris(&tools_path);
    let tools_available = tool_names.len();
    let resources_available = resource_uris.len();
    let server_version = read_server_version(&server_package_path);
    let connected_clients = count_connected_clients(&project_root);

    let mut test_ok = false;
    let mut test_error = None;

    if check_connection.unwrap_or(false) {
        if !launcher_exists {
            test_error = Some(format!(
                "Launcher not found: {}",
                launcher_path.to_string_lossy()
            ));
        } else {
            match probe_reader_server(&launcher_path, &project_root).await {
                Ok(ok) => {
                    test_ok = ok;
                }
                Err(err) => {
                    test_error = Some(err);
                }
            }
        }
    }

    Ok(McpStatus {
        project_root: project_root.to_string_lossy().to_string(),
        config_path: config_path.to_string_lossy().to_string(),
        config_exists,
        launcher_path: launcher_path.to_string_lossy().to_string(),
        launcher_exists,
        reader_configured,
        configured_command,
        configured_args,
        tool_names,
        tools_available,
        resources_available,
        connected_clients,
        transport: "stdio".to_string(),
        server_version,
        test_ok,
        test_error,
        checked_at: chrono::Utc::now().timestamp_millis(),
    })
}

#[tauri::command]
pub async fn set_mcp_reader_enabled(enabled: bool) -> Result<McpStatus> {
    let paths = resolve_mcp_paths();
    let config_path = paths.config_path;
    let launcher_path = paths.launcher_path;
    upsert_reader_server_entry(&config_path, &launcher_path, enabled)?;
    get_mcp_status(Some(false)).await
}

#[derive(Serialize)]
pub struct ShellCommandInstallResult {
    pub installed_path: String,
    pub install_dir: String,
    pub launcher_path: String,
    pub path_updated: bool,
    pub profile_file: Option<String>,
    pub message: String,
}

#[tauri::command]
pub fn install_cli_shell_command() -> Result<ShellCommandInstallResult> {
    install_cli_shell_command_inner()
}

fn install_cli_shell_command_inner() -> Result<ShellCommandInstallResult> {
    let paths = resolve_mcp_paths();
    let launcher_path = paths.launcher_path;
    if !launcher_path.exists() {
        return Err(crate::ReaderError::NotFound(format!(
            "CLI launcher not found: {}",
            launcher_path.to_string_lossy()
        )));
    }

    let home = dirs::home_dir().ok_or_else(|| {
        crate::ReaderError::Internal("Failed to resolve home directory".to_string())
    })?;

    let preferred_dir = PathBuf::from("/usr/local/bin");
    let fallback_dir = home.join(".local").join("bin");

    let install_dir = if is_writable_dir(&preferred_dir) {
        preferred_dir
    } else {
        fs::create_dir_all(&fallback_dir)?;
        fallback_dir
    };

    let installed_path = install_dir.join("reader-cli");
    if installed_path.exists() || installed_path.symlink_metadata().is_ok() {
        fs::remove_file(&installed_path)?;
    }

    #[cfg(unix)]
    symlink(&launcher_path, &installed_path).map_err(|error| {
        crate::ReaderError::Internal(format!(
            "Failed to create symlink {} -> {}: {}",
            installed_path.to_string_lossy(),
            launcher_path.to_string_lossy(),
            error
        ))
    })?;

    #[cfg(not(unix))]
    {
        return Err(crate::ReaderError::Internal(
            "Install shell command is currently supported on Unix-like systems only".to_string(),
        ));
    }

    let (path_updated, profile_file) = ensure_dir_in_path_for_zsh(&install_dir)?;
    let message = if path_updated {
        format!(
            "Installed at {} and updated {}",
            installed_path.to_string_lossy(),
            profile_file
                .as_ref()
                .map(|v| v.as_str())
                .unwrap_or("shell profile")
        )
    } else {
        format!("Installed at {}", installed_path.to_string_lossy())
    };

    Ok(ShellCommandInstallResult {
        installed_path: installed_path.to_string_lossy().to_string(),
        install_dir: install_dir.to_string_lossy().to_string(),
        launcher_path: launcher_path.to_string_lossy().to_string(),
        path_updated,
        profile_file,
        message,
    })
}

fn ensure_dir_in_path_for_zsh(dir: &Path) -> Result<(bool, Option<String>)> {
    let path_env = std::env::var("PATH").unwrap_or_default();
    let dir_text = dir.to_string_lossy().to_string();
    if path_env.split(':').any(|entry| entry == dir_text) {
        return Ok((false, None));
    }

    let home = dirs::home_dir().ok_or_else(|| {
        crate::ReaderError::Internal("Failed to resolve home directory".to_string())
    })?;
    let zshrc = home.join(".zshrc");
    let export_line = format!("\n# Reader CLI\nexport PATH=\"{}:$PATH\"\n", dir_text);

    let current = if zshrc.exists() {
        fs::read_to_string(&zshrc)?
    } else {
        String::new()
    };
    if current.contains(&format!("export PATH=\"{}:$PATH\"", dir_text))
        || current.contains(&format!("export PATH='{}:$PATH'", dir_text))
    {
        return Ok((false, Some(zshrc.to_string_lossy().to_string())));
    }

    let mut next = current;
    if !next.ends_with('\n') && !next.is_empty() {
        next.push('\n');
    }
    next.push_str(&export_line);
    fs::write(&zshrc, next)?;
    Ok((true, Some(zshrc.to_string_lossy().to_string())))
}

fn resolve_mcp_paths() -> McpPaths {
    let project_root = detect_project_root();
    let config_path = detect_config_path(&project_root);
    let launcher_path = project_root
        .join("mcp-server")
        .join("bin")
        .join("reader-mcp-server.sh");
    let tools_path = project_root
        .join("mcp-server")
        .join("src")
        .join("tools")
        .join("markdown-tools.mjs");
    let server_package_path = project_root.join("mcp-server").join("package.json");

    McpPaths {
        project_root,
        config_path,
        launcher_path,
        tools_path,
        server_package_path,
    }
}

fn detect_project_root() -> PathBuf {
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if cwd.join("mcp-server").exists() {
        return cwd;
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(parent) = manifest_dir.parent() {
        if parent.join("mcp-server").exists() {
            return parent.to_path_buf();
        }
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            for candidate in exe_dir.ancestors() {
                if candidate.join("mcp-server").exists() {
                    return candidate.to_path_buf();
                }
            }
        }
    }

    cwd
}

fn detect_config_path(project_root: &Path) -> PathBuf {
    let project_config = project_root.join(".mcp.json");
    if project_config.exists() || is_writable_dir(project_root) {
        return project_config;
    }

    if let Ok(cwd) = std::env::current_dir() {
        let cwd_config = cwd.join(".mcp.json");
        if cwd_config.exists() || is_writable_dir(&cwd) {
            return cwd_config;
        }
    }

    if let Some(home) = dirs::home_dir() {
        return home.join(".mcp.json");
    }

    project_config
}

fn is_writable_dir(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }

    let probe_path = dir.join(format!(".reader-write-probe-{}", std::process::id()));
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe_path)
    {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe_path);
            true
        }
        Err(_) => false,
    }
}

fn read_reader_server_config(config_path: &Path) -> (bool, Option<String>, Vec<String>) {
    if !config_path.exists() {
        return (false, None, vec![]);
    }

    let raw = match std::fs::read_to_string(config_path) {
        Ok(content) => content,
        Err(_) => return (false, None, vec![]),
    };

    let parsed: Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return (false, None, vec![]),
    };

    let reader = parsed
        .get("mcpServers")
        .and_then(|servers| servers.get("reader"));

    let command = reader
        .and_then(|node| node.get("command"))
        .and_then(|value| value.as_str())
        .map(|value| value.to_string());

    let args = reader
        .and_then(|node| node.get("args"))
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(|value| value.to_string()))
                .collect::<Vec<String>>()
        })
        .unwrap_or_default();

    (reader.is_some(), command, args)
}

fn read_tool_names(tools_path: &Path) -> Vec<String> {
    let raw = match std::fs::read_to_string(tools_path) {
        Ok(content) => content,
        Err(_) => return vec![],
    };

    let mut names = Vec::new();
    for line in raw.lines() {
        if let Some(start) = line.find("name: 'reader.") {
            let rest = &line[start + "name: '".len()..];
            if let Some(end) = rest.find('\'') {
                let name = rest[..end].trim();
                if !name.is_empty() {
                    names.push(name.to_string());
                }
            }
        }
    }

    names
}

fn read_server_version(package_path: &Path) -> Option<String> {
    if !package_path.exists() {
        return None;
    }
    let raw = std::fs::read_to_string(package_path).ok()?;
    let parsed: Value = serde_json::from_str(&raw).ok()?;
    parsed
        .get("version")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
}

fn read_resource_uris(tools_path: &Path) -> Vec<String> {
    let raw = match std::fs::read_to_string(tools_path) {
        Ok(content) => content,
        Err(_) => return vec![],
    };

    let mut uris = Vec::new();
    for line in raw.lines() {
        if let Some(start) = line.find("uri: 'reader://") {
            let rest = &line[start + "uri: '".len()..];
            if let Some(end) = rest.find('\'') {
                let uri = rest[..end].trim();
                if !uri.is_empty() {
                    uris.push(uri.to_string());
                }
            }
        }
    }
    uris
}

fn count_connected_clients(project_root: &Path) -> Option<usize> {
    let cli_src_path = project_root
        .join("mcp-server")
        .join("src")
        .join("cli.mjs")
        .to_string_lossy()
        .to_string();
    let cli_dist_path = project_root
        .join("mcp-server")
        .join("dist")
        .join("cli.js")
        .to_string_lossy()
        .to_string();
    let launcher_path = project_root
        .join("mcp-server")
        .join("bin")
        .join("reader-mcp-server.sh")
        .to_string_lossy()
        .to_string();

    let output = ProcessCommand::new("ps")
        .args(["-ax", "-o", "command="])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    let count = stdout
        .lines()
        .filter(|line| {
            line.contains(&cli_src_path)
                || line.contains(&cli_dist_path)
                || line.contains(&launcher_path)
        })
        .count();
    Some(count)
}

fn upsert_reader_server_entry(
    config_path: &Path,
    launcher_path: &Path,
    enabled: bool,
) -> Result<()> {
    let root_value = if config_path.exists() {
        let raw = std::fs::read_to_string(config_path)?;
        serde_json::from_str::<Value>(&raw).unwrap_or_else(|_| Value::Object(Map::new()))
    } else {
        Value::Object(Map::new())
    };

    let mut root_obj = match root_value {
        Value::Object(map) => map,
        _ => Map::new(),
    };

    let mut servers_obj = match root_obj.remove("mcpServers") {
        Some(Value::Object(map)) => map,
        _ => Map::new(),
    };

    if enabled {
        let reader_value = servers_obj
            .remove("reader")
            .unwrap_or_else(|| Value::Object(Map::new()));
        let mut reader_obj = match reader_value {
            Value::Object(map) => map,
            _ => Map::new(),
        };

        let has_command = reader_obj
            .get("command")
            .and_then(|value| value.as_str())
            .map(|value| !value.trim().is_empty())
            .unwrap_or(false);

        if !has_command {
            reader_obj.insert(
                "command".to_string(),
                Value::String(launcher_path.to_string_lossy().to_string()),
            );
        }
        servers_obj.insert("reader".to_string(), Value::Object(reader_obj));
    } else {
        servers_obj.remove("reader");
    }

    root_obj.insert("mcpServers".to_string(), Value::Object(servers_obj));
    let output = serde_json::to_string_pretty(&Value::Object(root_obj)).map_err(|error| {
        crate::ReaderError::Internal(format!("Failed to serialize .mcp.json: {error}"))
    })?;

    if let Some(parent) = config_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(config_path, format!("{output}\n"))?;
    Ok(())
}

async fn probe_reader_server(
    launcher_path: &Path,
    project_root: &Path,
) -> std::result::Result<bool, String> {
    let mut child = TokioCommand::new(launcher_path)
        .current_dir(project_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to launch MCP server: {error}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open MCP stdin".to_string())?;

    let initialize = serde_json::json!({
      "jsonrpc": "2.0",
      "id": 0,
      "method": "initialize",
      "params": {
        "protocolVersion": "2025-11-25",
        "capabilities": { "roots": {} },
        "clientInfo": { "name": "reader-settings", "version": "0.1.0" }
      }
    });
    // Send a single raw JSON-RPC message. The reader MCP server currently auto-detects
    // raw-line mode, and multiple concatenated raw JSON objects in one chunk are not safe.
    let payload = format!("{initialize}\n");
    stdin
        .write_all(payload.as_bytes())
        .await
        .map_err(|error| format!("Failed to write MCP request: {error}"))?;
    drop(stdin);

    let output = timeout(Duration::from_secs(6), child.wait_with_output())
        .await
        .map_err(|_| "MCP test timed out after 6s".to_string())?
        .map_err(|error| format!("Failed to read MCP output: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if stdout.trim().is_empty() {
        let detail = if stderr.is_empty() {
            "empty stdout from MCP server".to_string()
        } else {
            format!("empty stdout from MCP server; stderr: {stderr}")
        };
        return Err(detail);
    }

    let mut initialized = false;
    let parsed_messages = parse_mcp_messages(&stdout);

    for parsed in parsed_messages {
        if parsed.get("id").and_then(|id| id.as_i64()) == Some(0)
            && parsed.get("result").is_some()
            && parsed.get("error").is_none()
        {
            initialized = true;
        }
    }

    if !initialized {
        let detail = if stderr.is_empty() {
            "initialize response not received".to_string()
        } else {
            format!("initialize response not received; stderr: {stderr}")
        };
        return Err(detail);
    }

    if !output.status.success() {
        let detail = if stderr.is_empty() {
            format!("process exited with status {}", output.status)
        } else {
            format!(
                "process exited with status {}; stderr: {stderr}",
                output.status
            )
        };
        return Err(detail);
    }

    Ok(true)
}

fn parse_mcp_messages(stdout: &str) -> Vec<Value> {
    let mut messages = Vec::new();

    // Raw JSON line mode.
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            messages.push(value);
        }
    }
    if !messages.is_empty() {
        return messages;
    }

    // Content-Length framed mode.
    let bytes = stdout.as_bytes();
    let mut cursor = 0usize;
    while cursor < bytes.len() {
        while cursor < bytes.len() && (bytes[cursor] == b'\r' || bytes[cursor] == b'\n') {
            cursor += 1;
        }
        if cursor >= bytes.len() {
            break;
        }

        let rest = &bytes[cursor..];
        let sep = rest
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .map(|pos| (pos, 4usize))
            .or_else(|| {
                rest.windows(2)
                    .position(|w| w == b"\n\n")
                    .map(|pos| (pos, 2usize))
            });
        let Some((header_pos, sep_len)) = sep else {
            break;
        };

        let header_end = cursor + header_pos;
        let header_text = match std::str::from_utf8(&bytes[cursor..header_end]) {
            Ok(text) => text,
            Err(_) => break,
        };

        let content_length = header_text.split('\n').find_map(|line| {
            let trimmed = line.trim();
            if trimmed.to_ascii_lowercase().starts_with("content-length:") {
                trimmed
                    .split_once(':')
                    .and_then(|(_, rhs)| rhs.trim().parse::<usize>().ok())
            } else {
                None
            }
        });
        let Some(content_length) = content_length else {
            break;
        };

        let body_start = header_end + sep_len;
        let body_end = body_start.saturating_add(content_length);
        if body_end > bytes.len() {
            break;
        }

        if let Ok(body) = std::str::from_utf8(&bytes[body_start..body_end]) {
            if let Ok(value) = serde_json::from_str::<Value>(body) {
                messages.push(value);
            }
        }

        cursor = body_end;
    }

    messages
}
