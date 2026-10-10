// ORIGIN v0.02 - stations.js
// Custom blocks origin:suit_forge and origin:move_forge share the custom component "origin:station".
import { system } from "@minecraft/server";
import { openSuitForge } from "./suitforge.js";
import { openMoveForge } from "./moveforge.js";
import { openWorkshop as openExoForge } from "./workshop.js";
import { registerLumen, useLantern } from "./lumen.js";

export function registerStations() {
  system.beforeEvents.startup.subscribe((ev) => {
    registerLumen(ev);
    try {
      ev.blockComponentRegistry.registerCustomComponent("origin:station", {
        onPlayerInteract(e, p) {
          const player = e.player;
          if (!player) return;
          const kind = p?.params?.kind ?? (e.block.typeId === "origin:move_forge" ? "move" : "suit");
          const loc = { ...e.block.location };
          system.run(() => {
            if (kind === "move") openMoveForge(player, loc);
            else if (kind === "exo") openExoForge(player, loc);
            else if (kind === "lantern") useLantern(player, loc);
            else openSuitForge(player, loc);
          });
        },
      });
    } catch (err) {
      console.warn("[ORIGIN] station component failed: " + err);
    }
  });
}
