# MCP-Enabled Local Reader Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local-first EPUB/PDF reader with Tauri 2 + React, featuring offline embedding + local LLM (LM Studio), semantic search, translation, summarization, and bilingual mode, exposed via MCP Host for Claude Code integration.

**Architecture:**
- Frontend: React with TypeScript + Tailwind CSS
- Backend: Rust (Tauri 2) for parsing, indexing, model orchestration, MCP Host
- Database: SQLite with rusqlite for metadata, structure, and vector index
- AI: LM Studio API (OpenAI-compatible) for embeddings, translation, summarization
- External: MCP Host for Claude Code/Codex integration

**Tech Stack:**
- Tauri 2 (Rust + Web)
- React 18 + TypeScript + Vite
- SQLite (rusqlite crate)
- EPUB: epub-rs crate
- PDF: pdf-rs or poppler
- LM Studio API (HTTP client to localhost:1234)
- MCP SDK (rust-mcp-sdk)

---

## Milestone 0: Project Setup and Infrastructure

### Task 0.1: Initialize Tauri 2 Project with React

**Files:**
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `src/App.tsx`
- Create: `src/main.tsx`

**Step 1: Create project structure**

Run:
```bash
npm create tauri-app@latest reader -- --template react-ts
cd reader
```

Expected: Project created with Tauri 2 + React + TypeScript

**Step 2: Configure Tauri Cargo.toml**

Modify: `src-tauri/Cargo.toml`

```toml
[package]
name = "reader"
version = "0.1.0"
edition = "2024"

[dependencies]
tauri = { version = "2", features = ["shell-open"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tokio = { version = "1", features = ["full"] }
rusqlite = { version = "0.32", features = ["bundled"] }
anyhow = "1.0"
thiserror = "1.0"
tracing = "0.1"
tracing-subscriber = "0.3"

# EPUB parsing
epub = "0.2"

# PDF parsing
pdf = "0.8"
# or poppler for better text extraction
# poppler = "0.22"

# HTTP client for LM Studio
reqwest = { version = "0.12", features = ["json"] }

# MCP
# rust-mcp-sdk = "0.1"  # TODO: Verify actual crate name
```

**Step 3: Update package.json with frontend dependencies**

Modify: `package.json`

```json
{
  "name": "reader",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "@tauri-apps/plugin-shell": "^2.0.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.22.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.2.0",
    "autoprefixer": "^10.4.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.4.0",
    "vite": "^5.2.0"
  }
}
```

**Step 4: Install dependencies**

Run:
```bash
npm install
```

Expected: All dependencies installed successfully

**Step 5: Initialize git repository**

Run:
```bash
git init
git add .
git commit -m "feat: initialize Tauri 2 + React project"
```

Expected: Clean commit with project scaffold

---

### Task 0.2: Configure Tailwind CSS and Basic Layout

**Files:**
- Create: `src/index.css`
- Create: `tailwind.config.js`
- Create: `postcss.config.js`
- Modify: `src/App.tsx`

**Step 1: Configure Tailwind**

Create: `tailwind.config.js`

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

Create: `postcss.config.js`

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
```

**Step 2: Add Tailwind imports**

Create: `src/index.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

**Step 3: Import in main**

Modify: `src/main.tsx`

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

**Step 4: Create basic App layout**

Modify: `src/App.tsx`

```typescript
function App() {
  return (
    <div className="h-screen w-screen bg-gray-50">
      <header className="h-14 bg-white border-b border-gray-200 flex items-center px-4">
        <h1 className="text-lg font-semibold">Reader</h1>
      </header>
      <main className="h-[calc(100vh-3.5rem)]">
        <div className="flex items-center justify-center h-full text-gray-500">
          Welcome to Reader
        </div>
      </main>
    </div>
  )
}

export default App
```

**Step 5: Test the build**

Run:
```bash
npm run dev
```

Expected: Dev server starts, blank white page with "Reader" header

**Step 6: Commit**

Run:
```bash
git add .
git commit -m "feat: configure Tailwind CSS and basic layout"
```

---

### Task 0.3: Setup Rust Error Handling and Logging

**Files:**
- Create: `src-tauri/src/error.rs`
- Create: `src-tauri/src/logger.rs`
- Modify: `src-tauri/src/main.rs`

**Step 1: Create error types**

Create: `src-tauri/src/error.rs`

```rust
use thiserror::Error;

#[derive(Error, Debug)]
pub enum ReaderError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("EPUB parsing error: {0}")]
    EpubParse(String),

    #[error("PDF parsing error: {0}")]
    PdfParse(String),

    #[error("Model API error: {0}")]
    ModelApi(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Invalid argument: {0}")]
    InvalidArgument(String),

    #[error("Model busy")]
    ModelBusy,

    #[error("Internal error: {0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, ReaderError>;

// Convert to Tauri's error type
impl serde::Serialize for ReaderError {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::ser::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
```

**Step 2: Create logger setup**

Create: `src-tauri/src/logger.rs`

```rust
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

pub fn init_logging() {
    tracing_subscriber::registry()
        .with(
            fmt::layer()
                .with_writer(std::io::stdout)
                .with_ansi(true)
        )
        .with(EnvFilter::from_default_env()
            .add_directive(tracing::Level::INFO.into())
        )
        .init();
}
```

**Step 3: Update lib.rs to expose modules**

Modify: `src-tauri/src/lib.rs`

```rust
mod error;
mod logger;

pub use error::{ReaderError, Result};
```

**Step 4: Initialize logging in main**

Modify: `src-tauri/src/main.rs`

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use reader::logger;

fn main() {
    logger::init_logging();
    tracing::info!("Reader starting...");

    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Step 5: Verify compilation**

Run:
```bash
cd src-tauri && cargo check
```

Expected: No compilation errors

**Step 6: Commit**

Run:
```bash
git add .
git commit -m "feat: add error handling and logging infrastructure"
```

---

## Milestone 1: Database Schema and Models

### Task 1.1: Create Database Schema

**Files:**
- Create: `src-tauri/src/database/schema.rs`
- Create: `src-tauri/src/database/mod.rs`
- Create: `src-tauri/src/models/mod.rs`
- Create: `src-tauri/src/models/document.rs`
- Create: `src-tauri/src/models/section.rs`
- Create: `src-tauri/src/models/paragraph.rs`

**Step 1: Create database module with migrations**

Create: `src-tauri/src/database/schema.rs`

```rust
use crate::error::Result;
use rusqlite::{Connection, params};

pub fn create_tables(conn: &Connection) -> Result<()> {
    // Documents table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            author TEXT,
            language TEXT,
            file_path TEXT NOT NULL UNIQUE,
            file_type TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )?;

    // Sections table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sections (
            id TEXT PRIMARY KEY,
            doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            order_index INTEGER NOT NULL,
            href TEXT NOT NULL,
            UNIQUE(doc_id, order_index)
        )",
        [],
    )?;

    // Paragraphs table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS paragraphs (
            id TEXT PRIMARY KEY,
            doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
            order_index INTEGER NOT NULL,
            text TEXT NOT NULL,
            location TEXT NOT NULL,
            UNIQUE(doc_id, section_id, order_index)
        )",
        [],
    )?;

    // Embeddings table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS embeddings (
            id TEXT PRIMARY KEY,
            paragraph_id TEXT NOT NULL UNIQUE REFERENCES paragraphs(id) ON DELETE CASCADE,
            vector BLOB NOT NULL,
            dim INTEGER NOT NULL,
            created_at INTEGER NOT NULL
        )",
        [],
    )?;

    // Cached summaries
    conn.execute(
        "CREATE TABLE IF NOT EXISTS cache_summaries (
            id TEXT PRIMARY KEY,
            target_id TEXT NOT NULL,
            target_type TEXT NOT NULL,
            style TEXT NOT NULL,
            summary TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(target_id, target_type, style)
        )",
        [],
    )?;

    // Cached translations
    conn.execute(
        "CREATE TABLE IF NOT EXISTS cache_translations (
            id TEXT PRIMARY KEY,
            paragraph_id TEXT NOT NULL REFERENCES paragraphs(id) ON DELETE CASCADE,
            target_lang TEXT NOT NULL,
            translation TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(paragraph_id, target_lang)
        )",
        [],
    )?;

    // Indexes
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sections_doc_id ON sections(doc_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_paragraphs_doc_id ON paragraphs(doc_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_paragraphs_section_id ON paragraphs(section_id)",
        [],
    )?;

    Ok(())
}
```

**Step 2: Create database module**

Create: `src-tauri/src/database/mod.rs`

```rust
mod schema;

pub use schema::create_tables;

use crate::error::{ReaderError, Result};
use rusqlite::Connection;
use std::path::PathBuf;
use tauri::AppHandle;

pub fn get_db_path(handle: &AppHandle) -> Result<PathBuf> {
    let app_dir = handle
        .path()
        .app_data_dir()
        .map_err(|e| ReaderError::Internal(e.to_string()))?;

    std::fs::create_dir_all(&app_dir)?;
    Ok(app_dir.join("reader.db"))
}

pub fn get_connection(handle: &AppHandle) -> Result<Connection> {
    let db_path = get_db_path(handle)?;
    let conn = Connection::open(db_path)?;

    // Enable WAL mode for better concurrency
    conn.execute("PRAGMA journal_mode=WAL", [])?;

    Ok(conn)
}

pub fn init_db(handle: &AppHandle) -> Result<()> {
    let conn = get_connection(handle)?;
    create_tables(&conn)?;
    Ok(())
}
```

**Step 3: Create model structs**

Create: `src-tauri/src/models/document.rs`

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub language: Option<String>,
    pub file_path: String,
    pub file_type: String, // "epub" or "pdf"
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct NewDocument {
    pub title: String,
    pub author: Option<String>,
    pub language: Option<String>,
    pub file_path: String,
    pub file_type: String,
}
```

Create: `src-tauri/src/models/section.rs`

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Section {
    pub id: String,
    pub doc_id: String,
    pub title: String,
    pub order_index: i32,
    pub href: String,
}
```

Create: `src-tauri/src/models/paragraph.rs`

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Paragraph {
    pub id: String,
    pub doc_id: String,
    pub section_id: String,
    pub order_index: i32,
    pub text: String,
    pub location: String,
}
```

Create: `src-tauri/src/models/mod.rs`

```rust
mod document;
mod section;
mod paragraph;

pub use document::{Document, NewDocument};
pub use section::Section;
pub use paragraph::Paragraph;
```

**Step 4: Update lib.rs**

Modify: `src-tauri/src/lib.rs`

```rust
mod error;
mod logger;
mod database;
mod models;

pub use error::{ReaderError, Result};
```

**Step 5: Verify compilation**

Run:
```bash
cd src-tauri && cargo check
```

Expected: No compilation errors

**Step 6: Commit**

Run:
```bash
git add .
git commit -m "feat: create database schema and model structs"
```

---

### Task 1.2: Add Database Access Layer

**Files:**
- Create: `src-tauri/src/database/documents.rs`
- Create: `src-tauri/src/database/sections.rs`
- Create: `src-tauri/src/database/paragraphs.rs`
- Modify: `src-tauri/src/database/mod.rs`

**Step 1: Implement documents repository**

Create: `src-tauri/src/database/documents.rs`

```rust
use crate::error::Result;
use crate::models::{Document, NewDocument};
use rusqlite::{Connection, params};
use uuid::Uuid;

pub fn insert(conn: &Connection, new_doc: &NewDocument) -> Result<Document> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();

    let doc = Document {
        id: id.clone(),
        title: new_doc.title.clone(),
        author: new_doc.author.clone(),
        language: new_doc.language.clone(),
        file_path: new_doc.file_path.clone(),
        file_type: new_doc.file_type.clone(),
        created_at: now,
        updated_at: now,
    };

    conn.execute(
        "INSERT INTO documents (id, title, author, language, file_path, file_type, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            &doc.id,
            &doc.title,
            &doc.author,
            &doc.language,
            &doc.file_path,
            &doc.file_type,
            doc.created_at,
            doc.updated_at,
        ],
    )?;

    Ok(doc)
}

pub fn list(conn: &Connection) -> Result<Vec<Document>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, author, language, file_path, file_type, created_at, updated_at
         FROM documents
         ORDER BY created_at DESC"
    )?;

    let docs = stmt.query_map([], |row| {
        Ok(Document {
            id: row.get(0)?,
            title: row.get(1)?,
            author: row.get(2)?,
            language: row.get(3)?,
            file_path: row.get(4)?,
            file_type: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })
    })?
    .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(docs)
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Document>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, author, language, file_path, file_type, created_at, updated_at
         FROM documents
         WHERE id = ?1"
    )?;

    let mut rows = stmt.query(params![id])?;

    match rows.next()? {
        Some(row) => Ok(Some(Document {
            id: row.get(0)?,
            title: row.get(1)?,
            author: row.get(2)?,
            language: row.get(3)?,
            file_path: row.get(4)?,
            file_type: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
        })),
        None => Ok(None),
    }
}

pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    let rows_affected = conn.execute("DELETE FROM documents WHERE id = ?1", params![id])?;
    if rows_affected == 0 {
        return Err(crate::error::ReaderError::NotFound(format!("Document {}", id)));
    }
    Ok(())
}
```

**Step 2: Implement sections repository**

Create: `src-tauri/src/database/sections.rs`

```rust
use crate::error::Result;
use crate::models::Section;
use rusqlite::{Connection, params};
use uuid::Uuid;

pub fn insert(conn: &Connection, doc_id: &str, title: &str, order_index: i32, href: &str) -> Result<Section> {
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO sections (id, doc_id, title, order_index, href)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![&id, doc_id, title, order_index, href],
    )?;

    Ok(Section {
        id,
        doc_id: doc_id.to_string(),
        title: title.to_string(),
        order_index,
        href: href.to_string(),
    })
}

pub fn list_by_document(conn: &Connection, doc_id: &str) -> Result<Vec<Section>> {
    let mut stmt = conn.prepare(
        "SELECT id, doc_id, title, order_index, href
         FROM sections
         WHERE doc_id = ?1
         ORDER BY order_index"
    )?;

    let sections = stmt.query_map(params![doc_id], |row| {
        Ok(Section {
            id: row.get(0)?,
            doc_id: row.get(1)?,
            title: row.get(2)?,
            order_index: row.get(3)?,
            href: row.get(4)?,
        })
    })?
    .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(sections)
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Section>> {
    let mut stmt = conn.prepare(
        "SELECT id, doc_id, title, order_index, href
         FROM sections
         WHERE id = ?1"
    )?;

    let mut rows = stmt.query(params![id])?;

    match rows.next()? {
        Some(row) => Ok(Some(Section {
            id: row.get(0)?,
            doc_id: row.get(1)?,
            title: row.get(2)?,
            order_index: row.get(3)?,
            href: row.get(4)?,
        })),
        None => Ok(None),
    }
}
```

**Step 3: Implement paragraphs repository**

Create: `src-tauri/src/database/paragraphs.rs`

```rust
use crate::error::Result;
use crate::models::Paragraph;
use rusqlite::{Connection, params};
use uuid::Uuid;

pub fn insert(conn: &Connection, doc_id: &str, section_id: &str, order_index: i32, text: &str, location: &str) -> Result<Paragraph> {
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO paragraphs (id, doc_id, section_id, order_index, text, location)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![&id, doc_id, section_id, order_index, text, location],
    )?;

    Ok(Paragraph {
        id,
        doc_id: doc_id.to_string(),
        section_id: section_id.to_string(),
        order_index,
        text: text.to_string(),
        location: location.to_string(),
    })
}

pub fn list_by_section(conn: &Connection, section_id: &str) -> Result<Vec<Paragraph>> {
    let mut stmt = conn.prepare(
        "SELECT id, doc_id, section_id, order_index, text, location
         FROM paragraphs
         WHERE section_id = ?1
         ORDER BY order_index"
    )?;

    let paragraphs = stmt.query_map(params![section_id], |row| {
        Ok(Paragraph {
            id: row.get(0)?,
            doc_id: row.get(1)?,
            section_id: row.get(2)?,
            order_index: row.get(3)?,
            text: row.get(4)?,
            location: row.get(5)?,
        })
    })?
    .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(paragraphs)
}

pub fn get(conn: &Connection, id: &str) -> Result<Option<Paragraph>> {
    let mut stmt = conn.prepare(
        "SELECT id, doc_id, section_id, order_index, text, location
         FROM paragraphs
         WHERE id = ?1"
    )?;

    let mut rows = stmt.query(params![id])?;

    match rows.next()? {
        Some(row) => Ok(Some(Paragraph {
            id: row.get(0)?,
            doc_id: row.get(1)?,
            section_id: row.get(2)?,
            order_index: row.get(3)?,
            text: row.get(4)?,
            location: row.get(5)?,
        })),
        None => Ok(None),
    }
}

pub fn list_by_document(conn: &Connection, doc_id: &str) -> Result<Vec<Paragraph>> {
    let mut stmt = conn.prepare(
        "SELECT id, doc_id, section_id, order_index, text, location
         FROM paragraphs
         WHERE doc_id = ?1
         ORDER BY section_id, order_index"
    )?;

    let paragraphs = stmt.query_map(params![doc_id], |row| {
        Ok(Paragraph {
            id: row.get(0)?,
            doc_id: row.get(1)?,
            section_id: row.get(2)?,
            order_index: row.get(3)?,
            text: row.get(4)?,
            location: row.get(5)?,
        })
    })?
    .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(paragraphs)
}
```

**Step 4: Update database module**

Modify: `src-tauri/src/database/mod.rs`

```rust
mod schema;
mod documents;
mod sections;
mod paragraphs;

pub use schema::create_tables;
pub use documents::{insert as insert_document, list as list_documents, get as get_document, delete as delete_document};
pub use sections::{insert as insert_section, list_by_document as list_sections, get as get_section};
pub use paragraphs::{insert as insert_paragraph, list_by_section as list_paragraphs_by_section, list_by_document as list_paragraphs, get as get_paragraph};

use crate::error::{ReaderError, Result};
use rusqlite::Connection;
use std::path::PathBuf;
use tauri::AppHandle;

pub fn get_db_path(handle: &AppHandle) -> Result<PathBuf> {
    let app_dir = handle
        .path()
        .app_data_dir()
        .map_err(|e| ReaderError::Internal(e.to_string()))?;

    std::fs::create_dir_all(&app_dir)?;
    Ok(app_dir.join("reader.db"))
}

pub fn get_connection(handle: &AppHandle) -> Result<Connection> {
    let db_path = get_db_path(handle)?;
    let conn = Connection::open(db_path)?;
    conn.execute("PRAGMA journal_mode=WAL", [])?;
    Ok(conn)
}

pub fn init_db(handle: &AppHandle) -> Result<()> {
    let conn = get_connection(handle)?;
    create_tables(&conn)?;
    Ok(())
}
```

**Step 5: Add chrono dependency**

Modify: `src-tauri/Cargo.toml`

```toml
# Add to dependencies
chrono = "0.4"
uuid = { version = "1.8", features = ["v4", "serde"] }
```

**Step 6: Verify compilation**

Run:
```bash
cd src-tauri && cargo check
```

Expected: No compilation errors

**Step 7: Commit**

Run:
```bash
git add .
git commit -m "feat: add database access layer for documents, sections, paragraphs"
```

---

## Milestone 2: EPUB Parser

### Task 2.1: Create EPUB Parser Module

**Files:**
- Create: `src-tauri/src/parsers/epub.rs`
- Create: `src-tauri/src/parsers/mod.rs`

**Step 1: Implement EPUB parser**

Create: `src-tauri/src/parsers/epub.rs`

```rust
use crate::error::{ReaderError, Result};
use crate::models::{NewDocument, Section, Paragraph};
use epub::doc::EpubDoc;
use std::path::Path;
use uuid::Uuid;

pub struct EpubParser {
    doc: EpubDoc<std::io::BufReader<std::fs::File>>,
}

impl EpubParser {
    pub fn new(file_path: &str) -> Result<Self> {
        let path = Path::new(file_path);
        if !path.exists() {
            return Err(ReaderError::NotFound(file_path.to_string()));
        }

        let doc = EpubDoc::new(file_path)
            .map_err(|e| ReaderError::EpubParse(format!("Failed to open EPUB: {}", e)))?;

        Ok(Self { doc })
    }

    pub fn get_metadata(&self) -> Result<NewDocument> {
        let title = self.doc.minfo("title")
            .or_else(|| self.doc.minfo("dc:title"))
            .unwrap_or_else(|| "Untitled".to_string());

        let author = self.doc.minfo("creator")
            .or_else(|| self.doc.minfo("dc:creator"))
            .map(|s| s.to_string());

        let language = self.doc.minfo("language")
            .or_else(|| self.doc.minfo("dc:language"))
            .map(|s| s.to_string());

        Ok(NewDocument {
            title,
            author,
            language,
            file_path: self.doc.path.clone(),
            file_type: "epub".to_string(),
        })
    }

    pub fn get_table_of_contents(&self) -> Result<Vec<(String, i32, String)>> {
        let toc = self.doc.toc()
            .map_err(|e| ReaderError::EpubParse(format!("Failed to read TOC: {}", e)))?;

        let mut chapters = Vec::new();
        let mut order = 0;

        for item in toc {
            if let Some(href) = item.content {
                let title = item.label.unwrap_or_else(|| "Untitled".to_string());
                chapters.push((title, order, href));
                order += 1;
            }
        }

        Ok(chapters)
    }

    pub fn get_chapter_content(&self, href: &str) -> Result<Vec<String>> {
        let content = self.doc.get_resource_by_href(href)
            .map_err(|e| ReaderError::EpubParse(format!("Failed to get chapter: {}", e)))?
            .ok_or_else(|| ReaderError::NotFound(format!("Chapter: {}", href)))?;

        // Parse HTML and extract text
        let text = self.extract_text_from_html(&content);
        Ok(text)
    }

    fn extract_text_from_html(&self, html: &[u8]) -> Vec<String> {
        let html_str = String::from_utf8_lossy(html);

        // Simple HTML tag removal and text extraction
        // In production, use a proper HTML parser
        let text = html_str
            .replace("<p>", "\n")
            .replace("</p>", "\n")
            .replace("<br>", "\n")
            .replace("<br/>", "\n")
            .replace("<div>", "\n")
            .replace("</div>", "\n");

        // Remove all other HTML tags
        let re = regex::Regex::new(r"<[^>]+>").unwrap();
        let text = re.replace_all(&text, "");

        // Split into paragraphs and filter empty
        text.split('\n')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect()
    }

    pub fn parse_all(&self) -> Result<(NewDocument, Vec<(String, i32, String, Vec<String>)>)> {
        let metadata = self.get_metadata()?;
        let toc = self.get_table_of_contents()?;

        let mut chapters = Vec::new();

        for (title, order_index, href) in &toc {
            let paragraphs = self.get_chapter_content(href)?;
            chapters.push((title.clone(), *order_index, href.clone(), paragraphs));
        }

        Ok((metadata, chapters))
    }
}
```

**Step 2: Create parsers module**

Create: `src-tauri/src/parsers/mod.rs`

```rust
mod epub;

pub use epub::EpubParser;
```

**Step 3: Add regex dependency**

Modify: `src-tauri/Cargo.toml`

```toml
# Add to dependencies
regex = "1.10"
```

**Step 4: Update lib.rs**

Modify: `src-tauri/src/lib.rs`

```rust
mod error;
mod logger;
mod database;
mod models;
mod parsers;

pub use error::{ReaderError, Result};
```

**Step 5: Verify compilation**

Run:
```bash
cd src-tauri && cargo check
```

Expected: No compilation errors

**Step 6: Commit**

Run:
```bash
git add .
git commit -m "feat: implement EPUB parser module"
```

---

### Task 2.2: Create Tauri Command to Import EPUB

**Files:**
- Create: `src-tauri/src/commands/import.rs`
- Create: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Create import command**

Create: `src-tauri/src/commands/import.rs`

```rust
use crate::database;
use crate::error::Result;
use crate::parsers::EpubParser;
use tauri::{AppHandle, State};

#[derive(Clone, serde::Serialize)]
pub struct ImportProgress {
    pub current: usize,
    pub total: usize,
    pub message: String,
}

type ImportSender = tokio::sync::mpsc::Sender<ImportProgress>;

#[tauri::command]
pub async fn import_epub(
    app_handle: AppHandle,
    file_path: String,
) -> Result<String> {
    // Parse EPUB
    let parser = EpubParser::new(&file_path)?;
    let (metadata, chapters) = parser.parse_all()?;

    // Get database connection
    let conn = database::get_connection(&app_handle)?;

    // Insert document
    let doc = database::insert_document(&conn, &metadata)?;

    // Insert sections and paragraphs
    for (title, order_index, href, paragraphs) in chapters {
        let section = database::insert_section(&conn, &doc.id, &title, order_index, &href)?;

        for (para_order, para_text) in paragraphs.iter().enumerate() {
            let location = format!("{}#p{}", href, para_order);
            database::insert_paragraph(
                &conn,
                &doc.id,
                &section.id,
                para_order as i32,
                para_text,
                &location,
            )?;
        }
    }

    Ok(doc.id)
}

#[tauri::command]
pub async fn list_documents(app_handle: AppHandle) -> Result<Vec<crate::models::Document>> {
    let conn = database::get_connection(&app_handle)?;
    let docs = database::list_documents(&conn)?;
    Ok(docs)
}

#[tauri::command]
pub async fn get_document(
    app_handle: AppHandle,
    id: String,
) -> Result<Option<crate::models::Document>> {
    let conn = database::get_connection(&app_handle)?;
    let doc = database::get_document(&conn, &id)?;
    Ok(doc)
}

#[tauri::command]
pub async fn delete_document(app_handle: AppHandle, id: String) -> Result<()> {
    let conn = database::get_connection(&app_handle)?;
    database::delete_document(&conn, &id)?;
    Ok(())
}
```

**Step 2: Create commands module**

Create: `src-tauri/src/commands/mod.rs`

```rust
mod import;

pub use import::{import_epub, list_documents, get_document, delete_document};
```

**Step 3: Register commands in lib.rs**

Modify: `src-tauri/src/lib.rs`

```rust
mod error;
mod logger;
mod database;
mod models;
mod parsers;
mod commands;

pub use error::{ReaderError, Result};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            logger::init_logging();
            database::init_db(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::import_epub,
            commands::list_documents,
            commands::get_document,
            commands::delete_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Step 4: Update main.rs**

Modify: `src-tauri/src/main.rs`

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    reader::run()
}
```

**Step 5: Verify compilation**

Run:
```bash
cd src-tauri && cargo check
```

Expected: No compilation errors

**Step 6: Commit**

Run:
```bash
git add .
git commit -m "feat: add Tauri commands for EPUB import"
```

---

## Milestone 3: PDF Parser

### Task 3.1: Create PDF Parser Module

**Files:**
- Create: `src-tauri/src/parsers/pdf.rs`
- Modify: `src-tauri/src/parsers/mod.rs`

**Step 1: Implement PDF parser**

Create: `src-tauri/src/parsers/pdf.rs`

```rust
use crate::error::{ReaderError, Result};
use crate::models::NewDocument;
use std::path::Path;
use pdf::file::File as PdfFile;
use pdf::content::{Text as PdfText};
use std::collections::HashMap;

pub struct PdfParser {
    file_path: String,
}

impl PdfParser {
    pub fn new(file_path: &str) -> Result<Self> {
        let path = Path::new(file_path);
        if !path.exists() {
            return Err(ReaderError::NotFound(file_path.to_string()));
        }
        Ok(Self {
            file_path: file_path.to_string(),
        })
    }

    pub fn get_metadata(&self) -> Result<NewDocument> {
        let file = std::fs::File::open(&self.file_path)?;
        let doc = PdfFile::open(file)
            .map_err(|e| ReaderError::PdfParse(format!("Failed to open PDF: {}", e)))?;

        // Try to get title from metadata, otherwise use filename
        let title = doc.get_title()
            .and_then(|t| if t.is_empty() { None } else { Some(t.to_string()) })
            .unwrap_or_else(|| {
                Path::new(&self.file_path)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("Untitled")
                    .to_string()
            });

        let author = doc.get_author()
            .and_then(|a| if a.is_empty() { None } else { Some(a.to_string()) });

        Ok(NewDocument {
            title,
            author,
            language: None, // PDF language detection requires heuristics
            file_path: self.file_path.clone(),
            file_type: "pdf".to_string(),
        })
    }

    pub fn extract_text_by_page(&self) -> Result<Vec<(String, Vec<String>)>> {
        let file = std::fs::File::open(&self.file_path)?;
        let doc = PdfFile::open(file)
            .map_err(|e| ReaderError::PdfParse(format!("Failed to open PDF: {}", e)))?;

        let mut pages = Vec::new();
        let page_count = doc.get_num_pages()
            .map_err(|e| ReaderError::PdfParse(format!("Failed to get page count: {}", e)))?;

        for page_num in 0..page_count {
            let page = doc.get_page(page_num)
                .map_err(|e| ReaderError::PdfParse(format!("Failed to get page {}: {}", page_num, e)))?;

            let text = self.extract_text_from_page(&page)?;
            let title = format!("Page {}", page_num + 1);

            pages.push((title, text));
        }

        Ok(pages)
    }

    fn extract_text_from_page(&self, page: &pdf::page::Page) -> Result<Vec<String>> {
        let mut paragraphs = Vec::new();
        let mut current_paragraph = String::new();

        // Extract text content
        for text_item in page.get_text()?.iter() {
            match text_item {
                PdfText::Text(text) => {
                    current_paragraph.push_str(text);
                    current_paragraph.push(' ');
                }
                PdfText::Newline => {
                    if !current_paragraph.trim().is_empty() {
                        paragraphs.push(current_paragraph.trim().to_string());
                        current_paragraph = String::new();
                    }
                }
                _ => {}
            }
        }

        // Don't forget the last paragraph
        if !current_paragraph.trim().is_empty() {
            paragraphs.push(current_paragraph.trim().to_string());
        }

        // Filter out very short "paragraphs" that are likely artifacts
        paragraphs = paragraphs.into_iter()
            .filter(|p| p.len() > 10)
            .collect();

        Ok(paragraphs)
    }

    pub fn parse_all(&self) -> Result<(NewDocument, Vec<(String, i32, String, Vec<String>)>)> {
        let metadata = self.get_metadata()?;
        let pages = self.extract_text_by_page()?;

        let mut chapters = Vec::new();

        for (order_index, (title, paragraphs)) in pages.into_iter().enumerate() {
            let href = format!("page{}", order_index + 1);
            chapters.push((title, order_index as i32, href, paragraphs));
        }

        Ok((metadata, chapters))
    }
}
```

**Step 2: Update parsers module**

Modify: `src-tauri/src/parsers/mod.rs`

```rust
mod epub;
mod pdf;

pub use epub::EpubParser;
pub use pdf::PdfParser;
```

**Step 3: Add pdf dependency**

Modify: `src-tauri/Cargo.toml`

```toml
# Already added, but verify
pdf = "0.8"
```

**Step 4: Verify compilation**

Run:
```bash
cd src-tauri && cargo check
```

Expected: No compilation errors

**Step 5: Commit**

Run:
```bash
git add .
git commit -m "feat: implement PDF parser module"
```

---

### Task 3.2: Add PDF Import Command

**Files:**
- Modify: `src-tauri/src/commands/import.rs`
- Modify: `src-tauri/src/lib.rs`

**Step 1: Add import_pdf command**

Modify: `src-tauri/src/commands/import.rs`

```rust
use crate::database;
use crate::error::Result;
use crate::parsers::{EpubParser, PdfParser};
use tauri::AppHandle;

#[derive(Clone, serde::Serialize)]
pub struct ImportProgress {
    pub current: usize,
    pub total: usize,
    pub message: String,
}

#[tauri::command]
pub async fn import_epub(
    app_handle: AppHandle,
    file_path: String,
) -> Result<String> {
    let parser = EpubParser::new(&file_path)?;
    let (metadata, chapters) = parser.parse_all()?;
    import_document_internal(app_handle, metadata, chapters).await
}

#[tauri::command]
pub async fn import_pdf(
    app_handle: AppHandle,
    file_path: String,
) -> Result<String> {
    let parser = PdfParser::new(&file_path)?;
    let (metadata, chapters) = parser.parse_all()?;
    import_document_internal(app_handle, metadata, chapters).await
}

async fn import_document_internal(
    app_handle: AppHandle,
    metadata: crate::models::NewDocument,
    chapters: Vec<(String, i32, String, Vec<String>)>,
) -> Result<String> {
    let conn = database::get_connection(&app_handle)?;
    let doc = database::insert_document(&conn, &metadata)?;

    for (title, order_index, href, paragraphs) in chapters {
        let section = database::insert_section(&conn, &doc.id, &title, order_index, &href)?;

        for (para_order, para_text) in paragraphs.iter().enumerate() {
            let location = format!("{}#p{}", href, para_order);
            database::insert_paragraph(
                &conn,
                &doc.id,
                &section.id,
                para_order as i32,
                para_text,
                &location,
            )?;
        }
    }

    Ok(doc.id)
}

#[tauri::command]
pub async fn list_documents(app_handle: AppHandle) -> Result<Vec<crate::models::Document>> {
    let conn = database::get_connection(&app_handle)?;
    let docs = database::list_documents(&conn)?;
    Ok(docs)
}

#[tauri::command]
pub async fn get_document(
    app_handle: AppHandle,
    id: String,
) -> Result<Option<crate::models::Document>> {
    let conn = database::get_connection(&app_handle)?;
    let doc = database::get_document(&conn, &id)?;
    Ok(doc)
}

#[tauri::command]
pub async fn delete_document(app_handle: AppHandle, id: String) -> Result<()> {
    let conn = database::get_connection(&app_handle)?;
    database::delete_document(&conn, &id)?;
    Ok(())
}
```

**Step 2: Register new command**

Modify: `src-tauri/src/lib.rs`

```rust
        .invoke_handler(tauri::generate_handler![
            commands::import_epub,
            commands::import_pdf,
            commands::list_documents,
            commands::get_document,
            commands::delete_document,
        ])
```

**Step 3: Verify compilation**

Run:
```bash
cd src-tauri && cargo check
```

Expected: No compilation errors

**Step 4: Commit**

Run:
```bash
git add .
git commit -m "feat: add PDF import command"
```

---

## Milestone 4: Frontend - Library View and Document Import

### Task 4.1: Create Frontend State Management

**Files:**
- Create: `src/store/useStore.ts`
- Create: `src/types/index.ts`

**Step 1: Define TypeScript types**

Create: `src/types/index.ts`

```typescript
export interface Document {
  id: string;
  title: string;
  author?: string;
  language?: string;
  file_path: string;
  file_type: 'epub' | 'pdf';
  created_at: number;
  updated_at: number;
}

export interface Section {
  id: string;
  doc_id: string;
  title: string;
  order_index: number;
  href: string;
}

export interface Paragraph {
  id: string;
  doc_id: string;
  section_id: string;
  order_index: number;
  text: string;
  location: string;
}

export interface ImportResult {
  docId: string;
}
```

**Step 2: Create Zustand store**

Create: `src/store/useStore.ts`

```typescript
import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { Document } from '../types';

interface ReaderState {
  documents: Document[];
  selectedDocumentId: string | null;
  isLoading: boolean;

  // Actions
  loadDocuments: () => Promise<void>;
  selectDocument: (id: string) => void;
  importEpub: (filePath: string) => Promise<string>;
  importPdf: (filePath: string) => Promise<string>;
  deleteDocument: (id: string) => Promise<void>;
}

export const useStore = create<ReaderState>((set, get) => ({
  documents: [],
  selectedDocumentId: null,
  isLoading: false,

  loadDocuments: async () => {
    set({ isLoading: true });
    try {
      const docs = await invoke<Document[]>('list_documents');
      set({ documents: docs, isLoading: false });
    } catch (error) {
      console.error('Failed to load documents:', error);
      set({ isLoading: false });
      throw error;
    }
  },

  selectDocument: (id: string) => {
    set({ selectedDocumentId: id });
  },

  importEpub: async (filePath: string) => {
    set({ isLoading: true });
    try {
      const docId = await invoke<string>('import_epub', { filePath });
      await get().loadDocuments();
      set({ isLoading: false });
      return docId;
    } catch (error) {
      console.error('Failed to import EPUB:', error);
      set({ isLoading: false });
      throw error;
    }
  },

  importPdf: async (filePath: string) => {
    set({ isLoading: true });
    try {
      const docId = await invoke<string>('import_pdf', { filePath });
      await get().loadDocuments();
      set({ isLoading: false });
      return docId;
    } catch (error) {
      console.error('Failed to import PDF:', error);
      set({ isLoading: false });
      throw error;
    }
  },

  deleteDocument: async (id: string) => {
    set({ isLoading: true });
    try {
      await invoke('delete_document', { id });
      await get().loadDocuments();
      set({ isLoading: false });
    } catch (error) {
      console.error('Failed to delete document:', error);
      set({ isLoading: false });
      throw error;
    }
  },
}));
```

**Step 3: Commit**

Run:
```bash
git add .
git commit -m "feat: add frontend state management with Zustand"
```

---

### Task 4.2: Create Library View Component

**Files:**
- Create: `src/components/Library.tsx`
- Create: `src/components/DocumentCard.tsx`

**Step 1: Create document card component**

Create: `src/components/DocumentCard.tsx`

```typescript
import React from 'react';
import type { Document } from '../types';

interface DocumentCardProps {
  document: Document;
  onClick: () => void;
  onDelete: () => void;
}

export const DocumentCard: React.FC<DocumentCardProps> = ({ document, onClick, onDelete }) => {
  const getFileTypeIcon = () => {
    return document.file_type === 'epub' ? '📚' : '📄';
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString();
  };

  return (
    <div
      className="bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow cursor-pointer p-4"
      onClick={onClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3 flex-1">
          <span className="text-3xl">{getFileTypeIcon()}</span>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">{document.title}</h3>
            {document.author && (
              <p className="text-sm text-gray-600 truncate">{document.author}</p>
            )}
            <p className="text-xs text-gray-500 mt-1">
              Added {formatDate(document.created_at)}
            </p>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="text-gray-400 hover:text-red-500 transition-colors p-1"
          aria-label="Delete document"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </div>
  );
};
```

**Step 2: Create library view component**

Create: `src/components/Library.tsx`

```typescript
import React, { useEffect } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useStore } from '../store/useStore';
import { DocumentCard } from './DocumentCard';

export const Library: React.FC = () => {
  const { documents, isLoading, loadDocuments, importEpub, importPdf, deleteDocument, selectDocument } = useStore();

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const handleImport = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: 'Documents',
            extensions: ['epub', 'pdf']
          }
        ]
      });

      if (selected && typeof selected === 'string') {
        const ext = selected.split('.').pop()?.toLowerCase();
        if (ext === 'epub') {
          await importEpub(selected);
        } else if (ext === 'pdf') {
          await importPdf(selected);
        }
      }
    } catch (error) {
      console.error('Import failed:', error);
      alert('Failed to import document');
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Are you sure you want to delete this document?')) {
      try {
        await deleteDocument(id);
      } catch (error) {
        console.error('Delete failed:', error);
        alert('Failed to delete document');
      }
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Library</h1>
          <button
            onClick={handleImport}
            disabled={isLoading}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
          >
            {isLoading ? 'Importing...' : 'Import Document'}
          </button>
        </div>
      </div>

      {/* Documents Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {documents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mb-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <p className="text-lg">No documents yet</p>
            <p className="text-sm mt-2">Import an EPUB or PDF file to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {documents.map((doc) => (
              <DocumentCard
                key={doc.id}
                document={doc}
                onClick={() => selectDocument(doc.id)}
                onDelete={() => handleDelete(doc.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
```

**Step 3: Add Tauri dialog plugin**

Modify: `package.json`

```json
{
  "dependencies": {
    "@tauri-apps/plugin-dialog": "^2.0.0",
    // ... other dependencies
  }
}
```

**Step 4: Update App.tsx**

Modify: `src/App.tsx`

```typescript
import { Library } from './components/Library';

function App() {
  return (
    <div className="h-screen w-screen bg-gray-50">
      <Library />
    </div>
  );
}

export default App;
```

**Step 5: Test build**

Run:
```bash
npm install
npm run dev
```

Expected: Library view displays, import button available

**Step 6: Commit**

Run:
```bash
git add .
git commit -m "feat: add library view component with import/delete functionality"
```

---

## Milestone 5: Reader View and Navigation

### Task 5.1: Create Reader View Components

**Files:**
- Create: `src/components/Reader.tsx`
- Create: `src/components/TOCPanel.tsx`
- Create: `src/components/ReaderContent.tsx`

**Step 1: Add Tauri commands for reading**

Modify: `src-tauri/src/commands/import.rs`

```rust
// Add at the end of the file

#[tauri::command]
pub async fn get_document_sections(
    app_handle: AppHandle,
    doc_id: String,
) -> Result<Vec<crate::models::Section>> {
    let conn = database::get_connection(&app_handle)?;
    let sections = database::list_sections(&conn, &doc_id)?;
    Ok(sections)
}

#[tauri::command]
pub async fn get_section_paragraphs(
    app_handle: AppHandle,
    section_id: String,
) -> Result<Vec<crate::models::Paragraph>> {
    let conn = database::get_connection(&app_handle)?;
    let paragraphs = database::list_paragraphs_by_section(&conn, &section_id)?;
    Ok(paragraphs)
}
```

**Step 2: Register new commands**

Modify: `src-tauri/src/lib.rs`

```rust
        .invoke_handler(tauri::generate_handler![
            commands::import_epub,
            commands::import_pdf,
            commands::list_documents,
            commands::get_document,
            commands::delete_document,
            commands::get_document_sections,
            commands::get_section_paragraphs,
        ])
```

**Step 3: Update store**

Modify: `src/store/useStore.ts`

```typescript
interface ReaderState {
  // ... existing fields
  sections: Section[];
  currentSectionId: string | null;
  paragraphs: Paragraph[];
  currentParagraph: Paragraph | null;

  // ... existing actions
  loadSections: (docId: string) => Promise<void>;
  loadParagraphs: (sectionId: string) => Promise<void>;
  selectSection: (sectionId: string) => void;
  goBack: () => void;
}

export const useStore = create<ReaderState>((set, get) => ({
  // ... existing initializers
  sections: [],
  currentSectionId: null,
  paragraphs: [],
  currentParagraph: null,

  // ... existing actions

  loadSections: async (docId: string) => {
    try {
      const sections = await invoke<Section[]>('get_document_sections', { docId });
      set({ sections, selectedDocumentId: docId });
    } catch (error) {
      console.error('Failed to load sections:', error);
      throw error;
    }
  },

  loadParagraphs: async (sectionId: string) => {
    set({ isLoading: true });
    try {
      const paragraphs = await invoke<Paragraph[]>('get_section_paragraphs', { sectionId });
      set({ paragraphs, currentSectionId: sectionId, isLoading: false });
    } catch (error) {
      console.error('Failed to load paragraphs:', error);
      set({ isLoading: false });
      throw error;
    }
  },

  selectSection: (sectionId: string) => {
    set({ currentSectionId: sectionId });
    get().loadParagraphs(sectionId);
  },

  goBack: () => {
    set({
      selectedDocumentId: null,
      currentSectionId: null,
      paragraphs: [],
      sections: [],
    });
  },
}));
```

**Step 4: Create TOC panel**

Create: `src/components/TOCPanel.tsx`

```typescript
import React from 'react';
import { useStore } from '../store/useStore';

export const TOCPanel: React.FC = () => {
  const { sections, currentSectionId, selectSection } = useStore();

  return (
    <div className="w-64 bg-white border-r border-gray-200 overflow-y-auto">
      <div className="p-4 border-b border-gray-200">
        <h2 className="font-semibold text-gray-900">Table of Contents</h2>
      </div>
      <nav className="p-2">
        {sections.map((section) => (
          <button
            key={section.id}
            onClick={() => selectSection(section.id)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
              currentSectionId === section.id
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            {section.title}
          </button>
        ))}
      </nav>
    </div>
  );
};
```

**Step 5: Create reader content**

Create: `src/components/ReaderContent.tsx`

```typescript
import React from 'react';
import { useStore } from '../store/useStore';

export const ReaderContent: React.FC = () => {
  const { paragraphs, isLoading } = useStore();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  if (paragraphs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Select a section to start reading</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-8 py-6">
        <div className="prose prose-lg">
          {paragraphs.map((para) => (
            <p
              key={para.id}
              id={para.location}
              className="mb-4 leading-relaxed text-gray-900"
            >
              {para.text}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
};
```

**Step 6: Create main reader component**

Create: `src/components/Reader.tsx`

```typescript
import React, { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { TOCPanel } from './TOCPanel';
import { ReaderContent } from './ReaderContent';

export const Reader: React.FC = () => {
  const { selectedDocumentId, loadSections, goBack } = useStore();

  useEffect(() => {
    if (selectedDocumentId) {
      loadSections(selectedDocumentId);
    }
  }, [selectedDocumentId, loadSections]);

  if (!selectedDocumentId) {
    return null;
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="h-14 border-b border-gray-200 flex items-center px-4">
        <button
          onClick={goBack}
          className="mr-4 p-2 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label="Go back to library"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <h1 className="font-semibold">Reader</h1>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        <TOCPanel />
        <ReaderContent />
      </div>
    </div>
  );
};
```

**Step 7: Update App.tsx**

Modify: `src/App.tsx`

```typescript
import { Library } from './components/Library';
import { Reader } from './components/Reader';
import { useStore } from './store/useStore';

function App() {
  const { selectedDocumentId } = useStore();

  return (
    <div className="h-screen w-screen bg-gray-50">
      {selectedDocumentId ? <Reader /> : <Library />}
    </div>
  );
}

export default App;
```

**Step 8: Test build**

Run:
```bash
npm run dev
```

Expected: Can import document, see TOC, click sections to read

**Step 9: Commit**

Run:
```bash
git add .
git commit -m "feat: add reader view with TOC navigation"
```

---

## Milestone 6: LM Studio Integration

### Task 6.1: Create LM Studio API Client

**Files:**
- Create: `src-tauri/src/llm/mod.rs`
- Create: `src-tauri/src/llm/lmstudio.rs`
- Create: `src-tauri/src/config.rs`

**Step 1: Create configuration module**

Create: `src-tauri/src/config.rs`

```rust
use crate::error::{ReaderError, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::AppHandle;

const DEFAULT_LM_STUDIO_URL: &str = "http://localhost:1234/v1";
const DEFAULT_EMBEDDING_MODEL: &str = "text-embedding-ada-002";
const DEFAULT_CHAT_MODEL: &str = "local-model";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub lm_studio_url: String,
    pub embedding_model: String,
    pub chat_model: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            lm_studio_url: DEFAULT_LM_STUDIO_URL.to_string(),
            embedding_model: DEFAULT_EMBEDDING_MODEL.to_string(),
            chat_model: DEFAULT_CHAT_MODEL.to_string(),
        }
    }
}

pub fn get_config_path(handle: &AppHandle) -> Result<PathBuf> {
    let app_dir = handle
        .path()
        .app_data_dir()
        .map_err(|e| ReaderError::Internal(e.to_string()))?;

    Ok(app_dir.join("config.json"))
}

pub fn load_config(handle: &AppHandle) -> Result<Config> {
    let config_path = get_config_path(handle)?;

    if !config_path.exists() {
        let config = Config::default();
        save_config(handle, &config)?;
        return Ok(config);
    }

    let content = std::fs::read_to_string(&config_path)?;
    let config: Config = serde_json::from_str(&content)
        .map_err(|e| ReaderError::Internal(format!("Failed to parse config: {}", e)))?;

    Ok(config)
}

pub fn save_config(handle: &AppHandle, config: &Config) -> Result<()> {
    let config_path = get_config_path(handle)?;
    let content = serde_json::to_string_pretty(config)?;
    std::fs::write(&config_path, content)?;
    Ok(())
}
```

**Step 2: Create LM Studio client**

Create: `src-tauri/src/llm/lmstudio.rs`

```rust
use crate::config::Config;
use crate::error::{ReaderError, Result};
use reqwest::Client;
use serde::{Deserialize, Serialize};

const TIMEOUT_SECS: u64 = 120;

#[derive(Debug, Serialize)]
struct EmbeddingRequest {
    input: String,
    model: String,
}

#[derive(Debug, Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
}

#[derive(Debug, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Debug, Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    max_tokens: i32,
}

#[derive(Debug, Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

#[derive(Debug, Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

pub struct LmStudioClient {
    client: Client,
    config: Config,
}

impl LmStudioClient {
    pub fn new(config: Config) -> Result<Self> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
            .build()
            .map_err(|e| ReaderError::Internal(format!("Failed to create HTTP client: {}", e)))?;

        Ok(Self { client, config })
    }

    pub async fn generate_embedding(&self, text: &str) -> Result<Vec<f32>> {
        let url = format!("{}/embeddings", self.config.lm_studio_url);
        let request = EmbeddingRequest {
            input: text.to_string(),
            model: self.config.embedding_model.clone(),
        };

        let response = self.client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| ReaderError::ModelApi(format!("Failed to connect to LM Studio: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(ReaderError::ModelApi(format!("LM Studio error {}: {}", status, error_text)));
        }

        let embed_response: EmbeddingResponse = response
            .json()
            .await
            .map_err(|e| ReaderError::ModelApi(format!("Failed to parse response: {}", e)))?;

        embed_response.data
            .into_iter()
            .next()
            .map(|d| d.embedding)
            .ok_or_else(|| ReaderError::ModelApi("No embedding in response".to_string()))
    }

    pub async fn chat(&self, messages: Vec<(String, String)>, temperature: f32, max_tokens: i32) -> Result<String> {
        let url = format!("{}/chat/completions", self.config.lm_studio_url);

        let chat_messages: Vec<ChatMessage> = messages
            .into_iter()
            .map(|(role, content)| ChatMessage { role, content })
            .collect();

        let request = ChatRequest {
            model: self.config.chat_model.clone(),
            messages: chat_messages,
            temperature,
            max_tokens,
        };

        let response = self.client
            .post(&url)
            .json(&request)
            .send()
            .await
            .map_err(|e| ReaderError::ModelApi(format!("Failed to connect to LM Studio: {}", e)))?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_else(|_| "Unknown error".to_string());
            return Err(ReaderError::ModelApi(format!("LM Studio error {}: {}", status, error_text)));
        }

        let chat_response: ChatResponse = response
            .json()
            .await
            .map_err(|e| ReaderError::ModelApi(format!("Failed to parse response: {}", e)))?;

        chat_response.choices
            .into_iter()
            .next()
            .map(|c| c.message.content)
            .ok_or_else(|| ReaderError::ModelApi("No response in chat completion".to_string()))
    }
}
```

**Step 3: Create LLM module**

Create: `src-tauri/src/llm/mod.rs`

```rust
mod lmstudio;

pub use lmstudio::LmStudioClient;
```

**Step 4: Update lib.rs**

Modify: `src-tauri/src/lib.rs`

```rust
mod error;
mod logger;
mod database;
mod models;
mod parsers;
mod commands;
mod config;
mod llm;

pub use error::{ReaderError, Result};
```

**Step 5: Add dependencies**

Modify: `src-tauri/Cargo.toml`

```toml
# Already have reqwest, verify features
reqwest = { version = "0.12", features = ["json"] }

# Add if missing
tokio = { version = "1", features = ["full"] }
```

**Step 6: Verify compilation**

Run:
```bash
cd src-tauri && cargo check
```

Expected: No compilation errors

**Step 7: Commit**

Run:
```bash
git add .
git commit -m "feat: add LM Studio API client"
```

---

### Task 6.2: Implement Embedding and Vector Search

**Files:**
- Create: `src-tauri/src/search/mod.rs`
- Create: `src-tauri/src/database/embeddings.rs`
- Modify: `src-tauri/src/database/mod.rs`

**Step 1: Create embeddings table operations**

Create: `src-tauri/src/database/embeddings.rs`

```rust
use crate::error::Result;
use rusqlite::{Connection, params};
use uuid::Uuid;

pub fn insert(conn: &Connection, paragraph_id: &str, vector: &[f32]) -> Result<()> {
    let id = Uuid::new_v4().to_string();
    let dim = vector.len() as i32;

    // Convert Vec<f32> to bytes
    let bytes: Vec<u8> = vector
        .iter()
        .flat_map(|&f| f.to_le_bytes().to_vec())
        .collect();

    conn.execute(
        "INSERT INTO embeddings (id, paragraph_id, vector, dim, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![&id, paragraph_id, &bytes, dim, chrono::Utc::now().timestamp()],
    )?;

    Ok(())
}

pub fn get(conn: &Connection, paragraph_id: &str) -> Result<Option<Vec<f32>>> {
    let mut stmt = conn.prepare(
        "SELECT vector, dim FROM embeddings WHERE paragraph_id = ?1"
    )?;

    let mut rows = stmt.query(params![paragraph_id])?;

    match rows.next()? {
        Some(row) => {
            let bytes: Vec<u8> = row.get(0)?;
            let dim: i32 = row.get(1)?;

            // Convert bytes back to Vec<f32>
            let mut vector = Vec::with_capacity(dim as usize);
            for chunk in bytes.chunks_exact(4) {
                let f = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                vector.push(f);
            }

            Ok(Some(vector))
        }
        None => Ok(None),
    }
}

pub fn list_all_vectors(conn: &Connection) -> Result<Vec<(String, Vec<f32>)>> {
    let mut stmt = conn.prepare(
        "SELECT paragraph_id, vector, dim FROM embeddings"
    )?;

    let rows = stmt.query_map([], |row| {
        let paragraph_id: String = row.get(0)?;
        let bytes: Vec<u8> = row.get(1)?;
        let dim: i32 = row.get(2)?;

        let mut vector = Vec::with_capacity(dim as usize);
        for chunk in bytes.chunks_exact(4) {
            let f = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
            vector.push(f);
        }

        Ok((paragraph_id, vector))
    })?
    .collect::<std::result::Result<Vec<_>, _>>()?;

    Ok(rows)
}
```

**Step 2: Update database module**

Modify: `src-tauri/src/database/mod.rs`

```rust
mod schema;
mod documents;
mod sections;
mod paragraphs;
mod embeddings;

pub use schema::create_tables;
pub use documents::{insert as insert_document, list as list_documents, get as get_document, delete as delete_document};
pub use sections::{insert as insert_section, list_by_document as list_sections, get as get_section};
pub use paragraphs::{insert as insert_paragraph, list_by_section as list_paragraphs_by_section, list_by_document as list_paragraphs, get as get_paragraph};
pub use embeddings::{insert as insert_embedding, get as get_embedding, list_all_vectors as list_all_embeddings};

// ... rest of module
```

**Step 3: Create search module**

Create: `src-tauri/src/search/mod.rs`

```rust
use crate::database::{self, get_paragraph};
use crate::error::Result;
use crate::llm::LmStudioClient;

#[derive(Debug, Clone)]
pub struct SearchResult {
    pub paragraph_id: String,
    pub snippet: String,
    pub score: f32,
    pub location: String,
}

pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }

    let dot_product: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }

    dot_product / (norm_a * norm_b)
}

pub async fn semantic_search(
    conn: &rusqlite::Connection,
    client: &LmStudioClient,
    query: &str,
    top_k: usize,
    doc_id_filter: Option<&str>,
) -> Result<Vec<SearchResult>> {
    // Generate embedding for query
    let query_embedding = client.generate_embedding(query).await?;

    // Get all embeddings
    let all_embeddings = database::list_all_vectors(conn)?;

    // Calculate similarities
    let mut similarities: Vec<(String, f32)> = all_embeddings
        .into_iter()
        .filter(|(pid, _)| {
            // Filter by document if specified
            if let Some(doc_id) = doc_id_filter {
                if let Ok(Some(para)) = get_paragraph(conn, pid) {
                    return para.doc_id == doc_id;
                }
            }
            true
        })
        .map(|(pid, vec)| {
            let score = cosine_similarity(&query_embedding, &vec);
            (pid, score)
        })
        .collect();

    // Sort by score (descending)
    similarities.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

    // Take top_k
    similarities.truncate(top_k);

    // Fetch paragraph details
    let mut results = Vec::new();
    for (para_id, score) in similarities {
        if let Ok(Some(para)) = get_paragraph(conn, &para_id) {
            let snippet = if para.text.len() > 200 {
                format!("{}...", &para.text[..200])
            } else {
                para.text.clone()
            };

            results.push(SearchResult {
                paragraph_id: para_id,
                snippet,
                score,
                location: para.location,
            });
        }
    }

    Ok(results)
}
```

**Step 4: Update lib.rs**

Modify: `src-tauri/src/lib.rs`

```rust
mod error;
mod logger;
mod database;
mod models;
mod parsers;
mod commands;
mod config;
mod llm;
mod search;

pub use error::{ReaderError, Result};
```

**Step 5: Add search command**

Create: `src-tauri/src/commands/search.rs`

```rust
use crate::config;
use crate::database;
use crate::error::Result;
use crate::llm::LmStudioClient;
use crate::search;
use tauri::AppHandle;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct SearchResultOutput {
    pub paragraph_id: String,
    pub snippet: String,
    pub score: f32,
    pub location: String,
}

#[derive(Debug, Deserialize)]
pub struct SearchOptions {
    pub query: String,
    #[serde(default = "default_top_k")]
    pub top_k: usize,
    pub doc_id: Option<String>,
}

fn default_top_k() -> usize {
    10
}

#[tauri::command]
pub async fn search(
    app_handle: AppHandle,
    options: SearchOptions,
) -> Result<Vec<SearchResultOutput>> {
    let conn = database::get_connection(&app_handle)?;
    let config = config::load_config(&app_handle)?;
    let client = LmStudioClient::new(config)?;

    let results = search::semantic_search(
        &conn,
        &client,
        &options.query,
        options.top_k,
        options.doc_id.as_deref(),
    ).await?;

    let output = results.into_iter().map(|r| SearchResultOutput {
        paragraph_id: r.paragraph_id,
        snippet: r.snippet,
        score: r.score,
        location: r.location,
    }).collect();

    Ok(output)
}
```

**Step 6: Update commands module**

Modify: `src-tauri/src/commands/mod.rs`

```rust
mod import;
mod search;

pub use import::{import_epub, import_pdf, list_documents, get_document, delete_document, get_document_sections, get_section_paragraphs};
pub use search::search;
```

**Step 7: Register search command**

Modify: `src-tauri/src/lib.rs`

```rust
        .invoke_handler(tauri::generate_handler![
            commands::import_epub,
            commands::import_pdf,
            commands::list_documents,
            commands::get_document,
            commands::delete_document,
            commands::get_document_sections,
            commands::get_section_paragraphs,
            commands::search,
        ])
```

**Step 8: Verify compilation**

Run:
```bash
cd src-tauri && cargo check
```

Expected: No compilation errors

**Step 9: Commit**

Run:
```bash
git add .
git commit -m "feat: implement embedding and semantic search"
```

---

### Task 6.3: Add Embedding Generation on Import

**Files:**
- Modify: `src-tauri/src/commands/import.rs`
- Create: `src-tauri/src/commands/index.rs`

**Step 1: Create indexing command**

Create: `src-tauri/src/commands/index.rs`

```rust
use crate::config;
use crate::database;
use crate::error::Result;
use crate::llm::LmStudioClient;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn index_document(app_handle: AppHandle, doc_id: String) -> Result<usize> {
    let conn = database::get_connection(&app_handle)?;
    let config = config::load_config(&app_handle)?;
    let client = LmStudioClient::new(config)?;

    let paragraphs = database::list_paragraphs(&conn, &doc_id)?;
    let mut indexed = 0;

    for para in paragraphs {
        // Check if already indexed
        if let Ok(Some(_)) = database::get_embedding(&conn, &para.id) {
            continue;
        }

        // Generate embedding
        let embedding = client.generate_embedding(&para.text).await?;
        database::insert_embedding(&conn, &para.id, &embedding)?;
        indexed += 1;
    }

    Ok(indexed)
}
```

**Step 2: Export from commands module**

Modify: `src-tauri/src/commands/mod.rs`

```rust
mod import;
mod search;
mod index;

pub use import::{import_epub, import_pdf, list_documents, get_document, delete_document, get_document_sections, get_section_paragraphs};
pub use search::search;
pub use index::index_document;
```

**Step 3: Register command**

Modify: `src-tauri/src/lib.rs`

```rust
        .invoke_handler(tauri::generate_handler![
            commands::import_epub,
            commands::import_pdf,
            commands::list_documents,
            commands::get_document,
            commands::delete_document,
            commands::get_document_sections,
            commands::get_section_paragraphs,
            commands::search,
            commands::index_document,
        ])
```

**Step 4: Verify compilation**

Run:
```bash
cd src-tauri && cargo check
```

Expected: No compilation errors

**Step 5: Commit**

Run:
```bash
git add .
git commit -m "feat: add document indexing command"
```

---

## Milestone 7: Translation and Summarization

### Task 7.1: Implement Translation

**Files:**
- Create: `src-tauri/src/commands/translate.rs`
- Modify: `src-tauri/src/database/mod.rs`

**Step 1: Add translation cache operations**

Modify: `src-tauri/src/database/mod.rs` (add at end before closing)

```rust
mod cache;

pub use cache::{get_translation, save_translation, get_summary, save_summary};
```

Create: `src-tauri/src/database/cache.rs`

```rust
use crate::error::Result;
use rusqlite::{Connection, params};
use uuid::Uuid;

pub fn save_translation(conn: &Connection, paragraph_id: &str, target_lang: &str, translation: &str) -> Result<()> {
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT OR REPLACE INTO cache_translations (id, paragraph_id, target_lang, translation, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![&id, paragraph_id, target_lang, translation, chrono::Utc::now().timestamp()],
    )?;

    Ok(())
}

pub fn get_translation(conn: &Connection, paragraph_id: &str, target_lang: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare(
        "SELECT translation FROM cache_translations WHERE paragraph_id = ?1 AND target_lang = ?2"
    )?;

    let mut rows = stmt.query(params![paragraph_id, target_lang])?;

    match rows.next()? {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}

pub fn save_summary(conn: &Connection, target_id: &str, target_type: &str, style: &str, summary: &str) -> Result<()> {
    let id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT OR REPLACE INTO cache_summaries (id, target_id, target_type, style, summary, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![&id, target_id, target_type, style, summary, chrono::Utc::now().timestamp()],
    )?;

    Ok(())
}

pub fn get_summary(conn: &Connection, target_id: &str, target_type: &str, style: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare(
        "SELECT summary FROM cache_summaries WHERE target_id = ?1 AND target_type = ?2 AND style = ?3"
    )?;

    let mut rows = stmt.query(params![target_id, target_type, style])?;

    match rows.next()? {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}
```

**Step 2: Create translation command**

Create: `src-tauri/src/commands/translate.rs`

```rust
use crate::config;
use crate::database::{self, get_paragraph, get_translation, save_translation};
use crate::error::Result;
use crate::llm::LmStudioClient;
use tauri::AppHandle;
use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct TranslateRequest {
    pub text: Option<String>,
    pub paragraph_id: Option<String>,
    pub target_lang: String,
}

#[tauri::command]
pub async fn translate(
    app_handle: AppHandle,
    request: TranslateRequest,
) -> Result<String> {
    let conn = database::get_connection(&app_handle)?;
    let config = config::load_config(&app_handle)?;
    let client = LmStudioClient::new(config)?;

    // Get source text
    let (source_text, para_id) = match (request.text, request.paragraph_id) {
        (Some(text), None) => (text, None),
        (None, Some(pid)) => {
            let para = get_paragraph(&conn, &pid)?
                .ok_or_else(|| crate::error::ReaderError::NotFound(format!("Paragraph {}", pid)))?;
            (para.text, Some(pid))
        },
        (Some(_), Some(_)) => return Err(crate::error::ReaderError::InvalidArgument("Provide either text or paragraph_id, not both".to_string())),
        (None, None) => return Err(crate::error::ReaderError::InvalidArgument("Provide either text or paragraph_id".to_string())),
    };

    // Check cache
    if let Some(pid) = &para_id {
        if let Ok(Some(cached)) = get_translation(&conn, pid, &request.target_lang) {
            return Ok(cached);
        }
    }

    // Build prompt
    let target_language_name = match request.target_lang.as_str() {
        "zh" => "Chinese",
        "en" => "English",
        _ => &request.target_lang,
    };

    let messages = vec![
        ("system".to_string(), format!("You are a professional translator. Translate the given text to {} accurately. Return only the translation, no explanations.", target_language_name)),
        ("user".to_string(), source_text),
    ];

    // Call LLM
    let translation = client.chat(messages, 0.3, 2000).await?;

    // Cache if we have a paragraph_id
    if let Some(pid) = &para_id {
        save_translation(&conn, pid, &request.target_lang, &translation)?;
    }

    Ok(translation)
}
```

**Step 3: Create summarization command**

Modify: `src-tauri/src/commands/translate.rs` (add at end)

```rust
#[derive(Debug, Deserialize)]
pub struct SummarizeRequest {
    pub doc_id: Option<String>,
    pub section_id: Option<String>,
    pub paragraph_id: Option<String>,
    #[serde(default = "default_summary_style")]
    pub style: String,
}

fn default_summary_style() -> String {
    "brief".to_string()
}

#[tauri::command]
pub async fn summarize(
    app_handle: AppHandle,
    request: SummarizeRequest,
) -> Result<String> {
    let conn = database::get_connection(&app_handle)?;
    let config = config::load_config(&app_handle)?;
    let client = LmStudioClient::new(config)?;

    // Get text to summarize
    let (text, target_id, target_type) = if let Some(pid) = request.paragraph_id {
        let para = get_paragraph(&conn, &pid)?
            .ok_or_else(|| crate::error::ReaderError::NotFound(format!("Paragraph {}", pid)))?;
        (para.text, pid, "paragraph".to_string())
    } else if let Some(sid) = request.section_id {
        let paragraphs = database::list_paragraphs_by_section(&conn, &sid)?;
        let text = paragraphs.iter().map(|p| p.text.clone()).collect::<Vec<_>>().join("\n\n");
        (text, sid, "section".to_string())
    } else if let Some(did) = request.doc_id {
        let paragraphs = database::list_paragraphs(&conn, &did)?;
        let text = paragraphs.iter().map(|p| p.text.clone()).collect::<Vec<_>>().join("\n\n");
        (text, did, "document".to_string())
    } else {
        return Err(crate::error::ReaderError::InvalidArgument("Provide one of: doc_id, section_id, or paragraph_id".to_string()));
    };

    // Check cache
    if let Ok(Some(cached)) = database::get_summary(&conn, &target_id, &target_type, &request.style) {
        return Ok(cached);
    }

    // Build prompt based on style
    let style_instruction = match request.style.as_str() {
        "brief" => "Provide a brief 2-3 sentence summary.",
        "detailed" => "Provide a detailed comprehensive summary covering all main points.",
        "bullet" => "Provide a bulleted list summary with the key points.",
        _ => "Provide a concise summary.",
    };

    let messages = vec![
        ("system".to_string(), format!("You are an expert summarizer. {}", style_instruction)),
        ("user".to_string(), text),
    ];

    // Call LLM
    let summary = client.chat(messages, 0.5, 2000).await?;

    // Cache
    database::save_summary(&conn, &target_id, &target_type, &request.style, &summary)?;

    Ok(summary)
}
```

**Step 4: Export from commands**

Modify: `src-tauri/src/commands/mod.rs`

```rust
mod import;
mod search;
mod index;
mod translate;

pub use import::{import_epub, import_pdf, list_documents, get_document, delete_document, get_document_sections, get_section_paragraphs};
pub use search::search;
pub use index::index_document;
pub use translate::{translate, summarize};
```

**Step 5: Register commands**

Modify: `src-tauri/src/lib.rs`

```rust
        .invoke_handler(tauri::generate_handler![
            commands::import_epub,
            commands::import_pdf,
            commands::list_documents,
            commands::get_document,
            commands::delete_document,
            commands::get_document_sections,
            commands::get_section_paragraphs,
            commands::search,
            commands::index_document,
            commands::translate,
            commands::summarize,
        ])
```

**Step 6: Verify compilation**

Run:
```bash
cd src-tauri && cargo check
```

Expected: No compilation errors

**Step 7: Commit**

Run:
```bash
git add .
git commit -m "feat: add translation and summarization commands"
```

---

### Task 7.2: Create Frontend AI Tools Panel

**Files:**
- Create: `src/components/ToolPanel.tsx`
- Create: `src/components/SearchPanel.tsx`
- Create: `src/components/SummaryPanel.tsx`

**Step 1: Update store with AI actions**

Modify: `src/store/useStore.ts`

```typescript
interface ReaderState {
  // ... existing fields

  // AI actions
  search: (query: string, topK?: number) => Promise<SearchResult[]>;
  translate: (text: string, targetLang: string) => Promise<string>;
  translateParagraph: (paragraphId: string, targetLang: string) => Promise<string>;
  summarize: (targetType: 'paragraph' | 'section' | 'document', targetId: string, style?: string) => Promise<string>;
}

export const useStore = create<ReaderState>((set, get) => ({
  // ... existing implementations

  search: async (query: string, topK: number = 10) => {
    const result = await invoke<SearchResult[]>('search', {
      options: { query, topK, docId: get().selectedDocumentId }
    });
    return result;
  },

  translate: async (text: string, targetLang: string) => {
    return invoke<string>('translate', {
      request: { text, targetLang }
    });
  },

  translateParagraph: async (paragraphId: string, targetLang: string) => {
    return invoke<string>('translate', {
      request: { paragraphId, targetLang }
    });
  },

  summarize: async (targetType: 'paragraph' | 'section' | 'document', targetId: string, style: string = 'brief') => {
    const request: any = { style };
    request[`${targetType}_id`] = targetId;
    return invoke<string>('summarize', { request });
  },
}));
```

Add TypeScript types:

Modify: `src/types/index.ts`

```typescript
export interface SearchResult {
  paragraph_id: string;
  snippet: string;
  score: number;
  location: string;
}
```

**Step 2: Create tool panel**

Create: `src/components/ToolPanel.tsx`

```typescript
import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import { SearchPanel } from './SearchPanel';
import { SummaryPanel } from './SummaryPanel';

type ToolTab = 'search' | 'summary' | 'translation';

export const ToolPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<ToolTab>('search');

  const tabs: { key: ToolTab; label: string; icon: string }[] = [
    { key: 'search', label: 'Search', icon: '🔍' },
    { key: 'summary', label: 'Summary', icon: '📝' },
    { key: 'translation', label: 'Translation', icon: '🌐' },
  ];

  return (
    <div className="w-80 bg-white border-l border-gray-200 flex flex-col">
      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-blue-50 text-blue-600 border-b-2 border-blue-600'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <span className="mr-1">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'search' && <SearchPanel />}
        {activeTab === 'summary' && <SummaryPanel />}
        {activeTab === 'translation' && (
          <div className="p-4">
            <p className="text-sm text-gray-600">Select text in the reader to translate</p>
          </div>
        )}
      </div>
    </div>
  );
};
```

**Step 3: Create search panel**

Create: `src/components/SearchPanel.tsx`

```typescript
import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import type { SearchResult } from '../types';

export const SearchPanel: React.FC = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const search = useStore((state) =>.search);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setIsLoading(true);
    try {
      const searchResults = await search(query, 10);
      setResults(searchResults);
    } catch (error) {
      console.error('Search failed:', error);
      alert('Search failed. Make sure LM Studio is running.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4">
      <div className="mb-4">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
          placeholder="Enter search query..."
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleSearch}
          disabled={isLoading || !query.trim()}
          className="w-full mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
        >
          {isLoading ? 'Searching...' : 'Search'}
        </button>
      </div>

      <div className="space-y-3">
        {results.map((result) => (
          <div
            key={result.paragraph_id}
            className="p-3 bg-gray-50 rounded-lg border border-gray-200"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">
                Score: {result.score.toFixed(3)}
              </span>
            </div>
            <p className="text-sm text-gray-700">{result.snippet}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
```

**Step 4: Create summary panel**

Create: `src/components/SummaryPanel.tsx`

```typescript
import React, { useState } from 'react';
import { useStore } from '../store/useStore';

export const SummaryPanel: React.FC = () => {
  const [style, setStyle] = useState<'brief' | 'detailed' | 'bullet'>('brief');
  const [summary, setSummary] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const currentSectionId = useStore((state) => state.currentSectionId);
  const summarize = useStore((state) => state.summarize);

  const handleSummarize = async () => {
    if (!currentSectionId) {
      alert('Please select a section first');
      return;
    }

    setIsLoading(true);
    try {
      const result = await summarize('section', currentSectionId, style);
      setSummary(result);
    } catch (error) {
      console.error('Summarization failed:', error);
      alert('Summarization failed. Make sure LM Studio is running.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4">
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Summary Style
        </label>
        <select
          value={style}
          onChange={(e) => setStyle(e.target.value as any)}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="brief">Brief</option>
          <option value="detailed">Detailed</option>
          <option value="bullet">Bullet Points</option>
        </select>
      </div>

      <button
        onClick={handleSummarize}
        disabled={isLoading}
        className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
      >
        {isLoading ? 'Generating...' : 'Generate Summary'}
      </button>

      {summary && (
        <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h3 className="font-medium text-gray-900 mb-2">Summary</h3>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{summary}</p>
        </div>
      )}
    </div>
  );
};
```

**Step 5: Update reader to include tool panel**

Modify: `src/components/Reader.tsx`

```typescript
import React, { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { TOCPanel } from './TOCPanel';
import { ReaderContent } from './ReaderContent';
import { ToolPanel } from './ToolPanel';

export const Reader: React.FC = () => {
  const { selectedDocumentId, loadSections, goBack } = useStore();

  useEffect(() => {
    if (selectedDocumentId) {
      loadSections(selectedDocumentId);
    }
  }, [selectedDocumentId, loadSections]);

  if (!selectedDocumentId) {
    return null;
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="h-14 border-b border-gray-200 flex items-center px-4">
        <button
          onClick={goBack}
          className="mr-4 p-2 hover:bg-gray-100 rounded-lg transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <h1 className="font-semibold">Reader</h1>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        <TOCPanel />
        <ReaderContent />
        <ToolPanel />
      </div>
    </div>
  );
};
```

**Step 6: Test build**

Run:
```bash
npm run dev
```

Expected: Reader shows with tool panel, can search and summarize

**Step 7: Commit**

Run:
```bash
git add .
git commit -m "feat: add AI tools panel with search and summary"
```

---

## Milestone 8: Bilingual Mode

### Task 8.1: Implement Bilingual View

**Files:**
- Create: `src/components/BilingualView.tsx`
- Create: `src-tauri/src/commands/bilingual.rs`

**Step 1: Add bilingual command**

Create: `src-tauri/src/commands/bilingual.rs`

```rust
use crate::database::{self, get_paragraph, get_translation, save_translation};
use crate::error::Result;
use crate::llm::LmStudioClient;
use crate::config;
use tauri::AppHandle;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
pub struct BilingualPair {
    pub original: String;
    pub translation: String,
    pub paragraph_id: String,
}

#[derive(Debug, Deserialize)]
pub struct BilingualRequest {
    pub section_id: String;
    pub target_lang: String,
}

#[tauri::command]
pub async fn get_bilingual_view(
    app_handle: AppHandle,
    request: BilingualRequest,
) -> Result<Vec<BilingualPair>> {
    let conn = database::get_connection(&app_handle)?;
    let config = config::load_config(&app_handle)?;
    let client = LmStudioClient::new(config)?;

    let paragraphs = database::list_paragraphs_by_section(&conn, &request.section_id)?;
    let mut result = Vec::new();

    for para in paragraphs {
        let translation = match get_translation(&conn, &para.id, &request.target_lang) {
            Ok(Some(cached)) => cached,
            _ => {
                let target_language_name = match request.target_lang.as_str() {
                    "zh" => "Chinese",
                    "en" => "English",
                    _ => &request.target_lang,
                };

                let messages = vec![
                    ("system".to_string(), format!("You are a professional translator. Translate to {}. Return only the translation.", target_language_name)),
                    ("user".to_string(), para.text.clone()),
                ];

                let translation = client.chat(messages, 0.3, 2000).await?;
                save_translation(&conn, &para.id, &request.target_lang, &translation)?;
                translation
            }
        };

        result.push(BilingualPair {
            original: para.text,
            translation,
            paragraph_id: para.id,
        });
    }

    Ok(result)
}
```

**Step 2: Export bilingual command**

Modify: `src-tauri/src/commands/mod.rs`

```rust
mod import;
mod search;
mod index;
mod translate;
mod bilingual;

pub use import::{import_epub, import_pdf, list_documents, get_document, delete_document, get_document_sections, get_section_paragraphs};
pub use search::search;
pub use index::index_document;
pub use translate::{translate, summarize};
pub use bilingual::get_bilingual_view;
```

**Step 3: Register command**

Modify: `src-tauri/src/lib.rs`

```rust
        .invoke_handler(tauri::generate_handler![
            commands::import_epub,
            commands::import_pdf,
            commands::list_documents,
            commands::get_document,
            commands::delete_document,
            commands::get_document_sections,
            commands::get_section_paragraphs,
            commands::search,
            commands::index_document,
            commands::translate,
            commands::summarize,
            commands::get_bilingual_view,
        ])
```

**Step 4: Create bilingual view component**

Create: `src/components/BilingualView.tsx`

```typescript
import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Paragraph } from '../types';

interface BilingualPair {
  original: string;
  translation: string;
  paragraph_id: string;
}

export const BilingualView: React.FC<{ sectionId: string; targetLang: string }> = ({ sectionId, targetLang }) => {
  const [pairs, setPairs] = useState<BilingualPair[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadBilingual();
  }, [sectionId, targetLang]);

  const loadBilingual = async () => {
    setIsLoading(true);
    try {
      const result = await invoke<BilingualPair[]>('get_bilingual_view', {
        request: { section_id: sectionId, target_lang: targetLang }
      });
      setPairs(result);
    } catch (error) {
      console.error('Failed to load bilingual view:', error);
      alert('Failed to load bilingual view. Make sure LM Studio is running.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Loading translations...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-8 py-6">
        <div className="grid grid-cols-2 gap-8">
          {/* Original */}
          <div>
            <h2 className="text-lg font-semibold mb-4 text-gray-900 sticky top-0 bg-white py-2">
              Original
            </h2>
            {pairs.map((pair) => (
              <div key={pair.paragraph_id} className="mb-6">
                <p className="text-gray-800 leading-relaxed">{pair.original}</p>
              </div>
            ))}
          </div>

          {/* Translation */}
          <div>
            <h2 className="text-lg font-semibold mb-4 text-gray-900 sticky top-0 bg-white py-2">
              Translation ({targetLang === 'zh' ? '中文' : 'English'})
            </h2>
            {pairs.map((pair) => (
              <div key={pair.paragraph_id} className="mb-6">
                <p className="text-gray-800 leading-relaxed">{pair.translation}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
```

**Step 5: Add bilingual mode toggle to store**

Modify: `src/store/useStore.ts`

```typescript
interface ReaderState {
  // ... existing fields
  bilingualMode: boolean;
  targetLang: string;

  // ... existing actions
  toggleBilingualMode: () => void;
  setTargetLang: (lang: string) => void;
}

export const useStore = create<ReaderState>((set, get) => ({
  // ... existing initializers
  bilingualMode: false,
  targetLang: 'zh',

  // ... existing actions

  toggleBilingualMode: () => {
    set((state) => ({ bilingualMode: !state.bilingualMode }));
  },

  setTargetLang: (lang: string) => {
    set({ targetLang: lang });
  },
}));
```

**Step 6: Update reader component**

Modify: `src/components/Reader.tsx`

```typescript
import React, { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { TOCPanel } from './TOCPanel';
import { ReaderContent } from './ReaderContent';
import { BilingualView } from './BilingualView';
import { ToolPanel } from './ToolPanel';

export const Reader: React.FC = () => {
  const { selectedDocumentId, loadSections, goBack, bilingualMode, currentSectionId, targetLang } = useStore();

  useEffect(() => {
    if (selectedDocumentId) {
      loadSections(selectedDocumentId);
    }
  }, [selectedDocumentId, loadSections]);

  if (!selectedDocumentId) {
    return null;
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* Header */}
      <div className="h-14 border-b border-gray-200 flex items-center justify-between px-4">
        <div className="flex items-center">
          <button
            onClick={goBack}
            className="mr-4 p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <h1 className="font-semibold">Reader</h1>
        </div>

        <button
          onClick={useStore((state) => state.toggleBilingualMode)}
          className={`px-4 py-2 rounded-lg transition-colors ${
            bilingualMode
              ? 'bg-blue-600 text-white'
              : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
        >
          {bilingualMode ? 'Bilingual: On' : 'Bilingual: Off'}
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        <TOCPanel />
        {bilingualMode && currentSectionId ? (
          <BilingualView sectionId={currentSectionId} targetLang={targetLang} />
        ) : (
          <ReaderContent />
        )}
        <ToolPanel />
      </div>
    </div>
  );
};
```

**Step 7: Verify compilation**

Run:
```bash
cd src-tauri && cargo check
npm run dev
```

Expected: Bilingual toggle works, shows side-by-side translations

**Step 8: Commit**

Run:
```bash
git add .
git commit -m "feat: add bilingual view mode"
```

---

## Milestone 9: MCP Host Integration

### Task 9.1: Create MCP Host Server

**Files:**
- Create: `src-tauri/src/mcp/mod.rs`
- Create: `src-tauri/src/mcp/server.rs`
- Create: `src-tauri/src/mcp/tools.rs`

**Step 1: Create MCP tools implementation**

Create: `src-tauri/src/mcp/tools.rs`

```rust
use crate::database;
use crate::error::{ReaderError, Result};
use crate::llm::LmStudioClient;
use crate::config;
use crate::search;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;

// MCP Tool Schemas (from design doc)
const TOOLS: &[(&str, &str, &str)] = &[
    ("reader.search", "Search documents using semantic search", "Search"),
    ("reader.get_section", "Get a section's content", "Read"),
    ("reader.summarize", "Summarize a document, section, or paragraph", "Analyze"),
    ("reader.translate", "Translate text or a paragraph", "Transform"),
    ("reader.bilingual_view", "Get bilingual view of a paragraph", "Read"),
    ("reader.open_location", "Open reader at a specific location", "Navigate"),
];

pub fn get_tools_list() -> Value {
    let tools: Vec<Value> = TOOLS.iter().map(|(name, desc, category)| {
        serde_json::json!({
            "name": name,
            "description": desc,
            "category": category,
        })
    }).collect();

    serde_json::json!({ "tools": tools })
}

#[derive(Deserialize)]
struct SearchArgs {
    query: String,
    #[serde(default = "default_top_k")]
    top_k: usize,
    #[serde(default)]
    scope: Option<Scope>,
}

#[derive(Deserialize)]
struct Scope {
    doc_id: Option<String>,
    section_id: Option<String>,
}

fn default_top_k() -> usize { 10 }

pub async fn handle_search(
    app_handle: &AppHandle,
    args: Value,
) -> Result<Value> {
    let args: SearchArgs = serde_json::from_value(args)
        .map_err(|e| ReaderError::InvalidArgument(format!("Invalid search args: {}", e)))?;

    let conn = database::get_connection(app_handle)?;
    let config = config::load_config(app_handle)?;
    let client = LmStudioClient::new(config)?;

    let results = search::semantic_search(
        &conn,
        &client,
        &args.query,
        args.top_k,
        args.scope.as_ref().and_then(|s| s.doc_id.as_deref()),
    ).await?;

    let results_json: Vec<Value> = results.into_iter().map(|r| {
        serde_json::json!({
            "paragraph_id": r.paragraph_id,
            "snippet": r.snippet,
            "score": r.score,
            "location": r.location,
        })
    }).collect();

    Ok(serde_json::json!({ "results": results_json }))
}

#[derive(Deserialize)]
struct GetSectionArgs {
    doc_id: String,
    section_id: String,
}

pub async fn handle_get_section(
    app_handle: &AppHandle,
    args: Value,
) -> Result<Value> {
    let args: GetSectionArgs = serde_json::from_value(args)
        .map_err(|e| ReaderError::InvalidArgument(format!("Invalid get_section args: {}", e)))?;

    let conn = database::get_connection(app_handle)?;
    let section = database::get_section(&conn, &args.section_id)?
        .ok_or_else(|| ReaderError::NotFound(format!("Section {}", args.section_id)))?;

    let paragraphs = database::list_paragraphs_by_section(&conn, &args.section_id)?;

    let paragraphs_json: Vec<Value> = paragraphs.into_iter().map(|p| {
        serde_json::json!({
            "paragraph_id": p.id,
            "text": p.text,
            "location": p.location,
        })
    }).collect();

    Ok(serde_json::json!({
        "title": section.title,
        "paragraphs": paragraphs_json,
    }))
}

#[derive(Deserialize)]
struct SummarizeArgs {
    #[serde(rename = "doc_id")]
    doc_id: Option<String>,
    #[serde(rename = "section_id")]
    section_id: Option<String>,
    #[serde(rename = "paragraph_id")]
    paragraph_id: Option<String>,
    #[serde(default = "default_summary_style")]
    style: String,
}

fn default_summary_style() -> String { "brief".to_string() }

pub async fn handle_summarize(
    app_handle: &AppHandle,
    args: Value,
) -> Result<Value> {
    let args: SummarizeArgs = serde_json::from_value(args)
        .map_err(|e| ReaderError::InvalidArgument(format!("Invalid summarize args: {}", e)))?;

    // Implementation similar to the summarize command
    // For brevity, return error in this stub
    Err(ReaderError::Internal("Summarize not implemented in MCP yet".to_string()))
}

#[derive(Deserialize)]
struct TranslateArgs {
    text: Option<String>,
    #[serde(rename = "paragraph_id")]
    paragraph_id: Option<String>,
    #[serde(rename = "target_lang")]
    target_lang: String,
}

pub async fn handle_translate(
    app_handle: &AppHandle,
    args: Value,
) -> Result<Value> {
    let args: TranslateArgs = serde_json::from_value(args)
        .map_err(|e| ReaderError::InvalidArgument(format!("Invalid translate args: {}", e)))?;

    // Implementation similar to the translate command
    // For brevity, return error in this stub
    Err(ReaderError::Internal("Translate not implemented in MCP yet".to_string()))
}

#[derive(Deserialize)]
struct BilingualViewArgs {
    #[serde(rename = "paragraph_id")]
    paragraph_id: String,
}

pub async fn handle_bilingual_view(
    app_handle: &AppHandle,
    args: Value,
) -> Result<Value> {
    let args: BilingualViewArgs = serde_json::from_value(args)
        .map_err(|e| ReaderError::InvalidArgument(format!("Invalid bilingual_view args: {}", e)))?;

    // Implementation similar to get_bilingual_view
    // For brevity, return error in this stub
    Err(ReaderError::Internal("Bilingual view not implemented in MCP yet".to_string()))
}

#[derive(Deserialize)]
struct OpenLocationArgs {
    #[serde(rename = "doc_id")]
    doc_id: String,
    location: String,
}

pub async fn handle_open_location(
    _app_handle: &AppHandle,
    args: Value,
) -> Result<Value> {
    let _args: OpenLocationArgs = serde_json::from_value(args)
        .map_err(|e| ReaderError::InvalidArgument(format!("Invalid open_location args: {}", e)))?;

    // TODO: Implement jumping to location in UI
    Ok(serde_json::json!({ "ok": true }))
}

pub async fn handle_tool_call(
    app_handle: &AppHandle,
    tool_name: &str,
    arguments: Value,
) -> Result<Value> {
    match tool_name {
        "reader.search" => handle_search(app_handle, arguments).await,
        "reader.get_section" => handle_get_section(app_handle, arguments).await,
        "reader.summarize" => handle_summarize(app_handle, arguments).await,
        "reader.translate" => handle_translate(app_handle, arguments).await,
        "reader.bilingual_view" => handle_bilingual_view(app_handle, arguments).await,
        "reader.open_location" => handle_open_location(app_handle, arguments).await,
        _ => Err(ReaderError::InvalidArgument(format!("Unknown tool: {}", tool_name))),
    }
}
```

**Step 2: Create MCP server stub**

Create: `src-tauri/src/mcp/server.rs`

```rust
use crate::error::Result;
use crate::mcp::tools::{get_tools_list, handle_tool_call};
use serde_json::Value;
use tauri::{AppHandle, Manager};

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
        let method = request.get("method")
            .and_then(|m| m.as_str())
            .ok_or_else(|| crate::error::ReaderError::InvalidArgument("Missing method".to_string()))?;

        match method {
            "initialize" => self.handle_initialize(request).await,
            "tools/list" => Ok(get_tools_list()),
            "tools/call" => self.handle_tool_call(request).await,
            "ping" => Ok(serde_json::json!({})),
            _ => Err(crate::error::ReaderError::InvalidArgument(format!("Unknown method: {}", method))),
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
        let params = request.get("params")
            .ok_or_else(|| crate::error::ReaderError::InvalidArgument("Missing params".to_string()))?;

        let tool_name = params.get("name")
            .and_then(|n| n.as_str())
            .ok_or_else(|| crate::error::ReaderError::InvalidArgument("Missing tool name".to_string()))?;

        let arguments = params.get("arguments")
            .cloned()
            .unwrap_or(serde_json::json!({}));

        handle_tool_call(&self.app_handle, tool_name, arguments).await
    }
}
```

**Step 3: Create MCP module**

Create: `src-tauri/src/mcp/mod.rs`

```rust
mod server;
mod tools;

pub use server::McpServer;
```

**Step 4: Update lib.rs**

Modify: `src-tauri/src/lib.rs`

```rust
mod error;
mod logger;
mod database;
mod models;
mod parsers;
mod commands;
mod config;
mod llm;
mod search;
mod mcp;

pub use error::{ReaderError, Result};
```

**Step 5: Add MCP command for external clients**

Modify: `src-tauri/src/commands/mcp.rs`

```rust
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
```

**Step 6: Update commands**

Modify: `src-tauri/src/commands/mod.rs`

```rust
mod import;
mod search;
mod index;
mod translate;
mod bilingual;
mod mcp;

pub use import::{import_epub, import_pdf, list_documents, get_document, delete_document, get_document_sections, get_section_paragraphs};
pub use search::search;
pub use index::index_document;
pub use translate::{translate, summarize};
pub use bilingual::get_bilingual_view;
pub use mcp::{mcp_request, McpState};
```

**Step 7: Register MCP command and state**

Modify: `src-tauri/src/lib.rs`

```rust
        .setup(|app| {
            logger::init_logging();
            database::init_db(app.handle())?;
            app.manage(commands::McpState::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::import_epub,
            commands::import_pdf,
            commands::list_documents,
            commands::get_document,
            commands::delete_document,
            commands::get_document_sections,
            commands::get_section_paragraphs,
            commands::search,
            commands::index_document,
            commands::translate,
            commands::summarize,
            commands::get_bilingual_view,
            commands::mcp_request,
        ])
```

**Step 8: Verify compilation**

Run:
```bash
cd src-tauri && cargo check
```

Expected: No compilation errors

**Step 9: Commit**

Run:
```bash
git add .
git commit -m "feat: add MCP host server implementation"
```

---

## Milestone 10: Settings and Configuration UI

### Task 10.1: Create Settings Component

**Files:**
- Create: `src/components/Settings.tsx`
- Create: `src-tauri/src/commands/settings.rs`

**Step 1: Add settings commands**

Create: `src-tauri/src/commands/settings.rs`

```rust
use crate::config::{Config, load_config, save_config};
use crate::error::Result;
use tauri::AppHandle;

#[tauri::command]
pub async fn get_config(app_handle: AppHandle) -> Result<Config> {
    let config = load_config(&app_handle)?;
    Ok(config)
}

#[tauri::command]
pub async fn update_config(app_handle: AppHandle, config: Config) -> Result<()> {
    save_config(&app_handle, &config)?;
    Ok(())
}
```

**Step 2: Export settings**

Modify: `src-tauri/src/commands/mod.rs`

```rust
mod import;
mod search;
mod index;
mod translate;
mod bilingual;
mod mcp;
mod settings;

pub use import::{import_epub, import_pdf, list_documents, get_document, delete_document, get_document_sections, get_section_paragraphs};
pub use search::search;
pub use index::index_document;
pub use translate::{translate, summarize};
pub use bilingual::get_bilingual_view;
pub use mcp::{mcp_request, McpState};
pub use settings::{get_config, update_config};
```

**Step 3: Register commands**

Modify: `src-tauri/src/lib.rs`

```rust
        .invoke_handler(tauri::generate_handler![
            commands::import_epub,
            commands::import_pdf,
            commands::list_documents,
            commands::get_document,
            commands::delete_document,
            commands::get_document_sections,
            commands::get_section_paragraphs,
            commands::search,
            commands::index_document,
            commands::translate,
            commands::summarize,
            commands::get_bilingual_view,
            commands::mcp_request,
            commands::get_config,
            commands::update_config,
        ])
```

**Step 4: Create settings component**

Create: `src/components/Settings.tsx`

```typescript
import React, { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface Config {
  lm_studio_url: string;
  embedding_model: string;
  chat_model: string;
}

export const Settings: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [config, setConfig] = useState<Config>({
    lm_studio_url: 'http://localhost:1234/v1',
    embedding_model: 'text-embedding-ada-002',
    chat_model: 'local-model',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setIsLoading(true);
    try {
      const loadedConfig = await invoke<Config>('get_config');
      setConfig(loadedConfig);
    } catch (error) {
      console.error('Failed to load config:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await invoke('update_config', { config });
      alert('Settings saved successfully');
      onClose();
    } catch (error) {
      console.error('Failed to save config:', error);
      alert('Failed to save settings');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-8 py-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Settings</h1>

      <div className="space-y-6">
        {/* LM Studio Configuration */}
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold mb-4">LM Studio Configuration</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                API URL
              </label>
              <input
                type="text"
                value={config.lm_studio_url}
                onChange={(e) => setConfig({ ...config, lm_studio_url: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Default: http://localhost:1234/v1
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Embedding Model
              </label>
              <input
                type="text"
                value={config.embedding_model}
                onChange={(e) => setConfig({ ...config, embedding_model: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Chat Model
              </label>
              <input
                type="text"
                value={config.chat_model}
                onChange={(e) => setConfig({ ...config, chat_model: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
          >
            {isSaving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
};
```

**Step 5: Add settings to store**

Modify: `src/store/useStore.ts`

```typescript
interface ReaderState {
  // ... existing fields
  showSettings: boolean;

  // ... existing actions
  openSettings: () => void;
  closeSettings: () => void;
}

export const useStore = create<ReaderState>((set, get) => ({
  // ... existing initializers
  showSettings: false,

  // ... existing actions

  openSettings: () => set({ showSettings: true }),
  closeSettings: () => set({ showSettings: false }),
}));
```

**Step 6: Update App to show settings**

Modify: `src/App.tsx`

```typescript
import { Library } from './components/Library';
import { Reader } from './components/Reader';
import { Settings } from './components/Settings';
import { useStore } from './store/useStore';

function App() {
  const { selectedDocumentId, showSettings, closeSettings } = useStore();

  if (showSettings) {
    return (
      <div className="h-screen w-screen bg-gray-50">
        <Settings onClose={closeSettings} />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-gray-50">
      {selectedDocumentId ? <Reader /> : <Library />}
    </div>
  );
}

export default App;
```

**Step 7: Add settings button to library**

Modify: `src/components/Library.tsx`

```typescript
// Add to header
<div className="flex items-center justify-between">
  <h1 className="text-2xl font-bold text-gray-900">Library</h1>
  <div className="flex gap-2">
    <button
      onClick={() => useStore.getState().openSettings()}
      className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
    >
      Settings
    </button>
    <button
      onClick={handleImport}
      disabled={isLoading}
      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
    >
      {isLoading ? 'Importing...' : 'Import Document'}
    </button>
  </div>
</div>
```

**Step 8: Test build**

Run:
```bash
npm run dev
```

Expected: Settings page works, can save config

**Step 9: Commit**

Run:
```bash
git add .
git commit -m "feat: add settings configuration UI"
```

---

## Final Steps

### Task 11.1: Final Testing and Polish

**Files:**
- Test all features end-to-end
- Fix any bugs found
- Add error handling

**Step 1: Test complete workflow**

Test:
1. Import EPUB
2. Import PDF
3. Navigate TOC
4. Search (requires LM Studio running)
5. Summarize section
6. Translate paragraph
7. Toggle bilingual mode
8. Update settings

**Step 2: Test with LM Studio**

Run LM Studio:
```bash
# Start LM Studio with a model
# Ensure it's listening on http://localhost:1234/v1
```

**Step 3: Verify MCP tools**

Create test script `test_mcp.js`:

```javascript
const testMcp = async () => {
  const response = await invoke('mcp_request', {
    request: {
      method: 'tools/list',
      params: {}
    }
  });
  console.log('MCP Tools:', response);
};
```

**Step 4: Performance checks**

- Import 1MB EPUB should be < 5s
- Search should return < 1s
- Translation per paragraph < 2s

**Step 5: Documentation**

Create `README.md`:

```markdown
# Reader - MCP-Enabled Local Reading App

A local-first EPUB/PDF reader with AI features powered by LM Studio.

## Features

- Import EPUB and PDF files
- Semantic search using embeddings
- AI-powered summarization
- Translation (Chinese/English)
- Bilingual side-by-side reading
- MCP tools for Claude Code integration

## Setup

1. Install LM Studio and load a model
2. Ensure LM Studio API is running on http://localhost:1234/v1
3. Build and run the Reader app

## Usage

- Import documents from the Library view
- Navigate using the table of contents
- Use the tool panel for search, summary, and translation
- Toggle bilingual mode for side-by-side translations

## MCP Integration

The app exposes MCP tools for Claude Code:
- reader.search
- reader.get_section
- reader.summarize
- reader.translate
- reader.bilingual_view
- reader.open_location
```

**Step 6: Final commit**

Run:
```bash
git add .
git commit -m "feat: complete MVP with all core features"
```

**Step 7: Tag release**

Run:
```bash
git tag -a v0.1.0 -m "Initial MVP release"
```

---

## Summary

This plan implements a complete MCP-enabled local reader with:

✅ **Milestone 0-1**: Project setup, database schema
✅ **Milestone 2-3**: EPUB and PDF parsing
✅ **Milestone 4-5**: Frontend library and reader views
✅ **Milestone 6**: LM Studio integration and vector search
✅ **Milestone 7**: Translation and summarization
✅ **Milestone 8**: Bilingual reading mode
✅ **Milestone 9**: MCP Host for external tool integration
✅ **Milestone 10-11**: Settings, testing, polish

**Total estimated implementation:** ~60 small tasks following TDD and frequent commits
