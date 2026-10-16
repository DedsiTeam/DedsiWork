import { Inbox, type LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  compact = false,
  className = "",
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`ui-empty-state${compact ? " ui-empty-state-compact" : ""}${className ? ` ${className}` : ""}`}
      role="status"
    >
      <Icon aria-hidden="true" />
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
