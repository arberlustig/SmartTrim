import { contextBridge, ipcRenderer } from "electron";
import type { SmartTrimApi } from "./api.ts";

// The window runs without Node (contextIsolation), so this is the whole surface it can reach.
const api: SmartTrimApi = {
  chooseRecording: () => ipcRenderer.invoke("recording:choose"),
  scan: () => ipcRenderer.invoke("recording:scan"),
  cut: (request) => ipcRenderer.invoke("cut:run", request),
  save: (exportSourceTracks) => ipcRenderer.invoke("cut:save", exportSourceTracks),
  reveal: (path) => ipcRenderer.invoke("file:reveal", path),
};

contextBridge.exposeInMainWorld("smarttrim", api);
