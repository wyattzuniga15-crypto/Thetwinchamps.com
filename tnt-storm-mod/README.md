# TNT Storm

A Minecraft **Java Edition** mod that adds a single item, **TNT Storm**. Right-click it and
200 primed vanilla TNT entities rain down on whatever block you are looking at.

| | |
|---|---|
| Minecraft | 1.21.1 |
| Mod loader | Fabric (Loader 0.16.5+, Fabric API 0.102.0+1.21.1) |
| Mappings | Yarn 1.21.1+build.3 |
| Java | 21 |
| Mod id | `tntstorm` |
| Item id | `tntstorm:tnt_storm` |

> This mod is a **self-contained subproject**. It has its own Gradle build and shares nothing
> with the Next.js application in the repository root.

## Behaviour

Right-clicking with the item (either hand):

1. Ray-traces up to **48 blocks** from the player's eyes. If the ray hits a block the storm
   centres just off that face; if it hits nothing it centres on the end of the ray, so aiming
   at the sky works too.
2. Spawns **200** ordinary `TntEntity` instances scattered through a cylinder around that
   point — a **6 block** radius disc (uniformly sampled, so they do not clump in the centre)
   and up to **4 blocks** of vertical spread. No two share exact coordinates.
3. Each entity is a stock `TntEntity` created with the vanilla constructor, so explosion
   power, block damage, entity damage, knockback and the usual random "pop" velocity are all
   unmodified vanilla behaviour. The fuse is the vanilla **80 ticks** plus a random **0–20
   tick** jitter, so the detonations spread over about a second instead of resolving 200
   explosions in a single tick.
4. Plays `entity.tnt.primed` and `item.firecharge.use`, and emits explosion, large-smoke and
   flame particles at the target.
5. Credits the `minecraft.used` statistic, applies a **10 second (200 tick)** cooldown to the
   item, and consumes 1 item unless the player is in creative mode.

### Sidedness

`TntStormItem#use` runs on both logical sides, as every item's `use` does. Only the client-safe
parts run on the client:

- **Both sides** — cooldown check, cooldown set (the client copy drives the hotbar sweep and
  stops the client predicting a second activation), stack decrement (standard vanilla client
  prediction), arm swing.
- **Server only** — the entity spawning and the particle broadcast, guarded by
  `if (world instanceof ServerWorld serverWorld)`. The storm can therefore never be spawned
  twice, and behaves identically in singleplayer (which still runs an integrated server) and
  on a dedicated server.

Sounds are played through `World#playSound(null, ...)`; passing `null` as the excluded player
makes the server broadcast to every tracking client, so everyone nearby hears it.

## Obtaining the item

**Survival** — craft it. The recipe is 8 TNT around a nether star:

```
T T T      T = minecraft:tnt
T N T      N = minecraft:nether_star
T T T      -> 1x tntstorm:tnt_storm
```

The recipe unlocks in the recipe book once you pick up a nether star
(`data/tntstorm/advancement/recipes/tnt_storm.json`).

**Creative** — it is added to the vanilla *Combat* tab and appears in creative search.

**Commands** — `/give @s tntstorm:tnt_storm`.

It stacks to 16.

## Building

```bash
cd tnt-storm-mod
./gradlew build
```

The jar lands in `build/libs/tnt-storm-1.0.0.jar`. Drop it into `mods/` alongside
[Fabric API](https://modrinth.com/mod/fabric-api) on a 1.21.1 Fabric install.

`./gradlew runClient` / `./gradlew runServer` launch a dev instance.

### Build requires network access to the Minecraft toolchain

Fabric Loom downloads the Loom plugin, Yarn mappings, the Fabric Loader/API and the Minecraft
client jar at configuration time. Building needs outbound HTTPS to at least:

- `maven.fabricmc.net`, `meta.fabricmc.net`
- `piston-meta.mojang.com`, `piston-data.mojang.com`, `libraries.minecraft.net`,
  `resources.download.minecraft.net`
- `services.gradle.org`, `repo1.maven.org`, `plugins.gradle.org`

## Layout

```
src/main/java/com/thetwinchamps/tntstorm/
  TntStorm.java           mod entrypoint: item registration + creative tab
  TntStormItem.java       the item's behaviour
src/main/resources/
  fabric.mod.json                                    mod metadata
  assets/tntstorm/icon.png                           mod icon
  assets/tntstorm/lang/en_us.json                    localization
  assets/tntstorm/models/item/tnt_storm.json         item model
  assets/tntstorm/textures/item/tnt_storm.png        16x16 item texture
  data/tntstorm/recipe/tnt_storm.json                crafting recipe
  data/tntstorm/advancement/recipes/tnt_storm.json   recipe unlock
```

Note the 1.21 singular data-pack directory names (`recipe/`, `advancement/`), not the
pre-1.21 `recipes/` and `advancements/`.

## Tuning

All the knobs are `private static final` constants at the top of `TntStormItem`:
`TNT_COUNT`, `TARGET_RANGE`, `SPREAD_RADIUS`, `SPREAD_HEIGHT`, `SPAWN_LIFT`,
`VANILLA_FUSE_TICKS`, `FUSE_JITTER_TICKS`, `COOLDOWN_TICKS`.

200 simultaneous TNT entities is a genuinely heavy load; lower `TNT_COUNT` if you are running
this on a small server.
