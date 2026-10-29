# 🎬 TeleBhaja — Self-Hosted Personal OTT Platform

A production-grade, self-hosted OTT streaming platform that reads directly from your external hard drive and serves a Netflix-style dark UI across all devices on your local network.

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
run.bat
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

## 📁 Recommended Drive Layout

The scanner works with **any folder structure**, but this layout gives the best auto-categorization:

```
E:\Media\
│
├── English\
│   ├── Movies\
│   │   ├── The Dark Knight (2008)\
│   │   │   └── The.Dark.Knight.2008.1080p.BluRay.mkv
│   │   └── Avengers.Endgame.2019.1080p.WEB-DL.mp4
│   │
│   └── Series\
│       ├── Breaking Bad\
│       │   ├── Season 1\
│       │   │   ├── Breaking.Bad.S01E01.Pilot.mkv
│       │   │   └── Breaking.Bad.S01E02.mkv
│       │   └── Season 2\
│       │       └── Breaking.Bad.S02E01.mkv
│       └── The.Office.S03E01.1080p.mp4
│
├── Hindi\
│   ├── 3 Idiots (2009).mkv
│   └── KGF Chapter 2 (2022) [Hindi].mp4
│
├── Bengali\
│   └── Pather Panchali (1955).mkv
│
├── Animation\
│   ├── Studio Ghibli\
│   │   ├── Spirited Away (2001).mkv
│   │   └── My Neighbor Totoro (1988).mkv
│   └── Pixar\
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
│   │   │   └── database.ts       ← SQLite schema + init
│   │   ├── scanner/
│   │   │   ├── parser.ts         ← Title/season/language/franchise parser
│   │   │   ├── ffprobe.ts        ← FFprobe wrapper
│   │   │   ├── tmdb.ts           ← TMDb API enrichment client
│   │   │   ├── scanner.ts        ← Main scanner engine
│   │   │   └── cli.ts            ← CLI scanner script
│   │   ├── streaming/
│   │   │   ├── streaming.ts      ← HTTP 206 byte-range service
│   │   │   └── transcoding.ts    ← FFmpeg pipe transcode service
│   │   └── routes/
│   │       ├── library.ts        ← /api/library endpoints
│   │       ├── stream.ts         ← /api/stream endpoints
│   │       ├── progress.ts       ← /api/progress endpoints
│   │       └── scan.ts           ← /api/scan + /api/franchises
│   │
│   ├── client/
│   │   ├── App.tsx               ← Root component
│   │   ├── main.tsx              ← React entry point
│   │   ├── index.html            ← HTML shell
│   │   ├── styles/globals.css    ← Global CSS + Tailwind
│   │   ├── lib/api.ts            ← API client
│   │   ├── hooks/useMedia.ts     ← React hooks
│   │   ├── components/
│   │   │   ├── Player.tsx        ← Full-featured video player
│   │   │   ├── MoviePlayerModal.tsx
│   │   │   ├── SeriesDrawer.tsx  ← Series/season/episode picker
│   │   │   ├── FranchiseDrawer.tsx
│   │   │   └── MediaCard.tsx     ← Movie/Series/Franchise cards
│   │   └── pages/
│   │       ├── Home.tsx          ← Main library view
│   │       └── Settings.tsx      ← Scan + settings
│   │
│   └── shared/
│       └── types.ts              ← Shared TypeScript types
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
| `GET /api/library?category=movie&language=hi` | Filtered library |
| `GET /api/library/movies/:id` | Movie detail |
| `GET /api/library/series/:id` | Full series with seasons/episodes |

### Streaming
| Endpoint | Description |
|---|---|
| `GET /api/stream/movie/:id` | HTTP 206 byte-range movie stream |
| `GET /api/stream/episode/:id` | HTTP 206 byte-range episode stream |
| `GET /api/stream/movie/:id?transcode=1` | Force FFmpeg transcode to fMP4 |
| `GET /api/stream/thumbnail/movie/:id` | Video thumbnail JPEG |
| `GET /api/stream/subtitle?path=...` | External subtitle (SRT→VTT) |

### Progress
| Endpoint | Description |
|---|---|
| `GET /api/progress/movie/:id` | Get resume position |
| `POST /api/progress/movie/:id` | Save position `{positionSeconds, durationSeconds}` |
| `GET /api/progress/recent/all` | Continue Watching list |

### Control
| Endpoint | Description |
|---|---|
| `POST /api/scan/start` | Trigger library scan |
| `GET /api/scan/status` | Current scan status |
| `GET /api/franchises` | All franchise collections |
| `GET /api/franchises/:id` | Franchise with ordered film list |
| `GET /api/health` | Server health check |

---

## 🧪 CLI Testing

```bash
# Verify byte-range streaming
curl -I -H "Range: bytes=0-1024" http://localhost:3000/api/stream/movie/1

# Expected response:
# HTTP/1.1 206 Partial Content
# Content-Range: bytes 0-1024/TOTAL_SIZE
# Accept-Ranges: bytes
# Content-Type: video/mp4

# Test seek in range
curl -I -H "Range: bytes=5242880-10485759" http://localhost:3000/api/stream/movie/1

# Test health
curl http://localhost:3000/api/health | jq

# Test library
curl "http://localhost:3000/api/library?category=movie&language=hi" | jq '.movies | length'

# Trigger scan
curl -X POST http://localhost:3000/api/scan/start
curl http://localhost:3000/api/scan/status | jq '.progress'

# Save watch progress
curl -X POST http://localhost:3000/api/progress/movie/1 \
  -H "Content-Type: application/json" \
  -d '{"positionSeconds": 1800, "durationSeconds": 7200}'
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
| `MEDIA_STORAGE_PATH` | `E:\Media` | Root of your media drive |
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Bind address (0.0.0.0 = all interfaces) |
| `TMDB_API_KEY` | *(empty)* | Optional — enables poster art & metadata |
| `DB_PATH` | `./data/telebhaja.db` | SQLite database location |
| `SCAN_ON_STARTUP` | `true` | Auto-scan media on server start |
| `TRANSCODE_VIDEO_BITRATE` | `2000` | Video bitrate (kbps) for transcode |
| `TRANSCODE_AUDIO_BITRATE` | `128` | Audio bitrate (kbps) for transcode |
| `FFMPEG_PATH` | *(system PATH)* | Custom FFmpeg binary path |
