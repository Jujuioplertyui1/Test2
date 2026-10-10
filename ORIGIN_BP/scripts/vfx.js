// ORIGIN v0.02 - vfx.js
// Every effect is a combination of the custom particles in RP/particles (colors via variable.color).
import { V, at, fx, line, sound, C, hexToRgb } from "./util.js";
import { flashBeam, tinted } from "./beams.js";

export const ELEM = {
  kinetic: { rgb: hexToRgb("#F4E7C1"), hot: hexToRgb("#FFFFFF") },
  flame: { rgb: hexToRgb("#FF7A1F"), hot: hexToRgb("#FFD36A") },
  void: { rgb: hexToRgb("#8A3FD1"), hot: hexToRgb("#E04AFF") },
  frost: { rgb: hexToRgb("#8FE3FF"), hot: hexToRgb("#FFFFFF") },
  storm: { rgb: hexToRgb("#FFF36B"), hot: hexToRgb("#FFFFFF") },
};

// Big flash + element signature at the point of impact
export function hitFx(dim, loc, element = "kinetic", heavy = false) {
  const E = ELEM[element] ?? ELEM.kinetic;
  fx(dim, "origin:impact", loc, E.hot, 1, { size: heavy ? 1.6 : 1.0 });
  if (element === "flame") {
    fx(dim, "origin:ember", loc, E.rgb, 1);
    fx(dim, "origin:spark", loc, E.hot, 1);
    if (heavy) fx(dim, "origin:burst", loc, E.rgb, 1);
  } else if (element === "frost") {
    fx(dim, "origin:spark", loc, E.hot, 1);
    fx(dim, "origin:mote", loc, E.rgb, 1);
  } else if (element === "storm") {
    fx(dim, "origin:arc", loc, E.rgb, 1);
    fx(dim, "origin:spark", loc, E.hot, 1);
  } else if (element === "void") {
    fx(dim, "origin:void_swirl", loc, E.rgb, 1);
    fx(dim, "origin:arc", loc, E.hot, 1);
    if (heavy) fx(dim, "origin:wisp", loc, C.blood, 1);
  } else {
    fx(dim, "origin:spark", loc, C.white, 1);
    fx(dim, "origin:debris", at(loc, 0, -0.5, 0), C.dust, 1);
    if (heavy) fx(dim, "origin:shockwave", at(loc, 0, -0.9, 0), E.rgb, 0.9, { radius: 1.5 });
  }
}

// Strike: a crescent swipe in front of you
export function slashFx(dim, head, f, rt, element) {
  const E = ELEM[element] ?? ELEM.kinetic;
  for (let a = -3; a <= 3; a++) {
    const s = a * 0.33;
    const pt = at(head, (f.x + rt.x * s) * 2.1, -0.35 + Math.abs(a) * 0.06, (f.z + rt.z * s) * 2.1);
    fx(dim, "origin:trail", pt, a % 2 ? E.hot : E.rgb, 1);
  }
  fx(dim, "origin:slash", at(head, f.x * 1.8, -0.3, f.z * 1.8), E.rgb, 1);
  if (element === "flame") fx(dim, "origin:ember", at(head, f.x * 1.8, -0.4, f.z * 1.8), E.rgb, 0.8);
  if (element === "void") fx(dim, "origin:arc", at(head, f.x * 1.8, -0.4, f.z * 1.8), E.hot, 0.9);
}

// Dash: a streak of afterimages along the path
export function dashFx(dim, a, b, element) {
  const E = ELEM[element] ?? ELEM.kinetic;
  line(dim, "origin:trail", at(a, 0, 1, 0), at(b, 0, 1, 0), E.rgb, 0.45, 1);
  line(dim, "origin:dot", at(a, 0, 0.3, 0), at(b, 0, 0.3, 0), E.hot, 0.7, 0.8);
  if (element === "flame") line(dim, "origin:ember", at(a, 0, 0.2, 0), at(b, 0, 0.2, 0), E.rgb, 1.5, 0.8);
  if (element === "void") line(dim, "origin:void_swirl", at(a, 0, 1, 0), at(b, 0, 1, 0), E.rgb, 2, 0.8);
  if (element === "kinetic") fx(dim, "origin:shockwave", at(a, 0, 0.05, 0), E.rgb, 0.8, { radius: 1.2 });
}

// Blast: bright core with sparks along it
export function beamFx(dim, a, b, element) {
  const E = ELEM[element] ?? ELEM.kinetic;
  flashBeam(dim, a, b, { ...tinted("laser", E.rgb), core: E.hot, width: 0.22, coreW: 0.065, flare: 0.45, impact: 1.2 }, { life: 0.45 });
  if (element === "void") line(dim, "origin:arc", a, b, E.hot, 2.5, 1);
  if (element === "flame") line(dim, "origin:ember", a, b, E.rgb, 2, 0.8);
  fx(dim, "origin:impact", b, E.hot, 1, { size: 1.3 });
  fx(dim, "origin:spark", b, E.rgb, 1);
}

// Ground slam / area: decal ring, debris, dust
export function slamFx(dim, c, radius, rgb = C.crimson) {
  fx(dim, "origin:shockwave", at(c, 0, 0.06, 0), rgb, 1, { radius });
  fx(dim, "origin:debris", at(c, 0, 0.3, 0), C.dust, 1);
  fx(dim, "origin:debris", at(c, 0.6, 0.3, -0.4), C.ash, 1);
  fx(dim, "origin:burst", at(c, 0, 0.4, 0), C.dust, 0.9);
  fx(dim, "origin:spark", at(c, 0, 0.3, 0), rgb, 1);
}

export function chargeFx(dim, c, rgb) {
  fx(dim, "origin:charge", c, rgb, 1);
}
export function auraFx(dim, loc, rgb) {
  fx(dim, "origin:aura", at(loc, 0, 0.05, 0), rgb, 0.9);
}
export function readFx(dim, head) {
  fx(dim, "origin:read", at(head, 0, 0.9, 0), hexToRgb("#FFD36A"), 1);
  sound(dim, "mob.evocation_illager.cast_spell", head, 1.4, 0.6);
}
export function pillarFx(dim, loc, rgb) {
  fx(dim, "origin:pillar", loc, rgb, 1);
}
export function telegraphRing(dim, c, radius, rgb, alpha = 1) {
  fx(dim, "origin:ring", at(c, 0, 0.12, 0), rgb, alpha, { radius });
}
export function telegraphLine(dim, a, b, rgb) {
  line(dim, "origin:dot", at(a, 0, 0.15, 0), at(b, 0, 0.15, 0), rgb, 0.6, 1);
}
export function dodgeFx(dim, a, b) {
  line(dim, "origin:trail", at(a, 0, 1, 0), at(b, 0, 1, 0), C.white, 0.4, 0.7);
  fx(dim, "origin:shockwave", at(a, 0, 0.05, 0), C.white, 0.5, { radius: 0.8 });
}
export function vdist(a, b) {
  return V.dist(a, b);
}
