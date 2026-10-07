// Renders src/logo.svg to assets/icon.png and a multi-size assets/icon.ico.
// Run with: npm run icons
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'src', 'logo.svg'), 'utf8');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

// ICO with embedded PNG images (supported since Windows Vista).
function buildIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.buf)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('about:blank');
  const render = (size) => win.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = c.height = ${size};
        c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size});
        resolve(c.toDataURL('image/png').split(',')[1]);
      };
      img.onerror = reject;
      img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
    })`);

  const outDir = path.join(root, 'assets');
  fs.mkdirSync(outDir, { recursive: true });
  const pngs = [];
  for (const size of SIZES) pngs.push({ size, buf: Buffer.from(await render(size), 'base64') });
  fs.writeFileSync(path.join(outDir, 'icon.png'), Buffer.from(await render(512), 'base64'));
  fs.writeFileSync(path.join(outDir, 'icon.ico'), buildIco(pngs));
  console.log('Wrote assets/icon.png and assets/icon.ico');
  app.quit();
});
