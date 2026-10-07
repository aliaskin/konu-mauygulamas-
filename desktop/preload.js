// Web uygulamasına açılan küçük ve güvenli köprü: window.kankaDesktop
const {contextBridge, ipcRenderer} = require('electron')

const listeners = {hotkey: new Set(), ptt: new Set(), vis: new Set(), update: new Set()}
let hidden = false
ipcRenderer.on('hotkey', (_e, name) => { for (const f of listeners.hotkey) f(String(name)) })
ipcRenderer.on('ptt', (_e, down) => { for (const f of listeners.ptt) f(!!down) })
ipcRenderer.on('vis', (_e, h) => { hidden = !!h; for (const f of listeners.vis) f(hidden) })
ipcRenderer.on('update', (_e, v) => { for (const f of listeners.update) f(String(v)) })
const sub = (set, f) => {
  if (typeof f !== 'function') return () => {}
  set.add(f)
  return () => set.delete(f)
}

contextBridge.exposeInMainWorld('kankaDesktop', {
  // web → uygulama
  setState: s => ipcRenderer.send('app:state', s),
  setPtt: p => ipcRenderer.send('app:ptt', p),
  setPref: (key, value) => ipcRenderer.send('app:setPref', {key: String(key), value}),
  getPrefs: () => ipcRenderer.invoke('app:prefs'),
  captureKey: () => ipcRenderer.invoke('app:captureKey'),
  isHidden: () => hidden,
  // uygulama → web
  onHotkey: f => sub(listeners.hotkey, f),
  onPtt: f => sub(listeners.ptt, f),
  onVisibility: f => sub(listeners.vis, f),
  onUpdate: f => sub(listeners.update, f)
})
