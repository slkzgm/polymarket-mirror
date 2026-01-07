import { Side } from "@polymarket/clob-client";
import type { CopyConfig, CopyFill, CopyIntent } from "./types";

const SCALE = 1_000_000n;

function toBigInt(value: string | undefined): bigint | null {
	if (!value) return null;
	try {
		return BigInt(value);
	} catch {
		return null;
	}
}

function applyScale(value: bigint, scale: number): bigint {
	const scaled = BigInt(Math.floor(scale * Number(SCALE)));
	return (value * scaled) / SCALE;
}

function applySlippage(
	priceMicros: bigint,
	slippageBps: number,
	side: "BUY" | "SELL" | "UNKNOWN",
): bigint {
	const bps = BigInt(slippageBps);
	const delta = (priceMicros * bps) / 10_000n;
	if (side === "BUY") return priceMicros + delta;
	if (side === "SELL") return priceMicros - delta;
	return priceMicros;
}

export function buildCopyIntent(
	fill: CopyFill,
	config: CopyConfig,
): CopyIntent | null {
	if (config.scale <= 0) return null;
	if (fill.side === "BUY" && !config.allowBuy) return null;
	if (fill.side === "SELL" && !config.allowSell) return null;

	const shares = toBigInt(fill.shares);
	const usdc = toBigInt(fill.usdc);
	if (!shares || shares <= 0n || !usdc || usdc <= 0n) return null;

	const copyShares = applyScale(shares, config.scale);
	const copyUsdc = applyScale(usdc, config.scale);
	if (copyShares <= 0n || copyUsdc <= 0n) return null;

	const priceMicros = (usdc * SCALE) / shares;
	const limitMicros = applySlippage(priceMicros, config.slippageBps, fill.side);
	if (limitMicros <= 0n) return null;

	const size = Number(copyShares) / Number(SCALE);
	const price = Number(limitMicros) / Number(SCALE);
	const impliedPrice = Number(priceMicros) / Number(SCALE);
	const notional = Number(copyUsdc) / Number(SCALE);

	const sideEnum = fill.side === "SELL" ? Side.SELL : Side.BUY;

	return {
		tokenId: fill.tokenId,
		side: sideEnum,
		size,
		price,
		impliedPrice,
		notional,
		hash: fill.hash,
	};
}
