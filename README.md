# 🎬 TeleBhaja — Self-Hosted Personal OTT Platform

A production-grade, self-hosted OTT streaming platform that reads directly from your external hard drive and serves a Netflix-style dark UI across all devices on your local network.

---

## 🌟 Key Features

- **🎬 Netflix-Style Streaming Experience**:
  - Full-screen HTML5 video player with keyboard controls, touch gesture skipping (double-tap ±10s), and screen orientation locking on mobile.
  - Generous thumbnail grid spacing across all mobile, tablet, and desktop display sizes.
  - HTTP 206 Partial Content byte-range streaming for instant seeking.
  - Automatic on-the-fly subtitle conversion (SRT → WebVTT) with sub-second latency.
  - Resume playback prompt with periodic heartbeat progress saving.
- **🗂️ Content Control & Categorization Portal**:
  - Web-based content management portal accessible via the top navigation bar (`🗂️ Content Portal`).
  - Interactive folder and file tree explorer with expand/collapse and tri-state checkboxes.
  - **Folder Level Categorization**: Tag entire folders as **Series** (with seasons/episodes) or **Franchises** (with chronological movie collections), or apply Animated and Language tags to whole folders.
  - Granular inclusion/exclusion controls: choose exactly which files or folders are exposed to the OTT library.
  - Persistent settings in SQLite (`path_controls` table) that survive restarts, reboots, and rescans.
  - Metadata & categorization drawer to manually override Title, Year, Animated tag, Languages, and Franchises.
  - Pruned scanner traversal: excluded folders are skipped entirely during rescans for blazing fast performance.
- **🔍 Intelligent Search & Heuristic Parser**:
  - Multi-token fuzzy search across titles, release years, overviews, franchises, and episode file paths.
  - Advanced heuristic parsing engine for complex release group naming (`Year`, `Resolution`, `Codec`, `Audio tags`).
  - Automatic TMDb metadata enrichment for movie posters, backdrops, ratings, and plot summaries.
- **📱 Responsive & LAN Ready**:
  - Designed for mobile phones, tablets, smart TVs, and desktop browsers.
  - Zero-configuration LAN access: stream on any phone or tablet on the same Wi-Fi.

---

## 🚀 Quick Start

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 20+ | [nodejs.org](https://nodejs.org) |
| FFmpeg | Any | Required for transcoding; optional for MP4 direct play |
| npm | 8+ | Bundled with Node.js |

### 1. Configure

```bash
cp .env.example .env
# Edit .env and set MEDIA_STORAGE_PATH to your drive
# e.g. MEDIA_STORAGE_PATH=E:\Movies   (Windows)
#      MEDIA_STORAGE_PATH=/mnt/media   (Linux)
```

### 2. Start

**Windows:**
```cmd
# Automatic launcher (interactively prompts if path not found):
run.bat

# Or pass your media folder path directly:
run.bat "E:\Movies"

# Or run in development mode with hot-reload:
run.bat --dev "E:\Movies"
```

**Linux / macOS:**
```bash
chmod +x run.sh && ./run.sh
```

**Development (hot-reload):**
```bash
npm install
# Terminal 1 — backend
npm run dev
# Terminal 2 — Vite frontend dev server
npm run dev:client
```

The UI opens at `http://localhost:3000`. Devices on the same Wi-Fi can access via `http://<YOUR_LAN_IP>:3000`.

---

## 🗂️ Content Control & Categorization Portal

TeleBhaja features a dedicated **Content Control Portal** directly accessible from the header navigation bar (`🗂️ Content Portal`), giving you complete manual authority over your media collection:

- **Multi-Drive Architecture & Separate Drive Panels**:
  - Configure multiple drives simultaneously using semicolon-delimited paths: e.g. `MEDIA_STORAGE_PATH=E:\Media;F:\Movies;D:\Videos`.
  - Automatically organizes content into dedicated, switchable Drive Panels on the Home page (`[💾 Primary (E:)]`, `[💾 Drive F:]`, etc.).
  - **Dual View Modes on Secondary Drives**: Secondary drive panels offer an instant toggle between:
    - **🎬 OTT View**: full posters, shelves, category pills, and responsive grids.
    - **📁 Folder Structure View**: browsable directory tree browser with interactive breadcrumbs, subfolders, file sizes, format tags, and 1-click playback.
- **Variable Playback Speed Streaming**:
  - Full-featured video player includes instant playback rate controls (`0.5x`, `0.75x`, `1.0x (Normal)`, `1.25x`, `1.5x`, `1.75x`, `2.0x`).
- **Folder Level Categorization (Series & Franchise)**:
  - Click **"🏷️ Categorize"** on any folder in the tree to assign the entire folder:
    - **🎭 Franchise Collection**: groups all movies in this folder under a named Franchise (e.g. "Harry Potter", "Marvel Cinematic Universe") and auto-creates franchise cards in the OTT view.
    - **📺 TV Series**: converts all video files in the folder into episodes of a TV Series (e.g. "Crime Drama", "Mystery Anthology") with full season and episode drawers.
    - **🎬 Movie Collection**: marks all videos inside as standalone films.
    - **✨ Animated & Language Inheritance**: marks all content in the folder as animated or assigns audio languages.
    - **One-click cascading**: automatically applies to all existing and future media files inside the folder across rescans.
- **Interactive File Structure Tree**:
  - Full hierarchical folder and file explorer mirroring your storage drive.
  - Expand/collapse directories with tri-state checkboxes (checked = all included, unchecked = all excluded, dash = partially excluded).
  - Folder-level and individual file switches to easily include or exclude content from the OTT streaming view.
- **Persistent Settings (Survives Restarts & Rescans)**:
  - All inclusion/exclusion choices and categorization overrides are stored in SQLite (`path_controls` table).
  - Exclusions survive application restarts and background rescans (`COALESCE(media_items.is_excluded, excluded.is_excluded)`).
  - Excluded folders are pruned during filesystem scans for high-speed scanning performance.
- **Automatic Pruning of Missing Files**:
  - When media files are deleted or moved from your storage drive, running a scan automatically purges missing records, empty seasons, series, and franchises from the library.
- **Manual Metadata & Categorization Overrides**:
  - Click **"Edit"** on any media item to customize Title, Release Year, Animated Tag, Languages, and Franchise Assignment.
- **Search, Filter & Quick Actions**:
  - Live text search across raw file paths and parsed media titles.
  - Filter view by status (`All items`, `Included only`, `Excluded only`).
  - `Expand All` / `Collapse All` buttons and a 1-click `Reset All Exclusions` option.

---

## 📁 Recommended Drive Layout

The scanner works with **any folder structure**, but this layout gives the best auto-categorization:

```
E:\Media\
│
├── English\
│   ├── Movies\
│   │   ├── Action Movie (2020)\
│   │   │   └── Action.Movie.2020.1080p.BluRay.mkv
│   │   └── SciFi.Feature.2019.1080p.WEB-DL.mp4
│   │
│   └── Series\
│       ├── Mystery Show\
│       │   ├── Season 1\
│       │   │   ├── Mystery.Show.S01E01.Pilot.mkv
│       │   │   └── Mystery.Show.S01E02.mkv
│       │   └── Season 2\
│       │       └── Mystery.Show.S02E01.mkv
│       └── Drama.Series.S01E01.1080p.mp4
│
├── Hindi\
│   ├── Comedy Drama (2009).mkv
│   └── Action Blockbuster (2022) [Hindi].mp4
│
├── Bengali\
│   └── Classic Feature (1955).mkv
│
├── Animation\
│   ├── Studio Collection\
│   │   ├── Animated Journey (2001).mkv
│   │   └── Forest Spirit (1988).mkv
│   └── Studio Two\
│       └── WALL-E (2008).mp4
│
└── Franchises\
    ├── Harry Potter\
    │   ├── Harry Potter and the Philosophers Stone (2001).mkv
    │   ├── Harry Potter and the Chamber of Secrets (2002).mkv
    │   └── ...
    └── Marvel Cinematic Universe\
        ├── Iron Man (2008).mkv
        ├── The Avengers (2012).mkv
        └── ...
```

### File Naming Conventions

| Type | Example |
|---|---|
| Movie | `Title (Year).ext` or `Title.Year.Quality.ext` |
| Series | `Show.Name.S01E02.ext` or `Show S01E02 Title.ext` |
| Language tag | `Movie [Hindi].mkv` or `Movie.Bengali.mkv` |
| Multi-audio | `Movie [Dual Audio].mkv` |

---

## 🏗️ Architecture

```
telebhaja/
├── src/
│   ├── server/
│   │   ├── index.ts              ← Express server entry point
│   │   ├── config.ts             ← Environment config
│   │   ├── db/
│   │   │   └── database.ts       ← SQLite schema + path_controls table
│   │   ├── scanner/
│   │   │   ├── parser.ts         ← Title/season/language/franchise heuristic parser
│   │   │   ├── ffprobe.ts        ← FFprobe wrapper
│   │   │   ├── tmdb.ts           ← TMDb API enrichment client
│   │   │   ├── scanner.ts        ← Main scanner engine with pruned traversal
│   │   │   └── cli.ts            ← CLI scanner script
│   │   ├── streaming/
│   │   │   ├── streaming.ts      ← HTTP 206 byte-range service + exclusion guard
│   │   │   └── transcoding.ts    ← FFmpeg pipe transcode service
│   │   └── routes/
│   │       ├── library.ts        ← /api/library endpoints (filtered by exclusions)
│   │       ├── stream.ts         ← /api/stream endpoints
│   │       ├── progress.ts       ← /api/progress endpoints
│   │       ├── scan.ts           ← /api/scan + /api/franchises
│   │       └── control.ts        ← /api/control (Tree, toggle, folder categorizations)
│   │
│   ├── client/
│   │   ├── App.tsx               ← Root component + stream/portal tabs
│   │   ├── main.tsx              ← React entry point
│   │   ├── index.html            ← HTML shell
│   │   ├── styles/globals.css    ← Global CSS + Tailwind + thumbnail spacing
│   │   ├── lib/api.ts            ← API client (library, stream, control)
│   │   ├── hooks/useMedia.ts     ← React hooks
│   │   ├── components/
│   │   │   ├── Player.tsx        ← Full-featured video player
│   │   │   ├── MoviePlayerModal.tsx
│   │   │   ├── SeriesDrawer.tsx  ← Series/season/episode picker
│   │   │   ├── FranchiseDrawer.tsx
│   │   │   └── MediaCard.tsx     ← Responsive cards with clean gap spacing
│   │   └── pages/
│   │       ├── Home.tsx          ← Main OTT streaming library view
│   │       ├── Portal.tsx        ← Content Control & Categorization Portal
│   │       └── Settings.tsx      ← Scan + settings
│   │
│   └── shared/
│       └── types.ts              ← Shared TypeScript types
│
├── test/
│   ├── parser.test.ts            ← Heuristic parser tests (20 tests)
│   └── integration.test.ts       ← End-to-end integration tests (74 tests)
│
├── docker-compose.yml
├── run.bat / run.sh
├── .env.example
├── vite.config.ts
├── tailwind.config.js
└── package.json
```

---

## 🎮 API Reference

### Library
| Endpoint | Description |
|---|---|
| `GET /api/library?category=movie&language=hi` | Filtered OTT library (excludes hidden files) |
| `GET /api/library/movies/:id` | Movie detail with franchise info |
| `GET /api/library/series/:id` | Full series with seasons/episodes |
| `GET /api/categories` | Media category summaries |

### Content Control Portal
| Endpoint | Description |
|---|---|
| `GET /api/control/tree` | Full directory tree with media stats and exclusion states |
| `POST /api/control/toggle` | Toggle inclusion/exclusion for a file or entire directory |
| `PUT /api/control/folder` | Categorize folder as Series, Franchise, or Movie collection |
| `GET /api/control/franchises` | List of all franchises for autocomplete |
| `PUT /api/control/media/:type/:id` | Manually override Title, Year, Animated flag, Languages, Franchise |
| `POST /api/control/reset` | Reset all exclusions back to included |

### Streaming
| Endpoint | Description |
|---|---|
| `GET /api/stream/movie/:id` | HTTP 206 byte-range movie stream (404 if excluded) |
| `GET /api/stream/episode/:id` | HTTP 206 byte-range episode stream (404 if excluded) |
| `GET /api/stream/movie/:id?transcode=1` | Force FFmpeg transcode to fMP4 |
| `GET /api/stream/thumbnail/movie/:id` | Video thumbnail JPEG |
| `GET /api/stream/subtitle?path=...` | External subtitle (SRT→VTT) |

### Progress
| Endpoint | Description |
|---|---|
| `GET /api/progress/movie/:id` | Get resume position |
| `POST /api/progress/movie/:id` | Save position `{positionSeconds, durationSeconds}` |
| `GET /api/progress/recent/all` | Continue Watching list |

### Control & System
| Endpoint | Description |
|---|---|
| `POST /api/scan/start` | Trigger library scan |
| `GET /api/scan/status` | Current scan status |
| `GET /api/franchises` | All franchise collections |
| `GET /api/franchises/:id` | Franchise with ordered film list |
| `GET /api/health` | Server health check |

---

## 🧪 Testing & Verification

TeleBhaja includes 94 automated unit and end-to-end integration tests:

```bash
# Run full test suite (parser heuristics + full integration pipeline)
npm test

# Run TypeScript typecheck
npm run typecheck

# Build client and server bundles
npm run build
```

```text
Results: 20 parser tests passed, 74 integration tests passed (94 total passing, 0 failed).
```

---

## 📱 Mobile Features

- **Double-tap left edge** → Skip back 10 seconds
- **Double-tap right edge** → Skip forward 10 seconds
- **Single tap** → Toggle play/pause
- **Fullscreen** → Locks to landscape via Screen Orientation API
- **Resume prompt** → Appears for content watched >30 seconds previously
- **Progress heartbeat** → Auto-saves position every 5 seconds

---

## 🐳 Docker Deployment

```bash
# Set your media path
export MEDIA_STORAGE_PATH="E:\Media"

# Start
docker compose up -d

# Logs
docker compose logs -f

# Stop
docker compose down
```

For GPU acceleration (Linux), uncomment the `/dev/dri` device in `docker-compose.yml`.

---

## 🔧 Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MEDIA_STORAGE_PATH` | `E:\Media` | Media drive path(s) (supports multiple drives with `;` e.g. `E:\Media;F:\Movies`) |
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Bind address (0.0.0.0 = all interfaces) |
| `TMDB_API_KEY` | *(empty)* | Optional — enables poster art & metadata |
| `DB_PATH` | `./data/telebhaja.db` | SQLite database location |
| `SCAN_ON_STARTUP` | `true` | Auto-scan media on server start |
| `TRANSCODE_VIDEO_BITRATE` | `2000` | Video bitrate (kbps) for transcode |
| `TRANSCODE_AUDIO_BITRATE` | `128` | Audio bitrate (kbps) for transcode |
| `FFMPEG_PATH` | *(system PATH)* | Custom FFmpeg binary path |
