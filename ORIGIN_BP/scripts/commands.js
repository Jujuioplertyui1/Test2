import { ItemStack as ItemStack3 } from "@minecraft/server";
// ORIGIN v0.04 - commands.js
// /hero <action> [value]   (also available as /origin:hero)
import { system, world, CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus } from "@minecraft/server";
import { hero, RT, markDirty, saveNow, resetHero, maxEnergy, ARCH } from "./data.js";
import { resetSpace } from "./space.js";
import { enterSpeedForce } from "./speedforce.js";
import { at, msg, valid, forwardFromYaw } from "./util.js";
import { startAwakening } from "./awakening.js";
import { setDread } from "./dread.js";
import { enter, wake, setSky, isBuilt, buildIW, resetWorldFlags, inIW, skyState, holdWhile, arrivalLoc, anchorFace, slotOf, centerOf } from "./innerworld.js";
import { spawnBrute } from "./enemy.js";
import { openCodex, moveList } from "./ui.js";
import { giveItem, giveKit, giveStations, ITEMS } from "./kit.js";
import { removeSuit, equipSuit, suitOf, PART_KEYS, makePiece } from "./suit.js";
import { openSuitForge } from "./suitforge.js";
import { openMoveForge } from "./moveforge.js";
import { POWERS, POWER_KEYS, rollPower, openPowerMenu } from "./powers.js";
import { EGO_MODES, takeover, bond } from "./ego.js";
import { spawnVillain, VPOWERS, villainSetting, setVillainSetting, nemesisInfo, spawnNemesis } from "./villain.js";
import { pullIn, pullOut, inStatic } from "./static.js";
import { questStage } from "./quest.js";
import { startTrial } from "./ascend.js";
import { goreSetting, setGore, tryCut } from "./dismember.js";
import { STAGES } from "./data.js";
import { meteor, EXO, INTERFACE, exoData, BLUEPRINTS, BP_KEYS, makePiece as makeExoPiece, paintFor, SLOT_KEYS, MARKS } from "./exo.js";
import { STONES, STONE_KEYS, GAUNTLET, fullGauntlet } from "./stones.js";
import { openWorkshop } from "./workshop.js";
import { askAI, aiHelp, AI_PRESETS } from "./jarvis.js";
import { summonXoX } from "./xox.js";
import { setDestruction, destructionOn } from "./impact.js";
import { resetAsgard } from "./asgard.js";
import { giveMjolnir, honorOf, worthy } from "./mjolnir.js";

const ACTIONS = ["help", "awaken", "dread", "energy", "sky", "enter", "wake", "spawn", "info", "codex", "moves", "suit", "forge", "hud", "ui", "give", "reset", "rebuild",
  "power", "ego", "villain", "villains", "static", "quest", "exo", "meteor", "other", "nemesis", "stage", "resolve", "surge", "trial", "signet", "gore", "sever", "katana", "serum", "prosthetic", "armfix", "stones", "gauntlet", "blueprints", "workshop", "overlay", "ai", "mark", "skycatch", "mirror", "xox", "guns", "weapons", "ultimate", "destruction", "bifrost", "asgard", "mjolnir", "honor", "gear", "space", "speedforce", "null", "raid"];

const HELP = [
  "§f§lORIGIN /hero commands",
  "§e/hero awaken §7[quick] - start the awakening (quick = no cinematic)",
  "§e/hero dread §7<0-100> - set your Dread",
  "§e/hero energy §7<n|full> - set your Energy",
  "§e/hero sky §7<light|dread|auto> - force the Inner World sky",
  "§e/hero enter §7/ §e/hero wake §7- go into / out of your Inner World",
  "§e/hero spawn §7[brute|villain] - spawn a Rift Brute (or a villain) in front of you",
  "§e/hero power §7[<power>|reroll] - Power menu, or set/reroll your power (stretch flight blast sentry shadow_step shade_form tendrils)",
  "§e/hero ego §7<friendly|hostile|random> - how your Alter Ego (Sentry) behaves",
  "§e/hero villain §7[<power>] - spawn a villain with that power (random if left out)",
  "§e/hero villains §7<off|rare|normal|often> - how often villains find heroes (whole world)",
  "§e/hero static §7- step into the Static yourself (or back out)",
  "§e/hero quest §7[0-4] - show or set your Signal Lost stage",
  "§e/hero exo §7- (testing) give the full Exo-Frame + Interface",
  "§e/hero meteor §7- (testing) call down a meteor near you",
  "§e/hero other §7- (testing) give a Shard of the Other / let it out if bonded",
  "§e/hero nemesis §7- show your nemesis (or spawn them with /hero nemesis spawn)",
  "§e/hero serum §7· §e/hero prosthetic §7(testing) · §e/hero armfix flip|<n> §7- nudge the robotic arm if it sits wrong",
  "§e/hero gore §7<full|mild|off> - blood and severing (off = arms can never be cut off) · §e/hero katana",
  "§e/hero stage <0-5> §7· §e/hero resolve <n> §7· §e/hero surge §7(testing)",
  "§b/ai <anything> §7- talk to your suit's assistant (also /hey <name> ..., /atlas ...). Try: /ai where's the closest diamonds",
  "§e/hero workshop §7· §e/hero mark §7<mk1-4> (testing) · §e/hero blueprints §7[all] · §e/hero skycatch §7(test a mid-air catch)",
  "§e/hero mirror §7- take the Mirror Hour power · §e/hero stones §7· §e/hero gauntlet §7[full] (testing - stones can't be found yet)",
  "§e/hero overlay §7<full|safe> - if the helmet/NULL overlays don't show, try safe",
  "§e/hero xox §7- summon XoX (or craft a Gravity Seal) · §e/hero guns §7· §e/hero weapons §7· §e/hero ultimate §7(testing)",
  "§e/hero power hellfire §7| web_slinger | telekinesis | pyrokinesis | cryokinesis | blood_manipulation | graviton | super_speed | super_strength | super_durability | regeneration | stretch | flight | titan_grip | blast | sentry | mirror_hour | arc_storm | shadow_step | shade_form | tendrils | umbral_clones · every power has new moves in its Power menu (sneak + use) · §e/hero bifrost §7(Asgard key) · §e/hero destruction §7<on|off>",
  "§e/hero asgard rebuild §7(operators) - rebuild Asgard (it's three times bigger now; Heimdall guards the Bifrost)",
  "§e/hero space §7[rebuild] - launch into space (or re-enter) · §e/hero speedforce §7- straight into the Speed Force · §e/hero null §7- summon NULL here (testing) · §e/hero raid §7- a raid on Asgard (testing)",
  "§e/hero honor §7- how worthy you are (Mjolnir waits in Asgard's palace hall) · §e/hero mjolnir §7· §e/hero gear §7(testing)",
  "§e/hero info §7- print your hero data",
  "§e/hero codex §7| §emoves §7- open menus",
  "§e/hero suit §7| §eforge §7- open the Suit Forge / Move Forge right here (testing)",
  "§e/hero hud §7<corner|vanilla> - corner HUD or the old actionbar HUD",
  "§e/hero ui §7<custom|vanilla> - custom menus or plain Minecraft menus (if a menu looks broken)",
  "§e/hero give §7[kit|suit|shard|stations] - give items",
  "§e/hero reset §7- wipe your hero (asks you to type: /hero reset confirm)",
  "§e/hero rebuild §7- rebuild your Inner World + the hall next time they're needed",
].join("\n");

export function registerCommands() {
  system.beforeEvents.startup.subscribe((ev) => {
    const reg = ev.customCommandRegistry;
    reg.registerEnum("origin:action", ACTIONS);
    reg.registerCommand(
      {
        name: "origin:hero",
        description: "ORIGIN: hero + debug commands (/hero help)",
        permissionLevel: CommandPermissionLevel.Any,
        cheatsRequired: false,
        mandatoryParameters: [{ type: CustomCommandParamType.Enum, name: "origin:action" }],
        optionalParameters: [{ type: CustomCommandParamType.String, name: "value" }],
      },
      (origin, action, value) => {
        const player = origin.sourceEntity;
        if (!player || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "Run /hero as a player." };
        }
        // Command callbacks run in a read-only context: do the work next tick.
        system.run(() => {
          try { run(player, String(action), value === undefined ? "" : String(value).toLowerCase()); }
          catch (e) { msg(player, "§c/hero failed: " + e); }
        });
        return { status: CustomCommandStatus.Success };
      },
    );
    // the assistant: /ai <words>, /hey <name> <words>, /atlas <words> ... (stable scripting can't read plain chat)
    const W = [];
    for (let i = 2; i <= 8; i++) W.push({ type: CustomCommandParamType.String, name: `w${i}` });   // Minecraft allows 8 parameters per command
    const aiCmd = (name, desc, fixed, named) => {
      try {
        reg.registerCommand({
          name: `origin:${name}`, description: desc, permissionLevel: CommandPermissionLevel.Any, cheatsRequired: false,
          mandatoryParameters: named ? [{ type: CustomCommandParamType.String, name: "name" }, { type: CustomCommandParamType.String, name: "w1" }] : [{ type: CustomCommandParamType.String, name: "w1" }],
          optionalParameters: named ? W.slice(0, 6) : W,
        }, (origin, ...args) => {
          const pl = origin.sourceEntity;
          if (!pl || pl.typeId !== "minecraft:player") return { status: CustomCommandStatus.Failure, message: "Players only." };
          const called = named ? String(args.shift()) : fixed;
          const text = args.filter((a) => a !== undefined && a !== null).map(String).join(" ");
          system.run(() => { try { askAI(pl, called, text); } catch (e) { msg(pl, "§c" + e); } });
          return { status: CustomCommandStatus.Success };
        });
      } catch (e) { console.warn(`[ORIGIN] /${name}: ${e}`); }
    };
    aiCmd("ai", "Talk to your suit's assistant, e.g. /ai where's the closest diamonds", null, false);
    aiCmd("hey", "Talk to your assistant by name: /hey <name> <question>", null, true);
    for (const n of AI_PRESETS) aiCmd(n, `Talk to ${n.toUpperCase()} (if that's your assistant's name)`, n, false);
  });
}

const SAFE = new Set(["help", "info", "codex", "moves", "hud", "ui", "overlay", "ai", "honor"]);
function run(player, action, value) {
  if (player && !SAFE.has(action) && (player.playerPermissionLevel ?? 2) < 2) return msg(player, "§7Only operators can use §f/hero " + action + "§7. You can use: §f" + [...SAFE].map((a) => "/hero " + a).join("§7, §f"));
  if (!valid(player)) return;
  const h = hero(player);
  switch (action) {
    case "help":
      msg(player, HELP);
      return;
    case "awaken":
      startAwakening(player, { quick: value === "quick" });
      return;
    case "dread": {
      const n = Number(value);
      if (!value || Number.isNaN(n)) return msg(player, `§7Dread is §c${Math.floor(h.dread)}§7. Usage: /hero dread <0-100>`);
      setDread(player, n);
      return msg(player, `§7Dread set to §c${Math.floor(hero(player).dread)}`);
    }
    case "energy": {
      const max = maxEnergy(h);
      const n = value === "full" || value === "" ? max : Number(value);
      if (Number.isNaN(n)) return msg(player, "§7Usage: /hero energy <n|full>");
      h.energy = Math.max(0, Math.min(max, n));
      markDirty(player);
      return msg(player, `§7Energy set to §b${Math.floor(h.energy)}/${max}`);
    }
    case "sky": {
      if (!["light", "dread", "auto"].includes(value)) return msg(player, `§7Sky is §f${skyState(slotOf(player))}§7 (override: ${h.skyOverride}). Usage: /hero sky <light|dread|auto>`);
      h.skyOverride = value;
      markDirty(player);
      if (value !== "auto") setSky(slotOf(player), value, player);
      return msg(player, value === "auto" ? "§7Sky follows your Dread again (50+ = Dread)." : `§7Sky forced to §f${value}§7.${inIW(player) ? "" : " You'll see it next time you're inside."}`);
    }
    case "enter":
      enter(player);
      return;
    case "wake":
      wake(player);
      return;
    case "spawn": {
      const f = forwardFromYaw(player.getRotation().y);
      if (value === "villain") spawnVillain(player.dimension, at(player.location, f.x * 8, 0, f.z * 8), null, player);
      else spawnBrute(player.dimension, at(player.location, f.x * 6, 0, f.z * 6));
      return;
    }
    case "power": {
      if (!h.awakened) return msg(player, "§7Awaken first.");
      if (value === "") return openPowerMenu(player);
      const key = value === "reroll" ? null : value.replace(/[ -]/g, "_");
      if (key && !POWERS[key]) return msg(player, `§7Powers: ${POWER_KEYS.join(", ")}  §8(or reroll)`);
      RT(player).powerOn = false;
      RT(player).powerCd = 0;
      const k = rollPower(player, key);
      return msg(player, `§7Your power is now ${POWERS[k].icon}${POWERS[k].name}§7.${POWERS[k].arch !== h.arch ? " §8(Not from your origin's pool - testing only.)" : ""}`);
    }
    case "ego": {
      if (!EGO_MODES[value]) return msg(player, `§7Alter Ego is §f${EGO_MODES[h.egoMode]?.name ?? "Random"}§7. Usage: /hero ego <friendly|hostile|random>`);
      h.egoMode = value;
      if (h.ego) h.ego.mode = value;
      markDirty(player);
      return msg(player, `§7The Other set to ${EGO_MODES[value].col}${EGO_MODES[value].name}§7: ${EGO_MODES[value].desc}${!bond(h) ? " §8(Bond with a Shard of the Other first.)" : ""}`);
    }
    case "villain": {
      const key = value.replace(/[ -]/g, "_");
      if (value && !VPOWERS.includes(key)) return msg(player, `§7Villain powers: ${VPOWERS.join(", ")}`);
      const f = forwardFromYaw(player.getRotation().y);
      spawnVillain(player.dimension, at(player.location, f.x * 8, 0, f.z * 8), key || null, player);
      return;
    }
    case "villains": {
      if (!["off", "rare", "normal", "often"].includes(value)) return msg(player, `§7Villains: §f${villainSetting()}§7. Usage: /hero villains <off|rare|normal|often>`);
      setVillainSetting(value);
      return msg(player, `§7Villains set to §f${value}§7.`);
    }
    case "exo":
      for (const id of [...Object.values(EXO), INTERFACE]) giveItem(player, id);
      return msg(player, "§bExo-Frame given. Wear all four pieces.");
    case "meteor": meteor(player); return;
    case "stage": {
      const n = Number(value);
      if (value === "" || Number.isNaN(n)) return msg(player, `§7Stage: §f${STAGES[h.stage ?? 0].name}§7. Usage: /hero stage <0-5>`);
      h.stage = Math.max(0, Math.min(5, Math.floor(n))); markDirty(player);
      return msg(player, `§7Stage set to §f${STAGES[h.stage].name}§7.`);
    }
    case "resolve": h.resolve = Math.max(0, Number(value) || 0); markDirty(player); return msg(player, `§7Resolve: §f${h.resolve}`);
    case "signet": giveItem(player, "origin:lumen_signet"); return msg(player, "§3Lumen Signet given.");
    case "gore":
      if (!["full", "mild", "off"].includes(value)) return msg(player, `§7Gore: §f${goreSetting()}§7. Usage: /hero gore <full|mild|off>  §8(mild = no blood, off = no severing)`);
      setGore(value); return msg(player, `§7Gore set to §f${value}§7.`);
    case "sever": {
      const side = tryCut(player, player, 99, "katana", true, value === "r" || value === "l" ? value : null);
      return msg(player, side ? "§7(testing) Severed." : "§7Nothing left to sever, or gore is off.");
    }
    case "serum": giveItem(player, "origin:super_serum"); return msg(player, "§bSuper Soldier Serum given. Use it - it hurts.");
    case "prosthetic":
      for (const id of ["origin:exo_prosthetic", "origin:mod_cannon", "origin:mod_grapple", "origin:mod_piston", "origin:mod_drill", "origin:mod_shield"]) giveItem(player, id);
      return msg(player, "§7(testing) Prosthetic + all 5 modules given.");
    case "armfix": {
      if (value === "flip") { const f = world.getDynamicProperty("origin:armflip") === 1 ? 0 : 1; world.setDynamicProperty("origin:armflip", f); return msg(player, `§7Prosthetic sides ${f ? "swapped" : "normal"}.`); }
      const n = Number(value);
      if (value === "" || Number.isNaN(n)) return msg(player, "§7Usage: /hero armfix flip  |  /hero armfix <-24..24>  §8(moves the robotic arm up/down if it sits wrong on your device)");
      world.setDynamicProperty("origin:armdy", Math.max(-24, Math.min(24, Math.round(n)))); return msg(player, `§7Prosthetic height offset: ${Math.round(n)}`);
    }
    case "katana": giveItem(player, "origin:katana"); giveItem(player, "origin:bandage"); return msg(player, "§7Katana + Bandage given. Use the Katana for Iaido (a draw-cut dash).");
    case "surge": h.surge = 100; markDirty(player); return msg(player, "§6Surge full. §7Sneak + use the Power Focus.");
    case "trial": return msg(player, "§7Trials are gone: you climb stages automatically as you earn Resolve. §8(/hero resolve <n> to test)");
    case "nemesis": {
      if (value === "spawn") {
        const f = forwardFromYaw(player.getRotation().y);
        if (!spawnNemesis(player, at(player.location, f.x * 8, 0, f.z * 8))) msg(player, "§7You don't have a living nemesis.");
        return;
      }
      return msg(player, nemesisInfo(player));
    }
    case "other":
      if (bond(h) && value === "out") return takeover(player, "chosen");
      giveItem(player, "origin:other_shard");
      return msg(player, "§4A Shard of the Other.§7 Use it to bond. (/hero other out = let it out)");
    case "static":
      if (inStatic(player)) pullOut(player, "exit");
      else pullIn(player, player);
      return;
    case "quest": {
      const n = Number(value);
      if (value === "" || Number.isNaN(n)) return msg(player, `§7Signal Lost stage: §f${questStage(player)}§7/4. Usage: /hero quest <0-4>`);
      h.quest = { ...(h.quest ?? {}), signal: Math.max(0, Math.min(4, Math.floor(n))) };
      markDirty(player);
      if (h.quest.signal >= 1) giveItem(player, ITEMS.receiver);
      if (h.quest.signal >= 4) giveItem(player, ITEMS.remote);
      return msg(player, `§7Signal Lost stage set to §f${h.quest.signal}§7.`);
    }
    case "info": {
      const r = RT(player);
      msg(player, [
        `§fawakened §7${h.awakened}  §farch §7${h.arch ?? "-"}  §factive §7${h.active}`,
        `§fenergy §b${Math.floor(h.energy)}  §fdread §c${Math.floor(h.dread)}  §fslot §7${slotOf(player)}  §fsky §7${skyState(slotOf(player))} (${h.skyOverride})  §fbuilt §7${isBuilt(slotOf(player))}`,
        `§fmoves §7${h.moves.map((m) => m.name).join(", ")}`,
        `§fsuit §7${PART_KEYS.map((k) => suitOf(h)[k].style + " " + suitOf(h)[k].color).join(", ")}  §fmomentum §7${r.momentum}  §fhud §7${h.hud ?? "corner"}`,
        `§fpower §7${h.power ?? "-"}  §fego §7${h.egoMode}  §fquest §7${questStage(player)}  §fvillains §7${h.stats.villains ?? 0} (${villainSetting()})`,
      ].join("\n"));
      return;
    }
    case "codex":
      openCodex(player);
      return;
    case "moves":
      if (!h.awakened) return msg(player, "§7Awaken first.");
      moveList(player);
      return;
    case "suit":
      if (!h.awakened) return msg(player, "§7Awaken first.");
      openSuitForge(player, at(player.location, 0, 0, 2));
      return;
    case "forge":
      if (!h.awakened) return msg(player, "§7Awaken first.");
      openMoveForge(player, at(player.location, 0, 0, 2));
      return;
    case "ui":
      if (!["custom", "vanilla"].includes(value)) return msg(player, `§7Menus are §f${h.ui ?? "custom"}§7. Usage: /hero ui <custom|vanilla>`);
      h.ui = value;
      markDirty(player);
      return msg(player, `§7Menus set to §f${value}§7.`);
    case "hud":
      if (!["corner", "vanilla"].includes(value)) return msg(player, `§7HUD is §f${h.hud ?? "corner"}§7. Usage: /hero hud <corner|vanilla>`);
      h.hud = value;
      RT(player).hudReset = true;
      markDirty(player);
      return msg(player, `§7HUD set to §f${value}§7.`);
    case "give": {
      if (value === "shard") giveItem(player, ITEMS.shard);
      else if (value === "stations") giveStations(player);
      else if (value === "suit") {
        const su = suitOf(h);
        const inv = player.getComponent("minecraft:inventory")?.container;
        for (const k of PART_KEYS) {
          const left = inv?.addItem(makePiece(k, su[k].style, su[k].color));
          if (left) player.dimension.spawnItem(left, player.location);
        }
      }
      else giveKit(player);
      return msg(player, "§7Given.");
    }
    case "reset":
      if (value !== "confirm") return msg(player, "§cThis wipes your hero. Type §f/hero reset confirm§c to do it.");
      removeSuit(player);
      resetHero(player);
      RT(player).cd = [0, 0, 0];
      RT(player).momentum = 0;
      return msg(player, "§7Hero reset. Use §f/hero give shard§7 or §f/hero awaken§7 to start over.");
    case "rebuild": {
      const slot = slotOf(player);
      resetWorldFlags(slot);
      if (inIW(player)) {
        const C0 = centerOf(player);
        msg(player, "§7Rebuilding your Inner World...");
        holdWhile(player, arrivalLoc(C0), buildIW(slot, { arch: h.arch, wipe: true }), anchorFace(C0)).then(() => msg(player, "§7Done."));
      } else msg(player, "§7Your Inner World and the hall will rebuild next time they're needed.");
      return;
    }
    case "stones":
      for (const k of STONE_KEYS) giveItem(player, STONES[k].id);
      giveItem(player, GAUNTLET);
      return msg(player, "§6All six Infinity Stones + a Gauntlet. §7(Testing: the stones can't be found in survival yet.) Hold a stone: use / sneak + use. Gauntlet: sneak + use to socket and pick a combo.");
    case "gauntlet": {
      if (value === "full") { const c = player.getComponent("minecraft:inventory")?.container; const left = c?.addItem(fullGauntlet()); if (left) player.dimension.spawnItem(left, player.location); return msg(player, "§6A fully socketed Gauntlet. §7(testing) Use: unleash · sneak + use: the Wheel · look down + use: next stone."); }
      giveItem(player, GAUNTLET); return msg(player, "§6Infinity Gauntlet given. §7Sneak + use it to open the Wheel and socket stones. §8(/hero gauntlet full = all six, testing)");
    }
    case "blueprints": {
      const x = exoData(h);
      if (value === "all") { for (const k of BP_KEYS) if (!x.bp.includes(k)) x.bp.push(k); markDirty(player); }
      return msg(player, `§bBlueprints: §f${x.bp.map((k) => BLUEPRINTS[k].name).join("§7, §f")}${value === "all" ? "" : "  §8(/hero blueprints all = unlock everything, testing)"}`);
    }
    case "workshop": openWorkshop(player, at(player.location, 0, 0, 2)); return;
    case "overlay":
      if (!["full", "safe"].includes(value)) return msg(player, `§7Overlays: §f${h.overlay ?? "full"}§7. Usage: /hero overlay <full|safe>  §8(safe = drawn inside the HUD, use it if the helmet/NULL screens don't show)`);
      h.overlay = value; RT(player).hudReset = true; markDirty(player);
      return msg(player, `§7Overlays set to §f${value}§7.`);
    case "ai": return msg(player, aiHelp(player));
    case "mark": {
      const mk = MARKS[value] ? value : "mk3";
      const x = exoData(h);
      if (!x.bp.includes(mk)) x.bp.push(mk);
      const c = player.getComponent("minecraft:inventory")?.container;
      for (const s of SLOT_KEYS) { const left = c?.addItem(makeExoPiece(s, 0, 0, [], null, mk, paintFor(x, mk))); if (left) player.dimension.spawnItem(left, player.location); }
      giveItem(player, INTERFACE);
      markDirty(player);
      return msg(player, `§b${MARKS[mk].name} ${MARKS[mk].title} given (testing). Wear all four pieces.`);
    }
    case "skycatch": {
      const x = exoData(h);
      if (!x.stored) return msg(player, "§7Dismiss your suit first (Exo Interface, sneak + use > Dismiss Suit), then run this again.");
      giveItem(player, INTERFACE);
      player.teleport(at(player.location, 0, 45, 0));
      return msg(player, "§bYou're falling! §7Use the Exo Interface and the suit will catch you.");
    }
    case "mirror": rollPower(player, "mirror_hour"); RT(player).powerCd = 0; return msg(player, "§6Your power is now Mirror Hour. §7Use the Power Core. Sneak + use = choose what to rewind.");
    case "xox": summonXoX(player); return msg(player, "§5The air gets heavy...");
    case "guns": for (const g of ["origin:pistol", "origin:rifle", "origin:shotgun", "origin:sniper"]) giveItem(player, g); { const c = player.getComponent("minecraft:inventory")?.container; c?.addItem(new ItemStack3("origin:ammo", 64)); } return msg(player, "§eGuns + 64 rounds. §7Use: fire · sneak + use: reload · sniper: sneak to scope · rifle: hold use for full auto.");
    case "weapons": for (const w of ["origin:war_hammer", "origin:combat_knife", "origin:xox_katana"]) giveItem(player, w); return msg(player, "§eWar Hammer (sneak + use: ground slam), Combat Knife (bleeds), XoX's Gravity Katana (use: gravity slash · sneak + use: pull).");
    case "ultimate": giveItem(player, "origin:ultimate_mask"); return msg(player, "§dXoX's Mask (testing). Use it once to unlock your Ultimate, again to enter it.");
    case "destruction":
      if (value === "on" || value === "off") { setDestruction(value === "on"); return msg(player, `§7Big hits ${value === "on" ? "§cbreak trees and terrain" : "§aleave the world intact"}§7.`); }
      return msg(player, `§7Destruction is §f${destructionOn() ? "on" : "off"}§7. Usage: /hero destruction <on|off>`);
    case "asgard":
      if (value === "rebuild") { resetAsgard(); return msg(player, "§6Asgard will rebuild around whoever is standing in it."); }
      return msg(player, "§7Usage: /hero asgard rebuild");
    case "space": {
      if (value === "rebuild") { resetSpace(); return msg(player, "§7Watchtower Station, the Moon and the asteroids will rebuild."); }
      if (player.dimension.id === "origin:space") { player.teleport({ x: player.location.x, y: 2, z: player.location.z }); return; }
      if (player.dimension.id !== "minecraft:overworld") return msg(player, "§7Space is above the Overworld.");
      player.teleport({ x: player.location.x, y: 332, z: player.location.z });
      return msg(player, "§7Up you go. §8(Real route: fly above y 330. The Exo-Frame needs the Orbital Seal blueprint.)");
    }
    case "speedforce": enterSpeedForce(player); return;
    case "raid": import("./heimdall.js").then((m) => msg(player, m.forceRaid() ? "§cA raid on Asgard begins." : "§7Only in Asgard, and not while a raid is on.")).catch((e) => msg(player, "§c" + e)); return;
    case "null": import("./null.js").then((m) => m.summonNull(player)).catch((e) => msg(player, "§c" + e)); return;
    case "mjolnir": giveMjolnir(player); return msg(player, "§bMjolnir (testing). §7Use: throw it · use again: call it back · sneak + use: Thunder menu · double-tap jump: fly. §8The real one waits on a rune stone in Asgard's palace hall - only the worthy can lift it.");
    case "honor": return msg(player, `§bHonor §f${honorOf(player)}§7/20 - ${worthy(player) ? "§bworthy." : "§7not yet worthy."} §8Beat monsters (+1) and bosses (+5). Killing villagers, golems, pets or players who never fought you costs it.`);
    case "gear": {
      for (const g of ["origin:vanguard_shield", "origin:shock_batons", "origin:agent_gauntlets"]) giveItem(player, g);
      try { const c = player.getComponent("minecraft:inventory").container; c.addItem(new ItemStack3("origin:batarang", 16)); c.addItem(new ItemStack3("origin:explosive_batarang", 8)); } catch { }
      return msg(player, "§eVanguard Shield, Shock Batons, Agent Gauntlets, Batarangs. §7Hold each one for its controls. §8(All craftable.)");
    }
    case "bifrost": giveItem(player, "origin:bifrost_key"); return msg(player, "§6Bifrost Keystone. §7Use it in the Overworld, under open sky, to go to Asgard - and again in Asgard to come home.");
    default:
      msg(player, HELP);
  }
}
