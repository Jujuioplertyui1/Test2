// ORIGIN v0.23 - lumen.js
// THE LUMEN SIGNET - a ring that turns focus into solid light. (Our own take on the "hard-light ring"
// idea: its own oath, its own color, its own constructs.)
//  Use the ring = build the selected construct. Sneak + use = pick a construct / your light's color.
//  Constructs are SOLID LIGHT now: real translucent models with energy flowing through them.
//   FIST     a giant fist rockets forward and slams the first thing it meets
//   HAMMER   a hammer drops out of the sky where you look and throws everything up
//   BLADE    a greatsword of light sweeps a full arc in front of you
//   AEGIS    a dome of light around you: hits barely land, anything close gets thrown back
//   CHAINS   shackles whoever you look at and drags them in
//   WINGS    wings of light - real flight for 12 seconds
//   WALL / CAGE / BRIDGE   blocks of hard light that fade on their own
//   COLOSSUS (needs a full ring) a titanic fist pounds every enemy around you, one after another
//   v0.23: HAND (grabs, lifts and slams), SPEAR (pierces a whole line), GATLING (a rotary light cannon on your arm),
//          TITAN (a giant of light rises behind you and brings both fists down), feathered WINGS for 20s,
//          real chains of light, eight colours (Emerald is the default for new oaths)
//  Lumen Lantern: a craftable block that refills the ring instantly - and if it's already full, OVERCHARGES it:
//  for a minute constructs cost half and hit 30% harder.
//  Constructs run on LUMEN (0-100). It recharges slowly, fast in bright light.
//  Lumen blocks fade by themselves (they're never left behind, even after a reload).
import { world, system, EntityDamageCause, ItemStack } from "@minecraft/server";
import { hero, RT, markDirty, saveNow, ICON, BAR, bar } from "./data.js";
import { V, at, valid, fx, line, sound, psound, C, now, hexToRgb, msg } from "./util.js";
import { hudMsg } from "./voice.js";
import { runCine, EASE } from "./cine.js";
import { oform, show, ICONS } from "./forms.js";
import { isDark, NO_HIT, dmg } from "./powers.js";
import { startFlight, stopFlight, isFlying } from "./flight.js";
import { tether } from "./models.js";

export const SIGNET = "origin:lumen_signet";
const LUM = hexToRgb("#7CFFE0"), LUM2 = hexToRgb("#E8FFF9");
const BLOCK = "origin:lumen_block";
export const CONSTRUCTS = {
  fist: { name: "Fist", cost: 15, cd: 20, icon: "form_strike" },
  hand: { name: "Hand", cost: 20, cd: 60, icon: "lum_hand" },
  hammer: { name: "Hammer", cost: 25, cd: 80, icon: "form_leap" },
  blade: { name: "Blade", cost: 20, cd: 50, icon: "fin_shatter" },
  spear: { name: "Spear", cost: 18, cd: 40, icon: "lum_spear" },
  gatling: { name: "Gatling", cost: 30, cd: 160, icon: "lum_gatling" },
  aegis: { name: "Aegis", cost: 30, cd: 200, icon: "mod_echo" },
  chains: { name: "Chains", cost: 20, cd: 60, icon: "fin_pull" },
  wings: { name: "Wings", cost: 35, cd: 300, icon: "form_volley" },
  wall: { name: "Wall", cost: 25, cd: 60, icon: "mod_area" },
  cage: { name: "Cage", cost: 30, cd: 120, icon: "mod_area" },
  bridge: { name: "Bridge", cost: 20, cd: 60, icon: "form_dash" },
  colossus: { name: "Colossus", cost: 100, cd: 600, icon: "form_nova" },
  titan: { name: "Titan", cost: 60, cd: 400, icon: "lum_titan" },
};
const HUES = [["Teal", "#7CFFE0", "#E8FFF9"], ["Gold", "#FFD45A", "#FFF8D2"], ["Violet", "#B478FF", "#F0E1FF"], ["Rose", "#FF6EA0", "#FFE1EB"],
  ["Emerald", "#3DFF6E", "#DCFFE5"], ["Sapphire", "#4C8DFF", "#DDE9FF"], ["Crimson", "#FF4848", "#FFDCDC"], ["Pearl", "#E6EAFF", "#FFFFFF"]];
const EMERALD = 4;
const SHAPE = { fist: 0, hammer: 1, blade: 2, aegis: 3, shackle: 4, wings: 5, hand: 6, spear: 7, gatling: 8, titan: 9 };
const KEYS = Object.keys(CONSTRUCTS);
const data = (h) => (h.lumen ??= { charge: 100, mode: "fist", sworn: false, hue: EMERALD });
const over = (p) => (data(hero(p)).overUntil ?? 0) > Date.now();
const D = (p, e, n) => dmg(e, Math.round(n * (over(p) ? 1.3 : 1)), p);   // construct damage (overcharge hits harder)
const hueOf = (p) => data(hero(p)).hue ?? 0;
const colOf = (p) => hexToRgb(HUES[hueOf(p)][1]);
const col2Of = (p) => hexToRgb(HUES[hueOf(p)][2]);

// ------------------------------------------------------------------ solid-light construct entities
const live = [];   // {e, until, step(t), done()}
function construct(p, shape, loc, yaw, big = false) {
  let e;
  try { e = p.dimension.spawnEntity("origin:lumen_construct", loc); } catch { return null; }
  try {
    e.setProperty("origin:shape", SHAPE[shape]);
    e.setProperty("origin:hue", hueOf(p));
    if (big) e.setProperty("origin:big", 1);
    e.teleport(loc, { rotation: { x: 0, y: yaw } });
  } catch { }
  return e;
}
function shatter(e, col) {
  try {
    fx(e.dimension, "origin:burst", at(e.location, 0, 0.8, 0), col, 1);
    for (let i = 0; i < 6; i++) fx(e.dimension, "origin:missile_glow", at(e.location, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2), col, 1);
    e.remove();
  } catch { }
}
function track(e, life, step) { live.push({ e, until: now() + life, step, born: now() }); }
// every tick
export function tickConstructs() {
  const t = now();
  for (let i = live.length - 1; i >= 0; i--) {
    const c = live[i];
    if (!valid(c.e)) { live.splice(i, 1); continue; }
    let keep = true;
    try { keep = c.step ? c.step(t - c.born) !== false : true; } catch { keep = false; }
    if ((t - c.born) % 6 === 0 && valid(c.e)) fx(c.e.dimension, "origin:mote", at(c.e.location, 0, 1, 0), c.col ?? LUM, 1);
    if (!keep || t >= c.until) { if (valid(c.e)) shatter(c.e, c.col ?? LUM); live.splice(i, 1); }
  }
}
const yawOf = (dir) => (Math.atan2(-dir.x, dir.z) * 180) / Math.PI;

// ------------------------------------------------------------------ the block that fades on its own
export function registerLumen(ev) {
  try {
    ev.blockComponentRegistry.registerCustomComponent("origin:lumen", {
      onTick(e) {
        const b = e.block;
        try {
          const life = b.permutation.getState("origin:life") ?? 0;
          if (life >= 15) b.setType("minecraft:air");
          else b.setPermutation(b.permutation.withState("origin:life", life + 1));
        } catch { }
      },
    });
  } catch (err) { console.warn("[ORIGIN] lumen component: " + err); }
}
function place(dim, loc, life = 0) {
  try {
    const b = dim.getBlock({ x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) });
    if (!b || !b.isAir) return false;
    b.setType(BLOCK);
    if (life) b.setPermutation(b.permutation.withState("origin:life", life));
    fx(dim, "origin:missile_glow", at(b.location, 0.5, 0.5, 0.5), LUM, 0.6);
    return true;
  } catch { return false; }
}

// ------------------------------------------------------------------ using the ring
export async function useSignet(p, sneaking) {
  const h = hero(p), L = data(h), r = RT(p);
  if (r.cine || r.caged) return;
  if (!L.sworn) return oath(p);
  if (sneaking) return pickConstruct(p);
  const C0 = CONSTRUCTS[L.mode];
  const t = now();
  if ((r.lumenCd ?? 0) > t) { hudMsg(p, `§3${C0.name} §7re-forming... §c${((r.lumenCd - t) / 20).toFixed(1)}s`, 20); return; }
  const cost = Math.round(C0.cost * (over(p) ? 0.5 : 1));
  if (L.charge < cost) { hudMsg(p, `§3Not enough Lumen §7(${Math.floor(L.charge)}/${cost}) - stand in the light`, 30); psound(p, "random.fizz", 1.4, 0.5); return; }
  if (L.mode === "colossus" && L.charge < 100 && !over(p)) { hudMsg(p, "§3Colossus needs a full ring §7(100 Lumen)", 30); return; }
  // pay first, so a construct that takes a while (Hand, Titan, Colossus) can't be cast again while it runs
  L.charge -= cost;
  r.lumenCd = t + C0.cd;
  markDirty(p);
  let ok = false;
  try { ok = await BUILD[L.mode](p); } catch (e) { console.warn("[ORIGIN] lumen: " + e); ok = false; }
  if (ok === false) { L.charge = Math.min(100, L.charge + cost); r.lumenCd = t; markDirty(p); }
}
function lookTarget(p, range) {
  try { return p.getEntitiesFromViewDirection({ maxDistance: range }).map((x) => x.entity).find((e) => e.id !== p.id && !NO_HIT.includes(e.typeId) && valid(e)) ?? null; } catch { return null; }
}
function lookPoint(p, range) {
  try {
    const hb = p.getBlockFromViewDirection({ maxDistance: range });
    if (hb) return V.add(hb.block.location, hb.faceLocation);
  } catch { }
  return V.add(p.getHeadLocation(), V.mul(p.getViewDirection(), range));
}
// a construct is drawn as points of light: a box outline helper
function box(dim, c, sx, sy, sz, col = LUM, step = 0.35) {
  const pts = [];
  for (const [a, b] of [[[-1, -1, -1], [1, -1, -1]], [[-1, 1, -1], [1, 1, -1]], [[-1, -1, 1], [1, -1, 1]], [[-1, 1, 1], [1, 1, 1]],
    [[-1, -1, -1], [-1, 1, -1]], [[1, -1, -1], [1, 1, -1]], [[-1, -1, 1], [-1, 1, 1]], [[1, -1, 1], [1, 1, 1]],
    [[-1, -1, -1], [-1, -1, 1]], [[1, -1, -1], [1, -1, 1]], [[-1, 1, -1], [-1, 1, 1]], [[1, 1, -1], [1, 1, 1]]]) {
    const A = at(c, a[0] * sx, a[1] * sy, a[2] * sz), B = at(c, b[0] * sx, b[1] * sy, b[2] * sz);
    line(dim, "origin:dot", A, B, col, step, 1);
  }
}
const BUILD = {
  fist(p) {
    const dim = p.dimension, dir = p.getViewDirection(), col = colOf(p);
    let pos = at(p.getHeadLocation(), dir.x * 1.6, -1.1, dir.z * 1.6);
    const e = construct(p, "fist", pos, yawOf(dir));
    if (!e) return false;
    sound(dim, "beacon.activate", pos, 1, 2);
    const entry = { e, until: now() + 18, born: now(), col };
    entry.step = (age) => {
      pos = V.add(pos, V.mul(dir, 1.1));
      try { e.teleport(pos, { rotation: { x: 0, y: yawOf(dir) } }); } catch { }
      fx(dim, "origin:missile_glow", at(pos, 0, 0.6, 0), col, 1);
      if (age % 2 === 0) fx(dim, "origin:missile_smoke", at(pos, 0, 0.6, 0), col2Of(p), 0.6);
      let hit = null;
      try { hit = dim.getEntities({ location: at(pos, 0, 0.6, 0), maxDistance: 1.8, excludeTypes: [...NO_HIT, "origin:lumen_construct"] }).find((x) => x.id !== p.id); } catch { }
      if (hit) {
        D(p, hit, 9);
        try { hit.applyKnockback({ x: dir.x * 2.6, z: dir.z * 2.6 }, 0.55); } catch { }
        fx(dim, "origin:shockwave", pos, col, 1, { radius: 2.5 });
        fx(dim, "origin:boom_fire", pos, col, 1);
        sound(dim, "random.anvil_land", pos, 0.9, 1.5);
        return false;
      }
      return true;
    };
    live.push(entry);
    return true;
  },
  hammer(p) {
    const dim = p.dimension, col = colOf(p);
    const c = lookPoint(p, 12);
    const yaw = yawOf(p.getViewDirection());
    const top = at(c, 0, 7, 0);
    const e = construct(p, "hammer", top, yaw);
    if (!e) return false;
    sound(dim, "beacon.power", c, 1, 1.4);
    live.push({ e, until: now() + 16, born: now(), col, step: (age) => {
      if (age <= 7) {
        const pos = V.lerp(top, at(c, 0, -2.2, 0), (age / 7) ** 2);
        try { e.teleport(pos, { rotation: { x: 0, y: yaw } }); } catch { }
        if (age < 7) return true;
        fx(dim, "origin:shockwave", at(c, 0, 0.05, 0), col, 1, { radius: 4 });
        fx(dim, "origin:flash", at(c, 0, 0.6, 0), col, 1, { size: 3 }); fx(dim, "origin:shards", c, col, 1); fx(dim, "origin:dust", c, C.white, 1);
        fx(dim, "origin:boom_fire", c, col, 1); fx(dim, "origin:debris", c, C.dust, 1);
        sound(dim, "random.explode", c, 1.3, 1.3);
        for (const pl of dim.getPlayers({ location: c, maxDistance: 16 })) { try { pl.runCommand("camerashake add @s 0.5 0.3 positional"); } catch { } }
        try {
          for (const x of dim.getEntities({ location: c, maxDistance: 3.6, excludeTypes: [...NO_HIT, "origin:lumen_construct"] })) {
            if (x.id === p.id) continue;
            D(p, x, 11);
            try { x.applyKnockback({ x: 0, z: 0 }, 1.1); } catch { }
          }
        } catch { }
      }
      return true;
    } });
    return true;
  },
  blade(p) {
    const dim = p.dimension, col = colOf(p), f = V.flat(p.getViewDirection());
    const e = construct(p, "blade", { ...p.location }, yawOf(f));
    if (!e) return false;
    sound(dim, "item.trident.riptide_1", p.location, 1, 1.4);
    live.push({ e, until: now() + 12, born: now(), col, step: (age) => {
      try { e.teleport(p.location, { rotation: { x: 0, y: yawOf(f) } }); } catch { }
      if (age === 4) {
        for (let k = -6; k <= 6; k++) {
          const a = (k / 6) * 1.9;
          const d = { x: f.x * Math.cos(a) - f.z * Math.sin(a), z: f.x * Math.sin(a) + f.z * Math.cos(a) };
          fx(dim, "origin:missile_glow", at(p.location, d.x * 3.6, 1.1, d.z * 3.6), k % 2 ? col : col2Of(p), 1);
        }
        try {
          for (const x of dim.getEntities({ location: p.location, maxDistance: 4.6, excludeTypes: [...NO_HIT, "origin:lumen_construct"] })) {
            if (x.id === p.id) continue;
            const v = V.flat(V.sub(x.location, p.location));
            if (V.dot(v, f) < -0.2) continue;
            D(p, x, 10);
            try { x.applyKnockback({ x: v.x * 1.4, z: v.z * 1.4 }, 0.35); } catch { }
            import("./dismember.js").then((m) => m.tryCut(p, x, 10, "power")).catch(() => { });
          }
        } catch { }
      }
      return true;
    } });
    return true;
  },
  aegis(p) {
    const dim = p.dimension, col = colOf(p);
    const e = construct(p, "aegis", { ...p.location }, 0);
    if (!e) return false;
    try { p.addEffect("resistance", 110, { amplifier: 3, showParticles: false }); } catch { }
    sound(dim, "beacon.activate", p.location, 1, 1.2);
    live.push({ e, until: now() + 110, born: now(), col, step: (age) => {
      try { e.teleport(p.location); } catch { }
      if (age % 10 === 0) {
        try {
          for (const x of dim.getEntities({ location: p.location, maxDistance: 2.6, excludeTypes: [...NO_HIT, "origin:lumen_construct"] })) {
            if (x.id === p.id) continue;
            const v = V.flat(V.sub(x.location, p.location));
            try { x.applyKnockback({ x: v.x * 1.6, z: v.z * 1.6 }, 0.3); } catch { }
            D(p, x, 2);
            fx(dim, "origin:spark", at(x.location, 0, 1, 0), col, 1);
          }
        } catch { }
      }
      return valid(p);
    } });
    return true;
  },
  chains(p) {
    const tg = lookTarget(p, 18);
    if (!tg) { hudMsg(p, "§7Look at someone to bind them.", 20); return false; }
    const dim = p.dimension, col = colOf(p);
    const e = construct(p, "shackle", { ...tg.location }, 0);
    if (!e) return false;
    sound(dim, "random.chestclosed", tg.location, 1, 1.6); sound(dim, "origin.sfx.chains", tg.location, 1.4, 0.8);
    try { tg.addEffect("slowness", 70, { amplifier: 5 }); } catch { }
    const hand = () => { const f = V.flat(p.getViewDirection()), r = { x: -f.z, z: f.x }; return at(p.location, -r.x * 0.4 + f.x * 0.5, 1.15, -r.z * 0.4 + f.z * 0.5); };
    const links = [tether(dim, hand, tg, "lumen", { life: 60, grow: 4, shrink: 5 }), tether(dim, () => at(p.location, 0, 0.9, 0), () => at(tg.location, 0, 0.4, 0), "lumen", { life: 60, grow: 6, shrink: 5 })];
    live.push({ e, until: now() + 60, born: now(), col, step: (age) => {
      if (!valid(tg) || !valid(p)) { for (const l of links) l?.cut(); return false; }
      try { e.teleport(tg.location); } catch { }
      if (age % 4 === 0) fx(dim, "origin:missile_glow", V.lerp(hand(), at(tg.location, 0, 1, 0), Math.random()), age % 8 ? col : col2Of(p), 1);
      if (age % 8 === 0) {
        const d = V.flat(V.sub(p.location, tg.location)), dist = V.hdist(p.location, tg.location);
        if (dist > 2.2) { try { tg.applyKnockback({ x: d.x * Math.min(1.5, dist * 0.16), z: d.z * Math.min(1.5, dist * 0.16) }, 0.15); } catch { } }
        D(p, tg, 2);
        sound(dim, "origin.sfx.chains", tg.location, 1.6, 0.4);
      }
      return true;
    } });
    return true;
  },
  wings(p) {
    if (isFlying(p)) { stopFlight(p, "land"); return false; }
    const dim = p.dimension, col = colOf(p);
    const e = construct(p, "wings", { ...p.location }, p.getRotation().y);
    if (!e) return false;
    const ok = startFlight(p, { kind: "lumen", maxTicks: 400, col: { red: col.red, green: col.green, blue: col.blue },
      onEnd: () => { try { shatter(e, col); } catch { } } });
    if (!ok) { try { e.remove(); } catch { } return false; }
    live.push({ e, until: now() + 420, born: now(), col, step: () => {
      if (!isFlying(p)) return false;
      try { e.teleport(p.location, { rotation: { x: 0, y: p.getRotation().y } }); } catch { }
      return true;
    } });
    hudMsg(p, "§3§lWINGS §r§7- 20s · forward to fly, sprint to boost", 50);
    return true;
  },
  wall(p) {
    const dim = p.dimension, f = V.flat(p.getViewDirection()), r = { x: -f.z, z: f.x };
    const c = at(p.location, f.x * 3, 0, f.z * 3);
    let n = 0;
    for (let i = -2; i <= 2; i++) for (let y = 0; y < 3; y++) if (place(dim, at(c, r.x * i, y, r.z * i), 0)) n++;
    if (!n) { hudMsg(p, "§7No room for a wall there.", 20); return false; }
    sound(dim, "place.amethyst_block", c, 1, 1.2);
    return true;
  },
  cage(p) {
    const tg = lookTarget(p, 16);
    if (!tg) { hudMsg(p, "§7Look at someone to cage them.", 20); return false; }
    const dim = p.dimension, b = tg.location;
    const x0 = Math.floor(b.x), y0 = Math.floor(b.y), z0 = Math.floor(b.z);
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 2; dy++) {
      const shellB = Math.abs(dx) === 1 || Math.abs(dz) === 1 || dy === -1 || dy === 2;
      if (shellB && place(dim, { x: x0 + dx, y: y0 + dy, z: z0 + dz }, 2)) n++;
    }
    try { tg.teleport({ x: x0 + 0.5, y: y0, z: z0 + 0.5 }); } catch { }
    sound(dim, "place.amethyst_block", b, 1, 0.8);
    hudMsg(p, `§3Caged. §7(${n} panels)`, 30);
    return true;
  },
  bridge(p) {
    const dim = p.dimension, f = V.flat(p.getViewDirection());
    const y = Math.floor(p.location.y) - 1;
    let n = 0;
    for (let i = 1; i <= 14; i++) {
      const c = { x: p.location.x + f.x * i, y, z: p.location.z + f.z * i };
      if (place(dim, c, 0)) n++;
      if (place(dim, { x: c.x - f.z * 0.9, y, z: c.z + f.x * 0.9 }, 0)) n++;
    }
    if (!n) { hudMsg(p, "§7There's already ground there.", 20); return false; }
    sound(dim, "place.amethyst_block", p.location, 1, 1.4);
    return true;
  },
  // HAND: a giant hand of light closes around them, lifts them high, and slams them down
  async hand(p) {
    const tg = lookTarget(p, 16);
    if (!tg) { hudMsg(p, "§7Look at someone to grab them.", 20); return false; }
    const dim = p.dimension, col = colOf(p), f = V.flat(V.sub(tg.location, p.location)), yaw = yawOf(f);
    let at0 = at(tg.location, -f.x * 0.9, -0.2, -f.z * 0.9);
    const e = construct(p, "hand", at0, yaw, true);
    if (!e) return false;
    sound(dim, "beacon.activate", tg.location, 1, 1.3);
    live.push({ e, until: now() + 40, born: now(), col, step: () => valid(tg) });
    await system.waitTicks(10);   // the fingers close
    if (!valid(tg) || !valid(e)) return true;
    sound(dim, "random.chestclosed", tg.location, 0.7, 1.2);
    const base = { ...tg.location };
    for (let k = 1; k <= 10; k++) {   // up
      if (!valid(tg) || !valid(e)) return true;
      const lift = k * 0.42;
      try { tg.teleport(at(base, 0, lift, 0)); e.teleport(at(at0, 0, lift, 0), { rotation: { x: 0, y: yaw } }); } catch { }
      if (k % 3 === 0) fx(dim, "origin:missile_glow", at(base, 0, lift + 1, 0), col, 1);
      await system.waitTicks(1);
    }
    for (let k = 1; k <= 3; k++) {   // and down, hard
      if (!valid(tg) || !valid(e)) return true;
      const lift = 4.2 * (1 - k / 3);
      try { tg.teleport(at(base, 0, lift, 0)); e.teleport(at(at0, 0, lift, 0), { rotation: { x: 0, y: yaw } }); } catch { }
      await system.waitTicks(1);
    }
    if (!valid(tg)) return true;
    D(p, tg, 14);
    try { tg.applyKnockback({ x: f.x * 0.4, z: f.z * 0.4 }, 0.2); tg.addEffect("slowness", 40, { amplifier: 3 }); } catch { }
    fx(dim, "origin:shockwave", at(base, 0, 0.05, 0), col, 1, { radius: 3.5 }); fx(dim, "origin:flash", at(base, 0, 0.5, 0), col, 1, { size: 2.5 }); fx(dim, "origin:debris", base, C.dust, 1);
    sound(dim, "random.explode", base, 1.4, 0.9); sound(dim, "random.anvil_land", base, 0.8, 1.2);
    for (const pl of dim.getPlayers({ location: base, maxDistance: 14 })) { try { pl.runCommand("camerashake add @s 0.45 0.3 positional"); } catch { } }
    if (valid(e)) shatter(e, col);
    return true;
  },
  // SPEAR: thrown point first, it runs through everything in a line and bursts where it lands
  spear(p) {
    const dim = p.dimension, col = colOf(p), dir = V.norm(p.getViewDirection());
    let pos = at(p.getHeadLocation(), dir.x * 1.2, -0.45, dir.z * 1.2);
    const e = construct(p, "spear", pos, yawOf(dir));
    if (!e) return false;
    sound(dim, "item.trident.throw", p.location, 1, 1.2); sound(dim, "beacon.power", pos, 1, 1.8);
    const seen = new Set();
    live.push({ e, until: now() + 22, born: now(), col, step: (age) => {
      for (let s = 0; s < 3; s++) {
        pos = V.add(pos, V.mul(dir, 0.75));
        let blk; try { blk = dim.getBlock(pos); } catch { }
        const hit = (() => { try { return dim.getEntities({ location: pos, maxDistance: 1.6, excludeTypes: [...NO_HIT, "origin:lumen_construct"] }).filter((x) => x.id !== p.id && !seen.has(x.id)); } catch { return []; } })();
        for (const x of hit) {
          seen.add(x.id);
          D(p, x, 9);
          try { x.applyKnockback({ x: dir.x * 0.9, z: dir.z * 0.9 }, 0.25); } catch { }
          fx(dim, "origin:flash", at(x.location, 0, 1, 0), col, 1, { size: 1.4 }); sound(dim, "random.anvil_land", x.location, 1.6, 0.5);
        }
        if (blk && !blk.isAir && !blk.isLiquid) {
          fx(dim, "origin:shockwave", pos, col, 1, { radius: 3 }); fx(dim, "origin:boom_fire", pos, col, 1); fx(dim, "origin:shards", pos, col, 1);
          sound(dim, "random.explode", pos, 1.5, 0.8);
          try { for (const x of dim.getEntities({ location: pos, maxDistance: 3, excludeTypes: [...NO_HIT, "origin:lumen_construct"] })) if (x.id !== p.id) { D(p, x, 5); try { x.applyKnockback({ x: 0, z: 0 }, 0.5); } catch { } } } catch { }
          return false;
        }
      }
      try { e.teleport(pos, { rotation: { x: 0, y: yawOf(dir) } }); } catch { }
      if (age % 2 === 0) fx(dim, "origin:missile_glow", pos, col2Of(p), 0.8);
      return true;
    } });
    return true;
  },
  // GATLING: a rotary cannon of light forms on your arm and hoses bolts where you look for three seconds
  gatling(p) {
    const dim = p.dimension, col = colOf(p);
    const mount = () => { const d = p.getViewDirection(), f = V.flat(d), r = { x: -f.z, z: f.x }; return at(p.location, -r.x * 0.55 + f.x * 0.6, 1.0, -r.z * 0.55 + f.z * 0.6); };
    const e = construct(p, "gatling", mount(), yawOf(p.getViewDirection()));
    if (!e) return false;
    sound(dim, "beacon.activate", p.location, 1, 1.9);
    live.push({ e, until: now() + 64, born: now(), col, step: (age) => {
      if (!valid(p)) return false;
      const d = V.norm(p.getViewDirection()), m0 = mount();
      try { e.teleport(m0, { rotation: { x: 0, y: yawOf(d) } }); } catch { }
      if (age < 6 || age % 2) return true;
      const muzzle = V.add(at(m0, 0, 0.5, 0), V.mul(d, 1.4));
      const spread = () => (Math.random() - 0.5) * 0.06;
      const dir = V.norm({ x: d.x + spread(), y: d.y + spread(), z: d.z + spread() });
      let q = muzzle, hitE = null;
      for (let k = 0; k < 28 && !hitE; k++) {
        q = V.add(q, dir);
        let blk; try { blk = dim.getBlock(q); } catch { }
        if (blk && !blk.isAir && !blk.isLiquid) break;
        try { hitE = dim.getEntities({ location: q, maxDistance: 1.1, excludeTypes: [...NO_HIT, "origin:lumen_construct"] }).find((x) => x.id !== p.id) ?? null; } catch { }
      }
      line(dim, "origin:missile_glow", muzzle, q, col, 1.6, 0.8);
      fx(dim, "origin:flash", muzzle, col2Of(p), 0.8, { size: 0.5 });
      if (age % 4 === 0) sound(dim, "random.click", muzzle, 1.8, 0.5);
      if (hitE) { D(p, hitE, 2); try { hitE.applyKnockback({ x: dir.x * 0.15, z: dir.z * 0.15 }, 0.05); } catch { } fx(dim, "origin:spark", q, col, 1); }
      else fx(dim, "origin:spark", q, col, 0.6);
      return true;
    } });
    hudMsg(p, "§3§lGATLING §r§7- aim it", 30);
    return true;
  },
  // TITAN: a giant of light rises behind you and brings both fists down on the ground in front of you
  async titan(p) {
    const dim = p.dimension, col = colOf(p), f = V.flat(p.getViewDirection()), yaw = yawOf(f);
    const spot = at(p.location, -f.x * 2.2, 0, -f.z * 2.2);
    const e = construct(p, "titan", spot, yaw, false);
    if (!e) return false;
    try { p.onScreenDisplay.setTitle("§3§lTITAN", { fadeInDuration: 0, stayDuration: 26, fadeOutDuration: 10, subtitle: " " }); RT(p).titleUntil = now() + 36; } catch { }
    sound(dim, "mob.warden.sonic_charge", p.location, 1.3, 0.7); sound(dim, "beacon.activate", p.location, 0.6, 1);
    fx(dim, "origin:pillar", spot, col, 1);
    live.push({ e, until: now() + 46, born: now(), col, step: () => true });
    await system.waitTicks(23);
    const c = at(p.location, f.x * 4.5, 0, f.z * 4.5);
    fx(dim, "origin:shockwave", at(c, 0, 0.05, 0), col, 1, { radius: 6 }); fx(dim, "origin:shockwave", at(c, 0, 0.6, 0), col2Of(p), 1, { radius: 3.5 });
    fx(dim, "origin:boom_fire", c, col, 1); fx(dim, "origin:debris", c, C.dust, 1); fx(dim, "origin:dust", c, C.white, 1);
    sound(dim, "random.explode", c, 0.8, 1); sound(dim, "random.anvil_land", c, 0.5, 1);
    for (const pl of dim.getPlayers({ location: c, maxDistance: 24 })) { try { pl.runCommand("camerashake add @s 0.7 0.5 positional"); } catch { } }
    try {
      for (const x of dim.getEntities({ location: c, maxDistance: 5.5, excludeTypes: [...NO_HIT, "origin:lumen_construct"] })) {
        if (x.id === p.id) continue;
        const v = V.flat(V.sub(x.location, c));
        D(p, x, 16);
        try { x.applyKnockback({ x: v.x * 1.2, z: v.z * 1.2 }, 0.9); } catch { }
      }
    } catch { }
    return true;
  },
  async colossus(p) {
    const dim = p.dimension, col = colOf(p);
    let list = [];
    try { list = dim.getEntities({ location: p.location, maxDistance: 14, excludeTypes: [...NO_HIT, "origin:lumen_construct"], excludeFamilies: ["player", "inanimate"] }).filter((x) => x.getComponent("minecraft:health")).slice(0, 6); } catch { }
    if (!list.length) { hudMsg(p, "§7Nothing here deserves the Colossus.", 30); return false; }
    try { p.onScreenDisplay.setTitle("§3§lCOLOSSUS", { fadeInDuration: 0, stayDuration: 30, fadeOutDuration: 10, subtitle: " " }); RT(p).titleUntil = now() + 40; } catch { }
    sound(dim, "mob.warden.sonic_charge", p.location, 1.5, 0.6);
    fx(dim, "origin:pillar", p.location, col, 1);
    await system.waitTicks(10);
    for (const tg of list) {
      if (!valid(tg)) continue;
      const c = { ...tg.location };
      const top = at(c, 0, 14, 0);
      const e = construct(p, "fist", top, Math.random() * 360, true);
      for (let k = 0; k <= 6 && e; k++) { try { e.teleport(V.lerp(top, at(c, 0, -1.5, 0), (k / 6) ** 2), { rotation: { x: 0, y: e.getRotation().y } }); } catch { } await system.waitTicks(1); }
      fx(dim, "origin:shockwave", at(c, 0, 0.05, 0), col, 1, { radius: 5 });
      fx(dim, "origin:boom_fire", c, col, 1); fx(dim, "origin:boom_smoke", c, C.grey, 1);
      sound(dim, "random.explode", c, 1.6, 0.8);
      for (const pl of dim.getPlayers({ location: c, maxDistance: 20 })) { try { pl.runCommand("camerashake add @s 0.6 0.35 positional"); } catch { } }
      try { for (const x of dim.getEntities({ location: c, maxDistance: 3.5, excludeTypes: [...NO_HIT, "origin:lumen_construct"] })) if (x.id !== p.id) { D(p, x, 12); try { x.applyKnockback({ x: 0, z: 0 }, 0.9); } catch { } } } catch { }
      if (e) shatter(e, col);
      await system.waitTicks(4);
    }
    return true;
  },
};

async function pickConstruct(p) {
  const L = data(hero(p));
  const H = HUES[L.hue ?? 0];
  const ov = over(p) ? ` §b§lOVERCHARGED §r§7${Math.ceil(((L.overUntil ?? 0) - Date.now()) / 1000)}s` : "";
  const f = oform("menu", "Lumen Signet", `§3Lumen §f${Math.floor(L.charge)}%${ov}§7 - recharges fast in bright light, instantly at a Lumen Lantern (at full: overcharge).\n§7Your light: §f${H[0]}§7. Pick what the ring builds when you use it.`);
  for (const k of KEYS) {
    const C0 = CONSTRUCTS[k];
    const locked = k === "colossus" && L.charge < 100 && !over(p);
    f.button(`${L.mode === k ? "» " : ""}${locked ? "§8" : "§3"}${C0.name}\n§8${Math.round(C0.cost * (over(p) ? 0.5 : 1))} Lumen · ${(C0.cd / 20).toFixed(0)}s`, ICONS + C0.icon);
  }
  f.button(`Your light: ${H[0]}\n§8tap to change color`, ICONS + "act_rgb");
  f.button("Close", ICONS + "act_back");
  const res = await show(p, f);
  if (!res || res.canceled) return;
  if (res.selection === KEYS.length) { L.hue = ((L.hue ?? 0) + 1) % HUES.length; markDirty(p); psound(p, "random.click", 1.4, 0.6); return pickConstruct(p); }
  if (res.selection > KEYS.length) return;
  L.mode = KEYS[res.selection];
  markDirty(p);
  psound(p, "random.click", 1.4, 0.6);
}

// the first time you put it on: the ring makes you say it
async function oath(p) {
  const h = hero(p), L = data(h);
  await runCine(p, async (c) => {
    const base = { ...p.location }, f = V.flat(p.getViewDirection());
    c.cam(at(base, f.x * 2.2 - f.z * 0.8, 1.5, f.z * 2.2 + f.x * 0.8), at(base, 0, 1.3, 0));
    c.say("§3The ring is warm. It's listening.", 50);
    for (let i = 0; i < 10; i++) { fx(p.dimension, "origin:missile_glow", at(base, Math.cos(i) * 1.2, 0.3 + i * 0.18, Math.sin(i) * 1.2), LUM, 1); await c.wait(4); }
    c.say("§f\"What I can picture, I can hold.\"", 50);
    await c.wait(40);
    c.say("§f\"What I hold, I keep safe.\"", 50);
    await c.wait(40);
    sound(p.dimension, "beacon.activate", base, 1, 1.6);
    fx(p.dimension, "origin:shockwave", at(base, 0, 0.05, 0), LUM, 1, { radius: 5 });
    fx(p.dimension, "origin:burst", at(base, 0, 1.2, 0), LUM2, 1);
    c.fade(0, 0.1, 0.5, { red: 0.6, green: 1, blue: 0.9 });
    await c.wait(16);
  });
  L.sworn = true;
  L.hue ??= EMERALD;
  saveNow(p);
  try { p.onScreenDisplay.setTitle("§3§lLUMEN SIGNET", { fadeInDuration: 4, stayDuration: 50, fadeOutDuration: 15, subtitle: "§7use = build · sneak + use = choose a construct" }); } catch { }
  msg(p, "§3§lTHE SIGNET ANSWERS. §r§7Use it to build: Fist, Hand, Hammer, Blade, Spear, Gatling, Chains, Wings, Titan and more (sneak + use to choose, and to pick your colour). It runs on Lumen - bright light refills it fast.");
}

// every 20 ticks: recharge (fast in the light)
export function tickLumen() {
  for (const p of world.getAllPlayers()) {
    const h = hero(p);
    if (!h.lumen) continue;
    const L = h.lumen;
    if (L.charge >= 100) continue;
    let bright = false;
    try { bright = !isDark(p.dimension, at(p.location, 0, 1, 0)); } catch { }
    L.charge = Math.min(100, L.charge + (bright ? 4 : 1));
    markDirty(p);
  }
}
export function lumenLine(p) {
  const h = hero(p);
  if (!h.lumen?.sworn) return null;
  let holding = false;
  try { holding = p.getComponent("minecraft:inventory").container.getItem(p.selectedSlotIndex)?.typeId === SIGNET; } catch { }
  if (!holding && h.lumen.charge >= 100) return null;
  return `§3◇ LUMEN §f${bar(BAR.energy, h.lumen.charge / 100, 6)} §3${Math.floor(h.lumen.charge)}% §7${CONSTRUCTS[h.lumen.mode]?.name ?? ""}`;
}

// the Lumen Lantern: a full refill, with a little ceremony
export function useLantern(p, loc) {
  const h = hero(p), L = data(h);
  if (!L.sworn) { hudMsg(p, "§7The lantern glows. Something is missing. §8(Bond with a Lumen Signet first.)"); return; }
  const c = at(loc, 0.5, 0.6, 0.5), col = colOf(p);
  if (L.charge >= 100 && !over(p) && !RT(p).cine) return overcharge(p, loc);
  line(p.dimension, "origin:missile_glow", c, at(p.location, 0, 1.2, 0), col, 0.4, 1);
  fx(p.dimension, "origin:shockwave", at(loc, 0.5, 0.05, 0.5), col, 1, { radius: 3 });
  sound(p.dimension, "beacon.activate", c, 1, 1.6);
  L.charge = 100;
  markDirty(p);
  hudMsg(p, "§3§lLUMEN FULL §r§7- \"What I hold, I keep safe.\" §8(use the lantern again at full to overcharge)", 60);
}
// a full ring held up to the lantern: you say the oath, and the light pours in past full
async function overcharge(p, loc) {
  const L = data(hero(p)), col = colOf(p), col2 = col2Of(p), dim = p.dimension, c = at(loc, 0.5, 0.6, 0.5);
  await runCine(p, async (cn) => {
    const base = { ...p.location }, f = V.flat(V.sub(c, base)), sd = { x: -f.z, z: f.x };
    cn.cam(at(base, -f.x * 2.4 + sd.x * 1.6, 1.4, -f.z * 2.4 + sd.z * 1.6), at(V.lerp(base, c, 0.5), 0, 1.1, 0));
    try { p.playAnimation("animation.origin.mjolnir.raise", { controller: "origin_mj", blendOutTime: 0.3 }); } catch { }
    cn.say("§f\"What I can picture, I can hold.\"", 40);
    for (let k = 0; k < 12; k++) { line(dim, "origin:missile_glow", c, at(p.location, 0, 2.6, 0), k % 2 ? col : col2, 0.35, 1); await cn.wait(3); }
    cn.say("§f\"What I hold, I keep safe.\"", 40);
    cn.cam(at(base, f.x * 1.6 + sd.x * 2.2, 0.7, f.z * 1.6 + sd.z * 2.2), at(base, 0, 2.2, 0), 0.8, EASE.InOutSine);
    for (let k = 0; k < 12; k++) { fx(dim, "origin:missile_glow", at(base, Math.cos(k) * 1.4, 0.3 + k * 0.2, Math.sin(k) * 1.4), col, 1); await cn.wait(3); }
    cn.say("§f\"And no dark runs deep enough to hide from it.\"", 46);
    await cn.wait(30);
    sound(dim, "beacon.activate", base, 0.7, 1); sound(dim, "origin.sfx.powerup", base, 1.2, 1);
    fx(dim, "origin:pillar", base, col, 1); fx(dim, "origin:shockwave", at(base, 0, 0.05, 0), col, 1, { radius: 7 }); fx(dim, "origin:burst", at(base, 0, 1.2, 0), col2, 1);
    cn.fade(0, 0.15, 0.6, col2); cn.shake(0.4, 0.5);
    await cn.wait(18);
  });
  L.charge = 100;
  L.overUntil = Date.now() + 60000;
  markDirty(p);
  try { p.onScreenDisplay.setTitle("§3§lOVERCHARGED", { fadeInDuration: 3, stayDuration: 40, fadeOutDuration: 12, subtitle: "§7one minute: constructs cost half and hit harder" }); RT(p).titleUntil = now() + 58; } catch { }
}
export function tickRingGlow() {
  for (const p of world.getAllPlayers()) {
    const h = hero(p);
    if (!h.lumen?.sworn) continue;
    let held = false;
    try { held = p.getComponent("minecraft:inventory").container.getItem(p.selectedSlotIndex)?.typeId === SIGNET; } catch { }
    if (!held) continue;
    const f = V.flat(p.getViewDirection()), r = { x: -f.z, z: f.x };
    fx(p.dimension, "origin:missile_glow", at(p.location, -r.x * 0.45 + f.x * 0.4, 1.05, -r.z * 0.45 + f.z * 0.4), colOf(p), over(p) ? 1 : 0.5);
    if (over(p)) fx(p.dimension, "origin:aura", p.location, colOf(p), 0.6);
  }
}
