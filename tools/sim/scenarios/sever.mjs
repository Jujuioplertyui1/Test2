// Lose an arm, pick it up, stitch it back on with a Bandage; arms fly off mobs on sharp kills.
export default async function ({ mc, scripts, tick, player, log }) {
  const { hero } = await scripts("data.js");
  const D = await scripts("dismember.js");
  const h = hero(player);
  h.awakened = true; h.arch = "brawler"; h.power = "super_strength";
  const side = D.tryCut(player, player, 99, "katana", true, "r");
  if (side !== "r" || h.limbs.r !== 0) throw new Error("arm should be gone");
  await tick(20);
  const dim = player.dimension;
  const limb = dim.getEntities({ type: "origin:severed_limb" })[0];
  if (!limb) throw new Error("no arm on the ground");
  if (limb.getDynamicProperty("origin:owner") !== player.id) throw new Error("arm doesn't know its owner");
  const inv = player.getComponent("inventory").container;
  D.onLimbInteract(player, limb);
  const slot = inv.slots.findIndex((x) => x?.typeId === "origin:severed_arm");
  if (slot < 0) throw new Error("arm not picked up");
  player.selectedSlotIndex = slot;
  let used = false;
  D.useSeveredArm(player, () => { used = true; inv.setItem(slot, undefined); });
  await tick(5);
  if (used) throw new Error("stitched without a bandage");
  inv.addItem(new mc.ItemStack("origin:bandage", 2));
  D.useSeveredArm(player, () => { used = true; inv.setItem(slot, undefined); });
  await tick(80);
  if (!used || h.limbs.r !== 1) throw new Error(`stitch failed (used=${used}, arm=${h.limbs.r})`);
  const left = inv.slots.filter((x) => x?.typeId === "origin:bandage").reduce((a, x) => a + x.amount, 0);
  if (left !== 1) throw new Error(`stitch should use one bandage, ${left} left`);
  // mobs: sharp kills fling arms (chance-based, so try a few)
  const sword = new mc.ItemStack("minecraft:diamond_sword", 1);
  inv.setItem(0, sword); player.selectedSlotIndex = 0;
  let flung = 0;
  for (let i = 0; i < 30; i++) {
    const z = dim.spawnEntity("minecraft:zombie", { x: 3, y: 64, z: 3 });
    const before = dim.getEntities({ type: "origin:severed_limb" }).length;
    z.applyDamage(50, { cause: "entityAttack", damagingEntity: player });
    if (dim.getEntities({ type: "origin:severed_limb" }).length > before) flung++;
  }
  if (!flung) throw new Error("no zombie arms in 30 sword kills");
  const looks = new Set(dim.getEntities({ type: "origin:severed_limb" }).map((e) => e.props["origin:look"]));
  if (!looks.has(2)) throw new Error("zombie arms should look like zombie arms");
  if (dim.getEntities({ type: "origin:severed_limb" }).length > 21) throw new Error("stray arm cap not applied");
  log(`zombie arms flung: ${flung}/30`);
}
