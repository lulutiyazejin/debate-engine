// 0.1.5 I2：零依赖日期解析（格式表顺序试解，不引日期库）。
// 0.1.9 D1: 增加紧凑格式 14/12/8 位 + 后端 sane_year() 同语义；year 整数年接筛选，year_raw 原文回显。
export interface ParsedDate {
  ok: boolean;      // 是否命中格式表
  year: number | null;   // 整数年（落 DB year 列）
  norm: string;     // 规范化回显（如 2026-08-03 14:30:05）
  raw: string;      // 用户原文
}

// 格式表：命名捕获，按顺序试解（yyyy-mm-dd hh:mm:ss → … → yyyy）
const FORMATS: { re: RegExp; norm: (m: RegExpMatchArray) => string }[] = [
  // 紧凑 14 位 YYYYMMDDHHmmss → YYYY-MM-DD HH:mm:ss
  { re: /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/,
    norm: (m) => `${m[1]}-${p2(m[2])}-${p2(m[3])} ${p2(m[4])}:${m[5]}:${m[6]}` },
  // 紧凑 12 位 YYYYMMDDHHmm → YYYY-MM-DD HH:mm
  { re: /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/,
    norm: (m) => `${m[1]}-${p2(m[2])}-${p2(m[3])} ${p2(m[4])}:${m[5]}` },
  // 紧凑 8 位 YYYYMMDD → YYYY-MM-DD
  { re: /^(\d{4})(\d{2})(\d{2})$/,
    norm: (m) => `${m[1]}-${p2(m[2])}-${p2(m[3])}` },
  // ISO YYYY-MM-DD HH:mm:ss / T
  { re: /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2}):(\d{2})$/,
    norm: (m) => `${m[1]}-${p2(m[2])}-${p2(m[3])} ${p2(m[4])}:${m[5]}:${m[6]}` },
  // ISO YYYY-MM-DD HH:mm / T
  { re: /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/,
    norm: (m) => `${m[1]}-${p2(m[2])}-${p2(m[3])} ${p2(m[4])}:${m[5]}` },
  // ISO YYYY-MM-DD
  { re: /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
    norm: (m) => `${m[1]}-${p2(m[2])}-${p2(m[3])}` },
  // ISO YYYY-MM
  { re: /^(\d{4})-(\d{1,2})$/,
    norm: (m) => `${m[1]}-${p2(m[2])}` },
  // 仅年份
  { re: /^(\d{4})$/,
    norm: (m) => m[1] },
  // 中文 YYYY 年 M 月 D 日
  { re: /^(\d{4}) 年 (?:(\d{1,2}) 月 )?(?:(\d{1,2}) 日)?$/,
    norm: (m) => m[3] ? `${m[1]}-${p2(m[2])}-${p2(m[3])}`
                      : m[2] ? `${m[1]}-${p2(m[2])}` : m[1] },
  // 点分 YYYY.MM.DD / YYYY.MM
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
  // 0.1.9 D1: 紧凑型无分隔符时 m[2] 是月，m[3] 是日（或时分秒），沿用原有校验逻辑
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
