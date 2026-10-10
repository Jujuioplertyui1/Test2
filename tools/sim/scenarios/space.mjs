// Space: leave the sky, dock at the station, run out of air, re-enter; the Exo ices up unless it has the Orbital Seal.
export default async function ({ mc, scripts, tick, player, log, H }) {
  const { hero, RT } = await scripts("data.js");
  const exo = await scripts("exo.js");
  const flight = await scripts("flight.js");
  const h = hero(player); h.awakened = true; h.arch = "energy"; h.power = "flight";
  const r = RT(player);
  player.teleport({ x: 100.5, y: 331, z: -40.5 });
  await tick(30);
  if (player.dimension.id !== "origin:space") throw new Error(`should be in space, in ${player.dimension.id} at y ${player.location.y}`);
  await tick(40);
  const sp = player.dimension;
  if (sp.blockAt({ x: 0, y: 60, z: 0 }) === "minecraft:air") throw new Error("Watchtower Station wasn't built");
  if (sp.blockAt({ x: 0, y: 69, z: 0 }) !== "minecraft:sea_lantern") throw new Error("station dome missing");
  // walk outside the dome: no air
  player.teleport({ x: 0.5, y: 61, z: 13.5 });
  const hp0 = player.hp;
  await tick(400);
  if (!(r.spaceAir <= 0)) throw new Error(`air should run out, ${r.spaceAir} left`);
  if (!(player.hp < hp0)) throw new Error("vacuum should hurt");
  player.teleport({ x: 0.5, y: 61, z: 0.5 });
  await tick(60);
  if (!(r.spaceAir > 100)) throw new Error("station air should refill");
  // drift 10 blocks east in orbit, then fall back to Earth: 160 blocks east of the launch point
  player.teleport({ x: 10.5, y: 3, z: 0.5 });
  await tick(6);
  if (player.dimension.id !== "minecraft:overworld") throw new Error("falling should re-enter");
  if (Math.abs(player.location.x - (100.5 + 160)) > 1 || player.location.y !== 300) throw new Error(`re-entry at the wrong place: ${JSON.stringify(player.location)}`);
  // Exo without the seal: ices up and drops
  const eq = player.getComponent("equippable");
  for (const [slot, id] of [["Head", "origin:exo_helmet"], ["Chest", "origin:exo_chestplate"], ["Legs", "origin:exo_leggings"], ["Feet", "origin:exo_boots"]]) eq.setEquipment(slot, new mc.ItemStack(id, 1));
  const x = exo.exoData(h); x.suited = true; x.reactor = 100;
  player.teleport({ x: 0.5, y: 200, z: 0.5 });
  await tick(12);
  exo.exoTakeoff(player);
  await tick(5);
  if (!flight.isFlying(player)) throw new Error("exo should be flying");
  player.teleport({ x: 0.5, y: 295, z: 0.5 });
  await tick(4);
  if (flight.isFlying(player)) throw new Error("unsealed exo should lose power above 290");
  if (r.groundedWhy !== "ice") throw new Error("should be grounded by ice");
  // with the seal: through to space, and it breathes for you
  x.bp.push("orbital");
  r.groundedUntil = 0;
  player.isOnGround = false;   // airborne (the fake doesn't simulate physics)
  player.teleport({ x: 0.5, y: 280, z: 0.5 });
  exo.exoTakeoff(player);
  await tick(4);
  player.teleport({ x: 0.5, y: 335, z: 0.5 });
  await tick(30);
  if (player.dimension.id !== "origin:space") throw new Error("sealed exo should reach space");
  if (!flight.isFlying(player)) throw new Error("sealed exo should keep flying in space");
  r.spaceAir = 10; await tick(20);
  if (!(r.spaceAir > 10)) throw new Error("orbital seal should be life support");
  flight.stopFlight(player);
  player.isOnGround = true;
  log("launch, dock, vacuum, re-entry x16, exo icing, orbital seal all ok");
  for (const s of ["Head", "Chest", "Legs", "Feet"]) eq.setEquipment(s, undefined);
  player.teleport({ x: 0.5, y: 64, z: 0.5 }, { dimension: mc.world.getDimension("overworld") });
  await tick(5);
}
