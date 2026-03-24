import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { ConfigError } from "../errors.js";
import type { RoutingConfig } from "./types.js";
import defaults from "./defaults.json" with { type: "json" };

const DEFAULT_CONFIG_PATH = join(homedir(), ".openclawrouter", "config.json");

export function loadRoutingConfig(customPath?: string): RoutingConfig {
  const configPath = customPath ?? DEFAULT_CONFIG_PATH;

  let userConfig: Partial<RoutingConfig> = {};
  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      userConfig = JSON.parse(raw) as Partial<RoutingConfig>;
    } catch (err) {
      throw new ConfigError(`Failed to parse config at ${configPath}: ${err}`);
    }
  }

  const merged: RoutingConfig = {
    categories: {
      ...(defaults as RoutingConfig).categories,
      ...userConfig.categories,
    },
  };

  validateConfig(merged);

  return merged;
}

function validateConfig(config: RoutingConfig): void {
  for (const [categoryId, category] of Object.entries(config.categories)) {
    if (!category.model || category.model.trim() === "") {
      throw new ConfigError(
        `Category "${categoryId}" has an empty or missing model field`,
      );
    }
  }
}
