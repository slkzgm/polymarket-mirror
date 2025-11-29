type Meta = Record<string, unknown>;

export type Logger = {
	info: (msg: string, meta?: Meta) => void;
	warn: (msg: string, meta?: Meta) => void;
	error: (msg: string, meta?: Meta) => void;
	debug: (msg: string, meta?: Meta) => void;
};

const DEBUG_ENABLED =
	(Bun.env.DEBUG || "").toLowerCase() === "true" || Bun.env.DEBUG === "1";

function serialize(meta?: Meta) {
	if (!meta || Object.keys(meta).length === 0) return "";
	return ` ${JSON.stringify(meta)}`;
}

function baseLogger(level: string, msg: string, meta?: Meta) {
	const ts = new Date().toISOString();
	// eslint-disable-next-line no-console
	console.log(`[${ts}] ${level.toUpperCase()} ${msg}${serialize(meta)}`);
}

export function createLogger(): Logger {
	return {
		info: (msg, meta) => baseLogger("info", msg, meta),
		warn: (msg, meta) => baseLogger("warn", msg, meta),
		error: (msg, meta) => baseLogger("error", msg, meta),
		debug: (msg, meta) => {
			if (DEBUG_ENABLED) baseLogger("debug", msg, meta);
		},
	};
}
