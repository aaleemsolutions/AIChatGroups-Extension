const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Create PNG buffer from RGBA pixel data
function createPng(width, height, getPixel) {
  // PNG signature: 89 50 4E 47 0D 0A 1A 0A
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk: width(4), height(4), bitDepth(1)=8, colorType(1)=6 (RGBA), compMethod(1)=0, filterMethod(1)=0, interlace(1)=0
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bits per channel
  ihdrData[9] = 6; // RGBA
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdrChunk = createChunk('IHDR', ihdrData);

  // Scanlines with filter byte 0 (None)
  const rowBytes = width * 4;
  const rawData = Buffer.alloc(height * (rowBytes + 1));
  let offset = 0;

  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y, width, height);
      rawData[offset++] = Math.min(255, Math.max(0, Math.round(r)));
      rawData[offset++] = Math.min(255, Math.max(0, Math.round(g)));
      rawData[offset++] = Math.min(255, Math.max(0, Math.round(b)));
      rawData[offset++] = Math.min(255, Math.max(0, Math.round(a)));
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// CRC32 table
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(8 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = chunk.subarray(4, 8 + len);
  chunk.writeUInt32BE(crc32(typeAndData), 8 + len);
  return chunk;
}

// Draw a modern Gemini sparkle + folder icon
function getFolderPixel(x, y, w, h) {
  const nx = x / w;
  const ny = y / h;

  // Background rounded rect
  const rx = 0.16;
  const inBox = (nx >= 0.05 && nx <= 0.95 && ny >= 0.05 && ny <= 0.95);
  
  // Distance to rounded corner
  const dx = Math.max(0, Math.max(0.05 + rx - nx, nx - (0.95 - rx)));
  const dy = Math.max(0, Math.max(0.05 + rx - ny, ny - (0.95 - rx)));
  const distCorner = Math.sqrt(dx * dx + dy * dy);
  if (distCorner > rx) {
    return [0, 0, 0, 0]; // Transparent outside rounded squircle
  }

  // Gradient background: Dark slate to deep indigo / Gemini purple (#181c24 -> #1e1b4b)
  let bgR = 24 + nx * 20;
  let bgG = 28 + ny * 15;
  let bgB = 48 + (nx + ny) * 35;

  // Folder geometry
  // Tab: nx from 0.18 to 0.46, ny from 0.22 to 0.35
  const inTab = (nx >= 0.20 && nx <= 0.46 && ny >= 0.22 && ny <= 0.35);
  // Folder back body: nx 0.20 to 0.80, ny 0.30 to 0.78
  const inBack = (nx >= 0.20 && nx <= 0.80 && ny >= 0.30 && ny <= 0.78);
  // Folder front flap: nx 0.20 to 0.80, ny 0.42 to 0.78
  const inFront = (nx >= 0.18 && nx <= 0.82 && ny >= 0.42 && ny <= 0.78);

  // Sparkle center (Gemini 4-point star in upper right of folder)
  const sx = 0.68, sy = 0.34;
  const sDistX = Math.abs(nx - sx);
  const sDistY = Math.abs(ny - sy);
  const sparkle = Math.max(0, 1 - Math.pow(sDistX * 14, 0.75) - Math.pow(sDistY * 14, 0.75));

  if (sparkle > 0.1) {
    // Gemini Cyan/Blue Sparkle
    const spIntensity = Math.min(1, sparkle * 1.5);
    return [
      Math.round(90 + spIntensity * 165),
      Math.round(180 + spIntensity * 75),
      255,
      255
    ];
  }

  if (inFront) {
    // Glowing gradient: Gemini Blue to Purple (#38bdf8 to #818cf8)
    const t = (nx - 0.18) / 0.64;
    const r = 56 + t * 90;
    const g = 140 - t * 20;
    const b = 248 - t * 10;
    return [r, g, b, 255];
  } else if (inTab || inBack) {
    // Folder back / tab (darker indigo/blue)
    return [40, 75, 155, 255];
  }

  // Border glow
  const borderDist = Math.min(nx - 0.05, 0.95 - nx, ny - 0.05, 0.95 - ny);
  if (borderDist < 0.04) {
    return [60, 90, 160, 200];
  }

  return [bgR, bgG, bgB, 255];
}

// Generate icons
const iconSizes = [16, 48, 128];
const iconsDir = path.join(__dirname, '..', 'icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

for (const size of iconSizes) {
  const pngBuffer = createPng(size, size, getFolderPixel);
  const filePath = path.join(iconsDir, `icon-${size}.png`);
  fs.writeFileSync(filePath, pngBuffer);
  console.log(`Generated ${filePath} (${pngBuffer.length} bytes)`);
}

// Also write SVG for web/retina use
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#111827"/>
      <stop offset="100%" stop-color="#1e1b4b"/>
    </linearGradient>
    <linearGradient id="folder" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#818cf8"/>
    </linearGradient>
    <linearGradient id="tab" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e40af"/>
      <stop offset="100%" stop-color="#3730a3"/>
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="3" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>
  </defs>
  <rect x="6" y="6" width="116" height="116" rx="26" fill="url(#bg)" stroke="#3b82f6" stroke-width="2" stroke-opacity="0.4"/>
  <path d="M26 38 C26 34 29 30 33 30 L52 30 C56 30 58 34 61 38 L65 42 L95 42 C99 42 102 45 102 49 L102 90 C102 94 99 98 95 98 L33 98 C29 98 26 94 26 90 Z" fill="url(#tab)"/>
  <path d="M22 52 C22 47 26 44 31 44 L97 44 C102 44 106 47 106 52 L106 92 C106 97 102 101 97 101 L31 101 C26 101 22 97 22 92 Z" fill="url(#folder)" filter="url(#glow)"/>
  <!-- Gemini Sparkle -->
  <path d="M88 28 Q88 38 98 38 Q88 38 88 48 Q88 38 78 38 Q88 38 88 28 Z" fill="#67e8f9"/>
  <circle cx="88" cy="38" r="2" fill="#ffffff"/>
</svg>`;

fs.writeFileSync(path.join(iconsDir, 'icon.svg'), svgContent);
console.log('Generated icons/icon.svg');
