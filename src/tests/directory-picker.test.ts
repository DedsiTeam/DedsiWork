import { expect, test } from "bun:test";
import { chooseWorkspaceDirectory } from "../server/directory-picker";
import { WorkspaceStore } from "../server/services/workspaces";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("macOS picker preserves Chinese and spaces in selected directories", async () => {
  const directory = "/Users/test/项目目录 with spaces ";
  expect(
    await chooseWorkspaceDirectory("darwin", async (command) => {
      expect(command).toBe("/usr/bin/osascript");
      return { stdout: directory + "\n" };
    }),
  ).toBe(directory);
});

test("Windows picker runs in STA with Unicode script and UTF-8 paths", async () => {
  const directory = "C:\\Users\\测试\\项目 & 工作目录";
  expect(
    await chooseWorkspaceDirectory("win32", async (command, args) => {
      expect(command).toBe("powershell.exe");
      expect(args).toContain("-STA");
      expect(args).toContain("-NoProfile");
      const script = Buffer.from(
        args[args.indexOf("-EncodedCommand") + 1]!,
        "base64",
      ).toString("utf16le");
      expect(script).toContain("选择工作空间目录");
      expect(script).toContain("UTF8Encoding");
      expect(script).toContain("FolderBrowserDialog");
      expect(script).toContain("DialogResult]::OK");
      expect(script).toContain("$picker.Dispose()");
      return { stdout: directory + "\r\n" };
    }),
  ).toBe(directory);
  const unc = "\\\\server\\共享目录\\项目";
  expect(
    await chooseWorkspaceDirectory("win32", async () => ({
      stdout: unc + "\r\n",
    })),
  ).toBe(unc);
});

test("cancel returns an empty directory on both platforms", async () => {
  expect(
    await chooseWorkspaceDirectory("win32", async () => ({ stdout: "" })),
  ).toBe("");
  expect(
    await chooseWorkspaceDirectory("darwin", async () => {
      throw { stderr: "User canceled. (-128)" };
    }),
  ).toBe("");
});

test("picker failures and unsupported systems allow manual entry", async () => {
  for (const platform of ["darwin", "win32"] as const) {
    await expect(
      chooseWorkspaceDirectory(platform, async () => {
        throw { stderr: "Native dialog failed", code: 1 };
      }),
    ).rejects.toMatchObject({ code: "DIRECTORY_PICKER_FAILED" });
  }
  await expect(
    chooseWorkspaceDirectory("linux", async () => {
      throw new Error("must not run");
    }),
  ).rejects.toMatchObject({ code: "UNSUPPORTED_PLATFORM" });
});

test("read-only actors cannot launch a directory picker", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dedsiwork-directory-"));
  const store = new WorkspaceStore(join(directory, "dedsiwork.sqlite"));
  try {
    await expect(
      store.chooseDirectory({
        source: "mcp",
        identity: "reader",
        writable: false,
        requestId: "test",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
