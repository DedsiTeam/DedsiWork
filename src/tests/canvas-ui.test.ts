import { expect, test } from "bun:test";
import { CanvasUI } from "../server/codex/canvas-ui";
import { canvasNodeSchema } from "../shared/canvas-note";
import { createTestApp } from "./helpers/app";
import type { Actor } from "../server/services/work-items";
const actor: Actor = {
  source: "web",
  identity: "ui-test",
  writable: true,
  requestId: "test",
};
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
const request = {
  prompt: "黑白 UI",
  image: `data:image/png;base64,${png}`,
  width: 390,
  height: 844,
};
class FakeUI extends CanvasUI {
  calls: { method: string; params: any }[] = [];
  override async start() {}
  protected override async rpc<T>(method: string, params: unknown): Promise<T> {
    this.calls.push({ method, params });
    return (
      method === "account/read"
        ? { account: {}, requiresOpenaiAuth: true }
        : method === "modelProvider/capabilities/read"
          ? { imageGeneration: true }
          : method === "thread/start"
            ? {
                thread: {
                  id:
                    "thread-" +
                    this.calls.filter((c) => c.method === "thread/start")
                      .length,
                },
              }
            : method === "turn/start"
              ? { turn: { id: "turn", status: "inProgress" } }
              : {}
    ) as T;
  }
  emit(method: string, extra: any) {
    this.onNotification({ method, params: { threadId: "thread-1", ...extra } });
  }
}
async function started(ai: FakeUI) {
  for (
    let i = 0;
    i < 20 && !ai.calls.some((c) => c.method === "turn/start");
    i++
  )
    await Bun.sleep(1);
}
test("image generation consumes reference, only accepts actual image output and preserves edit metadata", async () => {
  const ai = new FakeUI();
  try {
    const job = ai.generateImage({ ...request, revision: true }, actor);
    await started(ai);
    const turn = ai.calls.find((c) => c.method === "turn/start")!.params;
    expect(turn.input[1]).toEqual({ type: "image", url: request.image });
    expect(turn.input[0].text).toContain("继续修改");
    ai.emit("item/completed", {
      item: { type: "imageGeneration", result: png },
    });
    ai.emit("turn/completed", { turn: { status: "completed" } });
    expect(ai.getImage(job.id, actor).image).toBe(request.image);
    expect(ai.getImage(job.id, actor).status).toBe("completed");
    const node = canvasNodeSchema.parse({
      id: crypto.randomUUID(),
      kind: "image",
      src: request.image,
      x: 0,
      y: 0,
      width: 390,
      height: 844,
      uiDesign: { sourceId: crypto.randomUUID(), prompt: "修改", revision: 2 },
    });
    expect(node.uiDesign?.revision).toBe(2);
  } finally {
    await ai.close();
  }
});
test("no image is a failure, quotas are surfaced, cancellation ignores late results, owners isolated", async () => {
  const ai = new FakeUI();
  try {
    expect(() =>
      ai.generateImage(request, { ...actor, writable: false }),
    ).toThrow();
    const job = ai.generateImage(request, actor);
    await started(ai);
    expect(() =>
      ai.getImage(job.id, { ...actor, identity: "other" }),
    ).toThrow();
    ai.emit("turn/completed", {
      turn: {
        status: "completed",
        items: [{ type: "agentMessage", text: "<html>not an image</html>" }],
      },
    });
    expect(ai.getImage(job.id, actor).status).toBe("failed");
  } finally {
    await ai.close();
  }
  const ai2 = new FakeUI();
  try {
    const job = ai2.generateImage(request, actor);
    await started(ai2);
    await ai2.cancelImage(job.id, actor);
    ai2.emit("item/completed", {
      item: { type: "imageGeneration", result: png },
    });
    ai2.emit("turn/completed", { turn: { status: "completed" } });
    expect(ai2.getImage(job.id, actor).status).toBe("cancelled");
    expect(ai2.getImage(job.id, actor).image).toBeUndefined();
  } finally {
    await ai2.close();
  }
});
test("UI routes validate requests and require write access", async () => {
  const credentials = {
    pairingCode: "ui-test-pairing-code",
    readToken: "ui-test-read-0000000000000000000000",
    writeToken: "ui-test-write-000000000000000000000",
  };
  const origin = "http://127.0.0.1:3241";
  const app = createTestApp({ credentials, origin });
  const req = (
    path: string,
    method = "GET",
    body?: unknown,
    space?: string,
    token = credentials.writeToken,
  ) =>
    app.handle(
      new Request(origin + path, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(space ? { "X-Workspace-Id": space } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  try {
    const space = (
      await (await req("/api/v1/workspaces", "POST", { name: "UI测试" })).json()
    ).data.id;
    expect((await req("/api/v1/notes/ui/jobs", "POST", {}, space)).status).toBe(
      400,
    );
    expect(
      (
        await req(
          "/api/v1/notes/ui/jobs",
          "POST",
          request,
          space,
          credentials.readToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (await req("/api/v1/notes/ui/jobs/missing", "GET", undefined, space))
        .status,
    ).toBe(404);
  } finally {
    await app.close();
  }
});

test("text-only UI generation sends selected requirements and requests an image instead of code", async () => {
  const ai = new FakeUI();
  try {
    const job = ai.generateImage(
      {
        prompt: "简洁白底",
        sourceText: "任务清单，支持新增和完成任务。交付 HTML。",
        width: 1440,
        height: 900,
      },
      actor,
    );
    await started(ai);
    const input = ai.calls.find((c) => c.method === "turn/start")!.params.input;
    expect(input).toHaveLength(1);
    expect(input[0].type).toBe("text");
    expect(input[0].text).toContain("任务清单，支持新增和完成任务");
    expect(input[0].text).toContain("最终只交付 UI 图片");
    ai.emit("item/completed", {
      item: { type: "imageGeneration", result: png },
    });
    ai.emit("turn/completed", { turn: { status: "completed" } });
    expect(ai.getImage(job.id, actor).status).toBe("completed");
  } finally {
    await ai.close();
  }
});

test("parallel UI jobs route independent results and cancellation without evicting active work", async () => {
  const ai = new FakeUI();
  try {
    const jobs = Array.from({ length: 5 }, () =>
      ai.generateImage(request, actor),
    );
    for (
      let i = 0;
      i < 30 && ai.calls.filter((c) => c.method === "turn/start").length < 5;
      i++
    )
      await Bun.sleep(1);
    expect(ai.calls.filter((c) => c.method === "turn/start")).toHaveLength(5);
    expect(() => ai.generateImage(request, actor)).toThrow("最多同时生成");
    await ai.cancelImage(jobs[1]!.id, actor);
    ai.emit("turn/completed", {
      threadId: "thread-3",
      turn: {
        status: "completed",
        items: [{ type: "imageGeneration", result: png }],
      },
    });
    expect(ai.getImage(jobs[2]!.id, actor).image).toBe(request.image);
    expect(ai.getImage(jobs[1]!.id, actor).status).toBe("cancelled");
    expect(ai.getImage(jobs[0]!.id, actor).status).toBe("generating");
    expect(ai.generateImage(request, actor).status).toBe("generating");
  } finally {
    await ai.close();
  }
});
