import * as Primitive from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";
export const Dialog = Primitive.Root;
export const DialogTitle = Primitive.Title;
export const DialogDescription = Primitive.Description;
export function DialogContent({
  children,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Overlay className="dialog-overlay" />
      <Primitive.Content className="dialog-content editor" {...props}>
        {children}
      </Primitive.Content>
    </Primitive.Portal>
  );
}
