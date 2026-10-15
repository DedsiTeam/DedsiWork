import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AppError } from "../shared/errors";

type RunPicker = (
  command: string,
  args: string[],
) => Promise<{ stdout: string }>;
const runPicker: RunPicker = (command, args) =>
  promisify(execFile)(command, args, { encoding: "utf8", windowsHide: true });

export async function chooseWorkspaceDirectory(
  platform: NodeJS.Platform = process.platform,
  run: RunPicker = runPicker,
): Promise<string> {
  if (platform !== "darwin" && platform !== "win32")
    throw new AppError("UNSUPPORTED_PLATFORM", "请填写本地目录的完整路径");
  try {
    let stdout: string;
    if (platform === "darwin") {
      ({ stdout } = await run("/usr/bin/osascript", [
        "-e",
        'POSIX path of (choose folder with prompt "选择工作空间目录")',
      ]));
    } else {
      // EncodedCommand uses UTF-16LE; explicit UTF-8 output preserves Chinese paths.
      const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Windows.Forms
$picker = New-Object System.Windows.Forms.FolderBrowserDialog
try {
  $picker.Description = '选择工作空间目录'
  $picker.ShowNewFolderButton = $true
  if ($picker.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::WriteLine($picker.SelectedPath)
  }
} finally {
  $picker.Dispose()
}`;
      ({ stdout } = await run("powershell.exe", [
        "-NoProfile",
        "-STA",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ]));
    }
    // Strip only the output terminator; spaces can be part of a directory name.
    return stdout.replace(/\r?\n$/, "");
  } catch (error) {
    if (
      platform === "darwin" &&
      String((error as { stderr?: string }).stderr).includes("-128")
    )
      return "";
    throw new AppError(
      "DIRECTORY_PICKER_FAILED",
      "无法打开目录选择器，请手动填写路径",
    );
  }
}
