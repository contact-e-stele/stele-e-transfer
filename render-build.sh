#!/bin/bash
set -e

# Install Chromium for Puppeteer on Render
echo "Installing Chromium..."
apt-get update -qq && apt-get install -y -qq \
  chromium \
  chromium-sandbox \
  --no-install-recommends 2>/dev/null || \
apt-get install -y -qq chromium-browser --no-install-recommends 2>/dev/null || \
echo "Chromium install skipped (may already exist)"

# Install dependencies and build
echo "Installing bun dependencies..."
bun install

echo "Building..."
bun run build

echo "Build complete!"
