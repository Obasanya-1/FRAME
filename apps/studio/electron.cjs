const { app, BrowserWindow, Menu, shell, dialog, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

app.setName('Frame - Carousel Studio');
// Keep the original user-data location so v0.3.x autosaves survive the upgrade.
app.setPath('userData', path.join(app.getPath('appData'), 'frame-studio'));
app.setAppUserModelId('com.frame.studio');

let mainWindow;
let currentProjectPath = null;

const autosavePath = () => path.join(app.getPath('userData'), 'autosave.frame');
const recentProjectsPath = () => path.join(app.getPath('userData'), 'recent-projects.json');
const autosaveOriginPath = () => path.join(app.getPath('userData'), 'autosave-origin.json');
const lastAttachedPath = () => path.join(app.getPath('userData'), 'last-attached-project.json');
function setAttachedPath(filePath) {
  fs.writeFileSync(lastAttachedPath(), JSON.stringify({path:filePath}), 'utf8');
}
function restoreAttachedPath() {
  try {
    const data = JSON.parse(fs.readFileSync(lastAttachedPath(), 'utf8'));
    if (typeof data.path === 'string' && fs.existsSync(data.path)) return data.path;
  } catch {}
  return null;
}


function getRecentProjects() {
  try {
    const stored = JSON.parse(fs.readFileSync(recentProjectsPath(), 'utf8'));
    return Array.isArray(stored) ? stored.filter(item => typeof item === 'string' && fs.existsSync(item)).slice(0, 20) : [];
  } catch { return []; }
}

// Home tiles never send full-resolution base64 photos over IPC. A few first-slide
// images are decoded into small JPEG data URLs, and the layout remains editable
// in its original .frame file. Cache by file modification time in this process.
const libraryPreviewCache = new Map();
function projectThumbnailData(project) {
  const pageWidth = project.orientation === 'landscape' ? 400 : 320;
  // New projects store a small browser-rendered JPEG on explicit Save.
  // This bypasses nativeImage failures and shows photos, masks, and text
  // together exactly as FRAME rendered them.
  if(typeof project.studioThumbnail === 'string' &&
      /^data:image\/(?:jpeg|png|webp);base64,/i.test(project.studioThumbnail) &&
      project.studioThumbnail.length < 1_200_000) {
    return {pages:project.pages,orientation:project.orientation,previewImage:project.studioThumbnail};
  }
  const pages = Math.max(1, Math.min(20, Number(project.pages) || 1));
  const allLayers = Array.isArray(project.layers) ? project.layers.filter(Boolean) : [];
  const byId = new Map(allLayers.map(layer => [layer.id, layer]));
  const bounds = layer => {
    if(layer.type === 'image' && Number.isInteger(layer.cropPage)) {
      return {x: layer.cropPage * (pageWidth + 1), w: pageWidth};
    }
    const mask = layer.type === 'image' ? byId.get(layer.maskShapeId) : null;
    return mask?.type === 'shape' ? mask : layer;
  };
  const overlaps = (layer, index) => {
    const frame = bounds(layer);
    const left = index * (pageWidth + 1);
    const x = Number(frame.x), w = Number(frame.w);
    return Number.isFinite(x) && Number.isFinite(w) && w > 0 &&
      x < left + pageWidth && x + w > left;
  };

  // If the cover contains no photos, show the earliest slide with an image.
  // Otherwise a photo carousel with a text-only title appears photo-free.
  let previewPage = 0;
  for(let page = 0; page < pages; page++) {
    if(allLayers.some(layer => layer.type === 'image' && overlaps(layer, page))) {
      previewPage = page;
      break;
    }
  }
  const offset = previewPage * (pageWidth + 1);
  let decoded = 0;
  const thumbnailLayers = allLayers.filter(layer => overlaps(layer, previewPage)).slice(0, 80).map(layer => {
    const copy = {...layer};
    if(copy.type === 'image') {
      const src = copy.src;
      delete copy.src; // Never send the original full-resolution photo over IPC.
      if(decoded < 8 && typeof src === 'string' && src.startsWith('data:image/') && src.length < 64_000_000) {
        try {
          let image = nativeImage.createFromDataURL(src);
          if(image.isEmpty()) {
            const base64 = src.match(/^data:image\/[^;,]+;base64,(.+)$/is)?.[1];
            if(base64) image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'));
          }
          if(!image.isEmpty()) {
            const originalWidth = image.getSize().width;
            const scaled = image.resize({width: Math.max(1, Math.min(256, originalWidth))});
            if(!scaled.isEmpty()) {
              copy.src = `data:image/jpeg;base64,${scaled.toJPEG(72).toString('base64')}`;
              decoded++;
            }
          }
        } catch(error) {
          console.warn('Could not create FRAME Home photo thumbnail:', error.message);
        }
      }
      // Legacy .frame files have no stored thumbnail yet. When Electron's
      // native decoder fails, Chromium may still support the embedded image;
      // allow one bounded original source through as a compatibility fallback.
      if(!copy.src && decoded===0 && typeof src==='string' &&
         /^data:image\/(?:jpeg|png|webp);base64,/i.test(src) && src.length < 12_000_000) {
        copy.src=src;
        decoded++;
      }
      if(!copy.src) {copy.type = 'shape';copy.shape = 'rectangle';copy.color = '#a5b4c6';}
    }
    // Preview-only geometry: clipped/fill images should occupy their actual
    // visible frames, without modifying the image in the saved .frame file.
    if(layer.type === 'image') {
      const mask = byId.get(layer.maskShapeId);
      if(mask?.type === 'shape') {
        copy.x = mask.x; copy.y = mask.y; copy.w = mask.w; copy.h = mask.h;
      } else if(Number.isInteger(layer.cropPage)) {
        copy.x = layer.cropPage * (pageWidth + 1);
        copy.y = 0;
        copy.w = pageWidth;
        copy.h = project.orientation === 'landscape' ? 320 : 400;
      }
    }
    copy.x = (Number(copy.x) || 0) - offset;
    // The thumbnail renderer draws at slide-local coordinates; backgrounds
    // and layer stacking remain lightweight, non-editable representations.
    return copy;
  });
  return {
    pages, previewPage, orientation: project.orientation, bg: project.bg,
    canvasDesign: project.canvasDesign, layers: thumbnailLayers
  };
}

function getStudioLibrary() {
  const entries=[];
  for(const filePath of getRecentProjects()) {
    try {
      const stats=fs.statSync(filePath);
      const cacheKey=filePath+'|'+stats.mtimeMs+'|'+stats.size;
      let preview=libraryPreviewCache.get(cacheKey);
      if(!preview){preview=projectThumbnailData(safeParseProject(fs.readFileSync(filePath,'utf8')));libraryPreviewCache.set(cacheKey,preview);}
      entries.push({path:filePath,name:path.basename(filePath),updatedAt:stats.mtimeMs,pages:preview.pages,preview});
    }catch(error){entries.push({path:filePath,name:path.basename(filePath),error:error.message});}
  }
  if(libraryPreviewCache.size>55)libraryPreviewCache.clear();
  return entries;
}

function rememberProject(filePath) {
  const recent = [filePath, ...getRecentProjects().filter(item => item !== filePath)].slice(0, 20);
  fs.writeFileSync(recentProjectsPath(), JSON.stringify(recent, null, 2), 'utf8');
}

function replaceRecentProject(previous, next) {
  const recent = [next, ...getRecentProjects().filter(item => item !== previous && item !== next)].slice(0, 20);
  fs.writeFileSync(recentProjectsPath(), JSON.stringify(recent, null, 2), 'utf8');
}

function safeParseProject(raw) {
  const data = JSON.parse(raw);
  if (!data || typeof data !== 'object' || !Array.isArray(data.layers)) {
    throw new Error('This is not a valid FRAME Studio project.');
  }
  return data;
}

async function writeProject(project, targetPath) {
  const payload = {
    format: 'frame-studio-project',
    version: 3,
    savedAt: new Date().toISOString(),
    ...project
  };
  fs.writeFileSync(targetPath, JSON.stringify(payload, null, 2), 'utf8');
  return payload;
}

async function saveProject(project, saveAs = false, suggestedName = "Untitled.frame") {
  let target = currentProjectPath;
  if (!target || saveAs) {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Save FRAME Studio Project',
      defaultPath: target || ((typeof suggestedName === 'string' && /^[^<>:"/\\|?*\x00-\x1f]+\.(frame|json)$/i.test(suggestedName)) ? suggestedName : 'Untitled.frame'),
      filters: [
        { name: 'FRAME Studio Project', extensions: ['frame'] },
        { name: 'JSON', extensions: ['json'] }
      ]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    target = result.filePath;
  }
  await writeProject(project, target);
  currentProjectPath = target;
  setAttachedPath(target);
  rememberProject(target);
  // Remember the file associated with this autosave for crash recovery.
  fs.writeFileSync(autosaveOriginPath(), JSON.stringify({path:target}), 'utf8');
  await writeProject(project, autosavePath());
  return { canceled: false, path: target, name: path.basename(target) };
}

function versionParts(v) {
  return String(v || '0').split('.').map(n => Number.parseInt(n, 10) || 0);
}

function compareVersions(a, b) {
  const aa = versionParts(a), bb = versionParts(b);
  for (let i = 0; i < Math.max(aa.length, bb.length); i++) {
    const d = (aa[i] || 0) - (bb[i] || 0);
    if (d) return d;
  }
  return 0;
}

async function installLocalUpdate() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Install FRAME Studio Update',
    properties: ['openFile'],
    filters: [
      { name: 'FRAME Studio Update', extensions: ['frameupdate', 'zip'] }
    ]
  });
  if (result.canceled || !result.filePaths[0]) return;

  const selected = result.filePaths[0];
  const stamp = Date.now();
  const stagingRoot = path.join(app.getPath('temp'), `frame-studio-update-${stamp}`);
  const zipPath = path.join(stagingRoot, 'update.zip');
  const stagePath = path.join(stagingRoot, 'payload');
  fs.mkdirSync(stagePath, { recursive: true });
  fs.copyFileSync(selected, zipPath);

  try {
    execFileSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replaceAll("'", "''")}' -DestinationPath '${stagePath.replaceAll("'", "''")}' -Force`
    ], { windowsHide: true, stdio: 'ignore' });
  } catch (error) {
    await dialog.showErrorBox('Update failed', 'FRAME could not unpack that update file.');
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    return;
  }

  const manifestPath = path.join(stagePath, 'frame-update.json');
  const nextExe = path.join(stagePath, 'FRAME Studio.exe');
  if (!fs.existsSync(manifestPath) || !fs.existsSync(nextExe)) {
    await dialog.showErrorBox('Invalid update', 'That file is not a valid FRAME Studio update package.');
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    return;
  }

  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch { manifest = null; }
  if (!manifest || manifest.appId !== 'frame-studio' || !manifest.version) {
    await dialog.showErrorBox('Invalid update', 'The update manifest is missing or invalid.');
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    return;
  }

  const current = app.getVersion();
  const relation = compareVersions(manifest.version, current);
  const confirm = await dialog.showMessageBox(mainWindow, {
    type: relation > 0 ? 'question' : 'warning',
    buttons: ['Install and Restart', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    title: 'Install FRAME Studio Update',
    message: `Install FRAME Studio ${manifest.version}?`,
    detail: relation > 0
      ? `Current version: ${current}. Your projects and autosave data are stored separately and will not be replaced.`
      : `Current version: ${current}. This package is not newer than the installed version.`
  });
  if (confirm.response !== 0) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    return;
  }

  const installDir = path.dirname(process.execPath);
  const exePath = path.join(installDir, 'FRAME Studio.exe');
  const updater = path.join(stagingRoot, 'apply-update.ps1');
  const ps = `param([int]$ParentPid,[string]$Stage,[string]$Target,[string]$Exe,[string]$Cleanup)\n` +
`try { Wait-Process -Id $ParentPid -ErrorAction SilentlyContinue } catch {}\n` +
`Start-Sleep -Milliseconds 700\n` +
`Get-ChildItem -LiteralPath $Target -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue\n` +
`Copy-Item -Path (Join-Path $Stage '*') -Destination $Target -Recurse -Force\n` +
`Start-Process -FilePath $Exe\n` +
`Start-Sleep -Milliseconds 800\n` +
`Remove-Item -LiteralPath $Cleanup -Recurse -Force -ErrorAction SilentlyContinue\n`;
  fs.writeFileSync(updater, ps, 'utf8');

  const child = spawn('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', updater,
    '-ParentPid', String(process.pid), '-Stage', stagePath, '-Target', installDir,
    '-Exe', exePath, '-Cleanup', stagingRoot
  ], { detached: true, windowsHide: true, stdio: 'ignore' });
  child.unref();
  app.quit();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#121214',
    title: 'FRAME Studio',
    icon: path.join(__dirname, 'assets', 'frame.ico'),
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  // Web page title updates must not replace the actual Windows title bar name.
  mainWindow.webContents.on('page-title-updated', event => {
    event.preventDefault();
    mainWindow.setTitle('FRAME Studio');
  });
  mainWindow.setTitle('FRAME Studio');

  // Use Electron window zoom for keyboard shortcuts, not the canvas-only slider.
  // The main keyboard's + shares the = key; Ctrl+= needs no Shift.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control || input.alt || input.meta) return;
    if (input.code === 'Equal' || input.code === 'NumpadAdd') {
      event.preventDefault();
      mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() + 1);
    } else if (input.code === 'Numpad0' && !input.shift) {
      // Match Electron's original Ctrl+0: reset the entire window zoom.
      event.preventDefault();
      mainWindow.webContents.setZoomLevel(0);
    } else if (input.code === 'NumpadSubtract' && !input.shift) {
      // Match the existing native Ctrl+- zoom-out behavior.
      event.preventDefault();
      mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() - 1);
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL() && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  const send = action => mainWindow.webContents.send('menu:action', action);
  const editHistory = async action => {
    const inTextField = await mainWindow.webContents.executeJavaScript(
      "(() => { const el = document.activeElement; return !!el && (el.matches('textarea, input:not([type=checkbox]):not([type=radio]):not([type=button]), [contenteditable=true]') || !!el.closest('[contenteditable=true]')); })()"
    ).catch(() => false);
    if (inTextField) mainWindow.webContents[action]();
    else send(action);
  };
  const menu = Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: () => send('new') },
      { label: 'Open Project…', accelerator: 'CmdOrCtrl+O', click: () => send('open') },
      { type: 'separator' },
      { label: 'Save Project', accelerator: 'CmdOrCtrl+S', click: () => send('save') },
      { label: 'Save Project As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('saveAs') },
      { type: 'separator' },
      { role: 'quit' }
    ]},
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => editHistory('undo') },
      { label: 'Redo', accelerator: 'CmdOrCtrl+Y', click: () => editHistory('redo') },
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
      { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: async () => {
        const inTextField = await mainWindow.webContents.executeJavaScript(
          "(() => { const el = document.activeElement; return !!el && (el.matches('textarea, input:not([type=checkbox]):not([type=radio]):not([type=button]), [contenteditable=true]') || !!el.closest('[contenteditable=true]')); })()"
        ).catch(() => false);
        if (inTextField) mainWindow.webContents.selectAll();
        else send('selectAll');
      } }
    ]},
    { label: 'View', submenu: [
      { role: 'togglefullscreen' },
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' }
    ]},
    { label: 'Help', submenu: [
      { label: 'Install Update Package…', click: installLocalUpdate },
      { type: 'separator' },
      { label: `About FRAME Studio ${app.getVersion()}`, enabled: false }
    ]}
  ]);
  Menu.setApplicationMenu(menu);
}

// Handle Ctrl+mousewheel as native window zoom, not canvas-only zoom.
ipcMain.handle('window:zoom-reset', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if(!win || win.isDestroyed()) return;
  win.webContents.setZoomLevel(0);
});

ipcMain.handle('window:zoom-step', (event, step) => {
  if(!Number.isFinite(step) || (step !== 1 && step !== -1)) return;
  const win = BrowserWindow.fromWebContents(event.sender);
  if(!win || win.isDestroyed()) return;
  const contents = win.webContents;
  const level = contents.getZoomLevel();
  contents.setZoomLevel(Math.max(-6, Math.min(6, level + step)));
});

ipcMain.handle('project:save', async (_event, { project, saveAs, suggestedName }) => saveProject(project, saveAs, suggestedName));

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open FRAME Studio Project',
    properties: ['openFile'],
    filters: [{ name: 'FRAME Studio Project', extensions: ['frame', 'json'] }]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  const filePath = result.filePaths[0];
  const project = safeParseProject(fs.readFileSync(filePath, 'utf8'));
  currentProjectPath = filePath;
  setAttachedPath(filePath);
  rememberProject(filePath);
  fs.writeFileSync(autosaveOriginPath(), JSON.stringify({path:filePath}), 'utf8');
  await writeProject(project, autosavePath());
  return { canceled: false, path: filePath, name: path.basename(filePath), project };
});

ipcMain.handle('project:recent', async () => getRecentProjects().map(filePath => ({
  path: filePath,
  name: path.basename(filePath)
})));

// The Studio home screen is backed by existing .frame files, not IndexedDB.
ipcMain.handle('project:library', async () => getStudioLibrary());
ipcMain.handle('project:backup-recent', async (_event, filePath) => {
  if(typeof filePath !== 'string' || !getRecentProjects().includes(filePath)) throw new Error('Project not found in Your Work.');
  const result=await dialog.showSaveDialog(mainWindow,{
    title:'Export FRAME Backup',defaultPath:path.basename(filePath).replace(/\.(frame|json)$/i,'')+'-backup.frame',
    filters:[{name:'FRAME project backup',extensions:['frame']}]
  });
  if(result.canceled || !result.filePath)return {canceled:true};
  if(path.resolve(filePath).toLowerCase()===path.resolve(result.filePath).toLowerCase())throw new Error('Choose a different file for the backup.');
  fs.copyFileSync(filePath,result.filePath);
  return {ok:true,name:path.basename(result.filePath)};
});
ipcMain.handle('project:delete-recent', async (_event, filePath) => {
  if(typeof filePath !== 'string' || !getRecentProjects().includes(filePath)) throw new Error('Project not found in Your Work.');
  const decision=await dialog.showMessageBox(mainWindow,{
    type:'warning',buttons:['Cancel','Move to Recycle Bin'],defaultId:0,cancelId:0,noLink:true,
    title:'Delete FRAME project',message:`Move ${path.basename(filePath)} to the Recycle Bin?`,
    detail:`The .frame file will be moved from:\n${filePath}\n\nThis won't delete a separate backup.`
  });
  if(decision.response!==1)return {canceled:true};
  await shell.trashItem(filePath);
  fs.writeFileSync(recentProjectsPath(),JSON.stringify(getRecentProjects().filter(entry=>entry!==filePath),null,2),'utf8');
  if(currentProjectPath===filePath){currentProjectPath=null;setAttachedPath(null);fs.writeFileSync(autosaveOriginPath(),JSON.stringify({path:null}),'utf8');}
  return {ok:true};
});

ipcMain.handle('project:open-recent', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !getRecentProjects().includes(filePath)) {
    throw new Error('This project is not in your recent projects.');
  }
  // Read first; an invalid file must never replace the active project.
  const project = safeParseProject(fs.readFileSync(filePath, 'utf8'));
  currentProjectPath = filePath;
  setAttachedPath(filePath);
  rememberProject(filePath);
  fs.writeFileSync(autosaveOriginPath(), JSON.stringify({path:filePath}), 'utf8');
  return { canceled: false, path: filePath, name: path.basename(filePath), project };
});

ipcMain.handle('project:rename', async (_event, proposedName) => {
  if (typeof proposedName !== 'string') return { ok: false, error: 'Invalid project name.' };
  const name = proposedName.trim();
  if (!name || name === '.' || name === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)) {
    return { ok: false, error: 'Choose a valid Windows filename.' };
  }
  if (!currentProjectPath) return { ok: false, unsaved: true, error: 'Save the project before renaming it.' };
  const oldPath = currentProjectPath;
  const extension = path.extname(oldPath) || '.frame';
  const nextName = name.toLowerCase().endsWith(extension.toLowerCase()) ? name : name + extension;
  const nextPath = path.join(path.dirname(oldPath), nextName);
  if (nextPath === oldPath) return { ok: true, path: oldPath, name: path.basename(oldPath) };
  if (fs.existsSync(nextPath) && nextPath.toLowerCase() !== oldPath.toLowerCase()) {
    return { ok: false, error: 'A project with that name already exists.' };
  }
  try {
    fs.renameSync(oldPath, nextPath);
    currentProjectPath = nextPath;
    setAttachedPath(nextPath);
    replaceRecentProject(oldPath, nextPath);
    fs.writeFileSync(autosaveOriginPath(), JSON.stringify({path:nextPath}), 'utf8');
    return { ok: true, path: nextPath, name: path.basename(nextPath) };
  } catch (error) { return { ok: false, error: error.message }; }
});

ipcMain.handle('project:new', async () => {
  currentProjectPath = null;
  setAttachedPath(null);
  fs.rmSync(autosaveOriginPath(), {force:true});
  fs.rmSync(autosavePath(), {force:true});
  return { ok: true };
});

ipcMain.handle('project:autosave', async (_event, project) => {
  try {
    await writeProject(project, autosavePath());
    // Path association is written alongside each autosave, including a null path
    // for unsaved projects, so stale project links cannot be restored accidentally.
    fs.writeFileSync(autosaveOriginPath(), JSON.stringify({path:currentProjectPath}), 'utf8');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle('project:load-autosave', async () => {
  try {
    const file = autosavePath();
    if (!fs.existsSync(file)) return { found: false };
    let originalPath = null;
    let originRecordFound = false;
    try {
      const metadata = JSON.parse(fs.readFileSync(autosaveOriginPath(), 'utf8'));
      if (Object.prototype.hasOwnProperty.call(metadata, 'path')) {
        originRecordFound = true;
        if (typeof metadata.path === 'string' && fs.existsSync(metadata.path)) originalPath = metadata.path;
      }
    } catch {}
    // Compatibility: older autosaves may predate autosave-origin.json.
    // Never infer an attachment for an explicitly unlinked new project.
    if (!originRecordFound) originalPath = restoreAttachedPath();
    currentProjectPath = originalPath;
    return { found: true, project: safeParseProject(fs.readFileSync(file, 'utf8')),
      path: originalPath, name: originalPath ? path.basename(originalPath) : 'Untitled.frame' };
  } catch (error) {
    return { found: false, error: error.message };
  }
});

ipcMain.handle('project:info', async () => ({
  path: currentProjectPath,
  name: currentProjectPath ? path.basename(currentProjectPath) : 'Untitled.frame'
}));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
