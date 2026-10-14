const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const defaults = require('./lib/defaults');
const {
  createProject, findExisting, highestJobNumber, typeDir, validateLocation, validateName, validateRelPath,
} = require('./lib/createProject');
const { scanUnnumbered, convertProjects, undoConversion } = require('./lib/organise');

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

const PALETTE = ['#3b6fe0', '#7c5cd6', '#e0603a', '#d99a1e', '#179e7e', '#d6457e', '#4c9a2a', '#5f6b7a'];

// Mica needs Windows 11 22H2 (build 22621) or later.
const useMica = process.platform === 'win32' && Number(os.release().split('.')[2]) >= 22621;

function loadSettings() {
  let settings;
  try {
    settings = { ...structuredClone(defaults), ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch {
    return structuredClone(defaults);
  }
  // Fill in fields that older settings files don't have.
  settings.jobNumbers = { ...defaults.jobNumbers, ...settings.jobNumbers };
  settings.projectTypes.forEach((t, i) => {
    const d = defaults.projectTypes.find((x) => x.id === t.id);
    t.color ||= d?.color || PALETTE[i % PALETTE.length];
    t.icon ||= d?.icon || 'folder';
    t.numbered ??= true;
    t.templates ??= [];
  });
  settings.recent = (settings.recent || []).filter((r) => fs.existsSync(r.path));
  return settings;
}

function writeSettings(settings) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  return settings;
}

function validateSettings(s) {
  const j = s.jobNumbers;
  if (j.prefix && validateName(j.prefix)) throw new Error(`Job number prefix: ${validateName(j.prefix)}`);
  if (!Number.isInteger(j.digits) || j.digits < 1 || j.digits > 6) throw new Error('Digits must be between 1 and 6.');
  if (!Number.isInteger(j.next) || j.next < 1) throw new Error('Next number must be a whole number of 1 or more.');
  for (const t of s.projectTypes) {
    if (!t.name || !t.name.trim()) throw new Error('Every project type needs a name.');
    const locErr = validateLocation(t.location || '');
    if (locErr) throw new Error(`${t.name}: ${locErr}`);
    for (const sub of t.subfolders) {
      const err = validateRelPath(sub, `"${sub}"`);
      if (err) throw new Error(`${t.name}: ${err}`);
    }
    for (const tpl of t.templates) {
      const err = validateRelPath(tpl.dest, 'Template destination');
      if (err) throw new Error(`${t.name}: ${err}`);
    }
  }
}

// Only user-editable fields are taken from the renderer; recent and undo state stay here.
function saveSettings(patch) {
  const s = loadSettings();
  for (const key of ['basePath', 'openAfterCreate', 'projectTypes']) if (key in patch) s[key] = patch[key];
  if (patch.jobNumbers) {
    const { prefix, digits, next } = patch.jobNumbers;
    s.jobNumbers = { prefix, digits, next };
  }
  validateSettings(s);
  return writeSettings(s);
}

// Never reuse a number, even if the counter was set lower than what's on disk.
const nextJobNumber = (s) => Math.max(s.jobNumbers.next, highestJobNumber(s.basePath, s.projectTypes, s.jobNumbers) + 1);

const overlayColors = () => ({
  color: useMica ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#212228' : '#ffffff',
  symbolColor: nativeTheme.shouldUseDarkColors ? '#ececf0' : '#1c1d22',
  height: 44,
});

function createWindow() {
  const win = new BrowserWindow({
    width: 860,
    height: 640,
    minWidth: 560,
    minHeight: 520,
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    title: 'Auto Folder Creator',
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayColors(),
    ...(useMica
      ? { backgroundMaterial: 'mica', backgroundColor: '#00000000' }
      : { backgroundColor: nativeTheme.shouldUseDarkColors ? '#17181c' : '#f4f5f8' }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'), { query: { mica: useMica ? '1' : '0' } });
  win.once('ready-to-show', () => win.show());
  nativeTheme.on('updated', () => !win.isDestroyed() && win.setTitleBarOverlay(overlayColors()));
}

ipcMain.handle('settings:get', () => loadSettings());
ipcMain.handle('settings:save', (_e, patch) => saveSettings(patch));
ipcMain.handle('settings:reset', () => saveSettings({ projectTypes: structuredClone(defaults.projectTypes) }));

ipcMain.handle('dialog:pickFolder', async (e) => {
  const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Choose your projects folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});

ipcMain.handle('dialog:pickFiles', async (e) => {
  const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Choose template files',
    properties: ['openFile', 'multiSelections'],
  });
  return res.canceled ? [] : res.filePaths;
});

// Live check while typing: is there already a project with this name, and what number comes next?
ipcMain.handle('project:check', (_e, { typeId, name }) => {
  const s = loadSettings();
  const type = s.projectTypes.find((t) => t.id === typeId);
  if (!type || !s.basePath) return { existing: null, nextNumber: null };
  return {
    existing: findExisting(typeDir(s.basePath, type), name || '', s.jobNumbers),
    nextNumber: type.numbered ? nextJobNumber(s) : null,
  };
});

ipcMain.handle('project:create', async (_e, { typeId, projectName }) => {
  const s = loadSettings();
  const projectType = s.projectTypes.find((t) => t.id === typeId);
  if (!projectType) throw new Error('Unknown project type.');
  const jobNumber = projectType.numbered && s.basePath ? nextJobNumber(s) : null;
  const result = await createProject({ basePath: s.basePath, projectType, projectName, jobNumber, jobCfg: s.jobNumbers });

  if (result.usedNumber != null) s.jobNumbers.next = result.usedNumber + 1;
  s.recent = [
    { name: result.folderName, typeId, path: result.projectPath, at: Date.now() },
    ...s.recent.filter((r) => r.path !== result.projectPath),
  ].slice(0, 5);
  writeSettings(s);

  if (s.openAfterCreate) shell.openPath(result.projectPath);
  return result;
});

ipcMain.handle('organise:scan', () => {
  const s = loadSettings();
  if (!s.basePath) return { items: [], startNumber: 1, canUndo: false };
  return {
    items: scanUnnumbered(s.basePath, s.projectTypes, s.jobNumbers),
    startNumber: nextJobNumber(s),
    canUndo: !!s.lastConversion,
  };
});

ipcMain.handle('organise:convert', async (_e, items) => {
  const s = loadSettings();
  const start = nextJobNumber(s);
  const numbers = items.map((i) => i.number);
  if (new Set(numbers).size !== numbers.length || numbers.some((n) => !Number.isInteger(n) || n < start)) {
    throw new Error('Job numbers changed since the list was loaded. Refresh and try again.');
  }
  const results = await convertProjects(items, s.projectTypes, s.jobNumbers);
  const ok = results.filter((r) => r.ok);
  if (ok.length) {
    s.lastConversion = { at: Date.now(), prevNext: s.jobNumbers.next, results: ok };
    s.jobNumbers.next = Math.max(s.jobNumbers.next, ...ok.map((r) => r.number + 1));
    // Keep recent entries pointing at renamed folders.
    for (const r of ok) for (const rec of s.recent) if (rec.path === r.from) { rec.path = r.to; rec.name = path.basename(r.to); }
    writeSettings(s);
  }
  return results;
});

ipcMain.handle('organise:undo', () => {
  const s = loadSettings();
  if (!s.lastConversion) throw new Error('Nothing to undo.');
  const res = undoConversion(s.lastConversion.results);
  for (const r of s.lastConversion.results) for (const rec of s.recent) if (rec.path === r.to) { rec.path = r.from; rec.name = path.basename(r.from); }
  // Hand the numbers back, unless projects created since then already use higher ones.
  s.jobNumbers.next = Math.max(s.lastConversion.prevNext, highestJobNumber(s.basePath, s.projectTypes, s.jobNumbers) + 1);
  s.lastConversion = null;
  writeSettings(s);
  return res;
});

ipcMain.handle('shell:open', (_e, p) => shell.openPath(p));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
