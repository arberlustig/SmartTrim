import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import electronUpdater, { type AppUpdater, type Logger } from "electron-updater";
import { mayCheckAgain, nextUpdateState, type UpdateEvent, type UpdateState } from "../app/selfUpdate.ts";

/** How often a SmartTrim left open asks again. A check is three small requests to github.com. */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

/** SmartTrim's own update, as the window may ask about it. */
export interface SelfUpdate {
  state(): UpdateState;
  /** Closes SmartTrim, installs the downloaded version without a question, and starts it again. */
  restartToInstall(): void;
}

/**
 * Where electron-updater says what it did, so "why does this machine not update" has an answer. Written afresh on
 * every start, so it never grows; a log that cannot be written costs nothing but the log.
 */
function logTo(path: string): Logger {
  let started = false;
  const line =
    (level: string) =>
    (message?: unknown): void => {
      const said = message instanceof Error ? (message.stack ?? message.message) : String(message);
      try {
        (started ? appendFileSync : writeFileSync)(path, `${new Date().toISOString()} ${level} ${said}\n`);
        started = true;
      } catch {
        // No log, no harm.
      }
    };
  return { info: line("info"), warn: line("warn"), error: line("error"), debug: line("debug") };
}

/**
 * Keeps SmartTrim up to date from its GitHub releases (ADR-0032): asks once at start and every six hours after,
 * downloads a newer version in the background, and installs it silently when SmartTrim closes — or at once, when the
 * window asks to restart. `onChange` hears every change the window would show. A checkout is never updated: git does
 * that, and electron-updater refuses an app that is not packaged anyway.
 */
export function keepUpToDate(onChange: (state: UpdateState) => void): SelfUpdate {
  let state: UpdateState = { kind: "idle" };
  if (!app.isPackaged) {
    return {
      state: () => state,
      restartToInstall: () => {
        throw new Error("A SmartTrim run from its sources is not updated by itself.");
      },
    };
  }

  // Reading autoUpdater builds the updater, which needs Electron's app: so here, never when this module is loaded.
  const updater: AppUpdater = electronUpdater.autoUpdater;
  updater.logger = logTo(join(app.getPath("userData"), "update.log"));
  // SmartTrim has no web installer; left on, every download logs a warning about it.
  updater.disableWebInstaller = true;
  // electron-updater sends a random ID of its own, made once per installation, with every request — for staged
  // rollouts, which SmartTrim does not use. One value shared by every installation keeps the checks from being linked
  // to each other: GitHub sees the address a check comes from, and nothing else (ADR-0032).
  updater.requestHeaders = { ...updater.requestHeaders, "x-user-staging-id": "00000000-0000-4000-8000-000000000000" };
  // autoDownload and autoInstallOnAppQuit keep their defaults: a newer version downloads as soon as it is found, and
  // installs without a question when SmartTrim closes.

  const apply = (event: UpdateEvent): void => {
    const next = nextUpdateState(state, event);
    // The download reports far more often than its whole percent changes; the window draws a line, not a curve.
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    onChange(state);
  };
  updater.on("checking-for-update", () => apply({ type: "checking" }));
  updater.on("update-not-available", () => apply({ type: "current" }));
  updater.on("update-available", (info) => apply({ type: "found", version: info.version }));
  updater.on("download-progress", (progress) => apply({ type: "progress", percent: progress.percent }));
  updater.on("update-downloaded", (info) => apply({ type: "downloaded", version: info.version }));
  // Why it failed is in update.log. The window only hears that it did: the reason is English and technical, and an
  // offline machine needs no sentence about GitHub.
  updater.on("error", () => apply({ type: "failed" }));

  const check = (): void => {
    if (!mayCheckAgain(state)) return;
    // The check and the download it starts both reject on failure; the "error" event above has already said so.
    updater
      .checkForUpdates()
      .then((result) => result?.downloadPromise?.catch(() => undefined))
      .catch(() => undefined);
  };
  check();
  setInterval(check, CHECK_EVERY_MS);

  return {
    state: () => state,
    restartToInstall: () => {
      if (state.kind !== "ready") throw new Error("No update has been downloaded to install.");
      // Silent: the assisted installer would otherwise show its pages again, and its finish page would not start
      // SmartTrim. It keeps the folder the user chose when installing.
      updater.quitAndInstall(true, true);
    },
  };
}
