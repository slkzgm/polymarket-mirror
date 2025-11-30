import crypto from "node:crypto";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";

type OrderSide = 0 | 1; // 0 = BUY, 1 = SELL
type SignatureType = 0 | 1 | 2;

const domain = {
	name: "Polygon Prediction Market",
	version: "1.0",
	chainId: 137,
	verifyingContract: "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E", // CTF Exchange
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

function nowSec(): string {
	return Math.floor(Date.now() / 1000).toString();
}

function buildOrderAmounts(_side: OrderSide, price: number, size: number) {
	// price in USD, size in tokens (1e18), USDC.e is 1e6
	const makerAmount = BigInt(Math.round(size * 1e18));
	const takerAmount = BigInt(Math.round(price * 1e6 * size));
	return { makerAmount, takerAmount };
}

async function main() {
	const tokenId = process.argv[2];
	if (!tokenId) {
		throw new Error(
			"Usage: bun run scripts/demoOrderViem.ts <tokenId> [price] [size] [side]",
		);
	}
	const price = process.argv[3] ? Number(process.argv[3]) : 0.01;
	const size = process.argv[4] ? Number(process.argv[4]) : 5;
	const sideStr = (process.argv[5] || "BUY").toUpperCase();
	const side: OrderSide = sideStr === "SELL" ? 1 : 0;

	const privateKey = Bun.env.PRIVATE_KEY;
	const funder = Bun.env.FUNDING_ADDRESS;
	const signatureType = Number(Bun.env.SIGNATURE_TYPE || 0) as SignatureType;
	const apiKey = Bun.env.CLOB_API_KEY;
	const apiSecret = Bun.env.CLOB_API_SECRET;
	const apiPassphrase = Bun.env.CLOB_API_PASSPHRASE;
	const restUrl = Bun.env.CLOB_REST_URL || "https://clob.polymarket.com";

	if (!privateKey || !funder || !apiKey || !apiSecret || !apiPassphrase) {
		throw new Error(
			"Missing env PRIVATE_KEY/FUNDING_ADDRESS/CLOB_API_KEY/SECRET/PASSPHRASE",
		);
	}

	// Fetch tick size/min size
	const t0 = Date.now();
	const bookRes = await fetch(
		`${restUrl.replace(/\/$/, "")}/book?token_id=${tokenId}`,
	);
	if (!bookRes.ok) throw new Error(`book fetch failed: ${bookRes.status}`);
	const book = await bookRes.json();
	const tickSize = Number(book.tick_size);
	const minOrderSize = Number(book.min_order_size);

	if (price < tickSize || price > 1 - tickSize || price % tickSize !== 0) {
		throw new Error(`invalid price ${price}, tickSize ${tickSize}`);
	}
	if (size < minOrderSize) {
		throw new Error(`size ${size} below min_order_size ${minOrderSize}`);
	}

	const { makerAmount, takerAmount } = buildOrderAmounts(side, price, size);
	const salt =
		BigInt(crypto.randomBytes(16).readBigUInt64BE()) * 1000000n +
		BigInt(Date.now());

	const account = privateKeyToAccount(privateKey as `0x${string}`);

	const walletClient: WalletClient = createWalletClient({
		account,
		chain: polygon,
		transport: http(Bun.env.POLYGON_RPC_WSS || ""),
	});

	const order = {
		salt,
		maker: funder as `0x${string}`,
		signer: walletClient.account.address,
		taker: "0x0000000000000000000000000000000000000000" as const,
		tokenId: BigInt(tokenId),
		makerAmount,
		takerAmount,
		expiration: 0n,
		nonce: 0n,
		feeRateBps: 0n,
		side,
		signatureType,
		signature: "0x",
	};

	const t1 = Date.now();
	const signature = await walletClient.signTypedData({
		domain,
		types,
		primaryType: "Order",
		message: order,
	});
	const t2 = Date.now();

	const signedOrder = { ...order, signature };
	const serializedOrder = {
		...signedOrder,
		salt: signedOrder.salt.toString(),
		tokenId: signedOrder.tokenId.toString(),
		makerAmount: signedOrder.makerAmount.toString(),
		takerAmount: signedOrder.takerAmount.toString(),
		expiration: Number(signedOrder.expiration),
		nonce: Number(signedOrder.nonce),
		feeRateBps: Number(signedOrder.feeRateBps),
	};

	const body = JSON.stringify({
		deferExec: false,
		order: serializedOrder,
		owner: apiKey,
		orderType: "FOK",
	});

	const ts = nowSec();
	const msg = `${ts}POST/order${body}`;
	const l2Sig = hmacBase64(msg, apiSecret);

	const headers = {
		Accept: "*/*",
		"Content-Type": "application/json",
		POLY_API_KEY: apiKey,
		POLY_PASSPHRASE: apiPassphrase,
		POLY_SIGNATURE: l2Sig,
		POLY_TIMESTAMP: ts,
		POLY_ADDRESS: walletClient.account.address,
	};

	const t3 = Date.now();
	const resp = await fetch(`${restUrl.replace(/\/$/, "")}/order`, {
		method: "POST",
		headers,
		body,
	});
	const t4 = Date.now();
	const respText = await resp.text();

	console.log("timings_ms", {
		book: t1 - t0,
		sign: t2 - t1,
		post: t4 - t3,
		total: t4 - t0,
		status: resp.status,
	});
	console.log("response", resp.status, respText);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
