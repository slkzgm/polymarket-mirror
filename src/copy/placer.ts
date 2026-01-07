import { Chain, ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { SignatureType } from "@polymarket/order-utils";
import { Wallet } from "ethers";
import type { AppConfig } from "../config";
import type { Logger } from "../logger";
import type { CopyIntent } from "./types";

type PlaceResult =
	| { status: "simulated"; intent: CopyIntent }
	| { status: "posted"; intent: CopyIntent; orderHash?: string }
	| { status: "skipped"; intent: CopyIntent; reason: string };

function roundToDecimals(value: number, decimals: number): number {
	if (!Number.isFinite(value)) return 0;
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

function toOrderType(value: AppConfig["copyOrderType"]): OrderType {
	switch (value) {
		case "FOK":
			return OrderType.FOK;
		case "GTC":
			return OrderType.GTC;
		case "GTD":
			return OrderType.GTD;
		default:
			return OrderType.FAK;
	}
}

export function createCopyPlacer(config: AppConfig, logger: Logger) {
	const signatureType =
		config.signatureType === 1
			? SignatureType.POLY_PROXY
			: config.signatureType === 2
				? SignatureType.POLY_GNOSIS_SAFE
				: SignatureType.EOA;

	const creds =
		config.clobApiKey && config.clobApiSecret && config.clobApiPassphrase
			? {
					key: config.clobApiKey,
					secret: config.clobApiSecret,
					passphrase: config.clobApiPassphrase,
				}
			: undefined;

	const signer = config.privateKey ? new Wallet(config.privateKey) : undefined;

	const hasCreds =
		Boolean(signer) &&
		Boolean(creds?.key) &&
		Boolean(creds?.secret) &&
		Boolean(creds?.passphrase);

	const enabled = !config.copySimulateOnly && hasCreds;

	const client = enabled
		? new ClobClient(
				config.clobRestUrl,
				Chain.POLYGON,
				signer as Wallet,
				creds,
				signatureType,
				config.fundingAddress,
			)
		: null;

	if (!enabled) {
		logger.warn("copy trading in simulate-only (missing signer or API creds)", {
			hasPrivateKey: Boolean(config.privateKey),
			hasApiKey: Boolean(config.clobApiKey),
			hasApiSecret: Boolean(config.clobApiSecret),
			hasApiPassphrase: Boolean(config.clobApiPassphrase),
		});
	}

	async function place(intent: CopyIntent): Promise<PlaceResult> {
		if (!enabled || !client) {
			logger.info("copy simulate", {
				side: intent.side,
				tokenId: intent.tokenId,
				size: intent.size,
				price: intent.price,
				hash: intent.hash,
			});
			return { status: "simulated", intent };
		}

		try {
			const orderType = toOrderType(config.copyOrderType);
			const isMarket =
				orderType === OrderType.FOK || orderType === OrderType.FAK;

			let res: unknown;

			if (isMarket) {
				if (intent.side === Side.BUY) {
					const amount = roundToDecimals(intent.notional, 2);
					if (amount <= 0) {
						return {
							status: "skipped",
							intent,
							reason: "amount rounded to zero",
						};
					}
					const order = await client.createMarketOrder({
						tokenID: intent.tokenId,
						amount,
						side: intent.side,
						price: intent.price,
					});
					res = await client.postOrder(order, orderType);
				} else {
					const amount = roundToDecimals(intent.size, 4);
					if (amount <= 0) {
						return {
							status: "skipped",
							intent,
							reason: "amount rounded to zero",
						};
					}
					const order = await client.createMarketOrder({
						tokenID: intent.tokenId,
						amount,
						side: intent.side,
						price: intent.price,
					});
					res = await client.postOrder(order, orderType);
				}
			} else {
				const price = roundToDecimals(intent.price, 4);
				const size = roundToDecimals(intent.size, 4);
				if (price <= 0 || size <= 0) {
					return {
						status: "skipped",
						intent,
						reason: "price/size rounded to zero",
					};
				}
				const order = await client.createOrder({
					tokenID: intent.tokenId,
					price,
					size,
					side: intent.side as Side,
				});
				res = await client.postOrder(order, orderType);
			}

			logger.info("copy posted", {
				side: intent.side,
				tokenId: intent.tokenId,
				size: intent.size,
				price: intent.price,
				orderType,
				hash: intent.hash,
			});
			return { status: "posted", intent, orderHash: res?.orderId ?? res };
		} catch (err) {
			logger.warn("copy placement failed", {
				err: String(err),
				side: intent.side,
				tokenId: intent.tokenId,
				size: intent.size,
				price: intent.price,
				hash: intent.hash,
			});
			return { status: "skipped", intent, reason: String(err) };
		}
	}

	return { place };
}
