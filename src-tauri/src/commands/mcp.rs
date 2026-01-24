use crate::error::Result;
use crate::mcp::McpServer;
use tauri::{AppHandle, State};
use serde_json::Value;
use std::sync::Mutex;

#[derive(Default)]
pub struct McpState(Mutex<Option<McpServer>>);

#[tauri::command]
pub async fn mcp_request(
    app_handle: AppHandle,
    state: State<'_, McpState>,
    request: Value,
) -> Result<Value> {
    let server = {
        let mut state_guard = state.0.lock().unwrap();
        if state_guard.is_none() {
            *state_guard = Some(McpServer::new(app_handle));
        }
        state_guard.as_ref().unwrap()
    };

    server.handle_request(request).await
}
