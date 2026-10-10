# ORIGIN: Build Your Own Hero (Minecraft Bedrock add-on)

- `ORIGIN_BP/`: behavior pack (scripts in `ORIGIN_BP/scripts`, `@minecraft/server` 2.8.0)
- `ORIGIN_RP/`: resource pack
- `dist/ORIGIN_v0_24.mcaddon`: the built add-on. Double-click it, or open it with Minecraft, to import both packs.
- `CHANGELOG.md`: what's new in v0.24

## Tools (no Minecraft needed)
```
python3 tools/build.py          # pack dist/ORIGIN_v<version>.mcaddon
python3 tools/lint.py .         # cross-check every JSON reference (models, textures, animations, particles, sounds, items)
node tools/check.mjs ORIGIN_BP  # load every script against a stub API and run the tick loops
node tools/sim/run.mjs          # play scripted scenarios against a fake world (tools/sim/scenarios/*.mjs)
```
`tools/sim` is a small fake of `@minecraft/server` with players, entities, blocks, damage events, timers and forms. The scenarios cover:
- the NULL fight and what happens when everyone leaves it
- arm severing and stitching
- shield ricochets, bank shots and the bash combo
- batarangs
- the Speed Force
- Space
- building Asgard
- Heimdall and raids

The scripts in `tools/art/` generate the v0.24 models and textures:
- `asgardians.py`: Heimdall and the Einherjar
- `limbs.py`: the severed-arm looks
- `null_antenna.py`: NULL's Signal Tower
- `batarang.py`: batarangs
- `black_flash.py`: the Black Flash
- `space.py`: planets, stars and the Orbital Seal icon
- `star_shield.py`: the shield's star-spangled face
- `suit_fixes.py`: the armor repaints
