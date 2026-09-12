import { contextBridge, ipcRenderer } from "electron";
import type { SmartTrimApi, ToolsProgress } from "./api.ts";

// The window runs without Node (contextIsolation), so this is the whole surface it can reach.
const api: SmartTrimApi = {
  ensureTools: () => ipcRenderer.invoke("tools:ensure"),
  onToolsProgress: (listen) => {
    ipcRenderer.on("tools:progress", (_event, progress: ToolsProgress) => listen(progress));
  },
  chooseRecording: () => ipcRenderer.invoke("recording:choose"),
  scan: () => ipcRenderer.invoke("recording:scan"),
  cut: (request) => ipcRenderer.invoke("cut:run", request),
  replan: (settings) => ipcRenderer.invoke("cut:replan", settings),
  redecide: (settings) => ipcRenderer.invoke("cut:redecide", settings),
  save: (exportSourceTracks) => ipcRenderer.invoke("cut:save", exportSourceTracks),
  reveal: (path) => ipcRenderer.invoke("file:reveal", path),
};

contextBridge.exposeInMainWorld("smarttrim", api);
