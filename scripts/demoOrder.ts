import { ClobClient, OrderType, Side } from "@polymarket/clob-client/src";
import { Wallet } from "ethers";

/**
 * Minimal standalone script to place a BUY order on Polymarket CLOB.
 * Usage:
 *   bun run scripts/demoOrder.ts <tokenId> [price] [size]
 *
 * Env required:
 *   PRIVATE_KEY          EOA private key (0x...)
 *   CLOB_API_KEY         L2 header api key
 *   CLOB_API_SECRET      L2 header secret
 *   CLOB_API_PASSPHRASE  L2 header passphrase
 *   FUNDING_ADDRESS      Address that holds USDC.e (funder/maker)
 *
 * Optional:
 *   CLOB_REST_URL (default https://clob.polymarket.com)
 *   SIGNATURE_TYPE (0 = EOA, 1 = POLY_PROXY, 2 = POLY_GNOSIS_SAFE)
 */
async function main() {
	const tokenId = process.argv[2];
	if (!tokenId) {
		throw new Error(
			"Usage: bun run scripts/demoOrder.ts <tokenId> [price] [size]",
		);
	}

	const price = process.argv[3] ? Number(process.argv[3]) : 0.001; // $0.001 default
	const size = process.argv[4] ? Number(process.argv[4]) : 1; // tokens

	const privateKey = Bun.env.PRIVATE_KEY;
	const apiKey = Bun.env.CLOB_API_KEY;
	const apiSecret = Bun.env.CLOB_API_SECRET;
	const apiPassphrase = Bun.env.CLOB_API_PASSPHRASE;
	const funder = Bun.env.FUNDING_ADDRESS;
	const signatureType = Number(Bun.env.SIGNATURE_TYPE || 0);

	if (!privateKey || !apiKey || !apiSecret || !apiPassphrase || !funder) {
		throw new Error(
			"Missing env: PRIVATE_KEY, CLOB_API_KEY/SECRET/PASSPHRASE, FUNDING_ADDRESS",
		);
	}

	const restUrl = Bun.env.CLOB_REST_URL || "https://clob.polymarket.com";
	const chainId = 137;

	const signer = new Wallet(privateKey);

	const client = new ClobClient(
		restUrl,
		chainId,
		signer,
		{
			key: apiKey,
			secret: apiSecret,
			passphrase: apiPassphrase,
		},
		signatureType,
		funder,
	);

	console.log("Preparing order", { tokenId, price, size });

	const order = await client.createOrder({
		tokenID: tokenId,
		price,
		size,
		side: Side.BUY,
		feeRateBps: 0,
	});

	const resp = await client.postOrder(order, OrderType.FOK);
	console.log("Order response", resp);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
