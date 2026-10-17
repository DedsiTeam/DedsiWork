import { useEffect, useState } from "react";
import {
  Server,
  Link2,
  Database,
  Info as InfoIcon,
  Copy,
  Check,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "../components/ui/button";
import { version } from "../../package.json";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../components/ui/card";
import { api } from "../api";
type Info = {
  name: string;
  version: string;
  databasePath: string;
  mcpUrl: string;
  credentialsPath: string;
  writeToken: string;
  runtime: string;
};
export function ServiceInfo() {
  const [aboutOpen, setAboutOpen] = useState(false);
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "error"
  >("idle");
  async function copyVersion() {
    setCopyState("copying");
    try {
      await navigator.clipboard.writeText(version);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }
  const [info, setInfo] = useState<Info | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api<{ data: Info }>("/api/v1/info")
      .then((r) => setInfo(r.data))
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div className="settings-content">
      <div className="page-heading">
        <div>
          <h1>服务与 MCP</h1>
        </div>
        <Dialog.Root
          open={aboutOpen}
          onOpenChange={(open) => {
            setAboutOpen(open);
            setCopyState("idle");
          }}
        >
          <Dialog.Trigger asChild>
            <Button variant="outline">
              <InfoIcon aria-hidden="true" />
              关于 DedsiWork
            </Button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="dialog-overlay" />
            <Dialog.Content className="confirmation-content">
              <Dialog.Title>关于 DedsiWork</Dialog.Title>
              <Dialog.Description>
                DedsiWork · 本地工作管理客户端
              </Dialog.Description>
              <div className="flex items-center justify-between gap-4 mb-4">
                <span>
                  版本{" "}
                  <span className="select-text font-medium">{version}</span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyVersion}
                  disabled={copyState === "copying"}
                >
                  {copyState === "copied" ? (
                    <Check aria-hidden="true" />
                  ) : (
                    <Copy aria-hidden="true" />
                  )}
                  {copyState === "copied"
                    ? "已复制"
                    : copyState === "copying"
                      ? "正在复制…"
                      : "复制版本号"}
                </Button>
              </div>
              <div
                role="status"
                aria-live="polite"
                className="muted text-sm mb-4"
              >
                {copyState === "copied"
                  ? "版本号已复制"
                  : copyState === "error"
                    ? "复制失败，请选中版本号手动复制。"
                    : ""}
              </div>
              <div className="confirmation-actions">
                <Dialog.Close asChild>
                  <Button>关闭</Button>
                </Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>
      {error && (
        <div role="alert" className="message">
          {error}
        </div>
      )}
      {info ? (
        <>
          <div className="info-grid">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server size={18} /> 本地服务
                </CardTitle>
                <CardDescription>数据和服务运行在你的电脑上</CardDescription>
              </CardHeader>
              <CardContent className="info-list">
                <div>
                  <span>运行状态</span>
                  <strong className="connected">
                    <span />
                    运行中
                  </strong>
                </div>
                <div>
                  <span>应用版本</span>
                  <strong>{info.version}</strong>
                </div>
                <div>
                  <span>运行环境</span>
                  <strong>{info.runtime}</strong>
                </div>
                <div>
                  <span>数据库</span>
                  <code>{info.databasePath}</code>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Link2 size={18} /> MCP 连接
                </CardTitle>
                <CardDescription>
                  Streamable HTTP · 工作项 7 · 冲刺 11 · 领域模型 5 · 研发任务
                  19
                </CardDescription>
              </CardHeader>
              <CardContent className="info-list">
                <div>
                  <span>服务地址</span>
                  <code>{info.mcpUrl}</code>
                </div>
                <div>
                  <span>认证方式</span>
                  <strong>Bearer Token</strong>
                </div>
                <div>
                  <span>凭据文件</span>
                  <code>{info.credentialsPath}</code>
                </div>
                <p className="muted text-sm">
                  使用 readToken 允许查询，或使用 writeToken
                  允许创建与修改。下方配置已填入本地 writeToken。
                  研发任务按调用身份隔离，MCP 与网页的任务列表独立；查询 MCP
                  创建的任务需沿用原凭据。
                </p>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>在 MCP 客户端中配置</CardTitle>
              <CardDescription>
                已填入本地 writeToken，可直接复制到客户端的 Authorization
                请求头设置。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="code-block">
                {JSON.stringify(
                  {
                    url: info.mcpUrl,
                    transport: "streamable-http",
                    headers: {
                      Authorization: `Bearer ${info.writeToken}`,
                    },
                  },
                  null,
                  2,
                )}
              </pre>
              <p className="muted text-sm mt-4">
                这是连接参数示意，各客户端配置字段可能不同。本地地址适用于在本机运行的客户端。
              </p>
            </CardContent>
          </Card>
          <div className="message">
            <Database size={18} />
            <span>
              备份前请停止服务，再复制完整数据目录。恢复时同样先停止服务，并保留原有副本。
            </span>
          </div>
        </>
      ) : (
        <p className="muted">正在读取服务信息…</p>
      )}
    </div>
  );
}
