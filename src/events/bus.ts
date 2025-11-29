import { EventEmitter } from "node:events";
import type { AppEvent } from "../types";

export type EventBus = {
	emit: (event: AppEvent) => void;
	on: (handler: (event: AppEvent) => void) => void;
	remove: (handler: (event: AppEvent) => void) => void;
};

export function createEventBus(): EventBus {
	const emitter = new EventEmitter();

	return {
		emit: (event) => emitter.emit("event", event),
		on: (handler) => emitter.on("event", handler),
		remove: (handler) => emitter.off("event", handler),
	};
}
