import { generateNewspaperPDF, type PDFMCQ } from "@/lib/pdf/newspaper-pdf.functions";

import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getNewspaperMcqPool } from "@/lib/mcqs.functions";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import {
  Flag,
  Timer,
  RotateCcw,
  CheckCheck,
  ListTodo,
  Zap,
  BookMarked,
  ArrowLeftRight,
  Keyboard,
  Grid,
  Zap as ZapIcon,
  Volume2,
  CheckCircle2,
  XCircle,
  Sun,
  Moon,
  Monitor,
  Eye,
  Minimize,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/playground/$newspaperId")({
  component: PlaygroundPage,
});
function parseMatchTheFollowing(question: string) {
  const columnIIndex = question.search(/Column\s+I\s*:/i);
  const columnIIIndex = question.search(/Column\s+II\s*:/i);

  if (columnIIndex === -1 || columnIIIndex === -1) {
    return null;
  }

  if (columnIIIndex <= columnIIndex) {
    return null;
  }

  const intro = question.slice(0, columnIIndex).trim();

  const columnIText = question
    .slice(columnIIndex + question.slice(columnIIndex).search(/:/) + 1, columnIIIndex)
    .trim();

  const columnIIText = question
    .slice(columnIIIndex + question.slice(columnIIIndex).search(/:/) + 1)
    .trim();

  const columnI = Array.from(
    columnIText.matchAll(/(?:^|\s)(\d+)\.\s*(.*?)(?=\s+\d+\.\s*|$)/gs),
  ).map((match) => ({
    number: match[1],
    text: match[2].trim(),
  }));

  const columnII = Array.from(
    columnIIText.matchAll(/(?:^|\s)\(?([a-z])\)?\s*(?:[-–—:]\s*)?(.*?)(?=\s+\(?[a-z]\)?\s+|$)/gis),
  ).map((match) => ({
    code: match[1].toLowerCase(),
    text: match[2].trim(),
  }));

  if (columnI.length < 2 || columnII.length < 2) {
    return null;
  }

  return {
    intro,
    columnI,
    columnII,
  };
}

// Detect UPSC question format
type QuestionFormat = "multi-statement" | "assertion-reason" | "matching" | "standard";

function detectQuestionFormat(question: string): QuestionFormat {
  const q = question.toLowerCase();

  // Match the Following
  if (/column\s+i\s*:/i.test(q) && /column\s+ii\s*:/i.test(q)) {
    return "matching";
  }

  // Assertion-Reason
  if (/assertion\s*\(?a\)?\s*:/i.test(q) && /reason\s*\(?r\)?\s*:/i.test(q)) {
    return "assertion-reason";
  }

  // Multi-statement / "How many of the above"
  if (
    /^\s*\d+\.\s/.test(q) && // Starts with numbered statements
    (/(how many|which of the).*(statement|above).*correct/i.test(q) || /statement\s+\d+/i.test(q))
  ) {
    return "multi-statement";
  }

  // Also check for statement pattern in the middle
  const statementMatches = q.match(/\(\d+\)|^\d+\./gm);
  if (statementMatches && statementMatches.length >= 2) {
    if (/(which|how many).*(statement|above).*correct/i.test(q)) {
      return "multi-statement";
    }
  }

  return "standard";
}

// Parse multi-statement question
function parseMultiStatement(question: string) {
  const lines = question
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const statements: string[] = [];
  let stem = "";
  let inStatements = false;

  for (const line of lines) {
    if (/^\d+\.\s/.test(line) || /^\(\d+\)\s/.test(line)) {
      inStatements = true;
      statements.push(line.replace(/^[\d\(\)]+\.\s*/, ""));
    } else if (inStatements) {
      // Stem after statements (the "which is/are correct" part)
      stem += (stem ? " " : "") + line;
    } else if (!inStatements) {
      stem += (stem ? " " : "") + line;
    }
  }

  if (statements.length < 2) return null;

  return { stem: stem.trim(), statements };
}

// Parse assertion-reason question
function parseAssertionReason(question: string) {
  const assertionMatch = question.match(
    /assertion\s*\(?a\)?\s*:\s*(.*?)(?=\s*reason\s*\(?r\)?\s*:)/i,
  );
  const reasonMatch = question.match(
    /reason\s*\(?r\)?\s*:\s*(.*?)(?=\s*(\(?[a-d]\)?\s*[-–—:]|\s*$))/i,
  );

  if (!assertionMatch || !reasonMatch) return null;

  const assertion = assertionMatch[1].trim();
  const reason = reasonMatch[1].trim();

  // Standard AR options
  const arOptions = [
    "Both A and R are true and R correctly explains A",
    "Both A and R are true but R does not explain A",
    "A is true but R is false",
    "A is false but R is true",
  ];

  return { assertion, reason, arOptions };
}

function PlaygroundPage() {
  const { newspaperId } = useParams({
    from: "/_authenticated/playground/$newspaperId",
  });

  const getPool = useServerFn(getNewspaperMcqPool);

  const pool = useQuery({
    queryKey: ["playground-mcq-pool", newspaperId],
    queryFn: () => getPool({ data: { newspaperId } }),
  });
  console.log("[PLAYGROUND] pool status:", {
    isLoading: pool.isLoading,
    isError: pool.isError,
    isSuccess: pool.isSuccess,
    error: pool.error,
    data: pool.data,
  });

  // State
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const [testMode, setTestMode] = useState(false);
  const [testStartTime, setTestStartTime] = useState<number | null>(null);
  const [flaggedQuestions, setFlaggedQuestions] = useState<Set<number>>(new Set());
  const [showReview, setShowReview] = useState(false);
  const [answers, setAnswers] = useState<Record<number, number>>({});

  // Theme State
  const [theme, setTheme] = useState<"light" | "dark" | "focus">("light");
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">("light");

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("playground-focus");
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    if (theme === "focus") {
      root.classList.add("playground-focus");
    }
  }, [theme]);

  // Detect system theme
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };
    setSystemTheme(mediaQuery.matches ? "dark" : "light");
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  // Modern UX State
  const [showOverview, setShowOverview] = useState(false);
  const [instantFeedback, setInstantFeedback] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const testStateKey = useRef(`playground-test-${newspaperId}`);

  // Initialize AudioContext on first interaction
  const ensureAudioContext = useCallback(() => {
    if (!audioContextRef.current && soundEnabled) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }, [soundEnabled]);

  // Play sound feedback
  const playSound = useCallback(
    (type: "correct" | "incorrect" | "select" | "complete" | "flag") => {
      if (!soundEnabled || !audioContextRef.current) return;

      const ctx = audioContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      switch (type) {
        case "correct":
          osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
          osc.frequency.exponentialRampToValueAtTime(1046.5, ctx.currentTime + 0.15); // C6
          gain.gain.setValueAtTime(0.1, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
          osc.start();
          osc.stop(ctx.currentTime + 0.2);
          break;
        case "incorrect":
          osc.frequency.setValueAtTime(200, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.2);
          gain.gain.setValueAtTime(0.1, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.25);
          osc.start();
          osc.stop(ctx.currentTime + 0.25);
          break;
        case "select":
          osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
          gain.gain.setValueAtTime(0.05, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
          osc.start();
          osc.stop(ctx.currentTime + 0.1);
          break;
        case "complete":
          // Arpeggio: C-E-G-C
          [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.connect(g);
            g.connect(ctx.destination);
            o.frequency.value = freq;
            g.gain.setValueAtTime(0.08, ctx.currentTime + i * 0.1);
            g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.1 + 0.2);
            o.start(ctx.currentTime + i * 0.1);
            o.stop(ctx.currentTime + i * 0.1 + 0.25);
          });
          break;
        case "flag":
          osc.frequency.setValueAtTime(600, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.1);
          gain.gain.setValueAtTime(0.06, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
          osc.start();
          osc.stop(ctx.currentTime + 0.15);
          break;
      }
    },
    [soundEnabled],
  );

  // Persist test state to localStorage
  useEffect(() => {
    if (testMode) {
      const state = {
        currentIndex,
        answers,
        flaggedQuestions: [...flaggedQuestions],
        testStartTime,
        selectedIndex,
        checked,
      };
      localStorage.setItem(testStateKey.current, JSON.stringify(state));
    }
  }, [currentIndex, answers, flaggedQuestions, testStartTime, selectedIndex, checked, testMode]);

  // Restore test state on mount
  useEffect(() => {
    const saved = localStorage.getItem(testStateKey.current);
    if (saved && testMode) {
      try {
        const state = JSON.parse(saved);
        setCurrentIndex(state.currentIndex ?? 0);
        setAnswers(state.answers ?? {});
        setFlaggedQuestions(new Set(state.flaggedQuestions ?? []));
        setTestStartTime(state.testStartTime ?? Date.now());
        setSelectedIndex(state.selectedIndex ?? null);
        setChecked(state.checked ?? false);
      } catch {
        // Ignore corrupted state
      }
    }
  }, [testMode]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      ensureAudioContext();

      switch (e.key) {
        case "ArrowRight":
        case " ":
          if (e.key === " " && checked) {
            handleNext();
            playSound("select");
          } else if (e.key === "ArrowRight") {
            handleNext();
            playSound("select");
          }
          e.preventDefault();
          break;
        case "ArrowLeft":
          handlePrevious();
          playSound("select");
          e.preventDefault();
          break;
        case "Enter":
          if (!checked && selectedIndex !== null) {
            handleCheckAnswer();
            playSound("select");
          }
          e.preventDefault();
          break;
        case "f":
        case "F":
          toggleFlag();
          playSound("flag");
          e.preventDefault();
          break;
        case "1":
        case "2":
        case "3":
        case "4":
          if (!checked) {
            const idx = parseInt(e.key) - 1;
            const optionsLen = (currentMcq.options as unknown as string[])?.length ?? 4;
            if (idx < optionsLen) {
              setSelectedIndex(idx);
              playSound("select");
            }
          }
          e.preventDefault();
          break;
        case "o":
        case "O":
          setShowOverview(!showOverview);
          e.preventDefault();
          break;
        case "r":
        case "R":
          setShowReview(!showReview);
          e.preventDefault();
          break;
        case "?":
          setShowShortcuts(!showShortcuts);
          e.preventDefault();
          break;
        case "Escape":
          setShowOverview(false);
          setShowReview(false);
          setShowShortcuts(false);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    checked,
    selectedIndex,
    ensureAudioContext,
    handleNext,
    handlePrevious,
    handleCheckAnswer,
    toggleFlag,
    showOverview,
    showReview,
  ]);

  // Auto-advance after checking
  useEffect(() => {
    if (autoAdvance && checked && !testMode && currentIndex < sortedMcqs.length - 1) {
      const timer = setTimeout(() => {
        handleNext();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [checked, autoAdvance, testMode, currentIndex, handleNext]);

  // Celebration effect
  useEffect(() => {
    if (celebrate) {
      playSound("complete");
      const timer = setTimeout(() => setCelebrate(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [celebrate, playSound]);

  const mcqs = pool.data?.mcqs ?? [];

  // Sort MCQs by difficulty for progressive practice
  const sortedMcqs = useMemo(() => {
    const difficultyOrder = { easy: 0, medium: 1, hard: 2 };
    return [...mcqs].sort(
      (a, b) =>
        (difficultyOrder[a.difficulty as keyof typeof difficultyOrder] ?? 1) -
        (difficultyOrder[b.difficulty as keyof typeof difficultyOrder] ?? 1),
    );
  }, [mcqs]);

  const currentMcq = sortedMcqs[currentIndex];
  const format = currentMcq ? detectQuestionFormat(currentMcq.question) : "standard";
  const matchData =
    currentMcq && format === "matching" ? parseMatchTheFollowing(currentMcq.question) : null;
  const multiStatementData =
    currentMcq && format === "multi-statement" ? parseMultiStatement(currentMcq.question) : null;
  const arData =
    currentMcq && format === "assertion-reason" ? parseAssertionReason(currentMcq.question) : null;
  function handleExportAllMCQs() {
    if (mcqs.length === 0) return;

    const formattedMcqs: PDFMCQ[] = mcqs.map((mcq) => ({
      id: mcq.id,
      article_id: mcq.article_id,
      question: mcq.question,
      options: Array.isArray(mcq.options) ? mcq.options.map((option) => String(option)) : [],
      correct_index: typeof mcq.correct_index === "number" ? mcq.correct_index : null,
      correct_answer:
        typeof mcq.correct_index === "number" ? String.fromCharCode(65 + mcq.correct_index) : null,
      explanation: mcq.explanation,
      difficulty: mcq.difficulty,
      topic: mcq.topic,
    }));

    generateNewspaperPDF({
      newspaperName: "UNIE BUDDY Practice Set",
      date: new Date().toLocaleDateString("en-GB"),
      articles: [],
      mcqs: formattedMcqs,
    });
  }

  const currentAttempt = useMemo(() => {
    if (!currentMcq || !pool.data?.attempts) return null;

    return pool.data.attempts.find((attempt) => attempt.mcq_id === currentMcq.id);
  }, [currentMcq, pool.data?.attempts]);

  function handleCheckAnswer() {
    if (selectedIndex === null) return;
    setChecked(true);
    if (!testMode) {
      setAnswers((prev) => ({ ...prev, [currentIndex]: selectedIndex }));
    }
  }

  function handleNext() {
    if (currentIndex >= sortedMcqs.length - 1) return;

    setCurrentIndex((index) => index + 1);
    setSelectedIndex(null);
    setChecked(false);
  }

  function handlePrevious() {
    if (currentIndex <= 0) return;

    setCurrentIndex((index) => index - 1);
    setSelectedIndex(null);
    setChecked(false);
  }

  function toggleFlag() {
    setFlaggedQuestions((prev) => {
      const next = new Set(prev);
      if (next.has(currentIndex)) next.delete(currentIndex);
      else next.add(currentIndex);
      return next;
    });
  }

  function startTest() {
    setTestMode(true);
    setTestStartTime(Date.now());
    setCurrentIndex(0);
    setSelectedIndex(null);
    setChecked(false);
    setAnswers({});
  }

  function endTest() {
    setTestMode(false);
    setTestStartTime(null);
    // Could save test results here
  }

  function goToQuestion(index: number) {
    setCurrentIndex(index);
    setSelectedIndex(null);
    setChecked(false);
  }

  const testElapsed = testStartTime ? Math.floor((Date.now() - testStartTime) / 1000) : 0;
  const testMinutes = Math.floor(testElapsed / 60);
  const testSeconds = testElapsed % 60;

  if (pool.isLoading) {
    return (
      <AppShell>
        <div className="mx-auto max-w-4xl p-6">
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <p className="text-sm text-muted-foreground">Loading MCQs...</p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (pool.isError) {
    return (
      <AppShell>
        <div className="mx-auto max-w-4xl p-6">
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-8 text-center">
            <h1 className="font-serif text-2xl font-semibold">Unable to load MCQs</h1>

            <p className="mt-2 text-sm text-muted-foreground">
              {pool.error instanceof Error
                ? pool.error.message
                : "Something went wrong while loading the MCQ pool."}
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (mcqs.length === 0) {
    return (
      <AppShell>
        <div className="mx-auto max-w-4xl p-6">
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <h1 className="font-serif text-2xl font-semibold">MCQ Playground</h1>

            <p className="mt-2 text-sm text-muted-foreground">
              No MCQs are available for this newspaper yet.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  const isCorrect = checked && selectedIndex !== null && selectedIndex === currentMcq.correct_index;

  const progress = ((currentIndex + 1) / sortedMcqs.length) * 100;
  const answeredCount = Object.keys(answers).length;

  // Global styles for animations
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = `
      @keyframes confetti-fall {
        0% {
          transform: translateY(0) rotate(0deg);
          opacity: 1;
        }
        100% {
          transform: translateY(100vh) rotate(360deg);
          opacity: 0;
        }
      }
      @keyframes fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slide-up {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .animate-fade-in { animation: fade-in 0.2s ease-out; }
      .animate-slide-up { animation: slide-up 0.3s ease-out; }
      kbd { box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
      .tabular-nums { font-variant-numeric: tabular-nums; }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl space-y-6 p-6 playground-theme min-h-screen">
        {/* Header */}
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-serif text-3xl font-semibold playground-ink">MCQ Playground</h1>

              <p className="mt-1 text-sm playground-muted">
                Practice with the existing MCQs from this newspaper.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* UX Toggles */}
              <div
                className="flex items-center gap-1 rounded-lg playground-border playground-card/50 px-2 py-1"
                role="group"
                aria-label="Playback options"
              >
                <button
                  onClick={() => {
                    setInstantFeedback(!instantFeedback);
                    ensureAudioContext();
                    playSound("select");
                  }}
                  className={`rounded px-2.5 py-1.5 text-xs font-medium transition-all ${
                    instantFeedback
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "playground-muted hover:bg-secondary"
                  }`}
                  title="Instant Feedback (I)"
                  aria-pressed={instantFeedback}
                >
                  <ZapIcon className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    setAutoAdvance(!autoAdvance);
                    ensureAudioContext();
                    playSound("select");
                  }}
                  className={`rounded px-2.5 py-1.5 text-xs font-medium transition-all ${
                    autoAdvance
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "playground-muted hover:bg-secondary"
                  }`}
                  title="Auto Advance (A)"
                  aria-pressed={autoAdvance}
                >
                  <ArrowLeftRight className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    setSoundEnabled(!soundEnabled);
                    ensureAudioContext();
                    playSound("select");
                  }}
                  className={`rounded px-2.5 py-1.5 text-xs font-medium transition-all ${
                    soundEnabled ? "playground-muted hover:bg-secondary" : "text-destructive/50"
                  }`}
                  title="Sound (M)"
                  aria-pressed={soundEnabled}
                >
                  <Volume2 className={`h-4 w-4 ${!soundEnabled ? "opacity-50" : ""}`} />
                </button>
              </div>

              {/* Theme Toggle */}
              <div
                className="flex items-center gap-1 rounded-lg playground-border playground-card/50 px-2 py-1"
                role="group"
                aria-label="Theme options"
              >
                <button
                  onClick={() => {
                    setTheme("light");
                    ensureAudioContext();
                    playSound("select");
                  }}
                  className={`rounded px-2.5 py-1.5 text-xs font-medium transition-all ${
                    theme === "light"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "playground-muted hover:bg-secondary"
                  }`}
                  title="Light Mode"
                  aria-pressed={theme === "light"}
                >
                  <Sun className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    setTheme("dark");
                    ensureAudioContext();
                    playSound("select");
                  }}
                  className={`rounded px-2.5 py-1.5 text-xs font-medium transition-all ${
                    theme === "dark"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "playground-muted hover:bg-secondary"
                  }`}
                  title="Dark Mode"
                  aria-pressed={theme === "dark"}
                >
                  <Moon className="h-4 w-4" />
                </button>
                <button
                  onClick={() => {
                    setTheme("focus");
                    ensureAudioContext();
                    playSound("select");
                  }}
                  className={`rounded px-2.5 py-1.5 text-xs font-medium transition-all ${
                    theme === "focus"
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "playground-muted hover:bg-secondary"
                  }`}
                  title="Focus Mode (Distraction-free)"
                  aria-pressed={theme === "focus"}
                >
                  <Eye className="h-4 w-4" />
                </button>
              </div>

              {!testMode ? (
                <button
                  type="button"
                  onClick={() => {
                    startTest();
                    ensureAudioContext();
                    playSound("select");
                  }}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all hover:opacity-90 hover:shadow-lg shadow-primary/20"
                >
                  <Zap className="h-4 w-4 inline mr-1" /> Start Test
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <Timer className="h-4 w-4 text-primary" />
                  <span className="font-mono text-lg font-medium text-primary tabular-nums">
                    {testMinutes}:{testSeconds.toString().padStart(2, "0")}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      endTest();
                      ensureAudioContext();
                      playSound("select");
                    }}
                    className="rounded-md border border-destructive px-3 py-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 hover:shadow-sm transition-all"
                  >
                    End Test
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={handleExportAllMCQs}
                className="rounded-md playground-border px-4 py-2 text-sm font-medium transition-all hover:playground-card hover:shadow-sm"
              >
                Export All MCQs as PDF
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowOverview(!showOverview);
                  ensureAudioContext();
                  playSound("select");
                }}
                className={`rounded-md border px-3 py-2 text-sm font-medium transition-all ${
                  showOverview
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "playground-border playground-card hover:bg-secondary"
                }`}
              >
                <Grid className="h-4 w-4 inline mr-1" />
                Overview
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowReview(!showReview);
                  ensureAudioContext();
                  playSound("select");
                }}
                className={`rounded-md border px-3 py-2 text-sm font-medium transition-all ${
                  showReview
                    ? "bg-amber-500 text-amber-foreground border-amber-500 shadow-sm"
                    : "playground-border playground-card hover:bg-secondary"
                }`}
              >
                <Flag className="h-4 w-4 inline mr-1" />
                Review ({flaggedQuestions.size})
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowShortcuts(!showShortcuts);
                  ensureAudioContext();
                  playSound("select");
                }}
                className="rounded-md playground-border px-3 py-2 text-sm font-medium transition-all hover:bg-secondary"
                title="Show Shortcuts (?)"
              >
                <Keyboard className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mt-4 h-2 overflow-hidden rounded-full playground-muted relative">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
            {/* Progress markers */}
            {sortedMcqs.map((_, i) => (
              <span
                key={i}
                className={`absolute top-0 bottom-0 w-px transition-colors ${
                  i <= currentIndex ? "bg-primary" : "bg-border"
                }`}
                style={{ left: `${(i / (sortedMcqs.length - 1)) * 100}%` }}
              />
            ))}
          </div>

          {/* Quick Stats */}
          <div className="mt-2 flex flex-wrap gap-4 text-xs playground-muted">
            <span>
              Progress: <span className="font-medium playground-ink">{currentIndex + 1}</span> /{" "}
              {sortedMcqs.length}
            </span>
            <span>
              Answered: <span className="font-medium playground-ink">{answeredCount}</span>
            </span>
            <span>
              Flagged: <span className="font-medium text-amber-600">{flaggedQuestions.size}</span>
            </span>
            {testMode && (
              <span>
                Mode: <span className="font-medium text-primary">Test</span>
              </span>
            )}
          </div>
        </div>

        {/* Question Overview Grid */}
        {showOverview && (
          <div className="rounded-xl playground-border playground-card p-4 animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2 playground-ink">
                <Grid className="h-5 w-5" />
                Question Overview
              </h3>
              <button
                onClick={() => setShowOverview(false)}
                className="text-sm playground-muted hover:playground-ink"
              >
                Close
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2 max-h-60 overflow-y-auto">
              {sortedMcqs.map((mcq, idx) => {
                const userAnswer = answers[idx];
                const isCorrect = userAnswer !== undefined && userAnswer === mcq.correct_index;
                const isCurrent = idx === currentIndex;
                return (
                  <button
                    key={idx}
                    onClick={() => {
                      setCurrentIndex(idx);
                      setSelectedIndex(null);
                      setChecked(false);
                      setShowOverview(false);
                      ensureAudioContext();
                      playSound("select");
                    }}
                    className={`relative rounded-lg border p-2 text-center transition-all ${
                      isCurrent
                        ? "ring-2 ring-primary border-primary bg-primary/5"
                        : isCorrect
                          ? "border-emerald-200 bg-emerald-50 hover:border-emerald-300"
                          : userAnswer !== undefined
                            ? "border-destructive/20 bg-destructive/5 hover:border-destructive/30"
                            : flaggedQuestions.has(idx)
                              ? "border-amber-200 bg-amber-50 hover:border-amber-300"
                              : "border-border bg-card hover:bg-secondary"
                    }`}
                  >
                    <span className="font-medium text-sm">{idx + 1}</span>
                    {flaggedQuestions.has(idx) && (
                      <Flag className="absolute top-1 right-1 h-3 w-3 text-amber-500" />
                    )}
                    {isCurrent && (
                      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Question Card */}
        <div className="rounded-xl playground-border playground-card p-6 shadow-sm">
          {/* Metadata */}
          <div className="mb-5 flex flex-wrap items-center gap-2">
            {currentMcq.difficulty && (
              <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium capitalize">
                {currentMcq.difficulty}
              </span>
            )}

            {currentMcq.topic && (
              <span className="rounded-full playground-border px-2.5 py-1 text-xs playground-muted">
                {currentMcq.topic}
              </span>
            )}

            {/* Format Badge */}
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                format === "multi-statement"
                  ? "bg-blue-50 text-blue-700"
                  : format === "assertion-reason"
                    ? "bg-purple-50 text-purple-700"
                    : format === "matching"
                      ? "bg-emerald-50 text-emerald-700"
                      : "playground-muted"
              }`}
            >
              {format === "multi-statement"
                ? "Multi-Statement"
                : format === "assertion-reason"
                  ? "Assertion-Reason"
                  : format === "matching"
                    ? "Match the Following"
                    : "Standard"}
            </span>

            {flaggedQuestions.has(currentIndex) && (
              <span className="text-amber-500" title="Flagged for review">
                <Flag className="h-4 w-4" />
              </span>
            )}
          </div>

          {/* Question Renderer by Format */}
          <div className="mb-6">
            {/* Multi-Statement Format */}
            {multiStatementData && (
              <div className="space-y-4">
                <p className="text-lg font-semibold leading-7 playground-ink">
                  {multiStatementData.stem}
                </p>
                <div className="rounded-lg playground-border playground-card p-4 space-y-3">
                  {multiStatementData.statements.map((stmt, i) => (
                    <div key={i} className="flex gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full playground-border text-xs font-semibold bg-primary/10 text-primary">
                        {i + 1}
                      </span>
                      <p className="pt-0.5 text-sm leading-6 playground-ink">{stmt}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Assertion-Reason Format */}
            {arData && (
              <div className="space-y-4">
                <div className="rounded-lg playground-border playground-card p-4 space-y-3">
                  <div className="flex gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full playground-border text-xs font-semibold bg-blue-50 text-blue-700">
                      A
                    </span>
                    <p className="pt-0.5 text-sm leading-6 font-medium playground-ink">
                      {arData.assertion}
                    </p>
                  </div>
                  <div className="flex gap-3 pt-2 border-t playground-border/50">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full playground-border text-xs font-semibold bg-purple-50 text-purple-700">
                      R
                    </span>
                    <p className="pt-0.5 text-sm leading-6 font-medium playground-ink">
                      {arData.reason}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Match the Following Format */}
            {matchData && !arData && !multiStatementData && (
              <div>
                {matchData.intro && (
                  <p className="text-lg font-semibold leading-7 mb-4 playground-ink">
                    {matchData.intro}
                  </p>
                )}

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  {/* Column I */}
                  <div className="overflow-hidden rounded-lg playground-border">
                    <div className="border-b playground-border bg-secondary px-4 py-3">
                      <h3 className="text-sm font-semibold uppercase tracking-wide playground-ink">
                        Column I
                      </h3>
                    </div>
                    <div className="divide-y playground-border">
                      {matchData.columnI.map((item) => (
                        <div key={item.number} className="flex gap-3 px-4 py-4">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full playground-border text-xs font-semibold">
                            {item.number}
                          </span>
                          <p className="text-sm leading-6 playground-ink">{item.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Column II */}
                  <div className="overflow-hidden rounded-lg playground-border">
                    <div className="border-b playground-border bg-secondary px-4 py-3">
                      <h3 className="text-sm font-semibold uppercase tracking-wide playground-ink">
                        Column II
                      </h3>
                    </div>
                    <div className="divide-y playground-border">
                      {matchData.columnII.map((item) => (
                        <div key={item.code} className="flex gap-3 px-4 py-4">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full playground-border text-xs font-semibold uppercase">
                            {item.code}
                          </span>
                          <p className="text-sm leading-6 playground-ink">{item.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Standard Format */}
            {!multiStatementData && !arData && !matchData && (
              <h2 className="text-lg font-semibold leading-7 playground-ink">
                {currentMcq.question}
              </h2>
            )}
          </div>

          {/* Options */}
          <div className="mt-6 space-y-3">
            {arData && arData.arOptions
              ? // Assertion-Reason uses fixed options
                arData.arOptions.map((option, index) => {
                  const isSelected = selectedIndex === index;
                  const isAnswer = currentMcq.correct_index === index;

                  let optionClass = "playground-border playground-card hover:playground-muted";

                  if (!checked && isSelected) {
                    optionClass = "border-primary bg-primary/5 ring-1 ring-primary";
                  }

                  if (checked && isAnswer) {
                    optionClass = "border-green-500 bg-green-500/10 ring-1 ring-green-500";
                  }

                  if (checked && isSelected && !isAnswer) {
                    optionClass = "border-destructive bg-destructive/10 ring-1 ring-destructive";
                  }

                  return (
                    <button
                      key={index}
                      type="button"
                      disabled={checked}
                      onClick={() => setSelectedIndex(index)}
                      className={`flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors ${optionClass}`}
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full playground-border text-xs font-semibold">
                        {String.fromCharCode(65 + index)}
                      </span>

                      <span className="pt-0.5 text-sm leading-6 playground-ink">
                        {String(option)}
                      </span>
                    </button>
                  );
                })
              : // Standard/Multi-statement/Matching use stored options
                (Array.isArray(currentMcq.options) ? currentMcq.options : []).map(
                  (option, index) => {
                    const isSelected = selectedIndex === index;
                    const isAnswer = currentMcq.correct_index === index;

                    let optionClass = "playground-border playground-card hover:playground-muted";

                    if (!checked && isSelected) {
                      optionClass = "border-primary bg-primary/5 ring-1 ring-primary";
                    }

                    if (checked && isAnswer) {
                      optionClass = "border-green-500 bg-green-500/10 ring-1 ring-green-500";
                    }

                    if (checked && isSelected && !isAnswer) {
                      optionClass = "border-destructive bg-destructive/10 ring-1 ring-destructive";
                    }

                    return (
                      <button
                        key={index}
                        type="button"
                        disabled={checked}
                        onClick={() => setSelectedIndex(index)}
                        className={`flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors ${optionClass}`}
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full playground-border text-xs font-semibold">
                          {String.fromCharCode(65 + index)}
                        </span>

                        <span className="pt-0.5 text-sm leading-6 playground-ink">
                          {String(option)}
                        </span>
                      </button>
                    );
                  },
                )}
          </div>

          {/* Result */}
          {checked && (
            <div
              className={`mt-6 rounded-lg border p-4 ${
                isCorrect
                  ? "border-green-500/30 bg-green-500/10"
                  : "border-destructive/30 bg-destructive/10"
              }`}
            >
              <div className="font-semibold playground-ink">
                {isCorrect ? "✓ Correct" : "✗ Incorrect"}
              </div>

              {!isCorrect && (
                <p className="mt-1 text-sm playground-ink">
                  Correct answer:{" "}
                  <span className="font-medium">
                    {String.fromCharCode(65 + currentMcq.correct_index)}
                  </span>
                </p>
              )}

              {currentMcq.explanation && (
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide playground-muted">
                    Explanation
                  </p>

                  <p className="mt-1 text-sm leading-6 playground-ink">{currentMcq.explanation}</p>
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={handlePrevious}
              disabled={currentIndex === 0}
              className="rounded-md playground-border px-4 py-2 text-sm font-medium transition-colors hover:playground-muted disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← Previous
            </button>

            <div className="flex gap-2">
              {!checked ? (
                <button
                  type="button"
                  onClick={handleCheckAnswer}
                  disabled={selectedIndex === null}
                  className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Check Answer
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={currentIndex === mcqs.length - 1}
                  className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next →
                </button>
              )}
            </div>
          </div>
        </div>

        {/* End indicator */}
        {currentIndex === sortedMcqs.length - 1 && checked && (
          <div className="rounded-xl playground-border playground-card p-5 text-center">
            <p className="font-medium playground-ink">You have reached the end of the MCQ set.</p>
            <p className="mt-1 text-sm playground-muted">
              You can use Previous to review earlier questions.
            </p>
          </div>
        )}

        {/* Review Panel */}
        {showReview && flaggedQuestions.size > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold flex items-center gap-2 playground-ink">
                <Flag className="h-5 w-5 text-amber-600" />
                Flagged Questions Review
              </h3>
              <button
                onClick={() => setShowReview(false)}
                className="text-sm playground-muted hover:playground-ink"
              >
                Close
              </button>
            </div>
            <div className="grid gap-2 max-h-60 overflow-y-auto">
              {[...flaggedQuestions]
                .sort((a, b) => a - b)
                .map((idx) => {
                  const mcq = sortedMcqs[idx];
                  const userAnswer = answers[idx];
                  const isCorrect = userAnswer !== undefined && userAnswer === mcq.correct_index;
                  return (
                    <button
                      key={idx}
                      onClick={() => {
                        goToQuestion(idx);
                        setShowReview(false);
                      }}
                      className={`text-left rounded-lg border p-3 transition-colors ${
                        isCorrect
                          ? "border-emerald-200 bg-emerald-50"
                          : "border-destructive/20 bg-destructive/5"
                      } hover:border-primary/50`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-sm playground-ink">Q{idx + 1}</span>
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                            isCorrect
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-destructive/10 text-destructive"
                          }`}
                        >
                          {isCorrect ? "Correct" : "Incorrect"}
                        </span>
                        {userAnswer === undefined && (
                          <span className="rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-amber-100 text-amber-700">
                            Unanswered
                          </span>
                        )}
                      </div>
                      <p className="text-sm playground-ink/80 line-clamp-1">
                        {mcq.question.slice(0, 120)}...
                      </p>
                    </button>
                  );
                })}
            </div>
          </div>
        )}

        {/* Test Summary */}
        {testMode && currentIndex === sortedMcqs.length - 1 && checked && (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
            <h3 className="font-semibold text-primary flex items-center gap-2 playground-ink">
              <CheckCheck className="h-5 w-5" />
              Test Complete
            </h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg playground-card p-3 text-center">
                <p className="text-xs playground-muted">Total Questions</p>
                <p className="font-serif text-2xl font-bold playground-ink">{sortedMcqs.length}</p>
              </div>
              <div className="rounded-lg playground-card p-3 text-center">
                <p className="text-xs playground-muted">Time Taken</p>
                <p className="font-serif text-2xl font-bold playground-ink">
                  {testMinutes}m {testSeconds}s
                </p>
              </div>
              <div className="rounded-lg playground-card p-3 text-center">
                <p className="text-xs playground-muted">Answered</p>
                <p className="font-serif text-2xl font-bold playground-ink">{answeredCount}</p>
              </div>
            </div>
            <button
              onClick={() => {
                endTest();
                setCelebrate(true);
                ensureAudioContext();
                playSound("select");
              }}
              className="mt-4 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
            >
              End Test & View Results
            </button>
          </div>
        )}

        {/* Keyboard Shortcuts Modal */}
        {showShortcuts && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fade-in"
            onClick={() => setShowShortcuts(false)}
          >
            <div
              className="rounded-xl playground-border playground-card p-6 max-w-md w-full animate-slide-up"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold flex items-center gap-2 playground-ink">
                  <Keyboard className="h-5 w-5" />
                  Keyboard Shortcuts
                </h3>
                <button
                  onClick={() => setShowShortcuts(false)}
                  className="p-1 rounded hover:playground-muted transition-colors"
                >
                  ✕
                </button>
              </div>
              <div className="space-y-3 text-sm">
                {[
                  { keys: ["←", "→"], desc: "Previous / Next question" },
                  { keys: ["Space"], desc: "Check answer / Next (when checked)" },
                  { keys: ["Enter"], desc: "Submit answer" },
                  { keys: ["1-4"], desc: "Select option A-D" },
                  { keys: ["F"], desc: "Flag / Unflag question" },
                  { keys: ["O"], desc: "Toggle Question Overview" },
                  { keys: ["R"], desc: "Toggle Review Panel" },
                  { keys: ["?"], desc: "Show this help" },
                  { keys: ["Esc"], desc: "Close modals" },
                ].map(({ keys, desc }, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-1 border-b playground-border/50 last:border-0"
                  >
                    <span className="playground-muted">{desc}</span>
                    <span className="flex gap-1">
                      {keys.map((k, j) => (
                        <kbd
                          key={j}
                          className="px-2 py-0.5 rounded bg-secondary text-xs font-mono playground-border/50 playground-ink"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t playground-border/50">
                <p className="text-xs playground-muted text-center">
                  Tip: Enable Instant Feedback for immediate checking, Auto Advance for flow
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Celebration Confetti */}
        {celebrate && (
          <div className="fixed inset-0 z-50 pointer-events-none overflow-hidden">
            {[...Array(50)].map((_, i) => (
              <ConfettiPiece key={i} index={i} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

// Confetti component
function ConfettiPiece({ index }: { index: number }) {
  const colors = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];
  const color = colors[index % colors.length];
  const left = `${Math.random() * 100}%`;
  const delay = `${Math.random() * 0.5}s`;
  const duration = `${2 + Math.random() * 1.5}s`;
  const size = `${6 + Math.random() * 8}px`;
  const rotation = `${Math.random() * 360}deg`;

  return (
    <div
      className="absolute top-0"
      style={
        {
          left,
          width: size,
          height: size,
          backgroundColor: color,
          borderRadius: Math.random() > 0.5 ? "50%" : "0",
          transform: `rotate(${rotation})`,
          animation: `confetti-fall ${duration} cubic-bezier(0.1, 0.8, 0.2, 1) ${delay} forwards`,
          opacity: 1,
        } as React.CSSProperties
      }
    />
  );
}
