import { startClobWatcher } from "./src/clob/ws";
import { loadConfig } from "./src/config";
import { createEventBus } from "./src/events/bus";
import { createLogger } from "./src/logger";
import { startOnchainWatcher } from "./src/onchain/watcher";
import { attachStrategy } from "./src/strategy/router";

const logger = createLogger();

async function main() {
	const config = loadConfig();
	const bus = createEventBus();

	logger.info("Booting watchers", { targets: config.targets });

	const onchain = startOnchainWatcher(config, logger, bus);
	const clob = startClobWatcher(config, logger, bus);
	const detachStrategy = attachStrategy(bus, logger);

	const shutdown = () => {
		detachStrategy();
		onchain.stop();
		clob.stop();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

main().catch((err) => {
	logger.error("Fatal error", { err: String(err) });
	process.exit(1);
});
