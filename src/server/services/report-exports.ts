import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFileSync, renameSync, rmSync, existsSync } from "node:fs";
import { isAbsolute } from "node:path";
import { z } from "zod";
import { AppError } from "../../shared/errors";
import type { Actor } from "./work-items";
const run = promisify(execFile);
async function chooseDestination(name: string): Promise<string | null> {
  try {
    if (process.platform === "darwin") {
      const result = await run("/usr/bin/osascript", [
        "-e",
        `POSIX path of (choose file name with prompt "导出工作报告文字稿" default name ${JSON.stringify(name)})`,
      ]);
      return result.stdout.trim() || null;
    }
    if (process.platform === "win32") {
      const script = `Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.SaveFileDialog; $dialog.Title = '导出工作报告文字稿'; $dialog.FileName = $env:DEDSIWORK_REPORT_EXPORT_NAME; $dialog.Filter = 'Markdown (*.md)|*.md'; $dialog.DefaultExt = 'md'; $dialog.AddExtension = $true; $dialog.OverwritePrompt = $true; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding; [Console]::Write($dialog.FileName) }`;
      const result = await run(
        "powershell.exe",
        [
          "-NoProfile",
          "-STA",
          "-EncodedCommand",
          Buffer.from(script, "utf16le").toString("base64"),
        ],
        {
          env: { ...process.env, DEDSIWORK_REPORT_EXPORT_NAME: name },
          windowsHide: true,
        },
      );
      return result.stdout.trim() || null;
    }
    throw new AppError(
      "UNSUPPORTED_PLATFORM",
      "当前平台暂不支持保存窗口，请使用复制文字功能",
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (
      process.platform === "darwin" &&
      String((error as { stderr?: string }).stderr).includes("-128")
    )
      return null;
    throw new AppError("FILE_PICKER_FAILED", "无法打开保存窗口，请重试", 503);
  }
}
export class ReportExports {
  private saving = false;
  constructor(
    private pick: (name: string) => Promise<string | null> = chooseDestination,
  ) {}
  async save(input: unknown, actor: Actor) {
    if (!actor.writable) throw new AppError("FORBIDDEN", "需要写入权限", 403);
    const value = z
      .object({
        name: z.string().trim().min(1).max(200),
        content: z
          .string()
          .max(2000000)
          .refine((text) => text.trim().length > 0, "导出内容不能为空"),
      })
      .strict()
      .parse(input);
    if (this.saving)
      throw new AppError(
        "EXPORT_BUSY",
        "已有保存窗口打开，请先完成或取消保存",
        409,
      );
    this.saving = true;
    try {
      const base =
        value.name
          .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
          .replace(/[. ]+$/g, "") || "工作报告";
      const name = base.toLowerCase().endsWith(".md") ? base : base + ".md";
      const selected = await this.pick(name);
      if (!selected) return { cancelled: true as const };
      if (!isAbsolute(selected))
        throw new AppError(
          "INVALID_EXPORT_PATH",
          "保存窗口返回的路径无效，请重试",
        );
      const path = selected.toLowerCase().endsWith(".md")
        ? selected
        : selected + ".md";
      if (path !== selected && existsSync(path))
        throw new AppError(
          "EXPORT_EXISTS",
          "补全 .md 扩展名后的文件已存在，请重新选择文件名",
          409,
        );
      const temporary = path + "." + crypto.randomUUID() + ".tmp";
      try {
        writeFileSync(temporary, value.content, {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        });
        renameSync(temporary, path);
      } catch {
        throw new AppError(
          "EXPORT_WRITE_FAILED",
          "保存文件失败，请检查目录权限或选择其他位置",
          500,
        );
      } finally {
        rmSync(temporary, { force: true });
      }
      return { cancelled: false as const, path };
    } finally {
      this.saving = false;
    }
  }
}
