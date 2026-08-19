// 导入面板（项目12）：拖拽/选择文件与文件夹/URL → 单文件走预览确认卡，
// 多文件走批量接口 + 进度条（轮询项目3进度端点）→ 成功/跳过/失败三栏报告
import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api } from "../api";
import { parseDateInput } from "../lib/dates";

interface Props {
  stances: { name: string; label?: string }[];
  notify: (msg: string) => void;
  onDone: () => void;
  active?: boolean;   // 0.1.5 I1：always-mount 后离面停轮询，回面续上
}

interface Preview {
  doc_id: string;
  title?: string;
  author?: string;
  year?: number;
  source_type?: string;
  doc_summary?: string;
  token_estimate?: number;
  classification?: { stance?: string; confidence?: number; reason?: string };
  duplicate?: { type: string; existing_doc_id: string } | null;
  enriched?: string;
  long_chapters?: number;   // 0.1.5 F5：将拆多趟提取的长章数
  attachments?: string[];   // 0.1.5 A5：页内附件（xls/pdf 链接）
  web_enrich?: { fields: Record<string, string>; source: string; reports: string[] };
}

// 0.1.5 F5：摘要落点窗口（判墙数据源 /api/config/summary-window）
interface SummaryWindow {
  window: number; provider: string; model: string; margin: number;
  sec_per_8k: number;
  cloud: { available: boolean; provider: string; model: string };
  policy: string;
}

interface BatchItem { source: string; status: string; detail: string | null; via?: string }

export default function ImportPanel({ stances, notify, onDone, active = true }: Props) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [meta, setMeta] = useState<Record<string, string>>({});
  const [chosenStance, setChosenStance] = useState("");
  const [onDup, setOnDup] = useState("keep-both");
  const [strategy, setStrategy] = useState("auto");
  const [batch, setBatch] = useState<{ running: boolean; total: number; done: number; items: BatchItem[] } | null>(null);
  const [dragging, setDragging] = useState(false);
  const pollRef = useRef<number | undefined>(undefined);
  // 0.1.5 I1：单本取消=代际号机制；过期响应丢弃
  const runId = useRef(0);
  const activeRef = useRef(active);
  const batchRunningRef = useRef(false);
  // 0.1.5 I2：日期 blur 解析回显；F5：超墙三选
  const [dateHint, setDateHint] = useState("");
  const [sw, setSw] = useState<SummaryWindow | null>(null);
  const [overChoice, setOverChoice] = useState("map_reduce");
  const [rememberOver, setRememberOver] = useState(false);
  const [includeAtt, setIncludeAtt] = useState(false);   // 0.1.5 A5

  // Tauri 原生拖拽（能拿到完整路径，浏览器 DnD 拿不到）
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "over") setDragging(true);
      else if (e.payload.type === "drop") {
        setDragging(false);
        importSources(e.payload.paths);
      } else setDragging(false);
    });
    return () => { un.then((f) => f()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onDup, strategy]);

  useEffect(() => () => window.clearTimeout(pollRef.current), []);

  // 0.1.5 I1：离面时停轮询（防后台空轮询），回面且批量进行中则续上
  useEffect(() => {
    activeRef.current = active;
    if (active && batchRunningRef.current) pollProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const pollProgress = async () => {
    try {
      const p = await api.get<{ running: boolean; total: number; done: number; items: BatchItem[] }>("/api/import/progress");
      setBatch(p);
      batchRunningRef.current = p.running;
      if (p.running) {
        if (activeRef.current)
          pollRef.current = window.setTimeout(pollProgress, 1000);
      } else {
        setBusy("");
        onDone();
      }
    } catch {
      if (activeRef.current)
        pollRef.current = window.setTimeout(pollProgress, 2000);
    }
  };

  const importSources = async (paths: string[]) => {
    if (!paths.length || busy) return;
    if (paths.length === 1) {
      await singleImport(paths[0]);
    } else {
      await batchImport(paths);
    }
  };

  const singleImport = async (source: string) => {
    const id = ++runId.current;   // I1：取消后过期响应丢弃
    setBusy("解析并分析中（大文档可能需要几分钟）…");
    setPreview(null);
    try {
      const pv = await api.post<Preview>("/api/import",
        { source, summary_strategy: strategy });
      if (runId.current !== id) return;   // 已取消：丢弃本次结果
      setPreview(pv);
      setChosenStance(pv.classification?.stance || stances[0]?.name || "");
      // F5：取摘要落点窗口判墙（切槽后重导即按新窗重判）
      api.get<SummaryWindow>("/api/config/summary-window")
        .then(setSw).catch(() => setSw(null));
      setDateHint(""); setOverChoice("map_reduce"); setRememberOver(false);
      setIncludeAtt(false);
      // C4：正文/文件名提取值 + 联网补充值 预填确认屏（只补空，来源可辨）
      const wf = pv.web_enrich?.fields || {};
      setMeta({
        title: pv.title || "", author: pv.author || wf.author || "",
        year: pv.year ? String(pv.year) : (wf.year || ""),
        translator: wf.translator || "", publisher: wf.publisher || "",
        school: wf.school || "", author_years: wf.author_years || "",
        edition: wf.edition || "",
      });
      // 0.1.4 批 6（决策 6）：读记住的归档策略预选（ask 保持默认 copy）
      api.get<{ policy: string }>("/api/import/archive-policy")
        .then((r) => { if (r.policy !== "ask") setArchivePolicy(r.policy); })
        .catch(() => {});
    } catch (e) {
      if (runId.current !== id) return;   // 已取消：静默
      if (String(e).includes("文件夹")) {
        // 拖进来的是目录 → 改走批量接口（服务端递归展开）
        await batchImport([source]);
        return;
      }
      notify(`导入失败: ${e}`);
    } finally {
      if (runId.current === id) setBusy("");
    }
  };

  // 0.1.5 I1：busy 态取消——单本丢弃结果；批量标 cancel，pending 项标「已取消」
  const cancelBusy = async () => {
    if (batchRunningRef.current) {
      try {
        const r = await api.post<{ cancelled: number }>("/api/import/cancel", {});
        notify(`已取消：剩余 ${r.cancelled} 项不再导入（正在跑的一项跑完即止）`);
      } catch (e) { notify(`取消失败: ${e}`); }
    } else {
      runId.current++;
      setBusy("");
      notify("已取消");
    }
  };

  // 0.1.4 批 6：归档三选（复制/迁移/不归档）+「记住选择」写 settings
  const [archivePolicy, setArchivePolicy] = useState("copy");
  const [rememberArchive, setRememberArchive] = useState(false);

  const confirmImport = async () => {
    if (!preview) return;
    setBusy("入库中（切块/向量化/写索引）…");
    try {
      const overWin = overWall
        ? (sw?.policy || (overChoice === "map_reduce" ? "map_reduce" : "full"))
        : undefined;
      await api.post("/api/import/confirm", {
        doc_id: preview.doc_id, stance: chosenStance, on_duplicate: onDup,
        archive: archivePolicy, remember: rememberArchive,
        over_window: overWin,
        remember_over_window: overWall && !sw?.policy ? rememberOver : false,
      });
      // C4/B5：确认屏上编辑过的字段落库（记入 manual_fields，手动永久优先）
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(meta)) {
        const t = v.trim();
        if (!t) continue;
        if (k === "year") {
          // 0.1.5 I2：格式表试解——year 存整数年接筛选，year_raw 原文回显
          const pd = parseDateInput(t);
          if (pd.ok && pd.year) patch.year = pd.year;
          patch.year_raw = t;
        }
        else patch[k] = t;
      }
      if (Object.keys(patch).length) {
        await api.patch(`/api/knowledge/docs/${preview.doc_id}/metadata`, patch)
          .catch((e) => notify(`元数据保存失败: ${e}`));
      }
      notify("入库完成");
      // 0.1.5 A5：勾选后附件走批量管线（URL 列表，逐文件隔离）
      const atts = preview.attachments || [];
      if (includeAtt && atts.length) {
        await batchImport(atts);
      }
      setPreview(null);
      onDone();
    } catch (e) {
      notify(`入库失败: ${e}`);
    } finally {
      setBusy("");
    }
  };

  const batchImport = async (sources: string[]) => {
    setBusy(`批量导入 ${sources.length} 项…`);
    setBatch(null);
    try {
      await api.post("/api/import/batch",
        { sources, on_duplicate: onDup, summary_strategy: strategy });
      batchRunningRef.current = true;
      pollProgress();
    } catch (e) {
      notify(`批量导入失败: ${e}`);
      setBusy("");
    }
  };

  const pickFiles = async () => {
    const sel = await open({
      multiple: true, title: "选择要导入的文档",
      filters: [{ name: "文档", extensions: ["pdf", "docx", "doc", "xlsx", "xls", "csv", "txt", "md", "markdown"] }],
    });
    if (sel) importSources(Array.isArray(sel) ? sel : [sel]);
  };

  const pickFolder = async () => {
    const sel = await open({ directory: true, title: "选择文件夹（递归导入全部支持格式）" });
    if (sel) batchImport([sel as string]);
  };

  const stanceLabel = (k?: string) =>
    stances.find((s) => s.name === k)?.label || k || "未知";

  // 0.1.5 F5：超墙判定（余量线=窗×0.9，后端 margin 已算好）
  const overWall = !!(preview && sw && sw.provider !== "offline" && sw.window > 0
    && (preview.token_estimate ?? 0) > sw.margin);
  const estMin = (secPer8k: number) => {
    const t = Math.ceil((preview?.token_estimate ?? 0) / 8000) * secPer8k + 40;
    return `${Math.max(1, Math.round(t / 60))}–${Math.max(2, Math.round((t * 1.6) / 60))} 分钟`;
  };

  const cols = { success: [] as BatchItem[], skipped: [] as BatchItem[], failed: [] as BatchItem[] };
  for (const it of batch?.items || []) {
    if (it.status === "success") cols.success.push(it);
    else if (it.status === "skipped" || it.status === "cancelled") cols.skipped.push(it);
    else if (it.status === "failed") cols.failed.push(it);
  }

  return (
    <div className="panel import">
      <div className={"dropzone" + (dragging ? " drag" : "")}
           onClick={pickFiles}>
        <p>把文件或文件夹拖到这里，或点击选择文件</p>
        <p className="muted small">支持 PDF / Word / Excel / TXT / Markdown / 网页 URL</p>
        <button className="link" onClick={(e) => { e.stopPropagation(); pickFolder(); }}>
          选择文件夹…
        </button>
      </div>

      <div className="controls">
        <input className="url-input" placeholder="或粘贴网页 URL 后回车导入"
               value={url} onChange={(e) => setUrl(e.target.value)}
               onKeyDown={(e) => {
                 if (e.key === "Enter" && url.trim().match(/^https?:\/\//)) {
                   singleImport(url.trim());
                   setUrl("");
                 }
               }} />
        <label>重复处置
          <select value={onDup} onChange={(e) => setOnDup(e.target.value)}>
            <option value="keep-both">两版共存</option>
            <option value="replace">替换旧版</option>
            <option value="skip">跳过</option>
          </select>
        </label>
        <label>摘要策略
          <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
            <option value="auto">自动</option>
            <option value="map_reduce">Map-Reduce</option>
            <option value="refine">Refine 链</option>
            <option value="full_context">全文投喂</option>
          </select>
        </label>
      </div>

      {busy && (
        <div className="busy">
          <div className="spinner sm" />{busy}
          {/* 0.1.5 I1：入库写索引阶段不可取消（防半成品），其余可取消 */}
          {!busy.startsWith("入库中") && (
            <button className="link" onClick={cancelBusy}>取消</button>
          )}
        </div>
      )}

      {preview && (
        <div className="confirm-card">
          <h3>{meta.title || preview.title || "未命名文档"}</h3>
          <div className="muted small">
            类型：{preview.source_type || "?"} · 约 {preview.token_estimate ?? "?"} tokens
            {preview.web_enrich?.source && ` · 联网核对来源：${preview.web_enrich.source}`}
          </div>
          {preview.duplicate && (
            <div className="demo-warn">
              ⚠ 检测到{preview.duplicate.type === "exact" ? "完全重复"
                : preview.duplicate.type === "new_version" ? "同来源新版本"
                : "语义近似"}文档（{preview.duplicate.existing_doc_id}），
              将按「{{ "keep-both": "两版共存", replace: "替换旧版", skip: "跳过" }[onDup]}」处理
            </div>
          )}
          {/* 0.1.5 F5：超墙提示条（记住后降级一行小字静默） */}
          {overWall && sw && (sw.policy ? (
            <p className="muted small">超窗 → 按记忆走{sw.policy === "full" ? "整书投喂" : "分章压缩"}（已记住选择）</p>
          ) : (
            <div className="demo-warn over-warn">
              <p>⚠ 本书约 {(preview.token_estimate ?? 0).toLocaleString()} tokens
                （≈{Math.max(1, Math.round((preview.token_estimate ?? 0) * 1.5 / 10000))} 万字），
                超过当前总结落点 {sw.model || sw.provider}
                （{Math.round(sw.window / 1024)}k 窗，余量线 {Math.round(sw.margin / 1024)}k）的处理上限。</p>
              <label className="chk">
                <input type="radio" checked={overChoice === "map_reduce"}
                       onChange={() => setOverChoice("map_reduce")} />
                分章压缩再合并（推荐）　预估 {estMin(sw.sec_per_8k)}——跨章连贯靠二次合并，
                逻辑递进类著作摘要略逊整书通读；检索/论证抽取不受影响。
              </label>
              <label className="chk" title={sw.cloud.available ? "" : "未配置云端大窗服务商，去设置·任务分工配置"}>
                <input type="radio" disabled={!sw.cloud.available}
                       checked={overChoice === "cloud_full"}
                       onChange={() => setOverChoice("cloud_full")} />
                换大窗模型整书通读　预估 {estMin(3)}——全文经云端
                （{sw.cloud.available
                    ? `当前可用：${sw.cloud.model || sw.cloud.provider}`
                    : "未配置，去设置·任务分工配置"}）。
              </label>
              <label className="chk">
                <input type="radio" checked={overChoice === "full"}
                       onChange={() => setOverChoice("full")} />
                仍按整书投喂（不推荐）——超出窗口部分直接截断，本书约后
                {Math.max(0, Math.round((1 - sw.window / Math.max(1, preview.token_estimate ?? 1)) * 100))}%
                内容不进摘要与论证单元。
              </label>
              <label className="chk">
                <input type="checkbox" checked={rememberOver}
                       onChange={(e) => setRememberOver(e.target.checked)} />
                记住本次选择
              </label>
              {(preview.long_chapters ?? 0) > 0 && (
                <p className="muted small">另有 {preview.long_chapters} 个长章将拆多趟提取。</p>)}
            </div>
          ))}
          <p className="summary">{preview.doc_summary || "（无摘要）"}
            {!preview.doc_summary && (
              <span className="badge warn" title="入库后可右键文档「补生成摘要」">
                无摘要 · 离线/无模型时生成</span>)}
          </p>
          {/* 0.1.5 A5：页内附件一并下载 */}
          {(preview.attachments?.length ?? 0) > 0 && (
            <label className="chk">
              <input type="checkbox" checked={includeAtt}
                     onChange={(e) => setIncludeAtt(e.target.checked)} />
              发现 {preview.attachments!.length} 个附件
              （{preview.attachments!.slice(0, 3).map((u) =>
                  u.split(".").pop()).join("/")}…），一并下载导入？
            </label>
          )}
          <div className="meta-grid">
            {([["title", "书名 / 标题"], ["author", "作者"], ["translator", "译者"],
               ["publisher", "出版社"], ["year", "年份 / 日期"], ["school", "流派"],
               ["author_years", "作者生卒"], ["edition", "版次"]] as const).map(([k, l]) => (
              <label key={k} className="meta-field">
                <span>{l}{preview.web_enrich?.fields?.[k] &&
                  <em className="enrich-tag">网</em>}</span>
                <input value={meta[k] ?? ""}
                       onChange={(e) => setMeta({ ...meta, [k]: e.target.value })}
                       onBlur={k === "year" ? () => {
                         // I2：blur 即显解析结果（所见即所得）
                         const t = (meta.year ?? "").trim();
                         if (!t) { setDateHint(""); return; }
                         const pd = parseDateInput(t);
                         setDateHint(pd.ok ? `→ ${pd.norm}（年份 ${pd.year}）`
                                           : "未识别，按原文存档");
                       } : undefined} />
                {k === "year" && dateHint &&
                  <em className="muted small">{dateHint}</em>}
              </label>
            ))}
          </div>
          <p className="muted small">
            字段可直接修改；手动修改的字段永久优先（手动 &gt; 正文 &gt; 文件名 &gt; 网上）。
            {(preview.web_enrich?.reports?.length ?? 0) > 0 &&
              ` 联网核对：${preview.web_enrich!.reports.join("；")}`}
          </p>
          <div className="infer">
            AI 推断立场：<b>{stanceLabel(preview.classification?.stance)}</b>
            （置信度 {((preview.classification?.confidence ?? 0) * 100).toFixed(0)}%）
            <div className="muted small">{preview.classification?.reason}</div>
          </div>
          <div className="controls">
            <label>入库立场
              <select value={chosenStance} onChange={(e) => setChosenStance(e.target.value)}>
                {stances.map((s) => <option key={s.name} value={s.name}>{s.label || s.name}</option>)}
              </select>
            </label>
            <label>原件归档
              <select value={archivePolicy} onChange={(e) => setArchivePolicy(e.target.value)}>
                <option value="copy">复制进档案库</option>
                <option value="move">迁移进档案库</option>
                <option value="none">不归档</option>
              </select>
            </label>
            <label className="chk">
              <input type="checkbox" checked={rememberArchive}
                     onChange={(e) => setRememberArchive(e.target.checked)} />
              记住选择
            </label>
            <button className="primary" onClick={confirmImport} disabled={!!busy}>确认入库</button>
            <button onClick={() => setPreview(null)}>取消</button>
          </div>
        </div>
      )}

      {batch && (
        <div className="batch-report">
          <div className="progress">
            <div className="bar" style={{ width: `${batch.total ? (batch.done / batch.total) * 100 : 0}%` }} />
            <span>{batch.done}/{batch.total}{batch.running ? "（进行中）" : "（已完成）"}</span>
          </div>
          <div className="report-cols">
            <div className="report-col ok">
              <h4>成功 {cols.success.length}</h4>
              {cols.success.map((i, k) => <div key={k} className="small">{i.source}
                {i.via && <span className="muted">（落点 {i.via}）</span>}</div>)}
            </div>
            <div className="report-col warn">
              <h4>跳过 {cols.skipped.length}</h4>
              {cols.skipped.map((i, k) => <div key={k} className="small">{i.source}<span className="muted">（{i.detail}）</span></div>)}
            </div>
            <div className="report-col bad">
              <h4>失败 {cols.failed.length}</h4>
              {cols.failed.map((i, k) => <div key={k} className="small">{i.source}<span className="muted">（{i.detail}）</span></div>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
