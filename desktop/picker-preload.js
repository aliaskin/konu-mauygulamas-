// Ekran seçici penceresinin köprüsü
const {contextBridge, ipcRenderer} = require('electron')

contextBridge.exposeInMainWorld('picker', {
  sources: () => ipcRenderer.invoke('picker:sources'),
  choose: (id, audio) => ipcRenderer.send('picker:choose', {id: String(id), audio: !!audio}),
  cancel: () => ipcRenderer.send('picker:choose', null)
})
