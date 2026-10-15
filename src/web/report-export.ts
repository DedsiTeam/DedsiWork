import { useRef, useState } from "react";
import { api } from "./api";
import { useWorkspace } from "./workspace-context";
export function useReportExport() {
  const { notify } = useWorkspace();
  const [exporting, setExporting] = useState(false),
    pending = useRef(false);
  async function exportMarkdown(name: string, content: string) {
    if (pending.current) return;
    pending.current = true;
    setExporting(true);
    try {
      const result = await api<{
        data: { cancelled: true } | { cancelled: false; path: string };
      }>("/api/v1/reports/export", {
        method: "POST",
        body: JSON.stringify({ name, content }),
      });
      if (result.data.cancelled) notify("已取消导出");
      else notify(`文字稿已保存：${result.data.path}`);
    } catch (error) {
      notify(`导出失败：${(error as Error).message}`, "error");
    } finally {
      pending.current = false;
      setExporting(false);
    }
  }
  return { exporting, exportMarkdown };
}
