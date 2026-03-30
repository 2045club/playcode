import fs from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_CLAUDE_REASONING_EFFORT,
  defaultWorkspaceSettings,
  createWorkspaceCodexProvider,
  getWorkspaceCodexProviderById,
  normalizeClaudeModel,
  normalizeClaudeReasoningEffort,
  normalizeWorkspaceClaudeProviders,
  normalizeWorkspaceCodexProviders,
  resolveWorkspaceClaudeProviderIds,
  normalizeWorkspaceProviderConcurrentSessionLimit,
  resolveWorkspaceCodexProviderIds,
  type WorkspaceSettings,
} from "@/lib/settings";
import {
  normalizeSessionModelForProjectServer,
  normalizeSessionReasoningEffortForProjectServer,
  normalizeStoredSessionModel,
  normalizeStoredSessionReasoningEffort,
  type WorkspaceAgentReasoningEffort,
} from "@/lib/session-agent";
import {
  DEFAULT_WORKSPACE_MODEL,
  DEFAULT_WORKSPACE_PROJECT_SERVER,
  DEFAULT_WORKSPACE_REASONING_EFFORT,
  buildSessionTitle,
  demoWorkspace,
  normalizeWorkspacePayload,
  normalizeWorkspaceProjectServer,
  normalizeReasoningEffort,
  normalizeWorkspaceModel,
  type WorkspaceMessage,
  type WorkspaceMessageMetadata,
  type WorkspacePayload,
  type WorkspaceQueuedPrompt,
  type WorkspaceProjectServer,
  type WorkspaceRunUsage,
  type WorkspaceRole,
  type WorkspaceSession,
} from "@/lib/workspace";

type ProjectRow = {
  id: number;
  name: string;
  server: string;
  project_path: string;
  created_at: string;
  valid_session_count: number;
  active_session_count: number;
  archived_session_count: number;
  sort_order: number;
};

type SessionRow = {
  id: number;
  project_id: number;
  server: string;
  session_name: string;
  preview: string;
  model: string;
  reasoning_effort: string;
  codex_thread_id: string;
  claude_thread_id: string;
  codex_provider_id: string;
  claude_provider_id: string;
  duration_minutes: number;
  status: string;
  has_unread: number;
  is_archived: number;
  is_active: number;
  created_at: string;
  total_input_tokens: number;
  total_cached_input_tokens: number;
  total_output_tokens: number;
  sort_order: number;
};

type MessageRow = {
  id: number;
  session_id: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  model: string | null;
  reasoning_effort: string | null;
  run_duration_ms: number | null;
  metadata_json: string;
  sort_order: number;
};

type SessionPromptQueueRow = {
  id: number;
  session_id: number;
  content: string;
  created_at: string;
  model: string;
  reasoning_effort: string;
  sort_order: number;
};

type RuntimeSettingsRow = {
  websocket_url: string;
  token: string;
  base_url: string;
  codex_agents_json: string;
  selected_codex_agent_id: string;
  default_codex_agent_id: string;
  codex_provider_concurrent_session_limit: number;
  codex_model: string;
  codex_reasoning_effort: string;
  claude_providers_json: string;
  selected_claude_provider_id: string;
  default_claude_provider_id: string;
  claude_provider_concurrent_session_limit: number;
  claude_model: string;
  claude_reasoning_effort: string;
};

type AuthConfigRow = {
  jwt_secret: string;
};

type AuthUserRow = {
  id: number;
  username: string;
  password_hash: string;
  password_salt: string;
  created_at: string;
  updated_at: string;
};

export type AuthUser = {
  id: number;
  username: string;
  createdAt: string;
  updatedAt: string;
};

type AuthUserCredentials = AuthUser & {
  passwordHash: string;
  passwordSalt: string;
};

type SessionIdentityRow = {
  id: number;
};

type ProjectIdentityRow = {
  id: number;
  name: string;
  server?: string;
  project_path: string;
  valid_session_count?: number;
  active_session_count?: number;
  archived_session_count?: number;
};

type ProjectSessionCountsRow = {
  valid_session_count: number | null;
  active_session_count: number | null;
  archived_session_count: number | null;
};

type SessionThreadRow = {
  thread_id: string;
};

type SessionRuntimeRow = {
  project_id: number;
  duration_minutes: number;
  is_active: number;
};

type SessionUsageTotalsRow = {
  total_input_tokens: number;
  total_cached_input_tokens: number;
  total_output_tokens: number;
};

type SessionMessageUsageRow = {
  session_id: number;
  metadata_json: string;
};

type ProviderDailyUsageRow = {
  provider_id: string;
  usage_date: string;
  total_input_tokens: number;
  total_cached_input_tokens: number;
  total_output_tokens: number;
};

type ProviderDailyUsageSourceRow = {
  metadata_json: string;
  created_at: string;
  session_provider_id: string;
};

type SessionArchiveStateRow = {
  id: number;
  project_id: number;
  is_active: number;
  is_archived: number;
};

type SessionAgentConfigRow = {
  model: string;
  reasoning_effort: string;
  provider_id: string;
  server: string;
};

type SessionStatusRow = {
  status: string;
};

type SessionProjectRow = {
  id: number;
  project_id: number;
};

type SessionInProgressCountRow = {
  in_progress_count: number | null;
};

type SessionRenameRow = {
  id: number;
  session_name: string;
};

type SessionProjectPathRow = {
  project_path: string;
};

type ProjectMigrationRow = {
  id: number;
  name: string;
  server: string;
  project_path: string;
  created_at: string;
  description?: string;
};

type SessionMigrationRow = {
  id: number;
  session_name: string;
  model: string;
  reasoning_effort: string;
  session_server: string;
  duration_minutes: number;
  created_at: string;
  title?: string;
  relative_label?: string;
};

let database: Database.Database | null = null;
export const SESSION_STATUS_IN_PROGRESS = "进行中";
export const SESSION_STATUS_PENDING = "待执行";
export const SESSION_STATUS_COMPLETED = "已完成";

function getSessionProviderColumnForProjectServer(server: WorkspaceProjectServer) {
  return server === "claude" ? "claude_provider_id" : "codex_provider_id";
}

function getSessionProviderIdFromRow(
  row: Pick<SessionRow, "codex_provider_id" | "claude_provider_id">,
  projectServer: WorkspaceProjectServer,
) {
  const providerId =
    projectServer === "claude" ? row.claude_provider_id : row.codex_provider_id;

  return providerId.trim();
}

function resolveSessionServer(
  sessionServer?: string | null,
  fallbackServer: WorkspaceProjectServer = DEFAULT_WORKSPACE_PROJECT_SERVER,
) {
  const normalizedServer = sessionServer?.trim().toLowerCase() ?? "";

  return normalizedServer === "codex" || normalizedServer === "claude"
    ? normalizedServer
    : fallbackServer;
}

const seededProjectPathByName = new Map(
  demoWorkspace.projects.map((project) => [project.name, project.path]),
);

function getDatabasePath() {
  const dataDirectory = path.join(process.cwd(), "data");
  fs.mkdirSync(dataDirectory, { recursive: true });
  return path.join(dataDirectory, "playcode.db");
}

function normalizeProjectPath(projectPath: string) {
  const trimmedPath = projectPath.trim();

  if (!trimmedPath) {
    throw new Error("项目路径不能为空。");
  }

  const resolvedPath = path.resolve(trimmedPath);
  const rootPath = path.parse(resolvedPath).root;
  let normalizedPath = resolvedPath;

  while (
    normalizedPath.length > rootPath.length &&
    normalizedPath.endsWith(path.sep)
  ) {
    normalizedPath = normalizedPath.slice(0, -1);
  }

  return normalizedPath;
}

function getCurrentTimestamp() {
  return new Date().toISOString();
}

function generateAuthJwtSecret() {
  return randomBytes(48).toString("hex");
}

function getProjectSessionCounts(db: Database.Database, projectId: number) {
  const row = db
    .prepare(
      `SELECT
        SUM(CASE WHEN is_archived = 0 THEN 1 ELSE 0 END) AS valid_session_count,
        SUM(
          CASE
            WHEN is_archived = 0 AND status = @inProgressStatus THEN 1
            ELSE 0
          END
        ) AS active_session_count,
        SUM(CASE WHEN is_archived = 1 THEN 1 ELSE 0 END) AS archived_session_count
      FROM sessions
      WHERE project_id = @projectId`,
    )
    .get({
      projectId,
      inProgressStatus: SESSION_STATUS_IN_PROGRESS,
    }) as ProjectSessionCountsRow | undefined;

  return {
    validSessionCount: Math.max(row?.valid_session_count ?? 0, 0),
    activeSessionCount: Math.max(row?.active_session_count ?? 0, 0),
    archivedSessionCount: Math.max(row?.archived_session_count ?? 0, 0),
  };
}

function refreshProjectSessionCounts(db: Database.Database, projectId: number) {
  const counts = getProjectSessionCounts(db, projectId);

  db.prepare(
    `UPDATE projects
    SET valid_session_count = @validSessionCount,
        active_session_count = @activeSessionCount,
        archived_session_count = @archivedSessionCount
    WHERE id = @projectId`,
  ).run({
    projectId,
    validSessionCount: counts.validSessionCount,
    activeSessionCount: counts.activeSessionCount,
    archivedSessionCount: counts.archivedSessionCount,
  });

  return counts;
}

function refreshAllProjectSessionCounts(db: Database.Database) {
  const projectRows = db.prepare("SELECT id FROM projects").all() as SessionIdentityRow[];

  for (const project of projectRows) {
    refreshProjectSessionCounts(db, project.id);
  }
}

function normalizeTimestampValue(value?: string | null) {
  const trimmedValue = value?.trim() ?? "";

  if (!trimmedValue) {
    return null;
  }

  const normalizedValue = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(
    trimmedValue,
  )
    ? `${trimmedValue.replace(" ", "T")}Z`
    : trimmedValue;
  const timestamp = Date.parse(normalizedValue);

  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function resolveCreatedAt(...candidates: Array<string | null | undefined>) {
  for (const candidate of candidates) {
    const normalizedTimestamp = normalizeTimestampValue(candidate);

    if (normalizedTimestamp) {
      return normalizedTimestamp;
    }
  }

  return getCurrentTimestamp();
}

function getTableColumns(db: Database.Database, tableName: string) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
    name: string;
  }>;
}

function hasColumn(
  db: Database.Database,
  tableName: string,
  columnName: string,
) {
  return getTableColumns(db, tableName).some((column) => column.name === columnName);
}

function looksLikePath(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return false;
  }

  return (
    trimmedValue.startsWith("/") ||
    trimmedValue.startsWith("~/") ||
    /^[A-Za-z]:[\\/]/.test(trimmedValue)
  );
}

function inferProjectPath(projectName: string, legacyDescription?: string) {
  const seededPath = seededProjectPathByName.get(projectName);

  if (seededPath) {
    return seededPath;
  }

  if (legacyDescription && looksLikePath(legacyDescription)) {
    return legacyDescription.trim();
  }

  if (projectName === path.basename(process.cwd())) {
    return process.cwd();
  }

  return path.join(
    /* turbopackIgnore: true */ path.dirname(process.cwd()),
    projectName,
  );
}

function parseLegacyDurationLabel(label?: string) {
  const normalizedLabel = label?.trim() ?? "";

  if (!normalizedLabel) {
    return 0;
  }

  let totalMinutes = 0;

  const days = normalizedLabel.match(/(\d+)\s*天/);
  const hours = normalizedLabel.match(/(\d+)\s*(?:小时|时)/);
  const minutes = normalizedLabel.match(/(\d+)\s*(?:分钟|分)/);

  if (days) {
    totalMinutes += Number(days[1]) * 24 * 60;
  }

  if (hours) {
    totalMinutes += Number(hours[1]) * 60;
  }

  if (minutes) {
    totalMinutes += Number(minutes[1]);
  }

  if (totalMinutes > 0) {
    return totalMinutes;
  }

  const numericValue = Number(normalizedLabel);

  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.round(numericValue)
    : 0;
}

function calculateDurationMinutesFromDates(createdAtValues: string[]) {
  const timestamps = createdAtValues
    .map((value) => new Date(value).getTime())
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);

  if (timestamps.length === 0) {
    return 0;
  }

  if (timestamps.length === 1) {
    return 1;
  }

  const durationMs = Math.max(
    timestamps[timestamps.length - 1] - timestamps[0],
    0,
  );

  return Math.max(Math.round(durationMs / 60000), 1);
}

function calculateSessionRunDurationMs(
  db: Database.Database,
  sessionId: number,
  fallbackDurationMinutes = 0,
) {
  const row = db
    .prepare(
      `SELECT COALESCE(
        SUM(
          CASE
            WHEN run_duration_ms IS NOT NULL AND run_duration_ms > 0
              THEN run_duration_ms
            ELSE 0
          END
        ),
        0
      ) AS total_run_duration_ms
      FROM messages
      WHERE session_id = ?`,
    )
    .get(sessionId) as { total_run_duration_ms: number | null } | undefined;

  const totalRunDurationMs =
    normalizeRunDurationMs(row?.total_run_duration_ms ?? null) ?? 0;

  if (totalRunDurationMs > 0) {
    return totalRunDurationMs;
  }

  return Math.max(fallbackDurationMinutes, 0) * 60000;
}

function convertSessionDurationMsToMinutes(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }

  return Math.max(Math.round(durationMs / 60000), 0);
}

function calculateSessionDurationMinutes(
  db: Database.Database,
  sessionId: number,
  fallbackDuration = 0,
) {
  const rows = db
    .prepare(
      `SELECT created_at
      FROM messages
      WHERE session_id = ?
      ORDER BY sort_order ASC, id ASC`,
    )
    .all(sessionId) as Array<{ created_at: string }>;

  const computedDuration = calculateDurationMinutesFromDates(
    rows.map((row) => row.created_at),
  );

  return Math.max(fallbackDuration, computedDuration);
}

function normalizeUsageTokenCount(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.round(value);
}

function buildUsageTotals({
  inputTokens = 0,
  cachedInputTokens = 0,
  outputTokens = 0,
}: Partial<
  Pick<WorkspaceRunUsage, "inputTokens" | "cachedInputTokens" | "outputTokens">
> = {}): WorkspaceRunUsage {
  const normalizedInputTokens = normalizeUsageTokenCount(inputTokens);
  const normalizedCachedInputTokens =
    normalizeUsageTokenCount(cachedInputTokens);
  const normalizedOutputTokens = normalizeUsageTokenCount(outputTokens);

  return {
    inputTokens: normalizedInputTokens,
    cachedInputTokens: normalizedCachedInputTokens,
    outputTokens: normalizedOutputTokens,
    totalTokens: normalizedInputTokens + normalizedOutputTokens,
  };
}

function normalizeUsageDateKey(value?: string | null) {
  const trimmedValue = value?.trim() ?? "";

  if (!trimmedValue) {
    return null;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(trimmedValue) ? trimmedValue : null;
}

function resolveUsageDateKey(createdAt?: string | null) {
  const normalizedTimestamp = normalizeTimestampValue(createdAt);

  if (!normalizedTimestamp) {
    return null;
  }

  return normalizeUsageDateKey(normalizedTimestamp.slice(0, 10));
}

function resolveMessageUsageProviderId({
  metadata,
  sessionProviderId,
}: {
  metadata?: WorkspaceMessageMetadata | null;
  sessionProviderId?: string | null;
}) {
  const runProviderId = metadata?.run?.providerId?.trim() ?? "";

  if (runProviderId) {
    return runProviderId;
  }

  return sessionProviderId?.trim() ?? "";
}

function calculateProviderDailyUsageTotalsFromRows(
  rows: ProviderDailyUsageSourceRow[],
) {
  const usageTotalsByProviderDate = new Map<
    string,
    {
      providerId: string;
      usageDate: string;
      usageTotals: WorkspaceRunUsage;
    }
  >();

  for (const row of rows) {
    const metadata = parseMessageMetadata(row.metadata_json);
    const usageTotals = extractMessageUsageTotals(metadata);

    if (!usageTotals) {
      continue;
    }

    const providerId = resolveMessageUsageProviderId({
      metadata,
      sessionProviderId: row.session_provider_id,
    });
    const usageDate = resolveUsageDateKey(row.created_at);

    if (!providerId || !usageDate) {
      continue;
    }

    const mapKey = `${providerId}::${usageDate}`;
    const currentTotals =
      usageTotalsByProviderDate.get(mapKey)?.usageTotals ?? buildUsageTotals();

    usageTotalsByProviderDate.set(mapKey, {
      providerId,
      usageDate,
      usageTotals: buildUsageTotals({
        inputTokens: currentTotals.inputTokens + usageTotals.inputTokens,
        cachedInputTokens:
          currentTotals.cachedInputTokens + usageTotals.cachedInputTokens,
        outputTokens: currentTotals.outputTokens + usageTotals.outputTokens,
      }),
    });
  }

  return [...usageTotalsByProviderDate.values()].sort((left, right) => {
    const usageDateComparison = right.usageDate.localeCompare(left.usageDate);

    if (usageDateComparison !== 0) {
      return usageDateComparison;
    }

    return left.providerId.localeCompare(right.providerId);
  });
}

function refreshAllProviderDailyUsageTotals(db: Database.Database) {
  const rows = db
    .prepare(
      `SELECT
        m.metadata_json,
        m.created_at,
        CASE
          WHEN s.server = 'claude' THEN s.claude_provider_id
          ELSE s.codex_provider_id
        END AS session_provider_id
      FROM messages m
      JOIN sessions s ON s.id = m.session_id
      ORDER BY m.id ASC`,
    )
    .all() as ProviderDailyUsageSourceRow[];
  const dailyUsageRows = calculateProviderDailyUsageTotalsFromRows(rows);
  const clearProviderDailyUsage = db.prepare("DELETE FROM provider_daily_usage");
  const insertProviderDailyUsage = db.prepare(
    `INSERT INTO provider_daily_usage (
      provider_id,
      usage_date,
      total_input_tokens,
      total_cached_input_tokens,
      total_output_tokens
    ) VALUES (
      @providerId,
      @usageDate,
      @inputTokens,
      @cachedInputTokens,
      @outputTokens
    )`,
  );

  clearProviderDailyUsage.run();

  for (const row of dailyUsageRows) {
    insertProviderDailyUsage.run({
      providerId: row.providerId,
      usageDate: row.usageDate,
      inputTokens: row.usageTotals.inputTokens,
      cachedInputTokens: row.usageTotals.cachedInputTokens,
      outputTokens: row.usageTotals.outputTokens,
    });
  }

  return dailyUsageRows;
}

function ensureProjectsSchema(db: Database.Database) {
  if (!hasColumn(db, "projects", "server")) {
    db.exec(
      `ALTER TABLE projects
      ADD COLUMN server TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_PROJECT_SERVER}'`,
    );
  }

  if (!hasColumn(db, "projects", "project_path")) {
    db.exec(
      "ALTER TABLE projects ADD COLUMN project_path TEXT NOT NULL DEFAULT ''",
    );
  }

  if (!hasColumn(db, "projects", "created_at")) {
    db.exec(
      "ALTER TABLE projects ADD COLUMN created_at TEXT NOT NULL DEFAULT ''",
    );
  }

  if (!hasColumn(db, "projects", "valid_session_count")) {
    db.exec(
      "ALTER TABLE projects ADD COLUMN valid_session_count INTEGER NOT NULL DEFAULT 0",
    );
  }

  if (!hasColumn(db, "projects", "active_session_count")) {
    db.exec(
      "ALTER TABLE projects ADD COLUMN active_session_count INTEGER NOT NULL DEFAULT 0",
    );
  }

  if (!hasColumn(db, "projects", "archived_session_count")) {
    db.exec(
      "ALTER TABLE projects ADD COLUMN archived_session_count INTEGER NOT NULL DEFAULT 0",
    );
  }

  const hasDescription = hasColumn(db, "projects", "description");
  const selectColumns = ["id", "name", "server", "project_path", "created_at"];

  if (hasDescription) {
    selectColumns.push("description");
  }

  const rows = db
    .prepare(`SELECT ${selectColumns.join(", ")} FROM projects`)
    .all() as ProjectMigrationRow[];
  const findProjectCreatedAt = db.prepare(
    `SELECT MIN(created_at) AS created_at
    FROM sessions
    WHERE project_id = ? AND TRIM(created_at) != ''`,
  );
  const updateProject = db.prepare(
    `UPDATE projects
    SET server = @server,
        project_path = @projectPath,
        created_at = @createdAt
    WHERE id = @id`,
  );

  for (const row of rows) {
    const sessionCreatedAt = findProjectCreatedAt.get(row.id) as
      | { created_at: string | null }
      | undefined;

    updateProject.run({
      id: row.id,
      server: normalizeWorkspaceProjectServer(row.server),
      projectPath:
        row.project_path.trim() || inferProjectPath(row.name, row.description),
      createdAt: resolveCreatedAt(row.created_at, sessionCreatedAt?.created_at),
    });
  }

  refreshAllProjectSessionCounts(db);
}

function ensureSessionsSchema(db: Database.Database) {
  if (!hasColumn(db, "sessions", "server")) {
    db.exec(
      `ALTER TABLE sessions
      ADD COLUMN server TEXT NOT NULL DEFAULT ''`,
    );
  }

  if (!hasColumn(db, "sessions", "session_name")) {
    db.exec(
      "ALTER TABLE sessions ADD COLUMN session_name TEXT NOT NULL DEFAULT ''",
    );
  }

  if (!hasColumn(db, "sessions", "duration_minutes")) {
    db.exec(
      "ALTER TABLE sessions ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 0",
    );
  }

  if (!hasColumn(db, "sessions", "codex_thread_id")) {
    db.exec(
      "ALTER TABLE sessions ADD COLUMN codex_thread_id TEXT NOT NULL DEFAULT ''",
    );
  }

  if (!hasColumn(db, "sessions", "claude_thread_id")) {
    db.exec(
      "ALTER TABLE sessions ADD COLUMN claude_thread_id TEXT NOT NULL DEFAULT ''",
    );
  }

  if (!hasColumn(db, "sessions", "codex_provider_id")) {
    db.exec(
      "ALTER TABLE sessions ADD COLUMN codex_provider_id TEXT NOT NULL DEFAULT ''",
    );
  }

  if (!hasColumn(db, "sessions", "claude_provider_id")) {
    db.exec(
      "ALTER TABLE sessions ADD COLUMN claude_provider_id TEXT NOT NULL DEFAULT ''",
    );
  }

  if (!hasColumn(db, "sessions", "reasoning_effort")) {
    db.exec(
      `ALTER TABLE sessions
      ADD COLUMN reasoning_effort TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_REASONING_EFFORT}'`,
    );
  }

  if (!hasColumn(db, "sessions", "created_at")) {
    db.exec(
      "ALTER TABLE sessions ADD COLUMN created_at TEXT NOT NULL DEFAULT ''",
    );
  }

  if (!hasColumn(db, "sessions", "has_unread")) {
    db.exec(
      "ALTER TABLE sessions ADD COLUMN has_unread INTEGER NOT NULL DEFAULT 0",
    );
  }

  if (!hasColumn(db, "sessions", "is_archived")) {
    db.exec(
      "ALTER TABLE sessions ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0",
    );
  }

  if (!hasColumn(db, "sessions", "total_input_tokens")) {
    db.exec(
      "ALTER TABLE sessions ADD COLUMN total_input_tokens INTEGER NOT NULL DEFAULT 0",
    );
  }

  if (!hasColumn(db, "sessions", "total_cached_input_tokens")) {
    db.exec(
      "ALTER TABLE sessions ADD COLUMN total_cached_input_tokens INTEGER NOT NULL DEFAULT 0",
    );
  }

  if (!hasColumn(db, "sessions", "total_output_tokens")) {
    db.exec(
      "ALTER TABLE sessions ADD COLUMN total_output_tokens INTEGER NOT NULL DEFAULT 0",
    );
  }

  db.exec(
    `UPDATE sessions
    SET server = (
      SELECT p.server
      FROM projects p
      WHERE p.id = sessions.project_id
    )
    WHERE TRIM(server) = ''`,
  );

  db.exec(
    `UPDATE sessions
    SET claude_thread_id = codex_thread_id
    WHERE server = 'claude'
      AND TRIM(claude_thread_id) = ''
      AND TRIM(codex_thread_id) != ''`,
  );
  db.exec(
    `UPDATE sessions
    SET claude_provider_id = codex_provider_id
    WHERE server = 'claude'
      AND TRIM(claude_provider_id) = ''
      AND TRIM(codex_provider_id) != ''`,
  );

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_sessions_archived_project_created_at
      ON sessions(is_archived, project_id, created_at DESC)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_sessions_provider_status_archived
      ON sessions(codex_provider_id, status, is_archived)`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_sessions_claude_provider_status_archived
      ON sessions(claude_provider_id, status, is_archived)`,
  );

  const hasTitle = hasColumn(db, "sessions", "title");
  const hasRelativeLabel = hasColumn(db, "sessions", "relative_label");
  const selectColumns = [
    "s.id AS id",
    "s.session_name",
    "s.model",
    "s.reasoning_effort",
    "s.server AS session_server",
    "s.duration_minutes",
    "s.created_at",
  ];

  if (hasTitle) {
    selectColumns.push("s.title");
  }

  if (hasRelativeLabel) {
    selectColumns.push("s.relative_label");
  }

  const rows = db
    .prepare(
      `SELECT ${selectColumns.join(", ")}
      FROM sessions s
      JOIN projects p ON p.id = s.project_id`,
    )
    .all() as SessionMigrationRow[];
  const findSessionCreatedAt = db.prepare(
    `SELECT MIN(created_at) AS created_at
    FROM messages
    WHERE session_id = ? AND TRIM(created_at) != ''`,
  );
  const updateSession = db.prepare(
    `UPDATE sessions
    SET session_name = @sessionName,
        model = @model,
        reasoning_effort = @reasoningEffort,
        duration_minutes = @durationMinutes,
        created_at = @createdAt
    WHERE id = @id`,
  );

  for (const row of rows) {
    const sessionServer = resolveSessionServer(row.session_server);
    const resolvedSessionName =
      row.session_name.trim() || row.title?.trim() || `会话 ${row.id}`;
    const legacyDuration = parseLegacyDurationLabel(row.relative_label);
    const resolvedDuration = Math.max(
      row.duration_minutes,
      legacyDuration,
      calculateSessionDurationMinutes(
        db,
        row.id,
        Math.max(row.duration_minutes, legacyDuration),
      ),
    );
    const messageCreatedAt = findSessionCreatedAt.get(row.id) as
      | { created_at: string | null }
      | undefined;

    updateSession.run({
      id: row.id,
      sessionName: resolvedSessionName,
      model: normalizeSessionModelForProjectServer(sessionServer, row.model),
      reasoningEffort: normalizeSessionReasoningEffortForProjectServer(
        sessionServer,
        row.reasoning_effort,
      ),
      durationMinutes: resolvedDuration,
      createdAt: resolveCreatedAt(row.created_at, messageCreatedAt?.created_at),
    });
  }
}

function ensureMessagesSchema(db: Database.Database) {
  if (!hasColumn(db, "messages", "metadata_json")) {
    db.exec(
      "ALTER TABLE messages ADD COLUMN metadata_json TEXT NOT NULL DEFAULT ''",
    );
  }

  if (!hasColumn(db, "messages", "model")) {
    db.exec("ALTER TABLE messages ADD COLUMN model TEXT");
  }

  if (!hasColumn(db, "messages", "reasoning_effort")) {
    db.exec("ALTER TABLE messages ADD COLUMN reasoning_effort TEXT");
  }

  if (!hasColumn(db, "messages", "run_duration_ms")) {
    db.exec("ALTER TABLE messages ADD COLUMN run_duration_ms INTEGER");
  }

  const rows = db
    .prepare(
      `SELECT
        id,
        model,
        reasoning_effort,
        run_duration_ms,
        metadata_json
      FROM messages`,
    )
    .all() as Array<{
      id: number;
      model: string | null;
      reasoning_effort: string | null;
      run_duration_ms: number | null;
      metadata_json: string;
    }>;
  const updateMessage = db.prepare(
    `UPDATE messages
    SET model = @model,
        reasoning_effort = @reasoningEffort,
        run_duration_ms = @runDurationMs
    WHERE id = @id`,
  );

  for (const row of rows) {
    const normalizedMessageFields = buildMessageRunFields({
      model: row.model,
      reasoningEffort: row.reasoning_effort,
      runDurationMs: row.run_duration_ms,
      metadata: parseMessageMetadata(row.metadata_json),
    });

    if (
      normalizedMessageFields.model === row.model &&
      normalizedMessageFields.reasoningEffort === row.reasoning_effort &&
      normalizedMessageFields.runDurationMs === row.run_duration_ms
    ) {
      continue;
    }

    updateMessage.run({
      id: row.id,
      model: normalizedMessageFields.model,
      reasoningEffort: normalizedMessageFields.reasoningEffort,
      runDurationMs: normalizedMessageFields.runDurationMs,
    });
  }
}

function ensureSessionPromptQueueSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_prompt_queue (
      id INTEGER PRIMARY KEY,
      session_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      model TEXT NOT NULL,
      reasoning_effort TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_REASONING_EFFORT}',
      sort_order INTEGER NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_session_prompt_queue_session_order
      ON session_prompt_queue(session_id, sort_order, id)`,
  );
}

function ensureRuntimeSettingsSchema(db: Database.Database) {
  if (!hasColumn(db, "runtime_settings", "codex_agents_json")) {
    db.exec(
      `ALTER TABLE runtime_settings
      ADD COLUMN codex_agents_json TEXT NOT NULL DEFAULT '[]'`,
    );
  }

  if (!hasColumn(db, "runtime_settings", "selected_codex_agent_id")) {
    db.exec(
      `ALTER TABLE runtime_settings
      ADD COLUMN selected_codex_agent_id TEXT NOT NULL DEFAULT ''`,
    );
  }

  if (!hasColumn(db, "runtime_settings", "default_codex_agent_id")) {
    db.exec(
      `ALTER TABLE runtime_settings
      ADD COLUMN default_codex_agent_id TEXT NOT NULL DEFAULT ''`,
    );
  }

  if (
    !hasColumn(
      db,
      "runtime_settings",
      "codex_provider_concurrent_session_limit",
    )
  ) {
    db.exec(
      `ALTER TABLE runtime_settings
      ADD COLUMN codex_provider_concurrent_session_limit INTEGER NOT NULL DEFAULT ${defaultWorkspaceSettings.codexProviderConcurrentSessionLimit}`,
    );
  }

  if (!hasColumn(db, "runtime_settings", "codex_model")) {
    db.exec(
      `ALTER TABLE runtime_settings
      ADD COLUMN codex_model TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_MODEL}'`,
    );
  }

  if (!hasColumn(db, "runtime_settings", "codex_reasoning_effort")) {
    db.exec(
      `ALTER TABLE runtime_settings
      ADD COLUMN codex_reasoning_effort TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_REASONING_EFFORT}'`,
    );
  }

  if (!hasColumn(db, "runtime_settings", "claude_providers_json")) {
    db.exec(
      `ALTER TABLE runtime_settings
      ADD COLUMN claude_providers_json TEXT NOT NULL DEFAULT '[]'`,
    );
  }

  if (!hasColumn(db, "runtime_settings", "selected_claude_provider_id")) {
    db.exec(
      `ALTER TABLE runtime_settings
      ADD COLUMN selected_claude_provider_id TEXT NOT NULL DEFAULT ''`,
    );
  }

  if (!hasColumn(db, "runtime_settings", "default_claude_provider_id")) {
    db.exec(
      `ALTER TABLE runtime_settings
      ADD COLUMN default_claude_provider_id TEXT NOT NULL DEFAULT ''`,
    );
  }

  if (
    !hasColumn(
      db,
      "runtime_settings",
      "claude_provider_concurrent_session_limit",
    )
  ) {
    db.exec(
      `ALTER TABLE runtime_settings
      ADD COLUMN claude_provider_concurrent_session_limit INTEGER NOT NULL DEFAULT ${defaultWorkspaceSettings.claudeProviderConcurrentSessionLimit}`,
    );
  }

  if (!hasColumn(db, "runtime_settings", "claude_model")) {
    db.exec(
      `ALTER TABLE runtime_settings
      ADD COLUMN claude_model TEXT NOT NULL DEFAULT '${DEFAULT_CLAUDE_MODEL}'`,
    );
  }

  if (!hasColumn(db, "runtime_settings", "claude_reasoning_effort")) {
    db.exec(
      `ALTER TABLE runtime_settings
      ADD COLUMN claude_reasoning_effort TEXT NOT NULL DEFAULT '${DEFAULT_CLAUDE_REASONING_EFFORT}'`,
    );
  }

  migrateLegacyCodexProviderSettings(db);
  pruneRuntimeSettingsSchema(db);
}

function ensureAuthSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      jwt_secret TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auth_users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_users_username
      ON auth_users(username);
  `);

  db.prepare(
    `INSERT INTO auth_config (
      id,
      jwt_secret,
      updated_at
    ) VALUES (
      1,
      @jwtSecret,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(id) DO NOTHING`,
  ).run({
    jwtSecret: generateAuthJwtSecret(),
  });
}

function parseStoredCodexProviders(providersJson?: string | null) {
  const trimmedProvidersJson = providersJson?.trim() ?? "";

  if (!trimmedProvidersJson) {
    return [];
  }

  try {
    return normalizeWorkspaceCodexProviders(JSON.parse(trimmedProvidersJson));
  } catch {
    return [];
  }
}

function parseStoredCodexAgents(agentsJson?: string | null) {
  const trimmedAgentsJson = agentsJson?.trim() ?? "";

  if (!trimmedAgentsJson) {
    return [];
  }

  try {
    return normalizeWorkspaceCodexProviders(JSON.parse(trimmedAgentsJson));
  } catch {
    return [];
  }
}

function parseStoredClaudeProviders(providersJson?: string | null) {
  const trimmedProvidersJson = providersJson?.trim() ?? "";

  if (!trimmedProvidersJson) {
    return [];
  }

  try {
    return normalizeWorkspaceClaudeProviders(JSON.parse(trimmedProvidersJson));
  } catch {
    return [];
  }
}

function buildLegacyCodexProvider(baseUrl: string) {
  return createWorkspaceCodexProvider({
    title: baseUrl.trim() ? "默认自定义 Provider" : "官方 GPT",
    base_url: baseUrl.trim(),
    api_key: "",
  });
}

function migrateLegacyCodexProviderSettings(db: Database.Database) {
  const row = db
    .prepare(
      `SELECT
        base_url,
        codex_agents_json,
        selected_codex_agent_id,
        default_codex_agent_id
      FROM runtime_settings
      WHERE id = 1`,
    )
    .get() as
    | {
        base_url: string;
        codex_agents_json: string;
        selected_codex_agent_id: string;
        default_codex_agent_id: string;
      }
    | undefined;

  if (!row) {
    return;
  }

  let nextAgents = parseStoredCodexAgents(row.codex_agents_json);

  if (nextAgents.length === 0 && row.base_url.trim()) {
    nextAgents = [buildLegacyCodexProvider(row.base_url)];
  }

  const nextAgentIds = resolveWorkspaceCodexProviderIds({
    providers: nextAgents,
    selectedCodexProviderId: row.selected_codex_agent_id,
    defaultCodexProviderId: row.default_codex_agent_id,
  });
  const nextAgentsJson = JSON.stringify(nextAgents);

  if (
    nextAgentsJson === (row.codex_agents_json.trim() || "[]") &&
    nextAgentIds.selectedCodexProviderId === row.selected_codex_agent_id &&
    nextAgentIds.defaultCodexProviderId === row.default_codex_agent_id
  ) {
    return;
  }

  db.prepare(
    `UPDATE runtime_settings
    SET codex_agents_json = @codexAgentsJson,
      selected_codex_agent_id = @selectedCodexAgentId,
      default_codex_agent_id = @defaultCodexAgentId,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = 1`,
  ).run({
    codexAgentsJson: nextAgentsJson,
    selectedCodexAgentId: nextAgentIds.selectedCodexProviderId,
    defaultCodexAgentId: nextAgentIds.defaultCodexProviderId,
  });
}

function pruneRuntimeSettingsSchema(db: Database.Database) {
  const obsoleteColumns = [
    "codex_tokens_json",
    "default_codex_token_id",
    "codex_proxy_enabled",
    "codex_agent_pool_enabled",
    "codex_provider_execution_order",
    "codex_network_access",
    "codex_model_verbosity",
    "codex_sandbox_mode",
  ];

  if (!obsoleteColumns.some((column) => hasColumn(db, "runtime_settings", column))) {
    return;
  }

  db.exec(`
    BEGIN;
    CREATE TABLE runtime_settings_next (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      websocket_url TEXT NOT NULL DEFAULT '',
      token TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL DEFAULT '',
      codex_agents_json TEXT NOT NULL DEFAULT '[]',
      selected_codex_agent_id TEXT NOT NULL DEFAULT '',
      default_codex_agent_id TEXT NOT NULL DEFAULT '',
      codex_provider_concurrent_session_limit INTEGER NOT NULL DEFAULT ${defaultWorkspaceSettings.codexProviderConcurrentSessionLimit},
      codex_model TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_MODEL}',
      codex_reasoning_effort TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_REASONING_EFFORT}',
      claude_providers_json TEXT NOT NULL DEFAULT '[]',
      selected_claude_provider_id TEXT NOT NULL DEFAULT '',
      default_claude_provider_id TEXT NOT NULL DEFAULT '',
      claude_provider_concurrent_session_limit INTEGER NOT NULL DEFAULT ${defaultWorkspaceSettings.claudeProviderConcurrentSessionLimit},
      claude_model TEXT NOT NULL DEFAULT '${DEFAULT_CLAUDE_MODEL}',
      claude_reasoning_effort TEXT NOT NULL DEFAULT '${DEFAULT_CLAUDE_REASONING_EFFORT}',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO runtime_settings_next (
      id,
      websocket_url,
      token,
      base_url,
      codex_agents_json,
      selected_codex_agent_id,
      default_codex_agent_id,
      codex_provider_concurrent_session_limit,
      codex_model,
      codex_reasoning_effort,
      claude_providers_json,
      selected_claude_provider_id,
      default_claude_provider_id,
      claude_provider_concurrent_session_limit,
      claude_model,
      claude_reasoning_effort,
      updated_at
    )
    SELECT
      id,
      COALESCE(websocket_url, ''),
      COALESCE(token, ''),
      COALESCE(base_url, ''),
      COALESCE(codex_agents_json, '[]'),
      COALESCE(selected_codex_agent_id, ''),
      COALESCE(default_codex_agent_id, ''),
      COALESCE(codex_provider_concurrent_session_limit, ${defaultWorkspaceSettings.codexProviderConcurrentSessionLimit}),
      COALESCE(codex_model, '${DEFAULT_WORKSPACE_MODEL}'),
      COALESCE(codex_reasoning_effort, '${DEFAULT_WORKSPACE_REASONING_EFFORT}'),
      COALESCE(claude_providers_json, '[]'),
      COALESCE(selected_claude_provider_id, ''),
      COALESCE(default_claude_provider_id, ''),
      COALESCE(claude_provider_concurrent_session_limit, ${defaultWorkspaceSettings.claudeProviderConcurrentSessionLimit}),
      COALESCE(claude_model, '${DEFAULT_CLAUDE_MODEL}'),
      COALESCE(claude_reasoning_effort, '${DEFAULT_CLAUDE_REASONING_EFFORT}'),
      COALESCE(updated_at, CURRENT_TIMESTAMP)
    FROM runtime_settings;
    DROP TABLE runtime_settings;
    ALTER TABLE runtime_settings_next RENAME TO runtime_settings;
    COMMIT;
  `);
}

function serializeMessageMetadata(
  metadata?: WorkspaceMessageMetadata | null,
) {
  if (!metadata) {
    return "";
  }

  return JSON.stringify(metadata);
}

function parseMessageMetadata(
  metadataJson?: string | null,
): WorkspaceMessageMetadata | null {
  const trimmedMetadata = metadataJson?.trim() ?? "";

  if (!trimmedMetadata) {
    return null;
  }

  try {
    const parsedMetadata = JSON.parse(trimmedMetadata) as unknown;

    if (!parsedMetadata || typeof parsedMetadata !== "object") {
      return null;
    }

    return parsedMetadata as WorkspaceMessageMetadata;
  } catch {
    return null;
  }
}

function extractMessageUsageTotals(
  metadata?: WorkspaceMessageMetadata | null,
): WorkspaceRunUsage | null {
  const usage = metadata?.run?.usage;

  if (!usage) {
    return null;
  }

  return buildUsageTotals({
    inputTokens: usage.inputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    outputTokens: usage.outputTokens,
  });
}

function calculateSessionUsageTotalsFromRows(
  rows: Array<Pick<SessionMessageUsageRow, "metadata_json">>,
) {
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;

  for (const row of rows) {
    const usageTotals = extractMessageUsageTotals(
      parseMessageMetadata(row.metadata_json),
    );

    if (!usageTotals) {
      continue;
    }

    inputTokens += usageTotals.inputTokens;
    cachedInputTokens += usageTotals.cachedInputTokens;
    outputTokens += usageTotals.outputTokens;
  }

  return buildUsageTotals({
    inputTokens,
    cachedInputTokens,
    outputTokens,
  });
}

function saveSessionUsageTotals(
  db: Database.Database,
  sessionId: number,
  usageTotals: WorkspaceRunUsage,
) {
  db.prepare(
    `UPDATE sessions
    SET total_input_tokens = @inputTokens,
        total_cached_input_tokens = @cachedInputTokens,
        total_output_tokens = @outputTokens
    WHERE id = @sessionId`,
  ).run({
    sessionId,
    inputTokens: usageTotals.inputTokens,
    cachedInputTokens: usageTotals.cachedInputTokens,
    outputTokens: usageTotals.outputTokens,
  });
}

function refreshSessionUsageTotals(db: Database.Database, sessionId: number) {
  const rows = db
    .prepare(
      `SELECT metadata_json
      FROM messages
      WHERE session_id = ?
      ORDER BY sort_order ASC, id ASC`,
    )
    .all(sessionId) as Array<Pick<SessionMessageUsageRow, "metadata_json">>;
  const usageTotals = calculateSessionUsageTotalsFromRows(rows);

  saveSessionUsageTotals(db, sessionId, usageTotals);

  return usageTotals;
}

function refreshAllSessionUsageTotals(db: Database.Database) {
  const sessionRows = db.prepare("SELECT id FROM sessions").all() as SessionIdentityRow[];
  const messageRows = db
    .prepare(
      `SELECT session_id, metadata_json
      FROM messages
      ORDER BY session_id ASC, sort_order ASC, id ASC`,
    )
    .all() as SessionMessageUsageRow[];
  const usageTotalsBySessionId = new Map<number, WorkspaceRunUsage>();

  for (const row of messageRows) {
    const usageTotals = extractMessageUsageTotals(
      parseMessageMetadata(row.metadata_json),
    );

    if (!usageTotals) {
      continue;
    }

    const currentTotals =
      usageTotalsBySessionId.get(row.session_id) ?? buildUsageTotals();

    usageTotalsBySessionId.set(
      row.session_id,
      buildUsageTotals({
        inputTokens: currentTotals.inputTokens + usageTotals.inputTokens,
        cachedInputTokens:
          currentTotals.cachedInputTokens + usageTotals.cachedInputTokens,
        outputTokens: currentTotals.outputTokens + usageTotals.outputTokens,
      }),
    );
  }

  for (const session of sessionRows) {
    saveSessionUsageTotals(
      db,
      session.id,
      usageTotalsBySessionId.get(session.id) ?? buildUsageTotals(),
    );
  }
}

function normalizeOptionalMessageModel(model?: string | null) {
  return normalizeStoredSessionModel(model);
}

function normalizeOptionalMessageReasoningEffort(
  reasoningEffort?: string | null,
) {
  return normalizeStoredSessionReasoningEffort(reasoningEffort);
}

function normalizeRunDurationMs(runDurationMs?: number | null) {
  if (
    typeof runDurationMs !== "number" ||
    !Number.isFinite(runDurationMs) ||
    runDurationMs < 0
  ) {
    return null;
  }

  return Math.round(runDurationMs);
}

function buildMessageRunFields({
  model,
  reasoningEffort,
  runDurationMs,
  metadata,
}: {
  model?: string | null;
  reasoningEffort?: string | null;
  runDurationMs?: number | null;
  metadata?: WorkspaceMessageMetadata | null;
}) {
  const run = metadata?.run ?? null;

  return {
    model: normalizeOptionalMessageModel(model ?? run?.model ?? null),
    reasoningEffort: normalizeOptionalMessageReasoningEffort(
      reasoningEffort ?? run?.reasoningEffort ?? null,
    ),
    runDurationMs: normalizeRunDurationMs(runDurationMs ?? run?.durationMs ?? null),
  } satisfies {
    model: string | null;
    reasoningEffort: WorkspaceAgentReasoningEffort | null;
    runDurationMs: number | null;
  };
}

function mapMessageRowToWorkspaceMessage(row: MessageRow): WorkspaceMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    model: normalizeOptionalMessageModel(row.model),
    reasoningEffort: normalizeOptionalMessageReasoningEffort(
      row.reasoning_effort,
    ),
    runDurationMs: normalizeRunDurationMs(row.run_duration_ms),
    metadata: parseMessageMetadata(row.metadata_json),
  };
}

function mapSessionPromptQueueRowToWorkspaceQueuedPrompt(
  row: SessionPromptQueueRow,
  options?: {
    sessionServer?: WorkspaceProjectServer;
  },
): WorkspaceQueuedPrompt {
  return {
    id: row.id,
    content: row.content,
    createdAt: resolveCreatedAt(row.created_at),
    model:
      normalizeStoredSessionModel(row.model, {
        projectServer: options?.sessionServer,
      }) ?? DEFAULT_WORKSPACE_MODEL,
    reasoningEffort:
      normalizeStoredSessionReasoningEffort(row.reasoning_effort, {
        projectServer: options?.sessionServer,
      }) ?? DEFAULT_WORKSPACE_REASONING_EFFORT,
  };
}

function mapSessionRowToWorkspaceSession(
  row: SessionRow,
  options: {
    durationMs?: number;
    queuedPrompts?: WorkspaceQueuedPrompt[];
    messages?: WorkspaceMessage[];
    sessionServer?: WorkspaceProjectServer;
  } = {},
): WorkspaceSession {
  const queuedPrompts = options.queuedPrompts ?? [];
  const sessionServer =
    options.sessionServer ??
    resolveSessionServer(row.server, DEFAULT_WORKSPACE_PROJECT_SERVER);

  return {
    id: row.id,
    projectId: row.project_id,
    server: sessionServer,
    createdAt: resolveCreatedAt(row.created_at),
    name: row.session_name,
    preview: row.preview,
    providerId: getSessionProviderIdFromRow(row, sessionServer),
    model: normalizeSessionModelForProjectServer(sessionServer, row.model),
    reasoningEffort: normalizeSessionReasoningEffortForProjectServer(
      sessionServer,
      row.reasoning_effort,
    ),
    durationMs:
      options.durationMs ?? Math.max(row.duration_minutes, 0) * 60000,
    durationMinutes: row.duration_minutes,
    status: row.status,
    hasUnread: row.has_unread === 1,
    isArchived: row.is_archived === 1,
    usageTotals: buildUsageTotals({
      inputTokens: row.total_input_tokens,
      cachedInputTokens: row.total_cached_input_tokens,
      outputTokens: row.total_output_tokens,
    }),
    queuedPromptCount: queuedPrompts.length,
    queuedPrompts,
    messages: options.messages ?? [],
  };
}

function initializeSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      server TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_PROJECT_SERVER}' CHECK(server IN ('codex', 'claude')),
      project_path TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      valid_session_count INTEGER NOT NULL DEFAULT 0,
      active_session_count INTEGER NOT NULL DEFAULT 0,
      archived_session_count INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL,
      server TEXT NOT NULL DEFAULT '${DEFAULT_WORKSPACE_PROJECT_SERVER}' CHECK(server IN ('codex', 'claude')),
      session_name TEXT NOT NULL,
      preview TEXT NOT NULL,
      model TEXT NOT NULL,
      reasoning_effort TEXT NOT NULL DEFAULT 'medium',
      codex_thread_id TEXT NOT NULL DEFAULT '',
      claude_thread_id TEXT NOT NULL DEFAULT '',
      codex_provider_id TEXT NOT NULL DEFAULT '',
      claude_provider_id TEXT NOT NULL DEFAULT '',
      duration_minutes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      has_unread INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      total_input_tokens INTEGER NOT NULL DEFAULT 0,
      total_cached_input_tokens INTEGER NOT NULL DEFAULT 0,
      total_output_tokens INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY(project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY,
      session_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      model TEXT,
      reasoning_effort TEXT,
      run_duration_ms INTEGER,
      metadata_json TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS session_prompt_queue (
      id INTEGER PRIMARY KEY,
      session_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      model TEXT NOT NULL,
      reasoning_effort TEXT NOT NULL DEFAULT 'medium',
      sort_order INTEGER NOT NULL,
      FOREIGN KEY(session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS provider_daily_usage (
      provider_id TEXT NOT NULL,
      usage_date TEXT NOT NULL,
      total_input_tokens INTEGER NOT NULL DEFAULT 0,
      total_cached_input_tokens INTEGER NOT NULL DEFAULT 0,
      total_output_tokens INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(provider_id, usage_date)
    );

    CREATE TABLE IF NOT EXISTS runtime_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      websocket_url TEXT NOT NULL DEFAULT '',
      token TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL DEFAULT '',
      codex_agents_json TEXT NOT NULL DEFAULT '[]',
      selected_codex_agent_id TEXT NOT NULL DEFAULT '',
      default_codex_agent_id TEXT NOT NULL DEFAULT '',
      codex_provider_concurrent_session_limit INTEGER NOT NULL DEFAULT 5,
      codex_model TEXT NOT NULL DEFAULT 'gpt-5.4',
      codex_reasoning_effort TEXT NOT NULL DEFAULT 'medium',
      claude_providers_json TEXT NOT NULL DEFAULT '[]',
      selected_claude_provider_id TEXT NOT NULL DEFAULT '',
      default_claude_provider_id TEXT NOT NULL DEFAULT '',
      claude_provider_concurrent_session_limit INTEGER NOT NULL DEFAULT 5,
      claude_model TEXT NOT NULL DEFAULT '${DEFAULT_CLAUDE_MODEL}',
      claude_reasoning_effort TEXT NOT NULL DEFAULT '${DEFAULT_CLAUDE_REASONING_EFFORT}',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auth_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      jwt_secret TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS auth_users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_project_id
      ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_projects_created_at
      ON projects(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_projects_project_path
      ON projects(project_path);
    CREATE INDEX IF NOT EXISTS idx_sessions_created_at
      ON sessions(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_provider_status_archived
      ON sessions(codex_provider_id, status, is_archived);
    CREATE INDEX IF NOT EXISTS idx_sessions_claude_provider_status_archived
      ON sessions(claude_provider_id, status, is_archived);
    CREATE INDEX IF NOT EXISTS idx_messages_session_id
      ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_prompt_queue_session_order
      ON session_prompt_queue(session_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_provider_daily_usage_date
      ON provider_daily_usage(usage_date DESC, provider_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_users_username
      ON auth_users(username);
  `);

  ensureSessionsSchema(db);
  ensureProjectsSchema(db);
  ensureMessagesSchema(db);
  ensureSessionPromptQueueSchema(db);
  refreshAllSessionUsageTotals(db);
  refreshAllProviderDailyUsageTotals(db);
  ensureRuntimeSettingsSchema(db);
  ensureAuthSchema(db);
}

function prepareProjectInsertStatement(db: Database.Database) {
  if (hasColumn(db, "projects", "description")) {
    return db.prepare(
      `INSERT INTO projects (
        id,
        name,
        description,
        server,
        project_path,
        created_at,
        sort_order
      ) VALUES (
        @id,
        @name,
        @description,
        @server,
        @projectPath,
        @createdAt,
        @sortOrder
      )`,
    );
  }

  return db.prepare(
    `INSERT INTO projects (
      id,
      name,
      server,
      project_path,
      created_at,
      sort_order
    ) VALUES (
      @id,
      @name,
      @server,
      @projectPath,
      @createdAt,
      @sortOrder
    )`,
  );
}

function prepareProjectCreateStatement(db: Database.Database) {
  if (hasColumn(db, "projects", "description")) {
    return db.prepare(
      `INSERT INTO projects (
        name,
        description,
        server,
        project_path,
        created_at,
        sort_order
      ) VALUES (
        @name,
        @description,
        @server,
        @projectPath,
        @createdAt,
        @sortOrder
      )`,
    );
  }

  return db.prepare(
    `INSERT INTO projects (
      name,
      server,
      project_path,
      created_at,
      sort_order
    ) VALUES (
      @name,
      @server,
      @projectPath,
      @createdAt,
      @sortOrder
    )`,
  );
}

function prepareSessionInsertStatement(
  db: Database.Database,
  options?: {
    includeId?: boolean;
  },
) {
  const includeId = options?.includeId ?? false;
  const hasTitle = hasColumn(db, "sessions", "title");
  const hasRelativeLabel = hasColumn(db, "sessions", "relative_label");
  const columns = [];
  const values = [];

  if (includeId) {
    columns.push("id");
    values.push("@id");
  }

  columns.push("project_id", "server", "session_name");
  values.push("@projectId", "@server", "@sessionName");

  if (hasTitle) {
    columns.push("title");
    values.push("@title");
  }

  columns.push(
    "preview",
    "model",
    "reasoning_effort",
    "codex_thread_id",
    "claude_thread_id",
    "codex_provider_id",
    "claude_provider_id",
  );
  values.push(
    "@preview",
    "@model",
    "@reasoningEffort",
    "@codexThreadId",
    "@claudeThreadId",
    "@codexProviderId",
    "@claudeProviderId",
  );

  if (hasRelativeLabel) {
    columns.push("relative_label");
    values.push("@relativeLabel");
  }

  columns.push(
    "duration_minutes",
    "status",
    "has_unread",
    "is_archived",
    "is_active",
    "created_at",
    "sort_order",
  );
  values.push(
    "@durationMinutes",
    "@status",
    "@hasUnread",
    "@isArchived",
    "@isActive",
    "@createdAt",
    "@sortOrder",
  );

  return db.prepare(
    `INSERT INTO sessions (
      ${columns.join(",\n      ")}
    ) VALUES (
      ${values.join(",\n      ")}
    )`,
  );
}

function seedDatabase(db: Database.Database) {
  const projectCount = db.prepare("SELECT COUNT(*) AS count FROM projects").get() as {
    count: number;
  };

  if (projectCount.count > 0 || demoWorkspace.projects.length === 0) {
    return;
  }

  const insertProject = prepareProjectInsertStatement(db);
  const insertSession = prepareSessionInsertStatement(db, { includeId: true });
  const insertMessage = db.prepare(
    `INSERT INTO messages (
      id,
      session_id,
      role,
      content,
      created_at,
      model,
      reasoning_effort,
      run_duration_ms,
      metadata_json,
      sort_order
    ) VALUES (
      @id,
      @sessionId,
      @role,
      @content,
      @createdAt,
      @model,
      @reasoningEffort,
      @runDurationMs,
      @metadataJson,
      @sortOrder
    )`,
  );

  const writeSeed = db.transaction(() => {
    demoWorkspace.projects.forEach((project, projectIndex) => {
      const projectServer = normalizeWorkspaceProjectServer(project.server);

      insertProject.run({
        id: project.id,
        name: project.name,
        description: "",
        server: projectServer,
        projectPath: project.path,
        createdAt: project.createdAt,
        sortOrder: projectIndex,
      });

      project.sessions.forEach((session, sessionIndex) => {
        const sessionProviderId = session.providerId?.trim() ?? "";

        insertSession.run({
          id: session.id,
          projectId: project.id,
          server: projectServer,
          sessionName: session.name,
          title: session.name,
          preview: session.preview,
          model: normalizeSessionModelForProjectServer(
            projectServer,
            session.model,
          ),
          reasoningEffort: normalizeSessionReasoningEffortForProjectServer(
            projectServer,
            session.reasoningEffort,
          ),
          codexThreadId: "",
          claudeThreadId: "",
          codexProviderId: projectServer === "claude" ? "" : sessionProviderId,
          claudeProviderId: projectServer === "claude" ? sessionProviderId : "",
          relativeLabel: formatLegacyRelativeLabel(session.durationMinutes),
          durationMinutes: session.durationMinutes,
          status: session.status,
          hasUnread: 0,
          isArchived: session.isArchived ? 1 : 0,
          isActive: session.id === demoWorkspace.selectedSessionId ? 1 : 0,
          createdAt: session.createdAt,
          sortOrder: sessionIndex,
        });

        session.messages.forEach((message, messageIndex) => {
          const messageRunFields = buildMessageRunFields({
            model: message.model,
            reasoningEffort: message.reasoningEffort,
            runDurationMs: message.runDurationMs,
            metadata: message.metadata,
          });

          insertMessage.run({
            id: message.id,
            sessionId: session.id,
            role: message.role,
            content: message.content,
            createdAt: message.createdAt,
            model: messageRunFields.model,
            reasoningEffort: messageRunFields.reasoningEffort,
            runDurationMs: messageRunFields.runDurationMs,
            metadataJson: serializeMessageMetadata(message.metadata),
            sortOrder: messageIndex,
          });
        });
      });
    });

    refreshAllSessionUsageTotals(db);
    refreshAllProviderDailyUsageTotals(db);
    refreshAllProjectSessionCounts(db);
  });

  writeSeed();
}

function isDatabaseSchemaOutdated(db: Database.Database) {
  return (
    !hasColumn(db, "sessions", "claude_thread_id") ||
    !hasColumn(db, "sessions", "claude_provider_id")
  );
}

function getDb() {
  if (database) {
    if (isDatabaseSchemaOutdated(database)) {
      initializeSchema(database);
    }

    return database;
  }

  database = new Database(getDatabasePath());
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  initializeSchema(database);
  seedDatabase(database);
  return database;
}

function mapAuthUserRow(row: AuthUserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    createdAt: resolveCreatedAt(row.created_at),
    updatedAt: resolveCreatedAt(row.updated_at),
  };
}

function mapAuthUserRowToCredentials(row: AuthUserRow): AuthUserCredentials {
  return {
    ...mapAuthUserRow(row),
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
  };
}

function buildSessionPreview(content: string) {
  const compactContent = content.replace(/\s+/g, " ").trim();

  if (compactContent.length <= 80) {
    return compactContent;
  }

  return `${compactContent.slice(0, 77)}...`;
}

function buildSessionName(content: string) {
  return buildSessionTitle(content);
}

function formatLegacyRelativeLabel(durationMinutes: number) {
  if (durationMinutes <= 0) {
    return "0 分钟";
  }

  const days = Math.floor(durationMinutes / (24 * 60));
  const remainingAfterDays = durationMinutes % (24 * 60);
  const hours = Math.floor(remainingAfterDays / 60);
  const minutes = remainingAfterDays % 60;

  if (days > 0 && hours > 0) {
    return `${days} 天 ${hours} 小时`;
  }

  if (days > 0) {
    return `${days} 天`;
  }

  if (hours > 0 && minutes > 0) {
    return `${hours} 小时 ${minutes} 分钟`;
  }

  if (hours > 0) {
    return `${hours} 小时`;
  }

  return `${minutes} 分钟`;
}

export function getStoredWorkspaceSettings(): WorkspaceSettings {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        websocket_url,
        token,
        base_url,
        codex_agents_json,
        selected_codex_agent_id,
        default_codex_agent_id,
        codex_provider_concurrent_session_limit,
        codex_model,
        codex_reasoning_effort,
        claude_providers_json,
        selected_claude_provider_id,
        default_claude_provider_id,
        claude_provider_concurrent_session_limit,
        claude_model,
        claude_reasoning_effort
      FROM runtime_settings
      WHERE id = 1`,
    )
    .get() as RuntimeSettingsRow | undefined;

  if (!row) {
    return defaultWorkspaceSettings;
  }

  const parsedCodexProviders = parseStoredCodexProviders(row.codex_agents_json);
  const codexProviders =
    parsedCodexProviders.length > 0
      ? parsedCodexProviders
      : row.base_url.trim()
        ? [buildLegacyCodexProvider(row.base_url)]
        : [];
  const codexProviderIds = resolveWorkspaceCodexProviderIds({
    providers: codexProviders,
    selectedCodexProviderId: row.selected_codex_agent_id,
    defaultCodexProviderId: row.default_codex_agent_id,
  });
  const claudeProviders = parseStoredClaudeProviders(row.claude_providers_json);
  const claudeProviderIds = resolveWorkspaceClaudeProviderIds({
    providers: claudeProviders,
    selectedClaudeProviderId: row.selected_claude_provider_id,
    defaultClaudeProviderId: row.default_claude_provider_id,
  });

  return {
    websocketUrl: row.websocket_url,
    token: row.token,
    codexProviders,
    selectedCodexProviderId: codexProviderIds.selectedCodexProviderId,
    defaultCodexProviderId: codexProviderIds.defaultCodexProviderId,
    codexProviderConcurrentSessionLimit:
      normalizeWorkspaceProviderConcurrentSessionLimit(
        row.codex_provider_concurrent_session_limit,
      ),
    codexModel: normalizeWorkspaceModel(row.codex_model),
    codexReasoningEffort: normalizeReasoningEffort(
      row.codex_reasoning_effort,
    ),
    claudeProviders,
    selectedClaudeProviderId: claudeProviderIds.selectedClaudeProviderId,
    defaultClaudeProviderId: claudeProviderIds.defaultClaudeProviderId,
    claudeProviderConcurrentSessionLimit:
      normalizeWorkspaceProviderConcurrentSessionLimit(
        row.claude_provider_concurrent_session_limit,
      ),
    claudeModel: normalizeClaudeModel(row.claude_model),
    claudeReasoningEffort: normalizeClaudeReasoningEffort(
      row.claude_reasoning_effort,
    ),
  };
}

export function resolveWorkspaceSessionId(preferredSessionId?: number | null) {
  const db = getDb();

  if (typeof preferredSessionId === "number") {
    const matchingSession = db
      .prepare("SELECT id FROM sessions WHERE id = ?")
      .get(preferredSessionId) as SessionIdentityRow | undefined;

    if (matchingSession) {
      return matchingSession.id;
    }
  }

  const activeSession = db
    .prepare("SELECT id FROM sessions WHERE is_active = 1 ORDER BY id ASC LIMIT 1")
    .get() as SessionIdentityRow | undefined;

  if (activeSession) {
    return activeSession.id;
  }

  const fallbackSession = db
    .prepare(
      `SELECT s.id
      FROM sessions s
      JOIN projects p ON p.id = s.project_id
      ORDER BY s.is_archived ASC,
        datetime(p.created_at) DESC,
        p.id DESC,
        datetime(s.created_at) DESC,
        s.id DESC
      LIMIT 1`,
    )
    .get() as SessionIdentityRow | undefined;

  if (fallbackSession) {
    return fallbackSession.id;
  }

  throw new Error("当前工作区没有可用会话。");
}

export function setActiveSession(sessionId: number) {
  const db = getDb();
  const existingSession = db
    .prepare("SELECT id FROM sessions WHERE id = ?")
    .get(sessionId) as SessionIdentityRow | undefined;

  if (!existingSession) {
    throw new Error("会话不存在。");
  }

  db.prepare(
    `UPDATE sessions
    SET is_active = CASE WHEN id = @sessionId THEN 1 ELSE 0 END`,
  ).run({ sessionId });
}

export function createProject(projectPath: string) {
  const db = getDb();
  const normalizedProjectPath = normalizeProjectPath(projectPath);

  if (!fs.existsSync(normalizedProjectPath)) {
    throw new Error("选择的目录不存在。");
  }

  if (!fs.statSync(normalizedProjectPath).isDirectory()) {
    throw new Error("只能添加文件夹目录作为项目。");
  }

  const existingProject = db
    .prepare(
      `SELECT
        id,
        name,
        project_path
      FROM projects
      WHERE project_path = ?`,
    )
    .get(normalizedProjectPath) as ProjectIdentityRow | undefined;

  if (existingProject) {
    throw new Error(`项目已存在：${existingProject.name}`);
  }

  const projectName = path.basename(normalizedProjectPath) || normalizedProjectPath;
  const createdAt = getCurrentTimestamp();

  const create = db.transaction(() => {
    const insertProject = prepareProjectCreateStatement(db);
    const nextSortOrderRow = db
      .prepare(
        "SELECT COALESCE(MIN(sort_order), 0) - 1 AS next_sort_order FROM projects",
      )
      .get() as { next_sort_order: number };
    const insertResult = insertProject.run({
      name: projectName,
      description: "",
      server: DEFAULT_WORKSPACE_PROJECT_SERVER,
      projectPath: normalizedProjectPath,
      createdAt,
      sortOrder: nextSortOrderRow.next_sort_order,
    });

    return {
      id: Number(insertResult.lastInsertRowid),
      name: projectName,
      server: DEFAULT_WORKSPACE_PROJECT_SERVER,
      path: normalizedProjectPath,
      createdAt,
      validSessionCount: 0,
      activeSessionCount: 0,
      archivedSessionCount: 0,
      sessions: [],
    } satisfies WorkspacePayload["projects"][number];
  });

  return create();
}

export function getProject(projectId: number) {
  const db = getDb();
  const project = db
    .prepare(
      `SELECT
        id,
        name,
        server,
        project_path,
        created_at,
        valid_session_count,
        active_session_count,
        archived_session_count
      FROM projects
      WHERE id = ?`,
    )
    .get(projectId) as
    | (ProjectIdentityRow & {
        created_at: string;
        valid_session_count: number;
        active_session_count: number;
        archived_session_count: number;
      })
    | undefined;

  if (!project) {
    return null;
  }

  return {
    id: project.id,
    name: project.name,
    server: normalizeWorkspaceProjectServer(project.server),
    path: project.project_path,
    createdAt: project.created_at,
    validSessionCount: project.valid_session_count,
    activeSessionCount: project.active_session_count,
    archivedSessionCount: project.archived_session_count,
  };
}

export function renameProject(projectId: number, nextName: string) {
  const db = getDb();
  const trimmedName = nextName.trim();

  if (!trimmedName) {
    throw new Error("项目名称不能为空。");
  }

  const rename = db.transaction(() => {
    const project = getProject(projectId);

    if (!project) {
      throw new Error("项目不存在。");
    }

    if (project.name === trimmedName) {
      return project;
    }

    db.prepare(
      `UPDATE projects
      SET name = @name
      WHERE id = @projectId`,
    ).run({
      projectId,
      name: trimmedName,
    });

    return getProject(projectId);
  });

  const renamedProject = rename();

  if (!renamedProject) {
    throw new Error("项目不存在。");
  }

  return renamedProject;
}

export function setProjectServer(projectId: number, nextServer: string) {
  const db = getDb();
  const normalizedServer = normalizeWorkspaceProjectServer(nextServer);

  const update = db.transaction(() => {
    const project = getProject(projectId);

    if (!project) {
      throw new Error("项目不存在。");
    }

    if (project.server === normalizedServer) {
      return project;
    }

    db.prepare(
      `UPDATE projects
      SET server = @server
      WHERE id = @projectId`,
    ).run({
      projectId,
      server: normalizedServer,
    });

    return getProject(projectId);
  });

  const updatedProject = update();

  if (!updatedProject) {
    throw new Error("项目不存在。");
  }

  return updatedProject;
}

export function removeProject(projectId: number) {
  const db = getDb();
  const project = getProject(projectId);

  if (!project) {
    throw new Error("项目不存在。");
  }

  const remove = db.transaction(() => {
    db.prepare(
      `DELETE FROM messages
      WHERE session_id IN (
        SELECT id FROM sessions WHERE project_id = ?
      )`,
    ).run(projectId);
    db.prepare(
      `DELETE FROM session_prompt_queue
      WHERE session_id IN (
        SELECT id FROM sessions WHERE project_id = ?
      )`,
    ).run(projectId);

    db.prepare("DELETE FROM sessions WHERE project_id = ?").run(projectId);
    db.prepare("DELETE FROM projects WHERE id = ?").run(projectId);
    refreshAllProviderDailyUsageTotals(db);

    const activeSession = db
      .prepare("SELECT id FROM sessions WHERE is_active = 1 ORDER BY id ASC LIMIT 1")
      .get() as SessionIdentityRow | undefined;

    if (!activeSession) {
      const fallbackSession = db
        .prepare(
          `SELECT id
          FROM sessions
          ORDER BY is_archived ASC, datetime(created_at) DESC, id DESC
          LIMIT 1`,
        )
        .get() as SessionIdentityRow | undefined;

      if (fallbackSession) {
        db.prepare(
          `UPDATE sessions
          SET is_active = CASE WHEN id = @sessionId THEN 1 ELSE 0 END`,
        ).run({
          sessionId: fallbackSession.id,
        });
      }
    }

    return project;
  });

  return remove();
}

export function createSession({
  projectId,
  initialPrompt,
  server,
  model,
  reasoningEffort,
  providerId,
  status = SESSION_STATUS_IN_PROGRESS,
}: {
  projectId: number;
  initialPrompt: string;
  server?: string | null;
  model: string;
  reasoningEffort: string;
  providerId?: string | null;
  status?: string;
}) {
  const db = getDb();
  const trimmedPrompt = initialPrompt.trim();
  const normalizedStatus = status.trim() || SESSION_STATUS_IN_PROGRESS;

  if (!trimmedPrompt) {
    throw new Error("创建会话时缺少初始消息。");
  }

  const project = db
    .prepare("SELECT id, server FROM projects WHERE id = ?")
    .get(projectId) as
    | (SessionIdentityRow & {
        server: string;
      })
    | undefined;

  if (!project) {
    throw new Error("项目不存在。");
  }

  const sessionName = buildSessionName(trimmedPrompt);
  const sessionServer = resolveSessionServer(server, normalizeWorkspaceProjectServer(project.server));
  const normalizedModel = normalizeSessionModelForProjectServer(
    sessionServer,
    model,
  );
  const normalizedReasoningEffort =
    normalizeSessionReasoningEffortForProjectServer(
      sessionServer,
      reasoningEffort,
    );
  const preview = buildSessionPreview(trimmedPrompt);
  const insertSession = prepareSessionInsertStatement(db);
  const createdAt = getCurrentTimestamp();
  const normalizedProviderId = providerId?.trim() ?? "";

  const create = db.transaction(() => {
    const nextSortOrderRow = db
      .prepare(
        "SELECT COALESCE(MIN(sort_order), 0) - 1 AS next_sort_order FROM sessions WHERE project_id = ?",
      )
      .get(projectId) as { next_sort_order: number };

    db.prepare("UPDATE sessions SET is_active = 0").run();

    const insertResult = insertSession.run({
      projectId,
      server: sessionServer,
      sessionName,
      title: sessionName,
      preview,
      model: normalizedModel,
      reasoningEffort: normalizedReasoningEffort,
      codexThreadId: "",
      claudeThreadId: "",
      codexProviderId: sessionServer === "claude" ? "" : normalizedProviderId,
      claudeProviderId: sessionServer === "claude" ? normalizedProviderId : "",
      relativeLabel: formatLegacyRelativeLabel(0),
      durationMinutes: 0,
      status: normalizedStatus,
      hasUnread: 0,
      isArchived: 0,
      isActive: 1,
      createdAt,
      sortOrder: nextSortOrderRow.next_sort_order,
    });

    refreshProjectSessionCounts(db, projectId);

    return {
      id: Number(insertResult.lastInsertRowid),
      projectId,
      server: sessionServer,
      createdAt,
      name: sessionName,
      preview,
      providerId: normalizedProviderId,
      model: normalizedModel,
      reasoningEffort: normalizedReasoningEffort,
      durationMs: 0,
      durationMinutes: 0,
      status: normalizedStatus,
      hasUnread: false,
      isArchived: false,
      usageTotals: buildUsageTotals(),
      queuedPromptCount: 0,
      queuedPrompts: [],
      messages: [],
    } satisfies WorkspacePayload["projects"][number]["sessions"][number];
  });

  return create();
}

export function getSessionMessages(sessionId: number): WorkspaceMessage[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT
        id,
        session_id,
        role,
        content,
        created_at,
        model,
        reasoning_effort,
        run_duration_ms,
        metadata_json,
        sort_order
      FROM messages
      WHERE session_id = ?
      ORDER BY sort_order ASC, id ASC`,
    )
    .all(sessionId) as MessageRow[];

  return rows.map(mapMessageRowToWorkspaceMessage);
}

export function getSessionUsageTotals(sessionId: number) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        total_input_tokens,
        total_cached_input_tokens,
        total_output_tokens
      FROM sessions
      WHERE id = ?`,
    )
    .get(sessionId) as SessionUsageTotalsRow | undefined;

  if (!row) {
    return null;
  }

  return buildUsageTotals({
    inputTokens: row.total_input_tokens,
    cachedInputTokens: row.total_cached_input_tokens,
    outputTokens: row.total_output_tokens,
  });
}

export function getProviderDailyUsage({
  providerId,
  startDate,
  endDate,
}: {
  providerId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
} = {}) {
  const db = getDb();
  const normalizedProviderId = providerId?.trim() ?? "";
  const hasStartDateInput = typeof startDate === "string" && startDate.trim().length > 0;
  const hasEndDateInput = typeof endDate === "string" && endDate.trim().length > 0;
  const normalizedStartDate = normalizeUsageDateKey(startDate);
  const normalizedEndDate = normalizeUsageDateKey(endDate);

  if (hasStartDateInput && !normalizedStartDate) {
    throw new Error("开始日期格式必须为 YYYY-MM-DD。");
  }

  if (hasEndDateInput && !normalizedEndDate) {
    throw new Error("结束日期格式必须为 YYYY-MM-DD。");
  }

  const whereClauses: string[] = [];
  const queryParams: {
    providerId?: string;
    startDate?: string;
    endDate?: string;
  } = {};

  if (normalizedProviderId) {
    whereClauses.push("provider_id = @providerId");
    queryParams.providerId = normalizedProviderId;
  }

  if (normalizedStartDate) {
    whereClauses.push("usage_date >= @startDate");
    queryParams.startDate = normalizedStartDate;
  }

  if (normalizedEndDate) {
    whereClauses.push("usage_date <= @endDate");
    queryParams.endDate = normalizedEndDate;
  }

  const rows = db
    .prepare(
      `SELECT
        provider_id,
        usage_date,
        total_input_tokens,
        total_cached_input_tokens,
        total_output_tokens
      FROM provider_daily_usage
      ${
        whereClauses.length > 0
          ? `WHERE ${whereClauses.join("\n        AND ")}`
          : ""
      }
      ORDER BY usage_date DESC, provider_id ASC`,
    )
    .all(queryParams) as ProviderDailyUsageRow[];

  return rows.map((row) => ({
    providerId: row.provider_id,
    usageDate: row.usage_date,
    usageTotals: buildUsageTotals({
      inputTokens: row.total_input_tokens,
      cachedInputTokens: row.total_cached_input_tokens,
      outputTokens: row.total_output_tokens,
    }),
  }));
}

export function getSessionUserMessages(sessionId: number) {
  const db = getDb();
  const session = db
    .prepare("SELECT id FROM sessions WHERE id = ?")
    .get(sessionId) as SessionIdentityRow | undefined;

  if (!session) {
    return null;
  }

  const rows = db
    .prepare(
      `SELECT
        id,
        session_id,
        role,
        content,
        created_at,
        model,
        reasoning_effort,
        run_duration_ms,
        metadata_json,
        sort_order
      FROM messages
      WHERE session_id = ?
        AND role = 'user'
      ORDER BY sort_order ASC, id ASC`,
    )
    .all(sessionId) as MessageRow[];

  return rows.map(mapMessageRowToWorkspaceMessage);
}

export function getSessionStatus(sessionId: number) {
  const db = getDb();
  const row = db
    .prepare("SELECT status FROM sessions WHERE id = ?")
    .get(sessionId) as SessionStatusRow | undefined;

  return row?.status ?? null;
}

export function getSessionProjectServer(sessionId: number) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        s.server,
        p.server AS project_server
      FROM sessions s
      JOIN projects p ON p.id = s.project_id
      WHERE s.id = ?`,
    )
    .get(sessionId) as
    | {
        server: string;
        project_server: string;
      }
    | undefined;

  return row
    ? resolveSessionServer(
        row.server,
        normalizeWorkspaceProjectServer(row.project_server),
      )
    : null;
}

export function getSessionQueuedPrompts(sessionId: number) {
  const db = getDb();
  const session = db
    .prepare("SELECT id FROM sessions WHERE id = ?")
    .get(sessionId) as SessionIdentityRow | undefined;

  if (!session) {
    return null;
  }

  const rows = db
    .prepare(
      `SELECT
        id,
        session_id,
        content,
        created_at,
        model,
        reasoning_effort,
        sort_order
      FROM session_prompt_queue
      WHERE session_id = ?
      ORDER BY sort_order ASC, id ASC`,
    )
    .all(sessionId) as SessionPromptQueueRow[];

  return rows.map((row) => mapSessionPromptQueueRowToWorkspaceQueuedPrompt(row));
}

export function getSessionQueuedPromptCount(sessionId: number) {
  return getSessionQueuedPrompts(sessionId)?.length ?? 0;
}

export function getProjectSessionsPage(
  projectId: number,
  {
    offset = 0,
    limit = 10,
    archived = false,
  }: {
    offset?: number;
    limit?: number;
    archived?: boolean;
  } = {},
) {
  const db = getDb();
  const project = db
    .prepare("SELECT id, server FROM projects WHERE id = ?")
    .get(projectId) as
    | (ProjectIdentityRow & {
        server: string;
      })
    | undefined;

  if (!project) {
    return null;
  }

  const normalizedOffset = Math.max(Math.trunc(offset), 0);
  const normalizedLimit = Math.max(Math.trunc(limit), 1);
  const archivedValue = archived ? 1 : 0;
  const projectServer = normalizeWorkspaceProjectServer(project.server);
  const totalCountRow = db
    .prepare(
      `SELECT COUNT(*) AS total_count
      FROM sessions
      WHERE project_id = @projectId
        AND is_archived = @archived`,
    )
    .get({
      projectId,
      archived: archivedValue,
    }) as { total_count: number } | undefined;
  const totalCount = Math.max(totalCountRow?.total_count ?? 0, 0);
  const sessionRows = db
    .prepare(
      `SELECT
        id,
        project_id,
        server,
        session_name,
        preview,
        model,
        reasoning_effort,
        codex_thread_id,
        codex_provider_id,
        claude_thread_id,
        claude_provider_id,
        duration_minutes,
        status,
        has_unread,
        is_archived,
        is_active,
        created_at,
        total_input_tokens,
        total_cached_input_tokens,
        total_output_tokens,
        sort_order
      FROM sessions
      WHERE project_id = @projectId
        AND is_archived = @archived
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT @limit OFFSET @offset`,
    )
    .all({
      projectId,
      archived: archivedValue,
      limit: normalizedLimit,
      offset: normalizedOffset,
    }) as SessionRow[];

  return {
    sessions: sessionRows.map((row) => {
      const sessionServer = resolveSessionServer(row.server, projectServer);

      return mapSessionRowToWorkspaceSession(row, {
        sessionServer,
      });
    }),
    totalCount,
    hasMore: normalizedOffset + sessionRows.length < totalCount,
  };
}

export function getNextQueuedSessionPrompt() {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        q.id,
        q.session_id,
        q.content,
        q.created_at,
        q.model,
        q.reasoning_effort,
        s.server AS session_server,
        p.server AS project_server,
        q.sort_order
      FROM session_prompt_queue q
      JOIN sessions s ON s.id = q.session_id
      JOIN projects p ON p.id = s.project_id
      WHERE s.is_archived = 0
      ORDER BY datetime(q.created_at) ASC, q.id ASC
      LIMIT 1`,
    )
    .get() as
    | (SessionPromptQueueRow & {
        session_server: string;
        project_server: string;
      })
    | undefined;

  if (!row) {
    return null;
  }

  const sessionServer = resolveSessionServer(
    row.session_server,
    normalizeWorkspaceProjectServer(row.project_server),
  );

  return {
    id: row.id,
    sessionId: row.session_id,
    content: row.content,
    createdAt: resolveCreatedAt(row.created_at),
    model:
      normalizeStoredSessionModel(row.model, {
        projectServer: sessionServer,
      }) ?? DEFAULT_WORKSPACE_MODEL,
    reasoningEffort:
      normalizeStoredSessionReasoningEffort(row.reasoning_effort, {
        projectServer: sessionServer,
      }) ?? DEFAULT_WORKSPACE_REASONING_EFFORT,
  } satisfies WorkspaceQueuedPrompt & {
    sessionId: number;
  };
}

export function enqueueSessionPrompt({
  sessionId,
  content,
  model,
  reasoningEffort,
}: {
  sessionId: number;
  content: string;
  model: string;
  reasoningEffort: string;
}) {
  const db = getDb();
  const trimmedContent = content.trim();

  if (!trimmedContent) {
    throw new Error("消息内容不能为空。");
  }

  const enqueue = db.transaction(() => {
    const session = db
      .prepare(
        `SELECT
          s.id,
          s.project_id,
          s.server AS session_server,
          p.server AS project_server
        FROM sessions s
        JOIN projects p ON p.id = s.project_id
        WHERE s.id = ?`,
      )
      .get(sessionId) as
      | (SessionProjectRow & {
          session_server: string;
          project_server: string;
        })
      | undefined;

    if (!session) {
      throw new Error("会话不存在。");
    }

    const sessionServer = resolveSessionServer(
      session.session_server,
      normalizeWorkspaceProjectServer(session.project_server),
    );
    const normalizedModel = normalizeSessionModelForProjectServer(
      sessionServer,
      model,
    );
    const normalizedReasoningEffort =
      normalizeSessionReasoningEffortForProjectServer(
        sessionServer,
        reasoningEffort,
      );

    const nextSortOrderRow = db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order
        FROM session_prompt_queue
        WHERE session_id = ?`,
      )
      .get(sessionId) as { next_sort_order: number };
    const createdAt = getCurrentTimestamp();
    const result = db
      .prepare(
        `INSERT INTO session_prompt_queue (
          session_id,
          content,
          created_at,
          model,
          reasoning_effort,
          sort_order
        ) VALUES (
          @sessionId,
          @content,
          @createdAt,
          @model,
          @reasoningEffort,
          @sortOrder
        )`,
      )
      .run({
        sessionId,
        content: trimmedContent,
        createdAt,
        model: normalizedModel,
        reasoningEffort: normalizedReasoningEffort,
        sortOrder: nextSortOrderRow.next_sort_order,
      });

    refreshProjectSessionCounts(db, session.project_id);

    return {
      id: Number(result.lastInsertRowid),
      session_id: sessionId,
      content: trimmedContent,
      created_at: createdAt,
      model: normalizedModel,
      reasoning_effort: normalizedReasoningEffort,
      sort_order: nextSortOrderRow.next_sort_order,
    } satisfies SessionPromptQueueRow;
  });

  return mapSessionPromptQueueRowToWorkspaceQueuedPrompt(enqueue());
}

export function dequeueSessionPrompt(sessionId: number) {
  const db = getDb();

  const dequeue = db.transaction(() => {
    const session = db
      .prepare("SELECT id, project_id FROM sessions WHERE id = ?")
      .get(sessionId) as SessionProjectRow | undefined;

    if (!session) {
      throw new Error("会话不存在。");
    }

    const row = db
      .prepare(
        `SELECT
          id,
          session_id,
          content,
          created_at,
          model,
          reasoning_effort,
          sort_order
        FROM session_prompt_queue
        WHERE session_id = ?
        ORDER BY sort_order ASC, id ASC
        LIMIT 1`,
      )
      .get(sessionId) as SessionPromptQueueRow | undefined;

    if (!row) {
      return null;
    }

    db.prepare("DELETE FROM session_prompt_queue WHERE id = ?").run(row.id);
    refreshProjectSessionCounts(db, session.project_id);

    return row;
  });

  const dequeuedRow = dequeue();
  return dequeuedRow
    ? mapSessionPromptQueueRowToWorkspaceQueuedPrompt(dequeuedRow)
    : null;
}

export function removeQueuedSessionPrompt(
  queuedPromptId: number,
  options?: {
    markSessionCompletedWhenQueueEmpty?: boolean;
  },
) {
  const db = getDb();
  const shouldMarkSessionCompletedWhenQueueEmpty =
    options?.markSessionCompletedWhenQueueEmpty ?? false;

  const remove = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT
          q.session_id,
          s.project_id,
          s.status
        FROM session_prompt_queue q
        JOIN sessions s ON s.id = q.session_id
        WHERE q.id = ?`,
      )
      .get(queuedPromptId) as
      | {
          session_id: number;
          project_id: number;
          status: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    db.prepare("DELETE FROM session_prompt_queue WHERE id = ?").run(
      queuedPromptId,
    );

    if (shouldMarkSessionCompletedWhenQueueEmpty) {
      const remainingQueueCount =
        (
          db
            .prepare(
              `SELECT COUNT(*) AS queued_prompt_count
              FROM session_prompt_queue
              WHERE session_id = ?`,
            )
            .get(row.session_id) as
            | {
                queued_prompt_count: number;
              }
            | undefined
        )?.queued_prompt_count ?? 0;

      if (
        remainingQueueCount === 0 &&
        row.status === SESSION_STATUS_PENDING
      ) {
        db.prepare("UPDATE sessions SET status = @status WHERE id = @sessionId").run({
          sessionId: row.session_id,
          status: SESSION_STATUS_COMPLETED,
        });
      }
    }

    refreshProjectSessionCounts(db, row.project_id);

    return row.session_id;
  });

  return remove();
}

export function getInProgressSessionCountByProvider(
  providerId?: string | null,
  options?: {
    projectServer?: WorkspaceProjectServer | null;
  },
) {
  const db = getDb();
  const normalizedProviderId = providerId?.trim() ?? "";
  const normalizedProjectServer = options?.projectServer?.trim()
    ? normalizeWorkspaceProjectServer(options.projectServer)
    : null;
  const row = normalizedProjectServer
    ? (db
        .prepare(
          `SELECT COUNT(*) AS in_progress_count
          FROM sessions
          WHERE ${getSessionProviderColumnForProjectServer(normalizedProjectServer)} = @providerId
            AND is_archived = 0
            AND status = @status`,
        )
        .get({
          providerId: normalizedProviderId,
          status: SESSION_STATUS_IN_PROGRESS,
        }) as SessionInProgressCountRow | undefined)
    : (db
        .prepare(
          `SELECT COUNT(*) AS in_progress_count
          FROM sessions
          WHERE (
            codex_provider_id = @providerId
            OR claude_provider_id = @providerId
          )
            AND is_archived = 0
            AND status = @status`,
        )
        .get({
          providerId: normalizedProviderId,
          status: SESSION_STATUS_IN_PROGRESS,
        }) as SessionInProgressCountRow | undefined);

  return Math.max(row?.in_progress_count ?? 0, 0);
}

export function getSessionProjectPath(sessionId: number) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT p.project_path
      FROM sessions s
      JOIN projects p ON p.id = s.project_id
      WHERE s.id = ?`,
    )
    .get(sessionId) as SessionProjectPathRow | undefined;

  return row?.project_path.trim() ? row.project_path.trim() : null;
}

function getSessionThreadIdByColumn(
  sessionId: number,
  column: "codex_thread_id" | "claude_thread_id",
) {
  const db = getDb();
  const row = db
    .prepare(`SELECT ${column} AS thread_id FROM sessions WHERE id = ?`)
    .get(sessionId) as SessionThreadRow | undefined;

  return row?.thread_id.trim() ? row.thread_id.trim() : null;
}

function saveSessionThreadIdByColumn(
  sessionId: number,
  threadId: string,
  column: "codex_thread_id" | "claude_thread_id",
) {
  const db = getDb();
  const trimmedThreadId = threadId.trim();

  if (!trimmedThreadId) {
    return;
  }

  db.prepare(`UPDATE sessions SET ${column} = @threadId WHERE id = @sessionId`).run({
    sessionId,
    threadId: trimmedThreadId,
  });
}

export function getSessionCodexThreadId(sessionId: number) {
  return getSessionThreadIdByColumn(sessionId, "codex_thread_id");
}

export function getSessionClaudeThreadId(sessionId: number) {
  return getSessionThreadIdByColumn(sessionId, "claude_thread_id");
}

export function saveSessionCodexThreadId(sessionId: number, threadId: string) {
  saveSessionThreadIdByColumn(sessionId, threadId, "codex_thread_id");
}

export function saveSessionClaudeThreadId(sessionId: number, threadId: string) {
  saveSessionThreadIdByColumn(sessionId, threadId, "claude_thread_id");
}

export function getSessionAgentConfig(sessionId: number) {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        s.model,
        s.reasoning_effort,
        CASE
          WHEN s.server = 'claude' THEN s.claude_provider_id
          ELSE s.codex_provider_id
        END AS provider_id,
        s.server AS server
      FROM sessions s
      WHERE s.id = ?`,
    )
    .get(sessionId) as SessionAgentConfigRow | undefined;

  if (!row) {
    return null;
  }

  const sessionServer = resolveSessionServer(row.server);

  return {
    model: normalizeSessionModelForProjectServer(sessionServer, row.model),
    reasoningEffort: normalizeSessionReasoningEffortForProjectServer(
      sessionServer,
      row.reasoning_effort,
    ),
    providerId: row.provider_id.trim(),
    server: sessionServer,
  } satisfies {
    model: string;
    reasoningEffort: WorkspaceAgentReasoningEffort;
    providerId: string;
    server: WorkspaceProjectServer;
  };
}

export function saveSessionAgentConfig({
  sessionId,
  model,
  reasoningEffort,
  providerId,
}: {
  sessionId: number;
  model: string;
  reasoningEffort: string;
  providerId?: string | null;
}) {
  const db = getDb();
  const session = db
    .prepare(
      `SELECT
        s.id,
        s.server AS session_server,
        p.server AS project_server
      FROM sessions s
      JOIN projects p ON p.id = s.project_id
      WHERE s.id = ?`,
    )
    .get(sessionId) as
    | {
        id: number;
        session_server: string;
        project_server: string;
      }
    | undefined;

  if (!session) {
    throw new Error("会话不存在。");
  }

  const sessionServer = resolveSessionServer(
    session.session_server,
    normalizeWorkspaceProjectServer(session.project_server),
  );
  const normalizedModel = normalizeSessionModelForProjectServer(
    sessionServer,
    model,
  );
  const normalizedReasoningEffort =
    normalizeSessionReasoningEffortForProjectServer(
      sessionServer,
      reasoningEffort,
    );
  const normalizedProviderId = providerId?.trim() ?? "";
  const providerColumn = getSessionProviderColumnForProjectServer(sessionServer);
  const result = db
    .prepare(
      `UPDATE sessions
      SET model = @model,
          reasoning_effort = @reasoningEffort,
          ${providerColumn} = @providerId
      WHERE id = @sessionId`,
    )
    .run({
      sessionId,
      model: normalizedModel,
      reasoningEffort: normalizedReasoningEffort,
      providerId: normalizedProviderId,
    });

  if (result.changes === 0) {
    throw new Error("会话不存在。");
  }

  return {
    model: normalizedModel,
    reasoningEffort: normalizedReasoningEffort,
    providerId: normalizedProviderId,
    server: sessionServer,
  } satisfies {
    model: string;
    reasoningEffort: WorkspaceAgentReasoningEffort;
    providerId: string;
    server: WorkspaceProjectServer;
  };
}

export function backfillSessionMessageRunProvider({
  sessionId,
  providerId,
  providerLabel,
}: {
  sessionId: number;
  providerId?: string | null;
  providerLabel?: string | null;
}) {
  const db = getDb();
  const normalizedProviderId = providerId?.trim() ?? "";
  const normalizedProviderLabel = providerLabel?.trim() || "默认环境";

  if (!normalizedProviderId) {
    return 0;
  }

  const rows = db
    .prepare(
      `SELECT id, metadata_json
      FROM messages
      WHERE session_id = ?
      ORDER BY sort_order ASC, id ASC`,
    )
    .all(sessionId) as Array<{
      id: number;
      metadata_json: string;
    }>;
  const updateMessage = db.prepare(
    `UPDATE messages
    SET metadata_json = @metadataJson
    WHERE id = @id`,
  );

  const backfill = db.transaction(() => {
    let updatedCount = 0;

    for (const row of rows) {
      const metadata = parseMessageMetadata(row.metadata_json);
      const run = metadata?.run;

      if (!run) {
        continue;
      }

      if (run.providerId?.trim() || run.providerLabel?.trim()) {
        continue;
      }

      updateMessage.run({
        id: row.id,
        metadataJson: serializeMessageMetadata({
          ...metadata,
          run: {
            ...run,
            providerId: normalizedProviderId,
            providerLabel: normalizedProviderLabel,
          },
        }),
      });
      updatedCount += 1;
    }

    if (updatedCount > 0) {
      refreshAllProviderDailyUsageTotals(db);
    }

    return updatedCount;
  });

  return backfill();
}

export function renameSession(sessionId: number, nextName: string) {
  const db = getDb();
  const trimmedName = nextName.trim();

  if (!trimmedName) {
    throw new Error("会话名称不能为空。");
  }

  const rename = db.transaction(() => {
    const session = db
      .prepare("SELECT id, session_name FROM sessions WHERE id = ?")
      .get(sessionId) as SessionRenameRow | undefined;

    if (!session) {
      throw new Error("会话不存在。");
    }

    if (session.session_name === trimmedName) {
      return {
        id: session.id,
        name: session.session_name,
      };
    }

    db.prepare(
      `UPDATE sessions
      SET session_name = @name
      WHERE id = @sessionId`,
    ).run({
      sessionId,
      name: trimmedName,
    });

    return {
      id: session.id,
      name: trimmedName,
    };
  });

  return rename();
}

export function appendMessageToSession({
  sessionId,
  role,
  content,
  metadata,
  model,
  reasoningEffort,
  runDurationMs,
  setActive = true,
  markUnread = false,
}: {
  sessionId: number;
  role: WorkspaceRole;
  content: string;
  metadata?: WorkspaceMessageMetadata | null;
  model?: string | null;
  reasoningEffort?: string | null;
  runDurationMs?: number | null;
  setActive?: boolean;
  markUnread?: boolean;
}) {
  const db = getDb();
  const trimmedContent = content.trim();

  if (!trimmedContent) {
    throw new Error("消息内容不能为空。");
  }

  const writeMessage = db.transaction(() => {
    const hasRelativeLabel = hasColumn(db, "sessions", "relative_label");

    if (setActive) {
      setActiveSession(sessionId);
    }

    const nextSortOrderRow = db
      .prepare(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order FROM messages WHERE session_id = ?",
      )
      .get(sessionId) as { next_sort_order: number };

    const createdAt = new Date().toISOString();
    const messageRunFields = buildMessageRunFields({
      model,
      reasoningEffort,
      runDurationMs,
      metadata,
    });
    const insertResult = db
      .prepare(
        `INSERT INTO messages (
          session_id,
          role,
          content,
          created_at,
          model,
          reasoning_effort,
          run_duration_ms,
          metadata_json,
          sort_order
        ) VALUES (
          @sessionId,
          @role,
          @content,
          @createdAt,
          @model,
          @reasoningEffort,
          @runDurationMs,
          @metadataJson,
          @sortOrder
        )`,
      )
      .run({
        sessionId,
        role,
        content: trimmedContent,
        createdAt,
        model: messageRunFields.model,
        reasoningEffort: messageRunFields.reasoningEffort,
        runDurationMs: messageRunFields.runDurationMs,
        metadataJson: serializeMessageMetadata(metadata),
        sortOrder: nextSortOrderRow.next_sort_order,
      });

    const currentSessionState = db
      .prepare(
        `SELECT
          project_id,
          duration_minutes,
          is_active
        FROM sessions
        WHERE id = ?`,
      )
      .get(sessionId) as SessionRuntimeRow | undefined;
    const durationMs = calculateSessionRunDurationMs(
      db,
      sessionId,
      currentSessionState?.duration_minutes ?? 0,
    );
    const durationMinutes = convertSessionDurationMsToMinutes(durationMs);
    const hasUnread = markUnread && currentSessionState?.is_active !== 1 ? 1 : 0;

    const updateSession = hasRelativeLabel
      ? db.prepare(
          `UPDATE sessions
          SET preview = @preview,
              status = @status,
              has_unread = @hasUnread,
              duration_minutes = @durationMinutes,
              relative_label = @relativeLabel
          WHERE id = @sessionId`,
        )
      : db.prepare(
          `UPDATE sessions
          SET preview = @preview,
              status = @status,
              has_unread = @hasUnread,
              duration_minutes = @durationMinutes
          WHERE id = @sessionId`,
        );

    updateSession.run({
      sessionId,
      preview: buildSessionPreview(trimmedContent),
      status: SESSION_STATUS_IN_PROGRESS,
      hasUnread,
      durationMinutes,
      relativeLabel: formatLegacyRelativeLabel(durationMinutes),
    });

    refreshSessionUsageTotals(db, sessionId);

    if (extractMessageUsageTotals(metadata)) {
      refreshAllProviderDailyUsageTotals(db);
    }

    if (currentSessionState) {
      refreshProjectSessionCounts(db, currentSessionState.project_id);
    }

    return {
      id: Number(insertResult.lastInsertRowid),
      role,
      content: trimmedContent,
      createdAt,
      model: messageRunFields.model,
      reasoningEffort: messageRunFields.reasoningEffort,
      runDurationMs: messageRunFields.runDurationMs,
      metadata: metadata ?? null,
    } satisfies WorkspaceMessage;
  });

  return writeMessage();
}

export function updateSessionStatus(sessionId: number, status: string) {
  const db = getDb();
  const trimmedStatus = status.trim();

  if (!trimmedStatus) {
    throw new Error("会话状态不能为空。");
  }

  const update = db.transaction(() => {
    const session = db
      .prepare("SELECT project_id FROM sessions WHERE id = ?")
      .get(sessionId) as { project_id: number } | undefined;

    if (!session) {
      throw new Error("会话不存在。");
    }

    db.prepare("UPDATE sessions SET status = @status WHERE id = @sessionId").run({
      sessionId,
      status: trimmedStatus,
    });

    refreshProjectSessionCounts(db, session.project_id);
  });

  update();
}

export function setSessionArchived(sessionId: number, isArchived: boolean) {
  const db = getDb();
  const nextArchivedValue = isArchived ? 1 : 0;

  const updateArchiveState = db.transaction(() => {
    const session = db
      .prepare(
        `SELECT
          id,
          project_id,
          is_active,
          is_archived
        FROM sessions
        WHERE id = ?`,
      )
      .get(sessionId) as SessionArchiveStateRow | undefined;

    if (!session) {
      throw new Error("会话不存在。");
    }

    if (session.is_archived === nextArchivedValue) {
      return {
        sessionId,
        isArchived,
      };
    }

    db.prepare(
      `UPDATE sessions
      SET is_archived = @isArchived
      WHERE id = @sessionId`,
    ).run({
      sessionId,
      isArchived: nextArchivedValue,
    });

    if (session.is_active === 1 && nextArchivedValue === 1) {
      const fallbackSession = db
        .prepare(
          `SELECT id
          FROM sessions
          WHERE id != @sessionId
            AND is_archived = 0
          ORDER BY datetime(created_at) DESC, id DESC
          LIMIT 1`,
        )
        .get({
          sessionId,
        }) as SessionIdentityRow | undefined;

      if (fallbackSession) {
        db.prepare(
          `UPDATE sessions
          SET is_active = CASE WHEN id = @sessionId THEN 1 ELSE 0 END`,
        ).run({
          sessionId: fallbackSession.id,
        });
      } else {
        db.prepare(
          `UPDATE sessions
          SET is_active = 0
          WHERE id = @sessionId`,
        ).run({
          sessionId,
        });
      }
    }

    if (nextArchivedValue === 0) {
      const activeSession = db
        .prepare("SELECT id FROM sessions WHERE is_active = 1 LIMIT 1")
        .get() as SessionIdentityRow | undefined;

      if (!activeSession) {
        db.prepare(
          `UPDATE sessions
          SET is_active = CASE WHEN id = @sessionId THEN 1 ELSE 0 END`,
        ).run({
          sessionId,
        });
      }
    }

    refreshProjectSessionCounts(db, session.project_id);

    return {
      sessionId,
      isArchived,
    };
  });

  return updateArchiveState();
}

export function removeSession(sessionId: number) {
  const db = getDb();

  const remove = db.transaction(() => {
    const session = db
      .prepare(
        `SELECT
          id,
          project_id,
          is_active,
          is_archived
        FROM sessions
        WHERE id = ?`,
      )
      .get(sessionId) as SessionArchiveStateRow | undefined;

    if (!session) {
      throw new Error("会话不存在。");
    }

    db.prepare("DELETE FROM messages WHERE session_id = ?").run(sessionId);
    db.prepare("DELETE FROM session_prompt_queue WHERE session_id = ?").run(
      sessionId,
    );
    db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    refreshAllProviderDailyUsageTotals(db);
    refreshProjectSessionCounts(db, session.project_id);

    const activeSession = db
      .prepare("SELECT id FROM sessions WHERE is_active = 1 ORDER BY id ASC LIMIT 1")
      .get() as SessionIdentityRow | undefined;

    if (session.is_active === 1 || !activeSession) {
      const fallbackSession = db
        .prepare(
          `SELECT id
          FROM sessions
          ORDER BY is_archived ASC, datetime(created_at) DESC, id DESC
          LIMIT 1`,
        )
        .get() as SessionIdentityRow | undefined;

      if (fallbackSession) {
        db.prepare(
          `UPDATE sessions
          SET is_active = CASE WHEN id = @sessionId THEN 1 ELSE 0 END`,
        ).run({
          sessionId: fallbackSession.id,
        });
      }
    }

    return {
      sessionId,
      projectId: session.project_id,
      isArchived: session.is_archived === 1,
    };
  });

  return remove();
}

export function markSessionAsRead(sessionId: number) {
  const db = getDb();
  const result = db
    .prepare("UPDATE sessions SET has_unread = 0 WHERE id = ?")
    .run(sessionId);

  if (result.changes === 0) {
    throw new Error("会话不存在。");
  }
}

export function saveStoredWorkspaceSettings(
  settings: Partial<
    Pick<
      WorkspaceSettings,
      | "websocketUrl"
      | "token"
      | "codexProviders"
      | "selectedCodexProviderId"
      | "defaultCodexProviderId"
      | "codexProviderConcurrentSessionLimit"
      | "codexModel"
      | "codexReasoningEffort"
      | "claudeProviders"
      | "selectedClaudeProviderId"
      | "defaultClaudeProviderId"
      | "claudeProviderConcurrentSessionLimit"
      | "claudeModel"
      | "claudeReasoningEffort"
    >
  >,
): WorkspaceSettings {
  const db = getDb();
  const currentSettings = getStoredWorkspaceSettings();
  const codexProviders = normalizeWorkspaceCodexProviders(
    settings.codexProviders ?? currentSettings.codexProviders,
  );
  const codexProviderIds = resolveWorkspaceCodexProviderIds({
    providers: codexProviders,
    selectedCodexProviderId:
      settings.selectedCodexProviderId ?? currentSettings.selectedCodexProviderId,
    defaultCodexProviderId:
      settings.defaultCodexProviderId ?? currentSettings.defaultCodexProviderId,
  });
  const claudeProviders = normalizeWorkspaceClaudeProviders(
    settings.claudeProviders ?? currentSettings.claudeProviders,
  );
  const claudeProviderIds = resolveWorkspaceClaudeProviderIds({
    providers: claudeProviders,
    selectedClaudeProviderId:
      settings.selectedClaudeProviderId ??
      currentSettings.selectedClaudeProviderId,
    defaultClaudeProviderId:
      settings.defaultClaudeProviderId ?? currentSettings.defaultClaudeProviderId,
  });
  const nextSettings = {
    websocketUrl: settings.websocketUrl ?? currentSettings.websocketUrl,
    token: settings.token ?? currentSettings.token,
    codexProviders,
    selectedCodexProviderId: codexProviderIds.selectedCodexProviderId,
    defaultCodexProviderId: codexProviderIds.defaultCodexProviderId,
    codexProviderConcurrentSessionLimit:
      normalizeWorkspaceProviderConcurrentSessionLimit(
        settings.codexProviderConcurrentSessionLimit ??
          currentSettings.codexProviderConcurrentSessionLimit,
      ),
    codexModel: normalizeWorkspaceModel(
      settings.codexModel ?? currentSettings.codexModel,
    ),
    codexReasoningEffort: normalizeReasoningEffort(
      settings.codexReasoningEffort ?? currentSettings.codexReasoningEffort,
    ),
    claudeProviders,
    selectedClaudeProviderId: claudeProviderIds.selectedClaudeProviderId,
    defaultClaudeProviderId: claudeProviderIds.defaultClaudeProviderId,
    claudeProviderConcurrentSessionLimit:
      normalizeWorkspaceProviderConcurrentSessionLimit(
        settings.claudeProviderConcurrentSessionLimit ??
          currentSettings.claudeProviderConcurrentSessionLimit,
      ),
    claudeModel: normalizeClaudeModel(
      settings.claudeModel ?? currentSettings.claudeModel,
    ),
    claudeReasoningEffort: normalizeClaudeReasoningEffort(
      settings.claudeReasoningEffort ?? currentSettings.claudeReasoningEffort,
    ),
  };
  const selectedProvider =
    getWorkspaceCodexProviderById(
      nextSettings.codexProviders,
      nextSettings.selectedCodexProviderId,
    ) ??
    getWorkspaceCodexProviderById(
      nextSettings.codexProviders,
      nextSettings.defaultCodexProviderId,
    );
  const legacyBaseUrl = selectedProvider?.base_url.trim() ?? "";

  db.prepare(
    `INSERT INTO runtime_settings (
      id,
      websocket_url,
      token,
      base_url,
      codex_agents_json,
      selected_codex_agent_id,
      default_codex_agent_id,
      codex_provider_concurrent_session_limit,
      codex_model,
      codex_reasoning_effort,
      claude_providers_json,
      selected_claude_provider_id,
      default_claude_provider_id,
      claude_provider_concurrent_session_limit,
      claude_model,
      claude_reasoning_effort,
      updated_at
    ) VALUES (
      1,
      @websocketUrl,
      @token,
      @baseUrl,
      @codexAgentsJson,
      @selectedCodexAgentId,
      @defaultCodexAgentId,
      @codexProviderConcurrentSessionLimit,
      @codexModel,
      @codexReasoningEffort,
      @claudeProvidersJson,
      @selectedClaudeProviderId,
      @defaultClaudeProviderId,
      @claudeProviderConcurrentSessionLimit,
      @claudeModel,
      @claudeReasoningEffort,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(id) DO UPDATE SET
      websocket_url = excluded.websocket_url,
      token = excluded.token,
      base_url = excluded.base_url,
      codex_agents_json = excluded.codex_agents_json,
      selected_codex_agent_id = excluded.selected_codex_agent_id,
      default_codex_agent_id = excluded.default_codex_agent_id,
      codex_provider_concurrent_session_limit = excluded.codex_provider_concurrent_session_limit,
      codex_model = excluded.codex_model,
      codex_reasoning_effort = excluded.codex_reasoning_effort,
      claude_providers_json = excluded.claude_providers_json,
      selected_claude_provider_id = excluded.selected_claude_provider_id,
      default_claude_provider_id = excluded.default_claude_provider_id,
      claude_provider_concurrent_session_limit = excluded.claude_provider_concurrent_session_limit,
      claude_model = excluded.claude_model,
      claude_reasoning_effort = excluded.claude_reasoning_effort,
      updated_at = CURRENT_TIMESTAMP`,
  ).run({
    ...nextSettings,
    baseUrl: legacyBaseUrl,
    codexAgentsJson: JSON.stringify(nextSettings.codexProviders),
    selectedCodexAgentId: nextSettings.selectedCodexProviderId,
    defaultCodexAgentId: nextSettings.defaultCodexProviderId,
    claudeProvidersJson: JSON.stringify(nextSettings.claudeProviders),
  });

  return getStoredWorkspaceSettings();
}

export function hasAuthUsers() {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS user_count
      FROM auth_users`,
    )
    .get() as
    | {
        user_count: number | null;
      }
    | undefined;

  return Number(row?.user_count ?? 0) > 0;
}

export function getAuthJwtSecret() {
  const db = getDb();
  const existingRow = db
    .prepare(
      `SELECT jwt_secret
      FROM auth_config
      WHERE id = 1`,
    )
    .get() as AuthConfigRow | undefined;
  const existingSecret = existingRow?.jwt_secret.trim() ?? "";

  if (existingSecret) {
    return existingSecret;
  }

  const nextSecret = generateAuthJwtSecret();

  db.prepare(
    `INSERT INTO auth_config (
      id,
      jwt_secret,
      updated_at
    ) VALUES (
      1,
      @jwtSecret,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT(id) DO UPDATE SET
      jwt_secret = excluded.jwt_secret,
      updated_at = CURRENT_TIMESTAMP`,
  ).run({
    jwtSecret: nextSecret,
  });

  return nextSecret;
}

export function getAuthUserById(userId: number) {
  if (!Number.isInteger(userId) || userId <= 0) {
    return null;
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        id,
        username,
        password_hash,
        password_salt,
        created_at,
        updated_at
      FROM auth_users
      WHERE id = ?`,
    )
    .get(userId) as AuthUserRow | undefined;

  if (!row) {
    return null;
  }

  return mapAuthUserRow(row);
}

export function getAuthUserCredentialsByUsername(username: string) {
  const normalizedUsername = username.trim();

  if (!normalizedUsername) {
    return null;
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT
        id,
        username,
        password_hash,
        password_salt,
        created_at,
        updated_at
      FROM auth_users
      WHERE username = ?`,
    )
    .get(normalizedUsername) as AuthUserRow | undefined;

  if (!row) {
    return null;
  }

  return mapAuthUserRowToCredentials(row);
}

export function createAuthUser({
  username,
  passwordHash,
  passwordSalt,
}: {
  username: string;
  passwordHash: string;
  passwordSalt: string;
}) {
  const normalizedUsername = username.trim();

  if (!normalizedUsername) {
    throw new Error("用户名不能为空。");
  }

  const db = getDb();
  const timestamp = getCurrentTimestamp();

  try {
    const result = db
      .prepare(
        `INSERT INTO auth_users (
          username,
          password_hash,
          password_salt,
          created_at,
          updated_at
        ) VALUES (
          @username,
          @passwordHash,
          @passwordSalt,
          @createdAt,
          @updatedAt
        )`,
      )
      .run({
        username: normalizedUsername,
        passwordHash,
        passwordSalt,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

    return getAuthUserById(Number(result.lastInsertRowid));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("UNIQUE constraint failed: auth_users.username")
    ) {
      throw new Error("用户名已存在。");
    }

    throw error;
  }
}

export function getWorkspacePayload(): WorkspacePayload {
  const db = getDb();

  const projectRows = db
    .prepare(
      `SELECT
        id,
        name,
        server,
        project_path,
        created_at,
        valid_session_count,
        active_session_count,
        archived_session_count,
        sort_order
      FROM projects
      ORDER BY datetime(created_at) DESC, id DESC`,
    )
    .all() as ProjectRow[];
  const sessionRows = db
    .prepare(
      `SELECT
        id,
        project_id,
        server,
        session_name,
        preview,
        model,
        reasoning_effort,
        codex_thread_id,
        codex_provider_id,
        claude_thread_id,
        claude_provider_id,
        duration_minutes,
        status,
        has_unread,
        is_archived,
        is_active,
        created_at,
        total_input_tokens,
        total_cached_input_tokens,
        total_output_tokens,
        sort_order
      FROM sessions
      ORDER BY project_id ASC, is_archived ASC, datetime(created_at) DESC, id DESC`,
    )
    .all() as SessionRow[];
  const queuedPromptRows = db
    .prepare(
      `SELECT
        id,
        session_id,
        content,
        created_at,
        model,
        reasoning_effort,
        sort_order
      FROM session_prompt_queue
      ORDER BY session_id ASC, sort_order ASC, id ASC`,
    )
    .all() as SessionPromptQueueRow[];
  const messageRows = db
    .prepare(
      `SELECT
        id,
        session_id,
        role,
        content,
        created_at,
        model,
        reasoning_effort,
        run_duration_ms,
        metadata_json,
        sort_order
      FROM messages
      ORDER BY session_id ASC, sort_order ASC, id ASC`,
    )
    .all() as MessageRow[];

  const messagesBySessionId = new Map<number, WorkspaceMessage[]>();
  const queuedPromptRowsBySessionId = new Map<number, SessionPromptQueueRow[]>();
  const sessionDurationMsBySessionId = new Map<number, number>();

  for (const message of messageRows) {
    const sessionMessages = messagesBySessionId.get(message.session_id) ?? [];
    sessionMessages.push(mapMessageRowToWorkspaceMessage(message));
    messagesBySessionId.set(message.session_id, sessionMessages);

    const messageDurationMs = normalizeRunDurationMs(message.run_duration_ms) ?? 0;
    sessionDurationMsBySessionId.set(
      message.session_id,
      (sessionDurationMsBySessionId.get(message.session_id) ?? 0) +
        messageDurationMs,
    );
  }

  for (const queuedPrompt of queuedPromptRows) {
    const sessionQueuedPromptRows =
      queuedPromptRowsBySessionId.get(queuedPrompt.session_id) ?? [];
    sessionQueuedPromptRows.push(queuedPrompt);
    queuedPromptRowsBySessionId.set(
      queuedPrompt.session_id,
      sessionQueuedPromptRows,
    );
  }

  const sessionsByProjectId = new Map<number, WorkspacePayload["projects"][number]["sessions"]>();
  const projectServerByProjectId = new Map(
    projectRows.map((project) => [
      project.id,
      normalizeWorkspaceProjectServer(project.server),
    ]),
  );

  for (const session of sessionRows) {
    const projectSessions = sessionsByProjectId.get(session.project_id) ?? [];
    const projectServer =
      projectServerByProjectId.get(session.project_id) ??
      DEFAULT_WORKSPACE_PROJECT_SERVER;
    const sessionServer = resolveSessionServer(session.server, projectServer);
    const aggregatedDurationMs = sessionDurationMsBySessionId.get(session.id);
    const durationMs =
      typeof aggregatedDurationMs === "number" && aggregatedDurationMs > 0
        ? aggregatedDurationMs
        : Math.max(session.duration_minutes, 0) * 60000;
    const queuedPrompts = (
      queuedPromptRowsBySessionId.get(session.id) ?? []
    ).map((queuedPrompt) =>
      mapSessionPromptQueueRowToWorkspaceQueuedPrompt(queuedPrompt, {
        sessionServer,
      }),
    );

    projectSessions.push(
      mapSessionRowToWorkspaceSession(session, {
        durationMs,
        sessionServer,
        queuedPrompts,
        messages: messagesBySessionId.get(session.id) ?? [],
      }),
    );
    sessionsByProjectId.set(session.project_id, projectSessions);
  }

  const projects = projectRows.map((project) => ({
    id: project.id,
    name: project.name,
    server: normalizeWorkspaceProjectServer(project.server),
    path: project.project_path,
    createdAt: resolveCreatedAt(project.created_at),
    validSessionCount: project.valid_session_count,
    activeSessionCount: project.active_session_count,
    archivedSessionCount: project.archived_session_count,
    sessions: sessionsByProjectId.get(project.id) ?? [],
  }));

  const activeSession = sessionRows.find((session) => session.is_active === 1);
  const visibleFallbackSession =
    projects
      .flatMap((project) => project.sessions)
      .find((session) => !session.isArchived) ?? null;
  const fallbackSession = projects.flatMap((project) => project.sessions)[0] ?? null;

  return normalizeWorkspacePayload({
    projects,
    selectedSessionId:
      activeSession?.id ??
      visibleFallbackSession?.id ??
      fallbackSession?.id ??
      null,
  });
}
