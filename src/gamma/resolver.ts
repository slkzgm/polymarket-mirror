import type { Logger } from "../logger";
import { createTtlCache } from "./cache";
import type { GammaClient } from "./client";
import {
	getMarketByClobTokenId,
	getMarketById,
	getMarketBySlug,
} from "./markets";
import type { GammaMarket } from "./types";

export type GammaResolverOptions = {
	ttlMs?: number;
	negativeTtlMs?: number;
};

export type GammaResolver = {
	resolveById: (id: string | number) => Promise<GammaMarket | null>;
	resolveBySlug: (slug: string) => Promise<GammaMarket | null>;
	resolveByClobTokenId: (tokenId: string) => Promise<GammaMarket | null>;
	getCached: (key: string) => GammaMarket | null | undefined;
	clear: () => void;
};

export function createGammaResolver(
	client: GammaClient,
	logger: Logger,
	options?: GammaResolverOptions,
): GammaResolver {
	const ttlMs = options?.ttlMs ?? 60_000;
	const negativeTtlMs = options?.negativeTtlMs ?? 10_000;

	const cache = createTtlCache<GammaMarket | null>();
	const inflight = new Map<string, Promise<GammaMarket | null>>();

	function cacheKey(kind: "id" | "slug" | "token", value: string | number) {
		return `${kind}:${value}`;
	}

	function put(key: string, market: GammaMarket | null) {
		const ttl = market ? ttlMs : negativeTtlMs;
		cache.set(key, market, ttl);
		if (!market) return;

		cache.set(cacheKey("id", market.id), market, ttlMs);
		if (market.slug) cache.set(cacheKey("slug", market.slug), market, ttlMs);
		if (market.clobTokenIds) {
			for (const tokenId of market.clobTokenIds) {
				cache.set(cacheKey("token", tokenId), market, ttlMs);
			}
		}
	}

	function fromCache(key: string): GammaMarket | null | undefined {
		const cached = cache.get(key);
		if (cached !== undefined) {
			logger.debug("gamma cache hit", { key });
		}
		return cached;
	}

	function resolveWithFetcher(
		key: string,
		fetcher: () => Promise<GammaMarket | null>,
	) {
		const cached = fromCache(key);
		if (cached !== undefined) return Promise.resolve(cached);

		const pending = inflight.get(key);
		if (pending) return pending;

		const promise = fetcher()
			.then((market) => {
				inflight.delete(key);
				put(key, market);
				return market;
			})
			.catch((err: unknown) => {
				inflight.delete(key);
				logger.debug("gamma resolve error", { key, err: String(err) });
				return null;
			});

		inflight.set(key, promise);
		return promise;
	}

	return {
		resolveById: (id) =>
			resolveWithFetcher(cacheKey("id", id), async () => {
				const market = await getMarketById(client, id).catch(() => null);
				return market;
			}),
		resolveBySlug: (slug) =>
			resolveWithFetcher(cacheKey("slug", slug), async () => {
				const market = await getMarketBySlug(client, slug).catch(() => null);
				return market;
			}),
		resolveByClobTokenId: (tokenId) =>
			resolveWithFetcher(cacheKey("token", tokenId), async () => {
				const market = await getMarketByClobTokenId(client, tokenId).catch(
					() => null,
				);
				if (market && !market.clobTokenIds?.includes(tokenId)) {
					return {
						...market,
						clobTokenIds: [...(market.clobTokenIds ?? []), tokenId],
					};
				}
				return market;
			}),
		getCached: (key) => cache.get(key),
		clear: () => cache.clear(),
	};
}
