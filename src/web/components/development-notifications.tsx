import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import * as Dialog from "@radix-ui/react-dialog";
import { Bell, X } from "lucide-react";
import { isTauri } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { DevelopmentNotification } from "../../shared/development-task";
import { api } from "../api";
import { useWorkspace } from "../workspace-context";
import { Button } from "./ui/button";
import "../development-notifications.css";

const labels = {
  review: "研发已交付，等待你验收",
  waiting: "研发需要你授权或补充信息",
  failed: "研发执行失败，需要你处理",
  interrupted: "研发执行已中断，可以继续",
};
const enabledKey = "dedsiwork:development-desktop-notifications";
function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
async function desktopAllowed(request = false) {
  if (isTauri())
    return (
      (await isPermissionGranted()) ||
      (request && (await requestPermission()) === "granted")
    );
  if (typeof Notification === "undefined") return false;
  return (
    Notification.permission === "granted" ||
    (request && (await Notification.requestPermission()) === "granted")
  );
}
async function desktopSend(title: string, body: string, tag: string) {
  if (!(await desktopAllowed()))
    throw new Error(
      "请在系统设置中允许 DedsiWork 通知；客户端研发提醒仍会保留。",
    );
  if (isTauri()) sendNotification({ title, body });
  else new Notification(title, { body, tag });
}
export function DevelopmentNotifications() {
  const { notify } = useWorkspace();
  const [items, setItems] = useState<DevelopmentNotification[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [enabled, setEnabled] = useState(() => read(enabledKey) === "true");
  const seen = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const { data } = await api<{ data: DevelopmentNotification[] }>(
          "/api/v1/development-notifications",
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setItems(data);
        setError((value) => (value.startsWith("提醒暂未同步：") ? "" : value));
        // Claim each reminder before any async permission/send call, including across tabs.
        const fresh = data.filter((item) => {
          const key = `dedsiwork:development-notice:${item.id}`;
          if (seen.current.has(item.id) || read(key)) return false;
          seen.current.add(item.id);
          write(key, "seen");
          return true;
        });
        if (fresh.length) {
          const body =
            fresh.length === 1
              ? `${fresh[0]!.title}：${labels[fresh[0]!.status]}`
              : `${fresh.length} 个研发任务需要你查看，打开“研发提醒”处理。`;
          notify(
            body,
            fresh.some((i) => i.status === "failed") ? "error" : "success",
          );
          if (enabled) {
            try {
              await desktopSend("DedsiWork 研发提醒", body, fresh[0]!.id);
            } catch (e) {
              if (!controller.signal.aborted) setError((e as Error).message);
            }
          }
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(`提醒暂未同步：${(e as Error).message}`);
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => void poll(), 3000);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [enabled, notify]);
  async function enable() {
    setBusy(true);
    try {
      if (!(await desktopAllowed(true)))
        throw new Error("桌面通知未获允许，仍可在这里查看研发提醒。");
      write(enabledKey, "true");
      setEnabled(true);
      setError("");
      await desktopSend(
        "DedsiWork 通知已开启",
        "研发交付待验收、等待处理或执行失败时，会提醒你。",
        "development-notifications-enabled",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function acknowledge(item: DevelopmentNotification) {
    try {
      await api(`/api/v1/development-tasks/${item.taskId}/acknowledge`, {
        method: "POST",
        headers: { "X-Workspace-Id": item.workspaceId },
        body: JSON.stringify({ notificationId: item.id }),
      });
      setItems((values) => values.filter((value) => value.id !== item.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="development-notice-trigger"
          aria-label={`研发提醒${items.length ? `，${items.length} 条待处理` : ""}`}
          title="研发提醒"
        >
          <Bell size={15} />
          {items.length > 0 && <span>{items.length}</span>}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="confirmation-content development-notice-dialog">
          <div className="development-notice-heading">
            <Dialog.Title>研发提醒</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label="关闭研发提醒">
                <X size={17} />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description>
            任务交付后需要你人工验收和确认合并。“知道了”只关闭提醒。
          </Dialog.Description>
          <div className="development-notice-settings">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                enabled
                  ? (write(enabledKey, "false"), setEnabled(false))
                  : void enable()
              }
            >
              {enabled ? "关闭桌面通知" : busy ? "正在开启…" : "开启桌面通知"}
            </Button>
            {enabled && (
              <Button
                variant="ghost"
                onClick={() =>
                  void desktopSend(
                    "DedsiWork 测试通知",
                    "桌面通知已开启，研发结果等待你人工确认。",
                    "development-test",
                  ).catch((e) => setError((e as Error).message))
                }
              >
                测试通知
              </Button>
            )}
          </div>
          {error && (
            <p role="alert" className="message error">
              {error}
            </p>
          )}
          <div className="development-notice-list">
            {!items.length && <p>暂无待处理的研发提醒。</p>}
            {items.map((item) => (
              <article key={item.id}>
                <strong>{item.title}</strong>
                <p>{labels[item.status]}</p>
                <small>
                  {item.workspaceName} ·{" "}
                  {new Date(item.createdAt).toLocaleString("zh-CN")}
                </small>
                <div>
                  <Button variant="outline" asChild>
                    <Link
                      to={`/development-tasks/${item.taskId}?workspace=${item.workspaceId}`}
                      onClick={() => setOpen(false)}
                    >
                      查看任务
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => void acknowledge(item)}
                  >
                    知道了
                  </Button>
                </div>
              </article>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
