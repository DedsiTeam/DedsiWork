import { expect, test } from "bun:test";
import { api, setApiWorkspace, setCsrf } from "../web/api";

test("CSRF refresh retries the rejected save once with intact body and original workspace", async () => {
  const original = globalThis.fetch;
  const calls: { path: string; options?: RequestInit }[] = [];
  setApiWorkspace("original-space");
  setCsrf("expired");
  globalThis.fetch = (async (path: string, options?: RequestInit) => {
    calls.push({ path, options });
    if (path === "/auth/session") {
      setApiWorkspace("other-space");
      return Response.json({ data: { csrf: "fresh" } });
    }
    return calls.length === 1
      ? Response.json({ error: { code: "CSRF" } }, { status: 403 })
      : Response.json({ data: "saved" });
  }) as unknown as typeof fetch;
  try {
    expect(
      await api("/api/v1/daily-reports", {
        method: "POST",
        body: '{"outcome":"verified"}',
      }),
    ).toEqual({ data: "saved" });
    expect(calls).toHaveLength(3);
    expect(calls[2]!.options!.body).toBe(calls[0]!.options!.body);
    expect(new Headers(calls[2]!.options!.headers).get("X-Workspace-Id")).toBe(
      "original-space",
    );
    expect(new Headers(calls[2]!.options!.headers).get("X-CSRF-Token")).toBe(
      "fresh",
    );
  } finally {
    globalThis.fetch = original;
    setApiWorkspace("");
    setCsrf("");
  }
});

test("ordinary failed mutations are not replayed and persistent CSRF failures stop after one retry", async () => {
  const original = globalThis.fetch;
  let count = 0;
  globalThis.fetch = (async () => {
    count++;
    return Response.json(
      { error: { code: "CONFLICT", message: "stale" } },
      { status: 409 },
    );
  }) as unknown as typeof fetch;
  try {
    await expect(
      api("/api/v1/daily-reports", { method: "POST" }),
    ).rejects.toThrow("stale");
    expect(count).toBe(1);
    count = 0;
    globalThis.fetch = (async (path: string) => {
      count++;
      return path === "/auth/session"
        ? Response.json({ data: { csrf: "fresh" } })
        : Response.json(
            { error: { code: "CSRF", message: "invalid" } },
            { status: 403 },
          );
    }) as unknown as typeof fetch;
    await expect(
      api("/api/v1/daily-reports", { method: "POST" }),
    ).rejects.toThrow("invalid");
    expect(count).toBe(3);
  } finally {
    globalThis.fetch = original;
    setCsrf("");
  }
});
