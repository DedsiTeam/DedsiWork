import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import "../date-picker.css";
const iso = (date: Date) => date.toISOString().slice(0, 10);
const parse = (value: string) => new Date(`${value}T00:00:00Z`);
function chinaToday() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) =>
    parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function DatePicker({
  value,
  onChange,
  min,
  max,
  disabled = false,
  label,
  id,
  withTime = false,
  clearable = false,
}: {
  value: string;
  onChange: (date: string) => void;
  min?: string;
  max?: string;
  disabled?: boolean;
  label: string;
  id?: string;
  withTime?: boolean;
  clearable?: boolean;
}) {
  const dateValue = value.slice(0, 10);
  const timeValue = value.slice(11, 16) || "09:00";
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => parse(dateValue || chinaToday()));
  const [focused, setFocused] = useState(dateValue || chinaToday());
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const needsFocus = useRef(false);
  const today = chinaToday();
  const allowed = (date: string) =>
    (!min || date >= min) && (!max || date <= max);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  function select(date: string) {
    if (!allowed(date)) return;
    onChange(withTime ? `${date}T${timeValue}` : date);
    if (withTime) {
      setMonth(parse(date));
      setFocused(date);
    } else close();
  }
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (open && needsFocus.current) {
      root.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${focused}"]`)
        ?.focus();
      needsFocus.current = false;
    }
  }, [open, focused, month]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  const first = new Date(
    Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1),
  );
  const gridStart = new Date(first);
  gridStart.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setUTCDate(date.getUTCDate() + index);
    return date;
  });
  function changeMonth(offset: number, button: HTMLButtonElement) {
    // Keep Radix's modal focus scope on a stable control while day cells change.
    button.focus({ preventScroll: true });
    needsFocus.current = false;
    const next = new Date(
      Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + offset, 1),
    );
    setMonth(next);
    const first = iso(next);
    setFocused(min && first < min ? min : first);
  }
  return (
    <div
      ref={root}
      className="date-picker"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <button
        ref={trigger}
        id={id}
        type="button"
        className={`date-picker-trigger${open ? " is-open" : ""}`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          const initial = dateValue || today;
          setMonth(parse(initial));
          setFocused(initial);
          needsFocus.current = true;
          setOpen(true);
        }}
      >
        <span>
          {dateValue
            ? `${dateValue.replaceAll("-", " / ")}${withTime ? "  " + timeValue : ""}`
            : withTime
              ? "选择日期和时间"
              : "选择日期"}
        </span>
        <CalendarDays size={15} />
      </button>
      {open && (
        <div
          className="date-picker-popover"
          role="dialog"
          aria-label={`选择${label}`}
        >
          <div className="date-picker-heading">
            <strong>
              {month.getUTCFullYear()} 年 {month.getUTCMonth() + 1} 月
            </strong>
            <div>
              <button
                type="button"
                aria-label="上个月"
                onClick={(event) => changeMonth(-1, event.currentTarget)}
              >
                <ChevronLeft size={15} />
              </button>
              <button
                type="button"
                aria-label="下个月"
                onClick={(event) => changeMonth(1, event.currentTarget)}
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
          <div className="date-picker-weekdays">
            {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="date-picker-days" role="grid" aria-label="日期">
            {days.map((date) => {
              const key = iso(date);
              return (
                <button
                  type="button"
                  key={key}
                  data-date={key}
                  role="gridcell"
                  aria-label={key}
                  aria-selected={key === dateValue}
                  aria-current={key === today ? "date" : undefined}
                  tabIndex={key === focused ? 0 : -1}
                  disabled={!allowed(key)}
                  className={`${date.getUTCMonth() !== month.getUTCMonth() ? "other-month " : ""}${key === dateValue ? "selected " : ""}${key === today ? "today" : ""}`}
                  onClick={() => select(key)}
                  onFocus={() => setFocused(key)}
                  onKeyDown={(event) => {
                    const offsets: Record<string, number> = {
                      ArrowLeft: -1,
                      ArrowRight: 1,
                      ArrowUp: -7,
                      ArrowDown: 7,
                    };
                    if (event.key in offsets) {
                      event.preventDefault();
                      const next = new Date(date);
                      next.setUTCDate(next.getUTCDate() + offsets[event.key]!);
                      const nextKey = iso(next);
                      if (allowed(nextKey)) {
                        needsFocus.current = true;
                        setFocused(nextKey);
                        if (
                          next.getUTCMonth() !== month.getUTCMonth() ||
                          next.getUTCFullYear() !== month.getUTCFullYear()
                        )
                          setMonth(next);
                      }
                    }
                  }}
                >
                  {date.getUTCDate()}
                </button>
              );
            })}
          </div>
          {withTime && (
            <div className="date-picker-time">
              <span>时间</span>
              <div>
                <select
                  aria-label="小时"
                  value={timeValue.slice(0, 2)}
                  onChange={(event) =>
                    onChange(
                      `${dateValue || today}T${event.target.value}:${timeValue.slice(3, 5)}`,
                    )
                  }
                >
                  {Array.from({ length: 24 }, (_, hour) =>
                    String(hour).padStart(2, "0"),
                  ).map((hour) => (
                    <option key={hour} value={hour}>
                      {hour}
                    </option>
                  ))}
                </select>
                <span>:</span>
                <select
                  aria-label="分钟"
                  value={timeValue.slice(3, 5)}
                  onChange={(event) =>
                    onChange(
                      `${dateValue || today}T${timeValue.slice(0, 2)}:${event.target.value}`,
                    )
                  }
                >
                  {Array.from({ length: 60 }, (_, minute) =>
                    String(minute).padStart(2, "0"),
                  ).map((minute) => (
                    <option key={minute} value={minute}>
                      {minute}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <div className="date-picker-footer">
            <span>
              {dateValue ? dateValue.replaceAll("-", "/") : "尚未选择日期"}
            </span>
            <div>
              {clearable && (
                <button
                  type="button"
                  disabled={!value}
                  onClick={() => {
                    onChange("");
                    close();
                  }}
                >
                  清空
                </button>
              )}
              <button
                type="button"
                disabled={!allowed(today)}
                onClick={() => select(today)}
              >
                今天
              </button>
              {withTime && (
                <button
                  type="button"
                  className="date-picker-done"
                  onClick={close}
                >
                  完成
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
