// 立场标签统一函数（0.1.8 G5）
// 来源 stances 数组 → label || key || "未分类"
export const stanceLabel = (key: string, stances: { name: string; label?: string }[]): string => {
  const s = stances.find((s) => s.name === key);
  return s?.label || key || "未分类";
};
