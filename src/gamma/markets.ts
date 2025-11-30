import type { QueryParams, GammaClient } from "./client";
import type {
	GammaEvent,
	GammaEventRaw,
	GammaMarket,
	GammaMarketRaw,
	GammaTag,
} from "./types";

function toStringArray(value?: string[] | string | null): string[] | undefined {
	if (!value) return undefined;
	if (Array.isArray(value)) return value.filter(Boolean);
	return value
		.split(",")
		.map((v) => v.trim())
		.filter(Boolean);
}

function toNumberArray(
	value?: string[] | string | number[] | null,
): number[] | undefined {
	if (!value) return undefined;
	const arr = Array.isArray(value) ? value : String(value).split(",");
	const nums = arr
		.map((v) => {
			const n = Number(v);
			return Number.isFinite(n) ? n : null;
		})
		.filter((v): v is number => v !== null);
	return nums.length > 0 ? nums : undefined;
}

function toNumber(value?: string | number | null): number | undefined {
	if (value === undefined || value === null) return undefined;
	const n = typeof value === "number" ? value : Number(value);
	return Number.isFinite(n) ? n : undefined;
}

function normalizeTags(tags?: GammaTag[] | null): GammaTag[] | undefined {
	if (!tags) return undefined;
	return tags.map((tag) => ({
		id: tag.id,
		name: tag.name ?? undefined,
		slug: tag.slug ?? undefined,
		type: tag.type ?? undefined,
	}));
}

export function normalizeMarket(raw: GammaMarketRaw): GammaMarket {
	return {
		id: raw.id,
		slug: raw.slug ?? undefined,
		question: raw.question ?? undefined,
		conditionId: raw.conditionId,
		marketMakerAddress: raw.marketMakerAddress ?? undefined,
		startDate: raw.startDate ?? undefined,
		endDate: raw.endDate ?? undefined,
		category: raw.category ?? undefined,
		liquidityNum: toNumber(raw.liquidityNum),
		volumeNum: toNumber(raw.volumeNum),
		closed: raw.closed ?? undefined,
		active: raw.active ?? undefined,
		outcomes: toStringArray(raw.outcomes),
		outcomePrices: toNumberArray(raw.outcomePrices),
		tags: normalizeTags(raw.tags),
		clobTokenIds: raw.clobTokenIds ?? undefined,
		raw,
	};
}

export function normalizeEvent(raw: GammaEventRaw): GammaEvent {
	return {
		id: raw.id,
		slug: raw.slug ?? undefined,
		title: raw.title ?? undefined,
		description: raw.description ?? undefined,
		startDate: raw.startDate ?? undefined,
		endDate: raw.endDate ?? undefined,
		negRisk: raw.negRisk ?? undefined,
		closed: raw.closed ?? undefined,
		markets: raw.markets?.map(normalizeMarket),
		tags: normalizeTags(raw.tags),
		raw,
	};
}

export type ListMarketsParams = {
	ids?: Array<number | string>;
	slugs?: string[];
	clobTokenIds?: string[];
	conditionIds?: string[];
	tagId?: number;
	relatedTags?: boolean;
	closed?: boolean;
	includeTag?: boolean;
	order?: string;
	ascending?: boolean;
	limit?: number;
	offset?: number;
};

export type ListEventsParams = {
	tagId?: number;
	relatedTags?: boolean;
	closed?: boolean;
	order?: string;
	ascending?: boolean;
	limit?: number;
	offset?: number;
};

function buildMarketQuery(params?: ListMarketsParams): QueryParams {
	if (!params) return {};
	return {
		id: params.ids,
		slug: params.slugs,
		clob_token_ids: params.clobTokenIds,
		condition_ids: params.conditionIds,
		tag_id: params.tagId,
		related_tags: params.relatedTags,
		closed: params.closed,
		include_tag: params.includeTag,
		order: params.order,
		ascending: params.ascending,
		limit: params.limit,
		offset: params.offset,
	};
}

function buildEventQuery(params?: ListEventsParams): QueryParams {
	if (!params) return {};
	return {
		tag_id: params.tagId,
		related_tags: params.relatedTags,
		closed: params.closed,
		order: params.order,
		ascending: params.ascending,
		limit: params.limit,
		offset: params.offset,
	};
}

export async function listMarkets(
	client: GammaClient,
	params?: ListMarketsParams,
): Promise<GammaMarket[]> {
	const raw = await client.fetchJson<GammaMarketRaw[]>("/markets", buildMarketQuery(params));
	return raw.map(normalizeMarket);
}

export async function getMarketById(
	client: GammaClient,
	id: string | number,
	opts?: { includeTags?: boolean },
): Promise<GammaMarket> {
	const raw = await client.fetchJson<GammaMarketRaw>(
		`/markets/${id}`,
		opts?.includeTags ? { include_tag: true } : undefined,
	);
	return normalizeMarket(raw);
}

export async function getMarketBySlug(
	client: GammaClient,
	slug: string,
	opts?: { includeTags?: boolean },
): Promise<GammaMarket> {
	const raw = await client.fetchJson<GammaMarketRaw>(
		`/markets/slug/${slug}`,
		opts?.includeTags ? { include_tag: true } : undefined,
	);
	return normalizeMarket(raw);
}

export async function getMarketByClobTokenId(
	client: GammaClient,
	tokenId: string,
): Promise<GammaMarket | null> {
	const markets = await listMarkets(client, {
		clobTokenIds: [tokenId],
		limit: 1,
	});
	if (!markets.length) return null;
	const [first] = markets;
	return {
		...first,
		clobTokenIds: first.clobTokenIds ?? [tokenId],
	};
}

export async function listEvents(
	client: GammaClient,
	params?: ListEventsParams,
): Promise<GammaEvent[]> {
	const raw = await client.fetchJson<GammaEventRaw[]>("/events", buildEventQuery(params));
	return raw.map(normalizeEvent);
}

export async function getEventBySlug(
	client: GammaClient,
	slug: string,
): Promise<GammaEvent> {
	const raw = await client.fetchJson<GammaEventRaw>(`/events/slug/${slug}`);
	return normalizeEvent(raw);
}

export async function getEventById(
	client: GammaClient,
	id: string | number,
): Promise<GammaEvent> {
	const raw = await client.fetchJson<GammaEventRaw>(`/events/${id}`);
	return normalizeEvent(raw);
}
