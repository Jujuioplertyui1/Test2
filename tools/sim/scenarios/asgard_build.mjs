// Build all of Asgard in the fake world, check every piece finished and the vault is stocked; dump a map image.
import { writeFileSync } from "node:fs";
export default async function ({ mc, scripts, tick, player, log }) {
  const { hero } = await scripts("data.js");
  const A = await scripts("asgard.js");
  hero(player).awakened = true; hero(player).arch = "brawler"; hero(player).power = "super_strength";
  const dim = mc.world.getDimension("origin:asgard");
  player.teleport({ x: 0.5, y: 101, z: -63.5 }, { dimension: dim });
  let left = 1;
  for (let i = 0; i < 120 && left; i++) {
    await tick(50);
    const done = new Set(String(mc.world.getDynamicProperty("origin:asgard_v2") ?? "").split(",").filter(Boolean));
    left = A.PIECE_NAMES.filter((n) => !done.has(n)).length;
  }
  if (left) throw new Error(`${left} Asgard pieces never finished`);
  const chest = dim.getBlock({ x: A.VAULT_CHESTS[0][0], y: A.VAULT_CHESTS[0][1], z: A.VAULT_CHESTS[0][2] });
  if (chest.typeId !== "minecraft:chest" || !chest.getComponent("inventory").container.slots.some(Boolean)) throw new Error("the vault isn't stocked");
  if (!mc.world.getDynamicProperty("origin:asgard_vault")) throw new Error("vault flag not set");
  // a top-down map for eyeballing
  const top = {};
  for (const [k, id] of dim.blocks) { const [x, y, z] = k.split(",").map(Number); if (id === "minecraft:air" || y < 80) continue; const kk = x + "," + z; if (!top[kk] || top[kk][0] < y) top[kk] = [y, id]; }
  writeFileSync(process.env.ASGARD_MAP ?? "/tmp/asgard_map.json", JSON.stringify(top));
  log(`${A.PIECE_NAMES.length} pieces built, ${Object.keys(top).length} columns, vault stocked`);
}
