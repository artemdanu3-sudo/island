const { app, BrowserWindow, screen, ipcMain } = require('electron');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

// В собранном приложении скрипты лежат вне asar
const DIR = __dirname.replace('app.asar', 'app.asar.unpacked');
let win;
const W = 540, H = 460;

if (!app.requestSingleInstanceLock()) app.quit();

function createWindow() {
  const { width } = screen.getPrimaryDisplay().bounds;
  win = new BrowserWindow({
    width: W, height: H, x: Math.round((width - W) / 2), y: 0,
    frame: false, transparent: true, resizable: false, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.showInactive());
}

ipcMain.on('mouse-over-island', (_, over) => { win.setIgnoreMouseEvents(!over, { forward: true }); win.setFocusable(over); });
ipcMain.on('quit', () => app.quit());
ipcMain.on('get-pos', e => { e.returnValue = win.getPosition(); });
ipcMain.on('set-pos', (_, x, y) => win.setBounds({ x: Math.round(x), y: Math.round(y), width: W, height: H }));
ipcMain.on('center', () => {
  const { x, width } = screen.getPrimaryDisplay().bounds;
  win.setBounds({ x: x + Math.round((width - W) / 2), y: 0, width: W, height: H });
});

// ---- Автозапуск с Windows ----
const loginArgs = () => (app.isPackaged ? [] : [app.getAppPath()]);
ipcMain.handle('auto-get', () => app.getLoginItemSettings({ path: process.execPath, args: loginArgs() }).openAtLogin);
ipcMain.handle('auto-set', (_, on) => app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath, args: loginArgs() }));

// ---- CPU / RAM ----
let prev = os.cpus();
function cpuLoad() {
  const cur = os.cpus(); let idle = 0, total = 0;
  cur.forEach((c, i) => { const p = prev[i]; for (const k in c.times) total += c.times[k] - p.times[k]; idle += c.times.idle - p.times.idle; });
  prev = cur; return total ? Math.round((1 - idle / total) * 100) : 0;
}
ipcMain.handle('cpu', () => ({
  load: cpuLoad(), ramUsed: Math.round((1 - os.freemem() / os.totalmem()) * 100),
  ramGb: ((os.totalmem() - os.freemem()) / 1073741824).toFixed(1), ramTotal: (os.totalmem() / 1073741824).toFixed(0),
  name: os.cpus()[0].model.replace(/\(R\)|\(TM\)|CPU/g, '').replace(/\s+/g, ' ').trim()
}));

// ---- GPU ----
let nvidiaOk = true;
ipcMain.handle('gpu', () => new Promise(resolve => {
  const fallback = () => execFile('powershell', ['-NoProfile', '-Command',
    "((Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage').CounterSamples | Measure-Object CookedValue -Sum).Sum"],
    { timeout: 5000, windowsHide: true }, (e, out) => {
      const v = parseFloat(out); resolve(e || isNaN(v) ? null : { load: Math.min(100, Math.round(v)), temp: null, name: 'GPU' });
    });
  if (!nvidiaOk) return fallback();
  execFile('nvidia-smi', ['--query-gpu=utilization.gpu,temperature.gpu,name', '--format=csv,noheader,nounits'],
    { timeout: 2000, windowsHide: true }, (e, out) => {
      if (e) { nvidiaOk = false; return fallback(); }
      const [load, temp, name] = out.trim().split(',').map(s => s.trim());
      resolve({ load: +load, temp: +temp, name: name.replace('NVIDIA GeForce ', '') });
    });
}));

// ---- Постоянный помощник: музыка, плеер, громкость ----
let ap = null, queue = [], buf = '';
function helper() {
  if (ap) return ap;
  ap = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(DIR, 'helper.ps1')], { windowsHide: true });
  ap.stdout.setEncoding('utf8');
  ap.stdout.on('data', d => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line || line === 'READY') continue;
      const q = queue.shift(); if (q) { clearTimeout(q.t); q.res(line); }
    }
  });
  ap.stderr.on('data', () => {});
  ap.on('exit', () => { ap = null; buf = ''; queue.splice(0).forEach(q => { clearTimeout(q.t); q.res(null); }); });
  return ap;
}
const OK = /^(music|ctl (toggle|next|prev)|vol get|vol set \d{1,3}|vol mute [01])$/;
ipcMain.handle('h', (_, cmd) => new Promise(res => {
  if (!OK.test(cmd)) return res(null);
  const h = helper();
  const q = { res, t: setTimeout(() => { try { h.kill(); } catch {} }, 20000) };
  queue.push(q); h.stdin.write(cmd + '\n');
}));
app.on('quit', () => { try { ap && ap.kill(); } catch {} });

app.whenReady().then(() => { createWindow(); helper(); });
app.on('window-all-closed', () => app.quit());
