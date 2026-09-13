// Records Chromium's own media log of the SmartTrim window (the DevTools "Media" domain) for N seconds.
//   node mediawatch.mjs <seconds>
// Prints decoder names, hardware or not, errors and messages per player, in the order they arrived.
const seconds = Number(process.argv[2] ?? 20);
const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
const page = targets.find((target) => target.type === "page");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve));
const started = Date.now();
const stamp = () => `${((Date.now() - started) / 1000).toFixed(2)}s`;
const interesting = /decoder|platform|error|hardware|fallback|software|video_codec|kIsVideoDecryptingDemuxerStream|kVideoTracks/i;
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.method?.startsWith("Media.")) return;
  const { playerId } = message.params;
  const player = playerId?.slice(0, 6);
  if (message.method === "Media.playerPropertiesChanged") {
    for (const { name, value } of message.params.properties) {
      if (interesting.test(name)) console.log(`${stamp()} [${player}] property ${name} = ${value}`);
    }
  } else if (message.method === "Media.playerErrorsRaised") {
    for (const error of message.params.errors) console.log(`${stamp()} [${player}] ERROR ${JSON.stringify(error)}`);
  } else if (message.method === "Media.playerMessagesLogged") {
    for (const logged of message.params.messages) {
      if (logged.level !== "debug") console.log(`${stamp()} [${player}] ${logged.level}: ${logged.message}`);
    }
  } else if (message.method === "Media.playersCreated") {
    console.log(`${stamp()} players ${JSON.stringify(message.params.players)}`);
  }
});
socket.send(JSON.stringify({ id: 1, method: "Media.enable" }));
await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
socket.close();
