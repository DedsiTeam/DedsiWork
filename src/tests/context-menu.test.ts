import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function desktopEvents() {
  const listeners = new Map<string, (event: any) => void>();
  const commands: string[] = [];
  runInNewContext(
    readFileSync(
      new URL("../src-tauri/src/context-menu.js", import.meta.url),
      "utf8",
    ),
    {
      window: {
        addEventListener(
          name: string,
          listener: (event: any) => void,
          capture: boolean,
        ) {
          expect(capture).toBe(true);
          listeners.set(name, listener);
        },
        __TAURI_INTERNALS__: {
          invoke(command: string) {
            commands.push(command);
            return Promise.resolve();
          },
        },
      },
    },
  );
  return { listeners, commands };
}

function event(properties: Record<string, unknown> = {}) {
  return {
    prevented: false,
    stopped: false,
    preventDefault() {
      this.prevented = true;
    },
    stopImmediatePropagation() {
      this.stopped = true;
    },
    ...properties,
  };
}

test("right click suppresses the WebView menu and requests the Chinese native menu", () => {
  const { listeners, commands } = desktopEvents();
  const click = event();
  listeners.get("contextmenu")!(click);
  expect(click.prevented).toBe(true);
  expect(click.stopped).toBe(true);
  expect(commands).toEqual(["show_context_menu"]);
});

test("developer shortcuts are blocked while editing shortcuts remain available", () => {
  const { listeners } = desktopEvents();
  for (const properties of [
    { key: "F12" },
    ...["I", "J", "C"].flatMap((key) => [
      { key, ctrlKey: true, shiftKey: true },
      { key, metaKey: true, altKey: true },
    ]),
  ]) {
    const shortcut = event(properties);
    listeners.get("keydown")!(shortcut);
    expect(shortcut.prevented).toBe(true);
    expect(shortcut.stopped).toBe(true);
  }
  for (const key of ["c", "v", "x", "a", "z"]) {
    for (const modifier of ["ctrlKey", "metaKey"]) {
      const shortcut = event({ key, [modifier]: true });
      listeners.get("keydown")!(shortcut);
      expect(shortcut.prevented).toBe(false);
    }
  }
});
