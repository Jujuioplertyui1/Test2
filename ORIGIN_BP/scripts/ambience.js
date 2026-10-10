// ORIGIN v0.13 - ambience.js
// Living dimensions: ambient particles only you see, drawn around you in the Inner World (motes and petals,
// ash when your Dread is high), the Static (drifting snow and glitches) and the Void (things moving in the dark).
import { world, MolangVariableMap } from "@minecraft/server";
import { hero } from "./data.js";
import { at, hexToRgb } from "./util.js";
import { DIM_ID, STATIC_ID, VOID_ROOM } from "./plan.js";

function emit(p, id, n, r, y0, y1, cols, alpha = 0.85) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, d = 1.5 + Math.random() * r;
    const c = hexToRgb(cols[i % cols.length]);
    const m = new MolangVariableMap();
    m.setColorRGBA("variable.color", { red: c.red, green: c.green, blue: c.blue, alpha });
    try { p.spawnParticle(id, at(p.location, Math.cos(a) * d, y0 + Math.random() * (y1 - y0), Math.sin(a) * d), m); } catch { }
  }
}
// every 10 ticks
export function tickAmbience() {
  for (const p of world.getAllPlayers()) {
    let id;
    try { id = p.dimension.id; } catch { continue; }
    if (id === STATIC_ID) {
      emit(p, "origin:static_dot", 7, 9, -0.5, 5, ["#FFFFFF", "#9A9A9A", "#5A5A5A"]);
      if (Math.random() < 0.3) emit(p, "origin:glitch", 1, 6, 0.5, 3, ["#FFFFFF"]);
    } else if (id === DIM_ID) {
      const L = p.location;
      if (Math.abs(L.x - VOID_ROOM.x) < 400 && Math.abs(L.z - VOID_ROOM.z) < 400) { emit(p, "origin:void_swirl", 2, 6, 0.3, 3, ["#2A1640", "#12091C"]); continue; }
      const dread = (hero(p).dread ?? 0) >= 50;
      emit(p, dread ? "origin:ash" : "origin:mote", 5, 10, -0.5, 5, dread ? ["#3A3644", "#8B0F1A"] : ["#FFD36A", "#BFE8FF", "#FFFFFF"]);
      if (!dread && Math.random() < 0.35) emit(p, "origin:petal", 2, 9, 3, 7, ["#FFB7D5", "#FFE3F0"]);
      if (dread && Math.random() < 0.3) emit(p, "origin:ember", 2, 8, 0, 3, ["#FF5A2A"]);
    }
  }
}
