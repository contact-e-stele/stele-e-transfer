#!/bin/bash
set -e

echo "Installing dependencies..."
bun install

echo "Downloading Chrome for Puppeteer..."
npx puppeteer browsers install chrome

echo "Building..."
bun run build

echo "Done!"
