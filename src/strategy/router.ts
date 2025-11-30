import { createTokenResolver } from "../clob/resolver";
import type { AppConfig } from "../config";
import type { EventBus } from "../events/bus";
import type { Logger } from "../logger";
import type { AppEvent } from "../types";

export function attachStrategy(
	bus: EventBus,
	logger: Logger,
	config: AppConfig,
) {
	const resolver = createTokenResolver(config.clobRestUrl, logger);

	const handler = (event: AppEvent) => {
		if (event.source !== "onchain") return;
		const info = event.info;

		if (info?.tokenId) {
			void resolver.resolve(info.tokenId).then((resolved) => {
				logger.info("onchain event", {
					hash: (event as { hash?: string }).hash,
					role: info.role,
					side: info.side,
					tokenId: info.tokenId,
					takerFill: info.takerFill,
					takerReceive: info.takerReceive,
					marketId: resolved?.marketId,
					assetId: resolved?.assetId,
				});
			});
		} else {
			logger.info("onchain event", {
				hash: (event as { hash?: string }).hash,
				role: info?.role,
				side: info?.side,
				tokenId: info?.tokenId,
				takerFill: info?.takerFill,
				takerReceive: info?.takerReceive,
			});
		}
	};

	bus.on(handler);
	return () => bus.remove(handler);
}
