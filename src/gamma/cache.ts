type CacheEntry<T> = {
	value: T;
	expiresAt: number;
};

export type TtlCache<T> = {
	get: (key: string) => T | undefined;
	set: (key: string, value: T, ttlMs: number) => T;
	getOrSet: (
		key: string,
		ttlMs: number,
		producer: () => Promise<T>,
	) => Promise<T>;
	delete: (key: string) => void;
	clear: () => void;
	size: () => number;
	cleanup: () => void;
};

export function createTtlCache<T>(): TtlCache<T> {
	const store = new Map<string, CacheEntry<T>>();
	const inflight = new Map<string, Promise<T>>();

	function cleanup() {
		const now = Date.now();
		for (const [key, entry] of store.entries()) {
			if (entry.expiresAt <= now) store.delete(key);
		}
	}

	function get(key: string): T | undefined {
		const entry = store.get(key);
		if (!entry) return undefined;
		if (entry.expiresAt <= Date.now()) {
			store.delete(key);
			return undefined;
		}
		return entry.value;
	}

	function set(key: string, value: T, ttlMs: number): T {
		const expiresAt = Date.now() + Math.max(0, ttlMs);
		store.set(key, { value, expiresAt });
		return value;
	}

	async function getOrSet(
		key: string,
		ttlMs: number,
		producer: () => Promise<T>,
	): Promise<T> {
		const cached = get(key);
		if (cached !== undefined) return cached;

		const pending = inflight.get(key);
		if (pending) return pending;

		const promise = producer()
			.then((value) => {
				inflight.delete(key);
				set(key, value, ttlMs);
				return value;
			})
			.catch((err) => {
				inflight.delete(key);
				throw err;
			});

		inflight.set(key, promise);
		return promise;
	}

	return {
		get,
		set,
		getOrSet,
		delete: (key) => store.delete(key),
		clear: () => store.clear(),
		size: () => {
			cleanup();
			return store.size;
		},
		cleanup,
	};
}
