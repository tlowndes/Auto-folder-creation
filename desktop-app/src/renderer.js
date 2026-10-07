// `api` is the global exposed by preload.js.
let settings;
let view = 'create';
let selectedTypeId;
let settingsPage = 'folder';
let check = { existing: null, nextNumber: null };
let org = { items: [], startNumber: 1, canUndo: false, filter: 'all' };

if (new URLSearchParams(location.search).get('mica') === '1') document.documentElement.classList.add('mica');

// ---------- Helpers ----------

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
const text = (tag, cls, str) => {
  const e = el(tag, cls);
  e.textContent = str;
  return e;
};
// Electron prefixes IPC errors with "Error invoking remote method '...': Error: "
const cleanError = (err) => String(err.message || err).replace(/^.*?Error: /, '');
const splitRel = (p) => (p || '').split(/[\\/]+/).filter(Boolean);
const basename = (p) => splitRel(p).pop() || '';
const extname = (p) => (/\.[^.\\/]+$/.exec(p) || [''])[0];
const typeById = (id) => settings.projectTypes.find((t) => t.id === id);
const selectedType = () => typeById(selectedTypeId);
const fmtJob = (n) => settings.jobNumbers.prefix + String(n).padStart(settings.jobNumbers.digits, '0');

function showStatus(target, content, kind) {
  target.textContent = '';
  target.className = `status ${kind}`;
  target.append(content);
}

function relTime(ms) {
  const rtf = new Intl.RelativeTimeFormat('en-GB', { numeric: 'auto' });
  const mins = Math.round((ms - Date.now()) / 60000);
  if (mins > -60) return rtf.format(mins, 'minute');
  if (mins > -1440) return rtf.format(Math.round(mins / 60), 'hour');
  if (mins > -10080) return rtf.format(Math.round(mins / 1440), 'day');
  return rtf.format(Math.round(mins / 10080), 'week');
}

// ---------- Create view ----------

function renderChips() {
  const list = $('type-chips');
  list.innerHTML = '';
  if (!selectedType()) selectedTypeId = settings.projectTypes[0]?.id;
  settings.projectTypes.forEach((t, i) => {
    const b = el('button', 'chip' + (t.id === selectedTypeId ? ' selected' : ''), icon(t.icon, 16));
    b.style.setProperty('--c', t.color);
    b.title = i < 9 ? `Ctrl+${i + 1}` : '';
    b.append(text('span', '', t.name));
    b.onclick = () => selectType(t.id);
    list.append(b);
  });
  $('kbd-max').textContent = Math.min(settings.projectTypes.length, 9);
  $('no-base').classList.toggle('hidden', !!settings.basePath);
}

function selectType(id) {
  selectedTypeId = id;
  renderChips();
  refreshCheck();
  $('project-name').focus();
}

let checkTimer;
function refreshCheck() {
  renderPreview();
  clearTimeout(checkTimer);
  checkTimer = setTimeout(async () => {
    const t = selectedType();
    if (!t) return;
    check = await api.checkProject({ typeId: t.id, name: $('project-name').value.trim() });
    renderPreview();
  }, 120);
}

// Builds a nested tree from "Export/Web" style subfolder paths.
function buildTree(type, folderName, withTemplates) {
  const root = { children: new Map(), files: [] };
  const nodeAt = (rel) => {
    let n = root;
    for (const seg of splitRel(rel)) {
      if (!n.children.has(seg)) n.children.set(seg, { children: new Map(), files: [] });
      n = n.children.get(seg);
    }
    return n;
  };
  type.subfolders.forEach((s) => nodeAt(s));
  const templates = withTemplates ? type.templates : [];
  for (const t of templates) {
    if (!t.asBrief) nodeAt(t.dest).files.push({ name: `${folderName}${extname(t.source)}`, template: true });
  }
  if (type.createBrief) {
    root.files.push({ name: `${folderName}_brief.docx`, template: templates.some((t) => t.asBrief) });
  }
  return root;
}

function renderTreeNode(ul, node, depth) {
  for (const [name, child] of node.children) {
    const li = el('li', 'dir', icon('folder', 15));
    li.style.setProperty('--d', depth);
    li.append(text('span', '', name));
    ul.append(li);
    renderTreeNode(ul, child, depth + 1);
  }
  for (const f of node.files) {
    const li = el('li', 'file', icon('file', 15));
    li.style.setProperty('--d', depth);
    li.append(text('span', '', f.name));
    if (f.template) li.append(text('span', 'tag', 'template'));
    ul.append(li);
  }
}

function renderPreview() {
  const t = selectedType();
  document.body.style.setProperty('--type', t?.color || '#3b6fe0');
  if (!t) return;

  const name = $('project-name').value.trim();
  const shown = name || 'Project name';
  const existing = name ? check.existing : null;
  const prefix = !existing && t.numbered && check.nextNumber != null ? fmtJob(check.nextNumber) : null;
  const folderName = existing || (prefix ? `${prefix} ${shown}` : shown);

  $('name-prefix').textContent = prefix || '';
  $('name-prefix').classList.toggle('hidden', !prefix);

  const warn = $('exists-warning');
  warn.classList.toggle('hidden', !existing);
  if (existing) {
    warn.innerHTML = icon('alert', 15);
    warn.append(text('span', '', `"${existing}" already exists. Missing folders will be added to it.`));
  }

  const crumbs = [basename(settings.basePath) || 'Projects folder', ...splitRel(t.location)];
  $('preview-path').textContent = crumbs.join('  ›  ');

  const tree = $('tree');
  tree.innerHTML = '';
  const rootLi = el('li', 'root' + (name ? '' : ' placeholder'), icon('folder', 16));
  rootLi.append(text('span', '', folderName));
  tree.append(rootLi);
  renderTreeNode(tree, buildTree(t, folderName, !existing), 1);
}

function renderRecent() {
  const list = $('recent-list');
  list.innerHTML = '';
  if (!settings.recent.length) {
    list.append(text('p', 'empty', 'Projects you create will show up here.'));
    return;
  }
  for (const r of settings.recent) {
    const t = typeById(r.typeId);
    const row = el('button', 'recent-row');
    const dot = el('span', 'dot');
    dot.style.setProperty('--c', t?.color || 'var(--muted)');
    row.append(dot, text('span', 'recent-name', r.name), text('span', 'recent-meta', `${t?.name || 'Project'} · ${relTime(r.at)}`));
    row.insertAdjacentHTML('beforeend', icon('external', 15));
    row.title = r.path;
    row.onclick = () => api.openPath(r.path);
    list.append(row);
  }
}

async function create() {
  const btn = $('create-btn');
  if (btn.classList.contains('busy')) return;
  btn.classList.add('busy');
  $('status').className = 'status hidden';
  try {
    const res = await api.createProject({ typeId: selectedTypeId, projectName: $('project-name').value });
    btn.classList.add('done');
    btn.firstElementChild.innerHTML = `${icon('check', 18)}${res.existed ? 'Updated' : 'Created'}`;
    setTimeout(() => {
      btn.classList.remove('done');
      btn.firstElementChild.textContent = 'Create project';
    }, 1600);

    const link = text('button', 'link', 'Open folder');
    link.onclick = () => api.openPath(res.projectPath);
    const frag = document.createDocumentFragment();
    frag.append(text('span', '', `${res.existed ? 'Added missing folders to' : 'Created'} ${res.folderName}. `), link);
    for (const w of res.warnings) frag.append(text('span', 'warn-line', w));
    showStatus($('status'), frag, res.warnings.length ? 'warn' : 'ok');

    $('project-name').value = '';
    settings = await api.getSettings();
    renderRecent();
    refreshCheck();
  } catch (err) {
    showStatus($('status'), cleanError(err), 'error');
  } finally {
    btn.classList.remove('busy');
  }
}

// ---------- Settings view ----------

let saveTimer;
let savePending = false;

function setSaveStatus(msg, kind = '') {
  const s = $('save-status');
  s.className = `save-status ${kind}`;
  s.innerHTML = kind === 'ok' ? icon('check', 14) : '';
  s.append(msg);
}

function scheduleSave() {
  savePending = true;
  setSaveStatus('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 450);
}

async function flushSave() {
  clearTimeout(saveTimer);
  if (!savePending) return true;
  savePending = false;
  try {
    const { basePath, openAfterCreate, projectTypes, jobNumbers } = settings;
    await api.saveSettings({ basePath, openAfterCreate, projectTypes, jobNumbers });
    setSaveStatus('Saved', 'ok');
    return true;
  } catch (err) {
    setSaveStatus(cleanError(err), 'error');
    return false;
  }
}

function navItem(label, page, { dotColor, iconName } = {}) {
  const b = el('button', 'nav-item' + (settingsPage === page ? ' selected' : ''));
  if (dotColor) {
    const d = el('span', 'dot');
    d.style.setProperty('--c', dotColor);
    b.append(d);
  } else if (iconName) {
    b.insertAdjacentHTML('beforeend', icon(iconName, 16));
  }
  b.append(text('span', '', label));
  b.onclick = () => { settingsPage = page; renderSettings(); };
  return b;
}

function renderSettingsNav() {
  const nav = $('settings-nav');
  nav.innerHTML = '';
  nav.append(text('p', 'nav-head', 'General'));
  nav.append(navItem('Projects folder', 'folder', { iconName: 'folder' }));
  nav.append(navItem('Job numbers', 'jobs', { iconName: 'hash' }));
  const orgBtn = el('button', 'nav-item', icon('folders', 16));
  orgBtn.append(text('span', '', 'Organise existing'));
  orgBtn.onclick = () => switchView('organise');
  nav.append(orgBtn);

  nav.append(text('p', 'nav-head', 'Project types'));
  for (const t of settings.projectTypes) nav.append(navItem(t.name || 'Untitled', t.id, { dotColor: t.color }));
  const add = el('button', 'nav-item muted', icon('plus', 16));
  add.append(text('span', '', 'Add type'));
  add.onclick = () => {
    const n = settings.projectTypes.length;
    const t = {
      id: `type-${Date.now()}`, name: 'New type', location: '', subfolders: ['Project Files'], createBrief: true,
      numbered: true, templates: [], color: TYPE_COLORS[n % TYPE_COLORS.length], icon: 'folder',
    };
    settings.projectTypes.push(t);
    settingsPage = t.id;
    renderSettings();
    scheduleSave();
  };
  nav.append(add);
}

function field(label, control, { wide = false, help } = {}) {
  const wrap = el('div', 'field' + (wide ? ' wide' : ''));
  wrap.append(text('label', 'label', label), control);
  if (help) wrap.append(text('p', 'help', help));
  return wrap;
}

function input(value, onInput, attrs = {}) {
  const i = el('input');
  i.type = attrs.type || 'text';
  Object.assign(i, attrs);
  i.value = value ?? '';
  i.oninput = () => { onInput(i.value); scheduleSave(); };
  return i;
}

function checkbox(label, checked, onChange) {
  const l = el('label', 'check');
  const c = el('input');
  c.type = 'checkbox';
  c.checked = !!checked;
  c.onchange = () => { onChange(c.checked); scheduleSave(); };
  l.append(c, text('span', '', label));
  return l;
}

function renderFolderPage(d) {
  d.append(text('h2', '', 'Projects folder'));
  const row = el('div', 'row');
  const path = input(settings.basePath, () => {}, { readOnly: true, placeholder: 'Not set' });
  const browse = text('button', '', 'Browse…');
  browse.onclick = pickBase;
  row.append(path, browse);
  d.append(field('Location', row, { wide: true, help: 'Each project type creates its folders inside here.' }));
  d.append(checkbox('Open the new folder in Explorer after creating', settings.openAfterCreate, (v) => (settings.openAfterCreate = v)));
}

function renderJobsPage(d) {
  const j = settings.jobNumbers;
  d.append(text('h2', '', 'Job numbers'));
  d.append(text('p', 'help', 'One counter is shared by every project type, so each number is used once.'));
  const example = text('p', 'example', '');
  const updateExample = () => { example.textContent = `Next project: ${fmtJob(j.next)} Spring Campaign`; };
  const grid = el('div', 'form-grid');
  grid.append(
    field('Prefix', input(j.prefix, (v) => { j.prefix = v; updateExample(); }, { maxLength: 6 })),
    field('Digits', input(j.digits, (v) => { j.digits = Number(v); updateExample(); }, { type: 'number', min: 1, max: 6 })),
    field('Next number', input(j.next, (v) => { j.next = Number(v); updateExample(); }, { type: 'number', min: 1 })),
  );
  d.append(grid, example);
  updateExample();
  d.append(text('p', 'help', 'If a higher number already exists in your folders, the app skips past it automatically.'));
}

function renderTemplates(t) {
  const box = el('div', 'templates');
  const dests = ['', ...new Set(t.subfolders.flatMap((s) => splitRel(s).map((_, i, a) => a.slice(0, i + 1).join('/'))))];
  t.templates.forEach((tpl, i) => {
    const row = el('div', 'tpl-row', icon(tpl.asBrief ? 'file' : 'file', 16));
    row.append(text('span', 'tpl-name', basename(tpl.source)));
    row.title = tpl.source;
    if (!tpl.asBrief) {
      const sel = el('select');
      for (const d of dests) {
        const o = text('option', '', d ? `→ ${d}` : '→ Project folder');
        o.value = d;
        sel.append(o);
      }
      sel.value = dests.includes(tpl.dest) ? tpl.dest : '';
      sel.onchange = () => { tpl.dest = sel.value; scheduleSave(); };
      row.append(sel);
    } else {
      row.append(text('span', 'hint', 'Used as the brief'));
    }
    if (/\.docx$/i.test(tpl.source) && t.createBrief) {
      row.append(checkbox('Brief', tpl.asBrief, (v) => {
        t.templates.forEach((x) => (x.asBrief = false));
        tpl.asBrief = v;
        renderSettings();
      }));
    }
    const rm = el('button', 'icon-btn', icon('x', 15));
    rm.title = 'Remove template';
    rm.onclick = () => { t.templates.splice(i, 1); renderSettings(); scheduleSave(); };
    row.append(rm);
    box.append(row);
  });
  const add = el('button', 'tpl-add', icon('plus', 15));
  add.append(text('span', '', 'Add files'));
  add.onclick = async () => {
    const files = await api.pickFiles();
    if (!files.length) return;
    for (const f of files) t.templates.push({ source: f, dest: '', asBrief: false });
    renderSettings();
    scheduleSave();
  };
  box.append(add);
  return box;
}

function renderTypePage(d, t) {
  const head = el('div', 'type-head');
  const badge = el('span', 'type-badge', icon(t.icon, 20));
  badge.style.setProperty('--c', t.color);
  head.append(badge, text('h2', '', t.name || 'Untitled'));
  d.append(head);

  const grid = el('div', 'form-grid two');
  grid.append(field('Name', input(t.name, (v) => { t.name = v; head.querySelector('h2').textContent = v || 'Untitled'; renderSettingsNav(); })));

  const look = el('div', 'look');
  const swatches = el('div', 'swatches');
  for (const c of TYPE_COLORS) {
    const s = el('button', 'swatch' + (c === t.color ? ' selected' : ''));
    s.style.setProperty('--c', c);
    s.setAttribute('aria-label', `Colour ${c}`);
    s.onclick = () => { t.color = c; renderSettings(); scheduleSave(); };
    swatches.append(s);
  }
  const icons = el('div', 'icon-choices');
  for (const name of TYPE_ICONS) {
    const b = el('button', 'icon-choice' + (name === t.icon ? ' selected' : ''), icon(name, 17));
    b.style.setProperty('--c', t.color);
    b.setAttribute('aria-label', `Icon ${name}`);
    b.onclick = () => { t.icon = name; renderSettings(); scheduleSave(); };
    icons.append(b);
  }
  look.append(swatches, icons);
  grid.append(field('Colour and icon', look));

  grid.append(field('Location inside projects folder', input(t.location, (v) => { t.location = v; }, { placeholder: 'work_projects\\Client' }), { wide: true }));

  const subs = el('textarea');
  subs.rows = 5;
  subs.value = t.subfolders.join('\n');
  subs.oninput = () => { t.subfolders = subs.value.split('\n').map((s) => s.trim()).filter(Boolean); scheduleSave(); };
  subs.onblur = () => renderSettings(); // refresh template destinations
  grid.append(field('Subfolders', subs, { help: 'One per line. Use Export/Web for a folder inside a folder.' }));

  const opts = el('div', 'opts');
  opts.append(
    checkbox('Add a job number', t.numbered, (v) => (t.numbered = v)),
    checkbox('Create a Word brief', t.createBrief, (v) => { t.createBrief = v; renderSettings(); }),
  );
  grid.append(field('Options', opts));

  grid.append(field('Template files', renderTemplates(t), {
    wide: true,
    help: 'Copied into every new project and renamed to the project name.',
  }));
  d.append(grid);

  const rm = text('button', 'link danger remove-type', 'Remove this type');
  rm.onclick = () => {
    if (!confirm(`Remove "${t.name}"? Folders already on disk are not affected.`)) return;
    settings.projectTypes = settings.projectTypes.filter((x) => x !== t);
    settingsPage = 'folder';
    renderSettings();
    scheduleSave();
  };
  d.append(rm);
}

function renderSettings() {
  renderSettingsNav();
  const d = $('settings-detail');
  d.innerHTML = '';
  const type = typeById(settingsPage);
  if (settingsPage === 'jobs') renderJobsPage(d);
  else if (type) renderTypePage(d, type);
  else renderFolderPage(d);
}

async function pickBase() {
  const folder = await api.pickFolder();
  if (!folder) return;
  settings.basePath = folder;
  savePending = true;
  await flushSave();
  if (view === 'settings') renderSettings();
  else { renderChips(); refreshCheck(); }
}

// ---------- Organise view ----------

const orgVisible = () => org.items.filter((i) => org.filter === 'all' || i.typeId === org.filter);

function renderOrganise() {
  const visible = orgVisible();
  const list = $('org-list');
  list.innerHTML = '';

  const filter = $('org-filter');
  filter.innerHTML = '';
  const all = text('option', '', 'All types');
  all.value = 'all';
  filter.append(all);
  for (const t of settings.projectTypes.filter((x) => x.numbered)) {
    const o = text('option', '', t.name);
    o.value = t.id;
    filter.append(o);
  }
  filter.value = org.filter;

  if (!settings.basePath) {
    $('org-count').textContent = 'Choose your projects folder in Settings first.';
  } else {
    $('org-count').textContent = org.items.length
      ? `${org.items.length} project${org.items.length === 1 ? '' : 's'} without a job number`
      : 'Every project has a job number';
  }

  // Numbers follow date order among the selected rows.
  let n = org.startNumber;
  if (visible.length) {
    const head = el('div', 'org-row head');
    const all = el('input');
    all.type = 'checkbox';
    all.checked = visible.every((i) => i.checked);
    all.onchange = () => { visible.forEach((i) => (i.checked = all.checked)); renderOrganise(); };
    head.append(all, text('span', '', 'Folder'), text('span', '', 'Type'), text('span', '', 'Will add'), text('span', '', 'New name'));
    list.append(head);
  }
  for (const item of visible) {
    const t = typeById(item.typeId);
    const row = el('label', 'org-row' + (item.checked ? '' : ' off'));
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = item.checked;
    cb.onchange = () => { item.checked = cb.checked; renderOrganise(); };

    const nameCell = el('span', 'org-name');
    nameCell.append(text('span', '', item.name), text('span', 'sub', `Created ${new Date(item.created).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`));

    const typeCell = el('span', 'org-type');
    const dot = el('span', 'dot');
    dot.style.setProperty('--c', t?.color);
    typeCell.append(dot, text('span', '', t?.name || ''));

    const missing = item.missing.length ? item.missing.join(', ') : 'Nothing, already complete';
    const missCell = text('span', 'org-missing' + (item.missing.length ? '' : ' complete'), missing);
    missCell.title = missing;

    const numCell = el('span', 'org-num');
    numCell.style.setProperty('--type', t?.color || '#3b6fe0');
    if (item.checked) {
      item.number = n++;
      numCell.append(text('span', 'job-badge', fmtJob(item.number)));
    } else {
      item.number = null;
      numCell.append(text('span', 'hint', 'Skipped'));
    }
    row.append(cb, nameCell, typeCell, missCell, numCell);
    list.append(row);
  }

  const count = visible.filter((i) => i.checked).length;
  $('org-convert').textContent = count ? `Convert ${count} project${count === 1 ? '' : 's'}` : 'Convert';
  $('org-info').innerHTML = icon('info', 15);
  $('org-info').append(` Files inside are never moved or renamed. New projects will continue from ${fmtJob(n)}.`);
  $('org-undo').classList.toggle('hidden', !org.canUndo);
  $('org-undo').innerHTML = `${icon('undo', 15)}<span>Undo last conversion</span>`;
}

async function loadOrganise() {
  const res = await api.scanOrganise();
  org = { ...org, ...res, items: res.items.map((i) => ({ ...i, checked: true })) };
  if (org.filter !== 'all' && !typeById(org.filter)) org.filter = 'all';
  renderOrganise();
}

async function convert() {
  const chosen = orgVisible().filter((i) => i.checked);
  if (!chosen.length) {
    showStatus($('org-status'), 'Tick at least one project to convert.', 'error');
    return;
  }
  if (!confirm(`Rename ${chosen.length} folder${chosen.length === 1 ? '' : 's'} with job numbers? You can undo this afterwards.`)) return;
  try {
    const results = await api.convertOrganise(chosen.map(({ path, typeId, number }) => ({ path, typeId, number })));
    const ok = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    const frag = document.createDocumentFragment();
    frag.append(text('span', '', `Converted ${ok} project${ok === 1 ? '' : 's'}.`));
    for (const f of failed) frag.append(text('span', 'warn-line', `${f.name}: ${f.error}`));
    for (const w of results.filter((r) => r.warning)) frag.append(text('span', 'warn-line', `${w.name}: ${w.warning}`));
    showStatus($('org-status'), frag, failed.length ? 'warn' : 'ok');
  } catch (err) {
    showStatus($('org-status'), cleanError(err), 'error');
  }
  settings = await api.getSettings();
  await loadOrganise();
}

async function undo() {
  if (!confirm('Put the old folder names back and remove the empty folders that were added?')) return;
  try {
    const res = await api.undoOrganise();
    const frag = document.createDocumentFragment();
    frag.append(text('span', '', `Restored ${res.restored} folder name${res.restored === 1 ? '' : 's'}.`));
    for (const p of res.problems) frag.append(text('span', 'warn-line', p));
    showStatus($('org-status'), frag, res.problems.length ? 'warn' : 'ok');
  } catch (err) {
    showStatus($('org-status'), cleanError(err), 'error');
  }
  settings = await api.getSettings();
  await loadOrganise();
}

// ---------- Navigation ----------

const TITLES = { create: 'Auto Folder Creator', settings: 'Settings', organise: 'Organise existing projects' };

async function switchView(next) {
  if (view === 'settings' && !(await flushSave())) return; // stay put on validation errors
  view = next;
  settings = await api.getSettings();
  for (const v of ['create', 'settings', 'organise']) $(`view-${v}`).classList.toggle('hidden', v !== next);
  $('title').textContent = TITLES[next];
  $('nav-back').classList.toggle('hidden', next === 'create');
  $('nav-settings').classList.toggle('hidden', next !== 'create');
  $('nav-organise').classList.toggle('hidden', next !== 'create');
  setSaveStatus('');
  $('org-status').className = 'status hidden';

  if (next === 'create') {
    renderChips();
    renderRecent();
    refreshCheck();
    $('project-name').focus();
  } else if (next === 'settings') {
    if (settingsPage !== 'folder' && settingsPage !== 'jobs' && !typeById(settingsPage)) settingsPage = 'folder';
    renderSettings();
  } else {
    await loadOrganise();
  }
}

async function init() {
  $('nav-settings').innerHTML = icon('settings', 18);
  $('nav-organise').innerHTML = icon('folders', 18);
  $('nav-back').innerHTML = icon('back', 18);

  settings = await api.getSettings();
  renderChips();
  renderRecent();
  refreshCheck();

  $('nav-settings').onclick = () => switchView('settings');
  $('nav-organise').onclick = () => switchView('organise');
  $('nav-back').onclick = () => switchView('create');
  $('project-name').oninput = refreshCheck;
  $('project-name').onkeydown = (e) => { if (e.key === 'Enter') create(); };
  $('create-btn').onclick = create;
  $('pick-base-inline').onclick = pickBase;
  $('org-filter').onchange = (e) => { org.filter = e.target.value; renderOrganise(); };
  $('org-convert').onclick = convert;
  $('org-undo').onclick = undo;

  document.addEventListener('keydown', (e) => {
    if (view === 'create' && e.ctrlKey && /^[1-9]$/.test(e.key)) {
      const t = settings.projectTypes[Number(e.key) - 1];
      if (t) { e.preventDefault(); selectType(t.id); }
    }
    if (e.key === 'Escape' && view !== 'create') switchView('create');
  });
  $('project-name').focus();
}

init();
