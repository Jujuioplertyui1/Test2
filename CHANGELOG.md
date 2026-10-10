# ORIGIN v0.24

## Fixes

### Weapons now sit in your hands
Mjolnir, the Vanguard Shield, the Shock Batons and the Agent Gauntlets were never attached to the hand bone, so they rendered at your feet or body instead of in your hand. All four are bound to the hand now:
- **Mjolnir** hangs head-down from your grip.
- **The shield** rides your forearm.
- **The batons** point forward from the fist, with a second baton in your off hand (third person).
- **The gauntlets** come as a pair.

### Arm severing
- **Stitching:** pick up your own severed arm and use it while carrying a **Bandage** to stitch it back on. It takes three seconds of holding still and only works within 10 minutes; after that the arm has "gone cold". Regeneration and Exo Prosthetics still work as before.
- **Mob arms:** sharp killing blows can take an arm off zombies, skeletons, illagers, piglins, husks and villagers. The katana does it most often. Each mob type gets its own arm look: zombie green, bone, grey illager, piglin pink or husk tan.
- **New arm model:** the flying-arm model is a proper arm with a sleeve, a hand and a bloody stump with bone, and it twitches when it lands.
- **Arms remember whose they are:** a dropped arm keeps its owner and the time it was cut, even through a relog. Arms nobody owns clean themselves up, and big fights cap at 20 arms on the ground.
- **No more look flicker:** a missing arm is reapplied right after a dimension change, instead of after up to 5 seconds of a "ghost" arm.

### NULL boss: a real three-act fight
- **It moves now.** It used to teleport in place every tick to face you, which froze it. Now it walks you down and blinks in when you run.
- **New melee:** **Glitch Claw**, a red-screen windup followed by three lunging slashes. You can back off or parry it.
- **Act 2, Signal Lost (at 66%):** three destructible **Signal Towers** rise at the arena edge. They shield NULL (it takes about 25% damage) and snipe at you. Destroy all three and NULL **OVERLOADS**: on its knees, "BUFFERING", taking +60% damage for 6 seconds.
- **Act 3, Dead Channel (at 33%):** the Final Broadcast, then an enraged NULL with **Channel Surf** (it zaps around you; watch for the flicker where it will land) and dead pixels raining down.
- **Punish windows:** after its big moves NULL is **EXPOSED** and takes +35% damage.
- **Scales with group size:** it takes 35% less damage per extra player.
- **Abandoned fights:** if everyone dies or leaves, NULL fades out and the Receiver can call it back for free.
- **Better loot:** more null crystals, plus diamonds and XP bottles.
- **Quest fixes:**
  - It asked for 10 shards while every message said 8. It's 8 now, and shards drop about 5x more often.
  - The Nether check used the wrong dimension id.

### Armor
- **Vanguard suit** is now properly Captain America: a white star on the chest, red/white stripes around the waist, leather gloves and belt, and a helmet with a white "A", white wings and eye holes. The band that sat across the eyes moved above them, and the preset now uses matching blue legs.
- **Vanguard Shield** is repainted: red, white and red rings around a blue disc with a white star, on the held model, the thrown model and the icon.
- **Thunder God:** the brown "barrel" arms are now dark chainmail with steel bracers, and six silver discs sit on the chest.
- **Visor mask:** the earpieces were floating half a pixel off the head. They now sit flush.
- **Classic (lenses) mask:** the black ear discs looked like holes. They're now suit-coloured with a speaker ring.
- **Exo Mark IV:** the shoulder-cannon muzzle is a red glow instead of a pink nub.

## New

### Captain America shield: physics and moves
- **Real ricochets:** the thrown shield ray-casts and bounces off the exact face it hits (angle in equals angle out). After a wall it **banks** into an enemy near its new heading, so you can hit people behind cover.
- **Chains** through up to five enemies, hitting a little harder each link, then **curves home like a boomerang**, clipping anyone on the way back.
- **Trick shot:** catch it after 3 or more hits and your charge and slam cooldowns reset.
- **Perfect block:** raise the shield (sneak) just as a hit lands. Arrows and bolts go back at the shooter, and melee attackers are staggered.
- **Shield landing:** guard while falling. You take no fall damage up to big drops, and the impact flattens everything around you.
- **Bash combo:** hit, hit, hit gives bash, bash, **uppercut**.

### Batarangs (craft: 3 iron ingots + black dye = 6)
- **Use:** throws one fast and flat, curving onto whoever you aim at.
  - **On a hit:** it staggers them and **disarms** mobs (a skeleton without its bow can't shoot).
  - **On a miss:** it sticks in the wall and you can pick it back up.
- **Sneak + use:** a fan of three.
- **Sprint + use:** a **remote** batarang you steer with your view for 3 seconds.
- **Explosive Batarang** (2 batarangs + TNT + redstone = 2): sticks to whatever it hits, blinks, then blows up. It does no block damage and can't hurt you.

### The Speed Force (Super Speed power)
- **Getting in:** turn Speedster mode on, run flat out for six seconds (the HUD fills), then **jump**.
- **Inside** is a ring of light in a gold-white storm. Running refills Energy, Stamina, Surge and health, and echoes of you flicker ahead.
- **Four Time Gates** let you come out at:
  - where you went in
  - your spawn point
  - **where you last died**
  - sunrise ("run back to dawn")
  - nightfall
- **Leaving early:** sneak and slow down for three seconds and it lets you go.
- **The Black Flash:** stay longer than 90 seconds and it hunts you, getting faster the longer you stay. You can't fight it. If it catches you it hurts and throws you out.
- **On exit** you're **Speed Force Charged** for a minute: Speed II, Strength, Haste, and the Lightning Throw is always charged.

### Space (above the build limit)
- **Getting there:** climb past **y 330** in the Overworld. The Flight power, Mjolnir, the Lumen Signet, elytra and rockets can all do it.
- **The Exo-Frame (Iron Man) can't**, unless you upgrade it:
  - **Without the upgrade:** it starts **icing** past 240 (the thrusters sputter and the reactor burns three times as fast) and loses power at 290. It thaws on the way down, so the Sky Catch can grab you again.
  - **The Orbital Seal blueprint** (Exo Workshop: netherite, null crystals, phantom membrane, glass) fixes that. Keep climbing and you're in space, and the suit keeps you breathing there.
- **Watchtower Station:** you arrive at a glass dome with air inside, a docking ring, solar wings and a gold **drop pad**.
- **Hazards:**
  - **Low gravity.**
  - **No air:** about 15 seconds of breath, then it hurts.
  - **What keeps you safe:** the station dome, a sealed Exo-Frame, the Lumen Signet, Super Durability, or Mjolnir in hand.
- **The view:** Earth fills the view below, with stars all around and the Sun overhead.
- **The Moon** has craters with null crystal and aetherium ore and a flag. A field of **asteroids** full of ore lies on the way.
- **Fast travel:** every block you move in orbit is **16 blocks** back home. Fall back down (or sneak on the drop pad) and you re-enter, burning, over wherever your orbit carried you.

### Asgard, three times bigger, guarded by Heimdall
- **Three new lands**, joined to the old island by golden bridges with rails, lanterns and hanging arches:
  - **North, the City:** a golden plaza with the All-Father's statue in a fountain, avenues, 20 houses with stepped gold roofs, and the **Throne Hall** with Odin's empty throne. Below it is **Odin's Vault**, with three stocked chests: totem, enchanted golden apple, netherite scrap, Bifrost Keystone and more.
  - **West, the Training Grounds:** an arena ring and **Idunn's Orchard** of golden trees.
  - **East:** the **Hall of Heroes** under a golden dome, with statues around an eternal flame, and a **skyship dock**.
- **Heimdall** stands at the Bifrost landing with his great sword:
  - He greets you by name.
  - He goes after anything hostile in the realm, and at range throws a blade of Bifrost light.
  - He can't be hurt. Hit him three times and he sends you home.
  - **Talk to him** to:
    - open the Bifrost home (no Keystone needed)
    - get **Heimdall's Sight**: for 3 minutes, in any realm, every hostile near you is marked
    - hear news of the realm
- **Eight Einherjar** guards hold the bridges, the plaza, the arena and the Hall of Heroes. Fallen guards are replaced after five minutes.
- **Raids:** while anyone is in Asgard, every so often rift-spawn tear through onto the shore nearest the defenders. Heimdall calls it ("To arms!"). Clear them for gold, diamonds, aetherium and honor.

## Commands
- `/hero space [rebuild]`: launch into space, or re-enter if you're already there.
- `/hero speedforce`: go straight into the Speed Force.
- `/hero null`: summon NULL where you are.
- `/hero raid`: start a raid on Asgard.
- `/hero gear`: now also gives batarangs.

Existing worlds keep everything. Asgard adds its new lands around the old island as you explore. Space and the Speed Force build themselves on your first visit.
