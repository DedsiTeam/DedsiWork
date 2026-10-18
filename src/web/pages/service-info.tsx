import { ColleagueConnections } from "../components/colleague-connections";
import { useWorkspace } from "../workspace-context";
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
type LanInfo = {
  enabled: boolean;
  running: boolean;
  port: number;
  error: string;
  urls: string[];
};
type Info = {
  name: string;
  version: string;
  databasePath: string;
  mcpUrl: string;
  credentialsPath: string;
  writeToken: string;
  readToken: string;
  lan: LanInfo;
  runtime: string;
};
const serviceTabs = [
  { id: "local", label: "本机服务" },
  { id: "lan", label: "局域网共享" },
  { id: "colleagues", label: "同事连接" },
] as const;
export function ServiceInfo() {
  const [tab, setTab] = useState<(typeof serviceTabs)[number]["id"]>("local");
  const { workspace, notify } = useWorkspace();
  const [lanBusy, setLanBusy] = useState(false);
  async function toggleLan() {
    if (!info) return;
    setLanBusy(true);
    setError("");
    try {
      const { data } = await api<{ data: LanInfo }>("/api/v1/mcp/lan", {
        method: "PUT",
        body: JSON.stringify({ enabled: !info.lan.enabled }),
      });
      setInfo((current) => (current ? { ...current, lan: data } : current));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLanBusy(false);
    }
  }
  function lanConfig(url: string) {
    return JSON.stringify(
      {
        url,
        transport: "streamable-http",
        headers: { Authorization: `Bearer ${info!.readToken}` },
      },
      null,
      2,
    );
  }

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
    let active = true;
    setInfo(null);
    api<{ data: Info }>("/api/v1/info")
      .then((r) => {
        if (active) setInfo(r.data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [workspace?.id]);
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
            <Button
              variant="outline"
              title={"关于 DedsiWork"}
              aria-label={"关于 DedsiWork"}
              size="icon-sm"
            >
              <InfoIcon aria-hidden="true" />
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
      <div
        role="tablist"
        aria-label="服务与 MCP 分类"
        className="flex flex-wrap gap-2 mt-5 mb-5"
      >
        {serviceTabs.map((entry, index) => (
          <Button
            key={entry.id}
            id={`service-tab-${entry.id}`}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            aria-controls={`service-panel-${entry.id}`}
            tabIndex={tab === entry.id ? 0 : -1}
            variant={tab === entry.id ? "secondary" : "ghost"}
            onClick={() => setTab(entry.id)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % serviceTabs.length
                  : event.key === "ArrowLeft"
                    ? (index + serviceTabs.length - 1) % serviceTabs.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? serviceTabs.length - 1
                        : null;
              if (next === null) return;
              event.preventDefault();
              setTab(serviceTabs[next]!.id);
              document
                .getElementById(`service-tab-${serviceTabs[next]!.id}`)
                ?.focus();
            }}
          >
            {entry.label}
          </Button>
        ))}
      </div>
      {error && (
        <div role="alert" className="message">
          {error}
        </div>
      )}
      {info ? (
        <>
          <div
            role="tabpanel"
            id="service-panel-local"
            aria-labelledby="service-tab-local"
            hidden={tab !== "local"}
            tabIndex={0}
          >
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
          </div>
          <div
            role="tabpanel"
            id="service-panel-lan"
            aria-labelledby="service-tab-lan"
            hidden={tab !== "lan"}
            tabIndex={0}
          >
            <Card>
              <CardHeader>
                <CardTitle>办公室局域网 · 只读 MCP</CardTitle>
                <CardDescription>
                  每次启动默认关闭，需要共享时手动开启。
                  同事开启后，将连接配置发给你；在你的 MCP
                  客户端连接，再用微信收到的工作项 ID 读取详情。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <span role="status">
                    {info.lan.running ? "已开启" : "未开启"} · 端口{" "}
                    {info.lan.port}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={lanBusy}
                    onClick={toggleLan}
                  >
                    {lanBusy
                      ? "正在设置…"
                      : info.lan.enabled
                        ? "关闭局域网访问"
                        : "开启局域网访问"}
                  </Button>
                </div>
                {info.lan.error && (
                  <p role="alert" className="message">
                    {info.lan.error}
                  </p>
                )}
                {info.lan.running && info.lan.urls.length === 0 && (
                  <p role="status" className="muted">
                    未检测到局域网 IPv4 地址，请连接办公室 Wi-Fi
                    或有线网络后重新进入本页。
                  </p>
                )}
                {info.lan.urls.map((url) => (
                  <div key={url} className="mb-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <code className="break-all select-text">{url}</code>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(lanConfig(url));
                            notify("局域网只读 MCP 配置已复制");
                          } catch {
                            notify("复制失败，请选中下方配置手动复制", "error");
                          }
                        }}
                      >
                        <Copy aria-hidden="true" />
                        复制只读配置
                      </Button>
                    </div>
                    <pre className="code-block">{lanConfig(url)}</pre>
                  </div>
                ))}
                <p className="muted text-sm">
                  配置指向当前工作空间「{workspace?.name}」。readToken
                  是本机所有工作空间共用的只读凭据，仅分享给可信同事。
                  双方需要处于可互通的局域网，允许防火墙入站端口 {info.lan.port}
                  ，并保持提供方客户端运行。 使用 HTTP
                  明文传输，仅适用于可信办公室网络。此入口不接受
                  writeToken，也不允许修改数据或启动研发任务。
                </p>
                <p className="muted text-sm mt-4">
                  同事在工作项上点击「复制 ID」发给你；连接其 MCP 后调用
                  work_item_get，传入该 ID 即可读取完整需求。 多位同事的连接在
                  MCP 客户端分别命名；研发工作在你的电脑上进行。
                </p>
              </CardContent>
            </Card>
          </div>
          <div
            role="tabpanel"
            id="service-panel-colleagues"
            aria-labelledby="service-tab-colleagues"
            hidden={tab !== "colleagues"}
            tabIndex={0}
          >
            <ColleagueConnections />
          </div>
        </>
      ) : (
        <p className="muted">正在读取服务信息…</p>
      )}
    </div>
  );
}
