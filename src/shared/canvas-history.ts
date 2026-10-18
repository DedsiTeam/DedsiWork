import type { CanvasContent } from "./canvas-note";

/** Bounded document history; viewport and current selection are not edits. */
export class CanvasHistory {
  private states: string[];
  private position = 0;
  constructor(
    initial: CanvasContent,
    private limit = 50,
    private byteLimit = 32 * 1024 * 1024,
  ) {
    this.states = [JSON.stringify(initial)];
  }
  record(content: CanvasContent) {
    const state = JSON.stringify(content);
    if (state === this.states[this.position]) return;
    this.states.splice(this.position + 1);
    this.states.push(state);
    let bytes = this.states.reduce(
      (total, value) => total + value.length * 2,
      0,
    );
    while (
      this.states.length > 2 &&
      (this.states.length > this.limit + 1 || bytes > this.byteLimit)
    )
      bytes -= this.states.shift()!.length * 2;
    this.position = this.states.length - 1;
  }
  undo(): CanvasContent | null {
    if (!this.position) return null;
    return JSON.parse(this.states[--this.position]!);
  }
  redo(): CanvasContent | null {
    if (this.position >= this.states.length - 1) return null;
    return JSON.parse(this.states[++this.position]!);
  }
}
