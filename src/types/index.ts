export type OnchainEvent = {
	source: "onchain";
	hash?: string;
	raw?: unknown;
};

export type ClobEvent = {
	source: "clob";
	channel: "market" | "user" | "unknown";
	raw: unknown;
};

export type AppEvent = OnchainEvent | ClobEvent;
