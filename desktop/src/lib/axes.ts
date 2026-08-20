// 22 轴意识形态坐标元数据（PLAN-0.1.5 J1）：与 backend/ingestion/classifier.py
// 的 AXES 与两极语义一一对应（架构 §16.1）；Combobox 副行端点语义用。
export interface AxisMeta { key: string; label: string; neg: string; pos: string }

export const AXES: AxisMeta[] = [
  // 核心 9 轴
  { key: "ownership", label: "所有制", neg: "公有", pos: "私有" },
  { key: "political_authority", label: "政治权力", neg: "集权", pos: "无政府" },
  { key: "imperialism", label: "帝国主义", neg: "反帝", pos: "干涉主义" },
  { key: "epistemology", label: "认识论", neg: "理性建构", pos: "经验演化" },
  { key: "change_speed", label: "变革速度", neg: "革命", pos: "保守" },
  { key: "ethics", label: "伦理", neg: "结果主义", pos: "义务论" },
  { key: "culture", label: "文化", neg: "进步", pos: "传统" },
  { key: "diplomacy", label: "外交", neg: "民族", pos: "世界主义" },
  { key: "technology", label: "技术", neg: "怀疑", pos: "加速主义" },
  // 扩展 13 轴
  { key: "distribution", label: "分配", neg: "平均主义", pos: "绩效主义" },
  { key: "welfare", label: "福利", neg: "强福利", pos: "自力更生" },
  { key: "democracy_type", label: "民主形态", neg: "直接民主", pos: "精英代议" },
  { key: "organization", label: "组织", neg: "先锋党纪律", pos: "自组织" },
  { key: "constitutionalism", label: "宪政", neg: "人治/党治", pos: "宪政法治" },
  { key: "identity", label: "身份", neg: "阶级政治", pos: "身份政治" },
  { key: "gender", label: "性别", neg: "父权传统", pos: "性别流动" },
  { key: "secularism", label: "世俗", neg: "政教合一", pos: "彻底世俗" },
  { key: "ontology", label: "本体论", neg: "整体主义", pos: "原子个人" },
  { key: "ecology", label: "生态", neg: "生态中心", pos: "发展优先" },
  { key: "ai_automation", label: "人工智能", neg: "技术恐惧", pos: "加速主义" },
  { key: "globalization", label: "全球化", neg: "反全球化", pos: "亲全球化" },
  { key: "historical_view", label: "历史观", neg: "唯物决定论", pos: "观念意志论" },
];

export const axisLabel = (key: string): string =>
  AXES.find((a) => a.key === key)?.label ?? key;

/** Combobox 选项（副行=两极端点语义，如「所有制：公←→私」） */
export const axisOptions = AXES.map((a) => ({
  value: a.key, label: a.label, sub: `${a.neg} ←→ ${a.pos}`,
}));

/** J1 决策 13 延伸：政治轴左红→中灰→右蓝连续色标，端点恒定不跟主题色 */
export const COLOR_NEG = "#d34040";
export const COLOR_MID = "#8a8f98";
export const COLOR_POS = "#4f8cff";

/** -5..+5 → 红灰蓝三段线性插值（散点/立方通用） */
export function coordColor(v: number): string {
  const t = Math.max(-5, Math.min(5, v)) / 5;   // -1..1
  const mix = (a: string, b: string, k: number) => {
    const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    return "#" + pa.map((x, i) =>
      Math.round(x + (pb[i] - x) * k).toString(16).padStart(2, "0")).join("");
  };
  return t < 0 ? mix(COLOR_MID, COLOR_NEG, -t) : mix(COLOR_MID, COLOR_POS, t);
}

/** 可视化数据源（/api/analysis/coords）共享类型 */
export interface CoordDoc {
  doc_id: string; title: string; author?: string; stance: string;
  coords: Record<string, number>;
}
export interface StanceProfile {
  stance: string; count: number; avg: Record<string, number>;
}
