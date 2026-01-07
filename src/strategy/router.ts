import { getAddress } from "viem";
import { createTokenResolver } from "../clob/resolver";
import type { AppConfig } from "../config";
import { createCopyHandler } from "../copy";
import type { EventBus } from "../events/bus";
import { createGammaClient, createGammaResolver } from "../gamma";
import type { Logger } from "../logger";
import { computeFillForTarget } from "../onchain/decoder";
import type { AppEvent } from "../types";

const DISPLAY_DECIMALS = 6n;
const DECIMAL_BASE = 10n ** DISPLAY_DECIMALS;
const TARGET_ADDRESS = getAddress("0x557bEd924A1bB6F62842C5742d1dc789B8D480d4");

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
	tokenId?: string;
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

export function attachStrategy(
	bus: EventBus,
	logger: Logger,
	config: AppConfig,
) {
	const tokenResolver = createTokenResolver(config.clobRestUrl, logger);
	const gammaClient = createGammaClient(
		config.gammaApiUrl,
		logger,
		config.gammaApiKey,
	);
	const gammaResolver = createGammaResolver(gammaClient, logger);
	const copyHandler = createCopyHandler(config, logger);

	async function handleOnchainEvent(event: AppEvent) {
		if (event.source !== "onchain") return;
		const info = event.info;
		const hash = (event as { hash?: string }).hash;

		if (!info?.tokenId) {
			logger.info("onchain event", {
				hash,
				role: info?.role,
				side: info?.side,
				tokenId: info?.tokenId,
				takerFill: info?.takerFill,
				takerReceive: info?.takerReceive,
			});
			return;
		}

		const decoded = (event as { decoded?: unknown }).decoded ?? null;
		const breakdown = computeFillForTarget(decoded, TARGET_ADDRESS);

		void copyHandler.handle({
			hash,
			tokenId: info.tokenId,
			side: breakdown?.side ?? info.side ?? "UNKNOWN",
			shares: breakdown?.shares ?? info.takerReceive ?? info.takerFill,
			usdc: breakdown?.usdc ?? info.takerFill ?? info.takerReceive,
		});

		try {
			const [resolved, market] = await Promise.all([
				tokenResolver.resolve(info.tokenId),
				gammaResolver.resolveByClobTokenId(info.tokenId),
			]);

			const shares =
				breakdown?.shares ??
				(info.takerReceive ? String(info.takerReceive) : undefined);
			const usdc =
				breakdown?.usdc ??
				(info.takerFill ? String(info.takerFill) : undefined);

			if (config.logFormat === "readable") {
				const lines = formatReadableLines({
					target: breakdown?.role ?? info.role ?? "UNKNOWN",
					marketTitle: market?.question,
					marketSlug: market?.slug,
					side: breakdown?.side ?? info.side,
					tokenAmount: shares,
					usdcAmount: usdc,
					tokenId: info.tokenId,
					hash,
					closed: market?.closed,
				});
				for (const line of lines) {
					// Emit clean, prefix-free output for operators.
					process.stdout.write(`${line}\n`);
				}
				return;
			} else {
				logger.info("onchain event", {
					hash,
					role: info.role,
					side: info.side,
					tokenId: info.tokenId,
					takerFill: usdc,
					takerReceive: shares,
					marketId: resolved?.marketId,
					assetId: resolved?.assetId,
					marketSlug: market?.slug,
					marketTitle: market?.question,
					marketClosed: market?.closed,
				});
			}
		} catch (err) {
			logger.info("onchain event", {
				hash,
				role: info.role,
				side: info.side,
				tokenId: info.tokenId,
				takerFill: info.takerFill,
				takerReceive: info.takerReceive,
			});
			logger.debug("onchain event enrich error", { err: String(err) });
		}
	}

	const handler = (event: AppEvent) => {
		if (event.source !== "onchain") return;
		void handleOnchainEvent(event);
	};

	bus.on(handler);
	return () => bus.remove(handler);
}
