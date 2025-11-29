import {
	createPublicClient,
	decodeFunctionData,
	getAddress,
	parseAbi,
	webSocket,
} from "viem";
import { polygon } from "viem/chains";
import type { AppConfig } from "../config";
import type { EventBus } from "../events/bus";
import type { Logger } from "../logger";

export type WatcherHandle = { stop: () => void };

type PendingTx = {
	to?: string;
	hash?: string;
	from?: string;
	value?: bigint | string;
	input?: string;
	data?: string;
};

const FEE_MODULE = getAddress("0xE3f18aCc55091e2c48d883fc8C8413319d4Ab7b0");
const TARGET_ADDRESS = getAddress("0x557bEd924A1bB6F62842C5742d1dc789B8D480d4");
const ADDRESS_NEEDLE = TARGET_ADDRESS.slice(2).toLowerCase();
const MATCH_SELECTOR = "0x2287e350";

const matchOrdersAbi = parseAbi([
	"function matchOrders((uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType,bytes signature) takerOrder,(uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType,bytes signature)[] makerOrders,uint256 takerFillAmount,uint256 takerReceiveAmount,uint256[] makerFillAmounts,uint256 takerFeeAmount,uint256[] makerFeeAmounts)",
]);

function makeTargets(config: AppConfig): Set<string> {
	return new Set([FEE_MODULE, ...config.targets.map((t) => getAddress(t))]);
}

function matchesCalldata(rawData: unknown): boolean {
	if (!rawData || typeof rawData !== "string") return false;
	const data = rawData.toLowerCase();
	if (!data.startsWith(MATCH_SELECTOR)) return false;
	return data.includes(ADDRESS_NEEDLE);
}

function decodeMatchOrders(data: string) {
	try {
		return decodeFunctionData({ abi: matchOrdersAbi, data });
	} catch {
		return null;
	}
}

type MatchDecoded = {
	functionName: string;
	args?: [
		takerOrder: Record<string, unknown>,
		makerOrders: Array<Record<string, unknown>>,
	];
};

function inferRoleAndSide(decoded: MatchDecoded | null) {
	if (!decoded || decoded.functionName !== "matchOrders") return null;
	const takerOrder = decoded.args?.[0] ?? {};
	const makerOrders = decoded.args?.[1] ?? [];

	const targetLower = TARGET_ADDRESS.toLowerCase();
	const takerMaker = takerOrder?.maker?.toLowerCase();
	const takerSigner = takerOrder?.signer?.toLowerCase();
	const takerRole =
		takerMaker === targetLower || takerSigner === targetLower ? "TAKER" : null;

	const makerHit = makerOrders.find(
		(m) => m?.maker && m.maker.toLowerCase() === targetLower,
	);
	const makerRole = makerHit ? "MAKER" : null;

	const role = takerRole ?? makerRole ?? "UNKNOWN";
	const sideValue = takerOrder?.side;
	const side = sideValue === 0 ? "BUY" : sideValue === 1 ? "SELL" : "UNKNOWN";
	const tokenId = takerOrder?.tokenId ? String(takerOrder.tokenId) : undefined;

	return { role, side, tokenId };
}

function startAlchemyPendingWatcher(
	client: ReturnType<typeof createPublicClient>,
	targets: Set<string>,
	logger: Logger,
	bus: EventBus,
): () => void {
	type SubResponse = { unsubscribe?: () => void };
	type SubArgs = {
		params: unknown[];
		onData: (data: unknown) => void;
		onError: (err: unknown) => void;
	};
	const transport = client.transport as typeof client.transport & {
		subscribe?: (args: SubArgs) => Promise<SubResponse>;
	};

	const subPromise =
		transport.subscribe?.({
			params: [
				"alchemy_pendingTransactions",
				{
					toAddress: Array.from(targets),
					hashesOnly: false,
				},
			],
			onData: (data: unknown) => {
				const tx = (data as { result?: unknown })?.result ?? data;
				if (!tx || typeof tx !== "object") return;
				if (!("to" in tx) || typeof (tx as { to?: unknown }).to !== "string")
					return;
				const to = getAddress((tx as { to: string }).to);
				if (!targets.has(to)) return;

				const input =
					(tx as { input?: string; data?: string }).input ??
					(tx as { input?: string; data?: string }).data;
				if (!matchesCalldata(input)) return;

				const decoded = input ? decodeMatchOrders(input) : null;
				const info = decoded ? inferRoleAndSide(decoded) : null;

				logger.info("pending tx to target (alchemy)", {
					hash: (tx as { hash?: string }).hash,
					from: (tx as { from?: string }).from,
					valueWei: (tx as { value?: unknown }).value,
					role: info?.role,
					side: info?.side,
					tokenId: info?.tokenId,
				});

				bus.emit({
					source: "onchain",
					hash: (tx as { hash?: string }).hash,
					raw: tx,
				});
			},
			onError: (err: unknown) =>
				logger.warn("pending tx watcher error (alchemy)", { err: String(err) }),
		}) ?? Promise.resolve({ unsubscribe: undefined });

	return () => {
		subPromise
			.then((sub) => sub.unsubscribe?.())
			.catch((err: unknown) =>
				logger.warn("error unsubscribing alchemy pending", {
					err: String(err),
				}),
			);
	};
}

function startStandardPendingWatcher(
	client: ReturnType<typeof createPublicClient>,
	targets: Set<string>,
	logger: Logger,
	bus: EventBus,
): () => void {
	return client.watchPendingTransactions({
		includeTransactions: true,
		onTransactions: (txs: PendingTx[]) => {
			for (const tx of txs) {
				if (!tx?.to) continue;
				const to = getAddress(tx.to);
				if (!targets.has(to)) continue;

				const input = tx.input ?? tx.data;
				if (!matchesCalldata(input)) continue;

				const decoded = input ? decodeMatchOrders(input) : null;
				const info = decoded ? inferRoleAndSide(decoded) : null;

				logger.info("pending tx to target", {
					hash: tx.hash,
					from: tx.from,
					valueWei: tx.value ? tx.value.toString() : undefined,
					role: info?.role,
					side: info?.side,
					tokenId: info?.tokenId,
				});

				bus.emit({ source: "onchain", hash: tx.hash, raw: tx });
			}
		},
		onError: (err: unknown) =>
			logger.warn("pending tx watcher error", { err: String(err) }),
	});
}

export function startOnchainWatcher(
	config: AppConfig,
	logger: Logger,
	bus: EventBus,
): WatcherHandle {
	const client = createPublicClient({
		chain: polygon,
		transport: webSocket(config.rpcWssUrl),
	});

	logger.info("onchain watcher started", { chainId: client.chain?.id });

	const targets = makeTargets(config);
	const useAlchemyPending =
		(config.rpcWssUrl || "").includes("alchemy.com") ||
		(Bun.env.USE_ALCHEMY_PENDING || "").toLowerCase() === "true" ||
		Bun.env.USE_ALCHEMY_PENDING === "1";

	logger.info("pending mode", {
		mode: useAlchemyPending ? "alchemy" : "standard",
	});

	const stopFns: Array<() => void> = [];

	if (
		useAlchemyPending &&
		client.transport.type === "webSocket" &&
		"subscribe" in client.transport
	) {
		stopFns.push(startAlchemyPendingWatcher(client, targets, logger, bus));
	} else {
		stopFns.push(startStandardPendingWatcher(client, targets, logger, bus));
	}

	const unwatchBlocks = client.watchBlockNumber({
		onBlockNumber: (blockNumber) => {
			const n = blockNumber ? Number(blockNumber) : 0;
			if (n % config.heartbeatBlocks === 0) {
				logger.info("onchain heartbeat", { block: blockNumber?.toString() });
			}
		},
		onError: (err) =>
			logger.warn("onchain block watcher error", { err: String(err) }),
	});
	stopFns.push(unwatchBlocks);

	return {
		stop: () => {
			for (const fn of stopFns) fn();
			logger.info("onchain watcher stopped");
		},
	};
}
