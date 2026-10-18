import { Link } from "react-router";
import type { RemoteRequirement } from "../../shared/remote-mcp";
import { descriptionContent } from "./rich-text";
export function RemoteRequirementView({
  source,
}: {
  source: RemoteRequirement;
}) {
  const content = descriptionContent(source.item.description);
  return (
    <div className="space-y-3">
      <h2>{source.item.title}</h2>
      {Boolean(source.existingTasks?.length) && (
        <div className="message">
          此需求已有本机研发任务，可先查看避免重复创建：
          {source.existingTasks!.map((task) => (
            <Link
              className="underline ml-2"
              key={task.id}
              to={`/development-tasks/${task.id}`}
            >
              {task.title}
            </Link>
          ))}
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        来源：{source.connectionName} · 版本 {source.item.version} · 读取于{" "}
        {new Date(source.readAt).toLocaleString("zh-CN")}
      </p>
      <p className="text-xs text-muted-foreground break-all select-text">
        工作项 ID：{source.item.id} · 远程工作空间：{source.workspaceId}
      </p>
      {typeof content === "string" ? (
        <div
          className="rich-description"
          dangerouslySetInnerHTML={{ __html: content }}
        />
      ) : (
        <p className="whitespace-pre-wrap">
          {source.item.description || "暂无描述"}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        此需求已保存为本机快照；研发期间不会自动更换需求，也不会回写同事的工作项。
      </p>
    </div>
  );
}
