const { app, BrowserWindow, screen, ipcMain, shell, dialog, clipboard, powerSaveBlocker, globalShortcut } = require('electron');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const https = require('https');

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

// ---- Центр управления ----
const run = (f, a) => execFile(f, a, { windowsHide: true }, () => {});
ipcMain.handle('sys', (_, a) => {
  const c = {
    lock: ['rundll32.exe', ['user32.dll,LockWorkStation']], sleep: ['rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']],
    restart: ['shutdown', ['/r', '/t', '8']], shutdown: ['shutdown', ['/s', '/t', '8']], logout: ['shutdown', ['/l']],
    cancel: ['shutdown', ['/a']], taskmgr: ['taskmgr.exe', []]
  }[a];
  if (c) run(c[0], c[1]);
});
let blk = null;
ipcMain.handle('awake', (_, on) => {
  if (on && blk === null) blk = powerSaveBlocker.start('prevent-display-sleep');
  if (!on && blk !== null) { powerSaveBlocker.stop(blk); blk = null; }
});
ipcMain.handle('ssid', () => new Promise(r => execFile('netsh', ['wlan', 'show', 'interfaces'], { windowsHide: true, timeout: 3000 }, (e, out) => {
  const m = /^\s*SSID\s*:\s*(.+)$/m.exec(out || ''); r(m ? m[1].trim() : '');
})));
ipcMain.on('launch', (_, t) => {
  if (typeof t !== 'string' || !t) return;
  if (/^(https?:|ms-settings:|ms-screenclip:)/i.test(t)) shell.openExternal(t); else shell.openPath(t);
});
const iconOf = async p => { try { return (await app.getFileIcon(p, { size: 'large' })).toDataURL(); } catch { return ''; } };
ipcMain.handle('icon', (_, p) => iconOf(p));
ipcMain.handle('pick-app', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Программы и ярлыки', extensions: ['exe', 'lnk', 'bat', 'url'] }, { name: 'Все файлы', extensions: ['*'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  return { n: path.basename(p).replace(/\.[^.]+$/, ''), p, i: await iconOf(p) };
});
ipcMain.handle('clip', () => clipboard.readText());
ipcMain.handle('clip-set', (_, t) => clipboard.writeText(String(t)));

// ---- Переводчик и погода (бесплатные API без ключей) ----
function httpGet(url, redirs = 3) {
  return new Promise((resolve, reject) => {
    const q = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' }, timeout: 8000 }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirs > 0) { res.resume(); httpGet(res.headers.location, redirs - 1).then(resolve, reject); return; }
      let b = ''; res.setEncoding('utf8'); res.on('data', d => b += d); res.on('end', () => resolve({ code: res.statusCode, body: b }));
    });
    q.on('timeout', () => q.destroy(new Error('timeout'))); q.on('error', reject);
  });
}
const TR_LANGS = new Set(['ru', 'en', 'de', 'fr', 'es', 'uk', 'it']);
ipcMain.handle('translate', async (_, text, to) => {
  text = String(text || '').slice(0, 1500).trim();
  if (!text) return { ok: false };
  to = TR_LANGS.has(to) ? to : 'ru';
  try {
    const r = await httpGet('https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=' + to + '&q=' + encodeURIComponent(text));
    const j = JSON.parse(r.body);
    if (Array.isArray(j) && Array.isArray(j[0])) {
      const pair = typeof j[0][0] === 'string' ? j[0] : (Array.isArray(j[0][0]) ? j[0][0] : null);
      if (pair && pair[0] && pair[0].trim()) return { ok: true, text: pair[0].trim(), src: pair[1] || '' };
    }
  } catch {}
  try {
    const r = await httpGet('https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=auto&tl=' + to + '&q=' + encodeURIComponent(text));
    const j = JSON.parse(r.body); const out = (j[0] || []).map(s => s && s[0] || '').join('').trim();
    if (out) return { ok: true, text: out, src: j[2] };
  } catch {}
  try {
    const src = /[а-яё]/i.test(text) ? 'ru' : 'en';
    const r = await httpGet('https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=' + src + '|' + to);
    const out = (JSON.parse(r.body).responseData || {}).translatedText;
    if (out && !/^MYMEMORY WARNING/i.test(out)) return { ok: true, text: out, src };
  } catch {}
  return { ok: false };
});
let wxCache = { t: 0, loc: '', d: { ok: false } };
ipcMain.handle('wx', async (_, city) => {
  const hasCity = city && isFinite(city.lat) && isFinite(city.lon);
  const loc = hasCity ? (+city.lat).toFixed(3) + '|' + (+city.lon).toFixed(3) : 'ip';
  if (wxCache.d.ok && wxCache.loc === loc && Date.now() - wxCache.t < 600000) return wxCache.d;
  try {
    let lat, lon, cname = '';
    if (hasCity) { lat = +city.lat; lon = +city.lon; cname = city.n || ''; }
    else {
      const g = JSON.parse((await httpGet('https://ipwho.is/')).body);
      if (g && isFinite(g.latitude) && isFinite(g.longitude)) { lat = g.latitude; lon = g.longitude; cname = g.city || g.region || ''; }
    }
    if (isFinite(lat) && isFinite(lon)) {
      const w = JSON.parse((await httpGet('https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m')).body);
      if (w && w.current) {
        wxCache = { t: Date.now(), loc, d: { ok: true, t: w.current.temperature_2m, f: w.current.apparent_temperature, code: w.current.weather_code, wind: w.current.wind_speed_10m, city: cname } };
        return wxCache.d;
      }
    }
  } catch {}
  return { ok: false };
});
ipcMain.handle('wx-geo', async (_, name) => {
  name = String(name || '').trim().slice(0, 60); if (!name) return [];
  try {
    const r = JSON.parse((await httpGet('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(name) + '&count=5&language=ru&format=json')).body);
    return (r.results || []).map(x => ({ n: [...new Set([x.name, x.admin1, x.country].filter(Boolean))].join(', '), lat: x.latitude, lon: x.longitude }));
  } catch { return []; }
});
ipcMain.handle('artweb', async (_, q) => {
  q = String(q || '').trim().slice(0, 120); if (!q) return null;
  try {
    const r = JSON.parse((await httpGet('https://itunes.apple.com/search?term=' + encodeURIComponent(q) + '&entity=song&limit=5')).body);
    const hit = (r.results || []).find(x => x.artworkUrl100);
    if (hit) return hit.artworkUrl100.replace('100x100', '600x600');
  } catch {}
  return null;
});

// ---- Курсы валют ЦБ РФ ----
let fxData = null, fxOkAt = 0, fxTryAt = 0;
ipcMain.handle('fx', async () => {
  if (fxData && (Date.now() - fxOkAt < 3600000 || Date.now() - fxTryAt < 300000)) return fxData;
  fxTryAt = Date.now();
  try {
    const r = JSON.parse((await httpGet('https://www.cbr-xml-daily.ru/daily_json.js')).body);
    const usd = r.Valute && r.Valute.USD && r.Valute.USD.Value, eur = r.Valute && r.Valute.EUR && r.Valute.EUR.Value;
    if (usd && eur) { fxData = { ok: true, usd, eur }; fxOkAt = Date.now(); return fxData; }
  } catch {}
  return fxData || { ok: false };
});

// ---- Топ процессов по CPU ----
ipcMain.handle('ps', () => new Promise(res => {
  const cmd = "$a=@{};Get-Process|ForEach-Object{$a[$_.Id]=$_.CPU};Start-Sleep -Milliseconds 900;Get-Process|Where-Object{$a[$_.Id] -ne $null}|ForEach-Object{$d=$_.CPU-$a[$_.Id];if($d -gt 0){[PSCustomObject]@{i=$_.Id;n=$_.ProcessName;c=[math]::Round((($d/0.9)*100/$env:NUMBER_OF_PROCESSORS),1);m=[math]::Round($_.WorkingSet64/1MB)}}}|Sort-Object c -Descending|Select-Object -First 8|ConvertTo-Json -Compress";
  execFile('powershell', ['-NoProfile', '-Command', cmd], { windowsHide: true, timeout: 6000 }, (e, out) => {
    if (e || !out || !out.trim()) return res(null);
    try { res(JSON.parse(out.trim())); } catch { res(null); }
  });
}));
ipcMain.handle('kill', (_, id) => {
  id = parseInt(id, 10);
  if (!Number.isInteger(id) || id <= 0) return;
  execFile('taskkill', ['/PID', String(id), '/F'], { windowsHide: true }, () => {});
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
let diskC = { t: 0, v: null };
const diskPct = () => {
  if (Date.now() - diskC.t > 10000) { diskC.t = Date.now(); try { const s = fs.statfsSync((process.env.SystemDrive || 'C:') + '\\'); diskC.v = Math.round((1 - s.bavail / s.blocks) * 100); } catch {} }
  return diskC.v;
};
ipcMain.handle('cpu', () => ({ disk: diskPct(),
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

// ---- Помощники PowerShell: музыка и медиа отдельно от громкости и сети ----
function makeHelper(mode) {
  let ap = null, queue = [], buf = '';
  const start = () => {
    if (ap) return ap;
    ap = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(DIR, 'helper.ps1'), '-Mode', mode], { windowsHide: true });
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
  };
  return {
    start,
    send(cmd, res) { const h = start(); const q = { res, t: setTimeout(() => { try { h.kill(); } catch {} }, 20000) }; queue.push(q); h.stdin.write(cmd + '\n'); },
    kill() { try { ap && ap.kill(); } catch {} }
  };
}
const hMusic = makeHelper('music'), hFast = makeHelper('fast');
const OK = /^(music|ctl (toggle|next|prev)|vol get|vol set \d{1,3}|vol mute [01]|radio get|radio (wifi|bt) [01]|br get|br set \d{1,3}|net)$/;
ipcMain.handle('h', (_, cmd) => new Promise(res => {
  if (!OK.test(cmd)) return res(null);
  (/^(vol|net)/.test(cmd) ? hFast : hMusic).send(cmd, res);
}));

// ---- FPS через PresentMon ----
let fpsProc = null, fpsSt = { state: 'off' }, fpsOpts = { on: true, noBrowsers: true };
const frames = new Map(); let fpsBest = null, header = null, gotData = false, fpsBuf = '';
const EXCL = ['dwm.exe', 'explorer.exe', 'searchhost.exe', 'shellexperiencehost.exe', 'startmenuexperiencehost.exe', 'applicationframehost.exe', 'textinputhost.exe', 'lockapp.exe', 'island.exe', 'electron.exe', 'taskmgr.exe', 'presentmon.exe'];
const BROWSERS = ['chrome.exe', 'msedge.exe', 'firefox.exe', 'opera.exe', 'browser.exe', 'brave.exe', 'vivaldi.exe'];
const toolDirs = () => [path.join(app.getPath('userData'), 'tools'), path.join(DIR, 'tools'), DIR, path.dirname(process.execPath)];
function findPM() { for (const d of toolDirs()) { try { const f = fs.readdirSync(d).find(n => /^presentmon.*\.exe$/i.test(n)); if (f) return path.join(d, f); } catch {} } return null; }
const ARGS = [
  ['--output_stdout', '--stop_existing_session', '--no_console_stats', '--session_name', 'IslandFPS'],
  ['--output_stdout', '--stop_existing_session', '--session_name', 'IslandFPS'],
  ['-output_stdout', '-stop_existing_session', '-session_name', 'IslandFPS', '-dont_restart_as_admin'],
  ['-output_stdout', '-stop_existing_session', '-dont_restart_as_admin']
];
function fpsStop() { if (fpsProc) { const p = fpsProc; fpsProc = null; try { p.kill(); } catch {} } frames.clear(); fpsBest = null; }
function fpsLine(l) {
  if (!l) return; const c = l.split(',');
  if (!header) { if (/^Application,/i.test(l)) header = { app: c.indexOf('Application'), ft: Math.max(c.indexOf('FrameTime'), c.indexOf('msBetweenPresents')) }; return; }
  if (header.ft < 0) return; const ft = parseFloat(c[header.ft]); if (!(ft > 0)) return;
  gotData = true; fpsSt = { state: 'running' };
  const a = (c[header.app] || '').toLowerCase(); let arr = frames.get(a); if (!arr) frames.set(a, arr = []); arr.push([Date.now(), ft]);
}
function fpsStart(i = 0) {
  fpsStop();
  if (!fpsOpts.on) { fpsSt = { state: 'off' }; return; }
  const exe = findPM(); if (!exe) { fpsSt = { state: 'nofile' }; return; }
  if (i >= ARGS.length) return;
  header = null; gotData = false; fpsBuf = ''; fpsSt = { state: 'starting' };
  const p = spawn(exe, ARGS[i], { windowsHide: true }); fpsProc = p; let err = '';
  p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
  p.stdout.on('data', d => { fpsBuf += d; let k; while ((k = fpsBuf.indexOf('\n')) >= 0) { fpsLine(fpsBuf.slice(0, k).trim()); fpsBuf = fpsBuf.slice(k + 1); } });
  p.stderr.on('data', d => { err += d; });
  p.on('error', e => { fpsSt = { state: 'error', msg: String(e.message) }; });
  p.on('exit', () => {
    if (fpsProc !== p) return; fpsProc = null;
    if (gotData) { fpsSt = { state: 'error', msg: 'Остановился' }; return; }
    if (/administrator|privilege|Performance Log Users|access is denied|elevat/i.test(err)) fpsSt = { state: 'noaccess' };
    else if (i + 1 < ARGS.length) fpsStart(i + 1); else fpsSt = { state: 'error', msg: err.slice(0, 120) };
  });
}
setInterval(() => {
  const now = Date.now(); let best = null;
  for (const [a, arr] of frames) {
    while (arr.length && now - arr[0][0] > 5000) arr.shift();
    if (!arr.length) { frames.delete(a); continue; }
    if (EXCL.includes(a) || (fpsOpts.noBrowsers && BROWSERS.includes(a))) continue;
    const n = arr.filter(f => now - f[0] <= 1000).length; if (n < 12) continue;
    if (!best || n > best.n) best = { a, n, arr };
  }
  if (!best) { fpsBest = null; return; }
  const fts = best.arr.map(f => f[1]).sort((x, y) => y - x), k = Math.max(1, Math.ceil(fts.length * 0.01));
  const worst = fts.slice(0, k).reduce((s, v) => s + v, 0) / k;
  const rec = best.arr.filter(f => now - f[0] <= 1000), avg = rec.reduce((s, f) => s + f[1], 0) / rec.length;
  fpsBest = { app: best.a.replace(/\.exe$/, ''), fps: Math.round(1000 / avg), low: Math.round(1000 / worst) };
}, 500);
ipcMain.handle('fps', () => fpsBest);
ipcMain.handle('fps-status', () => ({ ...fpsSt, found: !!findPM() }));
ipcMain.handle('fps-ctl', (_, o) => { fpsOpts = Object.assign(fpsOpts, o); fpsStart(); });
ipcMain.handle('fps-folder', () => { const d = path.join(app.getPath('userData'), 'tools'); fs.mkdirSync(d, { recursive: true }); shell.openPath(d); });
ipcMain.handle('fps-setup', () => shell.openPath(path.join(DIR, 'enable-fps.bat')));
ipcMain.on('hotkey', (_, on) => { globalShortcut.unregisterAll(); if (on) globalShortcut.register('Control+Alt+I', () => win && win.webContents.send('hotkey')); });
app.on('quit', () => { hMusic.kill(); hFast.kill(); fpsStop(); globalShortcut.unregisterAll(); });

app.whenReady().then(() => { createWindow(); hFast.start(); hMusic.start(); });
app.on('window-all-closed', () => app.quit());
