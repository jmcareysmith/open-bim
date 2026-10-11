# Open-BIM

An open-source, ground-up BIM authoring application in the spirit of Revit.
Desktop app built with Tauri 2, TypeScript and three.js.

**Status:** Phase 0 — foundations. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Getting started

Prerequisites: Node.js 20+, Rust (rustup), and on Windows the Visual Studio C++ Build Tools
(WebView2 ships with Windows 11).

```bash
npm install
npm test            # core + geometry tests
npm run dev         # run the UI in a browser
npm run tauri dev   # run the desktop app
```

## Docs
- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [Revit feature map](docs/REVIT_FEATURE_MAP.md)

## Licence
MIT
