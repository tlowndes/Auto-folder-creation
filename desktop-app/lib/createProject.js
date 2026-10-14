const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, HeadingLevel, TextRun } = require('docx');
const { formatJobNumber, parseJobNumber } = require('./jobNumber');

const INVALID_CHARS = /[<>:"/\\|?*\x00-\x1f]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// Returns an error message, or null if the name is a valid Windows folder name.
function validateName(name) {
  if (!name || !name.trim()) return 'Enter a name.';
  if (INVALID_CHARS.test(name)) return 'Names can\'t contain < > : " / \\ | ? *';
  if (/[. ]$/.test(name)) return 'Names can\'t end with a space or a full stop.';
  if (RESERVED.test(name.trim())) return `"${name}" is a reserved Windows name.`;
  return null;
}

const splitRel = (p) => (p || '').split(/[\\/]+/).filter(Boolean);

// Validates a relative path such as "work_projects\Client" or "Export/Web",
// and blocks escaping the folder it's relative to.
function validateRelPath(p, label) {
  for (const part of splitRel(p)) {
    if (part === '..' || part === '.') return `${label} can't contain "." or ".." segments.`;
    const err = validateName(part);
    if (err) return `${label}: ${err}`;
  }
  return null;
}

const validateLocation = (loc) => validateRelPath(loc, 'Location');
const typeDir = (basePath, type) => path.join(basePath, ...splitRel(type.location));

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('$'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// Finds a project folder in `dir` called `name`, with or without a job number.
function findExisting(dir, name, cfg) {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  return listDirs(dir).find((d) => (parseJobNumber(d, cfg)?.rest ?? d).toLowerCase() === want) || null;
}

// Highest job number already used in any project type's folder.
function highestJobNumber(basePath, types, cfg) {
  let max = 0;
  const seen = new Set();
  for (const t of types) {
    const dir = typeDir(basePath, t);
    if (seen.has(dir.toLowerCase())) continue;
    seen.add(dir.toLowerCase());
    for (const d of listDirs(dir)) max = Math.max(max, parseJobNumber(d, cfg)?.number ?? 0);
  }
  return max;
}

const hasBrief = (projectPath) => {
  try {
    return fs.readdirSync(projectPath).some((f) => /_brief\.docx$/i.test(f));
  } catch {
    return false;
  }
};

// Subfolders and brief that a project folder doesn't have yet.
function missingStructure(projectPath, type) {
  const missing = type.subfolders.filter((s) => !fs.existsSync(path.join(projectPath, ...splitRel(s))));
  if (type.createBrief && !hasBrief(projectPath)) missing.push('brief');
  return missing;
}

async function buildBrief(title, typeName) {
  const doc = new Document({
    creator: 'Auto Folder Creator',
    title: `${title} brief`,
    sections: [
      {
        children: [
          new Paragraph({ text: `${title} — Brief`, heading: HeadingLevel.TITLE }),
          new Paragraph({ children: [new TextRun({ text: 'Project type: ', bold: true }), new TextRun(typeName)] }),
          new Paragraph({
            children: [new TextRun({ text: 'Created: ', bold: true }), new TextRun(new Date().toLocaleDateString('en-GB'))],
          }),
          new Paragraph({ text: 'Overview', heading: HeadingLevel.HEADING_1 }),
          new Paragraph(''),
          new Paragraph({ text: 'Deliverables', heading: HeadingLevel.HEADING_1 }),
          new Paragraph(''),
          new Paragraph({ text: 'Deadline', heading: HeadingLevel.HEADING_1 }),
          new Paragraph(''),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}

// Adds any missing subfolders, brief and (for new projects) template files.
// Returns everything it created so a conversion can be undone.
async function ensureStructure(projectPath, type, folderName, { withTemplates = false } = {}) {
  const created = { dirs: [], files: [], warnings: [] };

  const mkdirTracked = (rel) => {
    let p = projectPath;
    for (const seg of splitRel(rel)) {
      p = path.join(p, seg);
      if (!fs.existsSync(p)) {
        fs.mkdirSync(p);
        created.dirs.push(p);
      }
    }
    return p;
  };
  const writeTracked = (dest, write) => {
    write(dest);
    created.files.push({ path: dest, mtimeMs: fs.statSync(dest).mtimeMs });
  };

  for (const sub of type.subfolders) mkdirTracked(sub);

  const templates = withTemplates ? type.templates || [] : [];
  if (type.createBrief && !hasBrief(projectPath)) {
    const dest = path.join(projectPath, `${folderName}_brief.docx`);
    const briefTemplate = templates.find((t) => t.asBrief);
    if (briefTemplate && fs.existsSync(briefTemplate.source)) {
      writeTracked(dest, (d) => fs.copyFileSync(briefTemplate.source, d));
    } else {
      if (briefTemplate) created.warnings.push(`Brief template not found: ${briefTemplate.source}`);
      const buf = await buildBrief(folderName, type.name);
      writeTracked(dest, (d) => fs.writeFileSync(d, buf));
    }
  }

  for (const t of templates) {
    if (t.asBrief) continue;
    if (!fs.existsSync(t.source)) {
      created.warnings.push(`Template not found: ${t.source}`);
      continue;
    }
    const dir = mkdirTracked(t.dest);
    const ext = path.extname(t.source);
    let dest = path.join(dir, `${folderName}${ext}`);
    // Two templates with the same extension: keep the template's name too.
    if (fs.existsSync(dest)) dest = path.join(dir, `${folderName} ${path.basename(t.source, ext)}${ext}`);
    if (fs.existsSync(dest)) continue;
    writeTracked(dest, (d) => fs.copyFileSync(t.source, d));
  }

  return created;
}

async function createProject({ basePath, projectType, projectName, jobNumber = null, jobCfg = { prefix: 'J-', digits: 4 } }) {
  if (!basePath) throw new Error('Choose a projects folder in Settings first.');
  if (!fs.existsSync(basePath)) throw new Error(`Projects folder not found: ${basePath}`);

  const name = (projectName || '').trim();
  const nameErr = validateName(name);
  if (nameErr) throw new Error(nameErr);
  const locErr = validateLocation(projectType.location || '');
  if (locErr) throw new Error(locErr);

  const dir = typeDir(basePath, projectType);
  const existing = findExisting(dir, name, jobCfg);
  const numbered = !existing && projectType.numbered && jobNumber != null;
  const folderName = existing || (numbered ? `${formatJobNumber(jobNumber, jobCfg)} ${name}` : name);
  const projectPath = path.join(dir, folderName);

  fs.mkdirSync(projectPath, { recursive: true });
  // Existing projects only get missing folders; templates are for new projects.
  const created = await ensureStructure(projectPath, projectType, folderName, { withTemplates: !existing });

  return {
    projectPath,
    folderName,
    existed: !!existing,
    usedNumber: numbered ? jobNumber : null,
    warnings: created.warnings,
  };
}

module.exports = {
  createProject,
  ensureStructure,
  findExisting,
  highestJobNumber,
  missingStructure,
  listDirs,
  splitRel,
  typeDir,
  validateName,
  validateLocation,
  validateRelPath,
};
