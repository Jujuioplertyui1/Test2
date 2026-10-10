// ORIGIN v0.02 - util.js
import { world, system, MolangVariableMap } from "@minecraft/server";

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const now = () => system.currentTick;

export const V = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  mul: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  len: (a) => Math.hypot(a.x, a.y, a.z),
  dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
  hdist: (a, b) => Math.hypot(a.x - b.x, a.z - b.z),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  norm: (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; },
  flat: (a) => { const l = Math.hypot(a.x, a.z) || 1; return { x: a.x / l, y: 0, z: a.z / l }; },
  lerp: (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) }),
};

// offset helper: c + {x,y,z} (missing fields = 0)
export const at = (c, x = 0, y = 0, z = 0) => ({ x: c.x + x, y: c.y + y, z: c.z + z });

// Minecraft yaw: 0 = +Z (south), 90 = -X (west)
export function yawTo(from, to) {
  return (Math.atan2(-(to.x - from.x), to.z - from.z) * 180) / Math.PI;
}
export function forwardFromYaw(yaw) {
  const r = (yaw * Math.PI) / 180;
  return { x: -Math.sin(r), y: 0, z: Math.cos(r) };
}
export function rightOf(f) {
  return { x: -f.z, y: 0, z: f.x };
}

// effect entities - models that are only there to be seen (lines, cocoons, rubble, afterimages...): nothing should ever
// target, hit, rewind or track them
export const FX_IDS = ["origin:float_text", "origin:archetype_orb", "origin:manifestation", "origin:carry_tree", "origin:carry_boulder", "origin:regen_body",
  "origin:afterimage", "origin:severed_limb", "origin:prosthetic", "origin:ice_shell", "origin:ice_formation", "origin:blood_spike", "origin:tk_rock", "origin:void_stain",
  "origin:tether", "origin:web_wrap", "origin:singularity", "origin:tendril", "origin:clock_rune", "origin:shade_clone", "origin:exo_piece", "origin:lumen_construct",
  "origin:xox_phantom", "origin:mjolnir_thrown", "origin:shield_thrown", "origin:mjolnir_stone"];
export function valid(e) {
  try { return !!e && e.isValid; } catch { return false; }
}

export function cmd(target, s) {
  try { return target.runCommand(s); } catch { return undefined; }
}

export function overworld() {
  return world.getDimension("minecraft:overworld");
}

export function hexToRgb(hex) {
  const h = String(hex).replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16) || 0;
  return { red: ((n >> 16) & 255) / 255, green: ((n >> 8) & 255) / 255, blue: (n & 255) / 255 };
}
export function rgbToHex(c) {
  const t = (v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, "0");
  return ("#" + t(c.red) + t(c.green) + t(c.blue)).toUpperCase();
}

// Named effect colors
export const C = {
  white: hexToRgb("#FFFFFF"),
  gold: hexToRgb("#FFD36A"),
  ember: hexToRgb("#F07A21"),
  cyan: hexToRgb("#3CC8F0"),
  violet: hexToRgb("#8A3FD1"),
  crimson: hexToRgb("#C8261D"),
  blood: hexToRgb("#8B0F1A"),
  grey: hexToRgb("#8A8A99"),
  ash: hexToRgb("#3A3644"),
  dust: hexToRgb("#9C9285"),
  black: hexToRgb("#000000"),
};

export function fx(dim, id, loc, rgb = C.white, alpha = 1, floats) {
  try {
    const m = new MolangVariableMap();
    m.setColorRGBA("variable.color", { red: rgb.red, green: rgb.green, blue: rgb.blue, alpha });
    if (floats) for (const k in floats) m.setFloat("variable." + k, floats[k]);
    dim.spawnParticle(id, loc, m);
  } catch { /* chunk not loaded or particle missing */ }
}

export function line(dim, id, a, b, rgb, step = 0.5, alpha = 1) {
  const d = V.dist(a, b);
  const n = Math.min(60, Math.max(1, Math.floor(d / step)));
  for (let i = 0; i <= n; i++) fx(dim, id, V.lerp(a, b, i / n), rgb, alpha);
}

export function sound(dim, id, loc, pitch = 1, volume = 1) {
  try { dim.playSound(id, loc, { pitch, volume }); } catch { }
}
export function psound(player, id, pitch = 1, volume = 1) {
  try { player.playSound(id, { pitch, volume }); } catch { }
}

export function msg(player, text) {
  try { player.sendMessage(text); } catch { }
}

export function health(e) {
  try {
    const h = e.getComponent("minecraft:health");
    return h ? { cur: h.currentValue, max: h.effectiveMax } : null;
  } catch { return null; }
}

export function cleanName(s, fallback) {
  const t = String(s ?? "").replace(/§./g, "").replace(/[\n\r]/g, " ").trim().slice(0, 20);
  return t.length ? t : fallback;
}

export function locOf(player) {
  const l = player.location;
  return { dim: player.dimension.id, x: l.x, y: l.y, z: l.z, ry: player.getRotation().y };
}

export const sleep = (t) => system.waitTicks(Math.max(1, Math.floor(t)));

// Block.isSolid is beta-only (not in the stable API this add-on uses): solid = not air, not liquid, not a plant/torch/etc.
const SOFT_BLOCK = /(short_grass|tall_grass|:grass$|fern|flower|torch|vine|carpet|sapling|button|rail|lever|sign|dandelion|poppy|tulip|orchid|allium|bluet|daisy|cornflower|lily|bush|_mushroom$|sugar_cane|kelp|seagrass|wheat|carrots|potatoes|beetroot|snow_layer|dead_?bush|roots|sprouts|petals|leaf_litter|light_block|web|banner|pressure_plate|tripwire|redstone_wire|:fire$|soul_fire|lantern|end_rod|candle|flower_pot|ladder|scaffolding|structure_void|barrier)/;
export const isSolidBlock = (b) => !!b && !b.isAir && !b.isLiquid && !SOFT_BLOCK.test(b.typeId);

// Allies a hero's moves should never hit by accident: Asgard's guardians, villagers and golems, and tamed pets.
// (Melee you aim yourself still lands - this is for ricochets, splash, homing and auto-targeting.)
const ALLY_TYPES = new Set(["origin:heimdall", "origin:einherjar", "minecraft:villager", "minecraft:villager_v2", "minecraft:wandering_trader",
  "minecraft:iron_golem", "minecraft:snow_golem", "minecraft:allay", "minecraft:armor_stand"]);
export function isAlly(e) {
  try {
    if (!e || ALLY_TYPES.has(e.typeId)) return true;
    if (e.matches?.({ families: ["asgardian"] })) return true;
    const tame = e.getComponent?.("minecraft:tameable");
    if (tame?.isTamed) return true;
  } catch { }
  return false;
}
