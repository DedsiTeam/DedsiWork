import { useState } from "react";
import {
  ArrowUpRight,
  ListTodo,
  Check,
  Play,
  Command,
  Database,
  Link2,
  Loader2,
  Pause,
  ShieldCheck,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "./ui/card";
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
export function Pairing({ onConnected }: { onConnected: () => void }) {
  const [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ data: { csrf: string } }>("/auth/pair", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      setCsrf(result.data.csrf);
      onConnected();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="pairing-layout">
      <div className="pairing-story">
        <div className="brand">
          <Mark />
          <span>DedsiWork</span>
        </div>
        <h1>
          把想法变成
          <br />
          有序的行动。
        </h1>
        <p>
          一个属于你的本地工作空间。
          <br />
          在网页里规划，与 AI 一起推进。
        </p>
        <div className="pairing-features">
          <span>
            <Database size={16} />
            数据留在本地
          </span>
          <span>
            <Link2 size={16} />
            通过 MCP 连接 AI
          </span>
        </div>
      </div>
      <Card className="pairing-card">
        <CardHeader>
          <span className="connection-icon">
            <ShieldCheck />
          </span>
          <CardTitle>连接本地工作空间</CardTitle>
          <CardDescription>
            首次访问需要配对，之后即可开始管理工作项。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={connect}>
            <Label htmlFor="pairing-code">本地配对码</Label>
            <Input
              id="pairing-code"
              type="password"
              autoComplete="off"
              placeholder="粘贴 pairingCode"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <p className="pairing-help">
              打开服务启动日志中显示的 <code>access.json</code>，复制{" "}
              <code>pairingCode</code>。开发模式默认位于{" "}
              <code>src/data/access.json</code>。
            </p>
            {error && (
              <p className="message error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <ArrowUpRight />}
              连接工作空间
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
