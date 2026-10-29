#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# TeleBhaja — Native startup script for Linux / macOS
# Usage: bash run.sh [media_path]
# ─────────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load .env if present
if [ -f .env ]; then
  set -o allexport
  source .env
  set +o allexport
fi

# Override media path from argument
if [ -n "$1" ]; then
  export MEDIA_STORAGE_PATH="$1"
fi

# Defaults
export PORT="${PORT:-3000}"
export HOST="${HOST:-0.0.0.0}"
export NODE_ENV="${NODE_ENV:-production}"
export MEDIA_STORAGE_PATH="${MEDIA_STORAGE_PATH:-/mnt/media}"
export DB_PATH="${DB_PATH:-./data/telebhaja.db}"
export SCAN_ON_STARTUP="${SCAN_ON_STARTUP:-true}"

echo "╔══════════════════════════════════════════════════════╗"
echo "║           🎬  TeleBhaja OTT Platform                ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  Media Path : $MEDIA_STORAGE_PATH"
echo "║  Port       : $PORT"
echo "╚══════════════════════════════════════════════════════╝"

# Check Node
if ! command -v node &>/dev/null; then
  echo "❌ Node.js not found. Install Node.js 20+ from https://nodejs.org"
  exit 1
fi

NODE_VER=$(node -e 'console.log(process.versions.node.split(".")[0])')
if [ "$NODE_VER" -lt 20 ]; then
  echo "❌ Node.js 20+ required (found $NODE_VER)"
  exit 1
fi

# Check FFmpeg
if ! command -v ffmpeg &>/dev/null; then
  echo "⚠️  FFmpeg not found. Transcoding will be unavailable."
  echo "   Install: sudo apt install ffmpeg  OR  brew install ffmpeg"
fi

# Install dependencies
if [ ! -d node_modules ]; then
  echo "📦 Installing dependencies..."
  npm install
fi

# Build application
if [ ! -f dist/server/index.js ] || [ ! -d dist/public ]; then
  echo "🔨 Building application..."
  npm run build
fi

# Get local IP
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo ""
echo "🚀 Starting TeleBhaja at http://$LOCAL_IP:$PORT"
echo "   Open on your phone: http://$LOCAL_IP:$PORT"
echo "   Press Ctrl+C to stop"
echo ""

# Run in production mode
node dist/server/index.js
