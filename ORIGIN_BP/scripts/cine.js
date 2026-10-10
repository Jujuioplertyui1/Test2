// ORIGIN v0.02 - cine.js
// Small cinematic helper. Locks movement + HUD (touch controls stay so mobile players can sneak-skip).
import { system, EasingType, HudElement, InputPermissionCategory } from "@minecraft/server";
import { RT, hero } from "./data.js";
import { valid, cmd } from "./util.js";

export const SKIP = Symbol("skip");
export const ABORT = Symbol("abort");
export const EASE = EasingType;

export class Cine {
  constructor(player) {
    this.p = player;
    this.skippable = false;
    this.skipReq = false;
    this.cancelled = false;
    this.awaitingPick = false;
    this.confirming = false;
    this.picked = null;
    this.locked = false;
    RT(player).cine = this;
  }

  check() {
    if (this.cancelled || !valid(this.p)) throw ABORT;
    if (this.skippable && this.skipReq) {
      this.skipReq = false;
      throw SKIP;
    }
  }

  async wait(t) {
    const end = system.currentTick + Math.max(1, Math.floor(t));
    while (system.currentTick < end) {
      await system.waitTicks(1);
      this.check();
    }
  }

  // Like wait(), but a sneak press just ends the wait early (used for dialogue lines).
  async waitOrAdvance(t) {
    const end = system.currentTick + t;
    this.skipReq = false;
    while (system.currentTick < end) {
      await system.waitTicks(1);
      if (this.cancelled || !valid(this.p)) throw ABORT;
      if (this.skipReq) { this.skipReq = false; return; }
    }
  }

  setSkippable(on) {
    this.skippable = on;
    this.skipReq = false;
  }

  cam(location, facingLocation, easeTime = 0, easeType = EasingType.InOutSine) {
    const o = { location, facingLocation };
    if (easeTime > 0) o.easeOptions = { easeTime, easeType };
    try { this.p.camera.setCamera("minecraft:free", o); } catch (e) { console.warn("[ORIGIN] camera: " + e); }
  }

  clearCam() {
    try { this.p.camera.clear(); } catch { }
  }

  fade(fadeInTime, holdTime, fadeOutTime, rgb = { red: 0, green: 0, blue: 0 }) {
    try { this.p.camera.fade({ fadeTime: { fadeInTime, holdTime, fadeOutTime }, fadeColor: rgb }); } catch { }
  }

  say(sub, stay = 60, t = " ") {
    title(this.p, t, sub, stay);
  }

  shake(intensity = 0.4, seconds = 0.5) {
    cmd(this.p, `camerashake add @s ${intensity} ${seconds} positional`);
  }

  lock(hideHud = true) {
    lockPlayer(this.p, hideHud);
    this.locked = true;
  }

  unlock() {
    unlockPlayer(this.p);
    this.locked = false;
  }

  end() {
    if (!valid(this.p)) return;
    let r = null;
    try { r = RT(this.p); } catch { }
    if (r?.cine && r.cine !== this) return;   // a newer scene owns this player now - leave it alone
    this.clearCam();
    this.unlock();
    if (r) r.cine = null;
  }
}

export function lockPlayer(p, hideHud = true) {
  try {
    p.inputPermissions.setPermissionCategory(InputPermissionCategory.LateralMovement, false);
    p.inputPermissions.setPermissionCategory(InputPermissionCategory.Jump, false);
  } catch { }
  if (hideHud) {
    try { p.onScreenDisplay.hideAllExcept([HudElement.TouchControls]); } catch { }
  }
}

export function unlockPlayer(p) {
  try {
    p.inputPermissions.setPermissionCategory(InputPermissionCategory.LateralMovement, true);
    p.inputPermissions.setPermissionCategory(InputPermissionCategory.Jump, true);
    p.inputPermissions.setPermissionCategory(InputPermissionCategory.Movement, true);
    p.inputPermissions.setPermissionCategory(InputPermissionCategory.Camera, true);
  } catch { }
  try { p.onScreenDisplay.resetHudElementsVisibility(); } catch { }
}

// Real titles pause the corner HUD (which also travels on the title channel) until they finish.
export function title(p, text, sub, stay = 60) {
  try {
    const o = { fadeInDuration: 8, stayDuration: stay, fadeOutDuration: 12 };
    if (sub !== undefined) o.subtitle = sub;
    p.onScreenDisplay.setTitle(text, o);
    RT(p).titleUntil = system.currentTick + stay + 22;
  } catch { }
}

// Safety net on join: undo anything a cut-off cinematic may have left behind.
export function resetPlayerView(p) {
  unlockPlayer(p);
  try { p.camera.clear(); } catch { }
  cmd(p, "fog @s remove origin_wake");
}

// Run a short cinematic safely: locks the player, lets sneak skip it, always restores the view.
export async function runCine(p, fn, { skippable = true, hideHud = true, kind = "self" } = {}) {
  if (RT(p).cine) return false;
  if (kind !== "self") { let pref = "all"; try { pref = hero(p).cine ?? "all"; } catch { } if (pref === "mine") return false; }   // /hero cutscenes mine: skip boss + PvP cutscenes
  const c = new Cine(p);
  c.setSkippable(skippable);
  try { c.lock(hideHud); } catch { }
  try { await fn(c); return true; }
  catch (e) { if (e !== SKIP && e !== ABORT) console.warn("[ORIGIN] cine: " + e); return false; }
  finally { c.end(); }
}
