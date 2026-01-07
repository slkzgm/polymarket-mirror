import type { AppConfig } from "../config";
import type { Logger } from "../logger";
import { buildCopyIntent } from "./calculator";
import { createCopyPlacer } from "./placer";
import type { CopyFill } from "./types";

export function createCopyHandler(config: AppConfig, logger: Logger) {
	const placer = createCopyPlacer(config, logger);

	const copyConfig = {
		scale: config.copyScale,
		slippageBps: config.copySlippageBps,
		orderType: config.copyOrderType,
		simulateOnly: config.copySimulateOnly,
		allowBuy: config.copyAllowBuy,
		allowSell: config.copyAllowSell,
	};

	async function handle(fill: CopyFill) {
		const intent = buildCopyIntent(fill, copyConfig);
		if (!intent) return null;
		return placer.place(intent);
	}

	return { handle };
}
