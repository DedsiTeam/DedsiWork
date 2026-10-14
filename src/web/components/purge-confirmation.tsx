import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Button } from "./ui/button";

export function PurgeConfirmation({
  titles,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  titles: string[];
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="dialog-overlay confirmation-overlay" />
        <AlertDialog.Content
          className="confirmation-content"
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
          }}
        >
          <AlertDialog.Title>
            永久删除
            {titles.length > 1 ? ` ${titles.length} 个工作项` : "工作项"}？
          </AlertDialog.Title>
          <AlertDialog.Description>
            {titles.length === 1
              ? `“${titles[0]}”`
              : `选中的 ${titles.length} 个工作项`}
            及其描述、图片和活动记录将永久删除，无法恢复。
          </AlertDialog.Description>
          {titles.length > 1 && (
            <ul className="purge-targets">
              {titles.map((title, index) => (
                <li key={index}>{title}</li>
              ))}
            </ul>
          )}
          {error && (
            <div role="alert" className="message error">
              {error}
            </div>
          )}
          <div className="confirmation-actions">
            <AlertDialog.Cancel asChild>
              <Button variant="outline" disabled={busy}>
                取消
              </Button>
            </AlertDialog.Cancel>
            <Button onClick={onConfirm} disabled={busy}>
              {busy ? "正在删除…" : "确认永久删除"}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
