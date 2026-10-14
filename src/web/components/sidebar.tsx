import { useState } from "react";
import { NavLink, useLocation } from "react-router";
import { ChevronLeft, ChevronRight, MessageSquare } from "lucide-react";
import { navigation } from "../navigation";
import { useWorkspace } from "../workspace-context";
import { useWindowDrag } from "./window-drag";

export function Sidebar() {
  const windowDrag = useWindowDrag();
  const { summary } = useWorkspace();
  const { pathname } = useLocation();
  const [minimized, setMinimized] = useState(() => {
    try {
      return localStorage.getItem("dedsiwork:sidebar-minimized") === "true";
    } catch {
      return false;
    }
  });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("dedsiwork:sidebar-groups") || "null",
      );
      const expanded = navigation.filter(
        (group) => saved?.[group.id] === false,
      );
      const openGroup =
        expanded.find((group) =>
          group.children.some(
            (item) =>
              pathname === item.to || pathname.startsWith(`${item.to}/`),
          ),
        ) || expanded[0];
      return Object.fromEntries(
        navigation.map((group) => [group.id, group.id !== openGroup?.id]),
      );
    } catch {
      return Object.fromEntries(navigation.map((group) => [group.id, true]));
    }
  });
  return (
    <aside className={`sidebar${minimized ? " sidebar-minimized" : ""}`}>
      <div className="sidebar-header" {...windowDrag}>
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={minimized ? "展开左侧菜单" : "折叠左侧菜单"}
          title={minimized ? "展开左侧菜单" : "折叠左侧菜单"}
          aria-expanded={!minimized}
          aria-controls="sidebar-navigation"
          onClick={() =>
            setMinimized((previous) => {
              const value = !previous;
              try {
                localStorage.setItem(
                  "dedsiwork:sidebar-minimized",
                  String(value),
                );
              } catch {}
              return value;
            })
          }
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <ChevronLeft size={18} strokeWidth={1.5} />
        </button>
      </div>
      <nav
        id="sidebar-navigation"
        className="module-navigation"
        aria-label="主导航"
      >
        <NavLink
          to="/assistant"
          className={({ isActive }) =>
            `nav-item sidebar-chat${isActive ? " active" : ""}`
          }
          title={minimized ? "AI 助手" : undefined}
          aria-label="AI 助手"
        >
          <MessageSquare size={16} />
          <span className="nav-item-label">AI 助手</span>
        </NavLink>
        {navigation.map((group) => (
          <section className="navigation-group" key={group.id}>
            <div
              className="module-heading"
              inert={minimized}
              aria-hidden={minimized}
            >
              <div className="module-heading-clip">
                <button
                  className="module-toggle"
                  aria-expanded={!collapsed[group.id]}
                  aria-controls={`nav-${group.id}`}
                  onClick={() =>
                    setCollapsed((previous) => {
                      const value = Object.fromEntries(
                        navigation.map((item) => [
                          item.id,
                          item.id === group.id ? !previous[group.id] : true,
                        ]),
                      );
                      try {
                        localStorage.setItem(
                          "dedsiwork:sidebar-groups",
                          JSON.stringify(value),
                        );
                      } catch {}
                      return value;
                    })
                  }
                >
                  <group.icon size={18} />
                  <span>{group.label}</span>
                  <ChevronRight className="module-chevron" size={14} />
                </button>
              </div>
            </div>
            <div
              id={`nav-${group.id}`}
              className={`module-children${minimized || !collapsed[group.id] ? " is-open" : ""}`}
              inert={!minimized && collapsed[group.id]}
              aria-hidden={!minimized && collapsed[group.id]}
            >
              <div className="module-children-clip">
                <div className="module-links">
                  {group.children.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end
                      aria-label={item.label}
                      title={minimized ? item.label : undefined}
                      className={({ isActive }) =>
                        `nav-item ${isActive || (item.to === "/work-items" && /^\/work-items\/(new|[0-9a-f-]{36})$/.test(pathname)) || (item.to === "/domain-models" && pathname.startsWith("/domain-models/")) ? "active" : ""}`
                      }
                    >
                      <item.icon size={16} />
                      <span className="nav-item-label">{item.label}</span>
                      {"count" in item && item.count && (
                        <span>{summary[item.count]}</span>
                      )}
                    </NavLink>
                  ))}
                </div>
              </div>
            </div>
          </section>
        ))}
      </nav>
    </aside>
  );
}
