// PROTOTYPE, throw away. Not product code.
// Question: does decoding the Recording's frames ahead with WebCodecs and drawing them on a canvas keep the picture
// smooth across Joins, where two <video> elements lose 4-5 frames at every Join (ADR-0027)?
//
// Run from the repository root (needs bench/out/the 25-minute capture-owner-kept.json and vendor/ffprobe.exe):
//   node_modules/electron/dist/electron.exe bench/prototype-webcodecs-picture "C:\...\capture-25min.mp4" [--quit]
// Results go to bench/out/prototype-webcodecs-picture.json and onto the window.
const { app, BrowserWindow } = require("electron");
const path = require("node:path");

// A covered window is reported hidden and gets no animation frames: that would measure Windows, not WebCodecs.
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1000,
    height: 760,
    title: "PROTOTYPE – WebCodecs-Bild",
    backgroundColor: "#14161a",
    // Throwaway: Node in the page keeps the prototype to two files.
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  window.loadFile(path.join(__dirname, "index.html"), { query: { args: JSON.stringify(process.argv.slice(2)) } });
});

app.on("window-all-closed", () => app.quit());
