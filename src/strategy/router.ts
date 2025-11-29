import type { EventBus } from "../events/bus";
import type { Logger } from "../logger";
import type { AppEvent } from "../types";

export function attachStrategy(bus: EventBus, logger: Logger) {
	const handler = (event: AppEvent) => {
		logger.debug("strategy received event", { source: event.source });
	};

	bus.on(handler);

	return () => bus.remove(handler);
}
