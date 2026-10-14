import {
  Columns3,
  LayoutList,
  CircleDot,
  CircleCheck,
  Trash2,
  Settings2,
  ListTodo,
  Boxes,
} from "lucide-react";
export const navigation = [
  {
    id: "work",
    label: "工作项",
    icon: ListTodo,
    children: [
      {
        to: "/work-items",
        label: "全部工作项",
        icon: LayoutList,
        count: "total" as const,
      },
      {
        to: "/work-items/in-progress",
        label: "进行中",
        icon: CircleDot,
        count: "inProgress" as const,
      },
      {
        to: "/work-items/completed",
        label: "已完成",
        icon: CircleCheck,
        count: "done" as const,
      },
      {
        to: "/work-items/trash",
        label: "回收站",
        icon: Trash2,
        count: "trash" as const,
      },
      { to: "/work-items/sprints", label: "冲刺看板", icon: Columns3 },
    ],
  },
  {
    id: "domain-models",
    label: "领域模型",
    icon: Boxes,
    children: [{ to: "/domain-models", label: "模型管理", icon: Boxes }],
  },
  {
    id: "system",
    label: "设置",
    icon: Settings2,
    children: [
      { to: "/settings/service", label: "服务与 MCP", icon: Settings2 },
    ],
  },
];
