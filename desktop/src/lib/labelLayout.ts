// 标签防重叠计算（0.1.8 V3）
// 包围盒碰撞 → 垂直错位（±14px 阶梯，最多 ±28）→ 仍撞则聚合到最近标签（+N，hover 列全名）
export interface LabelIn { x: number; y: number; w: number; h: number; text: string }
export interface LabelOut {
  x: number; y: number; text: string;
  hidden?: boolean;      // 被聚合吸收 → 不渲染
  extra?: string[];      // 本标签吸收的其他名字（渲染「+N」+ hover 全名）
}

const STEPS = [0, 14, -14, 28, -28];   // 垂直阶梯

export function layoutLabels(items: LabelIn[]): LabelOut[] {
  const out: LabelOut[] = items.map((it) => ({ x: it.x, y: it.y, text: it.text }));
  // 从左到右放置，保证同点位簇聚到先放的标签
  const order = items.map((_, i) => i)
    .sort((a, b) => items[a].x - items[b].x || items[a].y - items[b].y);
  const placed: { x: number; y: number; w: number; h: number; idx: number }[] = [];
  const collide = (a: { x: number; y: number; w: number; h: number },
                   b: { x: number; y: number; w: number; h: number }) =>
    Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;

  for (const i of order) {
    const it = items[i];
    let done = false;
    for (const dy of STEPS) {
      const cand = { x: it.x, y: it.y + dy, w: it.w, h: it.h, idx: i };
      if (!placed.some((p) => collide(p, cand))) {
        placed.push(cand);
        out[i].y = cand.y;
        done = true;
        break;
      }
    }
    if (!done && placed.length > 0) {
      // 五档全撞 → 聚合到最近已放标签
      let best = placed[0];
      let bd = Infinity;
      for (const p of placed) {
        const d = (p.x - it.x) ** 2 + (p.y - it.y) ** 2;
        if (d < bd) { bd = d; best = p; }
      }
      out[i].hidden = true;
      (out[best.idx].extra ??= []).push(it.text);
    }
  }
  return out;
}
