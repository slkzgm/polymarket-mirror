import { createPublicClient, getAddress, webSocket } from "viem";
import { polygon } from "viem/chains";
import { createTokenResolver } from "../src/clob/resolver";
import { loadConfig } from "../src/config";
import { createGammaClient, createGammaResolver } from "../src/gamma";
import { createLogger } from "../src/logger";
import {
	computeFillForTarget,
	decodeMatchOrders,
	inferRoleAndSide,
} from "../src/onchain/decoder";

const TARGET_ADDRESS = getAddress("0x557bEd924A1bB6F62842C5742d1dc789B8D480d4");
const DISPLAY_DECIMALS = 6n;
const DECIMAL_BASE = 10n ** DISPLAY_DECIMALS;

function formatUnits(raw: string | undefined): string {
	if (!raw) return "n/a";
	try {
		const value = BigInt(raw);
		const intPart = value / DECIMAL_BASE;
		const fracPart = value % DECIMAL_BASE;
		if (fracPart === 0n) return intPart.toString();
		const fracStr = fracPart.toString().padStart(Number(DISPLAY_DECIMALS), "0");
		const trimmed = fracStr.replace(/0+$/, "");
		return `${intPart.toString()}.${trimmed}`;
	} catch {
		return raw;
	}
}

function formatReadableLines(args: {
	target: string;
	marketTitle?: string;
	marketSlug?: string;
	side?: string;
	tokenAmount?: string;
	usdcAmount?: string;
	hash?: string;
	closed?: boolean;
}): string[] {
	const marketLabel = args.marketTitle || args.marketSlug || "Unknown market";
	const side = args.side ?? "UNKNOWN";
	const shares = formatUnits(args.tokenAmount);
	const usdc = formatUnits(args.usdcAmount);
	const closed =
		args.closed === undefined ? "" : args.closed ? " (closed)" : "";
	const header = `${args.target} - ${marketLabel}${closed}`;
	const body = `${side} ${shares} shares for ${usdc} USDC`;
	const tail = args.hash ? `  hash: ${args.hash}` : undefined;
	return tail ? [header, `  ${body}`, tail] : [header, `  ${body}`];
}

async function main() {
	const hash = process.argv[2];
	if (!hash) {
		// eslint-disable-next-line no-console
		console.error("Usage: bun run scripts/decode-tx.ts <txHash>");
		process.exit(1);
	}

	const logger = createLogger();
	const config = loadConfig();
	const client = createPublicClient({
		chain: polygon,
		transport: webSocket(config.rpcWssUrl),
	});

	const tokenResolver = createTokenResolver(config.clobRestUrl, logger);
	const gammaClient = createGammaClient(
		config.gammaApiUrl,
		logger,
		config.gammaApiKey,
	);
	const gammaResolver = createGammaResolver(gammaClient, logger);

	logger.info("Fetching transaction", { hash });
	const tx = await client.getTransaction({ hash: hash as `0x${string}` });
	if (!tx) {
		logger.error("Transaction not found", { hash });
		process.exit(1);
	}

	const input = (tx as { input?: string; data?: string }).input ?? "";
	const decoded = input ? decodeMatchOrders(input) : null;
	const info = decoded ? inferRoleAndSide(decoded, TARGET_ADDRESS) : null;
	const takerFill = decoded?.args?.[2];
	const takerReceive = decoded?.args?.[3];
	const tokenId = info?.tokenId;

	const makerOrders = (decoded?.args?.[1] ?? []) as Array<
		Record<string, unknown>
	>;
	const makerFillAmounts = (decoded?.args?.[4] ?? []) as Array<bigint>;
	const takerOrder = decoded?.args?.[0] as Record<string, unknown> | undefined;

	const [tokenInfo, market] = await Promise.all([
		tokenId ? tokenResolver.resolve(tokenId) : Promise.resolve(null),
		tokenId
			? gammaResolver.resolveByClobTokenId(tokenId)
			: Promise.resolve(null),
	]);

	const breakdown = computeFillForTarget(decoded, TARGET_ADDRESS);
	const shares =
		breakdown?.shares ?? (takerReceive ? String(takerReceive) : undefined);
	const usdc = breakdown?.usdc ?? (takerFill ? String(takerFill) : undefined);

	const lines = formatReadableLines({
		target: breakdown?.role ?? info?.role ?? "UNKNOWN",
		marketTitle: market?.question,
		marketSlug: market?.slug,
		side: breakdown?.side ?? info?.side,
		tokenAmount: shares,
		usdcAmount: usdc,
		hash,
		closed: market?.closed,
	});

	for (const line of lines) {
		// eslint-disable-next-line no-console
		console.log(line);
	}

	// Emit structured details for debugging if needed.
	logger.debug("decoded details", {
		hash,
		role: info?.role,
		side: info?.side,
		tokenId,
		takerFill: takerFill ? String(takerFill) : undefined,
		takerReceive: takerReceive ? String(takerReceive) : undefined,
		marketId: tokenInfo?.marketId,
		marketSlug: market?.slug,
		makerOrders: makerOrders.map((m, idx) => ({
			index: idx,
			maker: (m as { maker?: string }).maker,
			signer: (m as { signer?: string }).signer,
			side: (m as { side?: number }).side,
			makerAmount: String((m as { makerAmount?: bigint }).makerAmount ?? ""),
			takerAmount: String((m as { takerAmount?: bigint }).takerAmount ?? ""),
			fill: makerFillAmounts[idx] ? String(makerFillAmounts[idx]) : "",
		})),
		takerOrder: takerOrder
			? {
					maker: (takerOrder as { maker?: string }).maker,
					signer: (takerOrder as { signer?: string }).signer,
					side: (takerOrder as { side?: number }).side,
					makerAmount: String(
						(takerOrder as { makerAmount?: bigint }).makerAmount ?? "",
					),
					takerAmount: String(
						(takerOrder as { takerAmount?: bigint }).takerAmount ?? "",
					),
				}
			: undefined,
	});
}

main().catch((err) => {
	// eslint-disable-next-line no-console
	console.error("decode failed", err);
	process.exit(1);
});
