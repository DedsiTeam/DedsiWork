import { NavLink, useLocation } from "react-router";
import { MessageSquare } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { navigation } from "../navigation";

const items = [
  { to: "/assistant", label: "AI 助手", icon: MessageSquare },
  ...navigation
    .filter((group) => group.id !== "system")
    .flatMap((group) => group.children),
];
const settings = navigation.find((group) => group.id === "system")!
  .children[0]!;

export function Sidebar() {
  const location = useLocation();
  const prefix = /^\/workspace\/[^/]+/.exec(location.pathname)?.[0] || "";
  const pathname = location.pathname.slice(prefix.length);
  const rail = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<{
    x: number;
    y: number;
    size: number;
  } | null>(null);

  useLayoutEffect(() => {
    const element = rail.current;
    if (!element) return;
    const update = () => {
      const icon = element.querySelector<HTMLElement>(
        ".nav-item.active .nav-item-icon",
      );
      if (!icon) {
        setIndicator(null);
        return;
      }
      const bounds = element.getBoundingClientRect();
      const target = icon.getBoundingClientRect();
      const size = icon.offsetWidth + 4;
      const next = {
        x: target.left - bounds.left + target.width / 2 - size / 2,
        y: target.top - bounds.top + target.height / 2 - size / 2,
        size,
      };
      setIndicator((previous) =>
        previous?.x === next.x &&
        previous.y === next.y &&
        previous.size === next.size
          ? previous
          : next,
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of element.children) {
      if (child.matches("nav, .sidebar-footer")) observer.observe(child);
    }
    element.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update, true);
    };
  }, [pathname]);
  function renderItem(item: (typeof items)[number]) {
    const nested =
      (item.to === "/work-items" &&
        pathname.startsWith("/work-items/") &&
        !pathname.startsWith("/work-items/sprints")) ||
      ([
        "/domain-models",
        "/development-tasks",
        "/notes",
        "/work-items/sprints",
      ].includes(item.to) &&
        pathname.startsWith(`${item.to}/`));
    return (
      <NavLink
        key={item.to}
        to={prefix + item.to}
        end={item.to !== "/assistant"}
        title={item.label}
        className={({ isActive }) =>
          `nav-item${isActive || nested ? " active" : ""}`
        }
      >
        <span className="nav-item-icon">
          <item.icon size={18} aria-hidden="true" />
        </span>
        <span className="nav-item-label">{item.label}</span>
      </NavLink>
    );
  }
  return (
    <aside className="sidebar sidebar-floating" ref={rail}>
      {indicator && (
        <div
          className="sidebar-selection"
          aria-hidden="true"
          style={{
            width: indicator.size,
            height: indicator.size,
            transform: `translate3d(${indicator.x}px, ${indicator.y}px, 0)`,
          }}
        />
      )}
      <nav
        id="sidebar-navigation"
        className="module-navigation"
        aria-label="主导航"
      >
        {items.map(renderItem)}
      </nav>
      <div className="sidebar-footer">{renderItem(settings)}</div>
    </aside>
  );
}
