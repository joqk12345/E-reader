use crate::error::Result;
use crate::mcp::McpServer;
use serde_json::Value;
use std::sync::Mutex;
use tauri::{AppHandle, State};

#[derive(Default)]
pub struct McpState(Mutex<Option<McpServer>>);

#[tauri::command]
pub async fn mcp_request(
    app_handle: AppHandle,
    state: State<'_, McpState>,
    request: Value,
) -> Result<Value> {
    // Initialize server if needed (synchronous)
    {
        let mut state_guard = state.0.lock().unwrap();
        if state_guard.is_none() {
            *state_guard = Some(McpServer::new(app_handle));
        }
    }

    // Since we can't hold the MutexGuard across an await,
    // we need to restructure. For now, let's make a simpler implementation
    // that handles common MCP requests synchronously.

    // Parse the request method
    let method = request
        .get("method")
        .and_then(|m| m.as_str())
        .ok_or_else(|| crate::ReaderError::InvalidArgument("Missing method".to_string()))?;

    match method {
        "initialize" => {
            // Handle initialization synchronously
            Ok(serde_json::json!({
                "protocolVersion": "2024-11-05",
                "serverInfo": {
                    "name": "reader-mcp-host",
                    "version": "0.1.0"
                },
                "capabilities": {
                    "tools": {}
                }
            }))
        }
        "tools/list" => {
            // Return tools list synchronously
            Ok(serde_json::json!({
                "tools": [
                    {
                        "name": "reader.search",
                        "description": "Search for documents using semantic search",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "query": {"type": "string"},
                                "top_k": {"type": "integer"}
                            }
                        }
                    }
                ]
            }))
        }
        "ping" => Ok(serde_json::json!({})),
        _ => {
            // For other requests (like tools/call), we need async handling
            // For now, return an error
            Err(crate::ReaderError::Internal(format!(
                "Method '{}' not yet implemented in Send-safe way",
                method
            )))
        }
    }
}
