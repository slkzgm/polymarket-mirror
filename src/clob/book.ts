// Placeholder for order book tracking via REST + market ws channel
export type BookSnapshot = {
	tokenId: string;
	bids: Array<{ price: string; size: string }>;
	asks: Array<{ price: string; size: string }>;
};

export function createBookStore() {
	const books = new Map<string, BookSnapshot>();
	return {
		upsert(snapshot: BookSnapshot) {
			books.set(snapshot.tokenId, snapshot);
		},
		get(tokenId: string) {
			return books.get(tokenId);
		},
	};
}
