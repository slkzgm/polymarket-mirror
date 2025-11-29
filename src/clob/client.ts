import type { AppConfig } from "../config";
import type { Logger } from "../logger";

export type ClobClient = {
	restUrl: string;
};

export function makeClobClient(config: AppConfig, _logger: Logger): ClobClient {
	return {
		restUrl: config.clobRestUrl,
	};
}
