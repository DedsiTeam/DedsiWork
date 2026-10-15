import {
  Columns3,
  LayoutList,
  Settings2,
  ListTodo,
  Boxes,
  StickyNote,
} from "lucide-react";
export const navigation = [
  {
    id: "work",
    label: "工作项",
    icon: ListTodo,
    children: [
      { to: "/work-items", label: "工作项", icon: LayoutList },
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
    id: "notes",
    label: "无边记",
    icon: StickyNote,
    children: [{ to: "/notes", label: "无边记", icon: StickyNote }],
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
