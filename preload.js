const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  loadStore: () => ipcRenderer.invoke("load-store"),
  saveStore: (payload) => ipcRenderer.invoke("save-store", payload),
  notify: (payload) => ipcRenderer.send("notify", payload),
  // New bridges
  loadSchedule: () => ipcRenderer.invoke('schedule:load'),
  loadTopics: () => ipcRenderer.invoke('topics:load'),
  generateQuestions: (payload) => ipcRenderer.invoke('gemini:generateQuestions', payload),
  askGemini: (payload) => ipcRenderer.invoke('gemini:ask', payload),
  toggleAbsent: (payload) => ipcRenderer.invoke('attendance:toggleAbsent', payload),
  envStatus: () => ipcRenderer.invoke('env:status')
});
