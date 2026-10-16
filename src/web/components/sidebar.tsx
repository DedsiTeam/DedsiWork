import { NavLink, useLocation } from "react-router";
import { MessageSquare } from "lucide-react";
import { navigation } from "../navigation";
import { useWindowDrag } from "./window-drag";
import { version } from "../../package.json";

export function Sidebar() {
  const windowDrag = useWindowDrag();
  const { pathname } = useLocation();
  return (
    <aside className="sidebar sidebar-minimized">
      <div className="sidebar-header" {...windowDrag} />
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
          title="AI 助手"
          aria-label="AI 助手"
        >
          <MessageSquare size={16} />
        </NavLink>
        {navigation.map((group) => (
          <section
            className="navigation-group"
            key={group.id}
            aria-label={group.label}
          >
            <div className="module-children is-open">
              <div className="module-children-clip">
                <div className="module-links">
                  {group.children.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end
                      aria-label={item.label}
                      title={item.label}
                      className={({ isActive }) =>
                        `nav-item ${isActive || (item.to === "/work-items" && pathname.startsWith("/work-items/") && !pathname.startsWith("/work-items/sprints")) || (item.to === "/domain-models" && pathname.startsWith("/domain-models/")) || (item.to === "/development-tasks" && pathname.startsWith("/development-tasks/")) || (item.to === "/notes" && pathname.startsWith("/notes/")) ? "active" : ""}`
                      }
                    >
                      <item.icon size={16} />
                    </NavLink>
                  ))}
                </div>
              </div>
            </div>
          </section>
        ))}
      </nav>
      <div className="sidebar-version">{version}</div>
    </aside>
  );
}
