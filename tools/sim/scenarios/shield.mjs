// Captain-America shield: ricochet chain, bank shot off a wall, boomerang return, trick shot, landing, bash combo.
export default async function ({ mc, scripts, tick, player, log, H }) {
  const { hero, RT } = await scripts("data.js");
  const gear = await scripts("gear.js");
  const h = hero(player); h.awakened = true; h.arch = "brawler"; h.power = "super_strength";
  const inv = player.getComponent("inventory").container;
  inv.setItem(0, new mc.ItemStack("origin:vanguard_shield", 1)); player.selectedSlotIndex = 0;
  const dim = player.dimension;
  const z = [0, 1, 2].map((i) => { const e = dim.spawnEntity("minecraft:zombie", { x: 0.5 + (i - 1) * 3, y: 64, z: 10.5 + i }); e.families = ["monster", "mob"]; return e; });
  player.setRotation({ x: -3, y: 0 });
  const hp0 = z.map((e) => e.hp);
  gear.useGear(player, "origin:vanguard_shield", false);
  await tick(4);
  if (inv.getItem(0)?.typeId !== "origin:shield_strap") throw new Error("throw should leave the strap in hand");
  await tick(80);
  const hitN = z.filter((e, i) => !e.isValid || e.hp < hp0[i]).length;
  if (hitN < 3) throw new Error(`ricochet should chain through all three, hit ${hitN}`);
  if (inv.getItem(0)?.typeId !== "origin:vanguard_shield") throw new Error(`shield didn't come back (slot holds ${inv.getItem(0)?.typeId})`);
  if (hero(player).shieldOut) throw new Error("shieldOut flag stuck");
  const trick = player.screen.length;
  // bank shot: a wall to the east at x=6; look at it, a zombie hides north-west of the bounce point
  for (const e of dim.getEntities({ type: "minecraft:zombie" })) e.remove();
  for (let y = 64; y < 70; y++) for (let zz = -10; zz < 30; zz++) dim.setBlock({ x: 6, y, z: zz }, "minecraft:stone");
  const hid = dim.spawnEntity("minecraft:zombie", { x: 1.5, y: 64, z: 12.5 }); hid.families = ["monster", "mob"];
  player.teleport({ x: 0.5, y: 64, z: 0.5 }); player.setRotation({ x: 0, y: -45 });   // facing +x/+z, toward the wall
  const hb = hid.hp;
  gear.useGear(player, "origin:vanguard_shield", false);
  await tick(90);
  if (!(hid.hp < hb || !hid.isValid)) throw new Error("bank shot off the wall missed the hidden zombie");
  if (inv.getItem(0)?.typeId !== "origin:vanguard_shield") throw new Error("shield lost after the bank shot");
  // shield landing: guard while falling
  player.isSneaking = true;
  const ev = { hurtEntity: player, damage: 12, damageSource: { cause: "fall" }, cancel: false };
  const handled = gear.onShieldBefore(ev);
  if (!handled || !ev.cancel) throw new Error("shield landing should cancel the fall");
  player.isSneaking = false;
  // bash, bash, uppercut
  const t = dim.spawnEntity("minecraft:zombie", { x: 0.5, y: 64, z: 2 }); t.families = ["monster", "mob"];
  for (let i = 0; i < 3; i++) { gear.onGearMelee(player, t); await tick(6); }
  if (!(t.vel.y > 0.8)) throw new Error("third shield hit should be an uppercut");
  await tick(5);
  log(`chain hit ${hitN}, bank shot ok, uppercut vy=${t.vel.y}`);
  for (const e of dim.getEntities({})) if (e !== player) e.remove();
  dim.blocks.clear();
}
