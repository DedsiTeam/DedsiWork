import * as Primitive from "@radix-ui/react-alert-dialog";
import { Button } from "./button";
export function DeleteConfirmation({
  open,
  onOpenChange,
  title,
  onConfirm,
  restoreFocus,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  title: string;
  onConfirm: () => void;
  restoreFocus: () => void;
}) {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay className="dialog-overlay confirmation-overlay" />
        <Primitive.Content
          className="confirmation-content"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restoreFocus();
          }}
        >
          <Primitive.Title>确认删除工作项？</Primitive.Title>
          <Primitive.Description>
            “{title}”将移入回收站，之后可以恢复。未保存的修改将丢失。
          </Primitive.Description>
          <div className="confirmation-actions">
            <Primitive.Cancel asChild>
              <Button variant="outline">取消</Button>
            </Primitive.Cancel>
            <Primitive.Action asChild>
              <Button onClick={onConfirm}>确认删除</Button>
            </Primitive.Action>
          </div>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
