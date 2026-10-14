import { useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Reveal new replies; restored history is always displayed in full. */
export function TypewriterMarkdown({
  text,
  animate,
  onProgress,
  onComplete,
}: {
  text: string;
  animate: boolean;
  onProgress: () => void;
  onComplete: () => void;
}) {
  const characters = useMemo(() => Array.from(text), [text]);
  const [visible, setVisible] = useState(animate ? 0 : characters.length);
  useEffect(() => {
    if (!animate) return;
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !characters.length
    ) {
      onComplete();
      return;
    }
    setVisible(0);
    const duration = Math.min(10000, Math.max(300, characters.length * 22));
    let start: number | undefined;
    let lastFrame = 0;
    let frame = 0;
    function tick(now: number) {
      start ??= now;
      const count = Math.min(
        characters.length,
        Math.floor(((now - start) / duration) * characters.length),
      );
      if (now - lastFrame >= 32 || count === characters.length) {
        setVisible(count);
        lastFrame = now;
      }
      if (count === characters.length) onComplete();
      else frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate, characters, onComplete]);
  useEffect(() => {
    onProgress();
  }, [visible, onProgress]);
  const typing = animate && visible < characters.length;
  return (
    <div
      className={`agent-reply${typing ? " is-typing" : ""}`}
      aria-busy={typing}
    >
      <Markdown remarkPlugins={[remarkGfm]}>
        {animate ? characters.slice(0, visible).join("") : text}
      </Markdown>
    </div>
  );
}
