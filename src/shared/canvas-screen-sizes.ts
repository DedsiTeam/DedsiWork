// Logical canvas pixels, shared by device frames and UI image generation.
export const canvasScreenSizes = [
  { group: "手机", name: "紧凑手机", width: 360, height: 800 },
  { group: "手机", name: "小屏手机", width: 375, height: 667 },
  { group: "手机", name: "标准手机", width: 390, height: 844 },
  { group: "手机", name: "全面屏手机", width: 393, height: 852 },
  { group: "手机", name: "大屏手机", width: 412, height: 915 },
  { group: "手机", name: "超大屏手机", width: 430, height: 932 },
  { group: "PC", name: "小屏笔记本", width: 1280, height: 800 },
  { group: "PC", name: "常规笔记本", width: 1366, height: 768 },
  { group: "PC", name: "标准桌面", width: 1440, height: 900 },
  { group: "PC", name: "宽屏桌面", width: 1536, height: 864 },
  { group: "PC", name: "大屏桌面", width: 1920, height: 1080 },
  { group: "PC", name: "2K 桌面", width: 2560, height: 1440 },
  { group: "其他", name: "平板竖屏", width: 768, height: 1024 },
  { group: "其他", name: "平板横屏", width: 1024, height: 768 },
  { group: "其他", name: "正方形", width: 1024, height: 1024 },
] as const;
