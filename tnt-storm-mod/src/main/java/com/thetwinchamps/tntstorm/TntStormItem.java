package com.thetwinchamps.tntstorm;

import java.util.List;

import net.minecraft.entity.TntEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.item.tooltip.TooltipType;
import net.minecraft.particle.ParticleTypes;
import net.minecraft.server.world.ServerWorld;
import net.minecraft.sound.SoundCategory;
import net.minecraft.sound.SoundEvents;
import net.minecraft.stat.Stats;
import net.minecraft.text.Text;
import net.minecraft.util.Formatting;
import net.minecraft.util.Hand;
import net.minecraft.util.TypedActionResult;
import net.minecraft.util.hit.BlockHitResult;
import net.minecraft.util.hit.HitResult;
import net.minecraft.util.math.MathHelper;
import net.minecraft.util.math.Vec3d;
import net.minecraft.util.math.random.Random;
import net.minecraft.world.World;

/**
 * An item that, on use, drops a storm of primed vanilla TNT around the block
 * the player is looking at.
 *
 * <p>The item is deliberately conservative about sides: the client only plays
 * back feedback and predicts the stack/cooldown change, while the authoritative
 * entity spawning happens exclusively on the logical server. That keeps the
 * behaviour identical in singleplayer (which still runs an integrated server)
 * and on a dedicated multiplayer server, and stops the storm from being
 * spawned twice.
 */
public class TntStormItem extends Item {
	/** How many TNT entities a single activation spawns. */
	public static final int TNT_COUNT = 200;

	/** How far the player can aim the storm, in blocks. */
	private static final double TARGET_RANGE = 48.0D;

	/** Horizontal radius of the spread disc around the aimed position. */
	private static final double SPREAD_RADIUS = 6.0D;

	/** How far above the aimed position TNT may be scattered. */
	private static final double SPREAD_HEIGHT = 4.0D;

	/** Lift applied to the aimed position so TNT does not spawn inside the ground. */
	private static final double SPAWN_LIFT = 1.0D;

	/** Vanilla primed-TNT fuse length, in ticks. */
	private static final int VANILLA_FUSE_TICKS = 80;

	/**
	 * Extra random ticks added on top of the vanilla fuse. Keeps every charge on
	 * a normal-length fuse while spreading the detonations over a second so the
	 * server does not have to resolve 200 explosions in a single tick.
	 */
	private static final int FUSE_JITTER_TICKS = 20;

	/** Cooldown applied to the whole item after a successful activation (10 seconds). */
	private static final int COOLDOWN_TICKS = 200;

	public TntStormItem(Item.Settings settings) {
		super(settings);
	}

	@Override
	public TypedActionResult<ItemStack> use(World world, PlayerEntity user, Hand hand) {
		ItemStack stack = user.getStackInHand(hand);

		// Cooldown is mirrored on both sides; the client copy drives the HUD sweep
		// and stops the client from optimistically firing again, the server copy is
		// authoritative.
		if (user.getItemCooldownManager().isCoolingDown(this)) {
			return TypedActionResult.fail(stack);
		}

		Vec3d target = findTarget(user);

		// Audible to everyone nearby. Passing null as the excluded player means the
		// server broadcasts it to every tracking client, including the user.
		world.playSound(null, target.x, target.y, target.z,
				SoundEvents.ENTITY_TNT_PRIMED, SoundCategory.PLAYERS, 4.0F, 0.6F);
		world.playSound(null, target.x, target.y, target.z,
				SoundEvents.ITEM_FIRECHARGE_USE, SoundCategory.PLAYERS, 2.0F, 0.5F);

		// The storm itself is server-only: entity spawning and particle broadcasts
		// must never be run from the client thread.
		if (world instanceof ServerWorld serverWorld) {
			spawnStorm(serverWorld, user, target);
		}

		user.incrementStat(Stats.USED.getOrCreateStat(this));
		user.getItemCooldownManager().set(this, COOLDOWN_TICKS);

		if (!user.getAbilities().creativeMode) {
			stack.decrement(1);
		}

		// Mirrors the vanilla throwable pattern: swing the arm on the client, treat
		// it as a consuming action on the server.
		return TypedActionResult.success(stack, world.isClient());
	}

	/**
	 * Ray-traces from the player's eyes to find where the storm should land. If
	 * the ray hits a block the storm is centred just off that face, otherwise it
	 * centres on the far end of the ray so aiming at the sky still works.
	 */
	private static Vec3d findTarget(PlayerEntity user) {
		HitResult hitResult = user.raycast(TARGET_RANGE, 1.0F, false);
		Vec3d pos = hitResult.getPos();

		if (hitResult instanceof BlockHitResult blockHit && hitResult.getType() == HitResult.Type.BLOCK) {
			// Step off the hit face so the centre of the storm is in open air.
			pos = pos.add(Vec3d.of(blockHit.getSide().getVector()).multiply(0.5D));
		}

		return pos.add(0.0D, SPAWN_LIFT, 0.0D);
	}

	/**
	 * Spawns {@link #TNT_COUNT} ordinary {@link TntEntity} instances scattered
	 * through a cylinder around {@code target}, plus the visual feedback.
	 */
	private static void spawnStorm(ServerWorld world, PlayerEntity user, Vec3d target) {
		Random random = world.getRandom();

		double minY = world.getBottomY() + 1;
		double maxY = world.getTopY() - 2;

		for (int i = 0; i < TNT_COUNT; i++) {
			// Uniform sampling over a disc: sqrt on the radius keeps the density even
			// instead of clumping everything around the centre.
			double angle = random.nextDouble() * Math.PI * 2.0D;
			double distance = Math.sqrt(random.nextDouble()) * SPREAD_RADIUS;

			double x = target.x + Math.cos(angle) * distance;
			double z = target.z + Math.sin(angle) * distance;
			double y = MathHelper.clamp(target.y + random.nextDouble() * SPREAD_HEIGHT, minY, maxY);

			// The vanilla constructor gives the entity the standard 80-tick fuse and
			// the usual random "pop" velocity, so physics, explosion power, block
			// damage and entity damage are all stock TNT behaviour.
			TntEntity tnt = new TntEntity(world, x, y, z, user);
			tnt.setFuse(VANILLA_FUSE_TICKS + random.nextInt(FUSE_JITTER_TICKS + 1));

			world.spawnEntity(tnt);
		}

		world.spawnParticles(ParticleTypes.EXPLOSION, target.x, target.y, target.z,
				12, SPREAD_RADIUS / 2.0D, SPREAD_HEIGHT / 2.0D, SPREAD_RADIUS / 2.0D, 0.0D);
		world.spawnParticles(ParticleTypes.LARGE_SMOKE, target.x, target.y, target.z,
				120, SPREAD_RADIUS / 2.0D, SPREAD_HEIGHT / 2.0D, SPREAD_RADIUS / 2.0D, 0.02D);
		world.spawnParticles(ParticleTypes.FLAME, target.x, target.y, target.z,
				80, SPREAD_RADIUS / 2.0D, SPREAD_HEIGHT / 2.0D, SPREAD_RADIUS / 2.0D, 0.05D);
	}

	@Override
	public void appendTooltip(ItemStack stack, Item.TooltipContext context, List<Text> tooltip, TooltipType type) {
		tooltip.add(Text.translatable("item.tntstorm.tnt_storm.tooltip", TNT_COUNT).formatted(Formatting.GRAY));
		tooltip.add(Text.translatable("item.tntstorm.tnt_storm.tooltip.cooldown", COOLDOWN_TICKS / 20)
				.formatted(Formatting.DARK_GRAY));
	}
}
