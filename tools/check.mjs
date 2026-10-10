// Load-time check for the behavior pack scripts, run with plain Node (no Minecraft needed).
// It swaps @minecraft/server and @minecraft/server-ui for permissive fakes, imports scripts/main.js,
// fires the startup/worldLoad hooks and runs every registered interval a few times with no players.
// That catches syntax errors, imports of names a module doesn't export, and code that throws at load.
// Usage: node tools/check.mjs [path/to/ORIGIN_BP]
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const bp = resolve(process.argv[2] ?? "ORIGIN_BP");
const work = mkdtempSync(join(tmpdir(), "origin-check-"));
cpSync(join(bp, "scripts"), join(work, "scripts"), { recursive: true });
writeFileSync(join(work, "package.json"), JSON.stringify({ type: "module" }));

const names = (mod) => {
  const set = new Set();
  for (const f of readdirSync(join(bp, "scripts"))) {
    const src = readFileSync(join(bp, "scripts", f), "utf8");
    const re = new RegExp(`import\\s*{([^}]*)}\\s*from\\s*"${mod.replace("/", "\\/")}"`, "g");
    for (const m of src.matchAll(re)) for (const n of m[1].split(",")) { const k = n.trim().split(/\s+as\s+/)[0]; if (k) set.add(k); }
  }
  return [...set];
};
const FAKE = `
const handlers = globalThis.__origin = globalThis.__origin ?? { intervals: [], timeouts: [], startup: [], subs: {} };
const deep = (path) => new Proxy(function () {}, {
  get(_, k) {
    if (k === Symbol.toPrimitive) return () => 0;
    if (k === "then") return undefined;
    if (k === Symbol.iterator) return function* () {};
    if (k === "subscribe") return (fn) => { (handlers.subs[path] ??= []).push(fn); return fn; };
    if (k === "unsubscribe") return () => {};
    return deep(path + "." + String(k));
  },
  apply() { return deep(path + "()"); },
  construct() { return deep("new " + path); },
});
const evt = (name) => deep(name);
export const system = {
  get currentTick() { return handlers.tick ?? 0; },
  runInterval(fn, n = 1) { handlers.intervals.push([fn, n]); return handlers.intervals.length; },
  runTimeout(fn, n = 1) { handlers.timeouts.push([fn, n]); return 0; },
  run(fn) { handlers.timeouts.push([fn, 0]); return 0; },
  runJob(gen) { handlers.timeouts.push([() => { for (const _ of gen) { } }, 0]); return 0; },
  clearRun() {}, clearJob() {},
  waitTicks(n) { return Promise.resolve(); },
  afterEvents: deep("system.afterEvents"),
  beforeEvents: { startup: { subscribe: (fn) => handlers.startup.push(fn) }, shutdown: { subscribe() {} }, watchdogTerminate: { subscribe() {} } },
};
const dimension = deep("dimension");
export const world = {
  afterEvents: deep("world.afterEvents"), beforeEvents: deep("world.beforeEvents"),
  getAllPlayers: () => [], getPlayers: () => [], getDimension: () => dimension,
  getDynamicProperty: () => undefined, setDynamicProperty: () => {}, getDynamicPropertyIds: () => [],
  getDefaultSpawnLocation: () => ({ x: 0, y: 64, z: 0 }), getTimeOfDay: () => 0, setTimeOfDay: () => {},
  scoreboard: deep("scoreboard"), gameRules: deep("gameRules"), sendMessage: () => {}, getAbsoluteTime: () => 0, getDay: () => 0,
  structureManager: deep("structureManager"), getEntity: () => undefined, playSound: () => {}, playMusic: () => {}, stopMusic: () => {},
};
export class ItemStack { constructor(id, n = 1) { this.typeId = id; this.amount = n; } getComponent() { return undefined; } setLore() {} getLore() { return []; } clone() { return new ItemStack(this.typeId, this.amount); } }
export class MolangVariableMap { setColorRGBA() {} setColorRGB() {} setFloat() {} setVector3() {} setSpeedAndDirection() {} }
export class BlockVolume { constructor(a, b) { this.from = a; this.to = b; } }
export const BlockPermutation = { resolve: (id) => ({ type: { id }, matches: () => false, getState: () => undefined, withState() { return this; } }) };
`;
const server = names("@minecraft/server");
const ui = names("@minecraft/server-ui");
const known = new Set(["system", "world", "ItemStack", "MolangVariableMap", "BlockVolume", "BlockPermutation"]);
let src = FAKE;
for (const n of server) if (!known.has(n)) src += `export const ${n} = deep(${JSON.stringify(n)});\n`;
mkdirSync(join(work, "node_modules/@minecraft/server"), { recursive: true });
writeFileSync(join(work, "node_modules/@minecraft/server/package.json"), JSON.stringify({ name: "@minecraft/server", type: "module", main: "index.js" }));
writeFileSync(join(work, "node_modules/@minecraft/server/index.js"), src);
mkdirSync(join(work, "node_modules/@minecraft/server-ui"), { recursive: true });
writeFileSync(join(work, "node_modules/@minecraft/server-ui/package.json"), JSON.stringify({ name: "@minecraft/server-ui", type: "module", main: "index.js" }));
writeFileSync(join(work, "node_modules/@minecraft/server-ui/index.js"),
  `const deep = (p) => new Proxy(function () {}, { get(_, k) { if (k === "then") return undefined; return deep(p + "." + String(k)); }, apply() { return deep(p); }, construct() { return deep(p); } });\n` +
  ui.map((n) => `export const ${n} = deep(${JSON.stringify(n)});`).join("\n"));

const warns = [];
const origWarn = console.warn;
console.warn = (...a) => { warns.push(a.join(" ")); };
let failed = false;
try {
  await import(pathToFileURL(join(work, "scripts/main.js")).href);
  const H = globalThis.__origin;
  const startupEv = { dimensionRegistry: { registerCustomDimension: () => {} }, customCommandRegistry: { registerCommand: () => {}, registerEnum: () => {} }, blockComponentRegistry: { registerCustomComponent: () => {} }, itemComponentRegistry: { registerCustomComponent: () => {} } };
  for (const fn of H.startup) fn(startupEv);
  for (const fn of H.subs["world.afterEvents.worldLoad"] ?? []) fn({});
  for (let t = 1; t <= 1200; t++) {
    H.tick = t;
    for (const [fn, n] of H.intervals) if (t % n === 0) fn();
    const due = H.timeouts.splice(0);
    for (const [fn] of due) { try { fn(); } catch (e) { warns.push("timeout: " + e); } }
  }
  console.log(`loaded OK: ${H.intervals.length} loops, ${Object.values(H.subs).flat().length} event handlers, ${H.startup.length} startup hooks`);
} catch (e) {
  failed = true;
  console.log("LOAD FAILED: " + (e?.stack ?? e));
}
console.warn = origWarn;
const real = warns.filter((w) => !/not available in this version/.test(w));
if (real.length) { console.log(`${real.length} warnings:`); for (const w of [...new Set(real)].slice(0, 40)) console.log("  " + w.split("\n")[0]); }
process.exit(failed || real.length ? 1 : 0);
