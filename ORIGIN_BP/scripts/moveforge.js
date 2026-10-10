// ORIGIN v0.07 - moveforge.js
// The Move Forge altar. Tapping it takes you to your Training Field (a flat grassland in the
// Inner World dimension). The camera watches from a distance while you perform the draft move on
// a dummy, over and over. Pick parts on the cards to change it; FORGE saves it to a slot.
import { system, InputPermissionCategory } from "@minecraft/server";
import { hero, RT, markDirty, ARCH, PARTS, ORDER, POWER_BUDGET, moveStats, moveRecipe, budgetOf, stageOf, STAGES, COMBOS } from "./data.js";
import { at, valid, fx, line, psound, sound, C, cleanName, locOf } from "./util.js";
import { oform, show, ICONS, ModalFormData, PAD } from "./forms.js";
import { ELEM } from "./vfx.js";
import { cast } from "./moves.js";
import { DUMMY } from "./enemy.js";
import { quip, hudMsg } from "./voice.js";
import { title } from "./cine.js";
import { STAGE_MARKS, STAGE_R } from "./plan.js";
import { iwDim, slotOf, stageCenter, ensureStage, loadArea, unloadArea, spawnRetry, holdWhile } from "./innerworld.js";

const pad2 = (n) => String(n).padStart(2, "0");
const RANGE = { strike: 2.3, dash: 4.6, blast: 9.5 };

export function describeMove(m) {
  const f = PARTS.forms[m.form], e = PARTS.elements[m.element], o = PARTS.modifiers[m.modifier], x = PARTS.finishers[m.finisher];
  let s = `§f${m.name}§7 is ${f.desc}, with ${e.name} (${e.desc})`;
  if (m.modifier !== "none") s += `. ${o.name}: ${o.desc}`;
  if (m.finisher !== "none") s += `. Finisher: ${x.desc}`;
  return s + ".";
}

function lock(player, on) {
  try {
    player.inputPermissions.setPermissionCategory(InputPermissionCategory.LateralMovement, !on);
    player.inputPermissions.setPermissionCategory(InputPermissionCategory.Jump, !on);
  } catch { }
}

// ------------------------------------------------------------------ the field
function marks(S) {
  const c = STAGE_MARKS;
  return {
    caster: at(S, c.caster.x, c.caster.y, c.caster.z),
    dummy: (form) => at(S, c.dummyX(RANGE[form] ?? 3), 1, 0.5),
    cam: at(S, c.cam.x, c.cam.y, c.cam.z),
    look: at(S, c.look.x, c.look.y, c.look.z),
  };
}

function wideShot(player, M, ease = 0) {
  try {
    player.camera.setCamera("minecraft:free", {
      location: M.cam, facingLocation: M.look,
      ...(ease ? { easeOptions: { easeTime: ease, easeType: "InOutSine" } } : {}),
    });
  } catch { }
}

// One performance of the draft: reset positions, then cast it for real on the dummy (no cost).
async function perform(player, session) {
  const { M, draft } = session;
  if (!valid(player) || session.busy) return;
  session.busy = true;
  try {
    const spot = M.dummy(draft.form);
    try {
      if (!valid(session.dummy)) session.dummy = await spawnRetry(iwDim(), DUMMY, spot, 10);
      if (session.dummy) { session.dummy.teleport(spot); session.dummy.nameTag = "§7Training Dummy"; }
    } catch { }
    player.teleport(M.caster, { facingLocation: at(spot, 0, 1.5, 0) });
    fx(player.dimension, "origin:aura", M.caster, (ELEM[draft.element] ?? ELEM.kinetic).rgb, 0.6);
    await system.waitTicks(6);
    if (!valid(player) || session.closed) return;
    await cast(player, 0, { draft: { ...draft } });
    await system.waitTicks(24);
    // dashes move you: walk back to the mark for the next take
    if (valid(player) && !session.closed) player.teleport(M.caster, { facingLocation: at(spot, 0, 1.5, 0) });
  } catch (e) {
    console.warn("[ORIGIN] preview failed: " + e);
  } finally {
    session.busy = false;
  }
}

export async function openMoveForge(player, stationLoc, slot) {
  const h = hero(player);
  const r = RT(player);
  if (!h.awakened) { player.sendMessage("§7The crystal stays dark. §8(Awaken first.)"); return; }
  if (r.station || r.cine || r.traveling) return;
  r.station = { kind: "move" };
  const home = { dim: player.dimension, loc: { ...player.location }, rot: player.getRotation() };
  h.forgeRet = locOf(player);           // saved in case the game closes mid-forge
  markDirty(player);
  const pslot = slotOf(player);
  const S = stageCenter(pslot);
  const M = marks(S);
  const session = { M, draft: null, dummy: null, busy: false, closed: false, loop: null };
  const area = `origin_stage_${pslot}`;
  try {
    lock(player, true);
    const altar = at(stationLoc, 0.5, 0, 0.5);
    sound(player.dimension, "beacon.activate", altar, 1.4, 0.6);
    fx(player.dimension, "origin:pillar", altar, ARCH[h.arch].rgb, 0.8);
    try { player.camera.fade({ fadeTime: { fadeInTime: 0.4, holdTime: 1.2, fadeOutTime: 0.8 }, fadeColor: { red: 1, green: 1, blue: 1 } }); } catch { }
    await system.waitTicks(9);
    if (!valid(player)) return;
    await loadArea(area, at(S, 0, 2, 0), STAGE_R + 2);
    player.teleport(M.caster, { dimension: iwDim(), facingLocation: M.dummy("strike") });
    await holdWhile(player, M.caster, ensureStage(pslot), M.look);
    if (!valid(player)) return;
    wideShot(player, M);
    quip(player, "moveforge", "This is the training field. Watch the move, change the cards, then FORGE it.", 6000, false);
    for (;;) {
      if (slot === undefined) {
        slot = await pickSlot(player);
        if (slot === null) break;
      }
      session.draft = { ...h.moves[slot] };
      if (session.loop !== null) system.clearRun(session.loop);
      session.loop = system.runInterval(() => { if (valid(player) && !session.closed) perform(player, session); }, 64);
      perform(player, session);
      const out = await forge(player, slot, session);
      system.clearRun(session.loop);
      session.loop = null;
      if (out === "close") break;
      slot = undefined;
      wideShot(player, M, 0.6);
    }
  } finally {
    session.closed = true;
    if (session.loop !== null) system.clearRun(session.loop);
    try { if (valid(session.dummy)) session.dummy.remove(); } catch { }
    if (valid(player)) {
      try { player.camera.fade({ fadeTime: { fadeInTime: 0.3, holdTime: 0.6, fadeOutTime: 0.8 }, fadeColor: { red: 1, green: 1, blue: 1 } }); } catch { }
      await system.waitTicks(7);
      try { player.teleport(home.loc, { dimension: home.dim, rotation: home.rot }); } catch { }
      try { player.camera.clear(); } catch { }
      lock(player, false);
    }
    unloadArea(area);
    h.forgeRet = null;
    markDirty(player);
    r.station = null;
  }
}

async function pickSlot(player) {
  const h = hero(player);
  const f = oform("menu", "Move Forge", "§7Choose a slot to reforge. The move you have now stays until you press §fFORGE§7.");
  h.moves.forEach((m, i) => {
    const st = moveStats(m);
    f.button(`${i === h.active ? "» " : ""}§f${m.name}\n§8${moveRecipe(m)} · ${st.power}/${budgetOf(h)}`, `${ICONS}form_${m.form}`);
  });
  f.button("Leave the field", `${ICONS}act_back`);
  const res = await show(player, f);
  if (!res || res.canceled || res.selection === undefined || res.selection > 2) return null;
  return res.selection;
}

async function forge(player, slot, session) {
  const h = hero(player);
  const draft = session.draft;
  for (;;) {
    if (!valid(player)) return "close";
    const st = moveStats(draft);
    const B = budgetOf(h);
    const over = st.power > B;
    const body = `<pw${pad2(Math.min(13, Math.round(st.power * 10 / B)))}>` +
      `${over ? "§c" : "§a"}Power ${st.power}/${B}§r   §bCost ${st.cost}§r   §7Cooldown ${(st.cd / 20).toFixed(1)}s\n` +
      describeMove(draft);
    const f = oform("forge", `${draft.name}  §7· slot ${slot + 1}`, body);
    const acts = [];
    const btn = (text, icon, act) => { f.button(text, icon); acts.push(act); };
    // four cards; each opens a picker with everything you've unlocked
    btn(`Form\n§f${PARTS.forms[draft.form].name}`, `${ICONS}form_${draft.form}`, { pick: "forms", key: "form" });
    btn(`Element\n§f${PARTS.elements[draft.element].name}`, `${ICONS}el_${draft.element}`, { pick: "elements", key: "element" });
    btn(`Modifier\n§f${draft.modifier === "none" ? "-" : PARTS.modifiers[draft.modifier].name}`, `${ICONS}mod_${draft.modifier}`, { pick: "modifiers", key: "modifier" });
    btn(`Finisher\n§f${draft.finisher === "none" ? "-" : PARTS.finishers[draft.finisher].name}`, `${ICONS}fin_${draft.finisher}`, { pick: "finishers", key: "finisher" });
    btn("Combos", `${ICONS}act_test`, { combos: true });
    btn("Rename", `${ICONS}act_rename`, { rename: true });
    btn("Replay", `${ICONS}act_test`, { replay: true });
    btn(over ? "§cOver budget" : "§6§lFORGE", `${ICONS}act_forge`, { save: true });
    btn("Back", `${ICONS}act_back`, { back: true });
    while (acts.length < 15) { f.button(PAD); acts.push(null); }   // the forge grid is 3x5
    const res = await show(player, f);
    if (!res || res.canceled || res.selection === undefined) return "close";
    const a = acts[res.selection];
    if (!a) continue;
    if (a.back) return "back";
    if (a.combos) { await combosPage(player); continue; }
    let changed = false;
    if (a.pick) {
      const k = await pickPart(player, a.pick, draft[a.key], draft);
      if (k && k !== draft[a.key]) { draft[a.key] = k; changed = true; }
    }
    if (changed) {
      psound(player, "random.click", 1.2 + Math.random() * 0.3, 0.6);
      if (moveStats(draft).power > B) psound(player, "random.fizz", 1.5, 0.5);
      perform(player, session);
    }
    if (a.replay) perform(player, session);
    if (a.rename) {
      const mf = new ModalFormData().title("Name your move").textField("Name", "e.g. Comet Knuckle", { defaultValue: draft.name });
      const rr = await show(player, mf);
      if (rr && !rr.canceled && rr.formValues) draft.name = cleanName(String(rr.formValues[0] ?? ""), draft.name);
    }
    if (a.save) {
      if (moveStats(draft).power > budgetOf(h)) {
        psound(player, "random.fizz", 1.2, 0.8);
        quip(player, "overbudget", "Too much power for one move. Drop a part.", 200, false);
        continue;
      }
      await ceremony(player, draft, session.M);
      h.moves[slot] = { ...draft };
      markDirty(player);
      return "back";
    }
  }
}

async function ceremony(player, draft, M) {
  const dim = player.dimension;
  const rgb = (ELEM[draft.element] ?? ELEM.kinetic).rgb;
  const P = M.caster;
  try {
    player.camera.setCamera("minecraft:free", {
      location: at(P, -3.5, 2.2, -3.5), facingLocation: at(P, 0, 1.2, 0),
      easeOptions: { easeTime: 0.9, easeType: "InOutSine" },
    });
  } catch { }
  sound(dim, "origin.sfx.swell", P, 1, 0.9);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    line(dim, "origin:trail", at(P, Math.cos(a) * 3, 3, Math.sin(a) * 3), at(P, 0, 1.2, 0), rgb, 0.4, 1);
    await system.waitTicks(2);
  }
  fx(dim, "origin:pillar", P, rgb, 1);
  fx(dim, "origin:shockwave", at(P, 0, 0.05, 0), rgb, 1, { radius: 3 });
  fx(dim, "origin:impact", at(P, 0, 1.2, 0), C.white, 1, { size: 2 });
  sound(dim, "origin.sfx.burst", P, 1, 1);
  sound(dim, "random.anvil_land", P, 1.2, 0.4);
  title(player, "§6§lMOVE FORGED", `§f${draft.name}`, 40);
  psound(player, "random.levelup", 1.2, 0.7);
  await system.waitTicks(30);
  if (valid(player)) wideShot(player, M, 0.8);
}

// a picker page for one card (forms / elements / modifiers / finishers); locked parts show the stage they need
async function pickPart(player, cat, current, draft) {
  const h = hero(player);
  const S = stageOf(h);
  const keys = ORDER[cat];
  const f = oform("menu", { forms: "Forms", elements: "Elements", modifiers: "Modifiers", finishers: "Finishers" }[cat],
    `§7Pick one. Power counts against your budget (§f${budgetOf(h)}§7 at ${STAGES[S].name}).\n` +
    keys.filter((k) => PARTS[cat][k].desc).map((k) => `§f${PARTS[cat][k].name}§7: ${PARTS[cat][k].desc}`).join("\n"));
  const prefix = { forms: "form_", elements: "el_", modifiers: "mod_", finishers: "fin_" }[cat];
  for (const k of keys) {
    const P = PARTS[cat][k];
    const locked = (P.stage ?? 0) > S;
    const label = k === "none" ? (cat === "modifiers" ? "No Mod" : "No Finisher") : P.name;
    f.button(locked ? `§8${label} - ${STAGES[P.stage].name}\n§8${P.desc || ""}` : `${k === current ? "» " : ""}${label} §8(power ${P.power})\n§8${P.desc || "nothing extra"}`, `${ICONS}${prefix}${k === "none" ? (cat === "modifiers" ? "mod_charged" : "fin_fear") : k}`);
  }
  f.button("Back", `${ICONS}act_back`);
  const res = await show(player, f);
  if (!res || res.canceled || res.selection === undefined || res.selection >= keys.length) return null;
  const k = keys[res.selection];
  if (!k || !PARTS[cat][k]) return null;
  if ((PARTS[cat][k].stage ?? 0) > S) {
    hudMsg(player, `§7Locked. §fReach ${STAGES[PARTS[cat][k].stage].name}§7 through your Trials.`, 40);
    psound(player, "random.fizz", 1, 0.5);
    return null;
  }
  return k;
}
async function combosPage(player) {
  const f = oform("menu", "Combos", [
    "§7Cast moves with these FORMS one after another (within 3 seconds). The last one gets the bonus, and you gain Surge.",
    "",
    ...COMBOS.map((c) => `§6${c.name}§7: ${c.seq.map((k) => PARTS.forms[k].name).join(" → ")} §8(x${c.mult}${c.stun ? ", stuns" : ""}${c.pierce ? ", pierces" : ""}${c.radius ? ", bigger" : ""})`),
  ].join("\n"));
  f.button("Back", `${ICONS}act_back`);
  await show(player, f);
}
