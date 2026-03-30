"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { toast } from "@/components/ui/sonner";
import {
  createWorkspaceClaudeProvider,
  createWorkspaceCodexProvider,
  defaultConnectionStatus,
  defaultWorkspaceSettings,
  getClaudeProviderDraftError,
  getCodexProviderDraftError,
  normalizeWorkspaceProviderConcurrentSessionLimit,
  resolveWorkspaceClaudeProviderIds,
  resolveWorkspaceCodexProviderIds,
  type ConnectionStatus,
  type WorkspaceProvider,
  type WorkspaceSettings,
  type WorkspaceSettingsSection,
} from "@/lib/settings";

type SettingsPayload = {
  settings: WorkspaceSettings;
};

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
type ProviderSection = Exclude<WorkspaceSettingsSection, "system">;
type SectionStateMap = Record<WorkspaceSettingsSection, boolean>;
type ProviderErrorStateMap = Record<ProviderSection, string | null>;
type ProviderIdsBySectionMap = Record<ProviderSection, string[]>;
type ProviderSnapshotsBySectionMap = Record<
  ProviderSection,
  Record<string, WorkspaceProvider>
>;
type SaveSettingsOptions = {
  preserveProviderEditing?: boolean;
  showSuccessToast?: boolean;
  showErrorToast?: boolean;
};
type SaveSettingsResult = "saved" | "skipped" | "error";

const AUTO_SAVE_DELAY_MS = 900;

export function useWorkspaceSettings() {
  const { t, translateError } = useLocale();
  const [connectionStatus, setConnectionStatusState] =
    useState<ConnectionStatus>(defaultConnectionStatus);
  const [savedSettings, setSavedSettings] = useState<WorkspaceSettings>(
    defaultWorkspaceSettings,
  );
  const [settingsDraft, setSettingsDraft] = useState<WorkspaceSettings>(
    defaultWorkspaceSettings,
  );
  const [editingProviderIdsBySection, setEditingProviderIdsBySection] =
    useState<ProviderIdsBySectionMap>(createEmptyProviderIdsBySection);
  const [providerEditSnapshotsBySection, setProviderEditSnapshotsBySection] =
    useState<ProviderSnapshotsBySectionMap>(createEmptyProviderSnapshotsBySection);
  const [newProviderIdsBySection, setNewProviderIdsBySection] =
    useState<ProviderIdsBySectionMap>(createEmptyProviderIdsBySection);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [websocketError, setWebsocketError] = useState<string | null>(null);
  const autoSaveTimersRef = useRef<Partial<Record<WorkspaceSettingsSection, number>>>(
    {},
  );

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      try {
        const response = await fetch("/api/settings", {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(t("无法读取设置。", "Failed to load settings."));
        }

        const payload = (await response.json()) as SettingsPayload;

        if (cancelled) {
          return;
        }

        setSavedSettings(payload.settings);
        setSettingsDraft(payload.settings);
        setWebsocketError(validateWebsocketUrl(payload.settings.websocketUrl));
      } catch {
        if (cancelled) {
          return;
        }

        setSavedSettings(defaultWorkspaceSettings);
        setSettingsDraft(defaultWorkspaceSettings);
        setWebsocketError(null);
      }
    }

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        handleCloseSettings();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  });

  const codexSettingsError = validateCodexSettingsDraft(settingsDraft);
  const claudeSettingsError = validateClaudeSettingsDraft(settingsDraft);
  const providerErrorsBySection: ProviderErrorStateMap = {
    codex: codexSettingsError,
    claude: claudeSettingsError,
  };
  const sectionDirtyState: SectionStateMap = {
    system: hasSystemSettingsChanged(savedSettings, settingsDraft),
    codex: hasCodexSettingsChanged(savedSettings, settingsDraft),
    claude: hasClaudeSettingsChanged(savedSettings, settingsDraft),
  };
  const sectionCanSaveState: SectionStateMap = {
    system: sectionDirtyState.system && !websocketError,
    codex: sectionDirtyState.codex && !codexSettingsError,
    claude: sectionDirtyState.claude && !claudeSettingsError,
  };

  const latestSettingsDraftRef = useRef(settingsDraft);
  const latestProviderErrorsRef = useRef(providerErrorsBySection);
  const latestSectionCanSaveStateRef = useRef(sectionCanSaveState);

  latestSettingsDraftRef.current = settingsDraft;
  latestProviderErrorsRef.current = providerErrorsBySection;
  latestSectionCanSaveStateRef.current = sectionCanSaveState;

  const isConnected = connectionStatus.phase === "connected";
  const hasPendingCodexProviderEdit =
    editingProviderIdsBySection.codex.length > 0;
  const hasPendingClaudeProviderEdit =
    editingProviderIdsBySection.claude.length > 0;

  useEffect(() => {
    const autoSaveTimers = autoSaveTimersRef.current;

    return () => {
      clearAllAutoSaveTimers(autoSaveTimers);
    };
  }, []);

  const setConnectionStatus = useCallback(
    (nextConnectionStatus?: ConnectionStatus | null) => {
      setConnectionStatusState(nextConnectionStatus ?? defaultConnectionStatus);
    },
    [],
  );

  function clearAutoSaveTimer(section: WorkspaceSettingsSection) {
    const timerId = autoSaveTimersRef.current[section];

    if (typeof timerId === "number") {
      window.clearTimeout(timerId);
      delete autoSaveTimersRef.current[section];
    }
  }

  function scheduleAutoSave(
    section: WorkspaceSettingsSection,
    delay = AUTO_SAVE_DELAY_MS,
  ) {
    if (typeof window === "undefined") {
      return;
    }

    clearAutoSaveTimer(section);
    autoSaveTimersRef.current[section] = window.setTimeout(() => {
      delete autoSaveTimersRef.current[section];
      void handleSaveSettings(section, {
        preserveProviderEditing: true,
        showSuccessToast: true,
        showErrorToast: true,
      });
    }, delay);
  }

  function flushDirtySettings() {
    clearAllAutoSaveTimers(autoSaveTimersRef.current);

    if (sectionCanSaveState.system) {
      void handleSaveSettings("system", {
        preserveProviderEditing: true,
        showSuccessToast: true,
        showErrorToast: true,
      });
    }

    if (sectionCanSaveState.codex && !hasPendingCodexProviderEdit) {
      void handleSaveSettings("codex", {
        preserveProviderEditing: true,
        showSuccessToast: true,
        showErrorToast: true,
      });
    }

    if (sectionCanSaveState.claude && !hasPendingClaudeProviderEdit) {
      void handleSaveSettings("claude", {
        preserveProviderEditing: true,
        showSuccessToast: true,
        showErrorToast: true,
      });
    }
  }

  function resetAllProviderEditingState() {
    setEditingProviderIdsBySection(createEmptyProviderIdsBySection());
    setProviderEditSnapshotsBySection(createEmptyProviderSnapshotsBySection());
    setNewProviderIdsBySection(createEmptyProviderIdsBySection());
  }

  function clearProviderEditingState(section: ProviderSection) {
    setEditingProviderIdsBySection((currentState) => ({
      ...currentState,
      [section]: [],
    }));
    setProviderEditSnapshotsBySection((currentState) => ({
      ...currentState,
      [section]: {},
    }));
    setNewProviderIdsBySection((currentState) => ({
      ...currentState,
      [section]: [],
    }));
  }

  function handleToggleSettings() {
    if (isSettingsOpen) {
      handleCloseSettings();
      return;
    }

    setSettingsDraft(savedSettings);
    setWebsocketError(validateWebsocketUrl(savedSettings.websocketUrl));
    resetAllProviderEditingState();
    clearAllAutoSaveTimers(autoSaveTimersRef.current);
    setIsSettingsOpen(true);
  }

  function handleSettingsChange(
    field: EditableWorkspaceSettingField,
    value: string | number | boolean,
  ) {
    const normalizedValue =
      field === "codexProviderConcurrentSessionLimit" ||
      field === "claudeProviderConcurrentSessionLimit"
        ? normalizeWorkspaceProviderConcurrentSessionLimit(value)
        : value;
    setSettingsDraft((currentSettings) => ({
      ...currentSettings,
      [field]: normalizedValue,
    }));
    const targetSection = getEditableWorkspaceSettingSection(field);

    if (targetSection === "system") {
      setWebsocketError(
        field === "websocketUrl"
          ? validateWebsocketUrl(String(value))
          : validateWebsocketUrl(settingsDraft.websocketUrl),
      );
    }

    if (
      targetSection !== "system" &&
      editingProviderIdsBySection[targetSection].length > 0
    ) {
      clearAutoSaveTimer(targetSection);
      return;
    }

    scheduleAutoSave(targetSection);
  }

  function handleProviderChange(
    section: ProviderSection,
    providerId: string,
    field: EditableWorkspaceProviderField,
    value: string | boolean,
  ) {
    clearAutoSaveTimer(section);
    setSettingsDraft((currentSettings) => {
      const nextProviders = getProvidersForSection(currentSettings, section).map(
        (provider) =>
          provider.id === providerId
            ? {
                ...provider,
                [field]: value,
                custom:
                  field === "base_url"
                    ? String(value).trim().length > 0
                    : provider.base_url.trim().length > 0,
              }
            : provider,
      );

      return updateSettingsWithProviders(currentSettings, section, nextProviders);
    });

    const isEditingProvider =
      editingProviderIdsBySection[section].includes(providerId);
    const shouldAutoSave =
      field === "enabled" &&
      !isEditingProvider &&
      editingProviderIdsBySection[section].length === 0;

    if (shouldAutoSave) {
      scheduleAutoSave(section);
    }
  }

  function handleAddProvider(section: ProviderSection) {
    clearAutoSaveTimer(section);
    const currentProviders = getProvidersForSection(settingsDraft, section);
    const nextProvider = createProviderForSection(
      section,
      {
        title: t(
          `提供方${currentProviders.length + 1}`,
          `Provider ${currentProviders.length + 1}`,
        ),
      },
      currentProviders.map((provider) => provider.name),
    );

    setEditingProviderIdsBySection((currentState) => ({
      ...currentState,
      [section]: [nextProvider.id],
    }));
    setNewProviderIdsBySection((currentState) => ({
      ...currentState,
      [section]: [nextProvider.id],
    }));
    setSettingsDraft((currentSettings) => {
      const nextProviders = [
        ...getProvidersForSection(currentSettings, section),
        nextProvider,
      ];

      return updateSettingsWithProviders(currentSettings, section, nextProviders, {
        selectedProviderId:
          getSelectedProviderId(currentSettings, section) || nextProvider.id,
      });
    });
  }

  function handleMoveProvider(
    section: ProviderSection,
    draggedProviderId: string,
    targetProviderId: string,
    position: ProviderMovePosition,
  ) {
    clearAutoSaveTimer(section);
    let didReorder = false;

    setSettingsDraft((currentSettings) => {
      const currentProviders = getProvidersForSection(currentSettings, section);
      const nextProviders = reorderProviders(
        currentProviders,
        draggedProviderId,
        targetProviderId,
        position,
      );

      if (nextProviders === currentProviders) {
        return currentSettings;
      }

      didReorder = true;
      return updateSettingsWithProviders(currentSettings, section, nextProviders);
    });

    if (didReorder) {
      scheduleAutoSave(section);
    }
  }

  function handleRemoveProvider(section: ProviderSection, providerId: string) {
    setEditingProviderIdsBySection((currentState) => ({
      ...currentState,
      [section]: currentState[section].filter(
        (currentProviderId) => currentProviderId !== providerId,
      ),
    }));
    setNewProviderIdsBySection((currentState) => ({
      ...currentState,
      [section]: currentState[section].filter(
        (currentProviderId) => currentProviderId !== providerId,
      ),
    }));
    setProviderEditSnapshotsBySection((currentState) => {
      const nextSnapshots = { ...currentState[section] };
      delete nextSnapshots[providerId];

      return {
        ...currentState,
        [section]: nextSnapshots,
      };
    });
    setSettingsDraft((currentSettings) => {
      const nextProviders = getProvidersForSection(currentSettings, section).filter(
        (provider) => provider.id !== providerId,
      );

      return updateSettingsWithProviders(currentSettings, section, nextProviders);
    });
    scheduleAutoSave(section);
  }

  function handleStartProviderEdit(section: ProviderSection, providerId: string) {
    const editingProviderIds = editingProviderIdsBySection[section];

    if (
      editingProviderIds.length > 0 &&
      !editingProviderIds.includes(providerId)
    ) {
      return;
    }

    clearAutoSaveTimer(section);
    const provider = getProvidersForSection(settingsDraft, section).find(
      (item) => item.id === providerId,
    );

    if (provider) {
      setProviderEditSnapshotsBySection((currentState) =>
        currentState[section][providerId]
          ? currentState
          : {
              ...currentState,
              [section]: {
                ...currentState[section],
                [providerId]: provider,
              },
            },
      );
    }

    setEditingProviderIdsBySection((currentState) => ({
      ...currentState,
      [section]: currentState[section].includes(providerId)
        ? currentState[section]
        : [providerId],
    }));
  }

  function handleFinishProviderEdit(
    section: ProviderSection,
    providerId: string,
  ) {
    void (async () => {
      const saveResult = await handleSaveSettings(section, {
        preserveProviderEditing: true,
        showSuccessToast: true,
        showErrorToast: true,
      });

      if (saveResult === "error") {
        return;
      }

      setEditingProviderIdsBySection((currentState) => ({
        ...currentState,
        [section]: currentState[section].filter(
          (currentProviderId) => currentProviderId !== providerId,
        ),
      }));
      setNewProviderIdsBySection((currentState) => ({
        ...currentState,
        [section]: currentState[section].filter(
          (currentProviderId) => currentProviderId !== providerId,
        ),
      }));
      setProviderEditSnapshotsBySection((currentState) => {
        const nextSnapshots = { ...currentState[section] };
        delete nextSnapshots[providerId];

        return {
          ...currentState,
          [section]: nextSnapshots,
        };
      });
    })();
  }

  function handleCancelProviderEdit(
    section: ProviderSection,
    providerId: string,
  ) {
    const isNewProvider = newProviderIdsBySection[section].includes(providerId);

    setEditingProviderIdsBySection((currentState) => ({
      ...currentState,
      [section]: currentState[section].filter(
        (currentProviderId) => currentProviderId !== providerId,
      ),
    }));
    setNewProviderIdsBySection((currentState) => ({
      ...currentState,
      [section]: currentState[section].filter(
        (currentProviderId) => currentProviderId !== providerId,
      ),
    }));

    if (isNewProvider) {
      setProviderEditSnapshotsBySection((currentState) => {
        const nextSnapshots = { ...currentState[section] };
        delete nextSnapshots[providerId];

        return {
          ...currentState,
          [section]: nextSnapshots,
        };
      });
      setSettingsDraft((currentSettings) => {
        const nextProviders = getProvidersForSection(
          currentSettings,
          section,
        ).filter((provider) => provider.id !== providerId);

        return updateSettingsWithProviders(currentSettings, section, nextProviders);
      });
      return;
    }

    const snapshot = providerEditSnapshotsBySection[section][providerId];

    setProviderEditSnapshotsBySection((currentState) => {
      const nextSnapshots = { ...currentState[section] };
      delete nextSnapshots[providerId];

      return {
        ...currentState,
        [section]: nextSnapshots,
      };
    });

    if (!snapshot) {
      return;
    }

    setSettingsDraft((currentSettings) => {
      const nextProviders = getProvidersForSection(currentSettings, section).map(
        (provider) => (provider.id === providerId ? snapshot : provider),
      );

      return updateSettingsWithProviders(currentSettings, section, nextProviders);
    });
  }

  async function handleSaveSettings(
    section: WorkspaceSettingsSection,
    options?: SaveSettingsOptions,
  ): Promise<SaveSettingsResult> {
    const currentSettingsDraft = latestSettingsDraftRef.current;
    const currentProviderErrors = latestProviderErrorsRef.current;
    const currentSectionCanSaveState = latestSectionCanSaveStateRef.current;

    if (section === "system") {
      try {
        const response = await fetch("/api/settings", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            section,
            settings: {
              websocketUrl: currentSettingsDraft.websocketUrl,
              token: currentSettingsDraft.token,
            },
          }),
        });

        const payload = (await response.json()) as
          | SettingsPayload
          | { error?: string };

        if (!response.ok) {
          throw new Error(
            "error" in payload && typeof payload.error === "string"
              ? payload.error
              : t("无法保存配置。", "Unable to save the configuration."),
          );
        }

        const savedPayload = payload as SettingsPayload;
        setSavedSettings(savedPayload.settings);
        setSettingsDraft(savedPayload.settings);
        setWebsocketError(validateWebsocketUrl(savedPayload.settings.websocketUrl));
        if (options?.showSuccessToast ?? true) {
          toast.success(t("保存成功", "Saved"), {
            id: `workspace-settings-${section}`,
            description: t("系统设置已保存。", "System settings have been saved."),
          });
        }

        return "saved";
      } catch (saveError) {
        const errorMessage =
          saveError instanceof Error
            ? translateError(saveError.message)
            : t("保存配置失败。", "Failed to save the configuration.");
        if (options?.showErrorToast ?? true) {
          toast.error(t("保存失败", "Save Failed"), {
            id: `workspace-settings-${section}`,
            description: errorMessage,
          });
        }

        return "error";
      }
    }

    if (currentProviderErrors[section]) {
      return "skipped";
    }

    if (!currentSectionCanSaveState[section]) {
      return "skipped";
    }

    try {
      const sectionSettings =
        section === "codex"
          ? {
              codexProviders: currentSettingsDraft.codexProviders,
              selectedCodexProviderId:
                currentSettingsDraft.selectedCodexProviderId,
              defaultCodexProviderId: currentSettingsDraft.defaultCodexProviderId,
              codexProviderConcurrentSessionLimit:
                currentSettingsDraft.codexProviderConcurrentSessionLimit,
              codexModel: currentSettingsDraft.codexModel,
              codexReasoningEffort: currentSettingsDraft.codexReasoningEffort,
            }
          : {
              claudeProviders: currentSettingsDraft.claudeProviders,
              selectedClaudeProviderId:
                currentSettingsDraft.selectedClaudeProviderId,
              defaultClaudeProviderId:
                currentSettingsDraft.defaultClaudeProviderId,
              claudeProviderConcurrentSessionLimit:
                currentSettingsDraft.claudeProviderConcurrentSessionLimit,
              claudeModel: currentSettingsDraft.claudeModel,
              claudeReasoningEffort:
                currentSettingsDraft.claudeReasoningEffort,
            };

      const response = await fetch("/api/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          section,
          settings: sectionSettings,
        }),
      });

      const payload = (await response.json()) as
        | SettingsPayload
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in payload && typeof payload.error === "string"
            ? payload.error
            : t("无法保存配置。", "Unable to save the configuration."),
        );
      }

      const savedPayload = payload as SettingsPayload;

      setSavedSettings(savedPayload.settings);
      setSettingsDraft(savedPayload.settings);
      if (!options?.preserveProviderEditing) {
        clearProviderEditingState(section);
      }
      if (options?.showSuccessToast ?? true) {
        toast.success(t("保存成功", "Saved"), {
          id: `workspace-settings-${section}`,
          description: t(
            `${getSettingsSectionLabel(section)}已保存。`,
            `${getSettingsSectionLabel(section, true)} saved.`,
          ),
        });
      }

      return "saved";
    } catch (saveError) {
      const errorMessage =
        saveError instanceof Error
          ? translateError(saveError.message)
          : t("保存配置失败。", "Failed to save the configuration.");
      if (options?.showErrorToast ?? true) {
        toast.error(t("保存失败", "Save Failed"), {
          id: `workspace-settings-${section}`,
          description: errorMessage,
        });
      }

      return "error";
    }
  }

  function handleCloseSettings() {
    flushDirtySettings();
    setIsSettingsOpen(false);
    resetAllProviderEditingState();
  }

  return {
    claudeSettingsError,
    codexSettingsError,
    connectionStatus,
    editingClaudeProviderIds: editingProviderIdsBySection.claude,
    editingCodexProviderIds: editingProviderIdsBySection.codex,
    handleAddClaudeProvider: () => handleAddProvider("claude"),
    handleAddCodexProvider: () => handleAddProvider("codex"),
    handleCancelClaudeProviderEdit: (providerId: string) =>
      handleCancelProviderEdit("claude", providerId),
    handleCancelCodexProviderEdit: (providerId: string) =>
      handleCancelProviderEdit("codex", providerId),
    handleClaudeProviderChange: (
      providerId: string,
      field: EditableWorkspaceProviderField,
      value: string | boolean,
    ) => handleProviderChange("claude", providerId, field, value),
    handleCloseSettings,
    handleCodexProviderChange: (
      providerId: string,
      field: EditableWorkspaceProviderField,
      value: string | boolean,
    ) => handleProviderChange("codex", providerId, field, value),
    handleFinishClaudeProviderEdit: (providerId: string) =>
      handleFinishProviderEdit("claude", providerId),
    handleFinishCodexProviderEdit: (providerId: string) =>
      handleFinishProviderEdit("codex", providerId),
    handleMoveClaudeProvider: (
      draggedProviderId: string,
      targetProviderId: string,
      position: ProviderMovePosition,
    ) =>
      handleMoveProvider("claude", draggedProviderId, targetProviderId, position),
    handleMoveCodexProvider: (
      draggedProviderId: string,
      targetProviderId: string,
      position: ProviderMovePosition,
    ) => handleMoveProvider("codex", draggedProviderId, targetProviderId, position),
    handleRemoveClaudeProvider: (providerId: string) =>
      handleRemoveProvider("claude", providerId),
    handleRemoveCodexProvider: (providerId: string) =>
      handleRemoveProvider("codex", providerId),
    handleSettingsChange,
    handleStartClaudeProviderEdit: (providerId: string) =>
      handleStartProviderEdit("claude", providerId),
    handleStartCodexProviderEdit: (providerId: string) =>
      handleStartProviderEdit("codex", providerId),
    handleToggleSettings,
    hasPendingClaudeProviderEdit,
    hasPendingCodexProviderEdit,
    isConnected,
    isSettingsOpen,
    savedSettings,
    setConnectionStatus,
    settingsDraft,
    websocketError,
  };
}

function createEmptyProviderIdsBySection(): ProviderIdsBySectionMap {
  return {
    codex: [],
    claude: [],
  };
}

function createEmptyProviderSnapshotsBySection(): ProviderSnapshotsBySectionMap {
  return {
    codex: {},
    claude: {},
  };
}

function clearAllAutoSaveTimers(
  timers: Partial<Record<WorkspaceSettingsSection, number>>,
) {
  for (const timerId of Object.values(timers)) {
    if (typeof timerId === "number") {
      window.clearTimeout(timerId);
    }
  }
}

function getEditableWorkspaceSettingSection(
  field: EditableWorkspaceSettingField,
): WorkspaceSettingsSection {
  if (field === "websocketUrl" || field === "token") {
    return "system";
  }

  if (
    field === "claudeModel" ||
    field === "claudeReasoningEffort" ||
    field === "claudeProviderConcurrentSessionLimit"
  ) {
    return "claude";
  }

  return "codex";
}

function getProvidersForSection(
  settings: WorkspaceSettings,
  section: ProviderSection,
) {
  return section === "codex" ? settings.codexProviders : settings.claudeProviders;
}

function getSelectedProviderId(
  settings: WorkspaceSettings,
  section: ProviderSection,
) {
  return section === "codex"
    ? settings.selectedCodexProviderId
    : settings.selectedClaudeProviderId;
}

function getDefaultProviderId(
  settings: WorkspaceSettings,
  section: ProviderSection,
) {
  return section === "codex"
    ? settings.defaultCodexProviderId
    : settings.defaultClaudeProviderId;
}

function updateSettingsWithProviders(
  settings: WorkspaceSettings,
  section: ProviderSection,
  providers: WorkspaceProvider[],
  options?: {
    selectedProviderId?: string | null;
    defaultProviderId?: string | null;
  },
) {
  if (section === "codex") {
    const nextProviderIds = resolveWorkspaceCodexProviderIds({
      providers,
      selectedCodexProviderId:
        options?.selectedProviderId ?? settings.selectedCodexProviderId,
      defaultCodexProviderId:
        options?.defaultProviderId ?? settings.defaultCodexProviderId,
    });

    return {
      ...settings,
      codexProviders: providers,
      selectedCodexProviderId: nextProviderIds.selectedCodexProviderId,
      defaultCodexProviderId: nextProviderIds.defaultCodexProviderId,
    };
  }

  const nextProviderIds = resolveWorkspaceClaudeProviderIds({
    providers,
    selectedClaudeProviderId:
      options?.selectedProviderId ?? settings.selectedClaudeProviderId,
    defaultClaudeProviderId:
      options?.defaultProviderId ?? settings.defaultClaudeProviderId,
  });

  return {
    ...settings,
    claudeProviders: providers,
    selectedClaudeProviderId: nextProviderIds.selectedClaudeProviderId,
    defaultClaudeProviderId: nextProviderIds.defaultClaudeProviderId,
  };
}

function createProviderForSection(
  section: ProviderSection,
  overrides?: Partial<WorkspaceProvider>,
  existingNames: Iterable<string> = [],
) {
  return section === "codex"
    ? createWorkspaceCodexProvider(overrides, existingNames)
    : createWorkspaceClaudeProvider(overrides, existingNames);
}

function getProviderDraftError(
  section: ProviderSection,
  provider: WorkspaceProvider,
) {
  return section === "codex"
    ? getCodexProviderDraftError(provider)
    : getClaudeProviderDraftError(provider);
}

function getSettingsSectionLabel(
  section: WorkspaceSettingsSection,
  useEnglish = false,
) {
  switch (section) {
    case "system":
      return useEnglish ? "System Settings" : "系统设置";
    case "codex":
      return useEnglish ? "Codex Settings" : "Codex 设置";
    case "claude":
      return useEnglish ? "Claude Settings" : "Claude 设置";
    default:
      return useEnglish ? "Settings" : "设置";
  }
}

function hasSystemSettingsChanged(
  savedSettings: WorkspaceSettings,
  draftSettings: WorkspaceSettings,
) {
  return (
    savedSettings.websocketUrl !== draftSettings.websocketUrl ||
    savedSettings.token !== draftSettings.token
  );
}

function hasCodexSettingsChanged(
  savedSettings: WorkspaceSettings,
  draftSettings: WorkspaceSettings,
) {
  return (
    hasProviderSettingsChanged("codex", savedSettings, draftSettings) ||
    savedSettings.codexProviderConcurrentSessionLimit !==
      draftSettings.codexProviderConcurrentSessionLimit ||
    savedSettings.codexModel !== draftSettings.codexModel ||
    savedSettings.codexReasoningEffort !== draftSettings.codexReasoningEffort
  );
}

function hasClaudeSettingsChanged(
  savedSettings: WorkspaceSettings,
  draftSettings: WorkspaceSettings,
) {
  return (
    hasProviderSettingsChanged("claude", savedSettings, draftSettings) ||
    savedSettings.claudeProviderConcurrentSessionLimit !==
      draftSettings.claudeProviderConcurrentSessionLimit ||
    savedSettings.claudeModel !== draftSettings.claudeModel ||
    savedSettings.claudeReasoningEffort !== draftSettings.claudeReasoningEffort
  );
}

function hasProviderSettingsChanged(
  section: ProviderSection,
  savedSettings: WorkspaceSettings,
  draftSettings: WorkspaceSettings,
) {
  return (
    serializeProviders(getProvidersForSection(savedSettings, section)) !==
      serializeProviders(getProvidersForSection(draftSettings, section)) ||
    getSelectedProviderId(savedSettings, section) !==
      getSelectedProviderId(draftSettings, section) ||
    getDefaultProviderId(savedSettings, section) !==
      getDefaultProviderId(draftSettings, section)
  );
}

function validateWebsocketUrl(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedValue);

    if (parsedUrl.protocol === "ws:" || parsedUrl.protocol === "wss:") {
      return null;
    }

    return "WebSocket 地址需要以 ws:// 或 wss:// 开头。";
  } catch {
    return "请输入有效的 WebSocket 地址。";
  }
}

function validateCodexSettingsDraft(settings: WorkspaceSettings) {
  return validateProviderSettingsDraft("codex", settings);
}

function validateClaudeSettingsDraft(settings: WorkspaceSettings) {
  return validateProviderSettingsDraft("claude", settings, {
    allowEmptyProviders: true,
  });
}

function validateProviderSettingsDraft(
  section: ProviderSection,
  settings: WorkspaceSettings,
  options?: {
    allowEmptyProviders?: boolean;
  },
) {
  const providers = getProvidersForSection(settings, section);

  if (providers.length === 0) {
    return options?.allowEmptyProviders ? null : "至少需要配置一个 Provider。";
  }

  for (const provider of providers) {
    const providerLabel = provider.title.trim() || "未命名 Provider";
    const providerError = getProviderDraftError(section, provider);

    if (providerError) {
      return `Provider「${providerLabel}」配置有误：${providerError}`;
    }
  }

  return null;
}

function serializeProviders(providers: WorkspaceProvider[]) {
  return JSON.stringify(providers);
}

function reorderProviders(
  providers: WorkspaceProvider[],
  draggedProviderId: string,
  targetProviderId: string,
  position: ProviderMovePosition,
) {
  if (
    draggedProviderId.trim().length === 0 ||
    targetProviderId.trim().length === 0 ||
    draggedProviderId === targetProviderId
  ) {
    return providers;
  }

  const sourceIndex = providers.findIndex(
    (provider) => provider.id === draggedProviderId,
  );
  const targetIndex = providers.findIndex(
    (provider) => provider.id === targetProviderId,
  );

  if (sourceIndex < 0 || targetIndex < 0) {
    return providers;
  }

  const nextProviders = [...providers];
  const [draggedProvider] = nextProviders.splice(sourceIndex, 1);

  if (!draggedProvider) {
    return providers;
  }

  const insertionIndex = nextProviders.findIndex(
    (provider) => provider.id === targetProviderId,
  );

  if (insertionIndex < 0) {
    return providers;
  }

  nextProviders.splice(
    position === "after" ? insertionIndex + 1 : insertionIndex,
    0,
    draggedProvider,
  );

  return nextProviders;
}
