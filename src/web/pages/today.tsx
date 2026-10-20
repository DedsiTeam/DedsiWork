import { useCallback, useEffect, useState, useRef } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/empty-state";
import { localDate } from "../components/personal-actions";
import { PAGE_SIZE } from "../../shared/pagination";
import type {
  PersonalOverview,
  WorkCard,
  FocusEntry,
} from "../../shared/personal-work";
import { developmentStatusLabels } from "../../shared/development-task";
import { statusLabels } from "../../shared/work-item";
import {
  CalendarCheck,
  Clock3,
  Inbox,
  Bot,
  PackageCheck,
  type LucideIcon,
} from "lucide-react";
import "../personal-work.css";
function SectionHeading({
  title,
  count,
  icon: Icon,
}: {
  title: string;
  count: number;
  icon: LucideIcon;
}) {
  return (
    <header className="today-section-heading">
      <Icon size={18} aria-hidden="true" />
      <h2>{title}</h2>
      <span>{count}</span>
    </header>
  );
}
function Cards({
  title,
  items,
  kind,
}: {
  title: string;
  items: WorkCard[];
  kind: "attention" | "running" | "delivered";
}) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE)),
    current = Math.min(page, pages);
  return (
    <section className={`personal-section today-panel today-panel-${kind}`}>
      <SectionHeading
        title={title}
        count={items.length}
        icon={
          kind === "attention" ? Inbox : kind === "running" ? Bot : PackageCheck
        }
      />
      {!items.length ? (
        <EmptyState
          compact
          icon={
            kind === "attention"
              ? Inbox
              : kind === "running"
                ? Bot
                : PackageCheck
          }
          title={
            kind === "attention"
              ? "暂无待处理事项"
              : kind === "running"
                ? "暂无进行中的研发"
                : "暂无交付记录"
          }
          description={
            kind === "attention"
              ? "需要你确认或补充信息时，会显示在这里。"
              : kind === "running"
                ? "AI 开始执行后，可在这里查看进展。"
                : "研发交付后，可在这里查看结果和验收状态。"
          }
        />
      ) : (
        items.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE).map((t) => (
          <div className="personal-row" key={t.id}>
            <div>
              <Link to={t.href}>{t.title}</Link>
              <div className="today-row-meta">
                <span className="today-status">
                  {t.href.startsWith("/assistant") && t.status === "running"
                    ? "处理中"
                    : developmentStatusLabels[
                        t.status as keyof typeof developmentStatusLabels
                      ] || t.status}
                </span>
              </div>
              {t.detail && (
                <p className="today-row-detail" title={t.detail}>
                  {t.detail}
                </p>
              )}
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to={t.href}>
                {t.status === "completed"
                  ? "查看详情"
                  : t.status === "review"
                    ? "去验收"
                    : kind === "running"
                      ? "查看进度"
                      : "去处理"}
              </Link>
            </Button>
          </div>
        ))
      )}
      {pages > 1 && (
        <div className="personal-pagination">
          <Button
            variant="ghost"
            size="sm"
            disabled={current === 1}
            onClick={() => setPage(current - 1)}
          >
            上一页
          </Button>
          {current}/{pages}
          <Button
            variant="ghost"
            size="sm"
            disabled={current === pages}
            onClick={() => setPage(current + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </section>
  );
}
export function TodayPage() {
  const [data, setData] = useState<PersonalOverview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState("");
  const loadSequence = useRef(0);
  const load = useCallback(async (signal?: AbortSignal) => {
    const sequence = ++loadSequence.current;
    try {
      const r = await api<{ data: PersonalOverview }>(
        "/api/v1/personal/overview",
        { signal },
      );
      if (!signal?.aborted && sequence === loadSequence.current) {
        setData(r.data);
        setError("");
      }
    } catch (e) {
      if (!signal?.aborted && sequence === loadSequence.current)
        setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const c = new AbortController();
    void load(c.signal);
    const timer = setInterval(() => {
      if (!document.hidden) void load(c.signal);
    }, 5000);
    const focus = () => void load(c.signal);
    window.addEventListener("focus", focus);
    return () => {
      loadSequence.current++;
      c.abort();
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [load]);
  async function move(f: FocusEntry, bucket: string) {
    if (busy) return;
    setBusy(f.id);
    try {
      await api("/api/v1/personal/focus", {
        method: "PUT",
        body: JSON.stringify({
          itemId: f.id,
          bucket,
          date: localDate(),
          expectedVersion: f.version,
        }),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const today =
      data?.focus.filter(
        (f) => f.bucket === "today" && f.date === localDate(),
      ) || [],
    later =
      data?.focus.filter(
        (f) => f.bucket === "later" || f.date !== localDate(),
      ) || [];
  const [focusPage, setFocusPage] = useState(1),
    [laterPage, setLaterPage] = useState(1);
  function focusList(
    title: string,
    items: FocusEntry[],
    page: number,
    setPage: (p: number) => void,
  ) {
    const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE)),
      current = Math.min(page, pages);
    return (
      <section
        className={`personal-section today-panel today-panel-${title === "今日重点" ? "focus" : "later"}`}
      >
        <SectionHeading
          title={title}
          count={items.length}
          icon={title === "今日重点" ? CalendarCheck : Clock3}
        />
        {!items.length ? (
          <EmptyState
            compact
            icon={title === "今日重点" ? CalendarCheck : Clock3}
            title="还没有安排"
            description="从工作项详情选择今日重点或稍后处理。"
          />
        ) : (
          items
            .slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)
            .map((f) => (
              <div className="personal-row" key={f.id}>
                <div>
                  <Link to={`/work-items/${f.id}`}>{f.title}</Link>
                  <p>
                    {statusLabels[f.status as keyof typeof statusLabels]}
                    {f.bucket === "today" && f.date !== localDate()
                      ? ` · ${f.date} 未完成计划`
                      : ""}
                  </p>
                </div>
                <div className="personal-actions">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!busy}
                    onClick={() =>
                      void move(f, title === "今日重点" ? "later" : "today")
                    }
                  >
                    {title === "今日重点" ? "稍后处理" : "今天做"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!!busy}
                    onClick={() => void move(f, "none")}
                  >
                    移出
                  </Button>
                </div>
              </div>
            ))
        )}
        {pages > 1 && (
          <div className="personal-pagination">
            <Button
              variant="ghost"
              size="sm"
              disabled={current === 1}
              onClick={() => setPage(current - 1)}
            >
              上一页
            </Button>
            {current}/{pages}
            <Button
              variant="ghost"
              size="sm"
              disabled={current === pages}
              onClick={() => setPage(current + 1)}
            >
              下一页
            </Button>
          </div>
        )}
      </section>
    );
  }
  return (
    <div className="workspace-content today-page">
      <header className="personal-heading page-heading">
        <div>
          <h1>今日工作台</h1>
        </div>
        <div className="personal-actions">
          <Button asChild variant="outline">
            <Link to="/library">查找资料</Link>
          </Button>
          <Button asChild>
            <Link to="/work-items">安排工作</Link>
          </Button>
        </div>
      </header>
      {error && <p role="alert">{error}</p>}
      {!data ? (
        <p role="status">正在整理工作进展…</p>
      ) : (
        <div className="personal-grid today-grid">
          {focusList("今日重点", today, focusPage, setFocusPage)}
          {focusList("稍后与未完成计划", later, laterPage, setLaterPage)}
          <Cards title="等我处理" items={data.attention} kind="attention" />
          <Cards title="AI 正在做" items={data.running} kind="running" />
          <Cards title="最近交付" items={data.delivered} kind="delivered" />
        </div>
      )}
    </div>
  );
}
