#!/usr/bin/env node
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const VERSION = '0.5.6';
const BASE_URL = `https://github.com/Rikorose/DeepFilterNet/releases/download/v${VERSION}`;

const PLATFORM_ASSETS = {
  'win32-x64':    `deep-filter-${VERSION}-x86_64-pc-windows-msvc.exe`,
  'darwin-x64':   `deep-filter-${VERSION}-x86_64-apple-darwin`,
  'darwin-arm64':  `deep-filter-${VERSION}-aarch64-apple-darwin`,
  'linux-x64':    `deep-filter-${VERSION}-x86_64-unknown-linux-musl`,
  'linux-arm64':  `deep-filter-${VERSION}-aarch64-unknown-linux-gnu`,
};

const key = `${os.platform()}-${os.arch()}`;
const asset = PLATFORM_ASSETS[key];

if (!asset) {
  console.warn(`[deep-filter-static] No pre-built binary for ${key}, skipping download.`);
  process.exit(0);
}

const binName = os.platform() === 'win32' ? 'deep-filter.exe' : 'deep-filter';
const binPath = path.join(__dirname, binName);

// Skip if binary already exists and matches expected version.
if (fs.existsSync(binPath)) {
  console.log(`[deep-filter-static] Binary already exists at ${binPath}, skipping.`);
  process.exit(0);
}

const url = `${BASE_URL}/${asset}`;
console.log(`[deep-filter-static] Downloading ${url} ...`);

function download(reqUrl, dest, redirects) {
  if (redirects > 5) {
    console.error('[deep-filter-static] Too many redirects');
    process.exit(1);
  }

  https.get(reqUrl, { headers: { 'User-Agent': 'deep-filter-static' } }, (res) => {
    // Follow redirects (GitHub releases redirect to CDN)
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      download(res.headers.location, dest, redirects + 1);
      return;
    }

    if (res.statusCode !== 200) {
      console.error(`[deep-filter-static] Download failed: HTTP ${res.statusCode}`);
      process.exit(1);
    }

    const total = parseInt(res.headers['content-length'] || '0', 10);
    let downloaded = 0;
    let lastPct = -1;

    const file = fs.createWriteStream(dest);
    res.on('data', (chunk) => {
      downloaded += chunk.length;
      if (total > 0) {
        const pct = Math.round((downloaded / total) * 100);
        if (pct !== lastPct && pct % 10 === 0) {
          lastPct = pct;
          console.log(`[deep-filter-static] ${pct}%`);
        }
      }
    });
    res.pipe(file);

    file.on('finish', () => {
      file.close();
      // Make executable on macOS/Linux
      if (os.platform() !== 'win32') {
        fs.chmodSync(dest, 0o755);
      }
      console.log(`[deep-filter-static] Installed to ${dest}`);
    });

    file.on('error', (err) => {
      fs.unlinkSync(dest);
      console.error(`[deep-filter-static] Write error: ${err.message}`);
      process.exit(1);
    });
  }).on('error', (err) => {
    console.error(`[deep-filter-static] Download error: ${err.message}`);
    process.exit(1);
  });
}

download(url, binPath, 0);
