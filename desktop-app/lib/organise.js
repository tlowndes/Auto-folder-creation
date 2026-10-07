// Finds existing project folders without a job number, and numbers them.
// Only the project folder itself is renamed; files inside are never touched.
const fs = require('fs');
const path = require('path');
const { formatJobNumber, parseJobNumber } = require('./jobNumber');
const { ensureStructure, listDirs, missingStructure, typeDir } = require('./createProject');

// Synced folders (e.g. Proton Drive) can get a fresh "created" date on each PC,
// so use the earliest date on the folder or anything directly inside it.
function oldestTime(dir) {
  const times = [];
  const add = (p) => {
    try {
      const st = fs.statSync(p);
      times.push(st.birthtimeMs || Infinity, st.mtimeMs);
    } catch { /* unreadable: ignore */ }
  };
  add(dir);
  try { for (const name of fs.readdirSync(dir)) add(path.join(dir, name)); } catch { /* ignore */ }
  return Math.min(...times);
}

function scanUnnumbered(basePath, types, cfg) {
  const items = [];
  const seen = new Set();
  for (const type of types) {
    if (!type.numbered) continue;
    const dir = typeDir(basePath, type);
    if (seen.has(dir.toLowerCase())) continue;
    seen.add(dir.toLowerCase());
    for (const name of listDirs(dir)) {
      if (parseJobNumber(name, cfg)) continue;
      const p = path.join(dir, name);
      items.push({
        path: p,
        name,
        typeId: type.id,
        created: oldestTime(p),
        missing: missingStructure(p, type),
      });
    }
  }
  return items.sort((a, b) => a.created - b.created);
}

function friendlyFsError(err) {
  if (['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
    return 'Couldn\'t rename it. A file inside may be open in another app.';
  }
  return err.message;
}

async function convertProjects(items, types, cfg) {
  const results = [];
  for (const item of items) {
    const type = types.find((t) => t.id === item.typeId);
    const oldName = path.basename(item.path);
    const newName = `${formatJobNumber(item.number, cfg)} ${oldName}`;
    const newPath = path.join(path.dirname(item.path), newName);
    try {
      if (!fs.existsSync(item.path)) throw new Error('Folder no longer exists.');
      if (fs.existsSync(newPath)) throw new Error(`"${newName}" already exists.`);
      fs.renameSync(item.path, newPath);
    } catch (err) {
      results.push({ ok: false, from: item.path, name: oldName, error: friendlyFsError(err) });
      continue;
    }
    const result = { ok: true, from: item.path, to: newPath, name: oldName, number: item.number, created: { dirs: [], files: [] } };
    try {
      result.created = await ensureStructure(newPath, type, newName);
    } catch (err) {
      result.warning = `Renamed, but couldn't add all folders: ${friendlyFsError(err)}`;
    }
    results.push(result);
  }
  return results;
}

// Reverses a conversion: removes files and empty folders it added, then restores the old names.
function undoConversion(results) {
  const problems = [];
  let restored = 0;
  for (const r of [...results].reverse()) {
    for (const f of r.created.files) {
      try {
        // Leave the file if it's been edited since.
        if (fs.existsSync(f.path) && fs.statSync(f.path).mtimeMs === f.mtimeMs) fs.unlinkSync(f.path);
      } catch { /* keep going */ }
    }
    for (const d of [...r.created.dirs].reverse()) {
      try { fs.rmdirSync(d); } catch { /* not empty any more: keep it */ }
    }
    try {
      if (fs.existsSync(r.from)) throw new Error(`"${path.basename(r.from)}" exists again.`);
      fs.renameSync(r.to, r.from);
      restored++;
    } catch (err) {
      problems.push(`${r.name}: ${friendlyFsError(err)}`);
    }
  }
  return { restored, problems };
}

module.exports = { scanUnnumbered, convertProjects, undoConversion };
