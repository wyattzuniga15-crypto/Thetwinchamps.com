package com.thetwinchamps.tntstorm;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.itemgroup.v1.ItemGroupEvents;
import net.minecraft.item.Item;
import net.minecraft.item.ItemGroups;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Entry point for the TNT Storm mod.
 *
 * <p>Registers the {@code tntstorm:tnt_storm} item and adds it to the vanilla
 * "Combat" creative tab. Everything the item does at runtime lives in
 * {@link TntStormItem}.
 */
public class TntStorm implements ModInitializer {
	public static final String MOD_ID = "tntstorm";

	private static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

	/** Identifier of the TNT Storm item: {@code tntstorm:tnt_storm}. */
	public static final Identifier TNT_STORM_ID = Identifier.of(MOD_ID, "tnt_storm");

	/**
	 * The TNT Storm item itself. Stacks to 16 so it is still a meaningful
	 * resource cost in survival.
	 */
	public static final Item TNT_STORM = new TntStormItem(new Item.Settings().maxCount(16));

	@Override
	public void onInitialize() {
		Registry.register(Registries.ITEM, TNT_STORM_ID, TNT_STORM);

		// Show up in the creative inventory / search so it is obtainable in creative
		// as well as through its crafting recipe in survival.
		ItemGroupEvents.modifyEntriesEvent(ItemGroups.COMBAT).register(entries -> entries.add(TNT_STORM));

		LOGGER.info("TNT Storm registered as {}", TNT_STORM_ID);
	}
}
