const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jami", {
  // download / boot events (main → renderer)
  on: (channel, cb) => {
    const allowed = ["dl:need", "dl:progress", "dl:retry", "dl:done", "dl:starting", "dl:error", "settings:load"];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_e, payload) => cb(payload));
  },
  // settings
  getSettings: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (patch) => ipcRenderer.invoke("settings:save", patch),
  retry: () => ipcRenderer.invoke("app:retry"),
});
