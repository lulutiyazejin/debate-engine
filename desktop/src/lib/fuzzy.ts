// 模糊匹配共用件（0.1.4 批 2/项目 23）：子串 + 中文拼音首字母，零依赖。
// 拼音首字母用 GB 边界字 + Intl.Collator 拼音排序近似判定（常用字准确，生僻字放过）。

const BOUNDARY = "啊芭擦搭蛾发噶哈击喀垃妈拿哦啪期然撒塌挖昔压匝";
const LETTERS = "abcdefghjklmnopqrstwxyz";   // 与边界字一一对应（无 i/u/v）
const coll = new Intl.Collator("zh-Hans-CN-u-co-pinyin");

export function pinyinInitial(ch: string): string {
  if (/[a-zA-Z0-9]/.test(ch)) return ch.toLowerCase();
  if (!/[\u4e00-\u9fa5]/.test(ch)) return "";
  for (let i = LETTERS.length - 1; i >= 0; i--) {
    if (coll.compare(ch, BOUNDARY[i]) >= 0) return LETTERS[i];
  }
  return "";
}

/** 命中区间（字符下标，末端开区间）；null = 不匹配，[] = 空查询全放行 */
export function fuzzyRanges(text: string, query: string): [number, number][] | null {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const t = text.toLowerCase();
  const idx = t.indexOf(q);
  if (idx >= 0) return [[idx, idx + q.length]];
  // 拼音首字母路：仅纯字母查询启用
  if (!/^[a-z]+$/.test(q)) return null;
  const chars = [...text];
  const withIni: { pos: number; ini: string }[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ini = pinyinInitial(chars[i]);
    if (ini) withIni.push({ pos: i, ini });
  }
  const iniStr = withIni.map((x) => x.ini).join("");
  const k = iniStr.indexOf(q);
  if (k < 0) return null;
  const start = withIni[k].pos;
  const end = withIni[k + q.length - 1].pos + 1;
  return [[start, end]];
}

/** 是否匹配（多字段任一命中即过） */
export function fuzzyMatch(query: string, ...fields: (string | undefined)[]): boolean {
  const q = query.trim();
  if (!q) return true;
  return fields.some((f) => f && fuzzyRanges(f, q) !== null);
}
