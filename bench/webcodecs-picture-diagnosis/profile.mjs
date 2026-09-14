// Takes a CPU profile of the SmartTrim window while a scenario runs, and says where the time went.
//   node profile.mjs <scenario.js> [label]
// Prints the functions with the most self time over the whole run, and the longest stretch the window's thread was
// busy without a break (no idle sample for more than 20 ms) with the functions that filled it.
import { readFileSync, writeFileSync } from "node:fs";

const [scenarioPath, label = "run"] = process.argv.slice(2);
const targets = await (await fetch("http://127.0.0.1:9223/json")).json();
const page = targets.find((target) => target.type === "page");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => socket.addEventListener("open", resolve));
let lastId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    lastId += 1;
    pending.set(lastId, resolve);
    socket.send(JSON.stringify({ id: lastId, method, params }));
  });

await send("Profiler.enable");
await send("Profiler.setSamplingInterval", { interval: 100 });
await send("Profiler.start");
const source = readFileSync(scenarioPath, "utf8");
const evaluated = await send("Runtime.evaluate", {
  expression: `(async () => { ${source} })()`,
  awaitPromise: true,
  returnByValue: true,
});
const { result } = await send("Profiler.stop");
socket.close();
const profile = result.profile;
writeFileSync(`profile-${label}.cpuprofile`, JSON.stringify(profile));

const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const nameOf = (id) => {
  const { functionName, url, lineNumber } = nodes.get(id).callFrame;
  const file = url ? url.split("/").pop().split("?")[0] : "";
  return `${functionName || "(anonymous)"}${file ? ` ${file}:${lineNumber + 1}` : ""}`;
};
// Parents, so a busy stretch can also be told by the SmartTrim function that called into it.
const parentOf = new Map();
for (const node of profile.nodes) for (const child of node.children ?? []) parentOf.set(child, node.id);
const ownFrame = (id) => {
  for (let at = id; at !== undefined; at = parentOf.get(at)) {
    const { url, functionName } = nodes.get(at).callFrame;
    if (url.includes("/src/") && functionName) return nameOf(at);
  }
  return "(no SmartTrim frame)";
};

let time = profile.startTime;
const samples = profile.samples.map((id, index) => {
  time += profile.timeDeltas[index];
  return { id, at: time, ms: (profile.timeDeltas[index + 1] ?? 0) / 1000 };
});
const idle = (id) => nodes.get(id).callFrame.functionName === "(idle)";

const selfMs = new Map();
for (const sample of samples) selfMs.set(nameOf(sample.id), (selfMs.get(nameOf(sample.id)) ?? 0) + sample.ms);
const top = [...selfMs].filter(([name]) => name !== "(idle)").sort((a, b) => b[1] - a[1]).slice(0, 15);

// Busy stretches: runs of samples not idle, broken only by idle lasting more than 20 ms.
const stretches = [];
let current = null;
let idleSince = null;
for (const sample of samples) {
  if (idle(sample.id)) {
    idleSince ??= sample.at;
    if (current && sample.at - idleSince > 20_000) {
      stretches.push(current);
      current = null;
    }
    continue;
  }
  idleSince = null;
  current ??= { from: sample.at, to: sample.at, samples: [] };
  current.to = sample.at + sample.ms * 1000;
  current.samples.push(sample);
}
if (current) stretches.push(current);
const longest = stretches.sort((a, b) => b.to - b.from - (a.to - a.from)).slice(0, 3);
const describe = (stretch) => {
  const byName = new Map();
  const byOwn = new Map();
  for (const sample of stretch.samples) {
    byName.set(nameOf(sample.id), (byName.get(nameOf(sample.id)) ?? 0) + sample.ms);
    byOwn.set(ownFrame(sample.id), (byOwn.get(ownFrame(sample.id)) ?? 0) + sample.ms);
  }
  const round = (entries) => [...entries].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, ms]) => `${Math.round(ms)}ms ${name}`);
  return {
    startsMsIntoProfile: Math.round((stretch.from - profile.startTime) / 1000),
    lastsMs: Math.round((stretch.to - stretch.from) / 1000),
    selfTime: round(byName),
    bySmartTrimCaller: round(byOwn),
  };
};

console.log(
  JSON.stringify(
    {
      label,
      scenario: evaluated.result?.result?.value ?? evaluated.result?.exceptionDetails ?? evaluated,
      profiledMs: Math.round((profile.endTime - profile.startTime) / 1000),
      topSelfTime: top.map(([name, ms]) => `${Math.round(ms)}ms ${name}`),
      longestBusyStretches: longest.map(describe),
    },
    null,
    1,
  ),
);
