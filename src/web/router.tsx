import { DailyReportPage } from "./pages/daily-reports";
import { DailyReportsPage } from "./pages/daily-report-list";
import { NotesPage } from "./pages/notes";
import { NotePage } from "./pages/note";
import { WorkspacesPage } from "./pages/workspaces";
import { createBrowserRouter, Link, Navigate } from "react-router";
import { App } from "./App";
import { WorkItemsPage } from "./pages/work-items";
import { WorkItemPage } from "./pages/work-item";
import { ServiceInfo } from "./pages/service-info";
import { DomainModelsPage } from "./pages/domain-models";
import { DomainModelPage } from "./pages/domain-model";
import { DomainModelDiagramPage } from "./pages/domain-model-diagram";
import { AssistantPage } from "./pages/assistant";
import { SprintsPage } from "./pages/sprints";
import {
  DevelopmentTasksPage,
  DevelopmentTaskPage,
  DevelopmentTaskCreatePage,
} from "./pages/development-tasks";
export const router = createBrowserRouter([
  {
    path: "/",
    Component: App,
    children: [
      {
        path: "development-tasks",
        Component: DevelopmentTasksPage,
        handle: { title: "研发任务" },
      },
      {
        path: "development-tasks/new",
        Component: DevelopmentTaskCreatePage,
        handle: { title: "新建研发任务" },
      },
      {
        path: "development-tasks/:id",
        Component: DevelopmentTaskPage,
        handle: { title: "研发任务" },
      },
      {
        path: "daily-reports",
        Component: DailyReportsPage,
        handle: { title: "日报管理" },
      },
      {
        path: "daily-reports/new",
        Component: DailyReportPage,
        handle: { title: "新增日报" },
      },
      {
        path: "daily-reports/:id",
        Component: DailyReportPage,
        handle: { title: "修改日报" },
      },
      { path: "notes", Component: NotesPage, handle: { title: "无边记" } },
      {
        path: "notes/new",
        element: <NotePage key="new-note" />,
        handle: { title: "新建无边记" },
      },
      { path: "notes/:id", Component: NotePage, handle: { title: "无边记" } },
      {
        path: "work-items/sprints",
        Component: SprintsPage,
        handle: { title: "冲刺看板" },
      },
      { index: true, element: <Navigate to="/workspaces" replace /> },
      {
        path: "workspaces",
        Component: WorkspacesPage,
        handle: { title: "工作空间" },
      },
      {
        path: "assistant",
        Component: AssistantPage,
        handle: { title: "AI 助手" },
      },
      { path: "chat", element: <Navigate to="/assistant?mode=chat" replace /> },
      {
        path: "work-items",
        element: <WorkItemsPage key="all" />,
        handle: { title: "全部工作项" },
      },
      {
        path: "work-items/in-progress",
        element: <WorkItemsPage key="progress" initialStatus="in_progress" />,
        handle: { title: "进行中" },
      },
      {
        path: "work-items/completed",
        element: <WorkItemsPage key="completed" initialStatus="done" />,
        handle: { title: "已完成" },
      },
      {
        path: "work-items/trash",
        element: <WorkItemsPage key="trash" view="trash" />,
        handle: { title: "回收站" },
      },
      {
        path: "work-items/new",
        element: <WorkItemPage key="new" />,
        handle: { title: "创建工作项" },
      },
      {
        path: "work-items/ai",
        element: <Navigate to="/assistant" replace />,
      },
      {
        path: "work-items/:id",
        Component: WorkItemPage,
        handle: { title: "修改工作项" },
      },
      {
        path: "domain-models",
        Component: DomainModelsPage,
        handle: { title: "领域模型" },
      },
      {
        path: "domain-models/new",
        element: <DomainModelPage key="new-domain-model" />,
        handle: { title: "新建领域模型" },
      },
      {
        path: "domain-models/ai",
        element: <Navigate to="/assistant" replace />,
      },
      {
        path: "domain-models/:id/diagram",
        Component: DomainModelDiagramPage,
        handle: { title: "领域模型一张图" },
      },
      {
        path: "domain-models/:id",
        Component: DomainModelPage,
        handle: { title: "编辑领域模型" },
      },
      {
        path: "settings/service",
        Component: ServiceInfo,
        handle: { title: "服务与 MCP" },
      },
      {
        path: "*",
        element: (
          <div className="workspace-content">
            <h1>页面不存在</h1>
            <p>请检查地址，或从左侧菜单选择功能。</p>
            <Link to="/work-items">返回工作项列表</Link>
          </div>
        ),
        handle: { title: "页面不存在" },
      },
    ],
  },
]);
