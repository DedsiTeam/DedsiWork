import { expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReportExports } from "../server/services/report-exports";
import type { Actor } from "../server/services/work-items";
import { createTestApp } from "./helpers/app";
const actor: Actor = {
  source: "web",
  identity: "export-test",
  writable: true,
  requestId: "export-test",
};
test("native export writes exact edited Chinese text as UTF-8 and leaves no temporary files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dedsiwork-export-")),
    path = join(dir, "文字稿.md"),
    content =
      "# 我的周报\n\n修改后的结果：完成 3 个接口。\n  保留空格和换行。\n";
  try {
    let pickedName = "";
    const service = new ReportExports(async (name) => {
      pickedName = name;
      return path;
    });
    expect(
      await service.save({ name: "周报-AI文字稿.md", content }, actor),
    ).toEqual({ cancelled: false, path });
    expect(pickedName).toBe("周报-AI文字稿.md");
    expect(readFileSync(path, "utf8")).toBe(content);
    expect(readdirSync(dir)).toEqual(["文字稿.md"]);
    await service.save({ name: "周报.md", content: "重新保存的文字" }, actor);
    expect(readFileSync(path, "utf8")).toBe("重新保存的文字");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("cancelled save does not write and releases dialog lock", async () => {
  let calls = 0;
  const service = new ReportExports(async () => {
    calls++;
    return null;
  });
  expect(await service.save({ name: "周报", content: "测试" }, actor)).toEqual({
    cancelled: true,
  });
  expect(await service.save({ name: "月报", content: "测试" }, actor)).toEqual({
    cancelled: true,
  });
  expect(calls).toBe(2);
});
test("invalid input and read-only clients never open a picker", async () => {
  let calls = 0;
  const service = new ReportExports(async () => {
    calls++;
    return null;
  });
  await expect(
    service.save(
      { name: "报告", content: "测试" },
      { ...actor, writable: false },
    ),
  ).rejects.toThrow("需要写入权限");
  await expect(
    service.save({ name: "报告", content: "  " }, actor),
  ).rejects.toThrow();
  await expect(
    service.save(
      { name: "报告", content: "测试", path: "/tmp/arbitrary.md" },
      actor,
    ),
  ).rejects.toThrow();
  expect(calls).toBe(0);
});
test("concurrent clicks cannot open multiple dialogs", async () => {
  let release!: (value: null) => void;
  const service = new ReportExports(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const first = service.save({ name: "周报", content: "测试" }, actor);
  await expect(
    service.save({ name: "月报", content: "测试" }, actor),
  ).rejects.toThrow("已有保存窗口");
  release(null);
  expect(await first).toEqual({ cancelled: true });
});
test("file errors are visible, preserve existing data and release lock", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dedsiwork-export-failure-"));
  try {
    const path = join(dir, "existing.md");
    writeFileSync(path, "原文");
    const service = new ReportExports(async () =>
      join(dir, "missing", "报告.md"),
    );
    await expect(
      service.save({ name: "周报", content: "修改" }, actor),
    ).rejects.toThrow("保存文件失败");
    expect(readFileSync(path, "utf8")).toBe("原文");
    expect(readdirSync(dir)).toEqual(["existing.md"]);
    await expect(
      service.save({ name: "周报", content: "再次修改" }, actor),
    ).rejects.toThrow("保存文件失败");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("suggested names are sanitized and invalid picker paths rejected", async () => {
  let name = "";
  const service = new ReportExports(async (value) => {
    name = value;
    return "relative.md";
  });
  await expect(
    service.save({ name: "../报告:测试", content: "正文" }, actor),
  ).rejects.toThrow("路径无效");
  expect(name).toBe(".._报告_测试.md");
});
test("export endpoint enforces permissions and rejects direct destination paths", async () => {
  const credentials = {
      pairingCode: "report-export-pairing",
      readToken: "report-export-read-00000000000000000",
      writeToken: "report-export-write-0000000000000000",
    },
    origin = "http://127.0.0.1:3242",
    app = createTestApp({ credentials, origin });
  const req = (
    path: string,
    method: string,
    body: unknown,
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
        ...(method !== "GET" ? { body: JSON.stringify(body) } : {}),
      }),
    );
  try {
    const space = (
      await (
        await req("/api/v1/workspaces", "POST", { name: "导出测试" })
      ).json()
    ).data.id;
    expect(
      (
        await req(
          "/api/v1/reports/export",
          "POST",
          { name: "报告.md", content: "正文" },
          space,
          credentials.readToken,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await req(
          "/api/v1/reports/export",
          "POST",
          { name: "报告.md", content: "正文", path: "/tmp/direct.md" },
          space,
        )
      ).status,
    ).toBe(400);
    expect((await req("/api/v1/reports/export", "GET", {}, space)).status).toBe(
      405,
    );
  } finally {
    await app.close();
  }
});
