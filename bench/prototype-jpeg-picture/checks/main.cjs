// PROTOTYPE, throwaway: two counter-checks before the JPEG picture prototype (video preview, 2026-09-14).
//   electron.exe bench/prototype-jpeg-picture/checks/main.cjs brake <framesDir>
//     Does the WebCodecs brake (ADR-0027) also hold a decoder in a second window that draws nothing, while the first
//     window draws on every animation frame?
//   electron.exe bench/prototype-jpeg-picture/checks/main.cjs videostart "<Recording>"
//     How long a paused, seeked <video> takes to show a moving frame after play(), with its audio tracks enabled
//     (as on main) and with all of them disabled, alone and while a second element plays.
// Results go to stdout and to result-<mode>.json next to this file.
const { app, BrowserWindow, ipcMain } = require("electron");
const { writeFileSync } = require("node:fs");
const path = require("node:path");

const [mode, argument] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function windowOf({ show, width, height, x, y, blink }) {
  return new BrowserWindow({
    show,
    width,
    height,
    x,
    y,
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, enableBlinkFeatures: blink },
  });
}

let calls = 0;
function call(window, what, data) {
  calls += 1;
  const id = calls;
  return new Promise((resolve) => {
    ipcMain.once(`done:${id}`, (_event, value) => resolve(value));
    window.webContents.send("do", { id, what, data });
  });
}

function finish(result) {
  const text = JSON.stringify(result, null, 1);
  console.log(text);
  writeFileSync(path.join(__dirname, `result-${mode}.json`), text);
  app.quit();
}

app.whenReady().then(async () => {
  if (mode === "brake") {
    const drawer = windowOf({ show: true, width: 900, height: 320, x: 80, y: 80 });
    const hidden = windowOf({ show: false, width: 400, height: 300 });
    const quiet = windowOf({ show: true, width: 320, height: 220, x: 1000, y: 80 });
    await Promise.all([drawer, hidden, quiet].map((window) => window.loadFile(path.join(__dirname, "decoder.html"))));
    await sleep(2500);
    for (const window of [drawer, hidden, quiet]) await call(window, "load", argument);
    const result = { videoDecode: app.getGPUFeatureStatus().video_decode };
    result.drawerIdle = await call(drawer, "decode");
    result.hiddenIdle = await call(hidden, "decode");
    result.quietIdle = await call(quiet, "decode");
    await call(drawer, "draw", true);
    await sleep(500);
    result.drawerWhileDrawing = await call(drawer, "decode");
    result.hiddenWhileDrawerDraws = await call(hidden, "decode");
    result.quietWhileDrawerDraws = await call(quiet, "decode");
    result.drawerWhileDrawingAgain = await call(drawer, "decode");
    result.hiddenWhileDrawerDrawsAgain = await call(hidden, "decode");
    result.drawerAnimationFrames = await call(drawer, "draw", false);
    await sleep(300);
    result.drawerIdleAfter = await call(drawer, "decode");
    result.visibility = { drawer: await call(drawer, "state"), hidden: await call(hidden, "state"), quiet: await call(quiet, "state") };
    finish(result);
  } else if (mode === "videostart") {
    const window = windowOf({ show: true, width: 900, height: 600, x: 80, y: 80, blink: "AudioVideoTracks" });
    await window.loadFile(path.join(__dirname, "videostart.html"));
    await sleep(2500);
    finish(await call(window, "run", argument));
  } else {
    console.log("mode must be brake or videostart");
    app.quit();
  }
});
