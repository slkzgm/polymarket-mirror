import { isAddress } from "viem";

export type EnvConfig = {
	rpcWssUrl: string;
	clobRestUrl: string;
	clobWsUrl: string;
	clobApiKey?: string;
	clobApiSecret?: string;
	clobApiPassphrase?: string;
	gammaApiUrl: string;
	gammaApiKey?: string;
	logFormat: "json" | "readable";
	heartbeatBlocks: number;
	targets: string[];
};

function parseBool(raw: string | undefined, defaultValue: boolean): boolean {
	if (!raw) return defaultValue;
	const v = raw.toLowerCase();
	return v === "1" || v === "true" || v === "yes" || v === "y";
}

function parseLogFormat(raw: string | undefined): "json" | "readable" {
	if (!raw) return "json";
	const v = raw.toLowerCase();
	return v === "readable" ? "readable" : "json";
}

function parseTargets(raw: string | undefined): string[] {
	if (!raw) return [];
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
		.map((addr) => {
			if (!isAddress(addr)) throw new Error(`Invalid TARGET address: ${addr}`);
			return addr;
		});
}

export function loadEnv(): EnvConfig {
	const rpcWssUrl = Bun.env.POLYGON_RPC_WSS;
	if (!rpcWssUrl) throw new Error("Missing POLYGON_RPC_WSS (wss endpoint)");

	const clobRestUrl = Bun.env.CLOB_REST_URL || "https://clob.polymarket.com";
	const clobWsUrl = Bun.env.CLOB_WS_URL || "wss://clob.polymarket.com/ws";
	const gammaApiUrl =
		Bun.env.GAMMA_API_URL || "https://gamma-api.polymarket.com";

	const heartbeatBlocks = Math.max(1, Number(Bun.env.HEARTBEAT_BLOCKS || 1));
	const logFormat = parseLogFormat(Bun.env.LOG_FORMAT);

	return {
		rpcWssUrl,
		clobRestUrl,
		clobWsUrl,
		clobApiKey: Bun.env.CLOB_API_KEY,
		clobApiSecret: Bun.env.CLOB_API_SECRET,
		clobApiPassphrase: Bun.env.CLOB_API_PASSPHRASE,
		gammaApiUrl,
		gammaApiKey: Bun.env.GAMMA_API_KEY,
		logFormat,
		heartbeatBlocks,
		targets: parseTargets(Bun.env.TARGET_ADDRESSES),
	};
}
