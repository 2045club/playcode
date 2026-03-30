import "server-only";

import type { SandboxMode } from "@openai/codex-sdk";

const FIXED_CODEX_SANDBOX_MODE: SandboxMode = "danger-full-access";

export function resolveCodexSandboxMode(): SandboxMode | undefined {
  return FIXED_CODEX_SANDBOX_MODE;
}
