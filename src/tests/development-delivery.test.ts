import { test, expect } from "bun:test";
import { captureDevelopmentDelivery } from "../shared/development-task";
import type { ChatSnapshot } from "../shared/chat";
const snapshot = (items: ChatSnapshot["items"]) => ({ items }) as ChatSnapshot;
test("delivery preserves explicit verification and remaining work", () => {
  const result = captureDevelopmentDelivery(
    snapshot([
      { id: "u", role: "user", type: "message", text: "implement" },
      {
        id: "a",
        role: "assistant",
        type: "message",
        text: "## 完成内容\n已修改表单\n## 验证结果\nbun build 通过；测试未执行\n## 遗留问题\n需要人工验收",
      },
    ]),
    "now",
  )!;
  expect(result.verification).toBe("bun build 通过；测试未执行");
  expect(result.remaining).toBe("需要人工验收");
});
test("missing sections never fabricate validation and previous turns are excluded", () => {
  expect(
    captureDevelopmentDelivery(
      snapshot([
        { id: "a", role: "assistant", type: "message", text: "old result" },
        { id: "u", role: "user", type: "message", text: "revise" },
      ]),
      "now",
    ),
  ).toBeNull();
  const result = captureDevelopmentDelivery(
    snapshot([
      { id: "a", role: "assistant", type: "message", text: "Legacy report" },
    ]),
    "now",
  )!;
  expect(result.completed).toBe("Legacy report");
  expect(result.verification).toContain("未提供");
  expect(result.remaining).toContain("未明确");
});
