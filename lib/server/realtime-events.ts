import { EventEmitter } from "node:events";
import type { WorkspacePayload } from "@/lib/workspace";
import type { CodexBridgeEvent } from "@/lib/server/codex-bridge";

export type WorkspaceRealtimeEvent =
  | CodexBridgeEvent
  | {
      type: "workspace.snapshot";
      workspace: WorkspacePayload;
    };

type WorkspaceRealtimeListener = (event: WorkspaceRealtimeEvent) => void;

class WorkspaceRealtimeEventBus {
  private emitter = new EventEmitter();

  subscribe(listener: WorkspaceRealtimeListener) {
    this.emitter.on("event", listener);

    return () => {
      this.emitter.off("event", listener);
    };
  }

  publish(event: WorkspaceRealtimeEvent) {
    this.emitter.emit("event", event);
  }
}

declare global {
  var __playcodeRealtimeEventBus: WorkspaceRealtimeEventBus | undefined;
}

function getRealtimeEventBus() {
  if (!globalThis.__playcodeRealtimeEventBus) {
    globalThis.__playcodeRealtimeEventBus = new WorkspaceRealtimeEventBus();
  }

  return globalThis.__playcodeRealtimeEventBus;
}

export function publishWorkspaceRealtimeEvent(event: WorkspaceRealtimeEvent) {
  getRealtimeEventBus().publish(event);
}

export function subscribeWorkspaceRealtimeEvent(
  listener: WorkspaceRealtimeListener,
) {
  return getRealtimeEventBus().subscribe(listener);
}
