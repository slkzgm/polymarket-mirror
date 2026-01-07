import type { Side } from "@polymarket/clob-client";

export type CopyConfig = {
	scale: number;
	slippageBps: number;
	orderType: "FAK" | "FOK" | "GTC" | "GTD";
	simulateOnly: boolean;
	allowBuy: boolean;
	allowSell: boolean;
};

export type CopyFill = {
	hash?: string;
	tokenId: string;
	side: "BUY" | "SELL" | "UNKNOWN";
	shares?: string;
	usdc?: string;
};

export type CopyIntent = {
	tokenId: string;
	side: Side;
	size: number; // shares (dec)
	price: number; // limit price dec with slippage
	impliedPrice: number; // fill implied price dec
	notional: number; // USDC dec scaled
	hash?: string;
};
