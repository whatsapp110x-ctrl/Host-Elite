#!/bin/bash
set -e

echo "🔧 Installing dependencies..."
npm ci

echo "🏗️ Building frontend with Vite..."
npx vite build --config vite.config.ts

echo "📦 Bundling backend with esbuild..."
npx esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist

echo "✅ Build completed successfully!"
