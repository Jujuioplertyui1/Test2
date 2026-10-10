// ORIGIN v0.10 - ego.js
// THE OTHER - the Alter Ego is no longer tied to one power. It's an ITEM you find:
//   Shard of the Other: dropped by NULL (always, first kill), villains (4%), Rift Brutes (2%), Nemeses (25%).
//   Use it -> bonding cinematic: your darker self wakes up inside you. More shards deepen the bond (Lv 1-3).
//   You get the Other's Mask: use = let it out, sneak + use = settings (Friendly / Hostile / Random).
// When you drop below 30% health (or take a killing blow) the Other TAKES OVER:
//   it stands where you stood, wearing your gear, wrapped in void - and YOU are locked in a cage
//   high above your Inner World until it's done. Double-tap sneak to struggle and take control back sooner.
// The Other is a person-shape made of pure black, and it is not careful:
//   SMASH: it punches craters into the ground. DETONATE: it makes things explode.
//   (It breaks blocks - unless there's a Deny block somewhere underneath them.)
//   INKWORK - its creativity: it draws whatever it needs out of the dark -
//     spikes that erupt in a line, hands that rise from the floor and hold, and copies of itself.
//   THE LEDGER: everything it destroys is written down. Every kill makes its next hit harder.
//   Rend, Void Step and THE UNMAKING (a dome of dark) are still in its hands too.
import { world, system, EquipmentSlot, GameMode, ItemStack } from "@minecraft/server";
import { hero, RT, markDirty, saveNow } from "./data.js";
import { V, at, valid, fx, line, sound, psound, C, now, hexToRgb, health, cmd, msg } from "./util.js";
import { hudMsg } from "./voice.js";
import { suitOf, makePiece } from "./suit.js";
import { oform, show, ICONS } from "./forms.js";
import { dmg, NO_HIT } from "./powers.js";
import { runCine, EASE } from "./cine.js";

export const SHARD = "origin:other_shard", MASK = "origin:other_mask", EGO = "origin:alter_ego";
const VOIDC = hexToRgb("#5a2a8a"), CRIM = hexToRgb("#c8102e"), INK = hexToRgb("#120814"), PALE = hexToRgb("#f0e6ff");
export const EGO_MODES = {
  friendly: { name: "Friendly", col: "§a", desc: "Hunts monsters and villains, shields players near it. Leaves people alone." },
  hostile: { name: "Hostile", col: "§c", desc: "Attacks everything: monsters, villagers, other players. It's still you. Technically." },
  random: { name: "Random", col: "§e", desc: "You find out when it wakes up: friendly or hostile (and once in a while, neither)." },
};
const MOODS = ["kind", "cruel", "just", "villain"];
const MOOD_LABEL = { kind: "§a(friendly)", cruel: "§c(hostile)", just: "§7(neutral)", villain: "§c(villain)" };
const LINES = {
  kind: ["§f\"Rest. I'll keep them safe.\"", "§7The Other kept everyone safe while you were gone."],
  cruel: ["§c\"Finally. My turn.\"", "§7The Other... wasn't gentle. Some people won't forget that."],
  just: ["§7\"Only the ones who deserve it.\"", "§7The Other did what needed doing. Nothing more."],
};
const egos = new Map(); // ownerId -> state
const vEgos = new Set();

export function bond(h) { return h.ego?.lvl ?? 0; }
export function rollMood(h) {
  const m = h.ego?.mode ?? h.egoMode ?? "random";
  if (m === "friendly") return "kind";
  if (m === "hostile") return "cruel";
  const x = Math.random();
  return x < 0.45 ? "kind" : x < 0.9 ? "cruel" : "just";
}
const takeoverSecs = (h) => 20 + bond(h) * 10;

// ------------------------------------------------------------------ the shard: bonding cinematic
export async function useShard(p, consume) {
  const h = hero(p), r = RT(p);
  if (!h.awakened) { hudMsg(p, "§7Your reflection in it doesn't move. §8(Awaken first.)"); return; }
  if (r.cine || r.traveling || r.caged) return;
  const lvl = bond(h);
  if (lvl >= 3) { hudMsg(p, "§7The Other is already as awake as it gets. §8(Bond Lv 3)"); return; }
  consume();
  h.ego = { lvl: lvl + 1, mode: h.ego?.mode ?? h.egoMode ?? "random", cd: 0 };
  saveNow(p);
  let twin = null;
  await runCine(p, async (c) => {
    const base = { ...p.location };
    const f = V.flat(p.getViewDirection());
    const front = at(base, f.x * 2.6, 0, f.z * 2.6);
    const head = p.getHeadLocation();
    try { p.addEffect("slowness", 200, { amplifier: 10, showParticles: false }); } catch { }
    c.cam(at(base, -f.z * 3.4 + f.x * 1.2, 1.8, f.x * 3.4 + f.z * 1.2), at(base, f.x * 1.3, 1.3, f.z * 1.3));
    c.say(lvl === 0 ? "§7There's someone in the glass." : "§7It's waiting for you.", 50);
    sound(p.dimension, "chime.amethyst_block", base, 1, 0.5);
    for (let i = 0; i < 6; i++) { fx(p.dimension, "origin:void_swirl", at(front, 0, 1, 0), VOIDC, 1); await c.wait(5); }
    // the reflection steps out
    try {
      twin = p.dimension.spawnEntity(EGO, front);
      twin.setProperty("origin:mood", MOODS.indexOf(rollMood(h)));
      twin.addTag("origin_cine_twin");
      twin.teleport(front, { facingLocation: head });
      dressEgo(p, twin);
    } catch { }
    sound(p.dimension, "random.glass", base, 1, 0.5);
    fx(p.dimension, "origin:burst", at(front, 0, 1, 0), C.white, 1);
    c.cam(at(base, f.x * 4.5 - f.z * 1.4, 1.7, f.z * 4.5 + f.x * 1.4), at(front, 0, 1.6, 0), 1.6, EASE.InOutSine);
    c.say(lvl === 0 ? "§f\"You kept me in the dark a long time.\"" : "§f\"Closer. Good.\"", 60);
    await c.wait(50);
    c.cam(at(base, f.x * 1.2, 1.65, f.z * 1.2), at(front, 0, 1.62, 0), 1.2, EASE.InExpo);
    c.say("§4\"Let me out sometimes.\"", 40);
    await c.wait(30);
    sound(p.dimension, "mob.warden.sonic_boom", base, 0.6, 0.6);
    fx(p.dimension, "origin:shockwave", at(base, 0, 0.05, 0), CRIM, 1, { radius: 4 });
    c.fade(0.1, 0.4, 0.8, { red: 0, green: 0, blue: 0 });
    await c.wait(4);
    try { twin?.remove(); } catch { }
    c.shake(0.4, 0.6);
    await c.wait(10);
  });
  try { twin?.remove(); } catch { }
  try { p.removeEffect("slowness"); } catch { }
  p.onScreenDisplay.setTitle("§4§lTHE OTHER", { fadeInDuration: 5, stayDuration: 50, fadeOutDuration: 20, subtitle: `§7bond level ${lvl + 1} · takes over below 30% health` });
  if (lvl === 0) {
    giveMask(p);
    msg(p, "§4§lTHE OTHER §r§7is awake. When you're about to fall, it takes over - and you're locked away until it's done.");
    msg(p, "§7Use the §fOther's Mask§7 to let it out yourself. Sneak + use: Friendly / Hostile / Random.");
  } else msg(p, `§4The bond deepens. §7Lv ${lvl + 1}: the Other stays ${takeoverSecs(h)}s and hits harder.`);
}
function giveMask(p) {
  try {
    const inv = p.getComponent("minecraft:inventory").container;
    for (let i = 0; i < inv.size; i++) if (inv.getItem(i)?.typeId === MASK) return;
    const it = new ItemStack(MASK, 1);
    it.setLore(["§7Use: let the Other out", "§7Sneak + use: how it behaves"]);
    inv.addItem(it);
  } catch { }
}

// ------------------------------------------------------------------ mask: menu + voluntary release
export async function useMask(p, sneaking) {
  const h = hero(p);
  if (!bond(h)) { hudMsg(p, "§7It's just a mask. §8(Bond with a Shard of the Other first.)"); return; }
  if (sneaking) return egoMenu(p);
  const r = RT(p);
  if (egos.has(p.id)) { hudMsg(p, "§7The Other is already out."); return; }
  if ((h.ego.cd ?? 0) > Date.now()) { hudMsg(p, `§7The Other is resting. §c${Math.ceil((h.ego.cd - Date.now()) / 1000)}s`, 40); return; }
  if (r.cine || r.traveling || r.station || r.caged) return;
  takeover(p, "chosen");
}
export async function egoMenu(p) {
  const h = hero(p);
  const M = EGO_MODES[h.ego?.mode ?? "random"];
  const f = oform("menu", "The Other", [
    `§4§lTHE OTHER§r §8· bond Lv ${bond(h)}/3`,
    "§7Below 30% health (or on a killing blow) it takes over for " + takeoverSecs(h) + "s. You wait in a cage in your Inner World. Double-tap sneak in there to struggle free sooner.",
    "§7Its powers: §fRend§7 (crescent of cuts), §fVoid Grasp§7 (drags enemies in), §fVoid Step§7 (blinks to a target), §fThe Unmaking§7 (a dome of dark, once per takeover).",
    "",
    `§fBehavior: ${M.col}${M.name}§7 - ${M.desc}`,
  ].join("\n"));
  const acts = [];
  f.button(`Behavior: ${M.col}${M.name}\n§8Tap to change`, ICONS + "talk_who"); acts.push("mode");
  f.button("Let it out\n§8Voluntary takeover · 3 min rest after", ICONS + "spar"); acts.push("out");
  f.button("Close", ICONS + "act_back"); acts.push("close");
  const res = await show(p, f);
  if (!res || res.canceled) return;
  const a = acts[res.selection];
  if (a === "mode") {
    const order = ["friendly", "hostile", "random"];
    h.ego.mode = order[(order.indexOf(h.ego.mode ?? "random") + 1) % 3];
    h.egoMode = h.ego.mode;
    markDirty(p);
    psound(p, "random.click", 1.2, 0.6);
    return egoMenu(p);
  }
  if (a === "out") return useMask(p, false);
}

// ------------------------------------------------------------------ takeover
function canTakeOver(p, h, r) {
  if (!bond(h) || !h.awakened) return false;
  if (egos.has(p.id) || r.cine || r.station || r.traveling || r.caged || h.staticState || h.banish) return false;
  return (h.ego.cd ?? 0) <= Date.now();
}
const NO_SAVE = ["void", "selfDestruct", "override"];
// beforeEvents.entityHurt (players): a killing blow becomes the takeover. Returns true if it handled it.
export function onHurtBefore(ev) {
  const p = ev.hurtEntity;
  const h = hero(p), r = RT(p);
  if (!canTakeOver(p, h, r) || r.egoPending) return false;
  if (NO_SAVE.includes(String(ev.damageSource?.cause))) return false;
  const hp = health(p);
  if (!hp || hp.cur - ev.damage > 0) return false;
  ev.cancel = true;
  r.egoPending = true;
  system.run(() => { r.egoPending = false; if (valid(p)) takeover(p, "dying"); });
  return true;
}
export function onHurtAfter(p) {
  const h = hero(p), r = RT(p);
  if (!canTakeOver(p, h, r) || r.egoPending) return;
  const hp = health(p);
  if (!hp || hp.cur > hp.max * 0.3 || hp.cur <= 0) return;
  takeover(p, "dying");
}

const EQ = ["Head", "Chest", "Legs", "Feet", "Mainhand", "Offhand"];
const PART = { Head: "mask", Chest: "torso", Legs: "legs", Feet: "boots" };
export function dressEgo(owner, ego) {
  const su = suitOf(hero(owner));
  let src = null, dst = null;
  try { src = owner.getComponent("minecraft:equippable"); } catch { }
  try { dst = ego.getComponent("minecraft:equippable"); } catch { }
  for (const s of EQ) {
    const slot = EquipmentSlot?.[s] ?? s;
    let it = null;
    try { it = src?.getEquipment(slot); } catch { }
    if (!it && PART[s]) it = makePiece(PART[s], su[PART[s]].style, su[PART[s]].color);
    if (!it) continue;
    try { dst?.setEquipment(slot, it.clone ? it.clone() : it); } catch { }
  }
}
function spawnOther(owner, loc, dim, mood, secs) {
  let ego;
  try { ego = dim.spawnEntity(EGO, loc); } catch { return null; }
  try {
    ego.setProperty("origin:mood", MOODS.indexOf(mood));
    ego.triggerEvent(`origin:set_${mood}`);
    ego.nameTag = `§f${owner.name}\n${MOOD_LABEL[mood]}`;
    ego.addEffect("strength", secs * 20, { amplifier: Math.max(0, bond(hero(owner)) - 1), showParticles: false });
    ego.addEffect("speed", secs * 20, { amplifier: 0, showParticles: false });
    owner.addTag("origin_alter_owner");
  } catch { }
  dressEgo(owner, ego);
  return ego;
}

export async function takeover(p, why) {
  const h = hero(p), r = RT(p);
  if (!canTakeOver(p, h, r)) return;
  const { centerOf, loadArea, iwDim } = await import("./innerworld.js");
  const secs = takeoverSecs(h);
  const mood = rollMood(h);
  h.ego.cd = Date.now() + (why === "chosen" ? 180000 : 300000);
  h.alter = mood;
  markDirty(p);
  const loc = { ...p.location }, dim = p.dimension;
  // the moment it happens: everything stops, the void pours out
  r.caged = { until: now() + secs * 20 + 40, start: now(), struggles: 0, kills: [], mood };
  try { p.addEffect("resistance", 60, { amplifier: 4, showParticles: false }); p.addEffect("slowness", 30, { amplifier: 10, showParticles: false }); } catch { }
  fx(dim, "origin:void_swirl", at(loc, 0, 1, 0), VOIDC, 1);
  fx(dim, "origin:shockwave", at(loc, 0, 0.05, 0), CRIM, 1, { radius: 5 });
  sound(dim, "mob.warden.emerge", loc, 1, 0.8);
  try { p.camera.fade({ fadeTime: { fadeInTime: 0.15, holdTime: 0.5, fadeOutTime: 0.8 }, fadeColor: { red: 0.05, green: 0, blue: 0.08 } }); } catch { }
  p.onScreenDisplay.setTitle("§4§lTHE OTHER", { fadeInDuration: 2, stayDuration: 30, fadeOutDuration: 10, subtitle: LINES[mood][0] });
  await system.waitTicks(6);
  if (!valid(p)) return;
  const ego = spawnOther(p, loc, dim, mood, secs);
  if (!ego) { r.caged = null; return; }
  const st = { ego, owner: p, mood, until: now() + secs * 20, domainDone: false, cd: { rend: now() + 20, grasp: now() + 40, step: now() + 30 }, lastLoc: loc, lastDim: dim };
  egos.set(p.id, st);
  // the cage: high above your Inner World, looking down at it
  const C0 = centerOf(p);
  const cage = at(C0, 0, 26, 0);
  r.caged.cage = cage;
  await loadArea("origin_cage_" + p.id.replace(/[^a-z0-9]/gi, ""), cage, 6);
  buildCage(iwDim(), cage);
  try {
    p.teleport(at(cage, 0.5, 0, 0.5), { dimension: iwDim(), facingLocation: at(C0, 0.5, 0, 0.5) });
    cmd(p, "fog @s push origin:void_room origin_cage");
    p.addEffect("instant_health", 1, { amplifier: 1 });
    p.addEffect("regeneration", secs * 20, { amplifier: 1, showParticles: false });
  } catch { }
  system.runTimeout(() => valid(p) && msg(p, "§4You're locked in. §7The Other has your body for " + secs + "s. §fDouble-tap sneak§7 to struggle."), 30);
}

function buildCage(dim, c) {
  const x = Math.floor(c.x), y = Math.floor(c.y), z = Math.floor(c.z);
  const run = (s) => { try { dim.runCommand(s); } catch { } };
  run(`fill ${x - 2} ${y - 1} ${z - 2} ${x + 2} ${y - 1} ${z + 2} minecraft:polished_blackstone`);
  run(`fill ${x - 2} ${y} ${z - 2} ${x + 2} ${y + 3} ${z + 2} minecraft:iron_bars hollow`);
  run(`fill ${x - 1} ${y} ${z - 1} ${x + 1} ${y + 3} ${z + 1} minecraft:air`);
  run(`fill ${x - 2} ${y + 4} ${z - 2} ${x + 2} ${y + 4} ${z + 2} minecraft:polished_blackstone`);
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
    run(`fill ${x + dx} ${y - 1} ${z + dz} ${x + dx} ${y + 4} ${z + dz} minecraft:crying_obsidian`);
    run(`fill ${x + dx} ${y + 5} ${z + dz} ${x + dx} ${y + 14} ${z + dz} minecraft:iron_bars`);
  }
  run(`setblock ${x} ${y + 3} ${z} minecraft:soul_lantern["hanging"=true]`);
  run(`setblock ${x} ${y - 2} ${z} minecraft:crying_obsidian`);
}
function clearCage(dim, c) {
  const x = Math.floor(c.x), y = Math.floor(c.y), z = Math.floor(c.z);
  try { dim.runCommand(`fill ${x - 2} ${y - 2} ${z - 2} ${x + 2} ${y + 14} ${z + 2} minecraft:air`); } catch { }
}

// double-tap sneak while caged
export function struggle(p) {
  const r = RT(p);
  if (!r.caged) return false;
  const c = r.caged;
  c.struggles++;
  const st = egos.get(p.id);
  if (st) st.until = Math.max(now() + 20, st.until - 30);
  try { p.runCommand("camerashake add @s 0.4 0.3 positional"); } catch { }
  sound(p.dimension, "random.anvil_land", p.location, 0.4, 1.6);
  fx(p.dimension, "origin:impact", p.getHeadLocation(), CRIM, 1, { size: 1 });
  hudMsg(p, c.struggles >= 8 ? "§f§lYOU TEAR FREE" : `§4STRUGGLE §7${"▮".repeat(c.struggles)}§8${"▮".repeat(Math.max(0, 8 - c.struggles))}`, 30);
  if (c.struggles >= 8 && st) st.until = now();
  return true;
}

async function release(id, st, why) {
  egos.delete(id);
  const p = st.owner;
  let last = { loc: st.lastLoc, dim: st.lastDim };
  try {
    if (valid(st.ego)) {
      last = { loc: { ...st.ego.location }, dim: st.ego.dimension };
      fx(st.ego.dimension, "origin:void_swirl", at(st.ego.location, 0, 1, 0), VOIDC, 1);
      st.ego.remove();
    }
  } catch { }
  const areaId = "origin_cage_" + String(id).replace(/[^a-z0-9]/gi, "");
  if (!valid(p)) { try { (await import("./innerworld.js")).unloadArea(areaId); } catch { } return; }
  const r = RT(p);
  const cage = r.caged?.cage;
  const kills = r.caged?.kills ?? [];
  r.caged = null;
  try { p.removeTag("origin_alter_owner"); } catch { }
  try { p.camera.fade({ fadeTime: { fadeInTime: 0.3, holdTime: 0.4, fadeOutTime: 1 }, fadeColor: { red: 0, green: 0, blue: 0 } }); } catch { }
  await system.waitTicks(7);
  try {
    p.teleport(last.loc, { dimension: last.dim });
    cmd(p, "fog @s remove origin_cage");
  } catch { }
  const { iwDim, unloadArea } = await import("./innerworld.js");
  if (cage) clearCage(iwDim(), cage);
  unloadArea(areaId);
  p.onScreenDisplay.setTitle("§fyou're back", { fadeInDuration: 5, stayDuration: 30, fadeOutDuration: 15, subtitle: why === "died" ? "§7the Other was beaten" : `§7${LINES[st.mood]?.[1] ?? ""}` });
  if (kills.length) msg(p, `§4While you were gone: §7${kills.slice(0, 6).join(", ")}${kills.length > 6 ? ` +${kills.length - 6} more` : ""}`);
}

// ------------------------------------------------------------------ the Other's AI (every 2 ticks)
function foes(st) {
  const e = st.ego;
  let list = [];
  try { list = e.dimension.getEntities({ location: e.location, maxDistance: 16, excludeTypes: NO_HIT, excludeFamilies: ["inanimate"] }); } catch { }
  return list.filter((t) => {
    if (t.id === e.id || t.id === st.owner.id || t.typeId === EGO && !t.hasTag("origin_villain_ego")) return false;
    const isPlayer = t.typeId === "minecraft:player";
    if (isPlayer) { try { const gm = t.getGameMode(); if (gm === GameMode.Creative || gm === GameMode.Spectator) return false; } catch { } }
    let fam = [];
    try { fam = t.getComponent("minecraft:type_family")?.getTypeFamilies?.() ?? []; } catch { }
    const monster = fam.includes("monster") || t.typeId === "origin:villain" || t.typeId === "origin:rift_brute" || t.hasTag?.("origin_villain_ego");
    if (st.mood === "kind") return monster;
    if (st.mood === "just") return monster || t.id === st.lastHurtBy;
    return monster || isPlayer || fam.includes("villager") || fam.includes("mob");
  });
}
function rend(st, target) {
  const e = st.ego, dim = e.dimension;
  const o = at(e.location, 0, 1.2, 0);
  const f = V.flat(V.sub(target.location, e.location));
  const r = { x: -f.z, y: 0, z: f.x };
  for (let i = -3; i <= 3; i++) {
    const a = i / 3;
    const p1 = V.add(o, V.add(V.mul(f, 1.2), V.mul(r, a * 1.6)));
    const p2 = V.add(o, V.add(V.mul(f, 4.2), V.mul(r, a * 3.2)));
    line(dim, "origin:trail", at(p1, 0, Math.abs(a) * 0.5, 0), at(p2, 0, -Math.abs(a) * 0.3, 0), CRIM, 0.35, 1);
  }
  sound(dim, "item.trident.riptide_1", e.location, 0.7, 1.6);
  const lvl = bond(hero(st.owner));
  for (const t of foes(st)) {
    const d = V.sub(t.location, e.location);
    if (V.len(d) > 5) continue;
    if (V.dot(V.flat(d), f) < 0.3) continue;
    dmg(t, 5 + lvl * 2, e);
    fx(dim, "origin:impact", t.getHeadLocation?.() ?? t.location, CRIM, 1, { size: 1 });
    import("./dismember.js").then((m) => m.tryCut(e, t, 5 + lvl * 2, "power")).catch(() => { });
  }
}
function grasp(st) {
  const e = st.ego, dim = e.dimension;
  fx(dim, "origin:void_swirl", at(e.location, 0, 1, 0), VOIDC, 1);
  sound(dim, "mob.warden.dig", e.location, 1, 0.7);
  for (const t of foes(st)) {
    const d = V.dist(t.location, e.location);
    if (d < 3 || d > 12) continue;
    line(dim, "origin:dot", at(e.location, 0, 1, 0), at(t.location, 0, 1, 0), VOIDC, 0.8, 1);
    const pull = V.flat(V.sub(e.location, t.location));
    try { t.applyKnockback({ x: pull.x * Math.min(2.2, d * 0.2), z: pull.z * Math.min(2.2, d * 0.2) }, 0.3); } catch { }
    dmg(t, 2, e);
  }
}
function voidStep(st, target) {
  const e = st.ego, dim = e.dimension;
  const f = V.flat(V.sub(target.location, e.location));
  const dest = at(target.location, -f.x * 1.4, 0, -f.z * 1.4);
  fx(dim, "origin:void_swirl", at(e.location, 0, 1, 0), INK, 1);
  try { e.tryTeleport(dest, { checkForBlocks: true, facingLocation: target.location }); } catch { }
  fx(dim, "origin:void_swirl", at(e.location, 0, 1, 0), INK, 1);
  sound(dim, "mob.endermen.portal", e.location, 0.6, 0.6);
}
// THE UNMAKING: a dome of dark, 9 blocks, 6 seconds
async function unmaking(st) {
  const e = st.ego, dim = e.dimension;
  const c = { ...e.location };
  st.domainUntil = now() + 120;
  try { e.setProperty("origin:cast", 1); } catch { }
  sound(dim, "mob.warden.sonic_charge", c, 1.4, 0.5);
  dim.getPlayers({ location: c, maxDistance: 40 }).forEach((pl) => { try { pl.onScreenDisplay.setTitle("§4§lTHE UNMAKING", { fadeInDuration: 2, stayDuration: 30, fadeOutDuration: 10, subtitle: "§7get out of the dark" }); } catch { } });
  for (let k = 0; k < 24 && valid(e); k++) {
    const R = Math.min(9, 2 + k * 0.6);
    for (let lat = 0; lat < 5; lat++) {
      const phi = (lat / 5) * (Math.PI / 2);
      const n = 10 + lat * 2;
      for (let i = 0; i < n; i += 2) {
        const th = (i / n) * Math.PI * 2 + k * 0.2;
        fx(dim, "origin:dot", at(c, Math.cos(th) * Math.cos(phi) * R, Math.sin(phi) * R, Math.sin(th) * Math.cos(phi) * R), lat % 2 ? CRIM : INK, 1);
      }
    }
    if (k % 4 === 0) {
      for (const t of foes(st)) {
        if (V.dist(t.location, c) > R) continue;
        dmg(t, 3 + bond(hero(st.owner)), e);
        try { t.addEffect("slowness", 30, { amplifier: 2 }); t.addEffect("darkness", 60, { showParticles: false }); } catch { }
        const a = Math.random() * Math.PI * 2;
        line(dim, "origin:trail", at(t.location, Math.cos(a) * 1.4, 2.2, Math.sin(a) * 1.4), at(t.location, -Math.cos(a) * 1.4, 0.2, -Math.sin(a) * 1.4), CRIM, 0.3, 1);
      }
      sound(dim, "item.trident.riptide_1", c, 0.5, 1.8);
    }
    await system.waitTicks(5);
  }
  try { if (valid(e)) e.setProperty("origin:cast", 0); } catch { }
}

export function tickEgos() {
  const t = now();
  for (const [id, st] of egos) {
    const e = st.ego;
    if (!valid(st.owner)) { egos.delete(id); try { e.remove(); } catch { } continue; }
    if (!valid(e)) { release(id, st, "died"); continue; }
    if (t >= st.until) { release(id, st, "time"); continue; }
    st.lastLoc = { ...e.location }; st.lastDim = e.dimension;
    if (t % 4 === 0) fx(e.dimension, "origin:void_swirl", at(e.location, (Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 1.4, (Math.random() - 0.5) * 0.6), INK, 0.7);
    if ((st.domainUntil ?? 0) > t) continue;
    const list = foes(st);
    if (!list.length) {
      if (st.mood === "kind" && t % 40 === 0) {
        try { for (const pl of e.dimension.getPlayers({ location: e.location, maxDistance: 7 })) pl.addEffect("absorption", 120, { amplifier: 0 }); } catch { }
      }
      continue;
    }
    let target = list[0], bd = 1e9;
    for (const x of list) { const d = V.dist(x.location, e.location); if (d < bd) { bd = d; target = x; } }
    if (!st.domainDone && (list.length >= 3 || t - (st.until - 20 * takeoverSecs(hero(st.owner))) > 160)) { st.domainDone = true; unmaking(st); continue; }
    if (monster(st, target, bd, t)) continue;
    if (bd > 6 && bd < 18 && t >= st.cd.step) { st.cd.step = t + 70; voidStep(st, target); continue; }
    if (bd < 5 && t >= st.cd.rend) { st.cd.rend = t + 36; rend(st, target); continue; }
    if (list.length >= 2 && t >= st.cd.grasp) { st.cd.grasp = t + 120; grasp(st); }
  }
}
// what the Other did while you watched from the cage
export function onEgoKill(killer, dead) {
  for (const st of egos.values()) {
    if (st.ego.id !== killer?.id) continue;
    const r = RT(st.owner);
    const name = dead.typeId === "minecraft:player" ? dead.name : (dead.nameTag?.split("\n")[0] || dead.typeId.split(":")[1].replace(/_/g, " "));
    r.caged?.kills.push(name);
    st.ledger = (st.ledger ?? 0) + 1;
    hudMsg(st.owner, `§4The Other: §7${name} is gone.`, 40);
  }
}
export function onEgoHurt(e, src) {
  for (const st of egos.values()) if (st.ego.id === e.id && src) st.lastHurtBy = src.id;
}
// caged HUD line
export function cageLine(p) {
  const r = RT(p);
  if (!r.caged) return null;
  const st = egos.get(p.id);
  const left = st ? Math.max(0, st.until - now()) : 0;
  return `§4§lLOCKED IN §r§7${Math.ceil(left / 20)}s · §fdouble-tap sneak§7 to struggle`;
}
export const isCaged = (p) => !!RT(p).caged;
// relog while caged: clean up
export async function rescueCaged(p) {
  const r = RT(p);
  r.caged = null;
  try { p.removeTag("origin_alter_owner"); cmd(p, "fog @s remove origin_cage"); } catch { }
}

// villains with Sentry still split off a hostile double of their own
export function villainEgo(villain, name) {
  let ego;
  try { ego = villain.dimension.spawnEntity(EGO, at(villain.location, 1, 0, 0)); } catch { return null; }
  try {
    ego.setProperty("origin:mood", 3);
    ego.triggerEvent("origin:set_villain");
    ego.nameTag = `§c${name}\n${MOOD_LABEL.villain}`;
    ego.addTag("origin_villain_ego");
    vEgos.add(ego.id);
  } catch { }
  fx(villain.dimension, "origin:void_swirl", at(ego.location, 0, 1, 0), VOIDC, 1);
  const id = ego.id;
  system.runTimeout(() => { vEgos.delete(id); try { if (valid(ego)) ego.remove(); } catch { } }, 400);
  return ego;
}
// leftovers after a reload
export function sweepEgos() {
  const known = new Set([...egos.values()].map((s) => s.ego?.id));
  for (const id of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end", "origin:inner_world"]) {
    let list = [];
    try { list = world.getDimension(id).getEntities({ type: EGO }); } catch { }
    for (const e of list) if (!known.has(e.id) && !vEgos.has(e.id) && !clones.has(e.id) && !e.hasTag("origin_cine_twin")) { try { e.remove(); } catch { } }
  }
}
export function egoOut(p) { return egos.has(p.id); }

// ================================================================== v0.10: the black monster's toolkit
const PROTECTED = /bedrock|barrier|deny|allow|border_block|command_block|structure_block|structure_void|jigsaw|end_portal|end_gateway|portal|obsidian|reinforced_deepslate|light_block|^origin:/;
function denied(dim, x, y, z, cache) {
  const key = `${x},${z}`;
  if (cache.has(key) && cache.get(key).y <= y) return cache.get(key).deny;
  let deny = false;
  for (let yy = y - 1; yy >= Math.max(-64, y - 80); yy--) {
    try { if (dim.getBlock({ x, y: yy, z })?.typeId === "minecraft:deny") { deny = true; break; } } catch { break; }
  }
  cache.set(key, { y, deny });
  return deny;
}
// break blocks in a sphere, skipping protected blocks and anything with a Deny block below it
export function crater(dim, c, R, cache = new Map()) {
  let n = 0;
  const cx = Math.floor(c.x), cy = Math.floor(c.y), cz = Math.floor(c.z);
  for (let dx = -R; dx <= R; dx++) for (let dy = -R; dy <= R; dy++) for (let dz = -R; dz <= R; dz++) {
    if (dx * dx + dy * dy + dz * dz > R * R + 0.5) continue;
    const x = cx + dx, y = cy + dy, z = cz + dz;
    let b;
    try { b = dim.getBlock({ x, y, z }); } catch { continue; }
    if (!b || b.isAir || b.isLiquid || PROTECTED.test(b.typeId)) continue;
    if (denied(dim, x, y, z, cache)) continue;
    try { b.setType("minecraft:air"); n++; } catch { }
    if (n % 6 === 0) fx(dim, "origin:debris", { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, C.dust, 0.6);
  }
  return n;
}
function blast(st, c, R, dmgN) {
  const e = st.ego, dim = e.dimension;
  fx(dim, "origin:flash", c, C.white, 1, { size: R * 1.5 });
  fx(dim, "origin:boom_fire", c, INK, 1); fx(dim, "origin:boom_smoke", c, C.grey, 1); fx(dim, "origin:shockwave", c, CRIM, 1, { radius: R + 1 });
  fx(dim, "origin:shards", c, C.dust, 1); fx(dim, "origin:dust", c, C.white, 1);
  sound(dim, "random.explode", c, 1.6, 0.7);
  crater(dim, c, R);
  for (const t of foes(st)) {
    const d = V.dist(t.location, c);
    if (d > R + 1.5) continue;
    dmg(t, Math.round(dmgN * (1 - d / (R + 2))) + 2 + ledgerBonus(st), e);
    const away = V.flat(V.sub(t.location, c));
    try { t.applyKnockback({ x: away.x * 1.4, z: away.z * 1.4 }, 0.6); } catch { }
  }
}
function ledgerBonus(st) { return Math.min(6, st.ledger ?? 0); }
function smash(st) {
  const e = st.ego, dim = e.dimension;
  const f = V.flat(e.getViewDirection?.() ?? { x: 0, y: 0, z: 1 });
  const c = at(e.location, f.x * 1.5, -0.5, f.z * 1.5);
  sound(dim, "random.anvil_land", c, 0.8, 0.5);
  blast(st, c, 2, 8);
}
// INKWORK: it draws what it needs
const inkLive = [];
function inkEntity(dim, type, loc, life) {
  try { const e = dim.spawnEntity(type, loc); inkLive.push({ e, until: now() + life }); return e; } catch { return null; }
}
async function inkSpikes(st, target) {
  const e = st.ego, dim = e.dimension;
  const f = V.flat(V.sub(target.location, e.location));
  const n = Math.min(12, Math.ceil(V.hdist(target.location, e.location)) + 2);
  sound(dim, "mob.warden.dig", e.location, 1, 0.6);
  for (let i = 1; i <= n; i++) {
    const c = at(e.location, f.x * i * 0.9, 0, f.z * i * 0.9);
    inkEntity(dim, "origin:ink_spike", c, 30);
    fx(dim, "origin:debris", c, C.dust, 0.6);
    for (const t of foes(st)) if (V.hdist(t.location, c) < 1.2) { dmg(t, 5 + ledgerBonus(st), e); try { t.applyKnockback({ x: 0, z: 0 }, 0.9); } catch { } }
    if (i % 2 === 0) await system.waitTicks(1);
    if (!valid(e)) return;
  }
}
function inkHands(st) {
  const e = st.ego, dim = e.dimension;
  const list = foes(st).filter((t) => V.dist(t.location, e.location) < 12).slice(0, 3);
  for (const t of list) {
    inkEntity(dim, "origin:ink_hand", { ...t.location }, 60);
    try { t.addEffect("slowness", 60, { amplifier: 10 }); } catch { }
    dmg(t, 3 + ledgerBonus(st), e);
    for (let k = 1; k <= 2; k++) system.runTimeout(() => valid(t) && dmg(t, 3, e), k * 20);
  }
  if (list.length) sound(dim, "mob.warden.emerge", e.location, 0.8, 1.2);
}
const clones = new Set();
function inkCopies(st) {
  const e = st.ego, dim = e.dimension;
  for (let i = 0; i < 2; i++) {
    const a = Math.random() * Math.PI * 2;
    let c;
    try { c = dim.spawnEntity(EGO, at(e.location, Math.cos(a) * 2, 0, Math.sin(a) * 2)); } catch { continue; }
    try { c.setProperty("origin:mood", MOODS.indexOf(st.mood)); c.triggerEvent(`origin:set_${st.mood}`); c.addTag("origin_ink_copy"); } catch { }
    clones.add(c.id);
    fx(dim, "origin:void_swirl", at(c.location, 0, 1, 0), INK, 1);
    const id = c.id;
    system.runTimeout(() => { clones.delete(id); try { if (valid(c)) { fx(c.dimension, "origin:void_swirl", at(c.location, 0, 1, 0), INK, 1); c.remove(); } } catch { } }, 240);
  }
  sound(dim, "mob.evocation_illager.prepare_summon", e.location, 0.8, 0.6);
}
// every tick-ish housekeeping for the ink
export function tickInk() {
  const t = now();
  for (let i = inkLive.length - 1; i >= 0; i--) {
    const q = inkLive[i];
    if (!valid(q.e) || t >= q.until) { try { if (valid(q.e)) { fx(q.e.dimension, "origin:void_swirl", q.e.location, INK, 0.6); q.e.remove(); } } catch { } inkLive.splice(i, 1); }
  }
}
// the black monster's extra moves, chosen alongside the old ones (called from tickEgos)
function monster(st, target, bd, t) {
  st.cd2 = st.cd2 ?? { smash: t + 30, det: t + 60, ink: t + 40, copies: t + 100 };
  if (bd < 3.5 && t >= st.cd2.smash) { st.cd2.smash = t + 70; smash(st); return true; }
  if (bd < 14 && t >= st.cd2.det) { st.cd2.det = t + 150; blast(st, at(target.location, 0, 0.5, 0), 2, 10); return true; }
  if (t >= st.cd2.ink) {
    st.cd2.ink = t + 90;
    const pick = (st.inkTurn = ((st.inkTurn ?? -1) + 1) % 3);
    if (pick === 0 && bd > 3) { inkSpikes(st, target); return true; }
    if (pick === 1) { inkHands(st); return true; }
    if (pick === 2 && t >= st.cd2.copies) { st.cd2.copies = t + 400; inkCopies(st); return true; }
  }
  return false;
}
