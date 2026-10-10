// A small fake of @minecraft/server for driving ORIGIN's scripts in Node (no Minecraft needed).
// Real-ish: ticks + timers + waitTicks, dimensions holding entities, players with inventories/equipment/health,
// damage routed through before/after hurt events, death events, dynamic properties, entity properties.
// Everything else is a forgiving deep proxy, so code that calls APIs we don't model still runs.
const H = (globalThis.__fake = globalThis.__fake ?? { tick: 0, intervals: [], timers: [], startup: [], subs: {}, errors: [], log: [] });

const deep = (path) => new Proxy(function () {}, {
  get(_, k) {
    if (k === Symbol.toPrimitive) return () => 0;
    if (k === "then") return undefined;
    if (k === Symbol.iterator) return function* () {};
    if (k === "length") return 0;
    if (k === "subscribe") return (fn, opts) => { (H.subs[path] ??= []).push({ fn, opts }); return fn; };
    if (k === "unsubscribe") return () => {};
    return deep(path + "." + String(k));
  },
  apply() { return deep(path + "()"); },
  construct() { return deep("new " + path); },
});
const forgiving = (obj, name) => new Proxy(obj, {
  get(t, k, r) { if (k in t) return Reflect.get(t, k, r); if (typeof k === "symbol") return undefined; return deep(name + "." + String(k)); },
});
export const fire = (path, ev) => { for (const s of H.subs[path] ?? []) { const f = s.opts?.entityFilter; if (f?.type && ev.hurtEntity?.typeId !== f.type && ev.deadEntity?.typeId !== f.type) continue; try { s.fn(ev); } catch (e) { H.errors.push(`${path}: ${e?.stack ?? e}`); } } };

// ------------------------------------------------------------------ system
export const system = {
  get currentTick() { return H.tick; },
  runInterval(fn, n = 1) { const id = H.intervals.length + 1; H.intervals.push({ id, fn, n: Math.max(1, n) }); return id; },
  runTimeout(fn, n = 1) { const id = 100000 + H.timers.length; H.timers.push({ id, at: H.tick + Math.max(0, n), fn }); return id; },
  run(fn) { return this.runTimeout(fn, 0); },
  runJob(gen) { const step = () => { const r = gen.next(); if (!r.done) system.runTimeout(step, 1); }; system.runTimeout(step, 0); return 0; },
  clearRun(id) { H.intervals = H.intervals.filter((x) => x.id !== id); H.timers = H.timers.filter((x) => x.id !== id); },
  clearJob() {},
  waitTicks(n) { return new Promise((res) => system.runTimeout(res, Math.max(1, n))); },
  afterEvents: deep("system.afterEvents"),
  beforeEvents: { startup: { subscribe: (fn) => H.startup.push(fn) }, shutdown: { subscribe() {} }, watchdogTerminate: { subscribe() {} } },
};

// ------------------------------------------------------------------ blocks
class Block {
  constructor(dim, loc) { this.dimension = dim; this.location = { x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) }; }
  get typeId() { return this.dimension.blockAt(this.location); }
  get isAir() { return this.typeId === "minecraft:air"; }
  get isLiquid() { return /water|lava/.test(this.typeId); }
  get permutation() { const id = this.typeId; return { type: { id }, matches: (x) => x === id, getState: () => undefined, withState() { return this; } }; }
  setType(id) { this.dimension.setBlock(this.location, typeof id === "string" ? id : id.id); }
  setPermutation(p) { this.dimension.setBlock(this.location, p?.type?.id ?? "minecraft:stone"); }
  above(n = 1) { return new Block(this.dimension, { ...this.location, y: this.location.y + n }); }
  below(n = 1) { return new Block(this.dimension, { ...this.location, y: this.location.y - n }); }
  north(n = 1) { return new Block(this.dimension, { ...this.location, z: this.location.z - n }); }
  south(n = 1) { return new Block(this.dimension, { ...this.location, z: this.location.z + n }); }
  east(n = 1) { return new Block(this.dimension, { ...this.location, x: this.location.x + n }); }
  west(n = 1) { return new Block(this.dimension, { ...this.location, x: this.location.x - n }); }
  getComponent(n) {
    if (/inventory/.test(n) && /chest|barrel/.test(this.typeId)) { const k = `${this.location.x},${this.location.y},${this.location.z}`; this.dimension.containers ??= new Map(); if (!this.dimension.containers.has(k)) this.dimension.containers.set(k, new Container(27)); return { container: this.dimension.containers.get(k) }; }
    return undefined;
  }
  hasTag() { return false; }
}

// ------------------------------------------------------------------ entities
let nextId = 1;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
class Container {
  constructor(size = 36) { this.size = size; this.slots = new Array(size).fill(undefined); this.emptySlotsCount = size; }
  getItem(i) { return this.slots[i]; }
  setItem(i, it) { this.slots[i] = it; }
  getSlot(i) { const c = this; return { getItem: () => c.slots[i], setItem: (it) => { c.slots[i] = it; }, hasItem: () => !!c.slots[i] }; }
  addItem(it) { const i = this.slots.findIndex((x) => !x); if (i < 0) return it; this.slots[i] = it; return undefined; }
  clearAll() { this.slots.fill(undefined); }
}
export class Entity {
  constructor(dim, typeId, loc, opts = {}) {
    this.id = String(nextId++); this.typeId = typeId; this.dimension = dim; this.location = { ...loc };
    this.isValid = true; this.nameTag = ""; this.props = {}; this.dyn = {}; this.effects = {}; this.rot = { x: 0, y: 0 }; this.vel = { x: 0, y: 0, z: 0 };
    this.hp = opts.hp ?? 20; this.maxHp = opts.hp ?? 20; this.isOnGround = true; this.isSneaking = false; this.isSprinting = false; this.tags = new Set();
    this.comps = {
      "minecraft:health": { get currentValue() { return self.hp; }, get effectiveMax() { return self.maxHp; }, defaultValue: this.maxHp, setCurrentValue: (v) => { self.hp = Math.max(0, Math.min(self.maxHp, v)); return true; }, resetToMaxValue: () => { self.hp = self.maxHp; } },
    };
    const self = this;
    dim.entities.push(this);
  }
  getComponent(n) { const k = n.startsWith("minecraft:") ? n : "minecraft:" + n; return this.comps[k] ?? (k === "minecraft:health" ? undefined : undefined); }
  hasComponent(n) { return !!this.getComponent(n); }
  getProperty(k) { return this.props[k]; }
  setProperty(k, v) { this.props[k] = v; }
  getDynamicProperty(k) { return this.dyn[k]; }
  setDynamicProperty(k, v) { if (v === undefined) delete this.dyn[k]; else this.dyn[k] = v; }
  getDynamicPropertyIds() { return Object.keys(this.dyn); }
  getRotation() { return { ...this.rot }; }
  setRotation(r) { this.rot = { ...r }; }
  getViewDirection() { const r = (this.rot.y * Math.PI) / 180, p = (this.rot.x * Math.PI) / 180; return { x: -Math.sin(r) * Math.cos(p), y: -Math.sin(p), z: Math.cos(r) * Math.cos(p) }; }
  getHeadLocation() { return { x: this.location.x, y: this.location.y + 1.62, z: this.location.z }; }
  getVelocity() { return { ...this.vel }; }
  clearVelocity() { this.vel = { x: 0, y: 0, z: 0 }; }
  teleport(loc, o = {}) { if (o.dimension && o.dimension !== this.dimension) { this.dimension.entities = this.dimension.entities.filter((e) => e !== this); this.dimension = o.dimension; o.dimension.entities.push(this); } this.location = { ...loc }; if (o.rotation) this.rot = { ...o.rotation }; return true; }
  tryTeleport(loc, o) { this.teleport(loc, o); return true; }
  applyKnockback(h, v) { this.vel = { x: h?.x ?? 0, y: v ?? 0, z: h?.z ?? 0 }; }
  applyImpulse(v) { this.vel = { ...v }; }
  addEffect(id, dur, o = {}) { this.effects[String(id).replace("minecraft:", "")] = { duration: dur, amplifier: o.amplifier ?? 0 }; return true; }
  removeEffect(id) { delete this.effects[String(id).replace("minecraft:", "")]; return true; }
  getEffect(id) { const e = this.effects[String(id).replace("minecraft:", "")]; return e ? { ...e, typeId: id } : undefined; }
  getEffects() { return Object.entries(this.effects).map(([k, v]) => ({ typeId: k, ...v })); }
  addTag(t) { this.tags.add(t); return true; } removeTag(t) { return this.tags.delete(t); } hasTag(t) { return this.tags.has(t); } getTags() { return [...this.tags]; }
  triggerEvent(e) { this.lastEvent = e; }
  runCommand() { return { successCount: 1 }; }
  playAnimation() {}
  kill() { this.applyDamage(9999); return true; }
  remove() { this.isValid = false; this.dimension.entities = this.dimension.entities.filter((e) => e !== this); }
  getEntitiesFromViewDirection(o = {}) {
    const d = this.getViewDirection(), h = this.getHeadLocation(), max = o.maxDistance ?? 64;
    return this.dimension.entities.filter((e) => e !== this && e.isValid).map((e) => {
      const v = { x: e.location.x - h.x, y: e.location.y + 0.9 - h.y, z: e.location.z - h.z }, along = v.x * d.x + v.y * d.y + v.z * d.z;
      const off = Math.hypot(v.x - d.x * along, v.y - d.y * along, v.z - d.z * along);
      return { entity: e, distance: along, off };
    }).filter((x) => x.distance > 0 && x.distance < max && x.off < 1.2).sort((a, b) => a.distance - b.distance);
  }
  getBlockFromViewDirection() { return undefined; }
  applyDamage(n, src = {}) {
    if (!this.isValid || this.hp <= 0) return false;
    const ev = { hurtEntity: this, damage: n, damageSource: { cause: src.cause ?? "none", damagingEntity: src.damagingEntity, damagingProjectile: src.damagingProjectile }, cancel: false };
    fire("world.beforeEvents.entityHurt", ev);
    if (ev.cancel) return false;
    this.hp -= ev.damage;
    H.log.push(`${this.typeId}#${this.id} -${ev.damage.toFixed(1)} (${this.hp.toFixed(1)} left)`);
    fire("world.afterEvents.entityHurt", { hurtEntity: this, damage: ev.damage, damageSource: ev.damageSource });
    if (this.hp <= 0) {
      fire("world.afterEvents.entityDie", { deadEntity: this, damageSource: ev.damageSource });
      if (this.typeId !== "minecraft:player") this.remove(); else { this.hp = this.maxHp; }
    }
    return true;
  }
}
export class Player extends Entity {
  constructor(dim, name, loc) {
    super(dim, "minecraft:player", loc, { hp: 20 });
    this.name = name; this.selectedSlotIndex = 0; this.gameMode = "Survival";
    const inv = new Container(36), eq = {};
    this.comps["minecraft:inventory"] = { container: inv };
    this.comps["minecraft:equippable"] = { getEquipment: (s) => eq[s], setEquipment: (s, it) => { eq[s] = it; return true; }, getEquipmentSlot: (s) => ({ getItem: () => eq[s], setItem: (it) => { eq[s] = it; } }) };
    this.screen = []; this.messages = [];
    const me = this;
    this.onScreenDisplay = forgiving({ setTitle: (t, o) => me.screen.push(["title", t, o?.subtitle]), setActionBar: (t) => me.screen.push(["bar", t]), updateSubtitle() {}, isValid: true, resetHudElements() {}, setHudVisibility() {} }, "screen");
    this.camera = deep("camera");
    this.inputInfo = forgiving({ getMovementVector: () => me.move ?? { x: 0, y: 0 }, getButtonState: () => "Released", lastInputModeUsed: "KeyboardAndMouse", touchOnlyAffectsHotbar: false }, "inputInfo");
    this.inputPermissions = deep("inputPermissions");
  }
  sendMessage(m) { this.messages.push(typeof m === "string" ? m : JSON.stringify(m)); }
  playSound() {}
  spawnParticle() {}
  getGameMode() { return this.gameMode; }
  setGameMode(m) { this.gameMode = m; }
  getSpawnPoint() { return undefined; }
  isOp() { return true; }
}

// ------------------------------------------------------------------ dimensions
export class Dimension {
  constructor(id, ground = 64) { this.id = id; this.entities = []; this.blocks = new Map(); this.ground = ground; this.heightRange = { min: -64, max: 320 }; }
  blockAt(l) { const k = `${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)}`; if (this.blocks.has(k)) return this.blocks.get(k); return l.y < this.ground ? "minecraft:stone" : "minecraft:air"; }
  setBlock(l, id) { this.blocks.set(`${Math.floor(l.x)},${Math.floor(l.y)},${Math.floor(l.z)}`, id); }
  getBlock(l) { if (l.y < -64 || l.y > 400) return undefined; return new Block(this, l); }
  getBlockFromRay(from, dir, o = {}) {
    const max = o.maxDistance ?? 64, l = Math.hypot(dir.x, dir.y, dir.z) || 1, d = { x: dir.x / l, y: dir.y / l, z: dir.z / l };
    let prev = { x: Math.floor(from.x), y: Math.floor(from.y), z: Math.floor(from.z) };
    for (let t = 0; t <= max; t += 0.05) {
      const q = { x: from.x + d.x * t, y: from.y + d.y * t, z: from.z + d.z * t }, c = { x: Math.floor(q.x), y: Math.floor(q.y), z: Math.floor(q.z) };
      if (c.x === prev.x && c.y === prev.y && c.z === prev.z) continue;
      const id = this.blockAt(c);
      if (id !== "minecraft:air" && !(o.includeLiquidBlocks === false && /water|lava/.test(id))) {
        const face = c.y < prev.y ? "Up" : c.y > prev.y ? "Down" : c.x < prev.x ? "East" : c.x > prev.x ? "West" : c.z < prev.z ? "South" : "North";
        return { block: new Block(this, c), face, faceLocation: { x: q.x - c.x, y: q.y - c.y, z: q.z - c.z } };
      }
      prev = c;
    }
    return undefined;
  }
  getBlockBelow(l) { return new Block(this, { x: l.x, y: this.ground - 1, z: l.z }); }
  getTopmostBlock(l) { return new Block(this, { x: l.x, y: this.ground - 1, z: l.z }); }
  fillBlocks(vol, perm) { const a = vol.from, b = vol.to; let n = 0; for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) for (let z = Math.min(a.z, b.z); z <= Math.max(a.z, b.z); z++) { this.setBlock({ x, y, z }, perm?.type?.id ?? String(perm)); n++; } return { getCapacity: () => n }; }
  setBlockType(l, id) { this.setBlock(l, id); }
  setBlockPermutation(l, p) { this.setBlock(l, p?.type?.id); }
  getEntities(o = {}) {
    return this.entities.filter((e) => {
      if (!e.isValid) return false;
      if (o.type && e.typeId !== o.type) return false;
      if (o.excludeTypes?.includes(e.typeId)) return false;
      if (o.families && !o.families.every((f) => (e.families ?? ["mob", "monster"]).includes(f))) return false;
      if (o.excludeFamilies && o.excludeFamilies.some((f) => (e.families ?? []).includes(f))) return false;
      if (o.location && o.maxDistance !== undefined && dist(e.location, o.location) > o.maxDistance) return false;
      if (o.tags && !o.tags.every((t) => e.hasTag(t))) return false;
      return true;
    }).sort((a, b) => (o.location ? dist(a.location, o.location) - dist(b.location, o.location) : 0)).slice(0, o.closest ?? o.farthest ?? Infinity);
  }
  getEntitiesAtBlockLocation(l) { return this.getEntities({ location: l, maxDistance: 1 }); }
  getPlayers(o = {}) { return this.getEntities({ ...o, type: "minecraft:player" }); }
  spawnEntity(id, loc) { const e = new Entity(this, String(id).split("<")[0], loc, { hp: HP[id] ?? 20 }); fire("world.afterEvents.entitySpawn", { entity: e, cause: "Spawned" }); return e; }
  spawnItem(it, loc) { const e = new Entity(this, "minecraft:item", loc); e.item = it; return e; }
  spawnParticle() {}
  playSound() {}
  runCommand() { return { successCount: 1 }; }
  createExplosion() { return true; }
  isChunkLoaded() { return true; }
  getWeather() { return "Clear"; }
  setWeather() {}
  getLightLevel() { return 15; }
  getSkyLightLevel() { return 15; }
}
export const HP = { "origin:null": 420, "origin:null_antenna": 34, "origin:static_echo": 12 };
const dims = new Map();
const dimOf = (id) => { const k = String(id).replace(/^minecraft:/, ""); const full = id.includes(":") ? id : "minecraft:" + id; const key = full === "minecraft:nether" || k === "nether" ? "minecraft:nether" : full; if (!dims.has(key)) dims.set(key, new Dimension(key)); return dims.get(key); };
const worldDyn = {};
export const world = {
  afterEvents: deep("world.afterEvents"), beforeEvents: deep("world.beforeEvents"),
  players: [],
  getAllPlayers() { return [...dims.values()].flatMap((d) => d.entities.filter((e) => e.typeId === "minecraft:player" && e.isValid)); },
  getPlayers(o = {}) { return this.getAllPlayers().filter((p) => !o.name || p.name === o.name); },
  getDimension: (id) => dimOf(id),
  getDynamicProperty: (k) => worldDyn[k], setDynamicProperty: (k, v) => { if (v === undefined) delete worldDyn[k]; else worldDyn[k] = v; }, getDynamicPropertyIds: () => Object.keys(worldDyn),
  getDefaultSpawnLocation: () => ({ x: 0, y: 64, z: 0 }), getTimeOfDay: () => 6000, setTimeOfDay: () => {}, getAbsoluteTime: () => H.tick, getDay: () => 0,
  scoreboard: deep("scoreboard"), gameRules: deep("gameRules"), sendMessage: () => {}, getEntity: (id) => [...dims.values()].flatMap((d) => d.entities).find((e) => e.id === id),
  structureManager: deep("structureManager"), playSound: () => {}, playMusic: () => {}, stopMusic: () => {},
  tickingAreaManager: { hasCapacity: () => true, createTickingArea: async () => ({}), removeTickingArea: () => {}, hasTickingArea: () => false, getTickingArea: () => undefined, getAllTickingAreas: () => [], maxChunkCount: 256, chunkCount: 0 },
};
// ------------------------------------------------------------------ items
export class ItemStack {
  constructor(id, n = 1) { this.typeId = typeof id === "string" ? id : id.id; this.amount = n; this.lore = []; this.dyn = {}; this.nameTag = undefined; this.keepOnDeath = false; this.lockMode = "none"; this.maxAmount = 64; this.comps = {}; }
  getComponent(n) { return this.comps[n.startsWith("minecraft:") ? n : "minecraft:" + n]; }
  hasComponent(n) { return !!this.getComponent(n); }
  setLore(l) { this.lore = [...(l ?? [])]; } getLore() { return [...this.lore]; }
  getDynamicProperty(k) { return this.dyn[k]; } setDynamicProperty(k, v) { this.dyn[k] = v; }
  clone() { const c = new ItemStack(this.typeId, this.amount); c.lore = [...this.lore]; c.dyn = { ...this.dyn }; c.nameTag = this.nameTag; return c; }
  isStackableWith(o) { return o?.typeId === this.typeId; }
  getTags() { return []; } hasTag() { return false; }
}
export class MolangVariableMap { setColorRGBA() {} setColorRGB() {} setFloat() {} setVector3() {} setSpeedAndDirection() {} }
export class BlockVolume { constructor(a, b) { this.from = a; this.to = b; } getCapacity() { return 1; } }
export const BlockPermutation = { resolve: (id) => ({ type: { id }, matches: (x) => x === id, getState: () => undefined, withState() { return this; } }) };
export const EquipmentSlot = { Head: "Head", Chest: "Chest", Legs: "Legs", Feet: "Feet", Mainhand: "Mainhand", Offhand: "Offhand" };
export const EntityDamageCause = new Proxy({}, { get: (_, k) => String(k) });
export const InputButton = { Jump: "Jump", Sneak: "Sneak" };
export const ButtonState = { Pressed: "Pressed", Released: "Released" };
export const GameMode = { Survival: "Survival", Creative: "Creative", Adventure: "Adventure", Spectator: "Spectator", survival: "survival", creative: "creative", adventure: "adventure", spectator: "spectator" };
export const ItemLockMode = { none: "none", slot: "slot", inventory: "inventory" };
export const WeatherType = { Clear: "Clear", Rain: "Rain", Thunder: "Thunder" };
export const EnchantmentTypes = { get: () => undefined };
export const BlockTypes = { get: (id) => ({ id }) };
export { deep };

// ------------------------------------------------------------------ driving the clock
export async function runTicks(n, each) {
  for (let i = 0; i < n; i++) {
    H.tick++;
    for (const iv of [...H.intervals]) if (H.tick % iv.n === 0) { try { iv.fn(); } catch (e) { H.errors.push(`interval: ${e?.stack ?? e}`); } }
    for (;;) {
      const due = H.timers.filter((x) => x.at <= H.tick);
      if (!due.length) break;
      H.timers = H.timers.filter((x) => x.at > H.tick);
      for (const t of due) { try { t.fn(); } catch (e) { H.errors.push(`timeout: ${e?.stack ?? e}`); } }
      await new Promise((r) => setImmediate(r));   // let awaited waitTicks continuations run this tick
    }
    if (each) await each(H.tick);
    await new Promise((r) => setImmediate(r));
  }
}
