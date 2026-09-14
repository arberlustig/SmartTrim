// CPU profile of SmartTrim's main process (V8 inspector on 9229) while a scenario runs in the window (DevTools on 9223).
//   node mainprofile.mjs <scenario.js> [label]
// Prints the scenario's own timings, the main process's functions with most self time, and its longest busy stretches.
import { readFileSync, writeFileSync } from "node:fs";

const [scenarioPath, label = "main"] = process.argv.slice(2);

async function connect(listUrl, pick) {
  const targets = await (await fetch(listUrl)).json();
  const target = pick(targets);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
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
  return { send, close: () => socket.close() };
}

const main = await connect("http://127.0.0.1:9229/json", (targets) => targets[0]);
const window = await connect("http://127.0.0.1:9223/json", (targets) => targets.find((target) => target.type === "page"));

await main.send("Profiler.enable");
await main.send("Profiler.setSamplingInterval", { interval: 200 });
await main.send("Profiler.start");
const source = readFileSync(scenarioPath, "utf8");
const evaluated = await window.send("Runtime.evaluate", {
  expression: `(async () => { ${source} })()`,
  awaitPromise: true,
  returnByValue: true,
});
const { result } = await main.send("Profiler.stop");
main.close();
window.close();
const profile = result.profile;
writeFileSync(`profile-${label}.cpuprofile`, JSON.stringify(profile));

const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
const nameOf = (id) => {
  const { functionName, url, lineNumber } = nodes.get(id).callFrame;
  const file = url ? url.split(/[\\/]/).pop().split("?")[0] : "";
  return `${functionName || "(anonymous)"}${file ? ` ${file}:${lineNumber + 1}` : ""}`;
};
const parentOf = new Map();
for (const node of profile.nodes) for (const child of node.children ?? []) parentOf.set(child, node.id);
/** The nearest caller that is SmartTrim's own code (out/main/index.js, bundled from src/). */
const ownFrame = (id) => {
  for (let at = id; at !== undefined; at = parentOf.get(at)) {
    const { url, functionName } = nodes.get(at).callFrame;
    if (/out[\\/]main[\\/]index\.js/.test(url) && functionName) return nameOf(at);
  }
  return "(no SmartTrim frame)";
};

let time = profile.startTime;
const samples = profile.samples.map((id, index) => {
  time += profile.timeDeltas[index];
  return { id, at: time, ms: (profile.timeDeltas[index + 1] ?? 0) / 1000 };
});
const idle = (id) => ["(idle)", "(program)"].includes(nodes.get(id).callFrame.functionName);

const selfMs = new Map();
for (const sample of samples) selfMs.set(nameOf(sample.id), (selfMs.get(nameOf(sample.id)) ?? 0) + sample.ms);
const top = [...selfMs].filter(([name]) => name !== "(idle)").sort((a, b) => b[1] - a[1]).slice(0, 15);

const stretches = [];
let current = null;
let idleSince = null;
for (const sample of samples) {
  if (idle(sample.id)) {
    idleSince ??= sample.at;
    if (current && sample.at - idleSince > 10_000) {
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
    busyMs: Math.round(stretch.samples.reduce((total, sample) => total + sample.ms, 0)),
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
      longestBusyStretches: stretches
        .sort((a, b) => b.samples.length - a.samples.length)
        .slice(0, 4)
        .map(describe),
    },
    null,
    1,
  ),
);
