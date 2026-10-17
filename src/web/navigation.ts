import {
  Columns3,
  LayoutList,
  Settings2,
  ListTodo,
  Boxes,
  StickyNote,
  CalendarDays,
  Code2,
  Globe,
} from "lucide-react";
export const navigation = [
  {
    id: "today",
    label: "今日工作台",
    icon: LayoutList,
    children: [{ to: "/today", label: "今日工作台", icon: LayoutList }],
  },
  {
    id: "library",
    label: "资料库",
    icon: Boxes,
    children: [{ to: "/library", label: "资料库", icon: Boxes }],
  },
  {
    id: "workflows",
    label: "工作流",
    icon: ListTodo,
    children: [{ to: "/workflows", label: "工作流", icon: ListTodo }],
  },
  {
    id: "bookmarks",
    label: "网址导航",
    icon: Globe,
    children: [{ to: "/bookmarks", label: "网址导航", icon: Globe }],
  },

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
    id: "development",
    label: "研发任务",
    icon: Code2,
    children: [{ to: "/development-tasks", label: "研发任务", icon: Code2 }],
  },
  {
    id: "notes",
    label: "无边记",
    icon: StickyNote,
    children: [{ to: "/notes", label: "无边记", icon: StickyNote }],
  },
  {
    id: "daily-reports",
    label: "日报管理",
    icon: CalendarDays,
    children: [{ to: "/daily-reports", label: "日报管理", icon: CalendarDays }],
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
