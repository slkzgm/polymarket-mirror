import type { Logger } from "../logger";

export type TokenInfo = {
	tokenId: string;
	marketId?: string;
	assetId?: string;
	raw?: unknown;
};

export function createTokenResolver(restUrl: string, logger: Logger) {
	const cache = new Map<string, TokenInfo>();
	const inflight = new Map<string, Promise<TokenInfo | null>>();

	async function fetchBook(tokenId: string): Promise<TokenInfo | null> {
		try {
			const url = `${restUrl.replace(/\/$/, "")}/book?token_id=${tokenId}`;
			const res = await fetch(url);
			if (!res.ok) {
				logger.debug("token resolver book non-200", {
					tokenId,
					status: res.status,
				});
				return null;
			}
			const data = (await res.json()) as { market?: string; asset_id?: string };
			const info: TokenInfo = {
				tokenId,
				marketId: data.market,
				assetId: data.asset_id,
				raw: data,
			};
			return info;
		} catch (err) {
			logger.debug("token resolver fetch error", { tokenId, err: String(err) });
			return null;
		}
	}

	function getCached(tokenId: string): TokenInfo | undefined {
		return cache.get(tokenId);
	}

	async function resolve(tokenId: string): Promise<TokenInfo | null> {
		const cached = cache.get(tokenId);
		if (cached) return cached;
		const pending = inflight.get(tokenId);
		if (pending) return pending;
		const p = fetchBook(tokenId).then((info) => {
			if (info) cache.set(tokenId, info);
			inflight.delete(tokenId);
			return info;
		});
		inflight.set(tokenId, p);
		return p;
	}

	return { resolve, getCached };
}
