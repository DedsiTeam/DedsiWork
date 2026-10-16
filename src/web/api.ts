let workspaceId = "";
export function setApiWorkspace(id: string) {
  workspaceId = id;
}
export function getApiWorkspace() {
  return workspaceId;
}
let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf,
      ...(workspaceId ? { "X-Workspace-Id": workspaceId } : {}),
      ...options.headers,
    },
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/auth/"))
      window.dispatchEvent(new Event("session-expired"));
    throw new ApiError(
      result.error?.message || "请求失败",
      response.status,
      result.error?.code || "ERROR",
    );
  }
  return result as T;
}

export async function subscribeApi<T>(
  path: string,
  signal: AbortSignal,
  onData: (data: T) => void,
) {
  const response = await fetch(path, {
    signal,
    headers: { "X-Workspace-Id": workspaceId, Accept: "text/event-stream" },
  });
  if (!response.ok) {
    const result = await response.json();
    if (response.status === 401)
      window.dispatchEvent(new Event("session-expired"));
    throw new Error(result.error?.message || "进度连接失败");
  }
  if (!response.body) throw new Error("当前环境不支持实时进度连接");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let end: number;
      while ((end = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n");
        if (data) onData(JSON.parse(data));
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
