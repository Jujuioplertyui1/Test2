// ORIGIN v0.02 - plan.js
// Pure planning code (no @minecraft imports) so it runs in Node for previews/tests.
// Every op is [dx, dy, dz, lightKey, dreadKey] relative to a center. Keys index SPECS.

export const DIM_ID = "origin:inner_world";   // custom void dimension (Script API 2.8.0)
export const STATIC_ID = "origin:the_static";  // the analog void you drag someone into
export const SLOT_SPACING = 512;               // each hero gets their own Inner World
export const IW_Y = 100;
export function slotCenter(slot) {
  return { x: slot * SLOT_SPACING, y: IW_Y, z: 0 };
}
export const HALL_CENTER = { x: 0, y: IW_Y, z: -2048 }; // the dark place you fall into
// every hero falls into their OWN dark place (same layout, one per Inner World slot) - two people can awaken at once
export const hallCenter = (slot = 0) => ({ x: slot * SLOT_SPACING, y: HALL_CENTER.y, z: HALL_CENTER.z });
// The Void: sealed black cells far from everything, where Sentry's Banish sends people (and villains send you)
export const VOID_ROOM = { x: -8192, y: 100, z: -8192 };
export const VOID_CELLS = 8, VOID_CELL_SPACING = 12;
export const SKY_OFFSET_Y = 6;
export const SKY_R = 48;
export const HALL_R = 15;

// Block specs. A spec is an id string, {id, states}, or {alt:[spec...]} (first one that resolves wins).
export const SPECS = {
  air: "minecraft:air",
  grass: "minecraft:grass_block",
  dirt: "minecraft:dirt",
  coarse: { alt: ["minecraft:coarse_dirt", { id: "minecraft:dirt", states: { dirt_type: "coarse" } }] },
  soul_soil: "minecraft:soul_soil",
  stone: "minecraft:stone",
  tuff: "minecraft:tuff",
  deepslate: "minecraft:deepslate",
  cobble: "minecraft:cobblestone",
  mossy: "minecraft:mossy_cobblestone",
  calcite: "minecraft:calcite",
  pbs_bricks: "minecraft:polished_blackstone_bricks",
  pbs: "minecraft:polished_blackstone",
  chiseled_pbs: "minecraft:chiseled_polished_blackstone",
  gilded: "minecraft:gilded_blackstone",
  blackstone: "minecraft:blackstone",
  pdeep: "minecraft:polished_deepslate",
  quartz: "minecraft:quartz_block",
  quartz_pillar: { alt: ["minecraft:quartz_pillar", { id: "minecraft:quartz_block", states: { chisel_type: "lines" } }, "minecraft:quartz_block"] },
  chiseled_quartz: { alt: ["minecraft:chiseled_quartz_block", { id: "minecraft:quartz_block", states: { chisel_type: "chiseled" } }, "minecraft:quartz_block"] },
  gold: "minecraft:gold_block",
  crying: "minecraft:crying_obsidian",
  stone_bricks: "minecraft:stone_bricks",
  smooth_stone: "minecraft:smooth_stone",
  smooth_sandstone: { alt: ["minecraft:smooth_sandstone", "minecraft:sandstone"] },
  lantern: "minecraft:lantern",
  soul_lantern: "minecraft:soul_lantern",
  cherry_log: "minecraft:cherry_log",
  crimson_stem: { alt: ["minecraft:crimson_stem", "minecraft:dark_oak_log"] },
  cherry_leaves: { alt: [{ id: "minecraft:cherry_leaves", states: { persistent_bit: true } }, "minecraft:cherry_leaves"] },
  wart: "minecraft:nether_wart_block",
  hay: "minecraft:hay_block",
  pumpkin: "minecraft:carved_pumpkin",
  jack: "minecraft:lit_pumpkin",
  torchflower: { alt: ["minecraft:torchflower", "minecraft:poppy"] },
  poppy: "minecraft:poppy",
  dandelion: "minecraft:dandelion",
  cornflower: "minecraft:cornflower",
  daisy: "minecraft:oxeye_daisy",
  allium: "minecraft:allium",
  tuft: { alt: ["minecraft:short_grass", { id: "minecraft:tallgrass", states: { tall_grass_type: "tall" } }] },
  deadbush: { alt: ["minecraft:deadbush", "minecraft:dead_bush"] },
  moss_carpet: "minecraft:moss_carpet",
  light15: { alt: ["minecraft:light_block_15", { id: "minecraft:light_block", states: { block_light_level: 15 } }] },
  light12: { alt: ["minecraft:light_block_12", { id: "minecraft:light_block", states: { block_light_level: 12 } }] },
  light7: { alt: ["minecraft:light_block_7", { id: "minecraft:light_block", states: { block_light_level: 7 } }] },
  light4: { alt: ["minecraft:light_block_4", { id: "minecraft:light_block", states: { block_light_level: 4 } }] },
  // sky (Light)
  sky_blue: "minecraft:light_blue_concrete",
  sky_white: "minecraft:white_concrete",
  sky_wool: "minecraft:white_wool",
  sky_yellow: "minecraft:yellow_concrete",
  sky_orange: "minecraft:orange_concrete",
  sky_pink: "minecraft:pink_concrete",
  sky_snow: "minecraft:snow",
  sky_lgray: "minecraft:light_gray_concrete",
  sun_core: "minecraft:ochre_froglight",
  sun_halo: "minecraft:glowstone",
  // sky (Dread)
  sky_black: "minecraft:black_concrete",
  sky_red: "minecraft:red_concrete",
  sky_star: "minecraft:crying_obsidian",
  sky_ember: "minecraft:magma",
  sky_hyphae: { alt: ["minecraft:crimson_hyphae", "minecraft:red_concrete"] },
  moon_core: "minecraft:redstone_block",
  moon_rim: "minecraft:red_concrete",
  // v0.02 additions
  cherry_planks: { alt: ["minecraft:cherry_planks", "minecraft:birch_planks"] },
  crimson_planks: { alt: ["minecraft:crimson_planks", "minecraft:dark_oak_planks"] },
  amethyst: "minecraft:amethyst_block",
  obsidian: "minecraft:obsidian",
  bell: { alt: [{ id: "minecraft:bell", states: { attachment: "standing", direction: 0 } }, "minecraft:bell"] },
  sea_lantern: "minecraft:sea_lantern",
  shroomlight: "minecraft:shroomlight",
  suit_forge: { alt: [{ id: "origin:suit_forge", states: { "minecraft:cardinal_direction": "south" } }, "origin:suit_forge"] },
  move_forge: { alt: [{ id: "origin:move_forge", states: { "minecraft:cardinal_direction": "south" } }, "origin:move_forge"] },
  oak_log: "minecraft:oak_log",
  barrier: "minecraft:barrier",
  red_glass: "minecraft:red_stained_glass",
  packed_mud: { alt: ["minecraft:packed_mud", "minecraft:smooth_sandstone"] },
  mud_bricks: { alt: ["minecraft:mud_bricks", "minecraft:bricks"] },
  pgranite: "minecraft:polished_granite",
  granite: "minecraft:granite",
  spruce_log: "minecraft:spruce_log",
  spruce_planks: "minecraft:spruce_planks",
  dark_oak_log: "minecraft:dark_oak_log",
  dark_oak_planks: "minecraft:dark_oak_planks",
  campfire: { alt: [{ id: "minecraft:campfire", states: { extinguished: false } }, "minecraft:campfire"] },
  soul_campfire: { alt: [{ id: "minecraft:soul_campfire", states: { extinguished: false } }, "minecraft:soul_campfire"] },
  orange_wool: "minecraft:orange_wool",
  red_wool: "minecraft:red_wool",
  diorite: "minecraft:polished_diorite",
  smooth_quartz: "minecraft:smooth_quartz",
  prismarine_bricks: "minecraft:prismarine_bricks",
  dark_prismarine: "minecraft:dark_prismarine",
  lb_glass: "minecraft:light_blue_stained_glass",
  cyan_glass: "minecraft:cyan_stained_glass",
  lb_concrete: "minecraft:light_blue_concrete",
  end_rod: "minecraft:end_rod",
  blue_orchid: { alt: [{ id: "minecraft:red_flower", states: { flower_type: "orchid" } }, "minecraft:blue_orchid"] },
  deep_tiles: "minecraft:deepslate_tiles",
  deep_chiseled: "minecraft:chiseled_deepslate",
  pdeep2: "minecraft:polished_deepslate",
  mycelium: "minecraft:mycelium",
  sculk: "minecraft:sculk",
  purple_glass: "minecraft:purple_stained_glass",
  magenta_glass: "minecraft:magenta_stained_glass",
  amethyst_cluster: "minecraft:amethyst_cluster",
  chain: "minecraft:chain",
  purple_concrete: "minecraft:purple_concrete",
  magenta_concrete: "minecraft:magenta_concrete",
  sky_indigo: "minecraft:blue_concrete",
  sky_purple: "minecraft:purple_concrete",
  sky_magenta: "minecraft:magenta_concrete",
  sky_violet_wool: "minecraft:purple_wool",
  sky_gold: "minecraft:yellow_concrete",
  sky_amber: "minecraft:orange_concrete",
  sky_rose: "minecraft:pink_concrete",
  sky_peach: "minecraft:white_terracotta",
  sky_cyan: "minecraft:cyan_concrete",
  sky_star_w: "minecraft:white_concrete",
  moon_white: "minecraft:white_concrete",
  moon_grey: "minecraft:light_gray_concrete",
  sun_white: "minecraft:sea_lantern",
  oak_leaves: { alt: [{ id: "minecraft:oak_leaves", states: { persistent_bit: true } }, "minecraft:oak_leaves"] },
  azure: "minecraft:azure_bluet",
  oxeye: "minecraft:oxeye_daisy",
  // The Static: ground/sky are a 50/50 grayscale dither; trees are colorful glitch blocks
  st_black: "minecraft:black_concrete",
  st_white: "minecraft:white_concrete",
  st_gray: "minecraft:gray_concrete",
  st_lgray: "minecraft:light_gray_concrete",
  blue_pool: "minecraft:water",
  blue_rim: "minecraft:light_blue_concrete",
  glitch1: "minecraft:magenta_glazed_terracotta",
  glitch2: "minecraft:lime_glazed_terracotta",
  glitch3: "minecraft:cyan_glazed_terracotta",
  glitch4: "minecraft:yellow_glazed_terracotta",
  glitch5: "minecraft:red_glazed_terracotta",
  glitch_log: "minecraft:purple_glazed_terracotta",
};


const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;

export function hash2(x, z, s = 0) {
  const n = Math.sin(x * 127.1 + z * 311.7 + s * 74.7) * 43758.5453;
  return n - Math.floor(n);
}
export function hash3(x, y, z, s = 0) {
  const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + s * 4.581) * 43758.5453;
  return n - Math.floor(n);
}

// ---------------------------------------------------------------------------------------------
// LAYOUT: one main isle + four satellites joined by bridges, floating debris, all inside a sky dome
// ---------------------------------------------------------------------------------------------
export const ISLES = [
  { key: "main", x: 0, z: 0, y: 0, r: 12.6, seed: 0 },
  { key: "memory", x: -27, z: 7, y: 2, r: 8, seed: 11 },
  { key: "dojo", x: 28, z: -4, y: -1, r: 10, seed: 23 },
  { key: "workshop", x: 15, z: 27, y: 1, r: 7.5, seed: 37 },
  { key: "gate", x: 0, z: -30, y: 3, r: 6.2, seed: 51 },
];
export const isle = (k) => ISLES.find((i) => i.key === k);

export function isleRadius(I, theta) {
  if (I.key === "main") return 12.6 + 1.7 * Math.sin(3 * theta + 0.7) + 1.1 * Math.sin(5 * theta + 2.1) + 0.6 * Math.sin(7 * theta + 4.0);
  const s = I.seed;
  return I.r * (1 + 0.13 * Math.sin(3 * theta + s) + 0.08 * Math.sin(5 * theta + 2 * s) + 0.05 * Math.sin(7 * theta + 3 * s));
}
function inIsle(I, x, z, margin = 0) {
  const dx = x - I.x, dz = z - I.z;
  return Math.hypot(dx, dz) <= isleRadius(I, Math.atan2(dz, dx)) - margin;
}
export function isleAt(x, z, margin = 0) {
  for (const I of ISLES) if (inIsle(I, x, z, margin)) return I;
  return null;
}

// Named landmarks (offsets from the slot center). Script + preview agree on these.
export const LANDMARKS = {
  anchor: { x: 0.5, y: 1, z: 0.5 },
  manifestation: { x: 0.5, y: 1.3, z: 4.5 },
  arrival: { x: 0.5, y: 1, z: 8.5 },
  tree: { x: -27, y: 2, z: 7 },
  arena: { x: 28.5, y: 0, z: -3.5 },          // dojo arena center (floor top = y)
  bell: { x: 28, y: 0, z: 5 },               // ring it to spar
  suitForge: { x: 13, y: 2, z: 27 },
  moveForge: { x: 17, y: 2, z: 27 },
  gate: { x: 0, y: 3, z: -30 },              // walk through (north) to wake
};

function bridgeLine(A, B) {
  // returns list of [x,z,y] deck points from A's rim to B's rim
  const pts = [];
  const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz);
  const ux = dx / L, uz = dz / L;
  for (let t = 0; t <= L; t += 0.5) {
    const x = A.x + ux * t, z = A.z + uz * t;
    if (inIsle(A, x, z, 1.2) || inIsle(B, x, z, 1.2)) continue;
    const f = t / L;
    pts.push([x, z, A.y + (B.y - A.y) * f, ux, uz]);
  }
  return pts;
}

// Each archetype gets its own Inner World look (Light state). Dread stays the same crimson nightmare.
export const THEMES = {
  brawler: {   // golden-hour dojo: packed mud paths, warm wood, lanterns, cherry blossoms
    calcite: "packed_mud", chiseled_quartz: "pgranite", stone_bricks: "mud_bricks", quartz: "mud_bricks",
    smooth_stone: "dark_oak_planks", smooth_sandstone: "spruce_planks", quartz_pillar: "spruce_log",
    sea_lantern: "lantern", cobble: "granite", cornflower: "poppy", allium: "dandelion", daisy: "torchflower",
  },
  energy: {    // crystal sky-lab: white quartz, prismarine, glass, sea lanterns, blue flowers
    stone_bricks: "prismarine_bricks", quartz: "smooth_quartz", smooth_stone: "smooth_quartz", smooth_sandstone: "lb_concrete",
    lantern: "sea_lantern", cherry_log: "quartz_pillar", cherry_leaves: "lb_glass", cherry_planks: "smooth_quartz",
    moss_carpet: "air", poppy: "blue_orchid", dandelion: "cornflower", torchflower: "blue_orchid", allium: "cornflower",
    mossy: "diorite", cobble: "diorite", hay: "smooth_quartz", pumpkin: "sea_lantern",
  },
  shadow: {    // dusk garden: mycelium, deepslate tiles, soul light, violet glass, amethyst
    grass: "mycelium", calcite: "deep_tiles", chiseled_quartz: "deep_chiseled", stone_bricks: "pbs_bricks", quartz: "pdeep2",
    quartz_pillar: "obsidian", smooth_stone: "deep_tiles", smooth_sandstone: "pdeep2", lantern: "soul_lantern", sea_lantern: "crying",
    cherry_log: "dark_oak_log", cherry_leaves: "purple_glass", cherry_planks: "dark_oak_planks", moss_carpet: "air",
    poppy: "allium", dandelion: "amethyst_cluster", cornflower: "allium", daisy: "amethyst_cluster", torchflower: "allium", tuft: "air",
    stone: "deepslate", mossy: "tuff", cobble: "blackstone", gold: "amethyst", hay: "pdeep2", pumpkin: "soul_lantern",
  },
};

export function planIslands(arch = "brawler") {
  const ops = [];
  const occupied = new Set();
  const surf = new Map(); // "x,z" -> {y, light, dread, path, isle}
  const K = (x, y, z) => `${x},${y},${z}`;
  const put = (x, y, z, l, d = l) => { ops.push([x, y, z, l, d]); occupied.add(K(x, y, z)); };

  // 1) terrain bodies
  for (const I of ISLES) {
    const R0 = Math.ceil(I.r * 1.3) + 2;
    for (let x = Math.floor(I.x - R0); x <= I.x + R0; x++) for (let z = Math.floor(I.z - R0); z <= I.z + R0; z++) {
      const dx = x - I.x, dz = z - I.z, r = Math.hypot(dx, dz);
      const R = isleRadius(I, Math.atan2(dz, dx));
      if (r > R) continue;
      const edge = r / R;
      const depth = 2 + Math.floor(Math.pow(1 - edge, 0.65) * (I.r * 1.05) + hash2(x, z, 3 + I.seed) * 2.5);
      const h = hash2(x, z, 9 + I.seed);
      surf.set(`${x},${z}`, { y: I.y, light: "grass", dread: h < 0.62 ? "coarse" : h < 0.86 ? "soul_soil" : "grass", isle: I.key });
      for (let k = 1; k < depth; k++) {
        const y = I.y - k;
        let b;
        if (k <= 2) b = k === 2 && edge > 0.85 ? "coarse" : "dirt";
        else {
          const hh = hash3(x, y, z, 1);
          if (k > 8) b = hh < 0.5 ? "deepslate" : hh < 0.8 ? "tuff" : "stone";
          else b = hh < 0.55 ? "stone" : hh < 0.78 ? "tuff" : hh < 0.9 ? "cobble" : "mossy";
        }
        put(x, y, z, b);
      }
      if (hash2(x, z, 21 + I.seed) < 0.07 && edge < 0.8) {
        const n = 1 + Math.floor(hash2(x, z, 22) * 3);
        for (let i = 0; i < n; i++) put(x, I.y - depth - i, z, i === n - 1 ? "deepslate" : "tuff");
      }
    }
  }
  const S = (x, z) => surf.get(`${x},${z}`);
  const path = (x, z, l, d) => { const s = S(x, z); if (s) { s.light = l; s.dread = d; s.path = true; } };

  // 2) main isle: plaza + ring path + spurs toward each bridge
  const M = isle("main");
  for (const [k, s] of surf) {
    if (s.isle !== "main") continue;
    const [x, z] = k.split(",").map(Number);
    const r = Math.hypot(x, z);
    if (r <= 2.6) { s.light = "chiseled_quartz"; s.dread = "chiseled_pbs"; s.path = true; }
    else if (Math.abs(r - 6.3) < 0.75) { s.light = "calcite"; s.dread = "pbs_bricks"; s.path = true; }
  }
  for (const I of ISLES) {
    if (I === M) continue;
    const L = Math.hypot(I.x, I.z), ux = I.x / L, uz = I.z / L;
    for (let t = 6; t <= 14; t += 0.5) for (let w = -1; w <= 1; w++) path(Math.round(ux * t - uz * w), Math.round(uz * t + ux * w), "calcite", "pbs_bricks");
  }
  // 3) bridges (3 wide) with lantern posts
  for (const I of ISLES) {
    if (I === M) continue;
    const pts = bridgeLine(M, I);
    let n = 0;
    for (const [x, z, y, ux, uz] of pts) {
      for (let w = -1; w <= 1; w++) {
        const bx = Math.round(x - uz * w), bz = Math.round(z + ux * w), by = Math.round(y);
        if (isleAt(bx, bz)) continue;
        if (occupied.has(K(bx, by, bz))) continue;
        put(bx, by, bz, w === 0 ? "calcite" : "stone_bricks", w === 0 ? "pbs_bricks" : "blackstone");
        put(bx, by - 1, bz, "stone", "blackstone");
      }
      if (n++ % 12 === 6) {
        const side = (n % 24 < 12) ? 2 : -2;
        const px = Math.round(x - uz * side), pz = Math.round(z + ux * side), py = Math.round(y);
        if (!isleAt(px, pz)) { put(px, py, pz, "stone_bricks", "pbs_bricks"); put(px, py + 1, pz, "lantern", "soul_lantern"); }
      }
    }
    // bridge continues onto the satellite as a short path
    const L = Math.hypot(I.x, I.z), ux = -I.x / L, uz = -I.z / L;
    for (let t = 1; t <= I.r; t += 0.5) for (let w = -1; w <= 1; w++) path(Math.round(I.x + ux * t - uz * w), Math.round(I.z + uz * t + ux * w), "calcite", "pbs_bricks");
  }
  // 4) dojo arena
  const D = isle("dojo"), ac = LANDMARKS.arena;
  for (const [k, s] of surf) {
    if (s.isle !== "dojo") continue;
    const [x, z] = k.split(",").map(Number);
    const rr = Math.hypot(x + 0.5 - ac.x, z + 0.5 - ac.z);
    if (Math.abs(rr - 7) < 0.6) { s.light = "smooth_stone"; s.dread = "blackstone"; s.path = true; }
    else if (rr < 6.5) { s.light = (Math.floor(x) + Math.floor(z)) % 2 ? "smooth_sandstone" : "smooth_stone"; s.dread = (Math.floor(x) + Math.floor(z)) % 2 ? "pdeep" : "pbs"; s.path = true; }
  }
  // 5) workshop floor
  const W = isle("workshop");
  for (const [k, s] of surf) {
    if (s.isle !== "workshop") continue;
    const [x, z] = k.split(",").map(Number);
    if (Math.hypot(x - W.x, z - W.z) < 5.2) { s.light = (x + z) % 2 ? "smooth_stone" : "calcite"; s.dread = (x + z) % 2 ? "pdeep" : "pbs"; s.path = true; }
  }
  // 6) gate isle floor
  const Gt = isle("gate");
  for (const [k, s] of surf) {
    if (s.isle !== "gate") continue;
    const [x, z] = k.split(",").map(Number);
    if (Math.abs(x - Gt.x) <= 1 || Math.hypot(x - Gt.x, z - Gt.z) < 2.5) { s.light = "calcite"; s.dread = "pbs_bricks"; s.path = true; }
  }
  // write surfaces
  for (const [k, s] of surf) {
    const [x, z] = k.split(",").map(Number);
    put(x, s.y, z, s.light, s.dread);
  }
  const top = (x, z) => (S(x, z)?.y ?? 0);

  // 7) the heart of the island (different for every archetype)
  const RAW = (x, y, z, l, d = l) => { ops.push([x, y, z, "=" + l, d]); occupied.add(K(x, y, z)); }; // "=" skips the theme
  if (arch === "brawler") {
    // training brazier: a mud-brick fire pit ringed by four wrapped sparring posts
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) RAW(x, 1, z, x || z ? "mud_bricks" : "campfire", x || z ? "pbs_bricks" : "soul_campfire");
    for (const [cx, cz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
      RAW(cx, 1, cz, "spruce_log", "crimson_stem"); RAW(cx, 2, cz, "orange_wool", "crimson_stem"); RAW(cx, 3, cz, "spruce_log", "crimson_stem");
    }
    for (const [cx, cz] of [[2, 2], [-2, 2], [2, -2], [-2, -2]]) RAW(cx, 1, cz, "lantern", "soul_lantern");
  } else if (arch === "energy") {
    // crystal spire with a floating halo of crystal blocks
    for (let y = 1; y <= 6; y++) RAW(0, y, 0, y % 2 ? "lb_glass" : "sea_lantern", y % 2 ? "red_glass" : "shroomlight");
    RAW(0, 7, 0, "amethyst", "crying"); RAW(0, 8, 0, "end_rod", "air");
    for (const [cx, cz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { RAW(cx, 1, cz, "smooth_quartz", "pbs"); RAW(cx, 2, cz, "lb_glass", "red_glass"); }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      RAW(Math.round(Math.cos(a) * 3.2), 5 + (i % 2), Math.round(Math.sin(a) * 3.2), i % 2 ? "amethyst" : "sea_lantern", i % 2 ? "crying" : "shroomlight");
    }
  } else {
    // obsidian obelisk weeping soul fire, hung with chains
    RAW(0, 1, 0, "soul_campfire", "soul_campfire");
    for (const [cx, cz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) for (let y = 1; y <= 6 - (cx + cz === 0 ? 1 : 0); y++) RAW(cx, y, cz, y === 3 ? "crying" : "obsidian", "crying");
    for (const [cx, cz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) RAW(cx, 7, cz, "obsidian", "crying");
    RAW(0, 7, 0, "crying", "crying"); RAW(0, 8, 0, "amethyst", "crying");
    for (const [cx, cz] of [[0, 1], [0, -1]]) { RAW(cx, 6, cz, "chain", "chain"); RAW(cx, 5, cz, "soul_lantern", "soul_lantern"); }
    for (const [cx, cz] of [[3, 3], [-3, 3], [3, -3], [-3, -3]]) RAW(cx, 1, cz, "amethyst_cluster", "air");
  }

  // 8) memory isle: the tree that changes with you (and with your archetype)
  const t = LANDMARKS.tree, ty = top(t.x, t.z);
  const trunk = arch === "energy" ? "quartz_pillar" : arch === "shadow" ? "dark_oak_log" : "cherry_log";
  for (let y = 1; y <= 5; y++) RAW(t.x, ty + y, t.z, trunk, "crimson_stem");
  RAW(t.x + 1, ty + 4, t.z, trunk, "crimson_stem");
  RAW(t.x - 1, ty + 5, t.z, trunk, "crimson_stem");
  for (let lx = -4; lx <= 4; lx++) for (let ly = 4; ly <= 9; ly++) for (let lz = -4; lz <= 4; lz++) {
    const dd = Math.hypot(lx, (ly - 6.6) * 1.3, lz);
    if (dd > 3.7) continue;
    if (occupied.has(K(t.x + lx, ty + ly, t.z + lz))) continue;
    if (hash3(lx, ly, lz, 5) < 0.12 && dd > 2.8) continue;
    const h = hash3(lx, ly, lz, 6);
    let leaf = "cherry_leaves";
    if (arch === "energy") leaf = h < 0.12 ? "sea_lantern" : h < 0.55 ? "lb_glass" : "cyan_glass";
    if (arch === "shadow") leaf = h < 0.1 ? "amethyst" : h < 0.6 ? "purple_glass" : "magenta_glass";
    RAW(t.x + lx, ty + ly, t.z + lz, leaf, "wart");
  }
  // hanging vines of light / chains under the canopy
  if (arch !== "brawler") for (const [hx, hz] of [[2, 1], [-2, -1], [1, -2], [-1, 2]]) {
    RAW(t.x + hx, ty + 4, t.z + hz, arch === "energy" ? "end_rod" : "chain", "air");
  }
  put(t.x + 2, ty + 1, t.z - 2, "torchflower", "torchflower");
  for (const [mx, mz] of [[1, 1], [-1, 1], [2, 0], [1, -1], [-1, -1], [0, 2], [-2, 0]]) put(t.x + mx, ty + 1, t.z + mz, "moss_carpet", "air");

  // 9) dojo: pillars, dummy, bell
  for (const [px, pz] of [[5, 5], [-5, 5], [5, -5], [-5, -5]]) {
    const x = Math.floor(ac.x + px), z = Math.floor(ac.z + pz), y = top(x, z);
    for (let k = 1; k <= 3; k++) put(x, y + k, z, "stone_bricks", "pbs_bricks");
    put(x, y + 4, z, "sea_lantern", "shroomlight");
  }
  const dmx = Math.floor(ac.x + 8.5), dmz = Math.floor(ac.z), dmy = top(dmx, dmz);
  if (S(dmx, dmz)) { put(dmx, dmy + 1, dmz, "hay"); put(dmx, dmy + 2, dmz, "hay"); put(dmx, dmy + 3, dmz, "pumpkin", "jack"); }
  const bl = LANDMARKS.bell, bly = top(bl.x, bl.z);
  put(bl.x, bly + 1, bl.z, "stone_bricks", "pbs_bricks");
  put(bl.x, bly + 2, bl.z, "bell");

  // 10) workshop pavilion + the two stations
  for (const [px, pz] of [[-4, -3], [4, -3], [-4, 3], [4, 3]]) {
    const x = W.x + px, z = W.z + pz, y = top(x, z);
    for (let k = 1; k <= 4; k++) put(x, y + k, z, "cherry_log", "crimson_stem");
  }
  for (let x = W.x - 5; x <= W.x + 5; x++) for (let z = W.z - 4; z <= W.z + 4; z++) {
    if (Math.abs(x - W.x) === 5 && Math.abs(z - W.z) === 4) continue;
    put(x, W.y + 5, z, "cherry_planks", "crimson_planks");
  }
  put(W.x, W.y + 4, W.z, "lantern", "soul_lantern");
  const sf = LANDMARKS.suitForge, mf = LANDMARKS.moveForge;
  put(Math.floor(sf.x), W.y + 1, Math.floor(sf.z), "suit_forge");
  put(Math.floor(mf.x), W.y + 1, Math.floor(mf.z), "move_forge");

  // 11) the Gate
  const g = LANDMARKS.gate;
  for (const sx of [-2, 2]) for (let y = 1; y <= 4; y++) put(g.x + sx, g.y + y, g.z, "quartz_pillar", "pbs");
  for (let x = -2; x <= 2; x++) put(g.x + x, g.y + 5, g.z, "chiseled_quartz", "gilded");
  put(g.x, g.y + 6, g.z, "amethyst", "crying");

  // 12) flowers / tufts -> dead bushes
  const flowers = ["poppy", "dandelion", "cornflower", "daisy", "allium", "tuft", "tuft", "tuft"];
  for (const [k, s] of surf) {
    if (s.path) continue;
    const [x, z] = k.split(",").map(Number);
    if (Math.hypot(x, z) < 3.5) continue;
    if (occupied.has(K(x, s.y + 1, z))) continue;
    if (hash2(x, z, 33) > 0.2) continue;
    const f = flowers[Math.floor(hash2(x, z, 34) * flowers.length)];
    const dread = s.dread === "soul_soil" ? "air" : hash2(x, z, 35) < 0.4 ? "deadbush" : "air";
    put(x, s.y + 1, z, f, dread);
  }

  // 13) floating debris
  let placed = 0;
  for (let i = 0; i < 60 && placed < 18; i++) {
    const a = hash2(i, 7, 70) * TAU, d = 20 + hash2(i, 9, 71) * 22;
    const cx = Math.round(Math.cos(a) * d), cz = Math.round(Math.sin(a) * d);
    const cy = Math.round(-12 + hash2(i, 3, 72) * 34);
    if (ISLES.some((I) => Math.hypot(cx - I.x, cz - I.z) < I.r + 5)) continue;
    if (Math.hypot(cx, cy - SKY_OFFSET_Y, cz) > SKY_R - 6) continue;
    const rr = 1.1 + hash2(i, 5, 73) * 1.6;
    for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) for (let z = -3; z <= 3; z++) {
      if (Math.hypot(x, y * 1.4, z) > rr + hash3(x, y, z, i) * 0.6) continue;
      const hh = hash3(cx + x, cy + y, cz + z, 9);
      put(cx + x, cy + y, cz + z, y >= 1 && hh < 0.5 ? "mossy" : hh < 0.6 ? "stone" : "tuff", hh < 0.12 ? "crying" : "blackstone");
    }
    placed++;
  }

  // 14) invisible light grid over every isle
  for (const I of ISLES) for (let x = Math.floor(I.x - I.r); x <= I.x + I.r; x += 5) for (let z = Math.floor(I.z - I.r); z <= I.z + I.r; z += 5) {
    if (!inIsle(I, x, z, 1.5)) continue;
    const y = top(x, z) + 4;
    if (occupied.has(K(x, y, z))) continue;
    if (Math.hypot(x - t.x, z - t.z) < 5) continue;
    put(x, y, z, "light15", "light4");
  }

  // 15) invisible walls: barriers around every isle rim and both sides of every bridge,
  //     so nothing (you, or a Rift Brute) gets knocked into the void
  const deck = new Set();
  for (const o of ops) if (!isleAt(o[0], o[2]) && o[1] >= -2) deck.add(`${o[0]},${o[2]}`);
  const wall = (x, z, y) => {
    for (let k = 1; k <= 3; k++) {
      if (occupied.has(K(x, y + k, z))) continue;
      ops.push([x, y + k, z, "=barrier", "barrier"]);
      occupied.add(K(x, y + k, z));
    }
  };
  for (const [k, s2] of surf) {
    const [x, z] = k.split(",").map(Number);
    for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]]) {
      if (surf.has(`${nx},${nz}`) || deck.has(`${nx},${nz}`)) continue;
      wall(nx, nz, s2.y);
    }
  }
  for (const I of ISLES) {
    if (I === M) continue;
    for (const [x, z, y, ux, uz] of bridgeLine(M, I)) for (const w of [-2, 2]) {
      const bx = Math.round(x - uz * w), bz = Math.round(z + ux * w);
      if (isleAt(bx, bz) || deck.has(`${bx},${bz}`)) continue;
      wall(bx, bz, Math.round(y));
    }
  }

  // 16) archetype look: remap Light-state keys ("=" keys are already final)
  const T = THEMES[arch] ?? {};
  for (const o of ops) {
    if (typeof o[3] === "string" && o[3].startsWith("=")) o[3] = o[3].slice(1);
    else if (T[o[3]]) o[3] = T[o[3]];
  }
  return ops;
}

// ---------------------------------------------------------------------------------------------
// SKY DOME (centered at slot center + SKY_OFFSET_Y)
// ---------------------------------------------------------------------------------------------
function dirFromAngles(azDeg, elDeg) {
  const a = azDeg / DEG, e = elDeg / DEG;
  return { x: Math.cos(e) * Math.sin(a), y: Math.sin(e), z: Math.cos(e) * Math.cos(a) };
}
const SUN = dirFromAngles(160, 24);
const MOON = dirFromAngles(-20, 36);

const SUNSET = dirFromAngles(150, 9);
const NIGHT_MOON = dirFromAngles(200, 30);
function skyBrawler(n, e, h) {   // golden hour, huge low sun
  const ang = Math.acos(Math.max(-1, Math.min(1, n.x * SUNSET.x + n.y * SUNSET.y + n.z * SUNSET.z))) * DEG;
  if (ang < 8) return "sun_core";
  if (ang < 11) return "sun_halo";
  if (ang < 20 && e > -6) return h < 0.6 ? "sky_gold" : "sky_amber";
  if (e >= 50) return h < 0.75 ? "sky_blue" : "sky_white";
  if (e >= 30) return h < (e - 30) / 20 ? "sky_blue" : (h > 0.85 ? "sky_peach" : "sky_rose");
  if (e >= 12) return h < 0.5 ? "sky_rose" : "sky_amber";
  if (e >= -2) return h < 0.65 ? "sky_amber" : "sky_gold";
  if (e >= -14) return h < 0.4 ? "sky_rose" : "sky_peach";
  return h < 0.3 ? "sky_lgray" : "sky_peach";
}
function skyShadow(n, e, h) {    // violet night, big pale moon, lots of stars
  const ang = Math.acos(Math.max(-1, Math.min(1, n.x * NIGHT_MOON.x + n.y * NIGHT_MOON.y + n.z * NIGHT_MOON.z))) * DEG;
  if (ang < 6) return h < 0.25 ? "moon_grey" : "moon_white";
  if (ang < 7.5) return "sky_star_w";
  if (e >= 40) return h < 0.03 ? "sky_star_w" : (h < 0.12 ? "sky_indigo" : "sky_black");
  if (e >= 18) return h < 0.025 ? "sky_star_w" : (h < (40 - e) / 22 * 0.7 ? "sky_indigo" : "sky_black");
  if (e >= 4) return h < 0.5 ? "sky_purple" : "sky_indigo";
  if (e >= -6) return h < 0.55 ? "sky_magenta" : "sky_purple";
  if (e >= -16) return h < 0.4 ? "sky_violet_wool" : "sky_indigo";
  return h < 0.02 ? "sky_star_w" : "sky_black";
}
function skyEnergy(n, e, h) {    // crisp high noon, cyan bands, white sun
  const ang = Math.acos(Math.max(-1, Math.min(1, n.x * SUN.x + n.y * SUN.y + n.z * SUN.z))) * DEG;
  if (ang < 6.5) return "sun_white";
  if (ang < 9) return "sky_white";
  if (e >= 45) return "sky_blue";
  if (e >= 25) return h < (e - 25) / 20 ? "sky_blue" : (h > 0.9 ? "sky_cyan" : "sky_wool");
  if (e >= 8) return h < 0.12 ? "sky_cyan" : "sky_white";
  if (e >= -4) return h < 0.4 ? "sky_cyan" : "sky_white";
  if (e >= -16) return h < 0.5 ? "sky_wool" : "sky_snow";
  return h < 0.3 ? "sky_lgray" : "sky_white";
}

export function skyKey(state, n, dx, dy, dz, arch) {
  const e = Math.asin(Math.max(-1, Math.min(1, n.y))) * DEG;
  const h = hash3(dx, dy, dz, state === "light" ? 7 : 8);
  if (state === "light" && arch === "brawler") return skyBrawler(n, e, h);
  if (state === "light" && arch === "shadow") return skyShadow(n, e, h);
  if (state === "light" && arch === "energy") return skyEnergy(n, e, h);
  if (state === "light") {
    const ang = Math.acos(Math.max(-1, Math.min(1, n.x * SUN.x + n.y * SUN.y + n.z * SUN.z))) * DEG;
    if (ang < 6.5) return "sun_core";
    if (ang < 9.0) return "sun_halo";
    if (e >= 52) return "sky_blue";
    if (e >= 34) return h < (e - 34) / 18 ? "sky_blue" : "sky_white";
    if (e >= 14) return h < 0.1 ? "sky_wool" : "sky_white";
    if (e >= 4) return h < (14 - e) / 10 ? "sky_yellow" : "sky_white";
    if (e >= -4) return e < 0 && h < 0.3 ? "sky_orange" : "sky_yellow";
    if (e >= -16) return e > -9 && h < 0.18 ? "sky_pink" : h < 0.5 ? "sky_wool" : "sky_snow";
    return h < 0.3 ? "sky_lgray" : "sky_white";
  }
  const ang = Math.acos(Math.max(-1, Math.min(1, n.x * MOON.x + n.y * MOON.y + n.z * MOON.z))) * DEG;
  if (ang < 5.5) return "moon_core";
  if (ang < 7.5) return "moon_rim";
  if (e >= 30) return h < 0.012 ? "sky_star" : "sky_black";
  if (e >= 10) { const f = Math.pow((30 - e) / 20, 2); return h < f ? "sky_red" : (h > 0.988 ? "sky_star" : "sky_black"); }
  if (e >= -3) return h < 0.15 ? "sky_hyphae" : "sky_red";
  if (e >= -12) return h < (e + 12) / 9 ? "sky_red" : "sky_black";
  return h < 0.02 ? "sky_ember" : "sky_black";
}

// Generator so the game can spread the work over several ticks (system.runJob).
export function* domeGen(ops, R = SKY_R, arch) {
  const lim = Math.ceil(R + 1);
  const lo2 = (R - 1) * (R - 1), hi2 = (R + 0.5) * (R + 0.5);
  for (let dx = -lim; dx <= lim; dx++) {
    for (let dz = -lim; dz <= lim; dz++) {
      const h2 = dx * dx + dz * dz;
      if (h2 >= hi2) continue;
      const yMax = Math.floor(Math.sqrt(hi2 - h2 - 1e-9));
      const yMinAbs = h2 >= lo2 ? 0 : Math.ceil(Math.sqrt(lo2 - h2));
      for (let dy = -yMax; dy <= yMax; dy++) {
        if (Math.abs(dy) < yMinAbs) continue;
        const d = Math.sqrt(h2 + dy * dy);
        if (d < R - 1 || d >= R + 0.5) continue;
        const n = { x: dx / d, y: dy / d, z: dz / d };
        ops.push([dx, dy, dz, skyKey("light", n, dx, dy, dz, arch), skyKey("dread", n, dx, dy, dz, arch)]);
      }
    }
    yield;
  }
  const seen = new Set();
  const N = 700, golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, rr = Math.sqrt(1 - y * y), th = golden * i;
    const px = Math.round(Math.cos(th) * rr * (R - 2.5)), py = Math.round(y * (R - 2.5)), pz = Math.round(Math.sin(th) * rr * (R - 2.5));
    const k = `${px},${py},${pz}`;
    if (seen.has(k)) continue;
    seen.add(k);
    ops.push([px, py, pz, "light15", "light7"]);
  }
  ops.sort((a, b) => b[1] - a[1]);
}
export function planDome(R = SKY_R, arch) {
  const ops = [];
  for (const _ of domeGen(ops, R, arch)) { }
  return ops;
}

// ---------------------------------------------------------------------------------------------
// PEDESTAL HALL
// ---------------------------------------------------------------------------------------------
export const PEDESTALS = [
  { arch: "brawler", x: -3, z: -4 },
  { arch: "energy", x: 0, z: -5 },
  { arch: "shadow", x: 3, z: -4 },
];
export const HALL_MARKS = {
  start: { x: 0.5, y: 1, z: 5.5 },
  manifest: { x: 0.5, y: 1.2, z: -9.5 },
  afterPick: { x: 0.5, y: 1, z: -0.5 },
};

export function planHall() {
  const ops = [];
  const R = HALL_R, lim = R + 1;
  for (let dx = -lim; dx <= lim; dx++) for (let dy = -lim; dy <= lim; dy++) for (let dz = -lim; dz <= lim; dz++) {
    const d = Math.hypot(dx, dy, dz);
    if (d < R - 1 || d >= R + 0.5) continue;
    const k = hash3(dx, dy, dz, 2) < 0.01 ? "crying" : "sky_black";
    ops.push([dx, dy, dz, k, k]);
  }
  for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) {
    const r = Math.hypot(dx, dz);
    if (r > 7.6) continue;
    let k = r > 6 ? "pdeep" : "pbs";
    for (const p of PEDESTALS) {
      const L = Math.hypot(p.x, p.z);
      const t = (dx * p.x + dz * p.z) / (L * L);
      if (t > 0.15 && t < 0.85 && Math.hypot(dx - p.x * t, dz - p.z * t) < 0.5) k = "crying";
    }
    ops.push([dx, 0, dz, k, k]);
    ops.push([dx, -1, dz, "blackstone", "blackstone"]);
    if (r < 5) ops.push([dx, -2, dz, "blackstone", "blackstone"]);
  }
  for (const p of PEDESTALS) {
    ops.push([p.x, 1, p.z, "pbs_bricks", "pbs_bricks"]);
    ops.push([p.x, 3, p.z + 1, "light7", "light7"]);
  }
  return ops;
}

// ---------------------------------------------------------------------------------------------
// TRAINING FIELD: a flat grassland where the Move Forge shows your move from a distance
// (one per hero, 160 blocks south of their Inner World, outside the sky dome)
// ---------------------------------------------------------------------------------------------
export const STAGE_OFFSET = { x: 0, y: 0, z: 160 };
export const STAGE_R = 30;
export function stageCenter(slot) {
  const c = slotCenter(slot);
  return { x: c.x + STAGE_OFFSET.x, y: c.y + STAGE_OFFSET.y, z: c.z + STAGE_OFFSET.z };
}
// Marks (offsets from the stage center). The move travels along -x, the camera watches from -z.
export const STAGE_MARKS = {
  caster: { x: 6.5, y: 1, z: 0.5 },
  dummyX: (range) => 6.5 - range,     // dummy x for a given distance from the caster
  cam: { x: -6.5, y: 5.5, z: -12.5 },
  look: { x: -6.5, y: 1.6, z: 0.5 },
};
export function planStage() {
  const ops = [];
  const R = STAGE_R;
  const flowers = ["tuft", "tuft", "tuft", "tuft", "poppy", "dandelion", "azure", "oxeye", "cornflower"];
  for (let x = -R - 1; x <= R + 1; x++) for (let z = -R - 1; z <= R + 1; z++) {
    const r = Math.hypot(x, z);
    const edge = R + 1.2 * Math.sin(Math.atan2(z, x) * 5) + 0.8 * Math.sin(Math.atan2(z, x) * 9 + 1);
    if (r > edge) continue;
    ops.push([x, 0, z, "grass", "grass"]);
    ops.push([x, -1, z, "dirt", "dirt"]);
    if (r < edge - 3) ops.push([x, -2, z, hash2(x, z, 4) < 0.5 ? "stone" : "dirt", hash2(x, z, 4) < 0.5 ? "stone" : "dirt"]);
    // keep the lane where the move happens clean
    const lane = Math.abs(z) <= 2 && x > -6 && x < 9;
    if (!lane && r < edge - 1 && hash2(x, z, 61) < 0.16) {
      const f = flowers[Math.floor(hash2(x, z, 62) * flowers.length)];
      ops.push([x, 1, z, f, f]);
    }
  }
  // a few trees behind the action for scale
  for (const [tx, tz] of [[-16, 14], [-4, 19], [10, 16], [20, 9], [-22, 4]]) {
    const h = 4 + Math.floor(hash2(tx, tz, 5) * 2);
    for (let y = 1; y <= h; y++) ops.push([tx, y, tz, "oak_log", "oak_log"]);
    for (let lx = -2; lx <= 2; lx++) for (let ly = h - 1; ly <= h + 2; ly++) for (let lz = -2; lz <= 2; lz++) {
      const d = Math.hypot(lx, (ly - h) * 1.2, lz);
      if (d > 2.6 || (lx === 0 && lz === 0 && ly <= h)) continue;
      if (hash3(lx + tx, ly, lz + tz, 3) < 0.1 && d > 2) continue;
      ops.push([tx + lx, ly, tz + lz, "oak_leaves", "oak_leaves"]);
    }
  }
  // light so it reads as daytime even at night
  for (let x = -R; x <= R; x += 6) for (let z = -R; z <= R; z += 6) {
    if (Math.hypot(x, z) < R - 2) ops.push([x, 6, z, "light15", "light15"]);
  }
  return ops;
}

// ---------------------------------------------------------------------------------------------
// THE STATIC: a flat grayscale void. Caster + victim share one arena per fight.
// ---------------------------------------------------------------------------------------------
export const STATIC_Y = 100;
export const STATIC_SPACING = 1024;
export function staticCenter(slot) {
  return { x: slot * STATIC_SPACING, y: STATIC_Y, z: 4096 };
}
const stHash = (x, z, s) => hash2(x, z, s);
export function staticGround(x, z) {
  const h = stHash(x, z, 91);
  return h < 0.42 ? "st_black" : h < 0.6 ? "st_gray" : h < 0.8 ? "st_lgray" : "st_white";
}
export function hasTree(cx, cz) { return stHash(cx, cz, 77) < 0.012; }
export function planStaticTile(ox, oz, R = 40) {
  const ops = [];
  const G = ["glitch1", "glitch2", "glitch3", "glitch4", "glitch5"];
  for (let x = ox - R; x <= ox + R; x++) for (let z = oz - R; z <= oz + R; z++) {
    ops.push([x, 0, z, staticGround(x, z), staticGround(x, z)]);
    ops.push([x, -1, z, "st_black", "st_black"]);
  }
  for (let x = ox - R; x <= ox + R; x += 1) for (let z = oz - R; z <= oz + R; z += 1) {
    if (stHash(x, z, 55) < 0.0016) {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (Math.hypot(dx, dz) > 1.4) continue;
        ops.push([x + dx, 0, z + dz, "blue_pool", "blue_pool"]);
        ops.push([x + dx, -1, z + dz, "blue_rim", "blue_rim"]);
      }
    }
  }
  for (let cx = Math.floor((ox - R) / 16); cx <= Math.ceil((ox + R) / 16); cx++)
    for (let cz = Math.floor((oz - R) / 16); cz <= Math.ceil((oz + R) / 16); cz++) {
      if (!hasTree(cx, cz)) continue;
      const tx = cx * 16 + Math.floor(stHash(cx, cz, 3) * 12) + 2;
      const tz = cz * 16 + Math.floor(stHash(cx, cz, 4) * 12) + 2;
      if (tx < ox - R || tx > ox + R || tz < oz - R || tz > oz + R) continue;
      const hgt = 4 + Math.floor(stHash(cx, cz, 5) * 4);
      for (let y = 1; y <= hgt; y++) ops.push([tx, y, tz, "glitch_log", "glitch_log"]);
      for (let lx = -2; lx <= 2; lx++) for (let ly = hgt - 1; ly <= hgt + 3; ly++) for (let lz = -2; lz <= 2; lz++) {
        const d = Math.hypot(lx, (ly - hgt - 1) * 1.1, lz);
        if (d > 2.7) continue;
        if (stHash(tx + lx, ly * 7 + lz, 9) < 0.35) continue;
        ops.push([tx + lx, ly, tz + lz, G[Math.floor(stHash(tx + lx, tz + lz, ly) * G.length)], "glitch1"]);
      }
    }
  return ops;
}

export function planAll(arch = "brawler") {
  return { islands: planIslands(arch), dome: planDome(SKY_R, arch), hall: planHall() };
}
