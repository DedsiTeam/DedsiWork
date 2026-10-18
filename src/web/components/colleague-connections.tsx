import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { Link } from "react-router";
import { api } from "../api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { EmptyState } from "./empty-state";
import type { PeerConnection } from "../../shared/remote-mcp";
export function ColleagueConnections() {
  const [entries, setEntries] = useState<PeerConnection[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null),
    [name, setName] = useState(""),
    [config, setConfig] = useState("");
  const load = async () => {
    const { data } = await api<{ data: PeerConnection[] }>(
      "/api/v1/colleague-mcp",
    );
    setEntries(data);
  };
  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-5">
      <div className="flex justify-end">
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || loading}
            onClick={() => {
              setEditing(null);
              setName("");
              setConfig("");
              setError("");
              setNotice("");
              setOpen(true);
            }}
          >
            添加同事连接
          </Button>
          <Button asChild variant="outline">
            <Link to="/assistant">前往 AI Agent</Link>
          </Button>
        </div>
      </div>
      <div>
        {error && !open && (
          <p className="message" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="muted mb-4" role="status">
            {notice}
          </p>
        )}
        {loading ? (
          <p role="status">正在加载连接…</p>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={Users}
            title="还没有同事连接"
            description="粘贴同事分享的局域网只读 MCP 配置。"
            compact
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {entries.map((entry) => (
              <Card key={entry.id} className="min-w-0">
                <CardHeader>
                  <CardTitle>{entry.name}</CardTitle>
                  <p className="text-muted-foreground text-sm break-all">
                    {entry.url}
                  </p>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api(`/api/v1/colleague-mcp/${entry.id}/check`, {
                          method: "POST",
                        });
                        setNotice(`${entry.name}：连接成功，可读取工作项`);
                      })
                    }
                  >
                    检查连接
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setEditing(entry.id);
                      setName(entry.name);
                      setConfig("");
                      setError("");
                      setNotice("");
                      setOpen(true);
                    }}
                  >
                    修改
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api(`/api/v1/colleague-mcp/${entry.id}`, {
                          method: "DELETE",
                        });
                        await load();
                        setNotice("连接已移除，已保存的需求快照仍然保留");
                      })
                    }
                  >
                    删除
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value);
            setError("");
            setConfig("");
          }
        }}
      >
        <DialogContent className="dialog-content editor p-6 space-y-4">
          <DialogTitle className="text-lg font-semibold">
            {editing ? "修改同事连接" : "添加同事连接"}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {editing
              ? "修改名称，并重新粘贴完整的只读 MCP 配置以更新连接。"
              : "填写同事名称，粘贴同事分享的局域网只读 MCP 配置。"}
          </DialogDescription>
          {error && (
            <p className="message" role="alert">
              {error}
            </p>
          )}
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await api("/api/v1/colleague-mcp", {
                  method: "POST",
                  body: JSON.stringify({
                    ...(editing ? { id: editing } : {}),
                    name,
                    config,
                  }),
                });
                await load();
                setName("");
                setConfig("");
                setEditing(null);
                setOpen(false);
              });
            }}
          >
            <label className="block">
              同事名称
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={80}
                placeholder="例如：张三 · 产品需求"
                disabled={busy}
              />
            </label>
            <label className="block">
              只读 MCP 配置
              <Textarea
                value={config}
                onChange={(e) => setConfig(e.target.value)}
                required
                maxLength={8000}
                rows={5}
                placeholder="粘贴同事通过「复制只读配置」提供的完整 JSON"
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <p className="text-sm text-muted-foreground">
              包含凭据的配置仅保存在本机，Agent 不会收到
              Token。请只添加可信同事的 DedsiWork；需求正文会提供给你使用的 AI
              模型处理。
            </p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy || loading} type="submit">
                {busy ? "正在处理…" : editing ? "保存连接修改" : "添加同事连接"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  setError("");
                  setConfig("");
                }}
              >
                取消
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
