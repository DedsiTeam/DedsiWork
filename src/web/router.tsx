import { createBrowserRouter, Link, Navigate } from "react-router";
import { App } from "./App";
import { WorkItemsPage } from "./pages/work-items";
import { WorkItemPage } from "./pages/work-item";
import { ServiceInfo } from "./pages/service-info";
export const router = createBrowserRouter([
  {
    path: "/",
    Component: App,
    children: [
      { index: true, element: <Navigate to="/work-items" replace /> },
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
        path: "work-items/:id",
        Component: WorkItemPage,
        handle: { title: "修改工作项" },
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
