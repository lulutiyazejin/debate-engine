// 统一阅读器——查看与入库分家，一套外壳全格式。
// Portal 到 body 避免 transform 祖先劫持 fixed 参照系。
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api, engineBase } from "../api";
import { mdToHtml } from "../lib/md";
import { sanitizeHtml } from "../lib/sanitize";
import { askConfirm, askInput } from "./AppDialog";

interface ViewData {
  doc_id: string; title: string; author: string; format: string;
  conversion: string; has_file: boolean; kind: string;
  content?: string; note?: string; file_url?: string; text?: string;
  sheets?: string[]; sheet?: string; rows?: string[][];
  total_rows?: number; page?: number; page_size?: number;
}

// 0.1.8 N3：高亮批注（文本锚点=引文+前后文，重开按文本匹配定位）
interface Hl { id: number; quote: string; prefix?: string; suffix?: string;
               color: string; note?: string }

const escHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// 引文全文匹配首个出现处包 <mark>；原文变动匹配失败 → 静默忽略不崩
function applyHl(html: string, hls: Hl[]): string {
  let out = html;
  for (const h of hls) {
    const q = escHtml(h.quote);
    const i = out.indexOf(q);
    if (i < 0) continue;
    const title = h.note ? ` title="${escHtml(h.note)}"` : "";
    out = out.slice(0, i)
      + `<mark class="hl-mark" data-hl="${h.id}" style="background:${h.color}55"${title}>${q}</mark>`
      + out.slice(i + q.length);
  }
  return out;
}

interface Props { docId: string; onClose: () => void }

export default function ReaderModal({ docId, onClose }: Props) {
  const [data, setData] = useState<ViewData | null>(null);
  const [err, setErr] = useState("");
  const [pdfText, setPdfText] = useState(false);   // pdf 文本模式切换
  const [pdfFail, setPdfFail] = useState(false);   // 0.1.5 D2：iframe 失败回退外链
  // 0.1.8 N3：高亮列表 + 选区浮条
  const [hls, setHls] = useState<Hl[]>([]);
  const [selBar, setSelBar] = useState<{ x: number; y: number; text: string;
                                         prefix: string; suffix: string } | null>(null);
  const portalRoot = typeof document !== "undefined" ? document.body : null;

  const load = (sheet = "", page = 0) => {
    api.get<ViewData>(`/api/docs/${docId}/view?sheet=${encodeURIComponent(sheet)}&page=${page}`)
      .then((d) => { setData(d); setErr(""); })
      .catch((e) => setErr(String(e)));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [docId]);

  // 0.1.8 N3：拉取高亮（重开还原）
  const loadHls = () => {
    api.get<{ highlights: Hl[] }>(`/api/knowledge/docs/${docId}/highlights`)
      .then((r) => setHls(r.highlights)).catch(() => setHls([]));
  };
  useEffect(() => { loadHls(); /* eslint-disable-next-line */ }, [docId]);

  // 选中文本 → 浮条（高亮/批注）；锚点=引文+前后文各 32 字
  const onBodyMouseUp = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() || "";
    if (!sel || sel.rangeCount === 0 || text.length < 2) { setSelBar(null); return; }
    const r = sel.getRangeAt(0);
    const rect = r.getBoundingClientRect();
    const pre = (r.startContainer.textContent || "")
      .slice(Math.max(0, r.startOffset - 32), r.startOffset);
    const suf = (r.endContainer.textContent || "").slice(r.endOffset, r.endOffset + 32);
    setSelBar({ x: rect.left + rect.width / 2, y: Math.max(52, rect.top - 36),
                text: text.slice(0, 500), prefix: pre, suffix: suf });
  };

  const addHl = async (note?: string) => {
    if (!selBar) return;
    try {
      await api.post(`/api/knowledge/docs/${docId}/highlights`,
        { quote: selBar.text, prefix: selBar.prefix, suffix: selBar.suffix,
          color: "#ffd54a", note: note || "" });
      setSelBar(null);
      loadHls();
    } catch (e) { setErr(String(e)); }
  };

  // 右键已高亮段 → 确认删除
  const onBodyCtx = async (e: React.MouseEvent) => {
    const m = (e.target as HTMLElement).closest("mark[data-hl]");
    if (!m) return;
    e.preventDefault();
    e.stopPropagation();
    const id = m.getAttribute("data-hl");
    if (await askConfirm({ title: "删除这条高亮？",
        body: (m.textContent || "").slice(0, 80), danger: true })) {
      api.del(`/api/knowledge/highlights/${id}`).then(loadHls).catch(() => {});
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const fileUrl = data?.file_url ? `${engineBase()}${data.file_url}` : "";
  const totalPages = data?.total_rows && data?.page_size
    ? Math.ceil(data.total_rows / data.page_size) : 1;

  const readerShell = (
    <div className="reader-backdrop" onClick={onClose}>
      <div className="reader-shell" onClick={(e) => e.stopPropagation()}>
        <header className="reader-head">
          <b className="reader-title" title={data?.title}>{data?.title || docId}</b>
          {data && <span className="badge">{data.format}</span>}
          {data?.conversion === "lossy" && <span className="badge warn">有噪转换</span>}
          {data?.conversion === "summary-only" && <span className="badge warn">仅摘要</span>}
          {data?.author && <span className="muted small">{data.author}</span>}
          <span className="reader-spacer" />
          {data?.kind === "pdf" && (
            <button className="link" onClick={() => setPdfText(!pdfText)}>
              {pdfText ? "原页模式" : "文本模式"}</button>
          )}
          {data?.has_file && fileUrl && (
            <a className="link" href={fileUrl} target="_blank" rel="noreferrer">打开原件 ↗</a>
          )}
          <button title="关闭 (Esc)" onClick={onClose}>×</button>
        </header>
        <div className="reader-body" onMouseUp={onBodyMouseUp} onContextMenu={onBodyCtx}>
          {err && <p className="muted">{err}</p>}
          {!data && !err && <p className="muted small">加载中…</p>}
          {data?.note && <p className="muted small">{data.note}</p>}

          {data?.kind === "text" && (
            data.format === "md"
              ? <div className="reader-md"
                     dangerouslySetInnerHTML={{ __html: applyHl(mdToHtml(data.content || ""), hls) }} />
              : <pre className="reader-txt"
                     dangerouslySetInnerHTML={{ __html: applyHl(escHtml(data.content || ""), hls) }} />
          )}

          {data?.kind === "html" && (
            /* 0.1.5 D2：mammoth HTML 白名单净化后再注入（剥 script/on*） */
            <div className="reader-md"
                 dangerouslySetInnerHTML={{ __html: applyHl(sanitizeHtml(data.content || ""), hls) }} />
          )}

          {data?.kind === "table" && (
            <>
              {(data.sheets?.length ?? 0) > 1 && (
                <div className="reader-sheets">
                  {data.sheets!.map((s) => (
                    <button key={s} className={s === data.sheet ? "seg-on" : ""}
                            onClick={() => load(s, 0)}>{s}</button>
                  ))}
                </div>
              )}
              <div className="reader-tablewrap">
                <table className="reader-table">
                  <tbody>
                    {(data.rows || []).map((r, i) => (
                      <tr key={i}>{r.map((c, j) =>
                        i === 0 && (data.page ?? 0) === 0
                          ? <th key={j}>{c}</th> : <td key={j}>{c}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="controls">
                  <button disabled={(data.page ?? 0) <= 0}
                          onClick={() => load(data.sheet || "", (data.page ?? 0) - 1)}>上一页</button>
                  <span className="muted small">
                    第 {(data.page ?? 0) + 1}/{totalPages} 页 · 共 {data.total_rows} 行</span>
                  <button disabled={(data.page ?? 0) + 1 >= totalPages}
                          onClick={() => load(data.sheet || "", (data.page ?? 0) + 1)}>下一页</button>
                </div>
              )}
            </>
          )}

          {data?.kind === "pdf" && (
            pdfText
              ? <pre className="reader-txt"
                     dangerouslySetInnerHTML={{ __html: applyHl(escHtml(data.text || "（无文字层）"), hls) }} />
              : pdfFail
                ? <p className="muted">
                    内嵌 PDF 加载失败。
                    <a className="link" href={fileUrl} target="_blank" rel="noreferrer">打开原件 ↗</a>
                    或切换上方「文本模式」。
                  </p>
                : <iframe className="reader-frame" src={fileUrl} title={data.title}
                          onError={() => setPdfFail(true)} />
          )}

          {data?.kind === "image" && (
            <img className="reader-img" src={fileUrl} alt={data.title} />
          )}

          {data?.kind === "file" && (
            <p className="muted">
              该格式暂不支持内嵌查看。
              <a className="link" href={fileUrl} target="_blank" rel="noreferrer">下载原件 ↗</a>
            </p>
          )}
        </div>
      </div>
      {/* 0.1.8 N3：选区浮条（高亮/批注） */}
      {selBar && (
        <div className="hl-bar" style={{ left: selBar.x, top: selBar.y }}
             onMouseDown={(e) => e.stopPropagation()}
             onClick={(e) => e.stopPropagation()}>
          <button onClick={() => addHl()}>高亮</button>
          <button onClick={async () => {
            const note = await askInput({ title: "批注内容",
              placeholder: "写点想法，hover 高亮段可见…" });
            if (note !== null) addHl(note);
          }}>批注</button>
          <button onClick={() => setSelBar(null)}>×</button>
        </div>
      )}
    </div>
  );

  if (!portalRoot) return null;

  return createPortal(readerShell, portalRoot);
}
