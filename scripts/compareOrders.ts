import crypto from "node:crypto";
import { ClobClient, OrderType, Side } from "@polymarket/clob-client/src";
import { Wallet } from "ethers";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

type OrderSide = 0 | 1; // 0 BUY, 1 SELL
type SignatureType = 0 | 1 | 2;

const domain = {
	name: "Polygon Prediction Market",
	version: "1.0",
	chainId: 137,
	verifyingContract: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E",
};

const types = {
	Order: [
		{ name: "salt", type: "uint256" },
		{ name: "maker", type: "address" },
		{ name: "signer", type: "address" },
		{ name: "taker", type: "address" },
		{ name: "tokenId", type: "uint256" },
		{ name: "makerAmount", type: "uint256" },
		{ name: "takerAmount", type: "uint256" },
		{ name: "expiration", type: "uint256" },
		{ name: "nonce", type: "uint256" },
		{ name: "feeRateBps", type: "uint256" },
		{ name: "side", type: "uint8" },
		{ name: "signatureType", type: "uint8" },
		{ name: "signature", type: "bytes" },
	],
};

function hmacBase64(msg: string, secretBase64: string): string {
	const key = Buffer.from(secretBase64, "base64");
	return crypto.createHmac("sha256", key).update(msg).digest("base64");
}

function buildAmounts(_side: OrderSide, price: number, sizeTokens: number) {
	const makerAmount = BigInt(Math.round(sizeTokens * 1e18));
	const takerAmount = BigInt(Math.round(price * 1e6 * sizeTokens));
	return { makerAmount, takerAmount };
}

async function main() {
	const tokenId = process.argv[2];
	if (!tokenId) {
		console.error("Usage: bun run scripts/compareOrders.ts <tokenId> [price] [usdAmount]");
		process.exit(1);
	}
	const priceInput = process.argv[3] ? Number(process.argv[3]) : undefined;
	const usdAmount = process.argv[4] ? Number(process.argv[4]) : 0.01;

	const privateKey = Bun.env.PRIVATE_KEY;
	const funder = Bun.env.FUNDING_ADDRESS;
	const signatureType = Number(Bun.env.SIGNATURE_TYPE || 0) as SignatureType;
	const apiKey = Bun.env.CLOB_API_KEY;
	const apiSecret = Bun.env.CLOB_API_SECRET;
	const apiPassphrase = Bun.env.CLOB_API_PASSPHRASE;
	const restUrl = (Bun.env.CLOB_REST_URL || "https://clob.polymarket.com").replace(/\/$/, "");
	const rpc = Bun.env.POLYGON_RPC_WSS || "";

	if (!privateKey || !funder || !apiKey || !apiSecret || !apiPassphrase) {
		throw new Error("Missing env PRIVATE_KEY/FUNDING_ADDRESS/CLOB_API_*");
	}

	// Shared /book fetch (fair comparison)
	const tMeta0 = Date.now();
	const bookRes = await fetch(`${restUrl}/book?token_id=${tokenId}`);
	if (!bookRes.ok) throw new Error(`book fetch failed: ${bookRes.status}`);
	const book = await bookRes.json();
	const tMeta1 = Date.now();

	const tickSize = Number(book.tick_size);
	const minOrderSize = Number(book.min_order_size);
	const bestAsk = book.asks?.[0]?.price ? Number(book.asks[0].price) : tickSize;
	const price = priceInput ?? bestAsk;

	if (price < tickSize || price > 1 - tickSize || price % tickSize !== 0) {
		throw new Error(`invalid price ${price}, tickSize ${tickSize}`);
	}
	const sizeTokens = usdAmount / price;
	if (sizeTokens < minOrderSize) {
		throw new Error(`size ${sizeTokens} below min_order_size ${minOrderSize}`);
	}

	const { makerAmount, takerAmount } = buildAmounts(0, price, sizeTokens);

	const account = privateKeyToAccount(privateKey as `0x${string}`);
	const walletClient = createWalletClient({
		account,
		chain: polygon,
		transport: http(rpc),
	});

	// -------- clob-client path: measure create+post --------
	const signer = new Wallet(privateKey);
	const client = new ClobClient(
		restUrl,
		137,
		signer,
		{
			key: apiKey,
			secret: apiSecret,
			passphrase: apiPassphrase,
		},
		signatureType,
		funder,
	);

	const c0 = Date.now();
	const orderClient = await client.createOrder(
		{
			tokenID: tokenId,
			price,
			size: sizeTokens,
			side: Side.BUY,
			feeRateBps: 0,
		},
		{ tickSize },
	);
	const c1 = Date.now();
	const respClient = await client.postOrder(orderClient, OrderType.FOK);
	const c2 = Date.now();

	// -------- viem path: measure sign + post --------
	const salt =
		BigInt(crypto.randomBytes(8).readBigUInt64BE()) * 1000000n + BigInt(Date.now());
	const order = {
		salt,
		maker: funder as `0x${string}`,
		signer: account.address,
		taker: "0x0000000000000000000000000000000000000000" as const,
		tokenId: BigInt(tokenId),
		makerAmount,
		takerAmount,
		expiration: 0n,
		nonce: 0n,
		feeRateBps: 0n,
		side: 0 satisfies OrderSide,
		signatureType,
		signature: "0x",
	};

	const v0 = Date.now();
	const signature = await walletClient.signTypedData({
		domain,
		types,
		primaryType: "Order",
		message: order,
	});
	const v1 = Date.now();

	const serializedOrder = {
		...order,
		salt: order.salt.toString(),
		tokenId: order.tokenId.toString(),
		makerAmount: order.makerAmount.toString(),
		takerAmount: order.takerAmount.toString(),
		expiration: Number(order.expiration),
		nonce: Number(order.nonce),
		feeRateBps: Number(order.feeRateBps),
		signature,
	};

	const body = JSON.stringify({
		deferExec: false,
		order: serializedOrder,
		owner: apiKey,
		orderType: "FOK",
	});

	const ts = Math.floor(Date.now() / 1000).toString();
	const msg = `${ts}POST/order${body}`;
	const l2Sig = hmacBase64(msg, apiSecret);

	const headers = {
		Accept: "*/*",
		"Content-Type": "application/json",
		POLY_API_KEY: apiKey,
		POLY_PASSPHRASE: apiPassphrase,
		POLY_SIGNATURE: l2Sig,
		POLY_TIMESTAMP: ts,
		POLY_ADDRESS: account.address,
	};

	const v2 = Date.now();
	const respViem = await fetch(`${restUrl}/order`, {
		method: "POST",
		headers,
		body,
	});
	const v3 = Date.now();
	const respViemText = await respViem.text();

	console.log("shared_meta_ms", { book: tMeta1 - tMeta0, price, sizeTokens, tickSize, minOrderSize });
	console.log("clob-client timings_ms", { create: c1 - c0, post: c2 - c1, total: c2 - c0 });
	console.log("clob-client resp", respClient);

	console.log("viem timings_ms", { sign: v1 - v0, post: v3 - v2, total: v3 - v0 });
	console.log("viem resp", respViem.status, respViemText);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
