import { useEffect, useRef } from "react";

// Decorative preview only: no microphone or audio processing.
export function VoiceOrb({ state }: { state: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const currentState = useRef(state);
  currentState.current = state;
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const output = element.getContext("2d");
    const surface = document.createElement("canvas");
    const mask = document.createElement("canvas");
    const ctx = surface.getContext("2d");
    const maskContext = mask.getContext("2d");
    if (!ctx || !output || !maskContext) return;
    const size = 320;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    element.width = size * dpr;
    element.height = size * dpr;
    surface.width = mask.width = size * dpr;
    surface.height = mask.height = size * dpr;
    ctx.scale(dpr, dpr);
    output.scale(dpr, dpr);
    maskContext.scale(dpr, dpr);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let time = 0;
    let previous = 0;
    let energy = 0.3;
    const colors = [
      "72,229,255",
      "125,144,255",
      "211,126,255",
      "255,137,207",
      "111,255,226",
    ];
    const draw = (now: number) => {
      const elapsed = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
      previous = now;
      const mode = currentState.current;
      const target =
        mode === "speaking"
          ? 0.85
          : mode === "listening"
            ? 0.65
            : mode === "thinking"
              ? 1
              : 0.3;
      energy += (target - energy) * 0.05;
      if (!reduced.matches) time += elapsed * (0.45 + energy * 0.8);
      ctx.clearRect(0, 0, size, size);
      ctx.globalCompositeOperation = "source-over";
      // Soft peripheral glow, with no hard outer stroke.
      const halo = ctx.createRadialGradient(160, 160, 75, 160, 160, 152);
      halo.addColorStop(0, "#967bff20");
      halo.addColorStop(0.65, "#a18bff12");
      halo.addColorStop(1, "#a18bff00");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, size, size);
      ctx.save();
      ctx.translate(160, 156);
      const pulse = 1 + Math.sin(time * 2) * 0.018 * energy;
      ctx.scale(pulse, pulse);

      const base = ctx.createRadialGradient(-25, -35, 5, 0, 0, 112);
      base.addColorStop(0, "#b3afd1");
      base.addColorStop(0.65, "#827ca9");
      base.addColorStop(1, "#b8bedb");
      ctx.fillStyle = base;
      ctx.fillRect(-160, -160, 320, 320);
      ctx.globalCompositeOperation = "screen";
      // Orbiting diffuse light gives the waves depth and changing colour.
      colors.forEach((color, i) => {
        const angle = time * 0.65 + (i * Math.PI * 2) / colors.length;
        const x = Math.cos(angle) * 74;
        const y = Math.sin(angle * 1.2 + i) * 66;
        const light = ctx.createRadialGradient(x, y, 0, x, y, 102);
        light.addColorStop(0, `rgba(${color},0.72)`);
        light.addColorStop(0.5, `rgba(${color},0.22)`);
        light.addColorStop(1, `rgba(${color},0)`);
        ctx.fillStyle = light;
        ctx.fillRect(-160, -160, 320, 320);
      });
      for (let layer = 0; layer < 5; layer++) {
        const color = colors[layer];
        for (let strand = 0; strand < 14; strand++) {
          ctx.beginPath();
          for (let step = 0; step <= 100; step++) {
            const x = -108 + (step * 216) / 100;
            const envelope = Math.pow(Math.max(0, 1 - (x / 108) ** 2), 0.65);
            const phase = x / 47 + time * (layer % 2 ? 1 : -1) + layer * 1.3;
            const y =
              envelope *
              (Math.sin(phase) * (25 + energy * 15) +
                Math.cos(x / 72 - time + layer) * 23 +
                (strand - 6.5) * 3.2);
            if (step === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = `rgba(${color},${0.1 + Math.sin((strand / 14) * Math.PI) * 0.24})`;
          ctx.lineWidth = 1.4;
          ctx.shadowColor = `rgb(${color})`;
          ctx.shadowBlur = 11;
          ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;
      const sheen = ctx.createRadialGradient(-30, -76, 0, -22, -65, 90);
      sheen.addColorStop(0, "#ffffff50");
      sheen.addColorStop(1, "#ffffff00");
      ctx.fillStyle = sheen;
      ctx.fillRect(-160, -160, 320, 320);
      ctx.restore();
      // Concentric feathering keeps the silhouette circular without a hard edge.
      maskContext.clearRect(0, 0, size, size);
      maskContext.save();
      maskContext.translate(160, 156);
      maskContext.scale(pulse, pulse);
      for (let feather = 0; feather < 28; feather++) {
        maskContext.beginPath();
        for (let i = 0; i <= 160; i++) {
          const angle = (i / 160) * Math.PI * 2;
          const radius = 110 - feather * 0.75;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          if (i === 0) maskContext.moveTo(x, y);
          else maskContext.lineTo(x, y);
        }
        maskContext.closePath();
        maskContext.fillStyle = "rgba(255,255,255,0.15)";
        maskContext.fill();
      }
      maskContext.restore();
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(mask, 0, 0, size, size);
      output.clearRect(0, 0, size, size);
      output.save();
      output.shadowColor = "#9582d9";
      output.shadowBlur = 24;
      output.globalAlpha = 0.18;
      output.drawImage(surface, 0, 0, size, size);
      output.restore();
      output.drawImage(surface, 0, 0, size, size);
      if (!document.hidden && !reduced.matches)
        frame = requestAnimationFrame(draw);
    };
    const resume = () => {
      cancelAnimationFrame(frame);
      previous = 0;
      if (!document.hidden) frame = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", resume);
    reduced.addEventListener("change", resume);
    resume();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", resume);
      reduced.removeEventListener("change", resume);
    };
  }, []);
  return (
    <canvas ref={canvas} className="voice-orb-canvas" aria-hidden="true" />
  );
}
