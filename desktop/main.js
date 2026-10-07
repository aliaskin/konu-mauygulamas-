// Kanka Chat masaüstü uygulaması (Electron kabuğu).
//
// Arayüz her açılışta web sürümünden yüklenir: web'e gelen her güncelleme uygulamaya da kendiliğinden
// gelir. Kabuk, tarayıcının veremediği özellikleri ekler:
//  - oyun içindeyken de çalışan bas-konuş (genel klavye/fare kancası) ve genel kısayollar
//  - kendi ekran seçicisi; Windows'ta bilgisayar sesi kutucuk işaretlemeden otomatik alınır
//  - sistem tepsisi, Windows ile başlama, görev çubuğu rozeti, arka planda yavaşlamama
const {
  app, BrowserWindow, Tray, Menu, nativeImage, globalShortcut, ipcMain, session,
  desktopCapturer, shell, screen, powerSaveBlocker, webFrameMain
} = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const APP_URL = process.env.KANKA_URL || 'https://aliaskin.github.io/konu-mauygulamas-/'
const APP_ORIGIN = new URL(APP_URL).origin
const ICON = path.join(__dirname, 'build', 'icon.png')
const BADGE = path.join(__dirname, 'build', 'badge.png')
const isWin = process.platform === 'win32'
const HOTKEYS = {mute: 'CommandOrControl+Shift+M', deafen: 'CommandOrControl+Shift+D'}

// Dizüstülerde harici ekran kartını kullan (donanım kodlayıcı); küçültülünce zamanlayıcılar yavaşlamasın
app.commandLine.appendSwitch('force_high_performance_gpu')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
if (isWin) app.setAppUserModelId('io.github.aliaskin.kankachat')

let win = null
let tray = null
let picker = null
let pickerDone = null
let quitting = false
let state = {muted: false, deafened: false, inVoice: false, unread: 0}
let sleepBlock = null
let updateReady = null
let updater = null
const canAutoStart = process.platform === 'win32' || process.platform === 'darwin'

// ---------- tercihler (userData/desktop.json) ----------
const PREFS_FILE = path.join(app.getPath('userData'), 'desktop.json')
const prefs = {closeToTray: true, hotkeys: true, adblock: true, bounds: null, maximized: false, trayTipShown: false}
try { Object.assign(prefs, JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8'))) } catch {}
let prefsT = null
function savePrefs() {
  clearTimeout(prefsT)
  prefsT = setTimeout(() => { try { fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs)) } catch {} }, 300)
}

const originOf = url => { try { return new URL(url).origin } catch { return '' } }
const fromApp = e => !!e.senderFrame && originOf(e.senderFrame.url) === APP_ORIGIN
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data) }
const openExternal = url => { if (/^https?:\/\//i.test(url)) shell.openExternal(url) }

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  app.whenReady().then(start)
}

function start() {
  Menu.setApplicationMenu(null)
  setupSession()
  createWindow()
  createTray()
  registerHotkeys()
  setupUpdates()
  app.on('activate', showWindow)
}
app.on('before-quit', () => { quitting = true })
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  stopHook()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

// ---------- pencere ----------
function visibleBounds(b) {
  if (!b || !(b.width > 300) || !(b.height > 200)) return null
  const ok = screen.getAllDisplays().some(d => {
    const a = d.workArea
    return b.x < a.x + a.width - 50 && b.x + b.width > a.x + 50 && b.y < a.y + a.height - 50 && b.y + b.height > a.y
  })
  return ok ? b : null
}
function createWindow() {
  const b = visibleBounds(prefs.bounds)
  win = new BrowserWindow({
    width: b ? b.width : 1280,
    height: b ? b.height : 800,
    x: b ? b.x : undefined,
    y: b ? b.y : undefined,
    minWidth: 940,
    minHeight: 560,
    title: 'Kanka Chat',
    icon: ICON,
    backgroundColor: '#1e1f22',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: false
    }
  })
  // maximize() gizli pencereyi de gösterir; bu yüzden yalnızca gösterirken uygulanır
  win.once('ready-to-show', () => {
    if (process.argv.includes('--hidden')) return
    if (prefs.maximized) win.maximize()
    win.show()
  })

  const wc = win.webContents
  setupAdBlock(wc)
  // Yalnızca uygulamanın kendi adresi pencerede açılır; diğer linkler varsayılan tarayıcıda
  wc.setWindowOpenHandler(({url}) => { openExternal(url); return {action: 'deny'} })
  wc.on('will-navigate', (e, url) => {
    if (originOf(url) !== APP_ORIGIN) { e.preventDefault(); openExternal(url) }
  })
  wc.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (isMain && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'), {query: {url: APP_URL, err: String(desc || code)}})
  })
  wc.on('render-process-gone', (e, d) => { if (d.reason !== 'clean-exit') setTimeout(() => wc.reload(), 1000) })
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return
    const k = input.key.toLowerCase()
    if (k === 'f5' || (input.control && k === 'r')) { e.preventDefault(); wc.reload() }
    else if (input.control && input.shift && k === 'i') { e.preventDefault(); wc.toggleDevTools() }
    else if (input.control && (k === '=' || k === '+')) { e.preventDefault(); wc.setZoomLevel(wc.getZoomLevel() + 0.5) }
    else if (input.control && k === '-') { e.preventDefault(); wc.setZoomLevel(wc.getZoomLevel() - 0.5) }
    else if (input.control && k === '0') { e.preventDefault(); wc.setZoomLevel(0) }
  })
  win.on('focus', () => win.flashFrame(false))
  const sendVis = () => { if (win && !win.isDestroyed()) send('vis', !win.isVisible() || win.isMinimized()) }
  for (const ev of ['show', 'hide', 'minimize', 'restore']) win.on(ev, sendVis)
  wc.on('did-finish-load', sendVis)
  // Pencere odağı kaybolunca, genel kanca tuşu göremiyorsa bas-konuşu bırak (takılı kalmasın)
  win.on('blur', () => { if (ptt.enabled && !pttGlobalActive()) send('ptt', false) })
  const remember = () => {
    if (win.isDestroyed()) return
    prefs.maximized = win.isMaximized()
    if (!prefs.maximized && !win.isMinimized()) prefs.bounds = win.getBounds()
    savePrefs()
  }
  win.on('resize', remember)
  win.on('move', remember)
  win.on('close', e => {
    remember()
    if (!quitting && prefs.closeToTray && tray) {
      e.preventDefault()
      win.hide()
      if (!prefs.trayTipShown && isWin) {
        tray.displayBalloon({title: 'Kanka Chat', content: 'Arka planda çalışmaya devam ediyor. Tamamen kapatmak için tepsideki simgeye sağ tıklayıp Çıkış de.'})
        prefs.trayTipShown = true
        savePrefs()
      }
    }
  })
  win.on('closed', () => { win = null })
  win.loadURL(APP_URL)
}
function showWindow() {
  if (!win) return createWindow()
  if (win.isMinimized()) win.restore()
  if (!win.isVisible() && prefs.maximized && !win.isMaximized()) win.maximize()
  win.show()
  win.focus()
}

// ---------- izinler ve ekran paylaşımı ----------
const ALLOWED = new Set(['media', 'display-capture', 'notifications', 'fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'speaker-selection'])
function setupSession() {
  const ses = session.defaultSession
  ses.setPermissionRequestHandler((wc, perm, cb, details) => {
    cb(originOf(details.requestingUrl || wc.getURL()) === APP_ORIGIN && ALLOWED.has(perm))
  })
  ses.setPermissionCheckHandler((wc, perm, origin) => originOf(origin) === APP_ORIGIN && ALLOWED.has(perm))
  // Reklam ve reklam izleme adresleri (yalnızca bu adreslerde çağrılır, diğer trafiğe dokunmaz)
  ses.webRequest.onBeforeRequest({urls: AD_URLS}, (d, cb) => cb({cancel: !!prefs.adblock}))
  // Web sayfası getDisplayMedia çağırınca kendi seçicimizi aç
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    // Geri çağrı yalnızca bir kez çağrılabilir; reddetmek için null (sayfa AbortError alır)
    let answered = false
    const reply = v => { if (answered) return; answered = true; try { callback(v) } catch {} }
    try {
      if (originOf(request.securityOrigin || (request.frame && request.frame.url) || '') !== APP_ORIGIN) return reply(null)
      const choice = await pickSource(!!request.audioRequested)
      if (!choice) return reply(null)
      const sources = await desktopCapturer.getSources({types: ['screen', 'window'], thumbnailSize: {width: 0, height: 0}})
      const src = sources.find(s => s.id === choice.id)
      if (!src) return reply(null)
      // Windows: 'loopback' tüm bilgisayar sesini alır (oyun sesi). Sohbet seslerinin geri yankısını
      // web uygulamasındaki yankı koruması temizler.
      reply(choice.audio && isWin && request.audioRequested ? {video: src, audio: 'loopback'} : {video: src})
    } catch {
      reply(null)
    }
  }, {useSystemPicker: false})
}

function pickSource(audioRequested) {
  if (picker) { picker.focus(); return Promise.resolve(null) }
  return new Promise(resolve => {
    let done = false
    pickerDone = r => {
      if (done) return
      done = true
      pickerDone = null
      resolve(r)
      if (picker && !picker.isDestroyed()) picker.close()
    }
    picker = new BrowserWindow({
      parent: win || undefined,
      modal: !!win,
      width: 860,
      height: 620,
      minWidth: 640,
      minHeight: 480,
      title: 'Ekran paylaş',
      icon: ICON,
      backgroundColor: '#313338',
      autoHideMenuBar: true,
      minimizable: false,
      maximizable: false,
      show: false,
      webPreferences: {preload: path.join(__dirname, 'picker-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false}
    })
    picker.on('closed', () => { picker = null; if (pickerDone) pickerDone(null) })
    picker.once('ready-to-show', () => picker && picker.show())
    picker.webContents.setWindowOpenHandler(() => ({action: 'deny'}))
    picker.webContents.on('will-navigate', e => e.preventDefault())
    picker.loadFile(path.join(__dirname, 'picker.html'), {query: {audio: audioRequested && isWin ? '1' : '0', canAudio: isWin ? '1' : '0', requested: audioRequested ? '1' : '0'}})
  })
}
const fromPicker = e => !!picker && e.sender === picker.webContents
ipcMain.handle('picker:sources', async e => {
  if (!fromPicker(e)) return []
  const list = await desktopCapturer.getSources({types: ['screen', 'window'], thumbnailSize: {width: 384, height: 216}, fetchWindowIcons: true})
  const selfIds = new Set([win, picker].filter(Boolean).map(w => w.getMediaSourceId()))
  return list
    .filter(s => !selfIds.has(s.id) && !(s.id.startsWith('window') && s.thumbnail.isEmpty()))
    .map(s => ({
      id: s.id,
      name: s.name,
      type: s.id.startsWith('screen') ? 'screen' : 'window',
      thumb: s.thumbnail.isEmpty() ? '' : 'data:image/jpeg;base64,' + s.thumbnail.toJPEG(72).toString('base64'),
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : ''
    }))
})
ipcMain.on('picker:choose', (e, r) => {
  if (!fromPicker(e) || !pickerDone) return
  pickerDone(r && typeof r.id === 'string' ? {id: r.id, audio: !!r.audio} : null)
})

// ---------- genel kısayollar (oyun içindeyken de) ----------
function registerHotkeys() {
  globalShortcut.unregisterAll()
  if (!prefs.hotkeys) return
  for (const [name, acc] of Object.entries(HOTKEYS)) {
    try { globalShortcut.register(acc, () => send('hotkey', name)) } catch {}
  }
}

// ---------- genel bas-konuş: oyun öndeyken de tuşu dinler (uiohook-napi) ----------
// Kanca yalnızca bas-konuş açıkken çalışır ve sadece seçilen tuşun basılıp bırakıldığına bakar.
let hook = null
let hookOn = false
// key: KeyboardEvent.code ('KeyV') veya 'Mouse4'; raw: kancanın kendi gördüğü kod ({k} tuş / {b} fare) —
// klavye düzeninden bağımsız eşleşme için tuş atanırken kaydedilir
let ptt = {enabled: false, key: null, raw: null}
let pttDown = false
let capture = null
const keyIs = e => {
  if (!ptt.key) return false
  if (ptt.raw && ptt.raw.k) return e.keycode === ptt.raw.k
  return !ptt.key.startsWith('Mouse') && e.keycode === uioKey(ptt.key)
}
const btnIs = e => {
  if (!ptt.key) return false
  if (ptt.raw && ptt.raw.b) return e.button === ptt.raw.b
  return ptt.key.startsWith('Mouse') && e.button === Number(ptt.key.slice(5))
}
function loadHook() {
  if (hook === null) {
    try {
      hook = require('uiohook-napi')
      hook.uIOhook.on('keydown', e => { if (capture) return capture({k: e.keycode}); if (keyIs(e)) setPtt(true) })
      hook.uIOhook.on('keyup', e => { if (keyIs(e)) setPtt(false) })
      hook.uIOhook.on('mousedown', e => { if (capture && e.button >= 3) return capture({b: e.button}); if (btnIs(e)) setPtt(true) })
      hook.uIOhook.on('mouseup', e => { if (btnIs(e)) setPtt(false) })
    } catch {
      hook = false
    }
  }
  return hook
}
// Kanca şu an seçili tuşu görebiliyor mu?
const pttGlobalActive = () => hookOn && !!ptt.key && (!!ptt.raw || ptt.key.startsWith('Mouse') || uioKey(ptt.key) !== undefined)
// KeyboardEvent.code → uiohook tuş kodu
function uioKey(code) {
  const K = hook && hook.UiohookKey
  if (!K || typeof code !== 'string') return undefined
  let m
  if ((m = code.match(/^Key([A-Z])$/))) return K[m[1]]
  if ((m = code.match(/^Digit([0-9])$/))) return K[m[1]]
  if ((m = code.match(/^F([0-9]{1,2})$/))) return K['F' + m[1]]
  if ((m = code.match(/^Numpad([0-9])$/))) return K['Numpad' + m[1]]
  const map = {
    Space: 'Space', Tab: 'Tab', CapsLock: 'CapsLock', Backquote: 'Backquote', Minus: 'Minus', Equal: 'Equal',
    BracketLeft: 'BracketLeft', BracketRight: 'BracketRight', Backslash: 'Backslash', Semicolon: 'Semicolon',
    Quote: 'Quote', Comma: 'Comma', Period: 'Period', Slash: 'Slash', Enter: 'Enter', Backspace: 'Backspace',
    Escape: 'Escape', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
    ShiftLeft: 'Shift', ShiftRight: 'ShiftRight', ControlLeft: 'Ctrl', ControlRight: 'CtrlRight',
    AltLeft: 'Alt', AltRight: 'AltRight', MetaLeft: 'Meta', MetaRight: 'MetaRight',
    NumpadAdd: 'NumpadAdd', NumpadSubtract: 'NumpadSubtract', NumpadMultiply: 'NumpadMultiply',
    NumpadDivide: 'NumpadDivide', NumpadDecimal: 'NumpadDecimal', NumpadEnter: 'NumpadEnter',
    ScrollLock: 'ScrollLock', PrintScreen: 'PrintScreen', NumLock: 'NumLock'
  }
  return map[code] ? K[map[code]] : undefined
}
function setPtt(down) {
  if (down === pttDown) return
  pttDown = down
  send('ptt', down)
}
function updatePtt() {
  const want = ptt.enabled && !!ptt.key
  if (want && !hookOn) {
    const h = loadHook()
    if (!h) return
    try { h.uIOhook.start(); hookOn = true } catch {}
  } else if (!want && hookOn) {
    stopHook()
  }
  if (!want) setPtt(false)
}
function stopHook() {
  if (!hookOn) return
  try { hook.uIOhook.stop() } catch {}
  hookOn = false
  // Kanca dururken bekleyen bırakma olayı kaybolabilir: basılı kaldıysa bırakıldı say
  setPtt(false)
}

// ---------- sistem tepsisi, rozet, Windows ile başlama ----------
function createTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(ICON).resize({width: 32, height: 32}))
  } catch {
    tray = null
    return
  }
  tray.on('click', showWindow)
  updateTray()
}
const loginPath = () => process.env.PORTABLE_EXECUTABLE_FILE || process.execPath
const autoStart = () => { try { return app.getLoginItemSettings({path: loginPath(), args: ['--hidden']}).openAtLogin } catch { return false } }
function setAutoStart(on) {
  try { app.setLoginItemSettings({openAtLogin: !!on, path: loginPath(), args: ['--hidden']}) } catch {}
  updateTray()
}
function updateTray() {
  if (!tray) return
  tray.setToolTip(state.unread ? `Kanka Chat (${state.unread} yeni)` : 'Kanka Chat')
  tray.setContextMenu(Menu.buildFromTemplate([
    {label: 'Kanka Chat\'i aç', click: showWindow},
    {type: 'separator'},
    {label: state.muted ? 'Mikrofonu aç' : 'Mikrofonu kapat', enabled: state.inVoice, click: () => send('hotkey', 'mute')},
    {label: state.deafened ? 'Sesi aç (sağırlaştırmayı kaldır)' : 'Sağırlaştır', click: () => send('hotkey', 'deafen')},
    {type: 'separator'},
    ...(canAutoStart ? [{label: 'Bilgisayar açılınca başlat', type: 'checkbox', checked: autoStart(), click: i => setAutoStart(i.checked)}] : []),
    {label: 'Kapatınca tepsiye küçült', type: 'checkbox', checked: prefs.closeToTray, click: i => { prefs.closeToTray = i.checked; savePrefs() }},
    {type: 'separator'},
    ...(updateReady ? [{label: `Güncellemeyi kur ve yeniden başlat (${updateReady})`, click: () => { quitting = true; updater.quitAndInstall() }}] : []),
    {label: 'Çıkış', click: () => { quitting = true; app.quit() }}
  ]))
}
let badgeImg = null
function updateBadge(prev) {
  if (!win || win.isDestroyed()) return
  if (isWin) {
    badgeImg ||= nativeImage.createFromPath(BADGE)
    win.setOverlayIcon(state.unread ? badgeImg : null, state.unread ? `${state.unread} okunmamış bahsetme` : '')
  } else {
    try { app.setBadgeCount(state.unread) } catch {}
  }
  if (state.unread > prev && !win.isFocused()) win.flashFrame(true)
}

// ---------- web uygulamasıyla iletişim ----------
ipcMain.on('app:state', (e, s) => {
  if (!fromApp(e) || !s || typeof s !== 'object') return
  const prev = state.unread
  state = {
    muted: !!s.muted,
    deafened: !!s.deafened,
    inVoice: !!s.inVoice,
    unread: Math.max(0, Math.min(999, Math.floor(Number(s.unread) || 0)))
  }
  updateTray()
  updateBadge(prev)
  // Sesli sohbetteyken bilgisayar uygulamayı askıya almasın
  if (state.inVoice && sleepBlock === null) sleepBlock = powerSaveBlocker.start('prevent-app-suspension')
  else if (!state.inVoice && sleepBlock !== null) { powerSaveBlocker.stop(sleepBlock); sleepBlock = null }
})
ipcMain.on('app:ptt', (e, p) => {
  if (!fromApp(e)) return
  const raw = p && p.raw && typeof p.raw === 'object' ? p.raw : null
  ptt = {
    enabled: !!(p && p.enabled),
    key: p && typeof p.key === 'string' ? p.key.slice(0, 32) : null,
    raw: raw && Number.isInteger(raw.k) ? {k: raw.k} : raw && Number.isInteger(raw.b) ? {b: raw.b} : null
  }
  updatePtt()
})
// Bas-konuş tuşu atanırken kancanın gördüğü kodu da yakala (10 sn içinde basılan ilk tuş / fare yan tuşu)
ipcMain.handle('app:captureKey', e => {
  if (!fromApp(e)) return null
  const h = loadHook()
  if (!h) return null
  if (capture) capture(null)
  return new Promise(resolve => {
    const wasOn = hookOn
    if (!hookOn) {
      try { h.uIOhook.start(); hookOn = true } catch { return resolve(null) }
    }
    const t = setTimeout(() => finish(null), 10000)
    function finish(r) {
      clearTimeout(t)
      capture = null
      if (!wasOn && !(ptt.enabled && ptt.key)) stopHook()
      resolve(r)
    }
    capture = finish
  })
})
ipcMain.on('app:setPref', (e, p) => {
  if (!fromApp(e) || !p) return
  if (p.key === 'autoStart') setAutoStart(!!p.value)
  else if (p.key === 'closeToTray') { prefs.closeToTray = !!p.value; savePrefs(); updateTray() }
  else if (p.key === 'hotkeys') { prefs.hotkeys = !!p.value; savePrefs(); registerHotkeys() }
  else if (p.key === 'adblock') { prefs.adblock = !!p.value; savePrefs(); applyAdBlockToOpenFrames() }
})
ipcMain.handle('app:prefs', e => {
  if (!fromApp(e)) return null
  return {
    version: app.getVersion(),
    platform: process.platform,
    autoStart: canAutoStart && autoStart(),
    autoStartSupported: canAutoStart,
    closeToTray: prefs.closeToTray,
    hotkeys: prefs.hotkeys,
    adblock: prefs.adblock,
    hotkeyNames: HOTKEYS,
    globalPtt: !!loadHook(),
    updateReady,
    systemAudio: isWin
  }
})

// ---------- otomatik güncelleme (kurulu Windows sürümü ve AppImage) ----------
// Arayüz zaten her açılışta web'den güncel gelir; bu, uygulama kabuğunu (Electron/Chromium güvenlik
// düzeltmeleri dahil) GitHub Releases'ten arka planda günceller ve kapanışta kurar.
function setupUpdates() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_FILE) return
  if (process.platform === 'linux' && !process.env.APPIMAGE) return
  try { updater = require('electron-updater').autoUpdater } catch { return }
  updater.autoDownload = true
  updater.autoInstallOnAppQuit = true
  updater.on('error', () => {})
  updater.on('update-downloaded', info => {
    updateReady = info && info.version ? String(info.version) : 'yeni'
    updateTray()
    send('update', updateReady)
    if (isWin && tray) tray.displayBalloon({title: 'Kanka Chat güncellemesi hazır', content: `Sürüm ${updateReady} indirildi; uygulama kapanınca kurulacak.`})
  })
  const check = () => { try { updater.checkForUpdates().catch(() => {}) } catch {} }
  setTimeout(check, 15000)
  setInterval(check, 6 * 3600 * 1000)
}

// ---------- müzik botunda YouTube reklamlarını engelleme ----------
// Reklamlar normal videoyla aynı sunuculardan geldiği için yalnızca ağ engellemesi yetmez. YouTube
// oynatıcısı her şarkı için sunucudan bir "player" yanıtı alır; reklam yerleşimleri bu yanıttadır.
// Ana süreç, YouTube çerçevesinin içine (köprü açmadan) bu yanıtlardaki reklam alanlarını silen küçük
// bir betik yerleştirir; oynatıcı reklam olmadığını düşünüp doğrudan şarkıyı çalar.
const AD_URLS = [
  '*://*.doubleclick.net/*', '*://*.googlesyndication.com/*', '*://*.googleadservices.com/*',
  '*://*.youtube.com/api/stats/ads*', '*://*.youtube.com/pagead/*', '*://*.youtube.com/get_midroll_*',
  '*://*.youtube-nocookie.com/api/stats/ads*', '*://*.youtube-nocookie.com/pagead/*'
]
const YT_HOST = /(^|\.)youtube(-nocookie)?\.com$/i
// YouTube çerçevesinin ana dünyasında çalışır (toString ile enjekte edilir)
function noAdsInFrame() {
  if (window.__kankaNoAds) return
  window.__kankaNoAds = true
  const KEYS = ['adPlacements', 'adSlots', 'playerAds', 'adBreakHeartbeatParams', 'adBreakParams']
  // Ayar kapatılınca açık çerçevede de etkisiz kalsın diye her seferinde bakılır
  const off = () => window.__kankaNoAdsOff === true
  const strip = o => {
    if (off() || !o || typeof o !== 'object') return o
    for (const k of KEYS) if (k in o) { try { delete o[k] } catch (e) {} }
    if (o.playerResponse && typeof o.playerResponse === 'object') strip(o.playerResponse)
    if (Array.isArray(o)) for (const x of o) if (x && typeof x === 'object' && (x.playerResponse || x.adPlacements)) strip(x)
    return o
  }
  const isPlayer = u => /\/youtubei\/v1\/player/.test(String(u && u.url ? u.url : u))
  const parse = JSON.parse
  JSON.parse = new Proxy(parse, {apply(t, self, args) { const r = Reflect.apply(t, self, args); try { strip(r) } catch (e) {} return r }})
  const rjson = Response.prototype.json
  Response.prototype.json = new Proxy(rjson, {apply(t, self, args) { return Reflect.apply(t, self, args).then(r => { try { strip(r) } catch (e) {} return r }) }})
  // player yanıtını metin olarak okuyanlar için: yanıtı temizlenmiş JSON ile değiştir
  const ofetch = window.fetch
  window.fetch = new Proxy(ofetch, {apply(t, self, args) {
    const p = Reflect.apply(t, self, args)
    if (off() || !isPlayer(args[0])) return p
    return p.then(res => res.clone().text().then(txt => {
      try {
        const clean = JSON.stringify(strip(parse(txt)))
        const out = new Response(clean, {status: res.status, statusText: res.statusText, headers: res.headers})
        try { Object.defineProperty(out, 'url', {value: res.url}) } catch (e) {}
        return out
      } catch (e) { return res }
    }).catch(() => res))
  }})
  // XHR ile alınan player yanıtları
  const XP = XMLHttpRequest.prototype
  const oopen = XP.open
  XP.open = function (m, url) { this.__kankaPlayer = isPlayer(url); return oopen.apply(this, arguments) }
  for (const prop of ['responseText', 'response']) {
    const d = Object.getOwnPropertyDescriptor(XP, prop)
    if (!d || !d.get) continue
    Object.defineProperty(XP, prop, {configurable: true, enumerable: d.enumerable, get() {
      const v = d.get.call(this)
      if (off() || !this.__kankaPlayer || this.readyState !== 4) return v
      try { return typeof v === 'string' ? JSON.stringify(strip(parse(v))) : strip(v) } catch (e) { return v }
    }})
  }
  // Sayfaya gömülü ilk oynatıcı verisi
  for (const name of ['ytInitialPlayerResponse', 'playerResponse']) {
    let v = window[name]
    if (v) strip(v)
    try { Object.defineProperty(window, name, {configurable: true, get: () => v, set: x => { v = strip(x) }}) } catch (e) {}
  }
}
const NOADS_JS = `(${noAdsInFrame.toString()})()`
const isYtFrame = (wc, f) => { try { return f !== wc.mainFrame && !f.detached && YT_HOST.test(new URL(f.url || f.origin).hostname) } catch { return false } }
// Ayar değişince o an açık YouTube çerçevelerine de hemen uygula (oynatıcı şarkılar arasında yeniden yüklenmez)
function applyAdBlockToOpenFrames() {
  if (!win || win.isDestroyed()) return
  const wc = win.webContents
  for (const f of wc.mainFrame.framesInSubtree) {
    if (!isYtFrame(wc, f)) continue
    f.executeJavaScript(prefs.adblock ? `window.__kankaNoAdsOff=false;${NOADS_JS}` : 'window.__kankaNoAdsOff=true').catch(() => {})
  }
}
function setupAdBlock(wc) {
  const inject = frame => {
    if (!prefs.adblock || !frame || !isYtFrame(wc, frame)) return
    frame.executeJavaScript(NOADS_JS).catch(() => {})
  }
  // Çerçeve oluşunca ve her gezinmede (YouTube çerçevesi farklı süreçte açılır) yerleştir; betik tekrar çalışmayı yok sayar
  wc.on('frame-created', (_e, d) => { if (d && d.frame) d.frame.on('dom-ready', () => inject(d.frame)) })
  wc.on('did-frame-navigate', (_e, _url, _code, _status, isMain, pid, rid) => {
    if (isMain) return
    try { inject(webFrameMain.fromId(pid, rid)) } catch {}
  })
}
