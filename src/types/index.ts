export type OnchainEvent = {
	source: "onchain";
	hash?: string;
	raw?: unknown;
	decoded?: unknown;
	info?: {
		role?: "MAKER" | "TAKER" | "UNKNOWN";
		side?: "BUY" | "SELL" | "UNKNOWN";
		tokenId?: string;
		takerFill?: string;
		takerReceive?: string;
	};
};

export type ClobEvent = {
	source: "clob";
	channel: "market" | "user" | "unknown";
	raw: unknown;
};

export type AppEvent = OnchainEvent | ClobEvent;
