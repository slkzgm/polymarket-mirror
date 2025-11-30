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
