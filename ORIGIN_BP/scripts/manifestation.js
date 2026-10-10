// ORIGIN v0.02 - manifestation.js
// The voice in your head. Placeholder personality per archetype, a few lines each.
import { system } from "@minecraft/server";
import { hero, RT, ARCH } from "./data.js";
import { health, now, psound } from "./util.js";
import { quip } from "./voice.js";
import { skyState, wake, inIW, slotOf } from "./innerworld.js";
import { oform, show, ICONS } from "./forms.js";

export const LINES = {
  brawler: {
    meet: ["§6Took you long enough to fall.", "§6Soft hands. Bad stance. Great potential.", "§6Fine. I'll make a hero out of you, rookie."],
    who: "I'm the part of you that never backs down. The loud part. You're welcome.",
    place: "Your Inner World. Calm sky means you're fine. Red sky means you're scared, and I have to listen to it. The forges are on the workshop isle, the arena is east, the Gate is north.",
    fight: "Hit things. Every hit builds Momentum, up to five stacks, and your moves hit harder. Stop for three seconds and it drains. See red glow on an enemy? Get out of the circle. Then punish it while it's catching its breath. And don't do the same thing every time. It learns.",
    light: "Nice day in here. Means you're not panicking. Yet.",
    dread: "Sky's red, rookie. That's your fear talking. Talk back louder.",
  },
  energy: {
    meet: ["§bOH. You're SO awake right now!", "§bFeel that? That's us. We burn hot.", "§bTry not to explode. Okay. Explode a little."],
    who: "I'm your spark! Your overclocked, slightly unstable, extremely cool spark.",
    place: "This is US! Inside! When you get scared the sky gets moody, which, rude. Forges south-east, arena east, the Gate up north wakes you up.",
    fight: "Keep Energy at 90% or more and we OVERCHARGE: way more damage, way more cost. Red glow on a big guy means MOVE. When he's wheezing afterwards, unload on him. Oh! And he LEARNS. Spam one move and he blocks it. Rude!",
    light: "Everything's glowing and so are we!",
    dread: "Okay the sky is RED and I am being VERY calm about it.",
  },
  shadow: {
    meet: ["§5Good evening. Please, don't run.", "§5I've been standing behind you for some time.", "§5Let's teach them to be afraid. Politely."],
    who: "Your shadow. The quiet one. I do the worrying so you can do the frightening.",
    place: "Your Inner World. The red sky is fear. Yours, mostly. I find it cozy. The forges wait to the south-east, the arena to the east. The Gate will wake you, when you're ready.",
    fight: "Fear is a resource. The higher your Dread, the harder you hit, and the more they hesitate. Watch for the red glow. Step out of the circle. Then... remind it who it's dealing with. It studies you, the way I do. Be unpredictable.",
    light: "It's bright today. I'll manage.",
    dread: "Ah. There's the sky I like.",
  },
};

function voice(h) {
  return LINES[h.arch] ?? LINES.brawler;
}

export function rateFight(h) {
  const f = h.stats.lastFight;
  if (!f) return "Rate what? You haven't fought anything. I'm giving the silence a 7.";
  const secs = Math.max(1, Math.round(f.len / 20));
  let score = 4 + Math.min(3, f.hits / 4) + f.kills * 1.5 + (f.won ? 1 : 0) + Math.min(2, (f.punish ?? 0)) - Math.min(4, f.taken / 6);
  score = Math.max(1, Math.min(10, Math.round(score)));
  const quips = score >= 9
    ? "Losing a point for style. I'm jealous."
    : score >= 7 ? "Solid. You flinched once. I saw it."
      : score >= 5 ? "Fine. Mid. Like a sandwich with no sauce."
        : score >= 3 ? "You fought like a wet sponge with ambitions."
          : "I've seen scarecrows with better footwork. Literally. There's one in the dojo.";
  return `${score}/10. ${quips}\n\n§7${f.hits} hits, ${f.casts} moves, ${Math.round(f.taken)} damage taken, ${f.kills} down, ${secs}s.`;
}

export async function talk(player) {
  const h = hero(player);
  if (!h.awakened) {
    player.sendMessage("§7It looks at you like it's waiting for something.");
    return;
  }
  const v = voice(h);
  let loop = true;
  let line = skyState(slotOf(player)) === "dread" ? v.dread : v.light;
  const portrait = `<a${ARCH[h.arch]?.idx ?? 0}>`;
  while (loop) {
    const f = oform("menu", `${ARCH[h.arch]?.col ?? "§f"}Your Manifestation`, `§f${line}`)
      .button("Who are you?", `${ICONS}talk_who`)
      .button("What is this place?", `${ICONS}talk_place`)
      .button("How do I fight?", `${ICONS}talk_fight`)
      .button("Rate my last fight", `${ICONS}talk_rate`)
      .button(inIW(player) ? "Wake me up" : "Bye", `${ICONS}${inIW(player) ? "wake" : "act_back"}`);
    const r = await show(player, f);
    if (!r || r.canceled || r.selection === undefined) return;
    psound(player, "random.click", 1.2, 0.5);
    await system.waitTicks(4);
    switch (r.selection) {
      case 0: line = v.who; break;
      case 1: line = v.place; break;
      case 2: line = v.fight; break;
      case 3: line = rateFight(h); break;
      default:
        loop = false;
        if (inIW(player)) system.run(() => wake(player));
    }
  }
}

// ---- overworld quips (every 10 ticks per player) ----
export function tickVoice(player) {
  const h = hero(player);
  if (!h.awakened) return;
  const r = RT(player);
  if (r.cine) return;
  const hp = health(player);
  if (!hp) return;
  const t = now();
  if (r.lastHp >= 0 && hp.cur < r.lastHp && r.fight) r.fight.taken += r.lastHp - hp.cur;
  r.lastHp = hp.cur;
  const inCombat = t - r.lastCombat < 200;
  if (inCombat && hp.cur > 0 && hp.cur <= hp.max * 0.3) {
    if (quip(player, "low_hp", "...He's going to kill you.", 2400)) {
      system.runTimeout(() => quip(player, "stove", "Also, you left the stove on. Just saying.", 2400), 50);
    }
  }
}
