// Web uygulamasına açılan küçük ve güvenli köprü: window.kankaDesktop
const {contextBridge, ipcRenderer} = require('electron')

const listeners = {hotkey: new Set(), ptt: new Set()}
ipcRenderer.on('hotkey', (_e, name) => { for (const f of listeners.hotkey) f(String(name)) })
ipcRenderer.on('ptt', (_e, down) => { for (const f of listeners.ptt) f(!!down) })
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
  // uygulama → web
  onHotkey: f => sub(listeners.hotkey, f),
  onPtt: f => sub(listeners.ptt, f)
})
