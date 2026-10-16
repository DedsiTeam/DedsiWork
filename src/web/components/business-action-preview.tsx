import { useState } from "react";
import { Link } from "react-router";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Button } from "./ui/button";
import { api } from "../api";
import { useWorkspace } from "../workspace-context";
import { isBusinessDelete } from "../../shared/assistant-business";
import type { AssistantFlow } from "../../shared/assistant";

export function BusinessActionPreview({
  flow,
  onChange,
}: {
  flow: AssistantFlow;
  onChange: (flow: AssistantFlow) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { notify, refreshSummary } = useWorkspace();
  const deleting = isBusinessDelete(flow.businessAction!);
  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await api<{ data: AssistantFlow }>(
        `/api/v1/assistant/flows/${flow.id}/confirm-action`,
        {
          method: "POST",
          body: JSON.stringify({
            expectedRevision: flow.revision,
            confirmed: true,
            ...(deleting ? { deleteConfirmed: true } : {}),
          }),
        },
      );
      onChange(data);
      setConfirmDelete(false);
      refreshSummary();
      notify(data.businessResult!.label);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace-content assistant-business-preview">
      <div className="page-heading">
        <h1>
          {flow.businessResult?.label || `预览：${flow.businessPreview?.title}`}
        </h1>
        <Button variant="outline" asChild>
          <Link to="/assistant">返回对话</Link>
        </Button>
      </div>
      <p className="assistant-business-help">
        {flow.businessResult
          ? "操作已完成，重复打开不会再次执行。"
          : "核对以下操作。需要调整时，返回对话告诉助手；数据已变更时需重新生成操作。"}
      </p>
      <dl className="assistant-business-fields">
        {flow.businessPreview?.rows.map((row, index) => (
          <div key={index}>
            <dt>{row.label}</dt>
            <dd>
              {row.before !== undefined && (
                <div className="assistant-business-before">
                  修改前：{row.before || "未填写"}
                </div>
              )}
              <div>
                {row.before !== undefined ? "修改后：" : ""}
                {row.after || "未填写"}
              </div>
            </dd>
          </div>
        ))}
      </dl>
      {error && !confirmDelete && (
        <p className="message" role="alert">
          {error}
        </p>
      )}
      {flow.businessResult ? (
        <Button asChild>
          <Link to={flow.businessResult.url}>查看结果</Link>
        </Button>
      ) : (
        <Button
          disabled={busy}
          onClick={() => (deleting ? setConfirmDelete(true) : void confirm())}
        >
          {busy ? "正在执行…" : deleting ? "删除…" : "确认执行"}
        </Button>
      )}
      <AlertDialog.Root
        open={confirmDelete}
        onOpenChange={(open) => {
          if (!busy) setConfirmDelete(open);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="dialog-overlay confirmation-overlay" />
          <AlertDialog.Content className="confirmation-content">
            <AlertDialog.Title>确认永久删除？</AlertDialog.Title>
            <AlertDialog.Description>
              将执行“{flow.businessPreview?.title}
              ”，永久删除预览中列出的内容，无法撤销。
            </AlertDialog.Description>
            <div className="assistant-business-delete-targets">
              {flow.businessPreview?.rows.map((row, index) => (
                <p key={index}>
                  {row.label}：{row.after}
                </p>
              ))}
            </div>
            {error && (
              <p className="message" role="alert">
                {error}
              </p>
            )}
            <div className="confirmation-actions">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" disabled={busy}>
                  取消
                </Button>
              </AlertDialog.Cancel>
              <Button disabled={busy} onClick={() => void confirm()}>
                {busy ? "正在删除…" : "确认永久删除"}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}
