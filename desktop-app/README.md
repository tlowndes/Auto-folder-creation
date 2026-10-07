# Auto Folder Creator (desktop app)

Desktop version of `folder.py`. Pick a project type, type a name, and it creates the folder structure, a `<name>_brief.docx`, and any template files.

## Features

- **Job numbers**: every project gets a number like `J-0043 Spring Campaign` from one shared counter (prefix, digits and next number in Settings → Job numbers; can be turned off per type).
- **Organise existing** (folder icon, top right): lists project folders without a job number, numbers them oldest-first, adds missing subfolders and brief. Files inside are never moved. **Undo last conversion** restores the old names.
- **Template files** per type, copied into new projects and renamed to the project name. A `.docx` template can replace the generated brief.
- **Nested subfolders**: `Export/Web` creates `Web` inside `Export`.
- **Recent projects** list, and a warning when a project with that name already exists.
- Shortcuts: `Ctrl+1`–`Ctrl+9` pick a type, `Enter` creates, `Esc` goes back.

## Run it (development)

```bash
npm install
npm start
```

On first launch, go to **Settings → Browse…** and pick your `@projects` folder. It's remembered after that.

## Build a Windows .exe

```bash
npm run dist
```

Output goes to `dist/`:
- `Auto Folder Creator Setup x.y.z.exe` — installer (adds desktop and Start menu shortcuts)
- `Auto Folder Creator x.y.z.exe` — portable, runs without installing

## Logo and icons

The logo is `src/logo.svg`. After editing it, regenerate `assets/icon.png` (window) and `assets/icon.ico` (exe/shortcut):

```bash
npm run icons
```

## Settings

Stored in `%APPDATA%\Auto Folder Creator\settings.json`. Project types (name, colour, icon, location inside the projects folder, subfolders, brief on/off) are editable in Settings (gear icon, top right).

## Tests

```bash
npm test
```
