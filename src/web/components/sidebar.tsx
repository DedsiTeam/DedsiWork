import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { ChevronDown, ChevronRight } from "lucide-react";
import { navigation } from "../navigation";
import { useWorkspace } from "../workspace-context";
import brandLogo from "../assets/DedsiWork-black.svg";

export function Sidebar() {
  const { summary } = useWorkspace();
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <aside className="sidebar">
      <Link className="brand" to="/work-items" aria-label="DedsiWork 首页">
        <img className="brand-logo" src={brandLogo} alt="DedsiWork" />
      </Link>
      <nav className="module-navigation" aria-label="主导航">
        {navigation.map((group) => (
          <section className="navigation-group" key={group.id}>
            <button
              className="module-toggle"
              aria-expanded={!collapsed[group.id]}
              aria-controls={`nav-${group.id}`}
              onClick={() =>
                setCollapsed((previous) => ({
                  ...previous,
                  [group.id]: !previous[group.id],
                }))
              }
            >
              <group.icon size={18} />
              <span>{group.label}</span>
              {collapsed[group.id] ? (
                <ChevronRight size={14} />
              ) : (
                <ChevronDown size={14} />
              )}
            </button>
            <div
              id={`nav-${group.id}`}
              className="module-links"
              hidden={collapsed[group.id]}
            >
              {group.children.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end
                  className={({ isActive }) =>
                    `nav-item ${isActive || (item.to === "/work-items" && /^\/work-items\/(new|[0-9a-f-]{36})$/.test(pathname)) ? "active" : ""}`
                  }
                >
                  <item.icon size={16} />
                  {item.label}
                  {"count" in item && item.count && (
                    <span>{summary[item.count]}</span>
                  )}
                </NavLink>
              ))}
            </div>
          </section>
        ))}
      </nav>
    </aside>
  );
}
