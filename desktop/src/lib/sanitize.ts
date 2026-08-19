// 轻量 HTML 白名单净化器（PLAN-0.1.5 D2）：ReaderModal 注入 mammoth HTML 前过滤。
// 只放 p/b/i/em/strong/h1-4/ul/ol/li/table/tr/td/th/br/hr/a[href^=http]/img[src]；
// script/style 等危险节点整删，白名单外标签解包保内容，on* 事件属性全剥。
const ALLOWED = new Set([
  "P", "B", "I", "EM", "STRONG", "H1", "H2", "H3", "H4",
  "UL", "OL", "LI", "TABLE", "THEAD", "TBODY", "TR", "TD", "TH",
  "BR", "HR", "A", "IMG",
]);
const DROP = new Set([
  "SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META",
  "FORM", "INPUT", "BUTTON", "SVG", "MATH",
]);

export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walk = (el: Element) => {
    for (const child of [...el.children]) walk(child);
    const tag = el.tagName;
    if (DROP.has(tag)) { el.remove(); return; }
    // 属性剥离：只保留 a[href^=http] 与 img[src]（禁 javascript:），其余全剥（含 on*）
    for (const attr of [...el.attributes]) {
      const n = attr.name.toLowerCase();
      const keep =
        (tag === "A" && n === "href" && /^https?:\/\//i.test(attr.value)) ||
        (tag === "IMG" && n === "src" && !/^\s*javascript:/i.test(attr.value));
      if (!keep) el.removeAttribute(attr.name);
    }
    if (tag === "A" && el.hasAttribute("href")) {
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noreferrer");
    }
    if (!ALLOWED.has(tag)) {
      // 白名单外标签（span/div/font…）解包保内容
      const parent = el.parentNode;
      if (parent) {
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        el.remove();
      }
    }
  };
  for (const child of [...doc.body.children]) walk(child);
  return doc.body.innerHTML;
}
