// 0.1.5 I2：零依赖日期解析（格式表顺序试解，不引日期库）。
// year 取整数年（接起始年筛选），raw 原文存 metadata year_raw 回显。
export interface ParsedDate {
  ok: boolean;      // 是否命中格式表
  year: number | null;   // 整数年（落 DB year 列）
  norm: string;     // 规范化回显（如 2026-08-03 14:30:05）
  raw: string;      // 用户原文
}

// 格式表：命名捕获，按顺序试解（yyyy → yyyy-mm → … → 中文 → 点分）
const FORMATS: { re: RegExp; norm: (m: RegExpMatchArray) => string }[] = [
  { re: /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})$/,
    norm: (m) => `${m[1]}-${p2(m[2])}-${p2(m[3])} ${p2(m[4])}:${m[5]}:${m[6]}` },
  { re: /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/,
    norm: (m) => `${m[1]}-${p2(m[2])}-${p2(m[3])} ${p2(m[4])}:${m[5]}` },
  { re: /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
    norm: (m) => `${m[1]}-${p2(m[2])}-${p2(m[3])}` },
  { re: /^(\d{4})-(\d{1,2})$/, norm: (m) => `${m[1]}-${p2(m[2])}` },
  { re: /^(\d{4})$/, norm: (m) => m[1] },
  { re: /^(\d{4})年(?:(\d{1,2})月)?(?:(\d{1,2})日)?$/,
    norm: (m) => m[3] ? `${m[1]}-${p2(m[2])}-${p2(m[3])}`
                      : m[2] ? `${m[1]}-${p2(m[2])}` : m[1] },
  { re: /^(\d{4})\.(\d{1,2})(?:\.(\d{1,2}))?$/,
    norm: (m) => m[3] ? `${m[1]}-${p2(m[2])}-${p2(m[3])}` : `${m[1]}-${p2(m[2])}` },
];

function p2(s: string | undefined): string {
  return (s ?? "").padStart(2, "0");
}

function inRange(m: RegExpMatchArray): boolean {
  const yy = Number(m[1]);
  if (yy < 100 || yy > 9999) return false;
  const mo = m[2] ? Number(m[2]) : 1;
  const dd = m[3] ? Number(m[3]) : 1;
  return mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31;
}

/** 顺序试解；失败返回 ok:false 且 year:null（按原文存档）。 */
export function parseDateInput(input: string): ParsedDate {
  const raw = input.trim();
  if (!raw) return { ok: false, year: null, norm: "", raw };
  for (const f of FORMATS) {
    const m = raw.match(f.re);
    if (m && inRange(m)) {
      return { ok: true, year: Number(m[1]), norm: f.norm(m), raw };
    }
  }
  return { ok: false, year: null, norm: "", raw };
}
