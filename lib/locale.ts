export type AppLocale = "zh-CN" | "en-US";

export const DEFAULT_APP_LOCALE: AppLocale = "zh-CN";
export const APP_LOCALE_COOKIE_NAME = "playcode-locale";
export const APP_LOCALE_STORAGE_KEY = "playcode-locale";

const localeAliases = new Map<string, AppLocale>([
  ["zh", "zh-CN"],
  ["zh-cn", "zh-CN"],
  ["en", "en-US"],
  ["en-us", "en-US"],
]);

const exactErrorTranslations = new Map<string, string>([
  ["无法读取设置。", "Failed to load settings."],
  ["无法保存配置。", "Unable to save the configuration."],
  ["保存配置失败。", "Failed to save the configuration."],
  ["读取目录内容失败，请重试。", "Failed to read the directory contents. Please try again."],
  ["读取目录失败，请重试。", "Failed to read the directory. Please try again."],
  ["读取文件失败，请重试。", "Failed to read the file. Please try again."],
  ["读取文件变更失败。", "Failed to read file changes."],
  ["撤销文件变更失败。", "Failed to undo file changes."],
  ["读取 Git 信息失败。", "Failed to load Git information."],
  ["读取项目代码失败，请重试。", "Failed to load the project code. Please try again."],
  ["保存文件失败，请重试。", "Failed to save the file. Please try again."],
  ["保存会话配置失败。", "Failed to save the session configuration."],
  ["保存会话配置失败，请重试。", "Failed to save the session configuration. Please try again."],
  ["新增项目失败。", "Failed to add the project."],
  ["新增项目失败，请重试。", "Failed to add the project. Please try again."],
  ["更新项目名称失败。", "Failed to update the project name."],
  ["更新项目名称失败，请重试。", "Failed to update the project name. Please try again."],
  ["更新项目 server 失败。", "Failed to update the project server."],
  ["更新项目 server 失败，请重试。", "Failed to update the project server. Please try again."],
  ["移除项目失败。", "Failed to remove the project."],
  ["归档会话失败。", "Failed to archive the session."],
  ["归档会话失败，请重试。", "Failed to archive the session. Please try again."],
  ["删除会话失败。", "Failed to delete the session."],
  ["删除会话失败，请重试。", "Failed to delete the session. Please try again."],
  ["切换会话失败，请重试。", "Failed to switch sessions. Please try again."],
  ["加载更多会话失败。", "Failed to load more sessions."],
  ["移除排队项失败。", "Failed to remove the queued item."],
  ["移除排队项失败，请重试。", "Failed to remove the queued item. Please try again."],
  ["消息发送失败。", "Failed to send the message."],
  ["消息发送失败，请稍后重试。", "Failed to send the message. Please try again later."],
  ["停止当前运行失败。", "Failed to stop the current run."],
  ["退出登录失败，请稍后重试。", "Failed to log out. Please try again later."],
  ["登录失败，请稍后重试。", "Login failed. Please try again later."],
  ["两次输入的密码不一致。", "The two passwords do not match."],
  ["初始化管理员账号失败。", "Failed to initialize the admin account."],
  ["请输入用户名。", "Please enter a username."],
  ["请输入密码。", "Please enter a password."],
  ["请输入 api_key。", "Please enter an api_key."],
  ["请输入 Provider 名称。", "Please enter a provider name."],
  ["请输入有效的 WebSocket 地址。", "Please enter a valid WebSocket URL."],
  ["WebSocket 地址需要以 ws:// 或 wss:// 开头。", "The WebSocket URL must start with ws:// or wss://."],
  ["至少需要配置一个 Provider。", "At least one provider must be configured."],
  ["当前还没有管理员账号，请先完成初始化。", "No admin account exists yet. Complete the initial setup first."],
  ["用户名或密码错误。", "Incorrect username or password."],
  ["登录已失效，请重新登录。", "Your login has expired. Please log in again."],
  ["会话不存在。", "The session does not exist."],
  ["项目不存在。", "The project does not exist."],
  ["项目名称不能为空。", "The project name cannot be empty."],
  ["会话名称不能为空。", "The session name cannot be empty."],
  ["请选择要添加的本地目录。", "Please choose a local directory to add."],
  ["当前消息没有关联项目，暂时无法读取 diff。", "The current message is not linked to a project, so the diff cannot be loaded yet."],
  ["当前消息没有关联项目，无法撤销", "The current message is not linked to a project, so undo is unavailable."],
  ["当前没有可展示的 diff。", "There is no diff to display right now."],
  ["当前没有可展示的 Git diff。", "There is no Git diff to display right now."],
  ["当前没有可展示的工作区数据。", "There is no workspace data to display right now."],
  ["当前会话没有正在执行的任务。", "There is no running task in the current session."],
  ["已从会话队列中移除。", "Removed from the session queue."],
  ["已加入待执行队列，当前没有可用的 provider。", "Added to the pending queue because no provider is currently available."],
  ["本地实时通道未连接，暂时无法发送。", "The local realtime channel is not connected, so messages cannot be sent yet."],
  ["本地实时通道连接失败。", "The local realtime channel failed to connect."],
  ["无法建立本地实时通道。", "Unable to establish the local realtime channel."],
  ["当前环境不支持读取本地实时流。", "The current environment does not support reading the local realtime stream."],
  ["无法读取工作区数据。", "Failed to load workspace data."],
  ["队列项不存在。", "The queue item does not exist."],
  ["当前设置分区暂不支持保存。", "Saving this settings section is not supported yet."],
  ["消息内容不能为空。", "The message content cannot be empty."],
]);

const regexErrorTranslations: Array<{
  pattern: RegExp;
  resolve: (match: RegExpExecArray) => string;
}> = [
  {
    pattern: /^Provider「(.+)」配置有误：(.+)$/u,
    resolve: (match) =>
      `Provider "${match[1]}" is invalid: ${translateErrorMessage(match[2], "en-US")}`,
  },
  {
    pattern: /^Provider「(.+)」缺少 api_key，请先在(.+)中补全后再运行(.+)。$/u,
    resolve: (match) =>
      `Provider "${match[1]}" is missing an api_key. Complete it in ${translateErrorMessage(match[2], "en-US")} before running ${match[3]}.`,
  },
  {
    pattern: /^Provider「(.+)」最多只能同时执行 (\d+) 个会话，请稍后再试。$/u,
    resolve: (match) =>
      `Provider "${match[1]}" can run at most ${match[2]} sessions at the same time. Please try again later.`,
  },
  {
    pattern: /^项目已存在：(.+)$/u,
    resolve: (match) => `The project already exists: ${match[1]}`,
  },
  {
    pattern: /^当前项目目录不存在：(.+)$/u,
    resolve: (match) => `The current project directory does not exist: ${match[1]}`,
  },
  {
    pattern: /^Codex 请求失败：(.+)$/u,
    resolve: (match) => `Codex request failed: ${translateErrorMessage(match[1], "en-US")}`,
  },
  {
    pattern: /^Claude 请求失败：(.+)$/u,
    resolve: (match) => `Claude request failed: ${translateErrorMessage(match[1], "en-US")}`,
  },
];

export function normalizeAppLocale(value?: string | null): AppLocale {
  const normalizedValue = value?.trim().toLowerCase() ?? "";

  if (!normalizedValue) {
    return DEFAULT_APP_LOCALE;
  }

  return localeAliases.get(normalizedValue) ?? DEFAULT_APP_LOCALE;
}

export function translateByLocale(
  locale: AppLocale,
  zhText: string,
  enText: string,
) {
  return locale === "en-US" ? enText : zhText;
}

export function getLocaleToggleLabel(locale: AppLocale) {
  return locale === "en-US" ? "English" : "中文";
}

export function getLocaleDisplayCode(locale: AppLocale) {
  return locale === "en-US" ? "EN" : "中";
}

export function translateReasoningLabel(label: string, locale: AppLocale) {
  switch (label.trim()) {
    case "低":
      return translateByLocale(locale, "低", "Low");
    case "中":
      return translateByLocale(locale, "中", "Medium");
    case "高":
      return translateByLocale(locale, "高", "High");
    case "超高":
      return translateByLocale(locale, "超高", "Very High");
    case "最高":
      return translateByLocale(locale, "最高", "Max");
    default:
      return label;
  }
}

export function translateConnectionPhaseLabel(
  phase: string,
  locale: AppLocale,
) {
  switch (phase.trim()) {
    case "连接中":
      return translateByLocale(locale, "连接中", "Connecting");
    case "认证中":
      return translateByLocale(locale, "认证中", "Authenticating");
    case "已连接":
      return translateByLocale(locale, "已连接", "Connected");
    case "异常":
      return translateByLocale(locale, "异常", "Error");
    case "未连接":
      return translateByLocale(locale, "未连接", "Disconnected");
    default:
      return phase;
  }
}

export function translateSessionStatus(status: string, locale: AppLocale) {
  switch (status.trim()) {
    case "未开始":
      return translateByLocale(locale, "未开始", "Not Started");
    case "待执行":
      return translateByLocale(locale, "待执行", "Queued");
    case "进行中":
      return translateByLocale(locale, "进行中", "In Progress");
    case "已完成":
      return translateByLocale(locale, "已完成", "Completed");
    case "已暂停":
      return translateByLocale(locale, "已暂停", "Paused");
    case "失败":
      return translateByLocale(locale, "失败", "Failed");
    case "已归档":
      return translateByLocale(locale, "已归档", "Archived");
    case "状态未知":
      return translateByLocale(locale, "状态未知", "Unknown Status");
    default:
      return status;
  }
}

export function translateErrorMessage(
  message: string,
  locale: AppLocale,
): string {
  if (locale !== "en-US") {
    return message;
  }

  const trimmedMessage = message.trim();
  const exactMatch = exactErrorTranslations.get(trimmedMessage);

  if (exactMatch) {
    return exactMatch;
  }

  for (const candidate of regexErrorTranslations) {
    const match = candidate.pattern.exec(trimmedMessage);

    if (match) {
      return candidate.resolve(match);
    }
  }

  return message;
}
