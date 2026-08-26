// scripts/print-qr.js
// Saves a scannable PNG QR code for the URL passed as argv[2], used by
// present.ps1 to give the professor's phone a code to scan for the exp+https
// dev-server link. A terminal-rendered ASCII QR code doesn't scan reliably
// off a screen (font rendering and glare break the scanner's grid), so this
// writes a real image instead.

const qrcode = require('qrcode');
const path = require('path');

const url = process.argv[2];
if (!url) {
  console.error('Usage: node print-qr.js <url>');
  process.exit(1);
}

const outPath = path.join(__dirname, '..', 'present-qr.png');

qrcode.toFile(outPath, url, { width: 640, margin: 2 }, (err) => {
  if (err) {
    console.error('Failed to write QR code:', err.message);
    process.exit(1);
  }
  console.log(outPath);
});
