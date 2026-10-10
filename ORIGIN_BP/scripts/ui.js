// ORIGIN v0.04 - ui.js
// The Hero Codex (themed menus). Suits and moves are edited at their stations now.
import { system } from "@minecraft/server";
import { hero, RT, markDirty, ARCH, POWER_BUDGET, moveStats, moveRecipe, maxEnergy } from "./data.js";
import { psound } from "./util.js";
import { oform, show, ICONS } from "./forms.js";
import { setActive } from "./moves.js";
import { describeMove } from "./moveforge.js";
import { equipSuit, removeSuit, wearingSuit, suitOf, styleOf, colorName, PART_KEYS, SUIT } from "./suit.js";
import { inIW, enter, wake } from "./innerworld.js";
import { spar } from "./spar.js";
import { POWERS, openPowerMenu } from "./powers.js";
import { questStage, SHARDS_NEEDED } from "./quest.js";
import { countItem, ITEMS } from "./kit.js";
import { villainSetting, nemesisInfo } from "./villain.js";
import { trialsPage, trialReady } from "./ascend.js";
import { MODULES, prostheticInfo, removeModule } from "./dismember.js";
import { STAGES, stageOf } from "./data.js";

function moveLine(m) {
  const st = moveStats(m);
  return `${moveRecipe(m)} · ${st.cost} EN · ${(st.cd / 20).toFixed(1)}s`;
}

export async function openCodex(player) {
  const h = hero(player);
  if (!h.awakened) {
    const f = oform("menu", "Hero Codex", "§7The pages are blank.\n\nSomething has to wake up first. Use the §fHumming Shard§7 (or ask an operator to run §f/hero awaken§7).");
    f.button("Close", `${ICONS}act_back`);
    await show(player, f);
    return;
  }
  const A = ARCH[h.arch];
  const m = h.moves[h.active];
  const here = inIW(player);
  const body = [
    `${A.col}§l${A.name.toUpperCase()}§r §8- ${A.mechanic}`,
    `§bEnergy §f${Math.floor(h.energy)}/${maxEnergy(h)}   §cDread §f${Math.floor(h.dread)}/100`,
    `§7Active move: §e${m.name} §8(${moveRecipe(m)})`,
    POWERS[h.power] ? `§7Power: ${POWERS[h.power].icon}${POWERS[h.power].name}` : "",
  ].join("\n");
  const f = oform("menu", "Hero Codex", body);
  const acts = [];
  const b = (t, icon, a) => { f.button(t, ICONS + icon); acts.push(a); };
  if (POWERS[h.power]) b(`Your Power: ${POWERS[h.power].name}\n§8What it does · cooldowns`, `arch_${h.arch}`, "power");
  b("Set Active Move\n§8Which move the Focus casts", "active", "active");
  b("Your Moves\n§8Rebuild them at a Move Forge", "moves", "moves");
  b(`Suit\n§8${wearingSuit(player) ? "Wearing it" : "In storage"} · edit at a Suit Forge`, "suit", "suit");
  if (here) {
    b("Wake Up\n§8Back to the world", "wake", "wake");
    b("Spar\n§8Summon a Rift Brute in the arena", "spar", "spar");
  } else b("Meditate\n§8Enter your Inner World", "meditate", "meditate");
  b(`Stage · ${STAGES[stageOf(h)].name}\n§8Resolve ${h.resolve ?? 0}${STAGES[stageOf(h) + 1] ? "/" + STAGES[stageOf(h) + 1].resolve : " · Apex"}`, "meditate", "trials");
  if (prostheticInfo(h).sides.length) b(`Prosthetic Arm\n§8${prostheticInfo(h).mods.length}/3 modules · active: ${prostheticInfo(h).active ? MODULES[prostheticInfo(h).active].name : "-"}`, "act_suitup", "prosthetic");
  b("Quests & Villains\n§8Signal Lost · villains defeated", "talk_rate", "quests");
  b("Status & How to Play", "status", "status");
  b(`HUD: ${h.hud === "vanilla" ? "Vanilla" : "Corner"}\n§8Tap to switch`, "hud", "hud");
  b(`Menus: ${h.ui === "vanilla" ? "Plain" : "Custom"}\n§8Plain = normal Minecraft menus`, "status", "ui");
  const r = await show(player, f);
  if (!r || r.canceled || r.selection === undefined) return;
  psound(player, "item.book.page_turn", 1, 0.7);
  switch (acts[r.selection]) {
    case "active": return pickActive(player);
    case "moves": return moveList(player);
    case "suit": return suitMenu(player);
    case "meditate": return system.run(() => enter(player));
    case "wake": return system.run(() => wake(player));
    case "spar": return spar(player);
    case "status": return status(player);
    case "power": return openPowerMenu(player);
    case "quests": return quests(player);
    case "trials": return trialsPage(player);
    case "prosthetic": return prostheticPage(player);
    case "ui":
      h.ui = h.ui === "vanilla" ? "custom" : "vanilla";
      markDirty(player);
      return openCodex(player);
    case "hud":
      h.hud = h.hud === "vanilla" ? "corner" : "vanilla";
      RT(player).hudReset = true;
      markDirty(player);
      return openCodex(player);
  }
}

export async function pickActive(player) {
  const h = hero(player);
  const f = oform("menu", "Active Move", "§7The Power Focus casts your active move.\n§8Tip: sneak + use the Focus to cycle.");
  h.moves.forEach((m, i) => f.button(`${i === h.active ? "» " : ""}${m.name}\n§8${moveLine(m)}`, `${ICONS}form_${m.form}`));
  const r = await show(player, f);
  if (!r || r.canceled || r.selection === undefined) return;
  setActive(player, r.selection);
  psound(player, "random.click", 1.3, 0.6);
}

export async function moveList(player) {
  const h = hero(player);
  const body = h.moves.map((m, i) => `§e${i + 1}. ${describeMove(m)}\n§8   Power ${moveStats(m).power}/${POWER_BUDGET}`).join("\n\n") +
    "\n\n§7To rebuild a move, use a §dMove Forge§7: there's one on the workshop isle in your Inner World, or craft one\n§8(amethyst shard / gold ingots / obsidian).";
  const f = oform("menu", "Your Moves", body);
  f.button("Back", `${ICONS}act_back`);
  const r = await show(player, f);
  if (r && !r.canceled) return openCodex(player);
}

async function suitMenu(player) {
  const su = suitOf(hero(player));
  const body = PART_KEYS.map((k) => `§f${SUIT[k].label}: §7${styleOf(k, su[k].style).name}, ${colorName(su[k].color)}`).join("\n") +
    "\n\n§7Design your suit at a §cSuit Forge§7: on the workshop isle in your Inner World, or craft one\n§8(white wool / leather / crafting table / iron ingots).";
  const f = oform("menu", "Suit", body);
  const on = wearingSuit(player);
  f.button(on ? "Take Suit Off" : "Suit Up", `${ICONS}${on ? "act_takeoff" : "act_suitup"}`);
  f.button("Back", `${ICONS}act_back`);
  const r = await show(player, f);
  if (!r || r.canceled || r.selection === undefined) return;
  if (r.selection === 0) {
    if (on) removeSuit(player); else equipSuit(player);
    psound(player, "armor.equip_leather", 1, 0.8);
    return;
  }
  return openCodex(player);
}

export async function status(player) {
  const h = hero(player);
  const A = ARCH[h.arch];
  const lf = h.stats.lastFight;
  const body = [
    `${A.col}§l${A.name.toUpperCase()}§r §8(origin) · ${A.mechanic}`,
    `§7${A.explain}`,
    POWERS[h.power] ? `§fPower: ${POWERS[h.power].icon}${POWERS[h.power].name}§7 - Power Core: use = power, sneak + use = Power menu.` : "",
    "",
    `§fEnergy §b${Math.floor(h.energy)}/${maxEnergy(h)}§7 (regen ${A.regen}/s, faster out of combat)`,
    `§fDread §c${Math.floor(h.dread)}/100§7: rises when you fight (more with Void), fades after 8s of calm.`,
    "§7- At 50+ Dread your Inner World sky turns red. At 70+ the world goes hazy and you hear your heart.",
    "",
    "§fControls",
    "§7- Power Focus: use = cast, sneak + use = next move.",
    "§7- §fDouble-tap sneak§7 = dodge. Dodge right as a hit lands for a §bPerfect Dodge§7 (+15 Energy).",
    "§7- Suit Forge / Move Forge: tap the block to use it.",
    "",
    "§fThe Rift Brute learns",
    "§7- Same Form 3 times in a row: it §eREADS§7 it (guards, counters). Use two different Forms to break the read.",
    "§7- Dodge the same way twice: it predicts you (bigger slams, 360 stomps).",
    "§7- Stay far away: it throws rocks. Punish it 3 times: it gets a second hit.",
    "§7- Hit it while it recovers (gold sparks) for §6x1.5 PUNISH§7.",
    "",
    "§fVillains",
    "§7- Powered villains hunt awakened heroes (more at night). Every power attack has a tell: watch for it, then move or double-tap sneak.",
    "",
    `§8Kills ${h.stats.kills}  Villains ${h.stats.villains ?? 0}  Hits ${h.stats.hits}  Casts ${h.stats.casts}${lf ? "  Last fight: " + lf.hits + " hits" : ""}`,
  ].join("\n");
  const f = oform("menu", "Status", body);
  f.button("Back", `${ICONS}act_back`);
  const r = await show(player, f);
  if (r && !r.canceled) return openCodex(player);
}

const SIGNAL = [
  "§7Not started. §8Defeat Rift Brutes or villains: something in them is broadcasting.",
  "§fCollect Static Shards§7 from Rift Brutes (22%) and villains (40%).",
  "§fYou have enough.§7 Use the Detuned Receiver out in the open.",
  "§fNULL is out there.§7 Beat it.",
  "§aComplete.§7 The Static Remote is yours: look at someone and use it to drag them into the Static.",
];
export async function quests(player) {
  const h = hero(player);
  const st = questStage(player);
  const shards = countItem(player, ITEMS.staticShard);
  const body = [
    "§f§lSIGNAL LOST",
    SIGNAL[Math.min(st, 4)],
    st >= 1 && st < 4 ? `§7Static Shards: §f${shards}/${SHARDS_NEEDED}` : "",
    "",
    "§c§lVILLAINS",
    `§7Defeated: §f${h.stats.villains ?? 0}`,
    nemesisInfo(player),
    `§7They appear: §f${villainSetting()} §8(an operator can change it: /hero villains off|rare|normal|often)`,
    "§7They use the same powers you can get. Each attack has a tell:",
    "§8- Stretch: tan sparks, then a long punch that yanks you in",
    "§8- Flight: a ring follows you, turns red, then they dive. Leave the ring",
    "§8- Blast: glowing red eyes, then a slow beam. Strafe or hide",
    "§8- Sentry: a purple ring closes in, then the Void. Break line of sight",
    "§8- Shadow Step / Shade Form: smoke behind you, or nothing at all...",
    "§8- Tendrils: a purple ring on the ground. Get out of it",
  ].filter((x) => x !== "").join("\n");
  const f = oform("menu", "Quests & Villains", body);
  f.button("Back", `${ICONS}act_back`);
  const r = await show(player, f);
  if (r && !r.canceled) return openCodex(player);
}

export async function prostheticPage(player) {
  const h = hero(player);
  const I = prostheticInfo(h);
  const f = oform("menu", "Prosthetic Arm", [
    `§bExo Prosthetic §7(${I.sides.map((s) => (s === "r" ? "right" : "left")).join(" + ")} arm) · modules §f${I.mods.length}/3`,
    "§7Install modules by using them. Active modules fire with §fsneak + punch the air§7 (empty hand).",
    "",
    ...Object.entries(MODULES).map(([k, m]) => `${I.mods.includes(k) ? "§a■" : "§8□"} §f${m.name}§7${m.active ? " (active)" : " (passive)"}`),
  ].join("\n"));
  const acts = [];
  for (const k of I.mods) {
    if (MODULES[k].active && I.active !== k) { f.button(`Use ${MODULES[k].name}\n§8make it the sneak + punch module`, `${ICONS}active`); acts.push(["use", k]); }
  }
  for (const k of I.mods) { f.button(`Remove ${MODULES[k].name}\n§8back to your bag`, `${ICONS}act_back`); acts.push(["rm", k]); }
  f.button("Back", `${ICONS}act_back`); acts.push(["back"]);
  const res = await show(player, f);
  if (!res || res.canceled) return;
  const a = acts[res.selection];
  if (!a || a[0] === "back") return openCodex(player);
  if (a[0] === "use") { h.limbs.activeMod = a[1]; markDirty(player); }
  if (a[0] === "rm") removeModule(player, a[1]);
  return prostheticPage(player);
}
