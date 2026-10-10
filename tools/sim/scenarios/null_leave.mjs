// Walk away from NULL: it fades out and the Receiver can call it back for free.
export default async function ({ mc, scripts, tick, player, log }) {
  const { hero } = await scripts("data.js");
  const { useReceiver } = await scripts("quest.js");
  const h = hero(player);
  h.awakened = true; h.arch = "energy"; h.power = "flight"; h.quest = { signal: 2 };
  const inv = player.getComponent("inventory").container;
  for (let i = 0; i < 8; i++) inv.addItem(new mc.ItemStack("origin:static_shard", 1));
  useReceiver(player);
  await tick(260);
  const dim = player.dimension;
  if (!dim.getEntities({ type: "origin:null" }).length) throw new Error("NULL never arrived");
  player.teleport({ x: 500, y: 64, z: 500 });
  await tick(1300);
  if (dim.getEntities({ type: "origin:null" }).length) throw new Error("NULL should have left");
  if (!hero(player).quest.nullFree) throw new Error("free re-summon not granted");
  player.teleport({ x: 0, y: 64, z: 0 });
  await tick(30);
  useReceiver(player);
  await tick(260);
  if (!dim.getEntities({ type: "origin:null" }).length) throw new Error("free re-summon didn't work");
  for (const e of dim.getEntities({ type: "origin:null" })) e.remove();
  await tick(5);
}
