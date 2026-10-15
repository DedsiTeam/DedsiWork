import { useEffect, useState } from "react";
import { Server, Link2, Database } from "lucide-react";
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
                  Streamable HTTP · 7 个工作项工具 · 11 个冲刺工具
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
