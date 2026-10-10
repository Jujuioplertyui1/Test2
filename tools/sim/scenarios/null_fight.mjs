// Summon NULL with the Receiver, fight it through all three acts (towers, overload, final broadcast) to the end.
export default async function ({ mc, scripts, tick, player, H, log }) {
  const { hero } = await scripts("data.js");
  const { useReceiver } = await scripts("quest.js");
  const nullMod = await scripts("null.js");
  const h = hero(player);
  h.awakened = true; h.arch = "brawler"; h.power = "super_strength"; h.quest = { signal: 2 };
  const inv = player.getComponent("inventory").container;
  for (let i = 0; i < 8; i++) inv.addItem(new mc.ItemStack("origin:static_shard", 1));
  player.setRotation({ x: 0, y: 0 });
  useReceiver(player);
  await tick(260);
  const dim = player.dimension;
  const boss = () => dim.getEntities({ type: "origin:null" })[0];
  const n = boss();
  if (!n) throw new Error("NULL never arrived");
  const shards = inv.slots.filter((x) => x?.typeId === "origin:static_shard").length;
  if (shards !== 0) throw new Error(`receiver should have eaten 8 shards, ${shards} left`);
  let sawTowers = 0, sawOverload = false, sawPhase3 = false, states = new Set(), shieldedHit = null, openHit = null;
  for (let round = 0; round < 400 && boss(); round++) {
    const e = boss();
    // stay close and keep hitting it; knock down towers when they're up
    player.teleport({ x: e.location.x + 2, y: 64, z: e.location.z });
    const towers = dim.getEntities({ type: "origin:null_antenna" });
    sawTowers = Math.max(sawTowers, towers.length);
    if (towers.length && round % 3 === 0) { const t = towers[0]; t.applyDamage(12, { cause: "entityAttack", damagingEntity: player }); }
    const hp0 = e.hp;
    e.applyDamage(9, { cause: "entityAttack", damagingEntity: player });
    const took = hp0 - (boss()?.hp ?? 0);
    if (towers.length && shieldedHit === null) shieldedHit = took;
    if (!towers.length && openHit === null && sawTowers) openHit = took;
    if (String(e.nameTag).includes("BUFFERING")) sawOverload = true;
    if (String(e.nameTag).includes("DEAD CHANNEL")) sawPhase3 = true;
    states.add(e.props["origin:state"]);
    await tick(10);
  }
  if (boss()) throw new Error(`NULL still alive after the fight (${boss().hp} hp)`);
  if (sawTowers !== 3) throw new Error(`expected 3 signal towers, saw ${sawTowers}`);
  if (!(shieldedHit < 9 * 0.5)) throw new Error(`towers should shield it: took ${shieldedHit} of 9`);
  if (!sawOverload) throw new Error("never overloaded after the towers fell");
  if (!sawPhase3) throw new Error("never reached act three");
  if ((hero(player).quest?.signal ?? 0) < 4) throw new Error("quest didn't advance on the kill");
  if (dim.getEntities({ type: "origin:null_antenna" }).length) throw new Error("towers left behind");
  log(`towers ${sawTowers}, shielded hit ${shieldedHit?.toFixed(1)}, open hit ${openHit?.toFixed(1)}, anim states ${[...states].join(",")}, player took ${H.log.filter((l) => l.startsWith("minecraft:player")).length} hits`);
}
