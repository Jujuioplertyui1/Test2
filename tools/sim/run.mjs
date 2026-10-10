// Runs ORIGIN's behavior-pack scripts against the fake Minecraft in fakemc.mjs and plays scripted scenarios.
// Usage: node tools/sim/run.mjs [scenario ...]   (scenarios live in tools/sim/scenarios/*.mjs; default: all)
// A scenario exports `default async function ({ api, scripts, mc, tick, player })` and throws on failure.
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, readdirSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bp = resolve(here, "../../ORIGIN_BP");
const work = mkdtempSync(join(tmpdir(), "origin-sim-"));
cpSync(join(bp, "scripts"), join(work, "scripts"), { recursive: true });
writeFileSync(join(work, "package.json"), JSON.stringify({ type: "module" }));
for (const [name, file] of [["server", "fakemc.mjs"]]) {
  mkdirSync(join(work, `node_modules/@minecraft/${name}`), { recursive: true });
  cpSync(join(here, file), join(work, `node_modules/@minecraft/${name}/index.js`));
  writeFileSync(join(work, `node_modules/@minecraft/${name}/package.json`), JSON.stringify({ name: `@minecraft/${name}`, type: "module", main: "index.js" }));
}
{ // every other name the scripts import from @minecraft/server becomes a forgiving proxy
  const fake = readFileSync(join(here, "fakemc.mjs"), "utf8");
  const have = new Set([...fake.matchAll(/export (?:const|class|function|async function) (\w+)/g)].map((m) => m[1]).concat(["deep"]));
  const need = new Set();
  for (const f of readdirSync(join(bp, "scripts"))) for (const m of readFileSync(join(bp, "scripts", f), "utf8").matchAll(/import\s*{([^}]*)}\s*from\s*"@minecraft\/server"/g)) for (const n of m[1].split(",")) { const k = n.trim().split(/\s+as\s+/)[0]; if (k) need.add(k); }
  appendFileSync(join(work, "node_modules/@minecraft/server/index.js"), [...need].filter((n) => !have.has(n)).map((n) => `export const ${n} = deep(${JSON.stringify(n)});`).join("\n") + "\n");
}
mkdirSync(join(work, "node_modules/@minecraft/server-ui"), { recursive: true });
writeFileSync(join(work, "node_modules/@minecraft/server-ui/package.json"), JSON.stringify({ name: "@minecraft/server-ui", type: "module", main: "index.js" }));
writeFileSync(join(work, "node_modules/@minecraft/server-ui/index.js"), `
const H = globalThis.__fake;
class Form { constructor() { this.buttons = []; } title() { return this; } body() { return this; } button(t) { this.buttons.push(t); return this; } label() { return this; } divider() { return this; } header() { return this; }
  toggle() { return this; } slider() { return this; } dropdown() { return this; } textField() { return this; } submitButton() { return this; } button1() { return this; } button2() { return this; }
  async show(p) { const pick = (H.formAnswers ?? []).shift(); H.forms = (H.forms ?? 0) + 1; return pick === undefined ? { canceled: true, cancelationReason: "UserClosed" } : { canceled: false, selection: pick, formValues: pick }; } }
export class ActionFormData extends Form {} export class ModalFormData extends Form {} export class MessageFormData extends Form {}
export const FormCancelationReason = { UserBusy: "UserBusy", UserClosed: "UserClosed" };
export const FormResponse = {};
`);

const mc = await import(pathToFileURL(join(work, "node_modules/@minecraft/server/index.js")).href);
const H = globalThis.__fake;
const quietWarn = console.warn;
const warns = [];
console.warn = (...a) => warns.push(a.join(" "));
console.log = ((log) => (...a) => { if (!String(a[0]).startsWith("[ORIGIN] v")) log(...a); })(console.log);
await import(pathToFileURL(join(work, "scripts/main.js")).href);
const startupEv = { dimensionRegistry: { registerCustomDimension: () => {} }, customCommandRegistry: { registerCommand: () => {}, registerEnum: () => {} }, blockComponentRegistry: { registerCustomComponent: () => {} }, itemComponentRegistry: { registerCustomComponent: () => {} } };
for (const fn of H.startup) fn(startupEv);
for (const s of H.subs["world.afterEvents.worldLoad"] ?? []) s.fn({});

const scripts = async (name) => import(pathToFileURL(join(work, "scripts", name)).href);
const tick = (n, each) => mc.runTicks(n, each);
const want = process.argv.slice(2);
const dir = join(here, "scenarios");
const files = readdirSync(dir).filter((f) => f.endsWith(".mjs") && (!want.length || want.includes(f.replace(".mjs", ""))));
let failed = 0;
for (const f of files) {
  const before = H.errors.length, wBefore = warns.length;
  const ow = mc.world.getDimension("overworld");
  for (const e of [...ow.entities]) e.remove();
  const player = new mc.Player(ow, "Tester" + Math.floor(Math.random() * 1000), { x: 0.5, y: 64, z: 0.5 });
  let err = null;
  try { await (await import(pathToFileURL(join(dir, f)).href)).default({ mc, scripts, tick, player, H, log: (...a) => quietWarn("   ", ...a) }); }
  catch (e) { err = e; }
  const errs = H.errors.slice(before), ws = warns.slice(wBefore).filter((w) => !/not available in this version/.test(w));
  if (err || errs.length || ws.length) {
    failed++;
    quietWarn(`FAIL ${f}`);
    if (err) quietWarn("  " + (err.stack ?? err));
    for (const e of [...new Set(errs)].slice(0, 8)) quietWarn("  error: " + e.split("\n").slice(0, 3).join(" | "));
    for (const w of [...new Set(ws)].slice(0, 8)) quietWarn("  warn: " + w.split("\n").slice(0, 3).join(" | "));
  } else quietWarn(`ok   ${f}`);
  for (const e of [...player.dimension.entities]) e.remove();
  player.remove();
}
process.exit(failed ? 1 : 0);
