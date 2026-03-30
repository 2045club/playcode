import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type WorkspaceCodexProvider } from "@/lib/settings";

const CODEX_DIRECTORY_PATH = path.join(os.homedir(), ".codex");
const AUTH_FILE_PATH = path.join(CODEX_DIRECTORY_PATH, "auth.json");
const CONFIG_FILE_PATH = path.join(CODEX_DIRECTORY_PATH, "config.toml");
const BUILT_IN_OPENAI_PROVIDER_ID = "openai";
const MANAGED_PROVIDER_METADATA_SECTION_HEADER = "[playcode_sync]";
const MANAGED_PROVIDER_METADATA_KEY = "managed_model_providers";
const MANAGED_PROVIDER_SECTION_KEYS = [
  "name",
  "base_url",
  "wire_api",
  "requires_openai_auth",
  "env_key",
] as const;
type LocalCodexSyncMode = "full" | "switch-only";
type CodexAuthPayload = Record<string, unknown> & {
  OPENAI_API_KEY?: string;
  auth_mode?: string;
};

export type LocalCodexSyncResult = {
  authPath: string;
  authUpdated: boolean;
  configPath: string;
  modelProvider: string;
  providerCount: number;
  mode: LocalCodexSyncMode;
};

export function syncLocalCodexProviderFiles(
  providers: WorkspaceCodexProvider[],
  provider: WorkspaceCodexProvider,
  options?: {
    mode?: LocalCodexSyncMode;
  },
): LocalCodexSyncResult {
  ensureCodexDirectory();

  const syncMode = options?.mode ?? "full";
  const { content: nextConfigContent, mode } = buildUpdatedConfigToml(
    providers,
    provider,
    syncMode,
  );
  writeFileAtomically(CONFIG_FILE_PATH, nextConfigContent);
  const authUpdated = writeLocalCodexApiKey(provider.api_key.trim());

  return {
    authPath: AUTH_FILE_PATH,
    authUpdated,
    configPath: CONFIG_FILE_PATH,
    modelProvider: resolveLocalModelProviderId(provider),
    providerCount: providers.length,
    mode,
  };
}

function ensureCodexDirectory() {
  fs.mkdirSync(CODEX_DIRECTORY_PATH, { recursive: true, mode: 0o700 });
}

function writeLocalCodexApiKey(apiKey: string) {
  const currentPayload = readLocalCodexAuthPayload();
  const nextPayload: CodexAuthPayload = {
    ...currentPayload,
  };

  if (apiKey) {
    nextPayload.OPENAI_API_KEY = apiKey;
    nextPayload.auth_mode = "apikey";
  } else {
    delete nextPayload.OPENAI_API_KEY;
    delete nextPayload.auth_mode;
  }

  const currentSerialized = `${JSON.stringify(currentPayload, null, 2)}\n`;
  const nextSerialized = `${JSON.stringify(nextPayload, null, 2)}\n`;

  if (currentSerialized === nextSerialized) {
    return false;
  }

  writeFileAtomically(AUTH_FILE_PATH, nextSerialized, 0o600);
  return true;
}

function readLocalCodexAuthPayload() {
  try {
    if (!fs.existsSync(AUTH_FILE_PATH)) {
      return {} satisfies CodexAuthPayload;
    }

    const rawValue = fs.readFileSync(AUTH_FILE_PATH, "utf8");
    const parsed = JSON.parse(rawValue) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {} satisfies CodexAuthPayload;
    }

    return parsed as CodexAuthPayload;
  } catch {
    return {} satisfies CodexAuthPayload;
  }
}

function buildUpdatedConfigToml(
  providers: WorkspaceCodexProvider[],
  provider: WorkspaceCodexProvider,
  mode: LocalCodexSyncMode,
) {
  const currentContent = readTextFile(CONFIG_FILE_PATH);
  const shouldSwitchOnly =
    mode === "switch-only" && canReuseProviderSection(currentContent, provider);
  let nextContent = currentContent;
  let nextMode: LocalCodexSyncMode = "switch-only";

  if (!shouldSwitchOnly) {
    nextContent = removeStaleManagedProviderSections(currentContent, providers);
    nextContent = syncProviderSections(nextContent, providers);
    nextContent = removeTopLevelTomlAssignment(nextContent, "openai_base_url");
    nextContent = upsertManagedProviderMetadata(nextContent, providers);
    nextMode = "full";
  }

  nextContent = upsertTopLevelTomlAssignment(
    nextContent,
    "model_provider",
    tomlString(resolveLocalModelProviderId(provider)),
  );

  if (!provider.base_url.trim()) {
    nextContent = removeTopLevelTomlAssignment(nextContent, "openai_base_url");
  }

  return {
    content: ensureTrailingNewline(nextContent),
    mode: nextMode,
  };
}

function resolveLocalModelProviderId(provider: WorkspaceCodexProvider) {
  return provider.base_url.trim()
    ? provider.name.trim() || provider.id.trim() || "provider"
    : BUILT_IN_OPENAI_PROVIDER_ID;
}

function syncProviderSections(
  content: string,
  providers: WorkspaceCodexProvider[],
) {
  return providers.reduce(
    (nextContent, provider) => syncProviderSection(nextContent, provider),
    content,
  );
}

function removeStaleManagedProviderSections(
  content: string,
  providers: WorkspaceCodexProvider[],
) {
  const nextProviderIds = new Set(providers.map(resolveLocalModelProviderId));
  const staleProviderIds = readManagedProviderIds(content).filter(
    (providerId) => !nextProviderIds.has(providerId),
  );

  return staleProviderIds.reduce(
    (nextContent, providerId) =>
      removeTomlSection(nextContent, `[model_providers.${providerId}]`),
    content,
  );
}

function syncProviderSection(content: string, provider: WorkspaceCodexProvider) {
  if (!provider.base_url.trim()) {
    return content;
  }

  const providerId = resolveLocalModelProviderId(provider);
  const assignments = buildProviderAssignments(provider);

  return upsertManagedTomlSection(
    content,
    `[model_providers.${providerId}]`,
    assignments,
    MANAGED_PROVIDER_SECTION_KEYS,
  );
}

function canReuseProviderSection(
  content: string,
  provider: WorkspaceCodexProvider,
) {
  if (!provider.base_url.trim()) {
    return true;
  }

  const lines = toTomlLines(content);
  const existingSection = findTomlSection(
    lines,
    `[model_providers.${resolveLocalModelProviderId(provider)}]`,
  );

  if (!existingSection) {
    return false;
  }

  const sectionBody = trimTomlBlankLines(
    lines.slice(existingSection.start + 1, existingSection.end),
  );
  const expectedAssignments = buildManagedAssignmentsMap(
    buildProviderAssignments(provider),
  );
  const actualAssignments = buildManagedAssignmentsMap(sectionBody);

  if (actualAssignments.size !== expectedAssignments.size) {
    return false;
  }

  for (const [key, value] of expectedAssignments.entries()) {
    if (actualAssignments.get(key) !== value) {
      return false;
    }
  }

  return true;
}

function upsertManagedProviderMetadata(
  content: string,
  providers: WorkspaceCodexProvider[],
) {
  const providerIds = Array.from(
    new Set(providers.map(resolveLocalModelProviderId)),
  );

  return upsertManagedTomlSection(
    content,
    MANAGED_PROVIDER_METADATA_SECTION_HEADER,
    [
      buildTomlAssignment(
        MANAGED_PROVIDER_METADATA_KEY,
        tomlArray(providerIds.map(tomlString)),
      ),
    ],
    [MANAGED_PROVIDER_METADATA_KEY],
  );
}

function readManagedProviderIds(content: string) {
  const lines = toTomlLines(content);
  const metadataSection = findTomlSection(
    lines,
    MANAGED_PROVIDER_METADATA_SECTION_HEADER,
  );

  if (metadataSection) {
    const sectionBody = trimTomlBlankLines(
      lines.slice(metadataSection.start + 1, metadataSection.end),
    );
    const metadataValue = readTomlAssignmentValue(
      sectionBody,
      MANAGED_PROVIDER_METADATA_KEY,
    );
    const parsedManagedIds = parseTomlStringArray(metadataValue);

    if (parsedManagedIds.length > 0) {
      return parsedManagedIds;
    }
  }

  return detectLegacyManagedProviderIds(lines);
}

function buildProviderAssignments(provider: WorkspaceCodexProvider) {
  if (!provider.base_url.trim()) {
    return [] as string[];
  }

  const providerId = resolveLocalModelProviderId(provider);
  const providerName = provider.provider.trim() || providerId;

  return [
    buildTomlAssignment("name", tomlString(providerName)),
    ...(provider.base_url.trim()
      ? [buildTomlAssignment("base_url", tomlString(provider.base_url.trim()))]
      : []),
    buildTomlAssignment("wire_api", tomlString("responses")),
    buildTomlAssignment("requires_openai_auth", "true"),
  ];
}

function buildManagedAssignmentsMap(lines: string[]) {
  const managedAssignments = new Map<string, string>();

  for (const line of lines) {
    const separatorIndex = line.indexOf("=");

    if (separatorIndex < 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();

    if (
      !MANAGED_PROVIDER_SECTION_KEYS.includes(
        key as (typeof MANAGED_PROVIDER_SECTION_KEYS)[number],
      )
    ) {
      continue;
    }

    managedAssignments.set(key, line.slice(separatorIndex + 1).trim());
  }

  return managedAssignments;
}

function detectLegacyManagedProviderIds(lines: string[]) {
  const managedProviderIds: string[] = [];

  for (const line of lines) {
    const match = line.trim().match(/^\[model_providers\.([^\]]+)\]$/);

    if (!match) {
      continue;
    }

    const providerId = match[1]?.trim() ?? "";

    if (
      /^[a-z]{6}$/.test(providerId) &&
      !managedProviderIds.includes(providerId)
    ) {
      managedProviderIds.push(providerId);
    }
  }

  return managedProviderIds;
}

function readTextFile(filePath: string) {
  try {
    if (!fs.existsSync(filePath)) {
      return "";
    }

    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function writeFileAtomically(
  filePath: string,
  content: string,
  mode = 0o600,
) {
  const tempFilePath = path.join(
    path.dirname(filePath),
    `${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );

  try {
    fs.writeFileSync(tempFilePath, content, {
      encoding: "utf8",
      mode,
    });
    fs.renameSync(tempFilePath, filePath);
    fs.chmodSync(filePath, mode);
  } catch (error) {
    try {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
    } catch {
      // Ignore temp file cleanup failures and surface the original write error.
    }

    throw error;
  }
}

function upsertTopLevelTomlAssignment(
  content: string,
  key: string,
  value: string,
) {
  const lines = toTomlLines(content);
  const assignmentLine = buildTomlAssignment(key, value);
  const firstSectionIndex = lines.findIndex(isTomlSectionHeader);
  const searchEndIndex =
    firstSectionIndex >= 0 ? firstSectionIndex : lines.length;
  const existingLineIndex = lines.findIndex(
    (line, index) =>
      index < searchEndIndex && isTomlAssignmentLine(line, key),
  );

  if (existingLineIndex >= 0) {
    lines[existingLineIndex] = assignmentLine;
    return lines.join("\n");
  }

  const insertIndex = searchEndIndex >= 0 ? searchEndIndex : lines.length;
  lines.splice(insertIndex, 0, assignmentLine);

  return lines.join("\n");
}

function removeTopLevelTomlAssignment(content: string, key: string) {
  const lines = toTomlLines(content);
  const firstSectionIndex = lines.findIndex(isTomlSectionHeader);
  const searchEndIndex =
    firstSectionIndex >= 0 ? firstSectionIndex : lines.length;
  const existingLineIndex = lines.findIndex(
    (line, index) =>
      index < searchEndIndex && isTomlAssignmentLine(line, key),
  );

  if (existingLineIndex < 0) {
    return content;
  }

  lines.splice(existingLineIndex, 1);
  return lines.join("\n");
}

function removeTomlSection(content: string, header: string) {
  const lines = toTomlLines(content);
  const existingSection = findTomlSection(lines, header);

  if (!existingSection) {
    return content;
  }

  const nextLines = [
    ...lines.slice(0, existingSection.start),
    ...lines.slice(existingSection.end),
  ];

  return trimExtraBlankLines(nextLines).join("\n");
}

function upsertManagedTomlSection(
  content: string,
  header: string,
  assignments: string[],
  managedKeys: readonly string[],
) {
  const lines = toTomlLines(content);
  const existingSection = findTomlSection(lines, header);

  if (!existingSection) {
    if (lines.length > 0 && lines[lines.length - 1]?.trim()) {
      lines.push("");
    }

    lines.push(header, ...assignments);
    return lines.join("\n");
  }

  const sectionBody = trimTomlBlankLines(
    lines.slice(existingSection.start + 1, existingSection.end),
  );
  const nextSectionBody = sectionBody.filter((line) => {
    if (!line.includes("=")) {
      return true;
    }

    const [key] = line.split("=", 1);
    return !managedKeys.includes(key.trim());
  });

  for (const assignment of assignments) {
    const [key] = assignment.split("=", 1);
    const normalizedKey = key.trim();
    const existingLineIndex = nextSectionBody.findIndex((line) =>
      isTomlAssignmentLine(line, normalizedKey),
    );

    if (existingLineIndex >= 0) {
      nextSectionBody[existingLineIndex] = assignment;
      continue;
    }

    nextSectionBody.push(assignment);
  }

  const nextLines = [
    ...lines.slice(0, existingSection.start),
    header,
    ...nextSectionBody,
    ...lines.slice(existingSection.end),
  ];

  return nextLines.join("\n");
}

function findTomlSection(lines: string[], header: string) {
  const start = lines.findIndex((line) => line.trim() === header);

  if (start < 0) {
    return null;
  }

  let end = lines.length;

  for (let index = start + 1; index < lines.length; index += 1) {
    if (isTomlSectionHeader(lines[index])) {
      end = index;
      break;
    }
  }

  return { end, start };
}

function trimTomlBlankLines(lines: string[]) {
  const nextLines = [...lines];

  while (nextLines[0] !== undefined && !nextLines[0].trim()) {
    nextLines.shift();
  }

  while (
    nextLines[nextLines.length - 1] !== undefined &&
    !nextLines[nextLines.length - 1].trim()
  ) {
    nextLines.pop();
  }

  return nextLines;
}

function trimExtraBlankLines(lines: string[]) {
  const nextLines: string[] = [];

  for (const line of lines) {
    if (!line.trim() && nextLines[nextLines.length - 1] === "") {
      continue;
    }

    nextLines.push(line.trim() ? line : "");
  }

  return trimTomlBlankLines(nextLines);
}

function toTomlLines(content: string) {
  if (!content) {
    return [] as string[];
  }

  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function isTomlSectionHeader(line: string | undefined) {
  return Boolean(line && /^\s*\[[^\]]+\]\s*$/.test(line));
}

function isTomlAssignmentLine(line: string, key: string) {
  return new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(line);
}

function readTomlAssignmentValue(lines: string[], key: string) {
  const assignmentLine = lines.find((line) => isTomlAssignmentLine(line, key));

  if (!assignmentLine) {
    return null;
  }

  const separatorIndex = assignmentLine.indexOf("=");

  if (separatorIndex < 0) {
    return null;
  }

  return assignmentLine.slice(separatorIndex + 1).trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildTomlAssignment(key: string, value: string) {
  return `${key} = ${value}`;
}

function tomlString(value: string) {
  return JSON.stringify(value);
}

function tomlArray(values: string[]) {
  return `[${values.join(", ")}]`;
}

function parseTomlStringArray(value: string | null) {
  if (!value) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!Array.isArray(parsed)) {
      return [] as string[];
    }

    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [] as string[];
  }
}

function ensureTrailingNewline(content: string) {
  return content.endsWith("\n") ? content : `${content}\n`;
}
