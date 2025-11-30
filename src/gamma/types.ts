export type GammaTag = {
	id: number;
	name?: string | null;
	slug?: string | null;
	type?: string | null;
};

export type GammaMarketRaw = {
	id: string;
	slug?: string | null;
	question?: string | null;
	conditionId: string;
	marketMakerAddress?: string | null;
	startDate?: string | null;
	endDate?: string | null;
	category?: string | null;
	liquidityNum?: number | null;
	volumeNum?: number | null;
	closed?: boolean | null;
	active?: boolean | null;
	outcomes?: string[] | string | null;
	outcomePrices?: string[] | string | null;
	tags?: GammaTag[] | null;
	clobTokenIds?: string[] | null;
};

export type GammaMarket = {
	id: string;
	slug?: string;
	question?: string;
	conditionId: string;
	marketMakerAddress?: string;
	startDate?: string;
	endDate?: string;
	category?: string;
	liquidityNum?: number;
	volumeNum?: number;
	closed?: boolean;
	active?: boolean;
	outcomes?: string[];
	outcomePrices?: number[];
	tags?: GammaTag[];
	clobTokenIds?: string[];
	raw?: GammaMarketRaw;
};

export type GammaEventRaw = {
	id: string;
	slug?: string | null;
	title?: string | null;
	description?: string | null;
	startDate?: string | null;
	endDate?: string | null;
	negRisk?: boolean | null;
	closed?: boolean | null;
	markets?: GammaMarketRaw[] | null;
	tags?: GammaTag[] | null;
};

export type GammaEvent = {
	id: string;
	slug?: string;
	title?: string;
	description?: string;
	startDate?: string;
	endDate?: string;
	negRisk?: boolean;
	closed?: boolean;
	markets?: GammaMarket[];
	tags?: GammaTag[];
	raw?: GammaEventRaw;
};
