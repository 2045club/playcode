"use client";

import { type DragEvent, type ReactNode, useState } from "react";
import {
  ChevronDown,
  Eye,
  EyeOff,
  GripVertical,
  LogOut,
  Plus,
  X,
} from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  CLAUDE_MODEL_OPTIONS,
  CLAUDE_REASONING_OPTIONS,
  type ConnectionPhase,
  getClaudeProviderDraftError,
  getCodexProviderDraftError,
  normalizeWorkspaceProviderConcurrentSessionLimit,
  type WorkspaceProvider,
  type WorkspaceSettings,
  type WorkspaceSettingsSection,
} from "@/lib/settings";
import { cn } from "@/lib/utils";
import {
  WORKSPACE_MODEL_OPTIONS,
  WORKSPACE_REASONING_OPTIONS,
} from "@/lib/workspace";

type EditableWorkspaceSettingField =
  | "websocketUrl"
  | "token"
  | "codexProviderConcurrentSessionLimit"
  | "codexModel"
  | "codexReasoningEffort"
  | "claudeProviderConcurrentSessionLimit"
  | "claudeModel"
  | "claudeReasoningEffort";

type EditableWorkspaceProviderField =
  | "title"
  | "base_url"
  | "api_key"
  | "enabled";

type ProviderMovePosition = "before" | "after";
type ProviderSection = "codex" | "claude";

const settingsSections: WorkspaceSettingsSection[] = ["codex", "claude"];

export function WorkspaceSettingsModal({
  isOpen,
  settings,
  websocketError,
  codexSettingsError,
  claudeSettingsError,
  editingCodexProviderIds,
  editingClaudeProviderIds,
  hasPendingCodexProviderEdit,
  hasPendingClaudeProviderEdit,
  connectionPhase,
  connectionError,
  onAddClaudeProvider,
  onAddCodexProvider,
  onCancelClaudeProviderEdit,
  onCancelCodexProviderEdit,
  onChange,
  onClaudeProviderChange,
  onClose,
  onCodexProviderChange,
  onFinishClaudeProviderEdit,
  onFinishCodexProviderEdit,
  onLogout,
  onMoveClaudeProvider,
  onMoveCodexProvider,
  onRemoveClaudeProvider,
  onRemoveCodexProvider,
  onStartClaudeProviderEdit,
  onStartCodexProviderEdit,
  isLoggingOut,
}: {
  isOpen: boolean;
  settings: WorkspaceSettings;
  websocketError: string | null;
  codexSettingsError: string | null;
  claudeSettingsError: string | null;
  editingCodexProviderIds: string[];
  editingClaudeProviderIds: string[];
  hasPendingCodexProviderEdit: boolean;
  hasPendingClaudeProviderEdit: boolean;
  connectionPhase: ConnectionPhase;
  connectionError: string | null;
  onAddClaudeProvider: () => void;
  onAddCodexProvider: () => void;
  onCancelClaudeProviderEdit: (providerId: string) => void;
  onCancelCodexProviderEdit: (providerId: string) => void;
  onChange: (
    field: EditableWorkspaceSettingField,
    value: string | number,
  ) => void;
  onClaudeProviderChange: (
    providerId: string,
    field: EditableWorkspaceProviderField,
    value: string | boolean,
  ) => void;
  onClose: () => void;
  onCodexProviderChange: (
    providerId: string,
    field: EditableWorkspaceProviderField,
    value: string | boolean,
  ) => void;
  onFinishClaudeProviderEdit: (providerId: string) => void;
  onFinishCodexProviderEdit: (providerId: string) => void;
  onLogout: () => void;
  onMoveClaudeProvider: (
    draggedProviderId: string,
    targetProviderId: string,
    position: ProviderMovePosition,
  ) => void;
  onMoveCodexProvider: (
    draggedProviderId: string,
    targetProviderId: string,
    position: ProviderMovePosition,
  ) => void;
  onRemoveClaudeProvider: (providerId: string) => void;
  onRemoveCodexProvider: (providerId: string) => void;
  onStartClaudeProviderEdit: (providerId: string) => void;
  onStartCodexProviderEdit: (providerId: string) => void;
  isLoggingOut: boolean;
}) {
  const {
    t,
    translateConnectionPhase,
    translateError,
    translateReasoning,
  } = useLocale();
  const [activeSection, setActiveSection] =
    useState<WorkspaceSettingsSection>("codex");
  const [draggingProviderId, setDraggingProviderId] = useState<string | null>(
    null,
  );
  const [dragTarget, setDragTarget] = useState<{
    providerId: string;
    position: ProviderMovePosition;
  } | null>(null);

  if (!isOpen) {
    return null;
  }

  function resetDragState() {
    setDraggingProviderId(null);
    setDragTarget(null);
  }

  function handleProviderDragStart(providerId: string, canReorderProviders: boolean) {
    if (!canReorderProviders) {
      return;
    }

    setDraggingProviderId(providerId);
    setDragTarget(null);
  }

  function handleProviderDragOver(
    event: DragEvent<HTMLDivElement>,
    providerId: string,
    canReorderProviders: boolean,
  ) {
    if (!canReorderProviders || !draggingProviderId) {
      return;
    }

    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const position =
      event.clientY - bounds.top > bounds.height / 2 ? "after" : "before";

    setDragTarget((currentDragTarget) =>
      currentDragTarget?.providerId === providerId &&
      currentDragTarget.position === position
        ? currentDragTarget
        : {
            providerId,
            position,
          },
    );
  }

  function handleProviderDrop(
    event: DragEvent<HTMLDivElement>,
    providerId: string,
    canReorderProviders: boolean,
    onMoveProvider: (
      draggedProviderId: string,
      targetProviderId: string,
      position: ProviderMovePosition,
    ) => void,
  ) {
    if (!canReorderProviders || !draggingProviderId) {
      resetDragState();
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();
    const nextPosition =
      event.clientY - bounds.top > bounds.height / 2 ? "after" : "before";

    onMoveProvider(draggingProviderId, providerId, nextPosition);
    resetDragState();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6">
      <button
        type="button"
        aria-label={t("关闭设置弹层", "Close settings modal")}
        className="absolute inset-0 cursor-pointer bg-black/18 backdrop-blur-sm"
        onClick={onClose}
      />

      <Card className="surface-shadow relative z-10 h-[min(88vh,860px)] w-full max-w-6xl overflow-hidden rounded-[28px] border-white/90 bg-[#f7f7f5]">
        <CardContent className="flex h-full min-h-0 p-0">
          <aside className="flex w-[200px] shrink-0 flex-col border-r border-black/6 bg-[#fbfbfa] p-3 sm:w-[220px] sm:p-4">
            <div className="space-y-1">
              {settingsSections.map((section) => {
                const isActive = activeSection === section;
                const label =
                  section === "codex"
                    ? t("Codex 设置", "Codex Settings")
                    : t("Claude 设置", "Claude Settings");

                return (
                  <button
                    key={section}
                    type="button"
                    role="tab"
                    id={`workspace-settings-tab-${section}`}
                    aria-selected={isActive}
                    aria-controls={`workspace-settings-panel-${section}`}
                    className={cn(
                      "flex w-full items-center rounded-xl px-3 py-2.5 text-left text-[15px] font-medium transition-colors",
                      isActive
                        ? "bg-black/5 text-foreground"
                        : "text-muted-foreground hover:bg-black/4 hover:text-foreground",
                    )}
                    onClick={() => setActiveSection(section)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="mt-auto space-y-3 px-3 pb-1 pt-4">
              <button
                type="button"
                onClick={onLogout}
                disabled={isLoggingOut}
                className="inline-flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left text-[14px] font-medium text-[#7a3b2b] transition-colors hover:bg-[#fff5f0] hover:text-[#5c2619] disabled:cursor-not-allowed disabled:opacity-70"
              >
                <LogOut className="size-[0.95rem] shrink-0 stroke-[1.8]" />
                <span>
                  {isLoggingOut
                    ? t("退出中...", "Signing out...")
                    : t("退出登录", "Sign Out")}
                </span>
              </button>
            </div>
          </aside>

          <section className="relative min-h-0 min-w-0 flex-1 bg-white">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-4 top-4 z-10 size-9 rounded-full text-muted-foreground hover:text-foreground"
              onClick={onClose}
            >
              <X className="size-5" />
            </Button>

            <div
              role="tabpanel"
              id={`workspace-settings-panel-${activeSection}`}
              aria-labelledby={`workspace-settings-tab-${activeSection}`}
              className="flex h-full min-h-0 flex-col"
            >
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-8 sm:px-8 sm:pb-8 sm:pt-8 md:px-10">
                {activeSection === "system" && (
                  <div className="space-y-8">
                    <SettingsPaneIntro
                      title={t("系统设置", "System Settings")}
                      description={t(
                        "管理系统连接所需的 WebSocket 地址、Token 以及当前连接状态。",
                        "Manage the WebSocket URL, token, and current connection state used by the system.",
                      )}
                    />

                    <div>
                      <SettingsRow
                        title={t("连接状态", "Connection Status")}
                        description={t(
                          "这里展示 Node.js 层当前的连接与认证状态。",
                          "This shows the current connection and authentication state of the Node.js layer.",
                        )}
                      >
                        <div className="rounded-2xl border border-black/8 bg-[#fafaf9] px-4 py-3 text-sm text-foreground">
                          <div>
                            {t("当前状态：", "Current status:")}
                            {translateConnectionPhase(
                              getConnectionPhaseLabel(connectionPhase),
                            )}
                          </div>
                          {connectionError && (
                            <p className="mt-2 text-xs text-destructive">
                              {translateError(connectionError)}
                            </p>
                          )}
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title={t("WebSocket 地址", "WebSocket URL")}
                        description={t(
                          "系统连接使用的 WebSocket 服务地址。",
                          "The WebSocket service URL used by the system connection.",
                        )}
                      >
                        <Input
                          value={settings.websocketUrl}
                          onChange={(event) =>
                            onChange("websocketUrl", event.target.value)
                          }
                          placeholder="wss://example.com/ws"
                          autoComplete="off"
                          className="h-11 rounded-xl border-black/10 bg-white text-foreground shadow-none"
                        />
                        {websocketError && (
                          <p className="text-xs text-destructive">
                            {translateError(websocketError)}
                          </p>
                        )}
                      </SettingsRow>

                      <SettingsRow
                        title="Token"
                        description={t(
                          "用于系统鉴权的访问令牌。",
                          "The access token used for system authentication.",
                        )}
                      >
                        <Input
                          type="password"
                          value={settings.token}
                          onChange={(event) =>
                            onChange("token", event.target.value)
                          }
                          placeholder={t("请输入连接 token", "Enter the connection token")}
                          autoComplete="off"
                          className="h-11 rounded-xl border-black/10 bg-white text-foreground shadow-none"
                        />
                      </SettingsRow>
                    </div>
                  </div>
                )}

                {activeSection === "codex" && (
                  <div className="space-y-8">
                    <SettingsPaneIntro
                      title={t("Codex 设置", "Codex Settings")}
                      description={t(
                        "管理 Codex Provider，以及新会话默认使用的模型和推理强度。",
                        "Manage Codex providers and the default model and reasoning level used for new sessions.",
                      )}
                    />

                    <div>
                      <SettingsRow
                        title={t("默认模型", "Default Model")}
                        description={t(
                          "新开会话时会默认读取这里配置的模型。",
                          "New sessions use the model configured here by default.",
                        )}
                      >
                        <div className="max-w-[220px] lg:ml-auto">
                          <SettingsSelect
                            value={settings.codexModel}
                            ariaLabel={t(
                              "选择 Codex 默认模型",
                              "Choose the default Codex model",
                            )}
                            className="min-w-0 w-full"
                            options={WORKSPACE_MODEL_OPTIONS.map((option) => ({
                              value: option.value,
                              label: option.label,
                            }))}
                            onChange={(value) => onChange("codexModel", value)}
                          />
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title={t("默认推理强度", "Default Reasoning Level")}
                        description={t(
                          "新开会话时会默认读取这里配置的推理强度。",
                          "New sessions use the reasoning level configured here by default.",
                        )}
                      >
                        <div className="max-w-[220px] lg:ml-auto">
                          <SettingsSelect
                            value={settings.codexReasoningEffort}
                            ariaLabel={t(
                              "选择 Codex 默认推理强度",
                              "Choose the default Codex reasoning level",
                            )}
                            className="min-w-0 w-full"
                            options={WORKSPACE_REASONING_OPTIONS.map((option) => ({
                              value: option.value,
                              label: translateReasoning(option.label),
                            }))}
                            onChange={(value) =>
                              onChange("codexReasoningEffort", value)
                            }
                          />
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title={t(
                          "单个 Provider 同时执行会话数量",
                          "Concurrent Sessions per Provider",
                        )}
                        description={t(
                          "限制同一个 Provider 同时运行的会话数，默认值为 5。不同 Provider 之间互不影响。",
                          "Limit how many sessions the same provider can run at once. The default is 5, and providers do not affect each other.",
                        )}
                      >
                        <div className="max-w-[220px] lg:ml-auto">
                          <ProviderConcurrentSessionLimitInput
                            key={settings.codexProviderConcurrentSessionLimit}
                            field="codexProviderConcurrentSessionLimit"
                            value={settings.codexProviderConcurrentSessionLimit}
                            onChange={onChange}
                          />
                        </div>
                      </SettingsRow>

                      <ProviderListSettingsRow
                        section="codex"
                        providers={settings.codexProviders}
                        settingsError={codexSettingsError}
                        editingProviderIds={editingCodexProviderIds}
                        hasPendingProviderEdit={hasPendingCodexProviderEdit}
                        draggingProviderId={draggingProviderId}
                        dragTarget={dragTarget}
                        onAddProvider={onAddCodexProvider}
                        onCancelProviderEdit={onCancelCodexProviderEdit}
                        onProviderChange={onCodexProviderChange}
                        onProviderDragOver={handleProviderDragOver}
                        onProviderDragStart={handleProviderDragStart}
                        onProviderDrop={handleProviderDrop}
                        onRemoveProvider={onRemoveCodexProvider}
                        onResetDragState={resetDragState}
                        onFinishProviderEdit={onFinishCodexProviderEdit}
                        onMoveProvider={onMoveCodexProvider}
                        onStartProviderEdit={onStartCodexProviderEdit}
                      />
                    </div>
                  </div>
                )}

                {activeSection === "claude" && (
                  <div className="space-y-8">
                    <SettingsPaneIntro
                      title={t("Claude 设置", "Claude Settings")}
                      description={t(
                        "管理 Claude Provider，以及新会话默认使用的模型和推理强度。列表交互、编辑流程和样式与 Codex Provider 配置保持一致。",
                        "Manage Claude providers and the default model and reasoning level used for new sessions. The list interaction, edit flow, and styling stay aligned with the Codex provider configuration.",
                      )}
                    />

                    <div>
                      <SettingsRow
                        title={t("默认模型", "Default Model")}
                        description={t(
                          "默认值已按你的截图预设为 Sonnet 4.6，也可以随时切换。",
                          "The default is preset to Sonnet 4.6 based on your screenshot, and you can switch it at any time.",
                        )}
                      >
                        <div className="max-w-[220px] lg:ml-auto">
                          <SettingsSelect
                            value={settings.claudeModel}
                            ariaLabel={t(
                              "选择 Claude 默认模型",
                              "Choose the default Claude model",
                            )}
                            className="min-w-0 w-full"
                            options={CLAUDE_MODEL_OPTIONS.map((option) => ({
                              value: option.value,
                              label: option.label,
                            }))}
                            onChange={(value) => onChange("claudeModel", value)}
                          />
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title={t("默认推理强度", "Default Reasoning Level")}
                        description={t(
                          "会写入 Claude Code SDK 的 reasoning effort 字段，取值为 low、medium、high、max。",
                          "This is written to the Claude Code SDK reasoning effort field with the values low, medium, high, and max.",
                        )}
                      >
                        <div className="max-w-[220px] lg:ml-auto">
                          <SettingsSelect
                            value={settings.claudeReasoningEffort}
                            ariaLabel={t(
                              "选择 Claude 默认推理强度",
                              "Choose the default Claude reasoning level",
                            )}
                            className="min-w-0 w-full"
                            options={CLAUDE_REASONING_OPTIONS.map((option) => ({
                              value: option.value,
                              label: translateReasoning(option.label),
                            }))}
                            onChange={(value) =>
                              onChange("claudeReasoningEffort", value)
                            }
                          />
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title={t(
                          "单个 Provider 同时执行会话数量",
                          "Concurrent Sessions per Provider",
                        )}
                        description={t(
                          "限制同一个 Claude Provider 同时运行的会话数，默认值为 5。不同 Provider 之间互不影响。",
                          "Limit how many sessions the same Claude provider can run at once. The default is 5, and providers do not affect each other.",
                        )}
                      >
                        <div className="max-w-[220px] lg:ml-auto">
                          <ProviderConcurrentSessionLimitInput
                            key={settings.claudeProviderConcurrentSessionLimit}
                            field="claudeProviderConcurrentSessionLimit"
                            value={settings.claudeProviderConcurrentSessionLimit}
                            onChange={onChange}
                          />
                        </div>
                      </SettingsRow>

                      <ProviderListSettingsRow
                        section="claude"
                        providers={settings.claudeProviders}
                        settingsError={claudeSettingsError}
                        editingProviderIds={editingClaudeProviderIds}
                        hasPendingProviderEdit={hasPendingClaudeProviderEdit}
                        draggingProviderId={draggingProviderId}
                        dragTarget={dragTarget}
                        onAddProvider={onAddClaudeProvider}
                        onCancelProviderEdit={onCancelClaudeProviderEdit}
                        onProviderChange={onClaudeProviderChange}
                        onProviderDragOver={handleProviderDragOver}
                        onProviderDragStart={handleProviderDragStart}
                        onProviderDrop={handleProviderDrop}
                        onRemoveProvider={onRemoveClaudeProvider}
                        onResetDragState={resetDragState}
                        onFinishProviderEdit={onFinishClaudeProviderEdit}
                        onMoveProvider={onMoveClaudeProvider}
                        onStartProviderEdit={onStartClaudeProviderEdit}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}

function ProviderListSettingsRow({
  section,
  providers,
  settingsError,
  editingProviderIds,
  hasPendingProviderEdit,
  draggingProviderId,
  dragTarget,
  onAddProvider,
  onCancelProviderEdit,
  onProviderChange,
  onProviderDragOver,
  onProviderDragStart,
  onProviderDrop,
  onRemoveProvider,
  onResetDragState,
  onFinishProviderEdit,
  onMoveProvider,
  onStartProviderEdit,
}: {
  section: ProviderSection;
  providers: WorkspaceProvider[];
  settingsError: string | null;
  editingProviderIds: string[];
  hasPendingProviderEdit: boolean;
  draggingProviderId: string | null;
  dragTarget: {
    providerId: string;
    position: ProviderMovePosition;
  } | null;
  onAddProvider: () => void;
  onCancelProviderEdit: (providerId: string) => void;
  onProviderChange: (
    providerId: string,
    field: EditableWorkspaceProviderField,
    value: string | boolean,
  ) => void;
  onProviderDragOver: (
    event: DragEvent<HTMLDivElement>,
    providerId: string,
    canReorderProviders: boolean,
  ) => void;
  onProviderDragStart: (providerId: string, canReorderProviders: boolean) => void;
  onProviderDrop: (
    event: DragEvent<HTMLDivElement>,
    providerId: string,
    canReorderProviders: boolean,
    onMoveProvider: (
      draggedProviderId: string,
      targetProviderId: string,
      position: ProviderMovePosition,
    ) => void,
  ) => void;
  onRemoveProvider: (providerId: string) => void;
  onResetDragState: () => void;
  onFinishProviderEdit: (providerId: string) => void;
  onMoveProvider: (
    draggedProviderId: string,
    targetProviderId: string,
    position: ProviderMovePosition,
  ) => void;
  onStartProviderEdit: (providerId: string) => void;
}) {
  const { t, translateError } = useLocale();
  const displayedProviders = getDisplayedProviders(providers);
  const prioritizedProviderId =
    displayedProviders.find((provider) => provider.enabled)?.id ?? null;
  const canReorderProviders =
    !hasPendingProviderEdit && displayedProviders.length > 1;

  return (
    <SettingsRow
      title={t("Provider 列表", "Provider List")}
      description={getProviderListDescription(section, t)}
      contentPlacement="below"
      headerAction={
        <Button
          type="button"
          className="rounded-xl bg-black text-white hover:bg-black/90"
          onClick={onAddProvider}
          disabled={hasPendingProviderEdit}
        >
          <Plus className="size-4" />
          {t("新增 Provider", "Add Provider")}
        </Button>
      }
    >
      <div className="space-y-3">
        {displayedProviders.length > 0 ? (
          displayedProviders.map((provider) => (
            <div
              key={provider.id}
              className="relative"
              onDragOver={(event) =>
                onProviderDragOver(event, provider.id, canReorderProviders)
              }
              onDrop={(event) => {
                event.preventDefault();
                onProviderDrop(
                  event,
                  provider.id,
                  canReorderProviders,
                  onMoveProvider,
                );
              }}
            >
              {dragTarget?.providerId === provider.id &&
                dragTarget.position === "before" ? (
                  <div className="absolute inset-x-3 -top-1 z-10 h-0.5 rounded-full bg-black" />
                ) : null}

              <ProviderCard
                section={section}
                provider={provider}
                canDrag={canReorderProviders}
                isDragging={draggingProviderId === provider.id}
                isEditing={editingProviderIds.includes(provider.id)}
                isPrioritized={prioritizedProviderId === provider.id}
                isProviderEditingLocked={
                  hasPendingProviderEdit && !editingProviderIds.includes(provider.id)
                }
                onCancelEdit={onCancelProviderEdit}
                onChange={onProviderChange}
                onDragEnd={onResetDragState}
                onDragStart={onProviderDragStart}
                onFinishEdit={onFinishProviderEdit}
                onRemove={onRemoveProvider}
                onStartEdit={onStartProviderEdit}
              />

              {dragTarget?.providerId === provider.id &&
                dragTarget.position === "after" ? (
                  <div className="absolute inset-x-3 -bottom-1 z-10 h-0.5 rounded-full bg-black" />
                ) : null}
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-black/10 bg-[#fafaf9] px-4 py-5">
            <p className="text-sm leading-6 text-muted-foreground">
              {t(
                "当前还没有可用 Provider。新增后请填写名称与 api_key；base_url 可按需配置。",
                "There are no available providers yet. After adding one, fill in the name and api_key. Configure base_url only when needed.",
              )}
            </p>
          </div>
        )}

        {settingsError && (
          <p className="text-xs text-destructive">{translateError(settingsError)}</p>
        )}
      </div>
    </SettingsRow>
  );
}

function ProviderConcurrentSessionLimitInput({
  field,
  value,
  onChange,
}: {
  field: Extract<
    EditableWorkspaceSettingField,
    "codexProviderConcurrentSessionLimit" | "claudeProviderConcurrentSessionLimit"
  >;
  value: number;
  onChange: (
    field: EditableWorkspaceSettingField,
    value: string | number,
  ) => void;
}) {
  const [inputValue, setInputValue] = useState(() => String(value));

  function handleChange(nextValue: string) {
    if (nextValue !== "" && !/^\d+$/.test(nextValue)) {
      return;
    }

    setInputValue(nextValue);

    if (nextValue === "") {
      return;
    }

    const numericValue = Number.parseInt(nextValue, 10);

    if (Number.isFinite(numericValue) && numericValue >= 1) {
      onChange(field, nextValue);
    }
  }

  function handleBlur() {
    const normalizedValue =
      normalizeWorkspaceProviderConcurrentSessionLimit(inputValue);

    setInputValue(String(normalizedValue));

    if (normalizedValue !== value) {
      onChange(field, normalizedValue);
    }
  }

  return (
    <Input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={inputValue}
      onChange={(event) => handleChange(event.target.value)}
      onBlur={handleBlur}
      className="h-11 rounded-xl border-black/10 bg-white text-foreground shadow-none"
    />
  );
}

function ProviderCard({
  section,
  provider,
  canDrag,
  isDragging,
  isEditing,
  isPrioritized,
  isProviderEditingLocked,
  onCancelEdit,
  onChange,
  onDragEnd,
  onDragStart,
  onFinishEdit,
  onRemove,
  onStartEdit,
}: {
  section: ProviderSection;
  provider: WorkspaceProvider;
  canDrag: boolean;
  isDragging: boolean;
  isEditing: boolean;
  isPrioritized: boolean;
  isProviderEditingLocked: boolean;
  onCancelEdit: (providerId: string) => void;
  onChange: (
    providerId: string,
    field: EditableWorkspaceProviderField,
    value: string | boolean,
  ) => void;
  onDragEnd: () => void;
  onDragStart: (providerId: string, canReorderProviders: boolean) => void;
  onFinishEdit: (providerId: string) => void;
  onRemove: (providerId: string) => void;
  onStartEdit: (providerId: string) => void;
}) {
  const { t, translateError } = useLocale();
  const providerError = getProviderDraftError(section, provider);
  const canFinishEditing = providerError === null;
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);
  const providerLabel = provider.title.trim() || t("未命名 Provider", "Unnamed Provider");

  if (!isEditing) {
    return (
      <div
        className={cn(
          "group/provider cursor-pointer rounded-sm border px-3 py-2.5 transition-colors hover:border-black focus-within:border-black",
          isDragging && "opacity-55",
          !provider.enabled
            ? "border-black/6 bg-[#f3f3f1]"
            : "border-black/8 bg-white",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <button
              type="button"
              draggable={canDrag}
              aria-label={`拖拽排序 ${providerLabel}`}
              className={cn(
                "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-black/8 bg-[#f8f8f6] text-[#7c7c74] transition-colors",
                canDrag
                  ? "cursor-grab hover:border-black/14 hover:text-foreground active:cursor-grabbing"
                  : "cursor-not-allowed opacity-45",
              )}
              onDragStart={(event) => {
                if (!canDrag) {
                  event.preventDefault();
                  return;
                }

                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", provider.id);
                onDragStart(provider.id, canDrag);
              }}
              onDragEnd={onDragEnd}
            >
              <GripVertical className="size-4" />
            </button>

            <div
              className={cn(
                "min-w-0 flex-1",
                !provider.enabled && "text-muted-foreground",
              )}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <div
                  className={cn(
                    "text-sm font-medium",
                    provider.enabled ? "text-foreground" : "text-[#8b8b85]",
                  )}
                >
                  {providerLabel}
                </div>
                {isPrioritized && provider.enabled ? (
                  <Badge
                    variant="secondary"
                    className="rounded-full bg-black text-[11px] text-white hover:bg-black"
                  >
                    {t("优先使用", "Priority")}
                  </Badge>
                ) : null}
              </div>
              <div className="grid gap-2 text-sm">
                <ProviderSummaryRow
                  label="base_url"
                  value={
                    provider.base_url || getProviderDefaultBaseUrlLabel(section, t)
                  }
                  mono
                  muted={!provider.enabled}
                />
                <ProviderSummaryRow
                  label="api_key"
                  value={
                    provider.api_key.trim()
                      ? t("已设置", "Configured")
                      : t("未设置", "Not Set")
                  }
                  muted={!provider.enabled}
                />
              </div>
            </div>
          </div>

          <div
            className={cn(
              "flex flex-wrap items-center gap-4 text-sm md:invisible md:opacity-0 md:transition-[opacity,visibility]",
              "md:group-hover/provider:visible md:group-hover/provider:opacity-100",
              "md:group-focus-within/provider:visible md:group-focus-within/provider:opacity-100",
            )}
          >
            <ProviderTextAction
              onClick={() => onStartEdit(provider.id)}
              disabled={isProviderEditingLocked}
            >
              {t("编辑", "Edit")}
            </ProviderTextAction>
            <ProviderTextAction
              onClick={() => onChange(provider.id, "enabled", !provider.enabled)}
              disabled={isProviderEditingLocked}
            >
              {provider.enabled ? t("禁用", "Disable") : t("启用", "Enable")}
            </ProviderTextAction>
            <ProviderTextAction
              destructive
              onClick={() => onRemove(provider.id)}
              disabled={isProviderEditingLocked}
            >
              {t("删除", "Delete")}
            </ProviderTextAction>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-sm border px-3 py-2.5 transition-colors",
        !provider.enabled
          ? "border-black/6 bg-[#f3f3f1]"
          : "border-black/8 bg-white",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="text-sm font-medium text-foreground">
          {providerLabel}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="rounded-lg bg-black text-white hover:bg-black/90"
            onClick={() => onFinishEdit(provider.id)}
            disabled={!canFinishEditing}
          >
            {t("保存", "Save")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={() => onCancelEdit(provider.id)}
          >
            {t("取消", "Cancel")}
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-2.5">
        <div className="grid gap-1.5">
          <ProviderFieldLabel>{t("名称", "Name")}</ProviderFieldLabel>
          <Input
            value={provider.title}
            onChange={(event) =>
              onChange(provider.id, "title", event.target.value)
            }
            placeholder={t(
              "例如：官方环境 / 公司网关 / 上海测试环境",
              "For example: official / company gateway / Shanghai staging",
            )}
            autoComplete="off"
            className="h-11 rounded-xl border-black/10 bg-white text-foreground shadow-none"
          />
        </div>

        <div className="grid gap-1.5">
          <ProviderFieldLabel>base_url</ProviderFieldLabel>
          <Input
            value={provider.base_url}
            onChange={(event) =>
              onChange(provider.id, "base_url", event.target.value)
            }
            placeholder={getProviderBaseUrlPlaceholder(section, t)}
            autoComplete="off"
            className="h-11 rounded-xl border-black/10 bg-white text-foreground shadow-none"
          />
        </div>

        <div className="grid gap-1.5">
          <ProviderFieldLabel>api_key</ProviderFieldLabel>
          <div className="relative">
            <Input
              type={isApiKeyVisible ? "text" : "password"}
              value={provider.api_key}
              onChange={(event) =>
                onChange(provider.id, "api_key", event.target.value)
              }
              placeholder={t(
                "必填：请输入当前 Provider 的 api_key",
                "Required: enter the api_key for this provider",
              )}
              autoComplete="off"
              className="h-11 rounded-xl border-black/10 bg-white pr-11 text-foreground shadow-none"
            />
            <button
              type="button"
              aria-label={
                isApiKeyVisible
                  ? t("隐藏 api_key", "Hide api_key")
                  : t("查看 api_key", "Show api_key")
              }
              className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-[#72726c] transition-colors hover:bg-black/5 hover:text-foreground"
              onClick={() => setIsApiKeyVisible((currentValue) => !currentValue)}
            >
              {isApiKeyVisible ? (
                <EyeOff className="size-4" />
              ) : (
                <Eye className="size-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {providerError && (
        <p className="mt-2 text-xs text-destructive">
          {translateError(providerError)}
        </p>
      )}
    </div>
  );
}

function ProviderFieldLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </div>
  );
}

function ProviderTextAction({
  children,
  destructive = false,
  disabled = false,
  onClick,
}: {
  children: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "bg-transparent p-0 text-sm font-medium transition-colors",
        destructive
          ? "text-destructive hover:text-destructive/85"
          : "text-[#73736d] hover:text-foreground",
        disabled &&
          "cursor-not-allowed text-[#b7b7b1] hover:text-[#b7b7b1]",
      )}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function ProviderSummaryRow({
  label,
  value,
  mono = false,
  muted = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[72px_minmax(0,1fr)] sm:items-start sm:gap-3">
      <div
        className={cn(
          "text-xs font-medium uppercase tracking-[0.08em]",
          muted ? "text-[#9a9a94]" : "text-muted-foreground",
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "min-w-0 break-all text-sm",
          muted ? "text-[#8b8b85]" : "text-foreground",
          mono && "font-mono text-[13px]",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function SettingsPaneIntro({
  title,
  description,
  badge,
}: {
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <div className="border-b border-black/6 pb-5 pr-12">
      <div className="flex items-center gap-3">
        <h2 className="text-[28px] font-semibold tracking-[-0.02em] text-foreground">
          {title}
        </h2>
        {badge && (
          <Badge variant="secondary" className="rounded-full">
            {badge}
          </Badge>
        )}
      </div>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function SettingsRow({
  title,
  description,
  children,
  contentPlacement = "side",
  headerAction,
}: {
  title: string;
  description: string;
  children: ReactNode;
  contentPlacement?: "side" | "below";
  headerAction?: ReactNode;
}) {
  if (contentPlacement === "below") {
    return (
      <div className="border-b border-black/6 py-6 last:border-b-0 last:pb-0">
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="max-w-[420px] space-y-1">
              <div className="text-[15px] font-medium text-foreground">
                {title}
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            </div>

            {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
          </div>

          <div className="space-y-2">{children}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-black/6 py-6 last:border-b-0 last:pb-0">
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-8 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="max-w-[320px] space-y-1">
            <div className="text-[15px] font-medium text-foreground">
              {title}
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>

          {headerAction}
        </div>

        <div className="space-y-2">{children}</div>
      </div>
    </div>
  );
}

function SettingsSelect({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: string;
  options: Array<{
    value: string;
    label: string;
  }>;
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "relative flex h-11 min-w-[220px] items-center rounded-xl border border-black/10 bg-white text-sm text-foreground shadow-none",
        className,
      )}
    >
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={ariaLabel}
        className="h-full w-full appearance-none bg-transparent px-3 pr-10 outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 size-4 text-muted-foreground" />
    </label>
  );
}

function getDisplayedProviders(providers: WorkspaceProvider[]) {
  return providers
    .map((provider, index) => ({
      provider,
      index,
    }))
    .sort((left, right) => {
      if (left.provider.enabled === right.provider.enabled) {
        return left.index - right.index;
      }

      return left.provider.enabled ? -1 : 1;
    })
    .map(({ provider }) => provider);
}

function getConnectionPhaseLabel(phase: ConnectionPhase) {
  switch (phase) {
    case "connecting":
      return "连接中";
    case "authenticating":
      return "认证中";
    case "connected":
      return "已连接";
    case "error":
      return "异常";
    case "disconnected":
    default:
      return "未连接";
  }
}

function getProviderDraftError(
  section: ProviderSection,
  provider: WorkspaceProvider,
) {
  return section === "codex"
    ? getCodexProviderDraftError(provider)
    : getClaudeProviderDraftError(provider);
}

function getProviderDefaultBaseUrlLabel(
  section: ProviderSection,
  t: (zhText: string, enText: string) => string,
) {
  return section === "codex"
    ? t("OpenAI 官方默认地址", "OpenAI default URL")
    : t("Anthropic 官方默认地址", "Anthropic default URL");
}

function getProviderBaseUrlPlaceholder(
  section: ProviderSection,
  t: (zhText: string, enText: string) => string,
) {
  return section === "codex"
    ? t(
        "留空表示使用 OpenAI 官方默认地址",
        "Leave empty to use the OpenAI default URL",
      )
    : t(
        "留空表示使用 Anthropic 官方默认地址",
        "Leave empty to use the Anthropic default URL",
      );
}

function getProviderListDescription(
  section: ProviderSection,
  t: (zhText: string, enText: string) => string,
) {
  return section === "codex"
    ? t(
        "拖动左侧把手可以调整顺序。新会话会优先使用列表中第一个已启用的 Provider，满载后再按顺序尝试后续 Provider。",
        "Drag the handle on the left to change the order. New sessions prefer the first enabled provider and fall back to later providers when it is saturated.",
      )
    : t(
        "拖动左侧把手可以调整顺序。后续 Claude 接入会优先读取列表中第一个已启用的 Provider，并按顺序回退到后续 Provider。",
        "Drag the handle on the left to change the order. Claude integration prefers the first enabled provider and falls back to later providers in order.",
      );
}
