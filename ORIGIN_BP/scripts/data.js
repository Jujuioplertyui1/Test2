// ORIGIN v0.07 - data.js
// Persistent hero profile (player dynamic property "origin:hero") + per-session runtime state.
import { world, system } from "@minecraft/server";
import { hexToRgb } from "./util.js";

export const G = (i) => String.fromCharCode(0xe500 + i); // glyph page font/glyph_E5.png
export const ICON = {
  bolt: G(0), eye: G(1), fist: G(2), star: G(3), diamond: G(4), skull: G(5),
  lantern: G(6), moon: G(7), heart: G(8), flame: G(9), pipOn: G(10), pipOff: G(11),
  shield: G(12), read: G(13), combo: G(14),
};
// Bar rows on the glyph sheet: row*16 + [L full, L half, L empty, M full, M half, M empty, R full, R half, R empty]
export const BAR = { energy: 1, dread: 2, hot: 3, gold: 4, health: 5 };
export function bar(row, frac, segs = 10) {
  const steps = Math.round(Math.max(0, Math.min(1, frac)) * segs * 2);
  let s = "";
  for (let i = 0; i < segs; i++) {
    const v = steps - i * 2;
    const kind = v >= 2 ? 0 : v === 1 ? 1 : 2;
    const pos = i === 0 ? 0 : i === segs - 1 ? 6 : 3;
    s += G(row * 16 + pos + kind);
  }
  return s;
}

export const ARCH = {
  brawler: {
    key: "brawler", idx: 0, name: "Physical", alias: "Brawler", col: "§6", rgb: hexToRgb("#F07A21"), icon: ICON.fist,
    maxEnergy: 80, regen: 4, mechanic: "Momentum",
    tagline: "Every hit you land makes the next one hurt more.",
    explain: "Landing hits (moves or fists) builds Momentum, up to 5 stacks. Each stack adds 12% move damage. Stop fighting for 3 seconds and it drains.",
  },
  energy: {
    key: "energy", idx: 1, name: "Matter", alias: "Energy", col: "§b", rgb: hexToRgb("#3CC8F0"), icon: ICON.star,
    maxEnergy: 120, regen: 8, mechanic: "Overcharge",
    tagline: "Burn bright. Burn hot. Burn out if you're careless.",
    explain: "Huge Energy pool and fast regen. While Energy is at 90% or higher you are Overcharged: moves deal 40% more damage but cost 50% more.",
  },
  shadow: {
    key: "shadow", idx: 2, name: "Shadow", alias: "Shadow", col: "§5", rgb: hexToRgb("#8A3FD1"), icon: ICON.moon,
    maxEnergy: 100, regen: 5, mechanic: "Menace",
    tagline: "They fear you. That is the power.",
    explain: "Your Dread rises 50% faster and drains slower. Moves deal more damage the higher your Dread. At 25+ Dread your Menace aura unnerves nearby monsters.",
  },
};
export const ARCH_KEYS = ["brawler", "energy", "shadow"];

// ---- The stage ladder: Stirring -> Apex. Each step is earned with Resolve and a personal Trial.
export const STAGES = [
  { key: "stirring", name: "Stirring", resolve: 0, col: "§7" },
  { key: "kindled", name: "Kindled", resolve: 25, col: "§e" },
  { key: "tempered", name: "Tempered", resolve: 70, col: "§6" },
  { key: "ascendant", name: "Ascendant", resolve: 150, col: "§b" },
  { key: "exalted", name: "Exalted", resolve: 260, col: "§d" },
  { key: "apex", name: "Apex", resolve: 420, col: "§c" },
];
export const stageOf = (h) => Math.max(0, Math.min(STAGES.length - 1, h.stage ?? 0));

// ---- Moveset parts. Every move = Form + Element + Modifier + Finisher, within a power budget
// that grows with your stage (10 at Stirring -> 15 at Apex). Some parts unlock at higher stages.
export const POWER_BUDGET = 10;
export const budgetOf = (h) => POWER_BUDGET + stageOf(h);
export const PARTS = {
  forms: {
    strike: { name: "Strike", power: 3, cost: 10, cd: 14, dmg: 6, stage: 0, desc: "a close blow in a cone in front of you" },
    dash: { name: "Dash", power: 4, cost: 14, cd: 30, dmg: 5, stage: 0, desc: "a 6-block blink that hits everything you pass" },
    blast: { name: "Blast", power: 4, cost: 18, cd: 26, dmg: 7, stage: 0, desc: "a beam that hits the first target within 18 blocks" },
    wave: { name: "Wave", power: 4, cost: 16, cd: 30, dmg: 6, stage: 1, desc: "a shockwave that rolls 10 blocks along the ground" },
    leap: { name: "Leap", power: 4, cost: 16, cd: 36, dmg: 7, stage: 1, desc: "jump at the nearest enemy and crash down on it" },
    nova: { name: "Nova", power: 5, cost: 20, cd: 40, dmg: 6, stage: 2, desc: "a burst that hits everything within 4 blocks" },
    volley: { name: "Volley", power: 5, cost: 18, cd: 34, dmg: 3, stage: 3, desc: "three homing bolts that pick their own targets" },
  },
  elements: {
    kinetic: { name: "Kinetic", power: 1, cost: 0, hex: "#F4E7C1", stage: 0, desc: "heavy knockback" },
    flame: { name: "Flame", power: 2, cost: 4, hex: "#FF7A1F", stage: 0, desc: "sets targets on fire" },
    void: { name: "Void", power: 2, cost: 4, hex: "#8A3FD1", stage: 0, desc: "inflicts Unease and doubles Dread gained" },
    frost: { name: "Frost", power: 2, cost: 4, hex: "#8FE3FF", stage: 1, desc: "chills targets: heavy slow for 3s" },
    storm: { name: "Storm", power: 3, cost: 6, hex: "#FFF36B", stage: 2, desc: "lightning arcs to 2 more enemies nearby" },
  },
  modifiers: {
    none: { name: "None", power: 0, cost: 0, cd: 0, mult: 1, stage: 0, desc: "" },
    charged: { name: "Charged", power: 2, cost: 6, cd: 10, mult: 1.6, windup: 12, stage: 0, desc: "0.6s wind-up, 60% more damage" },
    area: { name: "Area", power: 3, cost: 8, cd: 6, mult: 0.8, radius: 3, stage: 0, desc: "also hits everything within 3 blocks of impact" },
    rapid: { name: "Rapid", power: 1, cost: 0, cd: -8, mult: 0.75, stage: 0, desc: "recharges much faster, hits a bit softer" },
    pierce: { name: "Pierce", power: 2, cost: 4, cd: 4, mult: 0.9, stage: 1, desc: "beams and waves pass through everyone" },
    echo: { name: "Echo", power: 3, cost: 8, cd: 10, mult: 1, stage: 2, desc: "the move repeats itself 0.6s later at half power" },
    drain: { name: "Drain", power: 3, cost: 6, cd: 6, mult: 0.9, stage: 3, desc: "heals you for a quarter of the damage dealt" },
  },
  finishers: {
    none: { name: "None", power: 0, cost: 0, cd: 0, stage: 0, desc: "" },
    fear: { name: "Fear Burst", power: 3, cost: 10, cd: 10, stage: 0, desc: "ends with a burst of fear (Dread at 30+, otherwise Unease)" },
    launch: { name: "Launch", power: 2, cost: 4, cd: 4, stage: 0, desc: "knocks everything you hit into the air" },
    pull: { name: "Pull", power: 2, cost: 4, cd: 4, stage: 1, desc: "drags everything you hit to your feet" },
    detonate: { name: "Detonate", power: 3, cost: 8, cd: 8, stage: 2, desc: "everything you hit explodes a second later" },
    shatter: { name: "Shatter", power: 3, cost: 8, cd: 8, stage: 3, desc: "double damage to anything under 30% health" },
  },
};
export const ORDER = {
  forms: ["strike", "dash", "blast", "wave", "leap", "nova", "volley"],
  elements: ["kinetic", "flame", "void", "frost", "storm"],
  modifiers: ["none", "charged", "area", "rapid", "pierce", "echo", "drain"],
  finishers: ["none", "fear", "launch", "pull", "detonate", "shatter"],
};
// Combos: cast moves with these FORMS in order (within 3s of each other) for a bonus on the last one
export const COMBOS = [
  { seq: ["dash", "strike"], name: "Blindside", mult: 1.5 },
  { seq: ["strike", "strike", "strike"], name: "Flurry", mult: 1.8, stun: true },
  { seq: ["leap", "nova"], name: "Meteor Fall", mult: 1.4, radius: 1.6 },
  { seq: ["wave", "blast"], name: "Riptide", mult: 1.4, pierce: true },
  { seq: ["volley", "dash"], name: "Hunter's Rush", mult: 1.5 },
  { seq: ["nova", "wave"], name: "Shockfront", mult: 1.5 },
  { seq: ["blast", "dash", "strike"], name: "Afterimage", mult: 2.0, stun: true },
];

export function moveStats(m) {
  const f = PARTS.forms[m.form] ?? PARTS.forms.strike;
  const e = PARTS.elements[m.element] ?? PARTS.elements.kinetic;
  const o = PARTS.modifiers[m.modifier] ?? PARTS.modifiers.none;
  const x = PARTS.finishers[m.finisher] ?? PARTS.finishers.none;
  return {
    power: f.power + e.power + o.power + x.power,
    cost: Math.max(4, f.cost + e.cost + o.cost + x.cost),
    cd: Math.max(8, f.cd + o.cd + x.cd),
  };
}
export function moveRecipe(m) {
  const parts = [PARTS.forms[m.form]?.name, PARTS.elements[m.element]?.name];
  if (m.modifier !== "none") parts.push(PARTS.modifiers[m.modifier]?.name);
  if (m.finisher !== "none") parts.push(PARTS.finishers[m.finisher]?.name);
  return parts.join(" + ");
}

const mv = (name, form, element, modifier = "none", finisher = "none") => ({ name, form, element, modifier, finisher });
export const DEFAULT_MOVES = {
  brawler: [mv("Breaker", "strike", "kinetic", "charged"), mv("Rush", "dash", "kinetic", "area"), mv("Haymaker", "strike", "kinetic", "none", "fear")],
  energy: [mv("Lance", "blast", "flame", "charged"), mv("Flare", "strike", "flame", "area"), mv("Spark Step", "dash", "flame")],
  shadow: [mv("Nightstep", "dash", "void", "charged"), mv("Hush", "strike", "void", "area"), mv("Whisper", "blast", "void", "none", "fear")],
};

export function defaultHero() {
  return {
    v: 1,
    awakened: false,
    arch: null,
    moves: DEFAULT_MOVES.brawler.map((m) => ({ ...m })),
    active: 0,
    colors: { primary: "#C8262C", secondary: "#2F6FDE", accent: "#F2C230" },
    suit: null,      // per-part suit (suit.js suitOf() fills it in)
    hud: "corner",   // "corner" (JSON UI corner HUD) | "vanilla" (actionbar HUD)
    ui: "custom",    // "custom" (JSON UI layouts) | "vanilla" (plain forms)
    forgeRet: null,  // where to return if the game closes during the Move Forge
    dread: 0,
    energy: 80,
    skyOverride: "auto",
    gotShard: false,
    stats: { kills: 0, hits: 0, casts: 0, tells: 0, brutes: 0, villains: 0, lastFight: null },
    power: null,       // signature superpower key (rolled at random from your archetype's pool)
    path: "none",      // "hero" | "villain" | "none" - powers don't care, people do
    alter: null,       // last Alter Ego personality: "kind" | "cruel" | "just"
    egoMode: "random", // Alter Ego behavior setting: "friendly" | "hostile" | "random"
    stage: 0,          // index into STAGES (Stirring .. Apex)
    resolve: 0,        // earned in fights; unlocks the next Trial
    surge: 0,          // 0-100: fills in combat; spent on Awakened Form (Ascendant+) and the Ultimate (Apex)
    banish: null,      // {dim,x,y,z} while you're banished to the Void (survives a relog)
    quest: { signal: 0 },   // Signal Lost questline stage
    staticState: null, // set while you're trapped in the Static

    ret: null,
  };
}

// ---- persistence ----
const KEY = "origin:hero";
const cache = new Map();
const dirty = new Set();

export function hero(player) {
  let h = cache.get(player.id);
  if (h) return h;
  h = defaultHero();
  try {
    const raw = player.getDynamicProperty(KEY);
    if (typeof raw === "string") {
      const saved = JSON.parse(raw);
      h = { ...h, ...saved, colors: { ...h.colors, ...(saved.colors ?? {}) }, stats: { ...h.stats, ...(saved.stats ?? {}) }, quest: { ...h.quest, ...(saved.quest ?? {}) } };
      if (!Array.isArray(h.moves) || h.moves.length !== 3) h.moves = defaultHero().moves;
      // v0.04 power ids: Optic Beams -> Blast; Second Self + Void Touch merged into Sentry
      const OLD = { optic: "blast", second_self: "sentry", void_touch: "sentry" };
      if (OLD[h.power]) h.power = OLD[h.power];
      if (!["friendly", "hostile", "random"].includes(h.egoMode)) h.egoMode = "random";
    }
  } catch (e) {
    console.warn("[ORIGIN] could not read hero data: " + e);
  }
  cache.set(player.id, h);
  return h;
}

export function markDirty(player) {
  dirty.add(player.id);
}

export function saveNow(player) {
  const h = cache.get(player.id);
  if (!h) return;
  try {
    player.setDynamicProperty(KEY, JSON.stringify(h));
    dirty.delete(player.id);
  } catch (e) {
    console.warn("[ORIGIN] save failed: " + e);
  }
}

export function saveDirty() {
  if (!dirty.size) return;
  for (const p of world.getAllPlayers()) if (dirty.has(p.id)) saveNow(p);
}

export function resetHero(player) {
  cache.set(player.id, defaultHero());
  saveNow(player);
}

export function forget(id) {
  cache.delete(id);
  runtime.delete(id);
  dirty.delete(id);
}

// ---- runtime (not saved) ----
const runtime = new Map();
export function RT(player) {
  let r = runtime.get(player.id);
  if (!r) {
    r = {
      cd: [0, 0, 0],
      momentum: 0,
      momentumAt: 0,
      lastCombat: -99999,
      msg: "",
      msgUntil: 0,
      cine: null,
      casting: false,
      quips: {},
      inIW: false,
      dreadFog: false,
      lastHeart: 0,
      lastUse: 0,
      lastHp: -1,
      gateCd: 0,
      fight: null,
      highDreadSeen: false,
      station: null,      // {kind} while a Suit/Move Forge is open
      traveling: false,
      titleUntil: 0,      // a real title is showing: corner HUD waits
      combo: 0,
      comboUntil: 0,
      lastSneak: -99,
      dodgeCd: 0,
      iwFog: null,
      staticLock: false,
      staticReverse: 0,
      staticChat: false,
      staticHideUi: false,
      powerOn: false,
      powerCd: 0,
      beamUntil: 0,
      beamHits: null,     // Map entityId -> tick (Blast hits each target at most every 8 ticks)
      flyStart: 0,        // Flight: when this flight started (8s max)
      reachAt: 0,         // Stretch: last long-range punch
      egoCallCd: 0,       // Sentry: manual Alter Ego call cooldown
      swapCd: 0,          // Sentry: low-health swap cooldown
      shadeLit: false,    // Shade Form: currently exposed by light
      ambushUntil: 0,     // Shadow Step: next melee hit bonus window
    };
    runtime.set(player.id, r);
  }
  return r;
}

export function maxEnergy(h) {
  return ARCH[h.arch]?.maxEnergy ?? 100;
}

// Combat bookkeeping (also feeds "Rate my last fight")
export function combat(player) {
  const r = RT(player);
  const t = system.currentTick;
  if (!r.fight || t - r.lastCombat > 200) {
    r.fight = { start: t, hits: 0, casts: 0, taken: 0, kills: 0, won: false, punish: 0 };
  }
  r.lastCombat = t;
  return r.fight;
}
export function closeFight(player) {
  const r = RT(player);
  if (!r.fight) return;
  const h = hero(player);
  h.stats.lastFight = { ...r.fight, len: Math.max(1, r.lastCombat - r.fight.start) };
  r.fight = null;
  markDirty(player);
}
