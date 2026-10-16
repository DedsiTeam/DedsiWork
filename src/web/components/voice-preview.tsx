import { VoiceOrb } from "./voice-orb";
import { useState } from "react";
import { ArrowLeft, Mic, Volume2 } from "lucide-react";
import "../voice-preview.css";

const states = [
  {
    id: "idle",
    label: "待机",
    title: "从一句话开始",
    subtitle: "把想法说出来，让工作自然发生。",
  },
  {
    id: "listening",
    label: "聆听",
    title: "倾听你的想法",
    subtitle: "语音输入时，球体将随你的声音轻轻起伏。",
  },
  {
    id: "thinking",
    label: "思考",
    title: "让想法逐渐清晰",
    subtitle: "整理上下文，寻找下一步。",
  },
  {
    id: "speaking",
    label: "回答",
    title: "回应每一个想法",
    subtitle: "回答时，光影将跟随语音流动。",
  },
] as const;

export function VoicePreview({ onReturn }: { onReturn: () => void }) {
  const [state, setState] = useState<(typeof states)[number]>(states[0]);
  return (
    <section
      className="agent-voice"
      aria-label="语音风格预览"
      data-state={state.id}
    >
      <div className="voice-preview-label">
        <span /> 语音界面预览
      </div>
      <div className="voice-stage">
        <div className="voice-orb-scene" aria-hidden="true">
          <VoiceOrb state={state.id} />
        </div>
        <div className="voice-caption" aria-live="polite">
          <h2>{state.title}</h2>
          <p>{state.subtitle}</p>
        </div>
        <div
          className="voice-state-picker"
          role="group"
          aria-label="预览动画状态"
        >
          {states.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-pressed={state.id === item.id}
              onClick={() => setState(item)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="voice-footer">
        <div className="voice-controls">
          <button
            type="button"
            onClick={onReturn}
            aria-label="返回文字对话"
            title="返回文字对话"
          >
            <ArrowLeft size={19} />
          </button>
          <button
            type="button"
            className="voice-mic"
            disabled
            aria-label="麦克风尚未接入"
            title="麦克风尚未接入"
          >
            <Mic size={25} />
          </button>
          <button
            type="button"
            disabled
            aria-label="语音播报尚未接入"
            title="语音播报尚未接入"
          >
            <Volume2 size={19} />
          </button>
        </div>
        <p>仅展示界面与动效 · 尚未接入录音和语音回答</p>
      </div>
    </section>
  );
}
