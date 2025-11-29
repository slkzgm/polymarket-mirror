import WebSocket from "ws";
import type { AppConfig } from "../config";
import type { EventBus } from "../events/bus";
import type { Logger } from "../logger";

export type ClobWatcherHandle = { stop: () => void };

export function startClobWatcher(
	config: AppConfig,
	logger: Logger,
	bus: EventBus,
): ClobWatcherHandle {
	const ws = new WebSocket(config.clobWsUrl);

	ws.on("open", () => {
		logger.info("CLOB ws connected");
		// Placeholder: send subscribe message later
	});

	ws.on("message", (data) => {
		bus.emit({ source: "clob", channel: "unknown", raw: data });
	});

	ws.on("error", (err) => {
		logger.warn("CLOB ws error", { err: String(err) });
	});

	ws.on("close", (code, reason) => {
		logger.info("CLOB ws closed", { code, reason: reason.toString() });
	});

	return {
		stop: () => {
			ws.close();
			logger.info("CLOB ws stopped");
		},
	};
}
