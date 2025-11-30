import { decodeFunctionData, parseAbi } from "viem";

export const MATCH_SELECTOR = "0x2287e350";

const matchOrdersAbi = parseAbi([
	"function matchOrders((uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType,bytes signature) takerOrder,(uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType,bytes signature)[] makerOrders,uint256 takerFillAmount,uint256 takerReceiveAmount,uint256[] makerFillAmounts,uint256 takerFeeAmount,uint256[] makerFeeAmounts)",
]);

export type MatchDecoded = {
	functionName: string;
	args?: [
		takerOrder: Record<string, unknown>,
		makerOrders: Array<Record<string, unknown>>,
		takerFillAmount: bigint,
		takerReceiveAmount: bigint,
		makerFillAmounts: bigint[],
		takerFeeAmount: bigint,
		makerFeeAmounts: bigint[],
	];
};

export function matchesCalldata(
	rawData: unknown,
	needle: string,
	selector: string = MATCH_SELECTOR,
): boolean {
	if (!rawData || typeof rawData !== "string") return false;
	const data = rawData.toLowerCase();
	if (!data.startsWith(selector)) return false;
	return data.includes(needle.toLowerCase());
}

export function decodeMatchOrders(data: string): MatchDecoded | null {
	try {
		return decodeFunctionData({ abi: matchOrdersAbi, data });
	} catch {
		return null;
	}
}

export function inferRoleAndSide(
	decoded: MatchDecoded | null,
	targetAddress: string,
): {
	role: "MAKER" | "TAKER" | "UNKNOWN";
	side: "BUY" | "SELL" | "UNKNOWN";
	tokenId?: string;
} | null {
	if (!decoded || decoded.functionName !== "matchOrders") return null;
	const takerOrder = decoded.args?.[0] ?? {};
	const makerOrders = decoded.args?.[1] ?? [];

	const targetLower = targetAddress.toLowerCase();
	const takerMaker = (takerOrder as { maker?: string }).maker?.toLowerCase();
	const takerSigner = (takerOrder as { signer?: string }).signer?.toLowerCase();
	const takerRole =
		takerMaker === targetLower || takerSigner === targetLower ? "TAKER" : null;

	const makerHit = makerOrders.find(
		(m) => (m as { maker?: string }).maker?.toLowerCase() === targetLower,
	);
	const makerRole = makerHit ? "MAKER" : null;

	const role = takerRole ?? makerRole ?? "UNKNOWN";
	const sideValue = (takerOrder as { side?: number }).side;
	const side = sideValue === 0 ? "BUY" : sideValue === 1 ? "SELL" : "UNKNOWN";
	const tokenId = (takerOrder as { tokenId?: bigint | string }).tokenId;

	return { role, side, tokenId: tokenId ? String(tokenId) : undefined };
}

export type FillBreakdown = {
	role: "MAKER" | "TAKER" | "UNKNOWN";
	side: "BUY" | "SELL" | "UNKNOWN";
	tokenId?: string;
	shares?: string;
	usdc?: string;
};

function safeBigInt(value: unknown): bigint | null {
	if (value === undefined || value === null) return null;
	try {
		return BigInt(value as bigint);
	} catch {
		return null;
	}
}

function computeMakerFill(
	order: Record<string, unknown>,
	fillAmount: bigint,
): { shares?: bigint; usdc?: bigint } {
	const side = (order as { side?: number }).side;
	const makerAmount = safeBigInt(
		(order as { makerAmount?: bigint }).makerAmount,
	);
	const takerAmount = safeBigInt(
		(order as { takerAmount?: bigint }).takerAmount,
	);
	if (!makerAmount || !takerAmount || makerAmount === 0n) {
		return {
			shares: side === 1 ? fillAmount : undefined,
			usdc: side === 0 ? fillAmount : undefined,
		};
	}

	if (side === 0) {
		// Maker BUY: pays makerAmount (USDC), receives takerAmount (shares)
		return {
			usdc: fillAmount,
			shares: (fillAmount * takerAmount) / makerAmount,
		};
	}

	if (side === 1) {
		// Maker SELL: sells makerAmount (shares), receives takerAmount (USDC)
		return {
			shares: fillAmount,
			usdc: (fillAmount * takerAmount) / makerAmount,
		};
	}

	return {};
}

export function computeFillForTarget(
	decoded: MatchDecoded | null,
	targetAddress: string,
): FillBreakdown | null {
	if (!decoded || decoded.functionName !== "matchOrders") return null;
	const target = targetAddress.toLowerCase();
	const takerOrder = decoded.args?.[0] ?? {};
	const makerOrders = decoded.args?.[1] ?? [];
	const takerFillAmount = decoded.args?.[2];
	const takerReceiveAmount = decoded.args?.[3];
	const makerFillAmounts = decoded.args?.[4] ?? [];

	const takerRole =
		(takerOrder as { maker?: string }).maker?.toLowerCase() === target ||
		(takerOrder as { signer?: string }).signer?.toLowerCase() === target;

	const makerMatches = makerOrders
		.map((order, idx) => ({ order, idx }))
		.filter(
			(entry) =>
				(entry.order as { maker?: string }).maker?.toLowerCase() === target ||
				(entry.order as { signer?: string }).signer?.toLowerCase() === target,
		);

	const role = takerRole
		? "TAKER"
		: makerMatches.length > 0
			? "MAKER"
			: "UNKNOWN";
	const sideVal = (takerOrder as { side?: number }).side;
	const side =
		sideVal === 0 ? "BUY" : sideVal === 1 ? "SELL" : ("UNKNOWN" as const);
	const tokenId = (takerOrder as { tokenId?: bigint | string }).tokenId;

	let shares: bigint | undefined;
	let usdc: bigint | undefined;

	if (role === "TAKER") {
		const makerAmount = safeBigInt(
			(takerOrder as { makerAmount?: bigint }).makerAmount,
		);
		const takerAmount = safeBigInt(
			(takerOrder as { takerAmount?: bigint }).takerAmount,
		);
		const fill = safeBigInt(takerFillAmount);
		const receive = safeBigInt(takerReceiveAmount);

		if (side === "BUY") {
			usdc = fill ?? undefined;
			shares =
				receive ??
				(fill && makerAmount && takerAmount && makerAmount !== 0n
					? (fill * takerAmount) / makerAmount
					: undefined);
		} else if (side === "SELL") {
			shares = fill ?? undefined;
			usdc =
				receive ??
				(fill && makerAmount && takerAmount && makerAmount !== 0n
					? (fill * takerAmount) / makerAmount
					: undefined);
		}
	}

	if (role === "MAKER") {
		let sharesSum = 0n;
		let usdcSum = 0n;

		for (const { order, idx } of makerMatches) {
			const fill = safeBigInt(makerFillAmounts[idx]);
			if (fill === null) continue;
			const { shares: s, usdc: u } = computeMakerFill(order, fill);
			if (s !== undefined) sharesSum += s;
			if (u !== undefined) usdcSum += u;
		}

		shares = sharesSum > 0n ? sharesSum : shares;
		usdc = usdcSum > 0n ? usdcSum : usdc;
	}

	return {
		role,
		side,
		tokenId: tokenId ? String(tokenId) : undefined,
		shares: shares !== undefined ? String(shares) : undefined,
		usdc: usdc !== undefined ? String(usdc) : undefined,
	};
}
