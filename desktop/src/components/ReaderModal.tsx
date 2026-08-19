// 0.1.4 批 6（决策 10）：统一阅读器——查看与入库分家，一套外壳全格式。
// 顶栏=文件名+格式徽章+conversion 标注+模式切换；内容按 kind 调度：
// text/md→迷你渲染 · html(docx)→受限注入 · table→sheet 页签+分页 ·
// pdf→WebView 原生 iframe / 文本模式双轨 · image→直显 · file→下载原件。
import { useEffect, useState } from "react";
import { api, engineBase } from "../api";
import { mdToHtml } from "../lib/md";
import { sanitizeHtml } from "../lib/sanitize";

interface ViewData {
  doc_id: string; title: string; author: string; format: string;
  conversion: string; has_file: boolean; kind: string;
  content?: string; note?: string; file_url?: string; text?: string;
  sheets?: string[]; sheet?: string; rows?: string[][];
  total_rows?: number; page?: number; page_size?: number;
}

interface Props { docId: string; onClose: () => void }

export default function ReaderModal({ docId, onClose }: Props) {
  const [data, setData] = useState<ViewData | null>(null);
  const [err, setErr] = useState("");
  const [pdfText, setPdfText] = useState(false);   // pdf 文本模式切换
  const [pdfFail, setPdfFail] = useState(false);   // 0.1.5 D2：iframe 失败回退外链

  const load = (sheet = "", page = 0) => {
    api.get<ViewData>(`/api/docs/${docId}/view?sheet=${encodeURIComponent(sheet)}&page=${page}`)
      .then((d) => { setData(d); setErr(""); })
      .catch((e) => setErr(String(e)));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [docId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const fileUrl = data?.file_url ? `${engineBase()}${data.file_url}` : "";
  const totalPages = data?.total_rows && data?.page_size
    ? Math.ceil(data.total_rows / data.page_size) : 1;

  return (
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
        <div className="reader-body">
          {err && <p className="muted">{err}</p>}
          {!data && !err && <p className="muted small">加载中…</p>}
          {data?.note && <p className="muted small">{data.note}</p>}

          {data?.kind === "text" && (
            data.format === "md"
              ? <div className="reader-md"
                     dangerouslySetInnerHTML={{ __html: mdToHtml(data.content || "") }} />
              : <pre className="reader-txt">{data.content}</pre>
          )}

          {data?.kind === "html" && (
            /* 0.1.5 D2：mammoth HTML 白名单净化后再注入（剥 script/on*） */
            <div className="reader-md"
                 dangerouslySetInnerHTML={{ __html: sanitizeHtml(data.content || "") }} />
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
              ? <pre className="reader-txt">{data.text || "（无文字层）"}</pre>
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
    </div>
  );
}
