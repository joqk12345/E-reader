# Reader

<div align="center">
  <h3>📚 Local-first EPUB Reader with AI-Powered Features</h3>
  <p>Built with Tauri 2 + React, focused on offline reading, semantic search, summarization, translation, and bilingual mode.</p>
</div>

## ✨ Features

### 📖 Core Reading Experience
- **Library Management**: Import and organize EPUB documents
- **Advanced Reader**: Table of Contents navigation, section/paragraph-based reading
- **Semantic Search**: AI-powered search across all indexed paragraphs
- **PDF Support**: Full PDF parsing and reading capabilities

### 🤖 AI-Powered Tools (Local-Only, Privacy-First)
- **Summarization**: Organize and summarize content with configurable styles
  - Target scope: Full document / Current section / Current paragraph
  - Styles: Brief (1-2 sentences), Detailed (multi-paragraph), Bullet points
  - Smart caching to avoid redundant generations
- **Translation**: Translate content to Chinese or English
- **Bilingual Mode**: Side-by-side original and translated text view
- **MCP Integration**: Model Context Protocol host server for external AI assistants

### 🔒 Privacy & Offline
- **Local-First**: All AI features run locally using LM Studio
- **No Cloud Dependencies**: Your data never leaves your device
- **Offline Capable**: Works without internet connection

## 📸 Screenshots

*(Coming soon - add screenshots of the application interface)*

## 🚀 Installation

### Download Pre-built Binaries

Grab the latest release for your platform from the [Releases](https://github.com/joqk12345/E-reader/releases) page.

- **macOS** (Intel & Apple Silicon): `.dmg` installer
- **Linux**: `.deb` package or `.AppImage`
- **Windows**: `.msi` or `.exe` installer

### Build from Source

#### Prerequisites

- **Node.js** 22+
- **Rust** (latest stable)
- **System dependencies** (Linux only):
  ```bash
  sudo apt-get install libgtk-3-dev libwebkit2gtk-4.0-dev libappindicator3-dev librsvg2-dev patchelf
  ```

#### Build Steps

```bash
# Clone the repository
git clone https://github.com/joqk12345/E-reader.git
cd E-reader

# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

The built application will be in `src-tauri/target/release/bundle/`.

## 🎯 Usage

### Importing Documents

1. Click the **Import** button in the library
2. Select EPUB or PDF files from your computer
3. Documents are automatically indexed for semantic search

### Reading & Navigation

- **Table of Contents**: Use the TOC panel to navigate between chapters/sections
- **Search**: Use the Search panel to find content semantically (not just keyword matching)
- **Pin Locations**: Double-click locations in the TOC to pin them for quick access

### AI Features Setup

To use AI features (summarization, translation, bilingual view):

1. **Install LM Studio**: Download from [lmstudio.ai](https://lmstudio.ai)
2. **Start a Local Server**: In LM Studio, start a local inference server (default: `http://localhost:1234/v1`)
3. **Load a Model**: Download and load a suitable model (recommended: Llama 3.1, Qwen 2.5, or similar)
4. **Use AI Tools**: Open the Summary or Translate panels in Reader

### Summarization

整理文章即"内容摘要/结构化整理"，用于快速把文章重点提炼成可读的概要。

**Entry Point**: Right sidebar `Summary` panel
**Scopes**:
- Full Document: Comprehensive overview
- Current Section: Chapter-level summary
- Current Paragraph: Quick context

**Styles**:
- `brief`: 1-2 sentence overview
- `detailed`: Multi-paragraph comprehensive summary
- `bullet`: Key points as a list

**Usage Steps**:
1. Open an EPUB/PDF in the reader
2. (Optional) Select a specific section or paragraph
3. Open the `Summary` panel
4. Choose your preferred style and scope
5. Click **Generate Summary**
6. Results are cached - regenerate to refresh

### Translation & Bilingual View

- **Translation Panel**: Translate selected text or current paragraph
- **Bilingual View**: Side-by-side display of original and translated text
- **Languages**: Support for Chinese ↔ English
- **Caching**: Translations are cached per paragraph for efficiency

## 🔧 Development

### Project Structure

```
reader/
├── src/                    # Frontend (React + TypeScript)
│   ├── components/         # React components
│   ├── store/             # Zustand state management
│   └── ...
├── src-tauri/             # Backend (Rust)
│   ├── src/
│   │   ├── commands/      # Tauri commands
│   │   ├── database/      # SQLite database & embeddings
│   │   ├── parsers/       # EPUB/PDF parsers
│   │   ├── search/        # Semantic search
│   │   └── mcp/           # MCP server implementation
│   └── ...
├── .github/workflows/     # CI/CD configurations
└── scripts/               # Utility scripts
```

### Running Tests

```bash
# Frontend type checking
npm run build

# Backend tests
cd src-tauri
cargo test

# Linting
cargo clippy
cargo fmt --check
```

### Building Releases

See [RELEASE.md](./RELEASE.md) for detailed release instructions.

Quick version:

```bash
# Use the release script
./scripts/release.sh 0.2.0

# Or manually
git tag v0.2.0
git push origin v0.2.0
```

GitHub Actions will automatically build binaries for all platforms.

## 🛠️ Technology Stack

**Frontend**:
- React 18 with TypeScript
- Vite for fast development
- TailwindCSS for styling
- Zustand for state management
- React Router for navigation

**Backend**:
- Rust with Tauri 2
- SQLite for data persistence
- Serde for serialization
- Tokio for async runtime

**AI/ML**:
- Local inference via LM Studio
- Semantic search with embeddings
- OpenAI-compatible API interface

## 📝 License

[Your License Here]

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📧 Contact

[Your Contact Information]

## 🙏 Acknowledgments

- Tauri team for the amazing framework
- LM Studio for local AI capabilities
- All contributors to the open-source ecosystem
