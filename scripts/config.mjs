#!/usr/bin/env node
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const tiers = new Set(["fast", "balanced", "strong", "long"]);
const providers = new Set(["anthropic", "openai", "openai-codex"]);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaults = JSON.parse(
  readFileSync(join(root, "config", "default-model-policy.json"), "utf8"),
);
const defaultKeys = new Set(
  defaults.map((model) => `${model.provider}/${model.id}`),
);
const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const configPath = join(configHome, "pi-coder", "config.json");

function usage(message) {
  if (message) process.stderr.write(`pic config: ${message}\n\n`);
  process.stderr.write(`Usage:
  pic config show
  pic config path
  pic config whitelist add <provider/model> [fast|balanced|strong|long]
  pic config whitelist remove <provider/model>
  pic config whitelist clear
  pic config blacklist add <provider/model>
  pic config blacklist remove <provider/model>
  pic config blacklist clear
  pic config tier <provider/model> <fast|balanced|strong|long|default>
`);
  process.exit(message ? 1 : 0);
}

function validateKey(key) {
  if (typeof key !== "string") usage("missing provider/model");
  const parts = key.split("/");
  if (parts.length !== 2 || !providers.has(parts[0]) || !parts[1])
    usage("model must be anthropic/<id>, openai/<id>, or openai-codex/<id>");
  return key;
}

function readUserConfig() {
  try {
    const value = JSON.parse(readFileSync(configPath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("invalid configuration: root must be an object");
    if (value.models !== undefined && !Array.isArray(value.models))
      throw new Error("invalid configuration: models must be an array");
    if (value.allowModels !== undefined && !Array.isArray(value.allowModels))
      throw new Error("invalid configuration: allowModels must be an array");
    if (value.blockModels !== undefined && !Array.isArray(value.blockModels))
      throw new Error("invalid configuration: blockModels must be an array");
    if (
      value.tierOverrides !== undefined &&
      (!value.tierOverrides ||
        typeof value.tierOverrides !== "object" ||
        Array.isArray(value.tierOverrides))
    )
      throw new Error("invalid configuration: tierOverrides must be an object");
    return value;
  } catch (error) {
    if (error && error.code === "ENOENT") return {};
    throw new Error(`cannot read ${configPath}: ${error.message}`);
  }
}

function uniqueStrings(value) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item) => typeof item === "string"))]
    : [];
}

function writeUserConfig(config) {
  const directory = dirname(configPath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temporary = `${configPath}.tmp-${process.pid}`;
  try {
    writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporary, configPath);
    chmodSync(configPath, 0o600);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function resolvedPolicy(config) {
  const legacy = Array.isArray(config.models);
  const base = legacy
    ? config.models.filter(
        (model) =>
          model &&
          typeof model === "object" &&
          providers.has(model.provider) &&
          typeof model.id === "string" &&
          model.id &&
          tiers.has(model.tier),
      )
    : defaults;
  const byKey = new Map(
    base.map((model) => [
      `${model.provider}/${model.id}`,
      { ...model },
    ]),
  );
  const allow = uniqueStrings(config.allowModels);
  const overrides =
    config.tierOverrides &&
    typeof config.tierOverrides === "object" &&
    !Array.isArray(config.tierOverrides)
      ? config.tierOverrides
      : {};
  for (const [key, tier] of Object.entries(overrides)) {
    if (!tiers.has(tier)) continue;
    const existing = byKey.get(key);
    if (existing) {
      existing.tier = tier;
      continue;
    }
    const parts = key.split("/");
    if (
      !legacy &&
      allow.includes(key) &&
      parts.length === 2 &&
      providers.has(parts[0]) &&
      parts[1]
    )
      byKey.set(key, { provider: parts[0], id: parts[1], tier });
  }
  const block = new Set(uniqueStrings(config.blockModels));
  return (allow.length ? allow : [...byKey.keys()])
    .flatMap((key) => (byKey.has(key) ? [byKey.get(key)] : []))
    .filter((model) => !block.has(`${model.provider}/${model.id}`));
}

function migrateLegacyPolicy(config) {
  if (!Array.isArray(config.models)) return;
  const existingAllow = uniqueStrings(config.allowModels);
  const overrides =
    config.tierOverrides &&
    typeof config.tierOverrides === "object" &&
    !Array.isArray(config.tierOverrides)
      ? config.tierOverrides
      : {};
  const selected = config.models
    .filter(
      (model) =>
        model &&
        typeof model === "object" &&
        providers.has(model.provider) &&
        typeof model.id === "string" &&
        model.id &&
        tiers.has(model.tier),
    )
    .filter(
      (model) =>
        !existingAllow.length ||
        existingAllow.includes(`${model.provider}/${model.id}`),
    );
  if (!selected.length)
    throw new Error("cannot migrate an empty legacy model policy");
  config.allowModels = selected.map(
    (model) => `${model.provider}/${model.id}`,
  );
  config.tierOverrides = Object.fromEntries(
    selected.map((model) => {
      const key = `${model.provider}/${model.id}`;
      const override = overrides[key];
      return [key, tiers.has(override) ? override : model.tier];
    }),
  );
  delete config.models;
}

const [command = "show", action, rawKey, rawTier] = process.argv.slice(2);
if (command === "path") {
  process.stdout.write(`${configPath}\n`);
  process.exit(0);
}
const config = readUserConfig();
if (command === "show") {
  const allow = uniqueStrings(config.allowModels);
  process.stdout.write(
    `${JSON.stringify(
      {
        path: configPath,
        mode: Array.isArray(config.models)
          ? "legacy-explicit"
          : allow.length
            ? "allow-only"
            : "shipped-defaults",
        user: config,
        resolvedModels: resolvedPolicy(config),
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

migrateLegacyPolicy(config);

if (command === "whitelist" || command === "blacklist") {
  const property = command === "whitelist" ? "allowModels" : "blockModels";
  if (action === "clear") {
    config[property] = [];
  } else {
    const key = validateKey(rawKey);
    const values = uniqueStrings(config[property]);
    if (action === "add") {
      if (command === "whitelist" && !defaultKeys.has(key) && !rawTier)
        usage("unknown shipped model requires an explicit tier");
      if (rawTier && !tiers.has(rawTier)) usage("invalid tier");
      if (!values.includes(key)) values.push(key);
      config[property] = values;
      if (command === "whitelist" && rawTier) {
        config.tierOverrides = {
          ...(config.tierOverrides ?? {}),
          [key]: rawTier,
        };
      }
    } else if (action === "remove") {
      config[property] = values.filter((value) => value !== key);
    } else {
      usage(`${command} expects add, remove, or clear`);
    }
  }
} else if (command === "tier") {
  const key = validateKey(action);
  const tier = rawKey;
  if (tier !== "default" && !tiers.has(tier)) usage("invalid tier");
  const overrides = { ...(config.tierOverrides ?? {}) };
  if (tier === "default") delete overrides[key];
  else overrides[key] = tier;
  config.tierOverrides = overrides;
} else {
  usage(`unknown command: ${command}`);
}

writeUserConfig(config);
const allow = uniqueStrings(config.allowModels);
process.stdout.write(
  `Updated ${configPath}\nMode: ${allow.length ? "allow-only" : "shipped-defaults"}\n`,
);
