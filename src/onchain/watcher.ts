import { createPublicClient, getAddress, webSocket } from "viem";
import { polygon } from "viem/chains";
import type { AppConfig } from "../config";
import type { EventBus } from "../events/bus";
import type { Logger } from "../logger";
import {
	decodeMatchOrders,
	inferRoleAndSide,
	matchesCalldata,
} from "./decoder";

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
const HASH_CACHE_SIZE = 1000;

function makeHashCache() {
	const deque: string[] = [];
	const set = new Set<string>();

	return {
		seen: (hash: string | undefined) => {
			if (!hash) return false;
			if (set.has(hash)) return true;
			deque.push(hash);
			set.add(hash);
			if (deque.length > HASH_CACHE_SIZE) {
				const oldest = deque.shift();
				if (oldest) set.delete(oldest);
			}
			return false;
		},
	};
}

function makeTargets(config: AppConfig): Set<string> {
	return new Set([FEE_MODULE, ...config.targets.map((t) => getAddress(t))]);
}

function startAlchemyPendingWatcher(
	client: ReturnType<typeof createPublicClient>,
	targets: Set<string>,
	logger: Logger,
	bus: EventBus,
): () => void {
	const cache = makeHashCache();

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
				if (!matchesCalldata(input, ADDRESS_NEEDLE)) return;

				const decoded = input ? decodeMatchOrders(input) : null;
				const info = decoded ? inferRoleAndSide(decoded, TARGET_ADDRESS) : null;
				const takerFill = decoded?.args?.[2];
				const takerReceive = decoded?.args?.[3];

				const hash = (tx as { hash?: string }).hash;
				if (cache.seen(hash)) return;

				logger.info("pending tx to target (alchemy)", {
					hash,
					role: info?.role,
					side: info?.side,
					tokenId: info?.tokenId,
					takerFill: takerFill ? String(takerFill) : undefined,
					takerReceive: takerReceive ? String(takerReceive) : undefined,
				});
				bus.emit({
					source: "onchain",
					hash,
					raw: tx,
					decoded,
					info: {
						role: info?.role,
						side: info?.side,
						tokenId: info?.tokenId,
						takerFill: takerFill ? String(takerFill) : undefined,
						takerReceive: takerReceive ? String(takerReceive) : undefined,
					},
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
	const cache = makeHashCache();

	return client.watchPendingTransactions({
		includeTransactions: true,
		onTransactions: (txs: PendingTx[]) => {
			for (const tx of txs) {
				if (!tx?.to) continue;
				const to = getAddress(tx.to);
				if (!targets.has(to)) continue;

				const input = tx.input ?? tx.data;
				if (!matchesCalldata(input, ADDRESS_NEEDLE)) continue;

				const decoded = input ? decodeMatchOrders(input) : null;
				const info = decoded ? inferRoleAndSide(decoded, TARGET_ADDRESS) : null;
				const takerFill = decoded?.args?.[2];
				const takerReceive = decoded?.args?.[3];

				if (cache.seen(tx.hash)) continue;

				bus.emit({
					source: "onchain",
					hash: tx.hash,
					raw: tx,
					decoded,
					info: {
						role: info?.role,
						side: info?.side,
						tokenId: info?.tokenId,
						takerFill: takerFill ? String(takerFill) : undefined,
						takerReceive: takerReceive ? String(takerReceive) : undefined,
					},
				});
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
