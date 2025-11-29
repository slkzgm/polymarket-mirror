import { type EnvConfig, loadEnv } from "./env";

export type AppConfig = EnvConfig;

export function loadConfig(): AppConfig {
	return loadEnv();
}
