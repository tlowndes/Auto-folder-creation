const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createProject } = require('../lib/createProject');
const defaults = require('../lib/defaults');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'afc-'));
const work = defaults.projectTypes.find((t) => t.id === 'work');

test('creates nested location, subfolders and a valid docx brief', async () => {
  const base = tmp();
  const res = await createProject({ basePath: base, projectType: work, projectName: 'Spring Campaign' });
  assert.strictEqual(res.projectPath, path.join(base, 'work_projects', 'Dove Technology', 'Spring Campaign'));
  for (const s of work.subfolders) assert.ok(fs.statSync(path.join(res.projectPath, s)).isDirectory());
  const buf = fs.readFileSync(path.join(res.projectPath, 'Spring Campaign_brief.docx'));
  assert.strictEqual(buf.subarray(0, 2).toString(), 'PK'); // docx is a zip
  assert.strictEqual(res.existed, false);
});

test('re-running does not overwrite an edited brief', async () => {
  const base = tmp();
  const args = { basePath: base, projectType: work, projectName: 'X' };
  const { projectPath } = await createProject(args);
  const briefPath = path.join(projectPath, 'X_brief.docx');
  fs.writeFileSync(briefPath, 'edited');
  const res = await createProject(args);
  assert.strictEqual(res.existed, true);
  assert.strictEqual(fs.readFileSync(briefPath, 'utf8'), 'edited');
});

test('rejects invalid names and path escapes', async () => {
  const base = tmp();
  for (const projectName of ['', 'a/b', 'CON', 'bad.', 'x?']) {
    await assert.rejects(createProject({ basePath: base, projectType: work, projectName }));
  }
  await assert.rejects(createProject({ basePath: base, projectType: { ...work, location: '..\..' }, projectName: 'ok' }));
  await assert.rejects(createProject({ basePath: '', projectType: work, projectName: 'ok' }));
});
