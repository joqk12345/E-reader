use crate::error::Result;
use crate::mcp::tools::{get_tools_list, handle_tool_call};
use crate::ReaderError;
use serde_json::Value;
use tauri::AppHandle;

const MCP_VERSION: &str = "2024-11-05";
const SERVER_NAME: &str = "reader-mcp-host";
const SERVER_VERSION: &str = "0.1.0";

pub struct McpServer {
    app_handle: AppHandle,
}

impl McpServer {
    pub fn new(app_handle: AppHandle) -> Self {
        Self { app_handle }
    }

    pub async fn handle_request(&self, request: Value) -> Result<Value> {
        let method = request
            .get("method")
            .and_then(|m| m.as_str())
            .ok_or_else(|| ReaderError::InvalidArgument("Missing method".to_string()))?;

        match method {
            "initialize" => self.handle_initialize(request).await,
            "tools/list" => Ok(get_tools_list()),
            "tools/call" => self.handle_tool_call(request).await,
            "ping" => Ok(serde_json::json!({})),
            _ => Err(ReaderError::InvalidArgument(format!(
                "Unknown method: {}",
                method
            ))),
        }
    }

    async fn handle_initialize(&self, request: Value) -> Result<Value> {
        let _params = request.get("params");

        Ok(serde_json::json!({
            "protocolVersion": MCP_VERSION,
            "serverInfo": {
                "name": SERVER_NAME,
                "version": SERVER_VERSION,
            },
            "capabilities": {
                "tools": {},
            }
        }))
    }

    async fn handle_tool_call(&self, request: Value) -> Result<Value> {
        let params = request
            .get("params")
            .ok_or_else(|| ReaderError::InvalidArgument("Missing params".to_string()))?;

        let tool_name = params
            .get("name")
            .and_then(|n| n.as_str())
            .ok_or_else(|| ReaderError::InvalidArgument("Missing tool name".to_string()))?;

        let arguments = params
            .get("arguments")
            .cloned()
            .unwrap_or(serde_json::json!({}));

        handle_tool_call(&self.app_handle, tool_name, arguments).await
    }
}
