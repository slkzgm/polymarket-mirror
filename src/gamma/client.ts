import type { Logger } from "../logger";

export type QueryValue =
	| string
	| number
	| boolean
	| Array<string | number | boolean>
	| undefined
	| null;

export type QueryParams = Record<string, QueryValue>;

export type GammaClientOptions = {
	timeoutMs?: number;
	retries?: number;
	headers?: Record<string, string>;
};

export type GammaClient = {
	baseUrl: string;
	fetchJson: <T>(path: string, params?: QueryParams) => Promise<T>;
};

function appendSearchParam(
	url: URL,
	key: string,
	value: string | number | boolean,
) {
	url.searchParams.append(key, String(value));
}

function buildUrl(baseUrl: string, path: string, params?: QueryParams): URL {
	const normalizedBase = baseUrl.replace(/\/$/, "");
	const normalizedPath = path.startsWith("/") ? path : `/${path}`;
	const url = new URL(`${normalizedBase}${normalizedPath}`);

	if (params) {
		for (const [key, rawValue] of Object.entries(params)) {
			if (rawValue === undefined || rawValue === null) continue;
			if (Array.isArray(rawValue)) {
				for (const v of rawValue) appendSearchParam(url, key, v);
			} else {
				appendSearchParam(url, key, rawValue);
			}
		}
	}

	return url;
}

function shouldRetry(status: number) {
	return status >= 500 || status === 429 || status === 408;
}

export function createGammaClient(
	baseUrl: string,
	logger: Logger,
	apiKey?: string,
	options?: GammaClientOptions,
): GammaClient {
	const timeoutMs = options?.timeoutMs ?? 8_000;
	const retries = Math.max(0, options?.retries ?? 1);

	const authHeaders: Record<string, string> = {};
	if (apiKey) {
		authHeaders.Authorization = `Bearer ${apiKey}`;
		authHeaders["x-api-key"] = apiKey;
	}

	return {
		baseUrl,
		async fetchJson<T>(path: string, params?: QueryParams): Promise<T> {
			let attempt = 0;
			let lastError: unknown;

			while (attempt <= retries) {
				const controller = new AbortController();
				const id = setTimeout(() => controller.abort(), timeoutMs);

				try {
					const url = buildUrl(baseUrl, path, params);
					const res = await fetch(url, {
						signal: controller.signal,
						headers: {
							Accept: "application/json",
							...authHeaders,
							...(options?.headers ?? {}),
						},
					});

					if (!res.ok) {
						const status = res.status;
						if (attempt < retries && shouldRetry(status)) {
							attempt += 1;
							continue;
						}

						const text = await res.text().catch(() => "");
						logger.debug("gamma fetch non-200", {
							path,
							status,
							text,
						});
						throw new Error(`Gamma request failed (${status})`);
					}

					return (await res.json()) as T;
				} catch (err) {
					lastError = err;
					if (attempt < retries) {
						attempt += 1;
						continue;
					}
					throw err;
				} finally {
					clearTimeout(id);
				}
			}

			throw lastError instanceof Error
				? lastError
				: new Error("Gamma request failed");
		},
	};
}
