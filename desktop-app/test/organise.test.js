const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createProject, highestJobNumber } = require('../lib/createProject');
const { scanUnnumbered, convertProjects, undoConversion } = require('../lib/organise');
const defaults = require('../lib/defaults');

const cfg = { prefix: 'J-', digits: 4, next: 1 };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'afc-'));
const types = structuredClone(defaults.projectTypes);
const work = types.find((t) => t.id === 'work');
const video = types.find((t) => t.id === 'video');

test('new numbered project gets job number, nested folders and renamed template', async () => {
  const base = tmp();
  const tpl = path.join(base, 'layout.indd');
  fs.writeFileSync(tpl, 'template');
  const type = { ...work, subfolders: ['Copy', 'Export/Web', 'Export/Print'], templates: [{ source: tpl, dest: 'Export/Web' }] };
  const res = await createProject({ basePath: base, projectType: type, projectName: 'Spring', jobNumber: 43, jobCfg: cfg });
  assert.strictEqual(res.folderName, 'J-0043 Spring');
  assert.strictEqual(res.usedNumber, 43);
  assert.ok(fs.existsSync(path.join(res.projectPath, 'Export', 'Print')));
  assert.strictEqual(fs.readFileSync(path.join(res.projectPath, 'Export', 'Web', 'J-0043 Spring.indd'), 'utf8'), 'template');
  assert.ok(fs.existsSync(path.join(res.projectPath, 'J-0043 Spring_brief.docx')));
});

test('same name again reuses the numbered folder instead of a new number', async () => {
  const base = tmp();
  await createProject({ basePath: base, projectType: work, projectName: 'Spring', jobNumber: 1, jobCfg: cfg });
  const res = await createProject({ basePath: base, projectType: work, projectName: 'spring', jobNumber: 2, jobCfg: cfg });
  assert.strictEqual(res.existed, true);
  assert.strictEqual(res.folderName, 'J-0001 Spring');
  assert.strictEqual(res.usedNumber, null);
});

test('missing template is a warning, not a failure', async () => {
  const base = tmp();
  const type = { ...work, templates: [{ source: path.join(base, 'gone.psd'), dest: '' }] };
  const res = await createProject({ basePath: base, projectType: type, projectName: 'X', jobNumber: 1, jobCfg: cfg });
  assert.strictEqual(res.warnings.length, 1);
});

test('scan, convert oldest-first and undo restores everything', async () => {
  const base = tmp();
  const vdir = path.join(base, 'video_projects');
  fs.mkdirSync(path.join(vdir, 'Wedding', 'Footage'), { recursive: true });
  fs.writeFileSync(path.join(vdir, 'Wedding', 'Footage', 'clip.mp4'), 'video');
  fs.mkdirSync(path.join(vdir, 'J-0007 Already numbered'), { recursive: true });

  const items = scanUnnumbered(base, types, cfg);
  assert.deepStrictEqual(items.map((i) => i.name), ['Wedding']);
  assert.ok(items[0].missing.includes('Audio') && items[0].missing.includes('brief'));
  assert.strictEqual(highestJobNumber(base, types, cfg), 7);

  const results = await convertProjects([{ ...items[0], number: 8 }], types, cfg);
  assert.ok(results[0].ok);
  const converted = path.join(vdir, 'J-0008 Wedding');
  assert.strictEqual(fs.readFileSync(path.join(converted, 'Footage', 'clip.mp4'), 'utf8'), 'video');
  assert.ok(fs.existsSync(path.join(converted, 'Audio')));
  assert.ok(fs.existsSync(path.join(converted, 'J-0008 Wedding_brief.docx')));

  const undo = undoConversion(results);
  assert.strictEqual(undo.restored, 1);
  assert.deepStrictEqual(fs.readdirSync(path.join(vdir, 'Wedding')), ['Footage']);
  assert.strictEqual(fs.readFileSync(path.join(vdir, 'Wedding', 'Footage', 'clip.mp4'), 'utf8'), 'video');
});

test('undo keeps folders the user has since put files in', async () => {
  const base = tmp();
  fs.mkdirSync(path.join(base, 'video_projects', 'Trip'), { recursive: true });
  const [item] = scanUnnumbered(base, types, cfg);
  const results = await convertProjects([{ ...item, number: 1 }], [video], cfg);
  fs.writeFileSync(path.join(results[0].to, 'Audio', 'new.wav'), 'x');
  undoConversion(results);
  assert.ok(fs.existsSync(path.join(base, 'video_projects', 'Trip', 'Audio', 'new.wav')));
});

test('oldest-first uses the earliest file date, not the folder sync date', () => {
  const base = tmp();
  const dir = path.join(base, 'video_projects');
  fs.mkdirSync(path.join(dir, 'Newer'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'Older'), { recursive: true });
  const old = new Date('2023-01-01');
  fs.writeFileSync(path.join(dir, 'Older', 'a.txt'), 'x');
  fs.utimesSync(path.join(dir, 'Older', 'a.txt'), old, old);
  assert.deepStrictEqual(scanUnnumbered(base, types, cfg).map((i) => i.name), ['Older', 'Newer']);
});
