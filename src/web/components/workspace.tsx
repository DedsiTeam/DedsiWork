import { useState } from "react";
import {
  ListTodo,
  Check,
  Play,
  Command,
  Loader2,
  Pause,
  ShieldCheck,
} from "lucide-react";
import { Button } from "./ui/button";
import { api, setCsrf } from "../api";
import { statusLabels, type WorkItem } from "../../shared/work-item";
export function Mark() {
  return (
    <span className="brand-mark">
      <Command size={22} />
    </span>
  );
}
export function Status({ status }: { status: WorkItem["status"] }) {
  const Icon =
    status === "done"
      ? Check
      : status === "in_progress"
        ? Play
        : status === "paused"
          ? Pause
          : status === "in_review" || status === "awaiting_acceptance"
            ? ShieldCheck
            : status === "in_verification"
              ? Loader2
              : ListTodo;
  return (
    <span className={`status status-${status}`}>
      <Icon size={13} />
      {statusLabels[status]}
    </span>
  );
}
export function LocalConnection({ onConnected }: { onConnected: () => void }) {
  const [error, setError] = useState("无法连接本地服务，请确认客户端已启动。"),
    [busy, setBusy] = useState(false);
  async function connect() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ data: { csrf: string } }>("/auth/session");
      setCsrf(result.data.csrf);
      onConnected();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="boot">
      <Mark />
      <p role="alert">{error || "正在连接本地工作空间…"}</p>
      <Button onClick={connect} disabled={busy}>
        {busy && <Loader2 className="animate-spin" />}
        重新连接
      </Button>
    </div>
  );
}
