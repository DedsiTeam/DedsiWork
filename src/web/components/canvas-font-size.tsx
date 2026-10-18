import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

const sizes = [
  8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 56, 64, 72, 96, 120,
  144, 200,
];

export function CanvasFontSize({
  value,
  busy,
  onChange,
}: {
  value: number;
  busy: boolean;
  onChange: (size: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => setDraft(String(value)), [value]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [open]);
  useEffect(() => {
    if (open && active >= 0)
      list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);
  function show() {
    const rect = root.current?.getBoundingClientRect();
    setAbove(
      !!rect && window.innerHeight - rect.bottom < 220 && rect.top > 220,
    );
    setActive(sizes.indexOf(value));
    setOpen(true);
  }
  function choose(size: number) {
    setDraft(String(size));
    onChange(size);
    setOpen(false);
    input.current?.focus();
  }
  function commit() {
    const size = Number(draft);
    if (draft.trim() && Number.isFinite(size) && size >= 8 && size <= 200) {
      if (size !== value) onChange(size);
    } else setDraft(String(value));
  }
  return (
    <div ref={root} className="note-font-size-picker">
      <input
        ref={input}
        className="note-quick-size"
        type="text"
        inputMode="decimal"
        role="combobox"
        aria-label="字号"
        title="字号：选择或输入（8–200）"
        aria-expanded={open}
        aria-controls={id}
        aria-autocomplete="none"
        aria-activedescendant={
          open && active >= 0 ? id + "-" + active : undefined
        }
        value={draft}
        disabled={busy}
        onClick={() => {
          if (!open) show();
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          setActive(-1);
        }}
        onBlur={() => {
          commit();
          setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) show();
            else
              setActive((index) =>
                Math.max(
                  0,
                  Math.min(
                    sizes.length - 1,
                    index + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
              );
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (open && active >= 0) choose(sizes[active]!);
            else {
              commit();
              setOpen(false);
            }
          } else if (event.key === "Escape") {
            event.stopPropagation();
            setDraft(String(value));
            setOpen(false);
          }
        }}
      />
      <button
        type="button"
        className="note-font-size-toggle"
        aria-label="选择字号"
        title="选择字号"
        aria-expanded={open}
        aria-controls={id}
        disabled={busy}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (open) setOpen(false);
          else show();
        }}
      >
        <ChevronDown aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={list}
          id={id}
          role="listbox"
          aria-label="常用字号"
          className={"note-font-size-options" + (above ? " is-above" : "")}
        >
          {sizes.map((size, index) => (
            <button
              type="button"
              role="option"
              id={id + "-" + index}
              key={size}
              tabIndex={-1}
              aria-selected={size === value}
              data-active={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(size)}
            >
              {size}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
