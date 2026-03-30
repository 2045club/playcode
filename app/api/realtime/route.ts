import { getWorkspacePayload } from "@/lib/db";
import {
  defaultConnectionStatus,
  type ConnectionStatus,
} from "@/lib/settings";
import { ensureAuthenticatedRequest } from "@/lib/server/auth";
import {
  subscribeWorkspaceRealtimeEvent,
  type WorkspaceRealtimeEvent,
} from "@/lib/server/realtime-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WorkspaceReadyEvent = {
  type: "workspace.ready";
  workspace: ReturnType<typeof getWorkspacePayload>;
  connection: ConnectionStatus;
};

type WorkspaceRealtimeStreamEvent = WorkspaceReadyEvent | WorkspaceRealtimeEvent;

const encoder = new TextEncoder();

function serializeServerSentEvent(event: WorkspaceRealtimeStreamEvent) {
  return encoder.encode(
    `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

function serializeKeepAliveComment() {
  return encoder.encode(": keep-alive\n\n");
}

export async function GET(request: Request) {
  const authResult = await ensureAuthenticatedRequest(request);

  if (!authResult.ok) {
    return authResult.response;
  }

  let cleanup: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const pushEvent = (event: WorkspaceRealtimeStreamEvent) => {
        if (closed) {
          return;
        }

        try {
          controller.enqueue(serializeServerSentEvent(event));
        } catch {
          close();
        }
      };

      const unsubscribe = subscribeWorkspaceRealtimeEvent((event) => {
        pushEvent(event);
      });

      const keepAliveTimer = setInterval(() => {
        if (closed) {
          return;
        }

        try {
          controller.enqueue(serializeKeepAliveComment());
        } catch {
          close();
        }
      }, 15000);
      keepAliveTimer.unref?.();

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        clearInterval(keepAliveTimer);
        unsubscribe();

        try {
          controller.close();
        } catch {
          return;
        }
      };
      cleanup = close;

      pushEvent({
        type: "workspace.ready",
        workspace: getWorkspacePayload(),
        connection: defaultConnectionStatus,
      });

      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
