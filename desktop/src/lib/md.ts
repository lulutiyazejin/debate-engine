// 0.1.4 批 6（决策 10）：零依赖迷你 Markdown 渲染（阅读器/档案 md 用）。
// 支持：标题/粗斜体/行内代码/代码块/引用/无序有序列表/表格/链接/水平线。
// 输出经转义，链接只放行 http(s)。

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\*([^*]+)\*/g, "<i>$1</i>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
             '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

export function mdToHtml(src: string): string {
  // frontmatter 摘出为元数据表
  let body = src.replace(/\r\n/g, "\n");
  let fmHtml = "";
  const fm = body.match(/^---\n([\s\S]*?)\n---\n/);
  if (fm) {
    const rows = fm[1].split("\n").filter((l) => l.includes(":"))
      .map((l) => { const i = l.indexOf(":");
                    return `<tr><td>${esc(l.slice(0, i).trim())}</td>` +
                           `<td>${esc(l.slice(i + 1).trim())}</td></tr>`; });
    fmHtml = `<table class="md-fm">${rows.join("")}</table>`;
    body = body.slice(fm[0].length);
  }
  const lines = body.split("\n");
  const out: string[] = [fmHtml];
  let i = 0;
  const para: string[] = [];
  const flush = () => {
    if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para.length = 0; }
  };
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) {                       // 代码块
      flush();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { flush(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(l)) { flush(); out.push("<hr/>"); i++; continue; }
    if (/^>\s?/.test(l)) {                      // 引用（连续行合并）
      flush();
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]))
        buf.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${inline(buf.join(" "))}</blockquote>`);
      continue;
    }
    if (/^\s*[-*+]\s+/.test(l) || /^\s*\d+\.\s+/.test(l)) {  // 列表
      flush();
      const ordered = /^\s*\d+\./.test(l);
      const buf: string[] = [];
      while (i < lines.length &&
             (/^\s*[-*+]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i])))
        buf.push(`<li>${inline(lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, ""))}</li>`);
      out.push(ordered ? `<ol>${buf.join("")}</ol>` : `<ul>${buf.join("")}</ul>`);
      continue;
    }
    if (/^\|.*\|\s*$/.test(l) && /^\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {  // 表格
      flush();
      const head = l.split("|").slice(1, -1).map((c) => `<th>${inline(c.trim())}</th>`);
      i += 2;
      const rows: string[] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i++].split("|").slice(1, -1)
          .map((c) => `<td>${inline(c.trim())}</td>`);
        rows.push(`<tr>${cells.join("")}</tr>`);
      }
      out.push(`<table><thead><tr>${head.join("")}</tr></thead>` +
               `<tbody>${rows.join("")}</tbody></table>`);
      continue;
    }
    if (!l.trim()) { flush(); i++; continue; }
    para.push(l.trim()); i++;
  }
  flush();
  return out.join("\n");
}
