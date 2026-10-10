// Batarangs: homing throw hits + disarms, a miss sticks and drops; fan uses three; explosive sticks and blows.
export default async function ({ mc, scripts, tick, player, log }) {
  const { hero } = await scripts("data.js");
  const B = await scripts("batarang.js");
  const h = hero(player); h.awakened = true; h.arch = "brawler"; h.power = "super_strength";
  const inv = player.getComponent("inventory").container;
  inv.setItem(0, new mc.ItemStack("origin:batarang", 16)); player.selectedSlotIndex = 0;
  const dim = player.dimension;
  const sk = dim.spawnEntity("minecraft:skeleton", { x: 0.5, y: 64, z: 12.5 });
  const bow = new mc.ItemStack("minecraft:bow", 1); let mainhand = bow;
  sk.comps["minecraft:equippable"] = { getEquipment: () => mainhand, setEquipment: (s, it) => { mainhand = it; return true; } };
  player.setRotation({ x: -2, y: 0 });
  const hp = sk.hp;
  B.useBatarang(player, "origin:batarang", false);
  await tick(30);
  if (!(sk.hp < hp)) throw new Error("batarang didn't hit the skeleton");
  if (mainhand) throw new Error("skeleton should be disarmed");
  if (inv.getItem(0)?.amount !== 15) throw new Error(`one batarang should be used, have ${inv.getItem(0)?.amount}`);
  if (!dim.getEntities({ type: "minecraft:item" }).some((e) => e.item?.typeId === "origin:batarang")) throw new Error("spent batarang should drop for pickup");
  sk.remove();
  // a miss into a wall
  for (let y = 60; y < 70; y++) for (let x = -5; x < 5; x++) dim.setBlock({ x, y, z: 8 }, "minecraft:stone");
  B.useBatarang(player, "origin:batarang", false);
  await tick(30);
  const drops = dim.getEntities({ type: "minecraft:item" }).filter((e) => e.item?.typeId === "origin:batarang");
  if (!drops.some((e) => e.location.z > 6.5 && e.location.z < 8.1)) throw new Error("batarang should stick at the wall");
  dim.blocks.clear();
  // fan
  player.isSneaking = true;
  const before = inv.getItem(0).amount;
  B.useBatarang(player, "origin:batarang", true);
  player.isSneaking = false;
  await tick(30);
  if (inv.getItem(0).amount !== before - 3) throw new Error("fan should use three");
  // explosive sticks to a zombie and blows
  inv.setItem(1, new mc.ItemStack("origin:explosive_batarang", 4)); player.selectedSlotIndex = 1;
  const z = dim.spawnEntity("minecraft:zombie", { x: 0.5, y: 64, z: 9.5 });
  const zh = z.hp;
  B.useBatarang(player, "origin:explosive_batarang", false);
  await tick(10);
  if (z.hp !== zh) throw new Error("explosive shouldn't hurt before it goes off");
  await tick(40);
  if (!(z.hp < zh - 5) && z.isValid) throw new Error(`explosive should blow up (zombie ${z.hp})`);
  if (player.hp < 20) throw new Error("explosion hurt the thrower");
  log("hit+disarm, wall stick, fan, explosive all ok");
  for (const e of dim.getEntities({})) if (e !== player) e.remove();
}
