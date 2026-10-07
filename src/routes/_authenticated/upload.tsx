import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useCallback, useRef } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import * as tus from "tus-js-client";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { RelevanceBadge } from "./dashboard";
import { processNewspaper } from "@/lib/newspapers.functions";
import { generateMcqs } from "@/lib/mcqs.functions";
import {
  generateNewspaperPDF,
  type PDFArticle,
  type PDFMCQ,
} from "@/lib/pdf/newspaper-pdf.functions";
import { jsPDF } from "jspdf";
import { Upload as UploadIcon, FileText, Loader2, CheckCircle2, AlertCircle, Trash2, ChevronDown, ChevronUp, Sparkles, Brain, Target, Link2, Lightbulb, BookOpen, Download, ArrowLeftRight, Clock, Zap, Search, ExternalLink, GitBranch, BookMarked, Trophy, Target as TargetIcon, XCircle, Minimize2, Maximize2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/upload")({
  component: UploadPage,
});

const MAX_FILES = 5;
const MAX_SIZE = 500 * 1024 * 1024; // 500 MB

function UploadPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
 const process = useServerFn(processNewspaper);
const gen = useServerFn(generateMcqs);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, { progress: number; status: 'pending' | 'uploading' | 'verifying' | 'completed' | 'error'; error?: string }>>({});
  // Which newspaper's inline Articles/MCQs panel is currently open. Kept as
  // local component state (not a route) so viewing results never depends on
  // client-side route navigation working.
  const [expandedId, setExpandedId] = useState<string | null>(null);
   

  const papers = useQuery({
    queryKey: ["newspapers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("newspapers")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    refetchInterval: (q) =>
      q.state.data?.some((p) => p.status === "processing" || p.status === "pending") ? 3000 : false,
  });

  const del = useMutation({
    mutationFn: async (p: { id: string; storage_path: string }) => {
      await supabase.storage.from("newspapers").remove([p.storage_path]);
      const { error } = await supabase.from("newspapers").delete().eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["newspapers"] });
      qc.invalidateQueries({ queryKey: ["articles"] });
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
  });

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    if (list.length + (papers.data?.length ?? 0) > MAX_FILES) {
      toast.error(`Maximum ${MAX_FILES} newspapers total.`);
      return;
    }
    for (const f of list) {
      if (f.type !== "application/pdf") { toast.error(`${f.name}: only PDFs allowed`); return; }
      if (f.size > MAX_SIZE) { toast.error(`${f.name}: exceeds 500 MB`); return; }
    }

    setUploading(true);
    try {
      const { data: { user }, error: userErr } = await supabase.auth.getUser();
      if (userErr || !user) throw new Error("Not signed in");
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (!accessToken) throw new Error("Not signed in");

      const projectUrl = (import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, "");

      // Standard supabase.storage.upload() uses a single multipart request,
      // which becomes unreliable for large files (Supabase's own docs
      // recommend TUS resumable upload for anything over 6MB — our
      // newspaper PDFs are routinely much larger). TUS uploads in small
      // chunks with resume support, avoiding the large-file failures the
      // standard method can hit in the browser.
      const uploadViaTus = (file: File, path: string) =>
  new Promise<void>((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: `${projectUrl}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-upsert": "false",
      },
      uploadDataDuringCreation: false,
      removeFingerprintOnSuccess: true,

      metadata: {
        bucketName: "newspapers",
        objectName: path,
        contentType: "application/pdf",
        cacheControl: "3600",
      },

      chunkSize: 6 * 1024 * 1024,

      onError: (error) => {
        console.error("[TUS UPLOAD ERROR]", error);
        reject(error);
      },

      onProgress: (bytesUploaded, bytesTotal) => {
        const progress = Math.round((bytesUploaded / bytesTotal) * 100);
        setUploadProgress(prev => ({
          ...prev,
          [path]: { progress, status: 'uploading' }
        }));
      },

      onSuccess: async () => {
        try {
          console.log(
            `[STORAGE VERIFY] Upload completed: ${path}`,
          );

          setUploadProgress(prev => ({
            ...prev,
            [path]: { progress: 100, status: 'verifying' }
          }));

          // Give Supabase Storage a short moment to make
          // the newly uploaded object available for reads.
          await new Promise((r) => setTimeout(r, 1000));

          const { data, error } = await supabase.storage
            .from("newspapers")
            .list(path.substring(0, path.lastIndexOf("/")), {
              search: path.substring(path.lastIndexOf("/") + 1),
              limit: 1,
            });

          if (error) {
            console.error(
              "[STORAGE VERIFY] Storage verification failed:",
              error,
            );
            setUploadProgress(prev => ({
              ...prev,
              [path]: { progress: 100, status: 'error', error: error.message }
            }));
            reject(error);
            return;
          }

          const fileName = path.substring(
            path.lastIndexOf("/") + 1,
          );

          const exists = data?.some(
            (item) => item.name === fileName,
          );

          if (!exists) {
            setUploadProgress(prev => ({
              ...prev,
              [path]: { progress: 100, status: 'error', error: 'File not found after upload' }
            }));
            reject(
              new Error(
                `Upload completed but Supabase Storage object was not found: ${path}`,
              ),
            );
            return;
          }

          console.log(
            `[STORAGE VERIFY] Confirmed object exists: ${path}`,
          );

          setUploadProgress(prev => ({
            ...prev,
            [path]: { progress: 100, status: 'completed' }
          }));

          resolve();
        } catch (error) {
          console.error(
            "[STORAGE VERIFY] Unexpected verification error:",
            error,
          );
          setUploadProgress(prev => ({
            ...prev,
            [path]: { progress: 100, status: 'error', error: error instanceof Error ? error.message : 'Verification failed' }
          }));
          reject(error);
        }
      },
    });

    upload
      .findPreviousUploads()
      .then((previous) => {
        if (previous.length) {
          console.log(
            "[TUS] Resuming previous upload.",
          );
          upload.resumeFromPreviousUpload(previous[0]);
        }

        upload.start();
      })
      .catch(reject);
  });

      // Initialize progress tracking for all files
      for (const f of list) {
        const path = `${user.id}/${crypto.randomUUID()}-${f.name}`;
        setUploadProgress(prev => ({
          ...prev,
          [path]: { progress: 0, status: 'pending' }
        }));
      }

      // Upload files in parallel with concurrency limit (max 2 at a time)
      const CONCURRENCY_LIMIT = 2;
      const uploadPromises: Promise<{ file: File; path: string; newspaperId: string }>[] = [];
      
      for (const f of list) {
        const path = `${user.id}/${crypto.randomUUID()}-${f.name}`;
        
        const uploadPromise = (async () => {
          await uploadViaTus(f, path);

          const { data: row, error: insErr } = await supabase
            .from("newspapers")
            .insert({ user_id: user.id, name: f.name, storage_path: path, status: "pending" })
            .select("id")
            .single();
          if (insErr) throw insErr;

          // Start background processing
          try {
            await process({ data: { newspaperId: row.id } });
            toast.success(`${f.name} uploaded — processing started in background`);
          } catch (processErr) {
            console.error("Failed to start processing:", processErr);
            toast.success(`${f.name} uploaded — processing queued`);
          }
          qc.invalidateQueries({ queryKey: ["newspapers"] });

          return { file: f, path, newspaperId: row.id };
        })();
        
        uploadPromises.push(uploadPromise);
        
        // Limit concurrency
        if (uploadPromises.length >= CONCURRENCY_LIMIT) {
          await Promise.all(uploadPromises);
          uploadPromises.length = 0;
        }
      }
      
      // Wait for remaining uploads
      if (uploadPromises.length > 0) {
        await Promise.all(uploadPromises);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      // Clear progress after a delay
      setTimeout(() => setUploadProgress({}), 5000);
    }
  }

  const remaining = MAX_FILES - (papers.data?.length ?? 0);

  return (
    <AppShell>
      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Upload</p>
        <h1 className="mt-1 font-serif text-3xl md:text-4xl">Add today's newspapers</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Up to {MAX_FILES} PDFs at a time · Max 500 MB each · Larger PDFs may take a few minutes to analyse.
        </p>
      </div>

      <label
        htmlFor="file"
        className={
          "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed border-border bg-card p-12 text-center transition-colors hover:border-accent " +
          (remaining <= 0 ? "pointer-events-none opacity-50" : "")
        }
      >
        <UploadIcon className="h-10 w-10 text-accent" />
        <div>
          <p className="font-serif text-lg">Drop PDFs or click to browse</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {remaining > 0 ? `${remaining} slot${remaining === 1 ? "" : "s"} remaining` : "Delete an existing paper to add more"}
          </p>
        </div>
        <input
          id="file"
          type="file"
          multiple
          accept="application/pdf"
          disabled={uploading || remaining <= 0}
          onChange={(e) => { handleFiles(e.target.files); e.currentTarget.value = ""; }}
          className="hidden"
        />
      </label>

      {/* Upload Progress Display */}
      {Object.keys(uploadProgress).length > 0 && (
        <div className="mt-6 space-y-3" role="region" aria-label="Upload progress">
          {/* Overall Progress */}
          <div className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-4 mb-2">
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 text-accent animate-spin" />
                <div>
                  <p className="font-medium text-sm">Overall Upload Progress</p>
                  <p className="text-xs text-muted-foreground">
                    {Object.values(uploadProgress).filter(p => p.status === 'completed').length} of {Object.keys(uploadProgress).length} files completed
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono tabular-nums text-muted-foreground w-10 text-right">
                  {Math.round(Object.values(uploadProgress).reduce((sum, p) => sum + p.progress, 0) / Object.keys(uploadProgress).length)}%
                </span>
              </div>
            </div>
            <div className="h-3 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all duration-300"
                style={{ width: `${Math.round(Object.values(uploadProgress).reduce((sum, p) => sum + p.progress, 0) / Object.keys(uploadProgress).length)}%` }}
              />
            </div>
          </div>

          <h3 className="text-sm font-medium">File Details</h3>
          {Object.entries(uploadProgress).map(([path, progress]) => {
            const fileName = path.substring(path.lastIndexOf("/") + 1);
            const isError = progress.status === 'error';
            const isComplete = progress.status === 'completed';
            return (
              <div key={path} className="rounded-lg border bg-card p-4 animate-fade-in">
                <div className="flex items-center justify-between gap-4 mb-2">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <FileText className={`h-5 w-5 flex-shrink-0 ${isError ? 'text-destructive' : isComplete ? 'text-primary' : 'text-muted-foreground'}`} />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-sm">{fileName}</p>
                      <p className="text-xs text-muted-foreground capitalize">{progress.status}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-mono tabular-nums text-muted-foreground w-10 text-right">
                      {progress.progress}%
                    </span>
                    {isError && (
                      <button
                        onClick={() => setUploadProgress(prev => {
                          const next = { ...prev };
                          delete next[path];
                          return next;
                        })}
                        className="text-xs text-destructive hover:underline"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      isError ? 'bg-destructive' : isComplete ? 'bg-primary' : 'bg-accent'
                    }`}
                    style={{ width: `${progress.progress}%` }}
                  />
                </div>
                {isError && progress.error && (
                  <p className="mt-1 text-xs text-destructive">{progress.error}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-10">
        <h2 className="mb-3 font-serif text-xl">Your newspapers</h2>
        <div className="divide-y divide-border rounded-md border border-border bg-card">
          {papers.isLoading && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
          {papers.data?.length === 0 && <div className="p-6 text-sm text-muted-foreground">Nothing here yet.</div>}
          {papers.data?.map((p) => (
            <div key={p.id}>
              <div className="flex items-center gap-4 p-4">
                <FileText className="h-5 w-5 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(p.created_at).toLocaleString()}
                    {p.error_message ? ` · ${p.error_message}` : ""}
                  </p>
                </div>
                <StatusPill status={p.status} processingStage={p.processing_stage} />
                
                {p.status === "completed" && (
  <div className="flex items-center gap-2">
    <button
      onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
      className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-accent hover:bg-secondary"
    >
      {expandedId === p.id ? "Hide Articles" : "Articles"}
      {expandedId === p.id ? (
        <ChevronUp className="h-3.5 w-3.5" />
      ) : (
        <ChevronDown className="h-3.5 w-3.5" />
      )}
    </button>

    <a
      href={`/playground/${p.id}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center rounded-md border border-border px-3 py-1.5 text-xs font-medium text-accent hover:bg-secondary"
    >
      Practice Set
    </a>
  </div>
)}
                <button
                  onClick={() => del.mutate({ id: p.id, storage_path: p.storage_path })}
                  className="rounded p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              {expandedId === p.id && <NewspaperResultsPanel newspaperId={p.id} />}
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function StatusPill({ status, processingStage }: { status: string; processingStage?: string }) {
  // Show detailed processing stage if available
  if (status === "processing" || status === "accepted") {
    const stage = processingStage || "queued";
    const stageLabels: Record<string, string> = {
      queued: "Queued",
      pdf_downloading: "Downloading PDF",
      ocr_running: "Running OCR",
      ai_analyzing: "AI Analysis",
      ai_analyzing_chunk_: "AI Analysis",
      mcq_generating: "Generating MCQs",
      completed: "Complete",
      failed: "Failed",
    };
    
    const label = Object.entries(stageLabels).find(([key]) => stage.startsWith(key))?.[1] 
      || stage.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        {label}
      </span>
    );
  }
  
  if (status === "completed")
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary"><CheckCircle2 className="h-3 w-3" />Ready</span>;
  if (status === "failed")
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-xs text-destructive"><AlertCircle className="h-3 w-3" />Failed</span>;
  if (status === "pending")
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" />Pending</span>;
  return <span className="text-xs text-muted-foreground">{status}</span>;
}

// Helper: extract 3 key facts from article content
function extractKeyFacts(content: string | null | undefined): string[] {
  if (!content) return [];
  const sentences = content.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 20);
  const factSentences = sentences.filter(s => 
    /\b(Article|Section|Act|Bill|Scheme|Policy|Commission|Committee|Report|Judgment|Court|Ministry|Department|Organization|Treaty|Agreement|Index|Rank|Percentage|Rate|Amount|Date|Year)\b/i.test(s)
  );
  return factSentences.slice(0, 3).map(s => s.replace(/^\s*[-•]\s*/, ''));
}

// Helper: generate memory aid from topics and key concepts
function generateMemoryAid(topics: string[] | null | undefined, subject: string | null | undefined): string | null {
  if (!topics || topics.length === 0) return null;
  const keyWords = topics.slice(0, 3).map(t => t.split(' ').map(w => w[0].toUpperCase()).join(''));
  const subjectPrefix = subject ? subject.slice(0, 3).toUpperCase() : '';
  const combined = [...(subjectPrefix ? [subjectPrefix] : []), ...keyWords].filter(Boolean);
  if (combined.length < 2) return null;
  return combined.join('-');
}

// Structured Article Card Component for better memorization
function StructuredArticleCard({ 
  article, 
  mcqCount, 
  onGenerateMCQs, 
  genBusyFor,
  newspaperId
}: { 
  article: {
    id: string;
    title: string;
    content: string | null;
    summary: string | null;
    subject: string | null;
    gs_paper: string | null;
    topics: string[] | null;
    upsc_relevance_score: number | null;
    upsc_reasoning: string | null;
    is_hot_topic: boolean | null;
  };
  mcqCount: number;
  onGenerateMCQs: (article: { id: string; title: string; upsc_relevance_score: number | null }) => void;
  genBusyFor: string | null;
  newspaperId: string;
}) {
  const keyFacts = extractKeyFacts(article.content);
  const memoryAid = generateMemoryAid(article.topics, article.subject);
  const hook = article.upsc_reasoning?.split('.')[0] || article.title;
  const staticLinkage = [
    article.subject,
    article.gs_paper,
    ...(article.topics?.slice(0, 4) ?? [])
  ].filter(Boolean);

  // Inter-linkage state
  const [linkageOpen, setLinkageOpen] = useState(false);
  const [linkageData, setLinkageData] = useState<{
    sameTopic: Array<{ id: string; title: string; subject: string | null; upsc_relevance_score: number | null; newspaper_name: string; created_at: string }>;
    sameSubject: Array<{ id: string; title: string; topics: string[] | null; upsc_relevance_score: number | null; newspaper_name: string; created_at: string }>;
    staticLinks: Array<{ label: string; value: string }>;
    mcqStats: { attempted: number; correct: number; accuracy: number } | null;
  } | null>(null);
  const [linkageLoading, setLinkageLoading] = useState(false);

  const fetchLinkages = async () => {
    if (linkageData) { setLinkageOpen(!linkageOpen); return; }
    if (!newspaperId) return;
    const currentNewspaperId = newspaperId;
    setLinkageLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 1. Same topic articles from OTHER newspapers (last 30 days)
      const topics = article.topics ?? [];
      let sameTopic: Array<{ id: string; title: string; subject: string | null; upsc_relevance_score: number | null; newspaper_name: string; created_at: string }> = [];
      if (topics.length > 0) {
        const { data } = await supabase
          .from("articles")
          .select(`
            id, title, subject, upsc_relevance_score, created_at,
            newspaper:newspapers!inner(name)
          `)
          .eq("user_id", user.id)
          .neq("newspaper_id", currentNewspaperId)
          .overlaps("topics", topics)
          .gte("created_at", new Date(Date.now() - 30*24*60*60*1000).toISOString())
          .order("upsc_relevance_score", { ascending: false })
          .limit(5);
        sameTopic = (data ?? []).map(a => ({
          id: a.id,
          title: a.title,
          subject: a.subject,
          upsc_relevance_score: a.upsc_relevance_score,
          newspaper_name: (a.newspaper as any)?.name || "Unknown",
          created_at: a.created_at,
        }));
      }

      // 2. Same subject articles from recent days (different topics)
      if (article.subject) {
        const { data: sameSubjectData } = await supabase
          .from("articles")
          .select(`
            id, title, topics, upsc_relevance_score, created_at,
            newspaper:newspapers!inner(name)
          `)
          .eq("user_id", user.id)
          .neq("newspaper_id", currentNewspaperId)
          .eq("subject", article.subject)
          .gte("created_at", new Date(Date.now() - 14*24*60*60*1000).toISOString())
          .order("upsc_relevance_score", { ascending: false })
          .limit(5);
        const sameSubject = (sameSubjectData ?? [])
          .filter(a => (a.topics ?? []).some(t => !topics.includes(t))) // different topic
          .map(a => ({
            id: a.id,
            title: a.title,
            topics: a.topics,
            upsc_relevance_score: a.upsc_relevance_score,
            newspaper_name: (a.newspaper as any)?.name || "Unknown",
            created_at: a.created_at,
          }));
        setLinkageData(prev => prev ? { ...prev, sameSubject } : { sameTopic, sameSubject, staticLinks: [], mcqStats: null });
      } else {
        setLinkageData(prev => prev ? { ...prev, sameSubject: [] } : { sameTopic, sameSubject: [], staticLinks: [], mcqStats: null });
      }

      // 3. Static syllabus connections
      const staticLinks: Array<{ label: string; value: string }> = [];
      if (article.subject === "Polity" || article.subject === "Governance") {
        staticLinks.push({ label: "Key Articles", value: "Art 12, 13, 14-32, 36-51, 123, 213, 352-360" });
        staticLinks.push({ label: "Commissions", value: "Sarkaria, Punchhi, Venkatachaliah, NCRWC" });
      }
      if (article.subject === "Economy") {
        staticLinks.push({ label: "Key Concepts", value: "Fiscal/Monetary Policy, FRBM, RBI Act, Banking Regulation, Inflation targeting" });
        staticLinks.push({ label: "Reports", value: "Economic Survey, Budget, RBI Monetary Policy Report, WTO/IMF reports" });
      }
      if (article.subject === "Environment") {
        staticLinks.push({ label: "Key Acts", value: "EPA 1986, Wildlife Protection 1972, Forest Conservation 1980, Biodiversity 2002" });
        staticLinks.push({ label: "Conventions", value: "UNFCCC, CBD, CITES, Ramsar, Montreal, Kyoto, Paris" });
      }
      if (article.subject === "International Relations") {
        staticLinks.push({ label: "Frameworks", value: "Panchsheel, Gujral Doctrine, Neighbourhood First, Act East, SAGAR" });
        staticLinks.push({ label: "Groupings", value: "QUAD, BRICS, SCO, G20, IORA, BIMSTEC, SAARC" });
      }
      if (article.subject === "Science & Technology") {
        staticLinks.push({ label: "Key Areas", value: "Space (ISRO), Defence (DRDO), Nuclear (DAE), Biotech, IT, Telecom, Emerging Tech" });
        staticLinks.push({ label: "Policies", value: "Science Policy 2013, DRDO Policy, Space Policy 2023, Data Protection, Telecom Bill" });
      }
      if (article.gs_paper) {
        staticLinks.push({ label: `GS Paper`, value: article.gs_paper });
      }

      // 4. MCQ performance on this article's topics
      let mcqStats = null;
      if (topics.length > 0) {
        const { data: attempts } = await supabase
          .from("mcq_attempts")
          .select("is_correct")
          .eq("user_id", user.id)
          .in("topic", topics);
        if (attempts && attempts.length > 0) {
          const correct = attempts.filter(a => a.is_correct).length;
          mcqStats = { attempted: attempts.length, correct, accuracy: Math.round((correct / attempts.length) * 100) };
        }
      }

      // Build sameSubject array (may be empty)
      let sameSubject: Array<{ id: string; title: string; topics: string[] | null; upsc_relevance_score: number | null; newspaper_name: string; created_at: string }> = [];
      if (article.subject) {
        const { data: sameSubjectData } = await supabase
          .from("articles")
          .select(`
            id, title, topics, upsc_relevance_score, created_at,
            newspaper:newspapers!inner(name)
          `)
          .eq("user_id", user.id)
          .neq("newspaper_id", currentNewspaperId)
          .eq("subject", article.subject)
          .gte("created_at", new Date(Date.now() - 14*24*60*60*1000).toISOString())
          .order("upsc_relevance_score", { ascending: false })
          .limit(5);
        sameSubject = (sameSubjectData ?? [])
          .filter(a => (a.topics ?? []).some(t => !topics.includes(t))) // different topic
          .map(a => ({
            id: a.id,
            title: a.title,
            topics: a.topics,
            upsc_relevance_score: a.upsc_relevance_score,
            newspaper_name: (a.newspaper as any)?.name || "Unknown",
            created_at: a.created_at,
          }));
      }

      setLinkageData({ sameTopic, sameSubject, staticLinks, mcqStats });
      setLinkageOpen(true);
    } catch (e) {
      console.error("Linkage fetch error:", e);
    } finally {
      setLinkageLoading(false);
    }
  };

  return (
    <div key={article.id} className="rounded-md border border-border/70 bg-card p-4 space-y-3">
      {/* Header with Title & Relevance */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-serif text-sm font-medium leading-snug">{article.title}</p>
          {article.upsc_relevance_score !== null && (
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              UPSC Relevance: {article.upsc_relevance_score}/100 {article.is_hot_topic && '• 🔥 Hot Topic'}
            </p>
          )}
        </div>
        {mcqCount === 0 && (
          <button
            onClick={() => onGenerateMCQs({ id: article.id, title: article.title, upsc_relevance_score: article.upsc_relevance_score })}
            disabled={genBusyFor === article.id}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs text-primary-foreground disabled:opacity-60"
          >
            {genBusyFor === article.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Generate MCQs
          </button>
        )}
        {mcqCount > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-600">
            <CheckCircle2 className="h-2.5 w-2.5" /> {mcqCount} MCQ{mcqCount === 1 ? '' : 's'} Ready
          </span>
        )}
      </div>

      {/* 🎯 ONE-LINE HOOK */}
      <div className="rounded bg-accent/10 border border-accent/20 p-3">
        <div className="flex items-start gap-2">
          <Target className="h-3.5 w-3.5 shrink-0 mt-0.5 text-accent" />
          <p className="text-xs font-medium text-accent leading-snug">{hook}</p>
        </div>
      </div>

      {/* 📌 KEY FACTS */}
      {keyFacts.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            <Brain className="h-3 w-3" /> Key Facts
          </p>
          <ul className="space-y-1 pl-4">
            {keyFacts.map((fact, i) => (
              <li key={i} className="text-xs text-foreground/80 flex items-start gap-1">
                <span className="text-accent shrink-0">•</span>
                <span>{fact}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 🔗 STATIC LINKAGE */}
      {staticLinkage.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
            <Link2 className="h-3 w-3" /> Static Linkage
          </p>
          <div className="flex flex-wrap gap-1">
            {staticLinkage.map((tag, i) => (
              <span
                key={i}
                className="rounded border border-border/50 bg-background px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 💡 WHY IT MATTERS (Mains Angle) */}
      {article.upsc_reasoning && article.upsc_reasoning.length > 50 && (
        <div className="rounded border-l-2 border-primary/30 bg-primary/5 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-primary flex items-center gap-1">
            <Lightbulb className="h-3 w-3" /> Why It Matters
          </p>
          <p className="mt-1 text-xs text-foreground/70 leading-relaxed">
            {article.upsc_reasoning.slice(0, 300)}{article.upsc_reasoning.length > 300 ? '...' : ''}
          </p>
        </div>
      )}

      {/* 🧠 MEMORY AID */}
      {memoryAid && (
        <div className="rounded bg-amber-50 border border-amber-200 p-2">
          <div className="flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5 text-amber-600" />
            <span className="text-[10px] font-semibold text-amber-800">Memory Aid:</span>
            <code className="text-xs font-mono bg-amber-100 px-1.5 py-0.5 rounded text-amber-800">
              {memoryAid}
            </code>
          </div>
        </div>
      )}

      {/* 🔗 INTER-LINKAGE SIDEBAR */}
      <details className="group border-t border-border/50 pt-3">
        <summary 
          onClick={(e) => { e.preventDefault(); fetchLinkages(); }}
          className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground"
        >
          <GitBranch className={`h-3 w-3 transition-transform ${linkageOpen ? 'rotate-90' : ''}`} />
          <Zap className="h-3 w-3 text-amber-500" />
          Inter-Linkages
          {linkageLoading && <Loader2 className="h-3 w-3 animate-spin ml-auto" />}
          {linkageData && linkageData.sameTopic.length > 0 && (
            <span className="ml-auto rounded bg-primary/10 px-1.5 py-0.5 text-[9px] text-primary">
              {linkageData.sameTopic.length} related
            </span>
          )}
        </summary>
        {linkageOpen && linkageData && (
          <div className="mt-3 space-y-4 text-xs">
            {/* Same Topic Across Newspapers */}
            {linkageData.sameTopic.length > 0 && (
              <div className="space-y-2">
                <p className="font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <ArrowLeftRight className="h-3 w-3" /> Same Topic — Other Newspapers (30 days)
                </p>
                <div className="grid gap-1.5 pl-2 border-l border-border/50">
                  {linkageData.sameTopic.map((a) => (
                    <Link
                      key={a.id}
                      to="/articles/$articleId"
                      params={{ articleId: a.id }}
                      className="flex items-start gap-2 rounded border border-border/50 bg-background p-2 hover:border-accent/60 transition-colors"
                    >
                      <RelevanceBadge score={a.upsc_relevance_score ?? 0} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-serif text-sm font-medium">{a.title}</p>
                        <div className="flex flex-wrap gap-1 text-[10px]">
                          {a.subject && <span className="rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground">{a.subject}</span>}
                          <span className="rounded bg-amber-50/50 px-1.5 py-0.5 text-amber-600">{a.newspaper_name}</span>
                          <span className="text-muted-foreground">{new Date(a.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Same Subject, Different Topics */}
            {linkageData.sameSubject.length > 0 && (
              <div className="space-y-2">
                <p className="font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <BookMarked className="h-3 w-3" /> Same Subject — Adjacent Topics (14 days)
                </p>
                <div className="grid gap-1.5 pl-2 border-l border-border/50">
                  {linkageData.sameSubject.map((a) => (
                    <Link
                      key={a.id}
                      to="/articles/$articleId"
                      params={{ articleId: a.id }}
                      className="flex items-start gap-2 rounded border border-border/50 bg-background p-2 hover:border-accent/60 transition-colors"
                    >
                      <RelevanceBadge score={a.upsc_relevance_score ?? 0} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-serif text-sm font-medium">{a.title}</p>
                        <div className="flex flex-wrap gap-1 text-[10px]">
                          {a.topics?.slice(0, 3).map((t) => (
                            <span key={t} className="rounded border border-border/50 px-1.5 py-0.5 text-muted-foreground">{t}</span>
                          ))}
                          <span className="rounded bg-amber-50/50 px-1.5 py-0.5 text-amber-600">{a.newspaper_name}</span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Static Syllabus Links */}
            {linkageData.staticLinks.length > 0 && (
              <div className="space-y-2">
                <p className="font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <TargetIcon className="h-3 w-3" /> Static Syllabus Connections
                </p>
                <div className="grid gap-1.5 pl-2 border-l border-border/50">
                  {linkageData.staticLinks.map((link, i) => (
                    <div key={i} className="rounded bg-background p-2 text-left">
                      <p className="font-medium text-primary">{link.label}:</p>
                      <p className="text-xs text-foreground/80 mt-0.5">{link.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* MCQ Performance on Topics */}
            {linkageData.mcqStats && (
              <div className="rounded bg-primary/5 border border-primary/20 p-3">
                <p className="font-semibold uppercase tracking-wide text-primary flex items-center gap-1">
                  <Trophy className="h-3 w-3" /> Your MCQ Performance on These Topics
                </p>
                <div className="mt-2 flex flex-wrap gap-4 text-xs">
                  <span className="flex items-center gap-1">
                    <span className="text-muted-foreground">Attempted:</span>
                    <span className="font-medium">{linkageData.mcqStats.attempted}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="text-muted-foreground">Correct:</span>
                    <span className="font-medium text-emerald-600">{linkageData.mcqStats.correct}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="text-muted-foreground">Accuracy:</span>
                    <span className={`font-medium ${linkageData.mcqStats.accuracy >= 70 ? 'text-emerald-600' : linkageData.mcqStats.accuracy >= 40 ? 'text-amber-600' : 'text-destructive'}`}>
                      {linkageData.mcqStats.accuracy}%
                    </span>
                  </span>
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  {linkageData.mcqStats.accuracy >= 70 ? "✓ Strong — maintain with periodic review" : linkageData.mcqStats.accuracy >= 40 ? "⚠ Developing — focus on weak areas" : "🔴 Needs work — revisit static concepts first"}
                </p>
              </div>
            )}

            {/* No linkages found */}
            {!linkageData.sameTopic.length && !linkageData.sameSubject.length && !linkageData.staticLinks.length && !linkageData.mcqStats && (
              <p className="text-xs text-muted-foreground text-center py-4">
                No cross-newspaper linkages found yet. More uploads = more connections.
              </p>
            )}
          </div>
        )}
      </details>

      {/* Expandable Full Content */}
      <details className="group border-t border-border/50 pt-3">
        <summary className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer hover:text-foreground">
          <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
          Show Full Analysis
        </summary>
        <div className="mt-3 space-y-2 text-xs text-foreground/70">
          {article.summary && (
            <div>
              <p className="font-semibold uppercase tracking-wide text-muted-foreground">Summary</p>
              <p className="mt-1">{article.summary}</p>
            </div>
          )}
          {article.content && (
            <div>
              <p className="font-semibold uppercase tracking-wide text-muted-foreground">Detailed Analysis</p>
              <p className="mt-1 whitespace-pre-wrap">{article.content}</p>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

// Shows this newspaper's Articles and MCQs (with answers + explanations)
// inline, right on the Upload page, entirely via local tab state — no
// client-side route navigation required to view results.
function NewspaperResultsPanel({ newspaperId }: { newspaperId: string }) {
  const qc = useQueryClient();
  const gen = useServerFn(generateMcqs);
  const [tab, setTab] = useState<"articles" | "mcqs" | "flashcards" | "progress">("articles");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [genBusyFor, setGenBusyFor] = useState<string | null>(null);
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [flashcardFlipped, setFlashcardFlipped] = useState(false);
  const [flashcardDifficulty, setFlashcardDifficulty] = useState<Record<string, "again" | "hard" | "good" | "easy">>({});

  const articles = useQuery({
    queryKey: ["newspaper-articles", newspaperId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("articles")
        .select(`
  id,
  title,
  content,
  summary,
  subject,
  gs_paper,
  topics,
  upsc_relevance_score,
  upsc_reasoning,
  is_hot_topic
`)
        .eq("newspaper_id", newspaperId)
        .order("upsc_relevance_score", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const articleIds = (articles.data ?? []).map((a) => a.id);

const mcqs = useQuery({
  queryKey: ["newspaper-mcqs", newspaperId, articleIds.join(",")],
  enabled: articleIds.length > 0,
  queryFn: async () => {
    const { data, error } = await supabase
      .from("mcqs")
      .select("id, article_id, question, options, correct_index, explanation, difficulty, topic")
      .in("article_id", articleIds)
      .order("created_at", { ascending: true });

    if (error) throw error;
    return data ?? [];
  },
});

// Progress Dashboard: fetch MCQ attempts for this newspaper's topics
const attempts = useQuery({
  queryKey: ["newspaper-mcq-attempts", newspaperId, articleIds.join(",")],
  enabled: articleIds.length > 0,
  queryFn: async () => {
    const { data: mcqIds } = await supabase
      .from("mcqs")
      .select("id, topic, difficulty")
      .in("article_id", articleIds);
    
    if (!mcqIds || mcqIds.length === 0) return [];
    
    const ids = mcqIds.map(m => m.id);
    const { data, error } = await supabase
      .from("mcq_attempts")
      .select("mcq_id, is_correct, picked_index, difficulty, subject, topic, created_at")
      .in("mcq_id", ids)
      .order("created_at", { ascending: false });
    
    if (error) throw error;
    return (data ?? []).map(a => ({
      ...a,
      mcq_topic: mcqIds.find(m => m.id === a.mcq_id)?.topic,
      mcq_difficulty: mcqIds.find(m => m.id === a.mcq_id)?.difficulty,
    }));
  },
});

function handleExportPDF() {
  if (!articles.data || articles.data.length === 0) {
    toast.error("No articles available to export");
    return;
  }

  const formattedArticles = articles.data.map((article) => ({
    title: article.title,
    content: article.content,
    summary: article.summary,
    subject: article.subject,
    gs_paper: article.gs_paper,
    topics: article.topics,
    upsc_relevance_score: article.upsc_relevance_score,
    upsc_reasoning: article.upsc_reasoning,
    is_hot_topic: article.is_hot_topic,
  }));

  const formattedMcqs = (mcqs.data ?? []).map((mcq) => ({
    question: mcq.question,
    options: mcq.options as string[],
    correct_answer:
      typeof mcq.correct_index === "number"
        ? String.fromCharCode(65 + mcq.correct_index)
        : null,
    explanation: mcq.explanation,
  }));

  generateNewspaperPDF({
    newspaperName: "UNIE BUDDY Newspaper",
    date: new Date().toLocaleDateString("en-GB"),
    articles: formattedArticles,
    mcqs: formattedMcqs,
  });

  toast.success("Full PDF exported successfully");
}

function handleExportRevisionSheet() {
  if (!articles.data || articles.data.length === 0) {
    toast.error("No articles available to export");
    return;
  }

  const dateStr = new Date().toLocaleDateString("en-GB");
  const hotArticles = articles.data.filter(a => a.is_hot_topic);
  const allTopics = [...new Set(articles.data.flatMap(a => a.topics ?? []))];
  
  const pdf = new jsPDF({
    orientation: "p",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  let y = 15;

  // Title
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.text("UNIE BUDDY — WEEKLY REVISION SHEET", pageWidth / 2, y, { align: "center" });
  y += 8;
  pdf.setFontSize(10);
  pdf.setFont("helvetica", "normal");
  pdf.text(dateStr, pageWidth / 2, y, { align: "center" });
  y += 12;

  // Hot Topics
  if (hotArticles.length > 0) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.setTextColor(220, 38, 38);
    pdf.text("🔴 HOT TOPICS (Must Know)", 15, y);
    pdf.setTextColor(0, 0, 0);
    y += 7;
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    hotArticles.forEach((a) => {
      const line = `• ${a.title} (${a.upsc_relevance_score}/100)`;
      const lines = pdf.splitTextToSize(line, pageWidth - 30);
      pdf.text(lines, 15, y);
      y += lines.length * 5 + 2;
    });
    y += 4;
  }

  // Topic-wise One-Liners
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.text("📚 TOPIC-WISE ONE-LINERS", 15, y);
  y += 7;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  
  const articlesBySubject = new Map<string, typeof articles.data>();
  articles.data.forEach(a => {
    const sub = a.subject || "General";
    const list = articlesBySubject.get(sub) ?? [];
    list.push(a);
    articlesBySubject.set(sub, list);
  });

  articlesBySubject.forEach((arts, subject) => {
    pdf.setFont("helvetica", "bold");
    pdf.text(`${subject}:`, 15, y);
    y += 5;
    pdf.setFont("helvetica", "normal");
    arts.forEach(a => {
      const line = `  → ${a.title.slice(0, 80)} (${a.gs_paper || 'GS?'}, ${a.upsc_relevance_score}/100)`;
      const lines = pdf.splitTextToSize(line, pageWidth - 30);
      pdf.text(lines, 15, y);
      y += lines.length * 4.5 + 1.5;
    });
    y += 3;
  });

  // Prelims Facts
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.text("🎯 PRELIMS FACTS (MCQ-Ready)", 15, y);
  y += 7;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  
  const prelimsFacts = articles.data
    .flatMap(a => extractKeyFacts(a.content).map(f => ({ fact: f, article: a.title })))
    .slice(0, 15);
  
  prelimsFacts.forEach(({ fact }, i) => {
    const line = `${i + 1}. ${fact.slice(0, 120)}`;
    const lines = pdf.splitTextToSize(line, pageWidth - 30);
    pdf.text(lines, 15, y);
    y += lines.length * 4.5 + 1.5;
  });
  y += 4;

  // Inter-linkages
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(12);
  pdf.text("🔗 INTER-LINKAGES", 15, y);
  y += 7;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  
  const linkages = [
    "Track recurring topics across days — they signal exam importance",
    "Hot topics often connect to static syllabus: Articles, Commissions, Reports",
    "Use MCQs to test retention; explanations build Mains answer structure",
  ];
  
  linkages.forEach(l => {
    const lines = pdf.splitTextToSize(`• ${l}`, pageWidth - 30);
    pdf.text(lines, 15, y);
    y += lines.length * 4.5 + 1.5;
  });

  // Footer
  const totalPages = pdf.getNumberOfPages();
  for (let page = 1; page <= totalPages; page++) {
    pdf.setPage(page);
    pdf.setFontSize(7);
    pdf.setFont("helvetica", "normal");
    pdf.text(
      `UNIE BUDDY | Revision Sheet | ${dateStr} | Page ${page} of ${totalPages}`,
      pageWidth / 2,
      pdf.internal.pageSize.getHeight() - 5,
      { align: "center" }
    );
  }

  pdf.save(`UNIE_BUDDY_Revision_Sheet_${dateStr.replace(/\//g, '-')}.pdf`);
  toast.success("Revision Sheet exported successfully");
}
async function handleGenerateMCQs(article: {
  id: string;
  title: string;
  upsc_relevance_score: number | null;
}) {
  const score = article.upsc_relevance_score;

  // Warn only for genuinely low UPSC relevance.
  // Do not block generation — the user can choose to continue.
  if (typeof score === "number" && score <= 40) {
    const confirmed = window.confirm(
      `⚠️ Low UPSC Relevance — ${score}/100\n\n` +
        `"${article.title}" has relatively low UPSC relevance.\n\n` +
        `Generating MCQs for this article may provide limited value for UPSC preparation and will use AI processing time.\n\n` +
        `Do you still want to generate MCQs?`
    );

    if (!confirmed) {
      return;
    }
  }

  try {
    setGenBusyFor(article.id);

    await gen({
      data: {
        articleId: article.id,
        count: 5,
      },
    });

    await qc.invalidateQueries({
      queryKey: ["newspaper-mcqs", newspaperId],
    });

    toast.success("MCQs generated successfully");
  } catch (error) {
    console.error("MCQ generation failed:", error);

    toast.error(
      error instanceof Error
        ? error.message
        : "Failed to generate MCQs",
    );
  } finally {
    setGenBusyFor(null);
  }
}


 const mcqsByArticle = new Map<string, typeof mcqs.data>();
  for (const m of mcqs.data ?? []) {
    const list = mcqsByArticle.get(m.article_id) ?? [];
    list.push(m);
    mcqsByArticle.set(m.article_id, list);
  }

  // Generate flashcards from articles
  const flashcards = useMemo(() => {
    if (!articles.data) return [];
    const cards: Array<{
      id: string;
      articleId: string;
      articleTitle: string;
      front: string;
      back: string;
      topic: string;
      subject: string | null;
    }> = [];
    
    articles.data.forEach((article) => {
      const keyFacts = extractKeyFacts(article.content);
      const topics = article.topics ?? [];
      const subject = article.subject;
      
      // Card 1: Title + Hook
      if (article.upsc_reasoning) {
        cards.push({
          id: `${article.id}-hook`,
          articleId: article.id,
          articleTitle: article.title,
          front: `What is the UPSC significance of: "${article.title}"?`,
          back: article.upsc_reasoning.split('.')[0] + (article.upsc_reasoning.includes('.') ? '.' : ''),
          topic: topics[0] || subject || "General",
          subject,
        });
      }
      
      // Cards for each key fact
      keyFacts.forEach((fact, i) => {
        cards.push({
          id: `${article.id}-fact-${i}`,
          articleId: article.id,
          articleTitle: article.title,
          front: `Key Fact: ${fact.slice(0, 100)}${fact.length > 100 ? '...' : ''}`,
          back: `${fact}\n\nSource: ${article.title}`,
          topic: topics[i % topics.length] || subject || "General",
          subject,
        });
      });
      
      // Card for topics/static linkage
      if (topics.length > 0) {
        cards.push({
          id: `${article.id}-topics`,
          articleId: article.id,
          articleTitle: article.title,
          front: `Topics & Static Linkage for: "${article.title}"`,
          back: `Subject: ${subject || 'N/A'}\nGS Paper: ${article.gs_paper || 'N/A'}\nTopics: ${topics.join(', ')}\nRelevance: ${article.upsc_relevance_score}/100`,
          topic: topics[0],
          subject,
        });
      }
    });
    
    return cards;
  }, [articles.data]);

  // Progress Dashboard: compute topic-wise stats from attempts
  const progressStats = useMemo(() => {
    if (!attempts.data || attempts.data.length === 0) return [];
    
    const topicMap = new Map<string, {
      topic: string;
      subject: string | null;
      total: number;
      correct: number;
      byDifficulty: Record<string, { total: number; correct: number }>;
      lastAttempt: Date;
      firstAttempt: Date;
      streak: number; // consecutive correct
    }>();
    
    // Sort attempts by date ascending for streak calculation
    const sortedAttempts = [...attempts.data].sort((a, b) => 
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
    
    sortedAttempts.forEach((attempt) => {
      const topic = attempt.topic || attempt.mcq_topic || "Unknown";
      const subject = attempt.subject;
      const difficulty = attempt.difficulty || attempt.mcq_difficulty || "unknown";
      
      if (!topicMap.has(topic)) {
        topicMap.set(topic, {
          topic,
          subject,
          total: 0,
          correct: 0,
          byDifficulty: {},
          lastAttempt: new Date(attempt.created_at),
          firstAttempt: new Date(attempt.created_at),
          streak: 0,
        });
      }
      
      const stats = topicMap.get(topic)!;
      stats.total++;
      if (attempt.is_correct) {
        stats.correct++;
        stats.streak++;
      } else {
        stats.streak = 0;
      }
      stats.lastAttempt = new Date(attempt.created_at);
      
      if (!stats.byDifficulty[difficulty]) {
        stats.byDifficulty[difficulty] = { total: 0, correct: 0 };
      }
      stats.byDifficulty[difficulty].total++;
      if (attempt.is_correct) stats.byDifficulty[difficulty].correct++;
    });
    
    // Compute next review date based on SM-2 inspired algorithm
    const now = new Date();
    return [...topicMap.entries()].map(([topic, stats]) => {
      const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
      const daysSinceLastAttempt = Math.floor((now.getTime() - stats.lastAttempt.getTime()) / (1000 * 60 * 60 * 24));
      
      // SM-2 inspired intervals: based on accuracy and streak
      let intervalDays: number;
      if (accuracy >= 90 && stats.streak >= 3) intervalDays = 14;
      else if (accuracy >= 80 && stats.streak >= 2) intervalDays = 7;
      else if (accuracy >= 70) intervalDays = 3;
      else if (accuracy >= 50) intervalDays = 1;
      else intervalDays = 0; // due today
      
      const nextReview = new Date(stats.lastAttempt);
      nextReview.setDate(nextReview.getDate() + intervalDays);
      const isDue = nextReview <= now;
      const daysOverdue = isDue ? Math.floor((now.getTime() - nextReview.getTime()) / (1000 * 60 * 60 * 24)) : 0;
      const daysUntil = !isDue ? Math.ceil((nextReview.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 0;
      
      return {
        topic,
        subject: stats.subject,
        total: stats.total,
        correct: stats.correct,
        accuracy,
        streak: stats.streak,
        byDifficulty: stats.byDifficulty,
        lastAttempt: stats.lastAttempt,
        nextReview,
        isDue,
        daysOverdue,
        daysUntil,
        intervalDays,
      };
    }).sort((a, b) => {
      // Sort: due first, then by accuracy ascending (weakest first)
      if (a.isDue !== b.isDue) return a.isDue ? -1 : 1;
      return a.accuracy - b.accuracy;
    });
  }, [attempts.data]);

  return (
    <div className="space-y-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="inline-flex rounded-md border border-border bg-card p-0.5">
          <button
            onClick={() => { setTab("articles"); setFlashcardIndex(0); setFlashcardFlipped(false); }}
            className={
              "rounded px-3 py-1.5 text-xs font-medium transition-colors " +
              (tab === "articles"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary")
            }
          >
            Articles {articles.data ? `(${articles.data.length})` : ""}
          </button>

          <button
            onClick={() => { setTab("flashcards"); setFlashcardIndex(0); setFlashcardFlipped(false); }}
            className={
              "rounded px-3 py-1.5 text-xs font-medium transition-colors " +
              (tab === "flashcards"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary")
            }
          >
            Flashcards {flashcards.length > 0 ? `(${flashcards.length})` : ""}
          </button>

          <button
            onClick={() => setTab("progress")}
            className={
              "rounded px-3 py-1.5 text-xs font-medium transition-colors " +
              (tab === "progress"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary")
            }
          >
            Progress {attempts.data && attempts.data.length > 0 ? `(${attempts.data.length})` : ""}
          </button>

          {/* MCQs tab hidden temporarily — reserved for premium subscription */}
          {/*
          <button
            onClick={() => setTab("mcqs")}
            className={
              "rounded px-3 py-1.5 text-xs font-medium transition-colors " +
              (tab === "mcqs"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-secondary")
            }
          >
            MCQs {mcqs.data ? `(${mcqs.data.length})` : ""}
          </button>
          */}
        </div>

        <button
          onClick={handleExportPDF}
          disabled={!articles.data || articles.data.length === 0}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FileText className="h-4 w-4" />
          Export Full PDF
        </button>

        <button
          onClick={handleExportRevisionSheet}
          disabled={!articles.data || articles.data.length === 0}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-xs font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Download className="h-4 w-4" />
          Revision Sheet
        </button>
      </div>

      {articles.isLoading && (
        <p className="text-sm text-muted-foreground">
          Loading articles…
        </p>
      )}

      {tab === "articles" && (
        <div className="grid gap-3">
          {(articles.data ?? []).length === 0 && !articles.isLoading && (
            <p className="text-sm text-muted-foreground">
              No articles found for this newspaper.
            </p>
          )}

          {(articles.data ?? []).map((a) => {
            const articleMcqs = mcqsByArticle.get(a.id) ?? [];

            return (
              <StructuredArticleCard
                key={a.id}
                article={a}
                mcqCount={articleMcqs.length}
                onGenerateMCQs={handleGenerateMCQs}
                genBusyFor={genBusyFor}
                newspaperId={newspaperId}
              />
            );
          })}
        </div>
      )}

      {tab === "mcqs" && (
        <div className="grid gap-4">
          {(mcqs.data ?? []).length === 0 && !articles.isLoading && (
            <p className="text-sm text-muted-foreground">
              No MCQs yet. Switch to the Articles tab and click "Generate MCQs" on an article.
            </p>
          )}

          {(articles.data ?? []).map((a) => {
            const list = mcqsByArticle.get(a.id) ?? [];

            if (list.length === 0) return null;

            return (
              <div key={a.id}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {a.title}
                </p>

                <div className="grid gap-3">
                  {list.map((m, idx) => {
                    const isRevealed = revealed[m.id];

                    return (
                      <div
                        key={m.id}
                        className="rounded-md border border-border/70 bg-card p-3"
                      >
                        <p className="text-sm font-medium leading-snug">
                          Q{idx + 1}. {m.question}
                        </p>

                        <div className="mt-2 grid gap-1.5">
                          {(m.options as string[]).map((opt, i) => {
                            const isCorrect = i === m.correct_index;

                            return (
                              <button
                                key={i}
                                onClick={() =>
                                  setRevealed((r) => ({
                                    ...r,
                                    [m.id]: true,
                                  }))
                                }
                                disabled={isRevealed}
                                className={
                                  "rounded border px-2.5 py-1.5 text-left text-xs transition-colors " +
                                  (isRevealed && isCorrect
                                    ? "border-emerald-500/60 bg-emerald-500/10"
                                    : "border-input hover:bg-secondary")
                                }
                              >
                                {String.fromCharCode(65 + i)}. {opt}
                              </button>
                            );
                          })}
                        </div>

                        {isRevealed && m.explanation && (
                          <div className="mt-2 rounded border-l-2 border-accent bg-background p-2 text-xs leading-relaxed">
                            <span className="font-semibold uppercase tracking-wide text-accent">
                              Explanation:{" "}
                            </span>
                            {m.explanation}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "flashcards" && (
        <div className="space-y-4">
          {flashcards.length === 0 && !articles.isLoading && (
            <div className="rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              <p className="font-medium mb-2">No flashcards available</p>
              <p className="text-xs">Generate articles first, then flashcards will be created automatically from key facts and topics.</p>
            </div>
          )}

          {flashcards.length > 0 && (
            <>
              {/* Progress Indicator */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Card {flashcardIndex + 1} of {flashcards.length}</span>
                <div className="flex gap-1">
                  {["again", "hard", "good", "easy"].map((level) => (
                    <span
                      key={level}
                      className={`px-1.5 py-0.5 rounded text-[9px] ${
                        flashcardDifficulty[flashcards[flashcardIndex]?.id] === level
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-secondary-foreground"
                      }`}
                    >
                      {level[0].toUpperCase()}
                    </span>
                  ))}
                </div>
              </div>

              {/* Flashcard */}
              <div className="perspective-1000">
                <div
                  className={`relative w-full h-64 cursor-pointer transition-transform duration-500 transform-style-3d ${
                    flashcardFlipped ? "rotate-y-180" : ""
                  }`}
                  onClick={() => setFlashcardFlipped(!flashcardFlipped)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && setFlashcardFlipped(!flashcardFlipped)}
                >
                  {/* Front */}
                  <div className="absolute w-full h-full backface-hidden rounded-xl border border-border bg-card p-6 flex items-center justify-center">
                    <div className="text-center max-w-md">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                        {flashcards[flashcardIndex].topic}
                        {flashcards[flashcardIndex].subject && (
                          <> · {flashcards[flashcardIndex].subject}</>
                        )}
                      </p>
                      <p className="font-serif text-lg leading-snug text-foreground">
                        {flashcards[flashcardIndex].front}
                      </p>
                      <p className="mt-4 text-xs text-muted-foreground">
                        Click or press Space to flip
                      </p>
                    </div>
                  </div>

                  {/* Back */}
                  <div className="absolute w-full h-full backface-hidden rotate-y-180 rounded-xl border border-border bg-card p-6 flex items-start justify-center">
                    <div className="text-center max-w-md">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-accent mb-2">
                        Answer
                      </p>
                      <p className="font-serif text-base leading-relaxed text-foreground whitespace-pre-wrap">
                        {flashcards[flashcardIndex].back}
                      </p>
                      <p className="mt-3 text-xs text-muted-foreground">
                        Source: {flashcards[flashcardIndex].articleTitle}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Difficulty Buttons */}
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => {
                    setFlashcardDifficulty(prev => ({ ...prev, [flashcards[flashcardIndex].id]: "again" }));
                    setFlashcardIndex(prev => Math.min(prev + 1, flashcards.length - 1));
                    setFlashcardFlipped(false);
                  }}
                  className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
                >
                  Again
                </button>
                <button
                  onClick={() => {
                    setFlashcardDifficulty(prev => ({ ...prev, [flashcards[flashcardIndex].id]: "hard" }));
                    setFlashcardIndex(prev => Math.min(prev + 1, flashcards.length - 1));
                    setFlashcardFlipped(false);
                  }}
                  className="rounded-md border border-amber-500/30 bg-amber-50/50 px-3 py-2 text-xs font-medium text-amber-600 hover:bg-amber-50 transition-colors"
                >
                  Hard
                </button>
                <button
                  onClick={() => {
                    setFlashcardDifficulty(prev => ({ ...prev, [flashcards[flashcardIndex].id]: "good" }));
                    setFlashcardIndex(prev => Math.min(prev + 1, flashcards.length - 1));
                    setFlashcardFlipped(false);
                  }}
                  className="rounded-md border border-emerald-500/30 bg-emerald-50/50 px-3 py-2 text-xs font-medium text-emerald-600 hover:bg-emerald-50 transition-colors"
                >
                  Good
                </button>
                <button
                  onClick={() => {
                    setFlashcardDifficulty(prev => ({ ...prev, [flashcards[flashcardIndex].id]: "easy" }));
                    setFlashcardIndex(prev => Math.min(prev + 1, flashcards.length - 1));
                    setFlashcardFlipped(false);
                  }}
                  className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
                >
                  Easy
                </button>
              </div>

              {/* Navigation */}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => {
                    setFlashcardIndex(prev => Math.max(prev - 1, 0));
                    setFlashcardFlipped(false);
                  }}
                  disabled={flashcardIndex === 0}
                  className="rounded-md border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  ← Previous
                </button>

                <div className="text-xs text-muted-foreground">
                  {Math.round((Object.values(flashcardDifficulty).filter(v => v === "good" || v === "easy").length / flashcards.length) * 100)}% mastered
                </div>

                <button
                  onClick={() => {
                    setFlashcardIndex(prev => Math.min(prev + 1, flashcards.length - 1));
                    setFlashcardFlipped(false);
                  }}
                  disabled={flashcardIndex === flashcards.length - 1}
                  className="rounded-md border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next →
                </button>
              </div>

              {/* Reset Progress */}
              <button
                onClick={() => {
                  setFlashcardDifficulty({});
                  setFlashcardIndex(0);
                  setFlashcardFlipped(false);
                }}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary transition-colors"
              >
                Reset Progress
              </button>
            </>
          )}
        </div>
      )}

      {tab === "progress" && (
        <div className="space-y-4">
          {progressStats.length === 0 && !attempts.isLoading && (
            <div className="rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              <p className="font-medium mb-2">No practice data yet</p>
              <p className="text-xs">Generate MCQs and start practicing to see your progress dashboard.</p>
            </div>
          )}

          {attempts.isLoading && (
            <div className="rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              Loading progress data…
            </div>
          )}

          {progressStats.length > 0 && (
            <>
              {/* Summary Stats */}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-border bg-card p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Topics Practiced</p>
                  <p className="mt-1 font-serif text-3xl font-bold">{progressStats.length}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Total Attempts</p>
                  <p className="mt-1 font-serif text-3xl font-bold">{progressStats.reduce((s, t) => s + t.total, 0)}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Overall Accuracy</p>
                  <p className="mt-1 font-serif text-3xl font-bold">
                    {progressStats.reduce((s, t) => s + t.correct, 0) > 0
                      ? Math.round((progressStats.reduce((s, t) => s + t.correct, 0) / progressStats.reduce((s, t) => s + t.total, 0)) * 100)
                      : 0}%
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Due for Review</p>
                  <p className="mt-1 font-serif text-3xl font-bold text-destructive">
                    {progressStats.filter(t => t.isDue).length}
                  </p>
                </div>
              </div>

              {/* Topic Progress Cards */}
              <div className="grid gap-3">
                {progressStats.map((stat) => (
                  <div
                    key={stat.topic}
                    className={`rounded-lg border p-4 ${
                      stat.isDue ? "border-destructive/30 bg-destructive/5" : "border-border bg-card"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-serif text-lg font-medium truncate">{stat.topic}</span>
                          {stat.subject && (
                            <span className="rounded bg-secondary px-2 py-0.5 text-secondary-foreground text-xs shrink-0">
                              {stat.subject}
                            </span>
                          )}
                          {stat.isDue && (
                            <span className="rounded bg-destructive/10 px-2 py-0.5 text-destructive text-xs shrink-0 animate-pulse">
                              ⚠ Due for Review
                            </span>
                          )}
                          {!stat.isDue && stat.daysUntil > 0 && (
                            <span className="rounded bg-emerald-50/50 px-2 py-0.5 text-emerald-600 text-xs shrink-0">
                              ✓ Next in {stat.daysUntil}d
                            </span>
                          )}
                          {stat.streak >= 3 && (
                            <span className="rounded bg-amber-50/50 px-2 py-0.5 text-amber-600 text-xs shrink-0">
                              🔥 {stat.streak} streak
                            </span>
                          )}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Target className="h-3 w-3" />
                            Accuracy: <span className={`font-medium ${stat.accuracy >= 70 ? 'text-emerald-600' : stat.accuracy >= 40 ? 'text-amber-600' : 'text-destructive'}`}>{stat.accuracy}%</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <span>Attempts:</span>
                            <span className="font-medium">{stat.total}</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <span>Correct:</span>
                            <span className="font-medium text-emerald-600">{stat.correct}</span>
                          </span>
                          <span className="flex items-center gap-1">
                            <span>Last:</span>
                            <span className="font-medium">{stat.lastAttempt.toLocaleDateString()}</span>
                          </span>
                        </div>
                      </div>
                      
                      {/* Accuracy Ring */}
                      <div className="shrink-0 relative w-16 h-16">
                        <svg className="w-full h-full -rotate-90">
                          <circle
                            cx="32" cy="32" r="28"
                            className="text-secondary"
                            strokeWidth="4" fill="none"
                          />
                          <circle
                            cx="32" cy="32" r="28"
                            className={stat.accuracy >= 70 ? 'text-emerald-500' : stat.accuracy >= 40 ? 'text-amber-500' : 'text-destructive'}
                            strokeWidth="4" fill="none"
                            strokeDasharray={`${(stat.accuracy / 100) * 175.93} 175.93`}
                            strokeLinecap="round"
                            style={{ transition: 'stroke-dasharray 0.5s ease' }}
                          />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="font-serif text-xl font-bold">{stat.accuracy}%</span>
                        </div>
                      </div>
                    </div>

                    {/* Difficulty Breakdown */}
                    {Object.keys(stat.byDifficulty).length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border/50">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">By Difficulty</p>
                        <div className="flex flex-wrap gap-2">
                          {["easy", "medium", "hard"].map((diff) => {
                            const d = stat.byDifficulty[diff];
                            if (!d) return null;
                            const acc = d.total > 0 ? Math.round((d.correct / d.total) * 100) : 0;
                            return (
                              <span
                                key={diff}
                                className={`rounded-full px-2 py-1 text-[10px] font-medium capitalize ${
                                  acc >= 70 ? 'bg-emerald-50 text-emerald-700' : acc >= 40 ? 'bg-amber-50 text-amber-700' : 'bg-destructive/10 text-destructive'
                                }`}
                              >
                                {diff}: {acc}% ({d.correct}/{d.total})
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Next Review */}
                    <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        <span>
                          Next review: <span className="font-medium">{stat.nextReview.toLocaleDateString()}</span>
                          {stat.isDue && <span className="text-destructive font-medium"> (Overdue {stat.daysOverdue}d)</span>}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          className="rounded border border-border px-2 py-1 text-[10px] hover:bg-secondary transition-colors"
                          onClick={() => {
                            // Navigate to practice set for this topic
                          }}
                        >
                          Practice This Topic
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Study Recommendations */}
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <p className="font-semibold uppercase tracking-wide text-primary flex items-center gap-1">
                  <Target className="h-4 w-4" /> Study Recommendations
                </p>
                <ul className="mt-2 space-y-1 text-xs text-foreground/80">
                  {progressStats.filter(t => t.isDue).length > 0 && (
                    <li>🔴 <strong>{progressStats.filter(t => t.isDue).length} topic(s) overdue</strong> — review today to maintain retention</li>
                  )}
                  {progressStats.filter(t => t.accuracy < 40).length > 0 && (
                    <li>📚 <strong>{progressStats.filter(t => t.accuracy < 40).length} topic(s) below 40%</strong> — re-read static concepts, then re-attempt MCQs</li>
                  )}
                  {progressStats.filter(t => t.accuracy >= 70 && t.streak < 3).length > 0 && (
                    <li>🎯 <strong>High accuracy but low streak</strong> — space out reviews to build long-term retention</li>
                  )}
                  {progressStats.filter(t => t.accuracy >= 90 && t.streak >= 3).length > 0 && (
                    <li>✅ <strong>{progressStats.filter(t => t.accuracy >= 90 && t.streak >= 3).length} topic(s) mastered</strong> — reduce frequency to monthly maintenance</li>
                  )}
                  {!progressStats.some(t => t.isDue) && progressStats.every(t => t.accuracy >= 70) && (
                    <li>🌟 All topics on track! Consider adding new newspapers to expand coverage.</li>
                  )}
                </ul>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
