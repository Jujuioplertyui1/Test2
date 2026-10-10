// Heimdall and the Einherjar: they appear at their posts, he greets you, defends the realm, grants his Sight,
// banishes someone who keeps hitting him; a raid starts, gets cleared, and pays out.
export default async function ({ mc, scripts, tick, player, log, H }) {
  const { hero, RT } = await scripts("data.js");
  const HM = await scripts("heimdall.js");
  hero(player).awakened = true; hero(player).arch = "brawler"; hero(player).power = "super_strength";
  const dim = mc.world.getDimension("origin:asgard");
  player.teleport({ x: 0.5, y: 101, z: -63.5 }, { dimension: dim });
  await tick(220);
  const heim = dim.getEntities({ type: "origin:heimdall" });
  if (heim.length !== 1) throw new Error(`expected one Heimdall, found ${heim.length} (is Asgard built? run asgard_build first)`);
  const guards = dim.getEntities({ type: "origin:einherjar" });
  if (guards.length !== 8) throw new Error(`expected 8 Einherjar, found ${guards.length}`);
  if (!player.messages.some((m) => m.includes("[Heimdall]"))) throw new Error("Heimdall didn't greet the player");
  // something hostile walks up the bridge: Hofund's light
  const z = dim.spawnEntity("minecraft:zombie", { x: 4.5, y: 101, z: -45.5 }); z.families = ["monster", "mob"]; z.matches = (o) => (o.families ?? []).every((f) => z.families.includes(f));
  const zh = z.hp;
  await tick(80);
  if (z.isValid && !(z.hp < zh)) throw new Error("Heimdall ignored a monster in Asgard");
  // his Sight
  H.formAnswers = [1];
  await HM.talkHeimdall(player, heim[0]);
  if (!((RT(player).sightUntil ?? 0) > H.tick)) throw new Error("Heimdall's Sight wasn't granted");
  // a raid, cleared
  const inv = player.getComponent("inventory").container;
  const gold0 = inv.slots.filter((x) => x?.typeId === "minecraft:gold_ingot").length;
  if (!HM.forceRaid()) throw new Error("raid didn't start");
  await tick(20);
  const raiders = dim.getEntities({}).filter((e) => e.nameTag === "§cRift-spawn");
  if (raiders.length < 6) throw new Error(`raid too small: ${raiders.length}`);
  for (const e of raiders) e.applyDamage(999, { cause: "entityAttack", damagingEntity: player });
  await tick(30);
  if (!(inv.slots.filter((x) => x?.typeId === "minecraft:gold_ingot").length > gold0)) throw new Error("no reward for clearing the raid");
  // three strikes and you're out
  for (let i = 0; i < 3; i++) HM.onHeimdallStruck(heim[0], player);
  await tick(200);
  if (player.dimension.id === "origin:asgard") throw new Error("Heimdall should have sent them home");
  log(`heimdall + ${guards.length} guards, defended, sight, raid of ${raiders.length} cleared, banish ok`);
  H.formAnswers = [];
  player.teleport({ x: 0.5, y: 64, z: 0.5 }, { dimension: mc.world.getDimension("overworld") });
}
