# Reader

<div align="center">
  <h3>📚 Local-first EPUB Reader with AI-Powered Features</h3>
  <p>Built with Tauri 2 + React, focused on offline reading, semantic search, summarization, translation, and bilingual mode.</p>
</div>

## ✨ Features

### 📖 Core Reading Experience
- **Library Management**: Import and organize EPUB, PDF, and Markdown documents
- **Advanced Reader**: Table of Contents navigation, section/paragraph-based reading
- **Semantic Search**: AI-powered search across all indexed paragraphs
- **PDF Support**: Full PDF parsing and reading capabilities
- **Markdown Support**: Import and read Markdown files with syntax highlighting
- **Text-to-Speech (TTS)**: Audiobook functionality with multiple voice options

### 🤖 AI-Powered Tools (Flexible AI Provider Support)
- **Summarization**: Organize and summarize content with configurable styles
  - Target scope: Full document / Current section / Current paragraph
  - Styles: Brief (1-2 sentences), Detailed (multi-paragraph), Bullet points
  - Smart caching to avoid redundant generations
- **Translation**: Translate content to Chinese or English
- **Bilingual Mode**: Side-by-side original and translated text view
- **Text-to-Speech (TTS)**: Audiobook functionality with multiple voice options
  - Supports multiple TTS engines
  - Adjustable playback speed
  - Voice selection
  - Text highlighting while reading
- **MCP Integration**: Model Context Protocol host server for external AI assistants
- **Multiple AI Providers**:
  - **LM Studio**: Run AI completely locally for maximum privacy
  - **OpenAI**: Use cloud-based AI for convenience without local models
  - Easy switching between providers in settings

### 🔒 Privacy & Flexibility
- **Local-First Option**: All AI features can run locally using LM Studio
- **Cloud Option**: Use OpenAI API when local resources are limited
- **Your Choice**: Switch between local and cloud AI anytime
- **No Forced Cloud**: Data never leaves your device when using LM Studio
- **Offline Capable**: Works without internet when using local AI

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
2. Select EPUB, PDF, or Markdown files from your computer
3. Documents are automatically indexed for semantic search

**Supported Formats:**
- **EPUB**: Standard e-book format
- **PDF**: Portable Document Format
- **Markdown**: Lightweight markup language (`.md`, `.markdown`)

### Reading & Navigation

- **Table of Contents**: Use the TOC panel to navigate between chapters/sections
- **Search**: Use the Search panel to find content semantically (not just keyword matching)
- **Pin Locations**: Double-click locations in the TOC to pin them for quick access
- **Text-to-Speech**: Use the Audiobook panel to listen to content
  - Click the **Audiobook** tab in the right sidebar
  - Select your preferred voice and playback speed
  - Click **Play** to start listening
  - Text is highlighted as it's being read

### AI Features Setup

Reader supports two AI providers - choose based on your needs:

#### Option 1: LM Studio (Local, Privacy-First)

**Best for**: Maximum privacy, offline usage, no API costs

1. **Install LM Studio**: Download from [lmstudio.ai](https://lmstudio.ai)
2. **Start a Local Server**: In LM Studio, start a local inference server (default: `http://localhost:1234/v1`)
3. **Load a Model**: Download and load a suitable model (recommended: Llama 3.1, Qwen 2.5, or similar)
4. **Configure Reader**:
   - Open Settings (⚙️)
   - Select "LM Studio (Local)" as AI Provider
   - Enter LM Studio URL: `http://localhost:1234/v1`
   - Set model names for embeddings and chat
5. **Use AI Tools**: Open the Summary or Translate panels in Reader

#### Option 2: OpenAI (Cloud, Convenient)

**Best for**: Better performance, no local hardware requirements, quick setup

1. **Get an API Key**:
   - For OpenAI: Visit [platform.openai.com/api-keys](https://platform.openai.com/api-keys) to get your API key
   - For other OpenAI-compatible services: Obtain API key from your provider
2. **Configure Reader**:
   - Open Settings (⚙️)
   - Select "OpenAI (Cloud)" as AI Provider
   - Enter your API Key (usually starts with `sk-`)
   - Customize API Endpoint (optional): For OpenAI-compatible services like Azure OpenAI or third-party APIs
   - Set model names:
     - Embeddings: `text-embedding-3-small` (OpenAI recommended), or compatible model name from your provider
     - Chat: `gpt-4o`, `gpt-4-turbo`, `gpt-3.5-turbo`, or compatible chat model from your provider
3. **Save and Use**: All AI features will now use the configured OpenAI-compatible service

#### Switching Between Providers

You can switch between LM Studio and OpenAI anytime in Settings without losing data or configuration.

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

## 🤖 AI Provider Comparison

| Feature | LM Studio (Local) | OpenAI (Cloud) |
|---------|------------------|----------------|
| **Privacy** | ✅ 100% local, data never leaves device | ⚠️ Data sent to OpenAI servers |
| **Cost** | ✅ Free (after model download) | 💰 Pay-per-use API fees |
| **Speed** | ⚠️ Depends on hardware | ✅ Fast, cloud-optimized |
| **Quality** | ⚠️ Varies by model | ✅ State-of-the-art models |
| **Offline** | ✅ Works without internet | ❌ Requires internet |
| **Setup** | ⚠️ Requires model download | ✅ Quick API key setup |
| **Hardware** | 💻 Needs capable computer | 🌐 Any device |
| **Embedding Models** | text-embedding-ada-002 (compatible) | text-embedding-3-small, text-embedding-3-large, text-embedding-ada-002 |
| **Chat Models** | Llama 3.1, Qwen 2.5, Mistral, etc. | gpt-4o, gpt-4-turbo, gpt-3.5-turbo |

### Recommended Use Cases

**Choose LM Studio when you:**
- Need maximum privacy and data security
- Want to avoid API costs
- Have a powerful computer
- Prefer offline usage
- Work with sensitive documents

**Choose OpenAI when you:**
- Want the best AI quality
- Have limited hardware resources
- Need faster processing
- Don't mind paying for API usage
- Want quick setup without downloading models

### Configuration Examples

**LM Studio Configuration:**
```json
{
  "provider": "lmstudio",
  "lm_studio_url": "http://localhost:1234/v1",
  "embedding_model": "text-embedding-ada-002",
  "chat_model": "local-model"
}
```

**OpenAI Configuration:**
```json
{
  "provider": "openai",
  "lm_studio_url": "http://localhost:1234/v1",
  "embedding_model": "text-embedding-3-small",
  "chat_model": "gpt-4o",
  "openai_api_key": "sk-your-api-key-here",
  "openai_base_url": "https://api.openai.com/v1"
}
```

> 💡 **Tip**: You can switch between providers anytime in Settings. Your embeddings and cached translations/summaries remain intact!

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
