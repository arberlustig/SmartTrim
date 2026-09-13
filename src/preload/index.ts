import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { ReadProgress, SmartTrimApi, ToolsProgress } from "./api.ts";

// The window runs without Node (contextIsolation), so this is the whole surface it can reach. An IPC handler takes a
// single argument, so the calls that name a Tab send one object.
const api: SmartTrimApi = {
  ensureTools: () => ipcRenderer.invoke("tools:ensure"),
  onToolsProgress: (listen) => {
    ipcRenderer.on("tools:progress", (_event, progress: ToolsProgress) => listen(progress));
  },
  chooseRecording: () => ipcRenderer.invoke("recording:choose"),
  // A dropped File no longer carries its path (Electron 32 removed File.path); only this call can still ask for it.
  pathOf: (file) => webUtils.getPathForFile(file),
  openFiles: (paths) => ipcRenderer.invoke("file:open", paths),
  closeTab: (tabId) => ipcRenderer.invoke("tab:close", tabId),
  scan: (tabId) => ipcRenderer.invoke("recording:scan", tabId),
  readSourceTracks: (tabId, positions) => ipcRenderer.invoke("sourceTrack:read", { tabId, positions }),
  readExcerpt: (request) => ipcRenderer.invoke("sourceTrack:excerpt", request),
  onReadProgress: (listen) => {
    ipcRenderer.on("sourceTrack:progress", (_event, progress: ReadProgress) => listen(progress));
  },
  cut: (tabId, request) => ipcRenderer.invoke("cut:run", { tabId, request }),
  waveforms: (tabId) => ipcRenderer.invoke("cut:waveforms", tabId),
  replan: (tabId, settings) => ipcRenderer.invoke("cut:replan", { tabId, settings }),
  redecide: (tabId, settings) => ipcRenderer.invoke("cut:redecide", { tabId, settings }),
  save: (tabId, exportSourceTracks) => ipcRenderer.invoke("cut:save", { tabId, exportSourceTracks }),
  saveProjectBeside: (tabId, choices) => ipcRenderer.invoke("project:saveBeside", { tabId, choices }),
  savePremiereBeside: (tabId, exportSourceTracks) => ipcRenderer.invoke("cut:saveBeside", { tabId, exportSourceTracks }),
  openProject: () => ipcRenderer.invoke("project:open"),
  readProjectAudio: (tabId) => ipcRenderer.invoke("project:readAudio", tabId),
  loadPresets: () => ipcRenderer.invoke("presets:load"),
  savePreset: (preset) => ipcRenderer.invoke("presets:save", preset),
  deletePreset: (name) => ipcRenderer.invoke("presets:delete", name),
  reveal: (path) => ipcRenderer.invoke("file:reveal", path),
};

contextBridge.exposeInMainWorld("smarttrim", api);
