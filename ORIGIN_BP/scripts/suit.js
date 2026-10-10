// ORIGIN v0.23 - suit.js
// Four dyeable pieces, each with its own color and (for mask/torso/legs) a style.
// Every style is its own item so it can carry its own armor texture.
import { system, ItemStack, EquipmentSlot } from "@minecraft/server";
import { hero, markDirty } from "./data.js";
import { hexToRgb } from "./util.js";

export const PALETTE = [
  ["Crimson", "#C8262C"], ["Scarlet", "#E2483D"], ["Ember", "#F07A21"], ["Gold", "#F2C230"],
  ["Lime", "#7BC043"], ["Emerald", "#1F9E5A"], ["Teal", "#1AA6A6"], ["Cyan", "#3CC8F0"],
  ["Azure", "#2F6FDE"], ["Indigo", "#3A3FA8"], ["Violet", "#7A3FBF"], ["Magenta", "#C13FA8"],
  ["White", "#EDEDED"], ["Silver", "#A9AFB8"], ["Charcoal", "#3A3D44"], ["Black", "#17171B"],
];

export const SUIT = {
  mask: {
    slot: EquipmentSlot.Head, label: "Mask",
    styles: [
      { key: "lenses", name: "Lenses", id: "origin:suit_mask" },
      { key: "visor", name: "Visor", id: "origin:suit_mask_visor" },
      { key: "half", name: "Half", id: "origin:suit_mask_half" },
      { key: "horned", name: "Horned", id: "origin:suit_mask_horned" },
      { key: "hood", name: "Hood", id: "origin:suit_mask_hood" },
      { key: "crown", name: "Crown", id: "origin:suit_mask_crown" },
      { key: "vanguard", name: "Vanguard", id: "origin:suit_mask_vanguard" },
      { key: "winged", name: "Winged Helm", id: "origin:suit_mask_winged" },
      { key: "goggles", name: "Goggles", id: "origin:suit_mask_goggles" },
    ],
  },
  torso: {
    slot: EquipmentSlot.Chest, label: "Torso",
    styles: [
      { key: "diamond", name: "Diamond", id: "origin:suit_torso" },
      { key: "star", name: "Star", id: "origin:suit_torso_star" },
      { key: "bolt", name: "Bolt", id: "origin:suit_torso_bolt" },
      { key: "plain", name: "Plain", id: "origin:suit_torso_plain" },
      { key: "armored", name: "Armored", id: "origin:suit_torso_armored" },
      { key: "coat", name: "Long Coat", id: "origin:suit_torso_coat" },
      { key: "caped", name: "Caped", id: "origin:suit_torso_caped" },
      { key: "core", name: "Core", id: "origin:suit_torso_core" },
      { key: "vanguard", name: "Vanguard", id: "origin:suit_torso_vanguard" },
      { key: "infiltrator", name: "Infiltrator", id: "origin:suit_torso_infiltrator" },
      { key: "asgard", name: "Asgardian", id: "origin:suit_torso_asgard" },
    ],
  },
  legs: {
    slot: EquipmentSlot.Legs, label: "Legs",
    styles: [
      { key: "plain", name: "Plain", id: "origin:suit_legs" },
      { key: "stripe", name: "Stripe", id: "origin:suit_legs_stripe" },
      { key: "armored", name: "Armored", id: "origin:suit_legs_armored" },
      { key: "wraps", name: "Wraps", id: "origin:suit_legs_wraps" },
      { key: "tactical", name: "Tactical", id: "origin:suit_legs_tactical" },
      { key: "utility", name: "Utility", id: "origin:suit_legs_utility" },
    ],
  },
  boots: {
    slot: EquipmentSlot.Feet, label: "Boots",
    styles: [
      { key: "plain", name: "Boots", id: "origin:suit_boots" },
      { key: "jet", name: "Jet", id: "origin:suit_boots_jet" },
      { key: "greaves", name: "Greaves", id: "origin:suit_boots_greaves" },
      { key: "wrapped", name: "Wrapped", id: "origin:suit_boots_wrapped" },
      { key: "combat", name: "Combat", id: "origin:suit_boots_combat" },
    ],
  },
};
export const PART_KEYS = ["mask", "torso", "legs", "boots"];

export const PRESETS = [
  { name: "Classic Spandex", mask: ["lenses", "#F2C230"], torso: ["diamond", "#C8262C"], legs: ["plain", "#2F6FDE"], boots: ["plain", "#C8262C"] },
  { name: "Dark Vigilante", mask: ["lenses", "#17171B"], torso: ["bolt", "#3A3D44"], legs: ["plain", "#17171B"], boots: ["plain", "#17171B"] },
  { name: "Cosmic Guardian", mask: ["visor", "#3CC8F0"], torso: ["star", "#3A3FA8"], legs: ["stripe", "#EDEDED"], boots: ["plain", "#3A3FA8"] },
  { name: "Street Level", mask: ["half", "#EDEDED"], torso: ["plain", "#F07A21"], legs: ["stripe", "#3A3D44"], boots: ["plain", "#EDEDED"] },
  { name: "Edgy Anti-Hero", mask: ["half", "#17171B"], torso: ["bolt", "#17171B"], legs: ["stripe", "#C8262C"], boots: ["plain", "#C8262C"] },
  { name: "Vanguard", mask: ["vanguard", "#3A3FA8"], torso: ["vanguard", "#2F6FDE"], legs: ["utility", "#3A3FA8"], boots: ["combat", "#C8262C"] },
  { name: "Infiltrator", mask: ["goggles", "#17171B"], torso: ["infiltrator", "#17171B"], legs: ["utility", "#17171B"], boots: ["combat", "#17171B"] },
  { name: "Thunder God", mask: ["winged", "#A9AFB8"], torso: ["asgard", "#3A3D44"], legs: ["armored", "#3A3D44"], boots: ["greaves", "#A9AFB8"] },
];

export const ALL_SUIT_IDS = PART_KEYS.flatMap((k) => SUIT[k].styles.map((s) => s.id));

// Upgrade v0.01 color-only data into per-part suit data
export function suitOf(h) {
  if (!h.suit) {
    const c = h.colors ?? {};
    h.suit = {
      mask: { style: "lenses", color: c.accent ?? "#F2C230" },
      torso: { style: "diamond", color: c.primary ?? "#C8262C" },
      legs: { style: "plain", color: c.secondary ?? "#2F6FDE" },
      boots: { style: "plain", color: c.secondary ?? "#2F6FDE" },
    };
  }
  return h.suit;
}

export function styleOf(part, key) {
  return SUIT[part].styles.find((s) => s.key === key) ?? SUIT[part].styles[0];
}

export function nearestPalette(hex) {
  const c = hexToRgb(hex);
  let best = 0, bd = 1e9;
  PALETTE.forEach(([, h], i) => {
    const p = hexToRgb(h);
    const d = (p.red - c.red) ** 2 + (p.green - c.green) ** 2 + (p.blue - c.blue) ** 2;
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}
export function colorName(hex) {
  const p = PALETTE.find(([, h]) => h.toUpperCase() === String(hex).toUpperCase());
  return p ? p[0] : "Custom";
}

export function makePiece(part, styleKey, hex) {
  const s = new ItemStack(styleOf(part, styleKey).id, 1);
  try {
    const d = s.getComponent("minecraft:dyeable");
    if (d) d.color = hexToRgb(hex);
  } catch (e) { console.warn("[ORIGIN] dye failed: " + e); }
  s.keepOnDeath = true;
  return s;
}

export function equipSuit(player, parts = PART_KEYS) {
  const su = suitOf(hero(player));
  let eq, inv;
  try {
    eq = player.getComponent("minecraft:equippable");
    inv = player.getComponent("minecraft:inventory")?.container;
  } catch { return false; }
  if (!eq) return false;
  for (const part of parts) {
    const P = SUIT[part];
    try {
      const cur = eq.getEquipment(P.slot);
      if (cur && !cur.typeId.startsWith("origin:suit_")) {
        // never delete the player's real armor: move it to the inventory (or drop it)
        const left = inv ? inv.addItem(cur) : cur;
        if (left) player.dimension.spawnItem(left, player.location);
      }
      eq.setEquipment(P.slot, makePiece(part, su[part].style, su[part].color));
    } catch (e) { console.warn("[ORIGIN] equip failed: " + e); }
  }
  return true;
}

export function removeSuit(player) {
  try {
    const eq = player.getComponent("minecraft:equippable");
    for (const part of PART_KEYS) {
      const cur = eq.getEquipment(SUIT[part].slot);
      if (cur && cur.typeId.startsWith("origin:suit_")) eq.setEquipment(SUIT[part].slot, undefined);
    }
  } catch { }
}

export function wearingSuit(player) {
  try {
    const eq = player.getComponent("minecraft:equippable");
    return PART_KEYS.some((p) => eq.getEquipment(SUIT[p].slot)?.typeId?.startsWith("origin:suit_"));
  } catch { return false; }
}

export function applyPreset(player, preset) {
  const h = hero(player);
  const su = suitOf(h);
  for (const part of PART_KEYS) su[part] = { style: preset[part][0], color: preset[part][1] };
  markDirty(player);
}

export function setPart(player, part, patch) {
  const su = suitOf(hero(player));
  su[part] = { ...su[part], ...patch };
  markDirty(player);
}
