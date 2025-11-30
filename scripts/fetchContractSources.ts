import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Address, type Chain, isAddress } from "viem";
import { mainnet, polygon, polygonAmoy, polygonMumbai } from "viem/chains";

type CliOptions = {
	chain?: string;
	address?: string;
	apiKey?: string;
	out?: string;
	help?: boolean;
};

type ParsedSource =
	| { type: "multi-file"; files: Record<string, string> }
	| { type: "flattened"; files: Record<string, string> };

const CHAIN_ALIASES: Record<string, Chain> = {
	mainnet,
	ethereum: mainnet,
	eth: mainnet,
	polygon,
	matic: polygon,
	pol: polygon,
	polygonamoy: polygonAmoy,
	amoy: polygonAmoy,
	polygonmumbai: polygonMumbai,
	mumbai: polygonMumbai,
};

// Etherscan V2 aggregator endpoint (works cross-chain via chainid). Override with ETHERSCAN_API_BASE if needed.
const ETHERSCAN_V2_BASE =
	process.env.ETHERSCAN_API_BASE ?? "https://api.etherscan.io/v2/api";

const globalArgs = parseArgs(process.argv.slice(2));

if (globalArgs.help || !globalArgs.chain || !globalArgs.address) {
	printUsageAndExit(globalArgs.help ? 0 : 1);
}

await main();

async function main() {
	const chain = resolveChain(globalArgs.chain ?? "");
	const address = normalizeAddress(globalArgs.address ?? "");

	const apiBaseUrl = ETHERSCAN_V2_BASE;
	const apiKey = globalArgs.apiKey ?? inferApiKey();
	if (!apiKey) {
		throw new Error(
			"Missing API key: provide --api-key or set ETHERSCAN_API_KEY (Etherscan V2 requires a key for all chains).",
		);
	}
	const outputDir =
		globalArgs.out ??
		join(
			"downloaded-contracts",
			`${chain.name.toLowerCase().replace(/\s+/g, "-")}-${chain.id}`,
			address,
		);

	console.log(
		`-> Fetching sources for ${address} on ${chain.name} (chainid=${chain.id})`,
	);
	const metadata = await fetchSourceMetadata(
		apiBaseUrl,
		chain.id,
		address,
		apiKey,
	);

	const parsedSource = parseSource(metadata.SourceCode, metadata.ContractName);
	const manifest = buildManifest(
		chain,
		address,
		apiBaseUrl,
		metadata,
		parsedSource,
	);

	await writeSources(outputDir, parsedSource.files);
	await writeManifest(outputDir, manifest);

	const abiPath = await writeAbi(outputDir, metadata.ABI);
	const abiLabel = abiPath ?? "skipped";

	console.log(
		`Download complete. Sources -> ${outputDir}. ABI -> ${abiLabel}.`,
	);
}

function parseArgs(argv: string[]): CliOptions {
	const opts: Record<string, string | boolean> = {};

	for (let i = 0; i < argv.length; i++) {
		const current = argv[i];
		if (current === "--help" || current === "-h") {
			opts.help = true;
			continue;
		}

		if (current.startsWith("--")) {
			const [flag, inlineValue] = current.slice(2).split("=");
			if (inlineValue !== undefined) {
				opts[flag] = inlineValue;
			} else if (argv[i + 1] && !argv[i + 1].startsWith("-")) {
				opts[flag] = argv[i + 1];
				i += 1;
			} else {
				opts[flag] = true;
			}
			continue;
		}

		if (current.startsWith("-")) {
			const shortFlag = current.slice(1);
			if (argv[i + 1] && !argv[i + 1].startsWith("-")) {
				opts[shortFlag] = argv[i + 1];
				i += 1;
			} else {
				opts[shortFlag] = true;
			}
		}
	}

	return {
		chain: (opts.chain as string) ?? (opts.c as string),
		address: (opts.address as string) ?? (opts.a as string),
		apiKey: opts["api-key"] as string,
		out: opts.out as string,
		help: opts.help as boolean,
	};
}

function resolveChain(key: string): Chain {
	const normalized = key.toLowerCase();
	const chain = CHAIN_ALIASES[normalized];
	if (!chain) {
		const supported = Object.keys(CHAIN_ALIASES).sort().join(", ");
		throw new Error(`Unsupported chain "${key}". Supported: ${supported}`);
	}
	return chain;
}

function normalizeAddress(addr: string): Address {
	if (!isAddress(addr)) {
		throw new Error(`Invalid address: ${addr}`);
	}
	return addr as Address;
}

async function fetchSourceMetadata(
	apiBaseUrl: string,
	chainId: number,
	address: Address,
	apiKey?: string,
) {
	const url = new URL(apiBaseUrl);
	url.searchParams.set("chainid", String(chainId));
	url.searchParams.set("module", "contract");
	url.searchParams.set("action", "getsourcecode");
	url.searchParams.set("address", address);
	if (apiKey) url.searchParams.set("apikey", apiKey);

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(
			`Explorer responded with ${response.status} ${response.statusText}`,
		);
	}
	const payload = await response.json();

	if (payload.status !== "1" || !Array.isArray(payload.result)) {
		const message = payload.result ?? payload.message ?? "unknown error";
		throw new Error(`Explorer error: ${message}`);
	}

	const [first] = payload.result;
	if (!first) {
		throw new Error("Explorer returned empty result");
	}

	return first as {
		SourceCode: string;
		ContractName: string;
		CompilerVersion: string;
		ABI: string;
		OptimizationUsed: string;
		Runs: string;
		EVMVersion: string;
		LicenseType: string;
		Implementation: string;
		Proxy: string;
		SwarmSource: string;
	};
}

function parseSource(
	sourceCodeField: string,
	contractName: string,
): ParsedSource {
	const trimmed = sourceCodeField?.trim() ?? "";
	if (!trimmed) {
		throw new Error("No source code found for this contract");
	}

	const unwrapped =
		(trimmed.startsWith("{{") && trimmed.endsWith("}}")) ||
		(trimmed.startsWith("{{\r") && trimmed.endsWith("}}"))
			? trimmed.slice(1, -1)
			: trimmed;

	try {
		const parsed = JSON.parse(unwrapped);
		if (parsed && typeof parsed === "object" && parsed.sources) {
			const files: Record<string, string> = {};
			for (const [filePath, value] of Object.entries(parsed.sources)) {
				const content =
					typeof value === "object" && value !== null && "content" in value
						? (value as { content: string }).content
						: String(value);
				files[filePath] = content;
			}
			return { type: "multi-file", files };
		}
	} catch {
		// fall back to flattened handling
	}

	const fileName = contractName
		? `${contractName.replace(/\s+/g, "")}.sol`
		: "contract.sol";
	return { type: "flattened", files: { [fileName]: unwrapped } };
}

async function writeSources(baseDir: string, files: Record<string, string>) {
	const entries = Object.entries(files);
	if (!entries.length) {
		throw new Error("No source files to write");
	}

	for (const [relativePath, content] of entries) {
		const targetPath = join(baseDir, "sources", relativePath);
		await ensureParentDir(targetPath);
		await Bun.write(targetPath, content);
	}
}

function buildManifest(
	chain: Chain,
	address: Address,
	apiUrl: string,
	metadata: Record<string, string>,
	parsedSource: ParsedSource,
) {
	return {
		address,
		chainId: chain.id,
		chainName: chain.name,
		explorerApiUrl: apiUrl,
		compilerVersion: metadata.CompilerVersion,
		license: metadata.LicenseType,
		evmVersion: metadata.EVMVersion,
		optimizationUsed: metadata.OptimizationUsed === "1",
		optimizationRuns: Number(metadata.Runs) || undefined,
		proxy: metadata.Proxy === "1",
		implementation: metadata.Implementation || undefined,
		swarmSource: metadata.SwarmSource || undefined,
		sourceType: parsedSource.type,
		fetchedAt: new Date().toISOString(),
	};
}

async function writeManifest(
	baseDir: string,
	manifest: Record<string, unknown>,
) {
	const manifestPath = join(baseDir, "manifest.json");
	await ensureParentDir(manifestPath);
	await Bun.write(manifestPath, JSON.stringify(manifest, null, 2));
}

async function writeAbi(baseDir: string, abiField: string) {
	if (!abiField || abiField === "Contract source code not verified") {
		console.warn("ABI not available from explorer response");
		return null;
	}

	try {
		const abi = JSON.parse(abiField);
		const abiPath = join(baseDir, "abi.json");
		await ensureParentDir(abiPath);
		await Bun.write(abiPath, JSON.stringify(abi, null, 2));
		return abiPath;
	} catch (error) {
		console.warn(`Could not parse ABI: ${String(error)}`);
		return null;
	}
}

async function ensureParentDir(filePath: string) {
	await mkdir(dirname(filePath), { recursive: true });
}

function inferApiKey(): string | undefined {
	return process.env.ETHERSCAN_API_KEY;
}

function printUsageAndExit(code = 1): never {
	console.log(
		[
			"Usage: bun run scripts/fetchContractSources.ts --chain <chain> --address <0x...> [--api-key <key>] [--out <dir>]",
			"",
			"Examples:",
			"  ETHERSCAN_API_KEY=yourKey bun run scripts/fetchContractSources.ts --chain polygon --address 0x0000000000000000000000000000000000001010",
			"  bun run scripts/fetchContractSources.ts --chain mumbai --address 0x123... --api-key $ETHERSCAN_API_KEY",
		].join("\n"),
	);
	process.exit(code);
}
