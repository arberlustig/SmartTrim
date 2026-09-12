import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import type { AnalysisRequest, AnalysisTools } from "../analysis/analyseRecording.ts";
import {
  redecideCut,
  replanCut,
  runCut,
  saveCutPlan,
  type CutResult,
  type CutSummary,
  type PlanSettings,
} from "../app/runCut.ts";
import type { Preset } from "../app/cutSession.ts";
import { loadOwnPresets, storeOwnPresets } from "../app/presetStore.ts";
import { withPreset, withoutPreset } from "../app/presets.ts";
import type { RecordingInfo } from "../export/exportFcp7Xml.ts";
import type { Answer } from "../preload/api.ts";
import { probeRecording } from "../probe/probeRecording.ts";
import {
  openTrimProject,
  saveTrimProject,
  trimProjectOf,
  type SavedChoices,
} from "../project/openTrimProject.ts";
import type { TrimProject } from "../project/trimProject.ts";
import { PINNED_TOOLS, ensureTools } from "../tools/ensureTools.ts";
import { scanSourceTracks, type SourceTrackScan } from "../scan/scanSourceTracks.ts";

/**
 * Where ffmpeg, ffprobe and the Silero model live: next to the installed app they belong to the user, so they go in
 * the writable per-user folder. In a checkout they stay in the git-ignored vendor/, where the bench scripts find them.
 */
function toolsDirectory(): string {
  return app.isPackaged ? join(app.getPath("userData"), "tools") : join(app.getAppPath(), "vendor");
}

/**
 * Where the user's own Presets live. Always the per-user folder, packaged or not: unlike the tools, Presets are
 * something the user built up and expects to find again, so a checkout and an installed SmartTrim share them.
 */
function presetDirectory(): string {
  return app.getPath("userData");
}

/** The tools, once they have been found or downloaded. Downloading 172 MB is a first-run affair. */
let tools: AnalysisTools | null = null;

/**
 * Hands back the tools, downloading what is missing (ADR-0015) and telling the window how far it has got. The
 * progress is thinned out to whole percent: 172 MB arrive in thousands of chunks, and the window only draws a line.
 */
async function analysisTools(window: BrowserWindow): Promise<AnalysisTools> {
  if (tools) return tools;
  let lastPercent = -1;
  tools = await ensureTools(toolsDirectory(), PINNED_TOOLS, (step) => {
    const percent = Math.floor((step.receivedBytes / Math.max(step.totalBytes, 1)) * 100);
    if (percent === lastPercent || window.isDestroyed()) return;
    lastPercent = percent;
    window.webContents.send("tools:progress", { ...step, percent });
  });
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
  // Called once when the window opens, so a first run downloads while the user is still reading the window.
  ipcMain.handle(
    "tools:ensure",
    answering(async (): Promise<null> => {
      await analysisTools(window);
      return null;
    }),
  );

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
      const recording = await probeRecording(chosenPath, (await analysisTools(window)).ffprobe);
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
      return scanSourceTracks(chosen, (await analysisTools(window)).ffmpeg);
    }),
  );

  ipcMain.handle(
    "cut:run",
    answering(async (request: AnalysisRequest): Promise<CutSummary> => {
      lastCut = null;
      const result = await runCut(request, await analysisTools(window));
      lastCut = result;
      return result.summary;
    }),
  );

  // ADR-0004: Margin and MinimumDeadZone only decide how the cuts are planned around what the analysis found, so
  // moving those sliders must not read the Recording again.
  ipcMain.handle(
    "cut:replan",
    answering(async (settings: PlanSettings): Promise<CutSummary> => {
      if (!lastCut) throw new Error("There is no cut to replan. Press Schneiden first.");
      lastCut = replanCut(lastCut, settings);
      return lastCut.summary;
    }),
  );

  // ADR-0004 again: the decoded audio stays in the main process, so another threshold is decided from memory.
  ipcMain.handle(
    "cut:redecide",
    answering(async (settings: PlanSettings & { thresholdDbfs: number }): Promise<CutSummary> => {
      if (!lastCut) throw new Error("There is no cut to decide again. Press Schneiden first.");
      lastCut = redecideCut(lastCut, settings.thresholdDbfs, settings);
      return lastCut.summary;
    }),
  );

  // The saved project holds what the analysis found, so tomorrow's session starts from it instead of from the file.
  ipcMain.handle(
    "project:save",
    answering(async (choices: SavedChoices): Promise<string | null> => {
      if (!lastCut) throw new Error("There is no finished cut to save. Press Schneiden first.");
      const { recording } = lastCut;
      const { canceled, filePath } = await dialog.showSaveDialog(window, {
        title: "SmartTrim-Projekt speichern",
        defaultPath: join(dirname(recording.path), `${basename(recording.path, extname(recording.path))}.smarttrim`),
        filters: [{ name: "SmartTrim-Projekt", extensions: ["smarttrim"] }],
      });
      if (canceled || !filePath) return null;
      await saveTrimProject(filePath, trimProjectOf(lastCut, choices));
      return filePath;
    }),
  );

  ipcMain.handle(
    "project:open",
    answering(async (): Promise<{ project: TrimProject; summary: CutSummary } | null> => {
      const { canceled, filePaths } = await dialog.showOpenDialog(window, {
        title: "SmartTrim-Projekt öffnen",
        properties: ["openFile"],
        filters: [{ name: "SmartTrim-Projekt", extensions: ["smarttrim"] }],
      });
      const chosenPath = filePaths[0];
      if (canceled || !chosenPath) return null;
      const text = await readFile(chosenPath, "utf8");
      // Only the stream descriptions are read, to make sure it is still the Recording the project was cut from.
      const opened = await openTrimProject(text, (await analysisTools(window)).ffprobe);
      lastCut = opened.cut;
      chosen = opened.cut.recording;
      return { project: opened.project, summary: opened.cut.summary };
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

  // The user's own Presets sit next to the downloaded tools, in the folder that belongs to them rather than to the
  // installation, so they survive an update and a reinstall (ADR-0018).
  ipcMain.handle(
    "presets:load",
    answering(async (): Promise<readonly Preset[]> => loadOwnPresets(presetDirectory())),
  );

  ipcMain.handle(
    "presets:save",
    answering(async (preset: Preset): Promise<readonly Preset[]> => {
      // Read before writing, so a Preset saved in another window is not overwritten by this one's stale list.
      const saved = withPreset(await loadOwnPresets(presetDirectory()), preset);
      await storeOwnPresets(presetDirectory(), saved);
      return saved;
    }),
  );

  ipcMain.handle(
    "presets:delete",
    answering(async (name: string): Promise<readonly Preset[]> => {
      const left = withoutPreset(await loadOwnPresets(presetDirectory()), name);
      await storeOwnPresets(presetDirectory(), left);
      return left;
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
