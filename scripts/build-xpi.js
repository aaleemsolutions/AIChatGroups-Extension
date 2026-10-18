/**
 * Packages the Gemini Chat Folders extension into a clean .zip and .xpi for Firefox
 * Uses AdmZip to ensure strictly POSIX compliant forward-slash paths (required by Mozilla AMO).
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const bundleDir = path.join(distDir, 'extension-files');

console.log('📦 Packaging AI Chat Folders for Firefox (AMO Compliant)...');

// Clean and recreate dist directory
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(bundleDir, { recursive: true });

// Copy essential extension files
const filesToCopy = [
  'manifest.json',
  'background.js',
  'storage-sync.js',
  'content.js',
  'content.css'
];

for (const file of filesToCopy) {
  const src = path.join(rootDir, file);
  const dest = path.join(bundleDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`  Added: ${file}`);
  }
}

// Copy directories
const dirsToCopy = ['icons', 'popup'];
for (const dir of dirsToCopy) {
  const srcDir = path.join(rootDir, dir);
  const destDir = path.join(bundleDir, dir);
  if (fs.existsSync(srcDir)) {
    copyRecursiveSync(srcDir, destDir);
    console.log(`  Added directory: ${dir}/`);
  }
}

function copyRecursiveSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyRecursiveSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Create ZIP & XPI using AdmZip (guarantees POSIX '/' paths for Mozilla AMO)
const zipPath = path.join(distDir, 'gemini-chat-folders.zip');
const xpiPath = path.join(distDir, 'gemini-chat-folders.xpi');

try {
  const zip = new AdmZip();

  // Add individual root files
  for (const file of filesToCopy) {
    const filePath = path.join(bundleDir, file);
    if (fs.existsSync(filePath)) {
      zip.addLocalFile(filePath, '');
    }
  }

  // Add folders with forward-slash paths
  zip.addLocalFolder(path.join(bundleDir, 'icons'), 'icons');
  zip.addLocalFolder(path.join(bundleDir, 'popup'), 'popup');

  // Ensure all entry paths use forward slashes strictly
  zip.getEntries().forEach(entry => {
    entry.entryName = entry.entryName.replace(/\\/g, '/');
  });

  zip.writeZip(zipPath);
  console.log(`\n✅ Generated Firefox ZIP package: ${zipPath}`);

  // Create .xpi copy for direct Firefox installation
  fs.copyFileSync(zipPath, xpiPath);
  console.log(`✅ Generated Firefox XPI package: ${xpiPath}`);

  // ==========================================
  // Generate Chrome Package & Unpacked Folder
  // ==========================================
  const chromeDistDir = path.join(distDir, 'chrome');
  const chromeUnpackedDir = path.join(chromeDistDir, 'unpacked');
  fs.mkdirSync(chromeUnpackedDir, { recursive: true });

  copyRecursiveSync(bundleDir, chromeUnpackedDir);

  // Update manifest for Chrome MV3 service worker
  const chromeManifestPath = path.join(chromeUnpackedDir, 'manifest.json');
  const chromeManifest = JSON.parse(fs.readFileSync(chromeManifestPath, 'utf8'));
  chromeManifest.background = {
    service_worker: 'background.js'
  };
  delete chromeManifest.browser_specific_settings;
  fs.writeFileSync(chromeManifestPath, JSON.stringify(chromeManifest, null, 2), 'utf8');

  // Zip for Chrome Web Store
  const chromeZipPath = path.join(chromeDistDir, 'gemini-chat-folders-chrome.zip');
  const chromeZip = new AdmZip();
  for (const file of filesToCopy) {
    const fPath = path.join(chromeUnpackedDir, file);
    if (fs.existsSync(fPath)) chromeZip.addLocalFile(fPath, '');
  }
  chromeZip.addLocalFolder(path.join(chromeUnpackedDir, 'icons'), 'icons');
  chromeZip.addLocalFolder(path.join(chromeUnpackedDir, 'popup'), 'popup');
  chromeZip.getEntries().forEach(entry => {
    entry.entryName = entry.entryName.replace(/\\/g, '/');
  });
  chromeZip.writeZip(chromeZipPath);
  console.log(`✅ Generated Chrome ZIP package: ${chromeZipPath}`);
  console.log(`✅ Generated Chrome Unpacked folder: ${chromeUnpackedDir}`);

  // Print entries verification
  console.log('\n🔍 Verifying Firefox ZIP Archive Entries for AMO Compliance:');
  const verifyZip = new AdmZip(zipPath);
  verifyZip.getEntries().forEach(entry => {
    console.log(`  ✓ ${entry.entryName}`);
  });
} catch (err) {
  console.error('Failed to create archive:', err);
  process.exit(1);
}

console.log('\n🎉 Dual-browser packaging complete! Ready for both Firefox AMO and Chrome Web Store.');
