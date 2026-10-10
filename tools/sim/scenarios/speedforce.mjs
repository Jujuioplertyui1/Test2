// Speed Force: charge by running flat out, jump in, use a Time Gate to come out, get run down by the Black Flash.
export default async function ({ mc, scripts, tick, player, log, H }) {
  const { hero, RT } = await scripts("data.js");
  const SF = await scripts("speedforce.js");
  const h = hero(player); h.awakened = true; h.arch = "brawler"; h.power = "super_speed"; h.energy = 80;
  const r = RT(player);
  r.speedOn = true; player.isSprinting = true; player.setRotation({ x: 0, y: 0 });
  const start = { ...player.location };
  await tick(150);
  if ((r.sfCharge ?? 0) < 120) throw new Error(`charge should be full after running, got ${r.sfCharge} (spd ${r.spd})`);
  if (!SF.trySpeedForce(player)) throw new Error("jump at full charge should break through");
  await tick(10);
  if (player.dimension.id !== "origin:speed_force") throw new Error(`should be in the Speed Force, in ${player.dimension.id}`);
  await tick(40);
  if (!(h.energy >= 80)) throw new Error("the Speed Force should refill energy");
  // run through a Time Gate and pick "where I came in"
  H.formAnswers = [0];
  const g = { x: Math.cos(Math.PI / 4) * 56, z: Math.sin(Math.PI / 4) * 56 };
  player.teleport({ x: g.x, y: 101, z: g.z });
  await tick(20);
  if (player.dimension.id !== "minecraft:overworld") throw new Error(`Time Gate should take them out, in ${player.dimension.id}`);
  if (Math.hypot(player.location.x - start.x, player.location.z - start.z) > 400) throw new Error("came out far from where they went in");
  if (!((r.sfChargedUntil ?? 0) > H.tick)) throw new Error("should be SPEED FORCE CHARGED");
  // again, and this time loiter until the Black Flash catches them
  r.sfCharge = 120; r.spd = 1.7;
  SF.trySpeedForce(player);
  await tick(10);
  if (player.dimension.id !== "origin:speed_force") throw new Error("second entry failed");
  player.isSprinting = false; r.speedOn = false;
  let saw = false;
  for (let i = 0; i < 2300 && player.dimension.id === "origin:speed_force"; i += 20) {
    await tick(20);
    if (player.dimension.getEntities({ type: "origin:black_flash" }).length) saw = true;
  }
  if (!saw) throw new Error("the Black Flash never came");
  if (player.dimension.id === "origin:speed_force") throw new Error("the Black Flash should throw them out");
  log(`entered, gate exit ok, black flash ejected them`);
  H.formAnswers = [];
}
