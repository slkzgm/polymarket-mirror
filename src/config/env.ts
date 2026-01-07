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
	privateKey?: string;
	fundingAddress?: string;
	signatureType?: number;
	copyScale: number;
	copySlippageBps: number;
	copyOrderType: "FAK" | "FOK" | "GTC" | "GTD";
	copySimulateOnly: boolean;
	copyAllowBuy: boolean;
	copyAllowSell: boolean;
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

function parseNumber(
	raw: string | undefined,
	defaultValue: number,
	min?: number,
): number {
	if (!raw) return defaultValue;
	const n = Number(raw);
	if (Number.isNaN(n)) return defaultValue;
	if (min !== undefined) return Math.max(min, n);
	return n;
}

function parseOrderType(
	raw: string | undefined,
): "FAK" | "FOK" | "GTC" | "GTD" {
	if (!raw) return "FAK";
	const v = raw.toUpperCase();
	if (v === "FOK" || v === "GTC" || v === "GTD") return v;
	return "FAK";
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
	const copyScale = parseNumber(Bun.env.COPY_SCALE, 0.1, 0);
	const copySlippageBps = parseNumber(Bun.env.COPY_SLIPPAGE_BPS, 500, 0);
	const copyOrderType = parseOrderType(Bun.env.COPY_ORDER_TYPE);
	const copySimulateOnly = parseBool(Bun.env.COPY_SIMULATE_ONLY, true);
	const copyAllowBuy = parseBool(Bun.env.COPY_ALLOW_BUY, true);
	const copyAllowSell = parseBool(Bun.env.COPY_ALLOW_SELL, true);
	const privateKey = Bun.env.PRIVATE_KEY;
	const fundingAddress = Bun.env.FUNDING_ADDRESS;
	const signatureType = Bun.env.SIGNATURE_TYPE
		? Number(Bun.env.SIGNATURE_TYPE)
		: undefined;

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
		privateKey,
		fundingAddress,
		signatureType,
		copyScale,
		copySlippageBps,
		copyOrderType,
		copySimulateOnly,
		copyAllowBuy,
		copyAllowSell,
		heartbeatBlocks,
		targets: parseTargets(Bun.env.TARGET_ADDRESSES),
	};
}
