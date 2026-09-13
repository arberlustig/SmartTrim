import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, app, dialog, ipcMain, protocol, shell } from "electron";
import { VIDEO_SCHEME } from "../video/address.ts";
import { serveRecording } from "../video/serveRecording.ts";
import type { AnalysisRequest, AnalysisTools } from "../analysis/analyseRecording.ts";
import { saveCutPlan, type CutSummary, type PlanSettings, type SourceTrackWaveform } from "../app/runCut.ts";
import type { Preset } from "../app/cutSession.ts";
import { openFiles } from "../app/openFile.ts";
import { loadOwnPresets, storeOwnPresets } from "../app/presetStore.ts";
import { withPreset, withoutPreset } from "../app/presets.ts";
import { newTabStore, type OnRead } from "../app/tabStore.ts";
import type { Answer, ExcerptRequest, OpenedInWindow, OpenedTab } from "../preload/api.ts";
import type { Excerpt } from "../playback/readExcerpt.ts";
import type { SavedChoices } from "../project/openTrimProject.ts";
import { PINNED_TOOLS, ensureTools } from "../tools/ensureTools.ts";
import type { SourceTrackScan } from "../scan/scanSourceTracks.ts";

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

/** Turns a handler's refusal into an answer the window can show, rather than an IPC exception. */
function answering<Request, Value>(
  handle: (request: Request) => Promise<Value> | Value,
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
  /**
   * Every Tab's Recording, what was read of it and its cut. Every request below names its Tab, so nothing one
   * Recording read can end up in another's cut (ADR-0025).
   */
  const tabs = newTabStore(() => analysisTools(window));

  // The picture above the SourceTracks reads a Tab's Recording through SmartTrim's own address, answered piece by piece
  // from the file. Only a Tab's own Recording is served (ADR-0027).
  if (protocol.isProtocolHandled(VIDEO_SCHEME)) protocol.unhandle(VIDEO_SCHEME);
  protocol.handle(VIDEO_SCHEME, (request) => serveRecording(request, (tabId) => tabs.recordingOf(tabId).path));

  /** Tells the window how far reading one Tab's SourceTracks has got. */
  const progressOf =
    (tabId: number): OnRead =>
    (done, total) => {
      if (!window.isDestroyed()) window.webContents.send("sourceTrack:progress", { tabId, done, total });
    };

  // Called once when the window opens, so a first run downloads while the user is still reading the window.
  ipcMain.handle(
    "tools:ensure",
    answering(async (): Promise<null> => {
      await analysisTools(window);
      return null;
    }),
  );

  /**
   * Opens files and folders, each file in a Tab of its own. Every way into the window comes through here — both
   * dialogs and a drop. A Recording already open in a Tab keeps that Tab, and a project of it is not loaded over it.
   */
  async function openInWindow(paths: readonly string[]): Promise<OpenedInWindow> {
    // Probing reads only the stream descriptions, so this stays quick even for a folder of 20 GB Recordings.
    const { opened, refused } = await openFiles(paths, (await analysisTools(window)).ffprobe);
    const shown = opened.map((file): OpenedTab => {
      const { tabId, alreadyOpen } = tabs.open(file);
      if (alreadyOpen) return { tabId, path: file.path, alreadyOpen, kind: file.kind };
      return file.kind === "recording"
        ? { tabId, path: file.path, alreadyOpen, kind: "recording", recording: file.recording }
        : { tabId, path: file.path, alreadyOpen, kind: "project", project: file.project, summary: file.cut.summary };
    });
    return { tabs: shown, refused };
  }

  // Files or folders dropped on the window: the window only knows their paths.
  ipcMain.handle("file:open", answering(openInWindow));

  ipcMain.handle(
    "recording:choose",
    answering(async (): Promise<OpenedInWindow | null> => {
      const { canceled, filePaths } = await dialog.showOpenDialog(window, {
        title: "Aufnahmen wählen",
        properties: ["openFile", "multiSelections"],
        // MKV is left out on purpose: it reports no stream lengths, so the probe refuses it (ADR-0009).
        filters: [
          { name: "Aufnahmen", extensions: ["mp4", "mov", "m4v"] },
          { name: "Alle Dateien", extensions: ["*"] },
        ],
      });
      if (canceled || filePaths.length === 0) return null;
      return openInWindow(filePaths);
    }),
  );

  ipcMain.handle(
    "project:open",
    answering(async (): Promise<OpenedInWindow | null> => {
      const { canceled, filePaths } = await dialog.showOpenDialog(window, {
        title: "SmartTrim-Projekte öffnen",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "SmartTrim-Projekt", extensions: ["smarttrim"] }],
      });
      if (canceled || filePaths.length === 0) return null;
      // Only the stream descriptions are read, to make sure it is still the Recording the project was cut from.
      return openInWindow(filePaths);
    }),
  );

  // Whatever a closed Tab still has running is refused when it finishes (ADR-0025).
  ipcMain.handle(
    "tab:close",
    answering((tabId: number): null => {
      tabs.close(tabId);
      return null;
    }),
  );

  // Kept apart from opening so the window can show the Recording at once and the slices afterwards.
  ipcMain.handle("recording:scan", answering((tabId: number): Promise<SourceTrackScan[]> => tabs.scan(tabId)));

  /**
   * Reads the SourceTracks the window names, so their waveform can be drawn before anything is cut (ADR-0020).
   * What is read stays with the Tab: its cut reuses it, and a role taken away and put back costs nothing.
   */
  ipcMain.handle(
    "sourceTrack:read",
    answering(
      ({ tabId, positions }: { tabId: number; positions: readonly number[] }): Promise<SourceTrackWaveform[]> =>
        tabs.readSourceTracks(tabId, positions, progressOf(tabId)),
    ),
  );

  /**
   * Reads one SourceTrack of a Tab's Recording over a stretch, for the window to play (ADR-0022). Nothing of it stays
   * here: it is a few megabytes for the ear, read afresh for every press of a play button.
   */
  ipcMain.handle(
    "sourceTrack:excerpt",
    answering(({ tabId, ...stretch }: ExcerptRequest): Promise<Excerpt> => tabs.readExcerpt(tabId, stretch)),
  );

  ipcMain.handle(
    "cut:run",
    answering(
      ({ tabId, request }: { tabId: number; request: AnalysisRequest }): Promise<CutSummary> => tabs.cut(tabId, request),
    ),
  );

  // Asked for once after an analysis: the shape of the sound does not change when a slider moves, only the colours
  // drawn over it do, and those travel with every summary (ADR-0019).
  ipcMain.handle("cut:waveforms", answering((tabId: number): SourceTrackWaveform[] => tabs.waveformsOfCut(tabId)));

  // ADR-0004: Margin and MinimumDeadZone only decide how the cuts are planned around what the analysis found, so
  // moving those sliders must not read the Recording again.
  ipcMain.handle(
    "cut:replan",
    answering(({ tabId, settings }: { tabId: number; settings: PlanSettings }): CutSummary => tabs.replan(tabId, settings)),
  );

  // ADR-0004 again: the chunk levels stay in the main process, so another threshold is decided from memory.
  ipcMain.handle(
    "cut:redecide",
    answering(
      ({ tabId, settings }: { tabId: number; settings: PlanSettings & { thresholdDbfs: number } }): CutSummary =>
        tabs.redecide(tabId, settings),
    ),
  );

  // The saved project holds what the analysis found, so tomorrow's session starts from it instead of from the file.
  // It asks nothing: back into the Tab's own project, else beside its Recording. The save dialog it once opened never
  // came into view on the owner's machine (ADR-0025).
  ipcMain.handle(
    "project:saveBeside",
    answering(
      ({ tabId, choices }: { tabId: number; choices: SavedChoices }): Promise<string> => tabs.saveProject(tabId, choices),
    ),
  );

  // "Alle Premiere-Dateien speichern" writes each Tab's Premiere file beside its Recording, asking nothing: a save
  // dialog per Tab would be ten questions for ten Recordings (ADR-0026).
  ipcMain.handle(
    "cut:saveBeside",
    answering(
      ({ tabId, exportSourceTracks }: { tabId: number; exportSourceTracks: readonly number[] }): Promise<string> =>
        tabs.savePremiereBeside(tabId, exportSourceTracks),
    ),
  );

  /**
   * Reads the audio of a reopened project in the background, so its waveform appears and a threshold can be tried
   * again without the user pressing Schneiden. The plan on screen is not touched: it was recomputed on opening.
   */
  ipcMain.handle(
    "project:readAudio",
    answering((tabId: number): Promise<SourceTrackWaveform[]> => tabs.readProjectAudio(tabId, progressOf(tabId))),
  );

  ipcMain.handle(
    "cut:save",
    answering(
      async ({ tabId, exportSourceTracks }: { tabId: number; exportSourceTracks: readonly number[] }): Promise<string | null> => {
        // Saving a plan that is no longer the one on screen would hand the user a file for settings they changed.
        const { recording } = tabs.cutOf(tabId);
        const { canceled, filePath } = await dialog.showSaveDialog(window, {
          title: "Premiere-Datei speichern",
          defaultPath: join(dirname(recording.path), `${basename(recording.path, extname(recording.path))}.xml`),
          filters: [{ name: "Premiere-Projekt (FCP7 XML)", extensions: ["xml"] }],
        });
        if (canceled || !filePath) return null;
        const { cutPlan } = tabs.cutOf(tabId);
        await saveCutPlan(filePath, recording, cutPlan, exportSourceTracks);
        return filePath;
      },
    ),
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
    width: 820,
    height: 760,
    minWidth: 560,
    minHeight: 560,
    title: "SmartTrim",
    backgroundColor: "#14161a",
    show: false,
    webPreferences: {
      preload: fileURLToPath(new URL("../preload/index.mjs", import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload script is an ES module, which Electron only loads outside the sandbox. It exposes the bridge in
      // src/preload/api.ts and nothing else, so the window still never sees Node itself.
      sandbox: false,
    },
  });
  window.once("ready-to-show", () => window.show());
  // Chromium's answer to a file or link dropped where the window does not take it is to open that instead of
  // SmartTrim. The window takes file drops itself; this catches anything that still slips past. A reload keeps the URL.
  window.webContents.on("will-navigate", (details) => {
    if (details.url !== window.webContents.getURL()) details.preventDefault();
  });
  window.setMenuBarVisibility(false);
  registerHandlers(window);

  const devServer = process.env["ELECTRON_RENDERER_URL"];
  if (devServer) {
    void window.loadURL(devServer);
  } else {
    void window.loadFile(fileURLToPath(new URL("../renderer/index.html", import.meta.url)));
  }
}

// In development the window comes from http://localhost, where file:// is out of reach, so the <video> reads through
// this address instead. A <video> can only seek on a scheme that streams; Electron wants it named before it is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: VIDEO_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);

void app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  app.quit();
});
