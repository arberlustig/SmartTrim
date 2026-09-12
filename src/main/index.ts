import { existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import type { AnalysisRequest, AnalysisTools } from "../analysis/analyseRecording.ts";
import { runCut, saveCutPlan, type CutResult, type CutSummary } from "../app/runCut.ts";
import type { RecordingInfo } from "../export/exportFcp7Xml.ts";
import type { Answer } from "../preload/api.ts";
import { probeRecording } from "../probe/probeRecording.ts";
import { scanSourceTracks, type SourceTrackScan } from "../scan/scanSourceTracks.ts";

/**
 * Where ffprobe and ffmpeg live. vendor/ is git-ignored and, until the first-run download exists, has to be filled
 * by hand — so a missing binary is reported as such instead of as an ffmpeg error.
 */
function analysisTools(): AnalysisTools {
  const root = app.isPackaged ? process.resourcesPath : app.getAppPath();
  const vendor = join(root, "vendor");
  const tools: AnalysisTools = {
    ffprobe: join(vendor, "ffprobe.exe"),
    ffmpeg: join(vendor, "ffmpeg.exe"),
    // Only speech detection needs the model, and the window decides by loudness (ADR-0003).
    sileroModel: join(vendor, "silero_vad.onnx"),
  };
  for (const path of [tools.ffprobe, tools.ffmpeg]) {
    if (!existsSync(path)) throw new Error(`${path} is missing. Put the ffmpeg build into ${vendor}.`);
  }
  return tools;
}

/** The finished cut waits here for the user to choose where to save it, so the plan never crosses into the window. */
let lastCut: CutResult | null = null;
/** The Recording on screen, so the scan and the save work on the one the user actually chose. */
let chosen: RecordingInfo | null = null;

/** Turns a handler's refusal into an answer the window can show, rather than an IPC exception. */
function answering<Request, Value>(
  handle: (request: Request) => Promise<Value>,
): (event: unknown, request: Request) => Promise<Answer<Value>> {
  return async (_event, request) => {
    try {
      return { ok: true, value: await handle(request) };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  };
}

function registerHandlers(window: BrowserWindow): void {
  ipcMain.handle(
    "recording:choose",
    answering(async (): Promise<RecordingInfo | null> => {
      const { canceled, filePaths } = await dialog.showOpenDialog(window, {
        title: "Aufnahme wählen",
        properties: ["openFile"],
        // MKV is left out on purpose: it reports no stream lengths, so the probe refuses it (ADR-0009).
        filters: [
          { name: "Aufnahmen", extensions: ["mp4", "mov", "m4v"] },
          { name: "Alle Dateien", extensions: ["*"] },
        ],
      });
      const chosenPath = filePaths[0];
      if (canceled || !chosenPath) return null;
      // Probing reads only the stream descriptions, so this stays instant even on a 20 GB Recording.
      const recording = await probeRecording(chosenPath, analysisTools().ffprobe);
      lastCut = null;
      chosen = recording;
      return recording;
    }),
  );

  // Kept apart from choosing so the window can show the Recording at once and the slices afterwards.
  ipcMain.handle(
    "recording:scan",
    answering(async (): Promise<SourceTrackScan[]> => {
      if (!chosen) throw new Error("No Recording is chosen, so there are no SourceTracks to listen to.");
      return scanSourceTracks(chosen, analysisTools().ffmpeg);
    }),
  );

  ipcMain.handle(
    "cut:run",
    answering(async (request: AnalysisRequest): Promise<CutSummary> => {
      lastCut = null;
      const result = await runCut(request, analysisTools());
      lastCut = result;
      return result.summary;
    }),
  );

  ipcMain.handle(
    "cut:save",
    answering(async (exportSourceTracks: readonly number[]): Promise<string | null> => {
      // Saving a plan that is no longer the one on screen would hand the user a file for settings they changed.
      if (!lastCut) throw new Error("There is no finished cut to save. Press Schneiden first.");
      const { recording, cutPlan } = lastCut;
      const { canceled, filePath } = await dialog.showSaveDialog(window, {
        title: "Premiere-Datei speichern",
        defaultPath: join(dirname(recording.path), `${basename(recording.path, extname(recording.path))}.xml`),
        filters: [{ name: "Premiere-Projekt (FCP7 XML)", extensions: ["xml"] }],
      });
      if (canceled || !filePath) return null;
      await saveCutPlan(filePath, recording, cutPlan, exportSourceTracks);
      return filePath;
    }),
  );

  ipcMain.handle(
    "file:reveal",
    answering(async (path: string): Promise<null> => {
      shell.showItemInFolder(path);
      return null;
    }),
  );
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 760,
    height: 720,
    minWidth: 560,
    minHeight: 560,
    title: "SmartTrim",
    backgroundColor: "#14161a",
    show: false,
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.mjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload script is an ES module, which Electron only loads outside the sandbox. It exposes four
      // functions and nothing else, so the window still never sees Node itself.
      sandbox: false,
    },
  });
  window.once("ready-to-show", () => window.show());
  window.setMenuBarVisibility(false);
  registerHandlers(window);

  const devServer = process.env["ELECTRON_RENDERER_URL"];
  if (devServer) {
    void window.loadURL(devServer);
  } else {
    void window.loadFile(fileURLToPath(new URL("../renderer/index.html", import.meta.url)));
  }
}

void app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
