import { createSignal, onMount, For, Show } from "solid-js";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

// Interface definitions
interface PageCvOverride {
  useCustom: boolean;
  skipAll?: boolean;
  split?: boolean;
  orient?: boolean;
  deskew?: boolean;
  shadows?: boolean;
  margins?: boolean;
  denoise?: boolean;
  mode?: "color" | "grayscale" | "bw" | "original";
  engine?: "neural" | "opencv";
}

interface PresetInfo {
  name: string;
  desc: string;
  icon: string;
  prompt: string;
}

interface ModelInfo {
  id: string;
  name: string;
  badge: string;
}

interface TokenUsage {
  prompt_tokens: number;
  candidate_tokens: number;
  total_tokens: number;
}

interface DocxGenerationResult {
  user_path: string;
  history_path: string;
  filename: string;
  title?: string;
  token_usage?: TokenUsage;
}

interface HistoryItem {
  id: string;
  filename: string;
  userPath?: string;
  historyPath?: string;
  path?: string;
  title?: string;
  timestamp: string;
  pageCount: number;
}

interface ToastInfo {
  id: number;
  message: string;
  type: "info" | "success" | "error";
  rawError?: string;
}

interface ModelLimits {
  rpm: number;
  rpd: number;
  tpm: number;
  tier: "Free" | "Paid";
}

const MODEL_LIMITS: Record<string, ModelLimits> = {
  "gemini-3.5-flash": { rpm: 15, rpd: 1500, tpm: 1000000, tier: "Free" },
  "gemini-3.5-flash-lite": { rpm: 30, rpd: 1500, tpm: 1000000, tier: "Free" },
  "gemini-3.1-flash-lite": { rpm: 30, rpd: 1500, tpm: 1000000, tier: "Free" },
  "gemini-3.6-flash": { rpm: 15, rpd: 1500, tpm: 1000000, tier: "Free" },
  "gemini-3.7-flash": { rpm: 15, rpd: 1500, tpm: 1000000, tier: "Free" },
  "gemini-3.1-pro-preview": { rpm: 2, rpd: 50, tpm: 32000, tier: "Paid" },
  "gemini-pro-latest": { rpm: 2, rpd: 50, tpm: 32000, tier: "Paid" }
};

interface DailyUsageState {
  date: string;
  requests: number;
  promptTokens: number;
  candidateTokens: number;
  totalTokens: number;
}

const getPacificDateStr = (): string => {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  } catch {
    return new Date().toISOString().split("T")[0];
  }
};

const getHoursUntilPacificMidnight = (): number => {
  try {
    const now = new Date();
    const pacificNowStr = now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
    const pacificNow = new Date(pacificNowStr);
    const pacificMidnight = new Date(pacificNow);
    pacificMidnight.setHours(24, 0, 0, 0);
    const diffMs = pacificMidnight.getTime() - pacificNow.getTime();
    return Math.max(1, Math.round(diffMs / (1000 * 60 * 60)));
  } catch {
    return 12;
  }
};

const loadDailyUsage = (): DailyUsageState => {
  const today = getPacificDateStr();
  try {
    const saved = localStorage.getItem("SCANSMITH_API_USAGE");
    if (saved) {
      const parsed: DailyUsageState = JSON.parse(saved);
      if (parsed && parsed.date === today) {
        return parsed;
      }
    }
  } catch {}
  return {
    date: today,
    requests: 0,
    promptTokens: 0,
    candidateTokens: 0,
    totalTokens: 0
  };
};

const PRESETS: PresetInfo[] = [
  {
    name: "Question Paper",
    desc: "Multi-column exam layouts, questions & marks header",
    icon: "📄",
    prompt: "Extract text and math accurately. Group multi-column layouts properly. Use proper fractions. Format Header: School/Institute name, Exam Title, Class, Subject, Time/Marks."
  },
  {
    name: "Class Notes",
    desc: "Handwritten notes, hierarchical bullets & formulas",
    icon: "📝",
    prompt: "Transcribe handwritten notes cleanly and accurately. Preserve headings, hierarchical bullet points, formulas, diagrams and callouts exactly as written."
  },
  {
    name: "Math & Equations",
    desc: "Complex formulas, matrices, integrals & fractions",
    icon: "📐",
    prompt: "Transcribe all mathematical symbols, equations, matrices, integrals, limits, and exponents using clear notation and clean equation blocks."
  },
  {
    name: "Official Document",
    desc: "Articles, numbered clauses, dates & formal structure",
    icon: "🏛️",
    prompt: "Transcribe official documents preserving article numbering, clauses, dates, signatures, tables, and formal paragraph structure."
  },
  {
    name: "Custom Prompt",
    desc: "Define your own customized OCR extraction rules",
    icon: "✨",
    prompt: "Extract all text, tables, and structured data cleanly. Format headings and lists with proper hierarchy."
  }
];

const MODELS: ModelInfo[] = [
  { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", badge: "Recommended" },
  { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite", badge: "Ultra-Fast" },
  { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", badge: "Lightweight" },
  { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", badge: "Preview" },
  { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", badge: "Reasoning" },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", badge: "Paid Quota" },
  { id: "gemini-pro-latest", name: "Gemini Pro Latest", badge: "Paid Quota" }
];

export default function App() {
  // Theme State
  const [theme, setTheme] = createSignal<"dark" | "light">(
    ((localStorage.getItem("SCANSMITH_THEME") || localStorage.getItem("AURA_THEME")) as "dark" | "light") || "light"
  );

  // Settings State
  const [apiKey, setApiKey] = createSignal(localStorage.getItem("SCANSMITH_API_KEY") || localStorage.getItem("AURA_API_KEY") || "");
  const savedModel = localStorage.getItem("SCANSMITH_MODEL") || localStorage.getItem("AURA_MODEL") || "";
  const initialModel = MODELS.some(m => m.id === savedModel && !m.badge.includes("Paid")) ? savedModel : MODELS[0].id;
  const [model, setModel] = createSignal(initialModel);
  const [isModelDropdownOpen, setIsModelDropdownOpen] = createSignal(false);

  // Live API Quota & Usage Monitor State
  const [apiUsage, setApiUsage] = createSignal<DailyUsageState>(loadDailyUsage());
  const activeLimits = () => {
    return MODEL_LIMITS[model()] || { rpm: 15, rpd: 1500, tpm: 1000000, tier: "Free" };
  };

  const openAIStudioDashboard = async () => {
    try {
      await invoke("open_document", { path: "https://aistudio.google.com/app/usage" });
    } catch {
      window.open("https://aistudio.google.com/", "_blank");
    }
  };

  const [selectedPreset, setSelectedPreset] = createSignal(localStorage.getItem("SCANSMITH_PRESET") || localStorage.getItem("AURA_PRESET") || PRESETS[0].name);
  const [instructions, setInstructions] = createSignal(
    localStorage.getItem("SCANSMITH_PROMPT") || localStorage.getItem("AURA_PROMPT") || PRESETS[0].prompt
  );

  // OpenCV Pipeline Settings with LocalStorage persistence
  const [cvSplit, setCvSplit] = createSignal(localStorage.getItem("SCANSMITH_CV_SPLIT") !== "false");
  const [cvOrient, setCvOrient] = createSignal(localStorage.getItem("SCANSMITH_CV_ORIENT") !== "false");
  const [cvDeskew, setCvDeskew] = createSignal(localStorage.getItem("SCANSMITH_CV_DESKEW") !== "false");
  const [cvMargins, setCvMargins] = createSignal(localStorage.getItem("SCANSMITH_CV_MARGINS") !== "false");
  const [cvShadows, setCvShadows] = createSignal(localStorage.getItem("SCANSMITH_CV_SHADOWS") !== "false");
  const [cvDenoise, setCvDenoise] = createSignal(localStorage.getItem("SCANSMITH_CV_DENOISE") === "true");
  const [cvFilterMode, setCvFilterMode] = createSignal<"color" | "grayscale" | "bw" | "original">(
    (localStorage.getItem("SCANSMITH_CV_MODE") as any) || "color"
  );
  const [cvEngine, setCvEngine] = createSignal<"neural" | "opencv">(
    (localStorage.getItem("SCANSMITH_CV_ENGINE") as any) || "neural"
  );
  const [neuralGpuInfo, setNeuralGpuInfo] = createSignal<{
    available: boolean;
    device: string;
    device_name: string;
    model_ready: boolean;
  } | null>(null);

  const detectedHardwareShort = () => {
    const info = neuralGpuInfo();
    if (!info?.available) return "CPU";
    const raw = info.device_name;
    if (!raw || raw === "None") return info.device || "GPU";
    return raw
      .replace(/Intel\(R\)\s*/gi, "")
      .replace(/Arc\(TM\)\s*/gi, "Arc ")
      .replace(/NVIDIA\s*/gi, "")
      .replace(/GeForce\s*/gi, "")
      .replace(/AMD\s*/gi, "")
      .replace(/Radeon\s*/gi, "Radeon ")
      .replace(/Graphics\s*/gi, "")
      .replace(/\(dGPU\)|\(iGPU\)/gi, "")
      .trim() || raw;
  };

  const detectedHardwareFull = () => {
    const info = neuralGpuInfo();
    if (!info?.available) return "CPU (Classical Vision)";
    return info.device_name && info.device_name !== "None"
      ? info.device_name
      : (info.device ? `${info.device} Accelerator` : "Hardware Accelerator");
  };
  const [isCvStale, setIsCvStale] = createSignal(false);
  const [imageVersion, setImageVersion] = createSignal(Date.now());
  const [lightboxCompareMode, setLightboxCompareMode] = createSignal<"single" | "compare">("single");

  const toggleCvSetting = (setter: (v: boolean) => void, key: string, val: boolean) => {
    setter(val);
    localStorage.setItem(key, String(val));
    setIsCvStale(true);
  };

  const selectCvFilterMode = (mode: "color" | "grayscale" | "bw" | "original") => {
    setCvFilterMode(mode);
    localStorage.setItem("SCANSMITH_CV_MODE", mode);
    setIsCvStale(true);
  };

  const selectCvEngine = (engine: "neural" | "opencv") => {
    setCvEngine(engine);
    localStorage.setItem("SCANSMITH_CV_ENGINE", engine);
    setIsCvStale(true);
  };

  // Adjustable & Retractable Sidebar State
  const initialSidebarWidth = Math.min(
    650,
    Math.max(280, parseInt(localStorage.getItem("SCANSMITH_SIDEBAR_WIDTH") || "380", 10))
  );
  const [sidebarWidth, setSidebarWidth] = createSignal(initialSidebarWidth);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = createSignal(
    localStorage.getItem("SCANSMITH_SIDEBAR_COLLAPSED") === "true"
  );
  const [isDraggingSidebar, setIsDraggingSidebar] = createSignal(false);

  // Modular sections collapse state
  const [openSections, setOpenSections] = createSignal<{ [key: string]: boolean }>({
    engine: true,
    filter: true,
    tools: true,
    quota: true,
  });

  const toggleSection = (section: string) => {
    setOpenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const toggleSidebarCollapse = () => {
    const next = !isSidebarCollapsed();
    setIsSidebarCollapsed(next);
    localStorage.setItem("SCANSMITH_SIDEBAR_COLLAPSED", String(next));
  };

  const startSidebarResize = (e: MouseEvent) => {
    e.preventDefault();
    setIsDraggingSidebar(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.min(650, Math.max(280, moveEvent.clientX));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      setIsDraggingSidebar(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem("SCANSMITH_SIDEBAR_WIDTH", String(sidebarWidth()));
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  };

  // Document & Image State
  const [images, setImages] = createSignal<string[]>([]);
  const [cleanedImages, setCleanedImages] = createSignal<string[]>([]);
  const [outputFilename, setOutputFilename] = createSignal("Compiled_Document");
  const [aiAutoName, setAiAutoName] = createSignal(
    localStorage.getItem("SCANSMITH_AI_AUTO_NAME") !== "false"
  );
  const toggleAiAutoName = (val: boolean) => {
    setAiAutoName(val);
    localStorage.setItem("SCANSMITH_AI_AUTO_NAME", String(val));
  };
  const [viewMode, setViewMode] = createSignal<"raw" | "cleaned">("raw");

  // Processing & Results State
  const [isProcessing, setIsProcessing] = createSignal(false);
  const [progressPct, setProgressPct] = createSignal(0);
  const [progressMsg, setProgressMsg] = createSignal("System Ready");
  const [outputResult, setOutputResult] = createSignal<string | null>(null);
  const [lastError, setLastError] = createSignal<string | null>(null);

  // UI Modals & Drawers
  const [activeSidebarTab, setActiveSidebarTab] = createSignal<"ai" | "cv" | "output" | "quota">("ai");
  const [showSettingsDrawer, setShowSettingsDrawer] = createSignal(false);
  const [showHistoryDrawer, setShowHistoryDrawer] = createSignal(false);
  const [lightboxImg, setLightboxImg] = createSignal<string | null>(null);
  const [toasts, setToasts] = createSignal<ToastInfo[]>([]);
  const [isMaximized, setIsMaximized] = createSignal(false);

  // History State
  const loadInitialHistory = (): HistoryItem[] => {
    try {
      const saved = localStorage.getItem("SCANSMITH_HISTORY") || localStorage.getItem("AURA_HISTORY");
      const parsed = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const [history, setHistory] = createSignal<HistoryItem[]>(loadInitialHistory());

  const addToast = (message: string, type: "info" | "success" | "error" = "info", rawError?: string) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type, rawError }]);
    // Errors stay longer (20s) so user has plenty of time to inspect and copy
    const duration = type === "error" ? 20000 : 4000;
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, duration);
  };

  const removeToast = (id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const toggleTheme = () => {
    const next = theme() === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("SCANSMITH_THEME", next);
    document.documentElement.setAttribute("data-theme", next);
  };

  const updateState = (setter: any, key: string, val: string) => {
    setter(val);
    localStorage.setItem(key, val);
  };

  onMount(() => {
    document.documentElement.setAttribute("data-theme", theme());

    // Initialize and track maximized window state
    try {
      const appWin = getCurrentWindow();
      appWin.isMaximized().then(setIsMaximized).catch(() => {});
      appWin.onResized(async () => {
        try {
          const max = await appWin.isMaximized();
          setIsMaximized(max);
        } catch {}
      }).catch(() => {});
    } catch {
      invoke<boolean>("app_window_is_maximized")
        .then(setIsMaximized)
        .catch(() => {});
    }

    listen("process-progress", (event: any) => {
      setProgressPct(event.payload.percent);
      setProgressMsg(event.payload.message);
    });

    // Check dynamic Neural Engine accelerator availability
    invoke<any>("get_neural_engine_status")
      .then((status) => {
        if (status) setNeuralGpuInfo(status);
      })
      .catch((err) => {
        console.warn("Could not check neural engine GPU status:", err);
      });

    getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop" && e.payload.paths) {
        handlePaths(e.payload.paths);
      }
    });

    // Close dropdown on click outside
    const handleWindowClick = () => {
      if (isModelDropdownOpen()) setIsModelDropdownOpen(false);
    };
    window.addEventListener("click", handleWindowClick);

    // Clean up temporary session files on unload
    const handleBeforeUnload = () => {
      invoke("cleanup_temp_files").catch(() => {});
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("click", handleWindowClick);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  });

  const handlePaths = (paths: string[]) => {
    const valid = paths
      .filter(p => /\.(png|jpg|jpeg|webp|bmp|tiff)$/i.test(p))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (valid.length) {
      setImages(prev => {
        const added = valid.filter(v => !prev.includes(v));
        return [...prev, ...added];
      });
      setCleanedImages([]);
      setOutputResult(null);
      setLastError(null);
      setViewMode("raw");
      addToast(`Imported ${valid.length} scan page${valid.length > 1 ? "s" : ""}`, "info");
    } else {
      addToast("No valid image files found", "error");
    }
  };

  const handlePickFiles = async () => {
    const sel = await openDialog({
      multiple: true,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "tiff"] }]
    });
    if (sel) {
      handlePaths(Array.isArray(sel) ? sel : [sel]);
    }
  };

  // Reorder & Manage Pages (supports both raw and cleaned images)
  const movePage = (index: number, direction: "left" | "right") => {
    const isCleaned = viewMode() === "cleaned" && cleanedImages().length > 0;
    const targetList = isCleaned ? [...cleanedImages()] : [...images()];
    const targetIdx = direction === "left" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= targetList.length) return;

    const temp = targetList[index];
    targetList[index] = targetList[targetIdx];
    targetList[targetIdx] = temp;

    if (isCleaned) {
      setCleanedImages(targetList);
    } else {
      setImages(targetList);
      setIsCvStale(true);
    }
  };

  const removePage = (index: number) => {
    const isCleaned = viewMode() === "cleaned" && cleanedImages().length > 0;
    if (isCleaned) {
      setCleanedImages(prev => prev.filter((_, i) => i !== index));
    } else {
      setImages(prev => prev.filter((_, i) => i !== index));
      setCleanedImages([]);
      setIsCvStale(false);
    }
    addToast("Removed page", "info");
  };

  // Per-Image Overrides and Optimistic Rotation State
  interface PageConfigTarget {
    displayIdx: number;
    rawIdx: number;
    rawPath: string;
  }

  const [pageOverrides, setPageOverrides] = createSignal<{ [key: string]: PageCvOverride }>({});
  const [configuringPage, setConfiguringPage] = createSignal<PageConfigTarget | null>(null);
  const [rotationOffsets, setRotationOffsets] = createSignal<{ [path: string]: number }>({});

  const getRawInfoForPage = (img: string, displayIdx: number): { rawIdx: number; rawPath: string } => {
    if (viewMode() === "raw" || cleanedImages().length === 0) {
      const rIdx = Math.min(displayIdx, Math.max(0, images().length - 1));
      return { rawIdx: rIdx, rawPath: images()[rIdx] || img };
    }
    // Extract rawIdx from filename page_{rawIdx}_{subIdx}_...
    const basename = img.split(/[\\/]/).pop() || "";
    const match = basename.match(/^page_(\d+)_/i);
    if (match) {
      const parsed = parseInt(match[1], 10);
      if (parsed >= 0 && parsed < images().length) {
        return { rawIdx: parsed, rawPath: images()[parsed] };
      }
    }
    const rIdx = Math.min(displayIdx, Math.max(0, images().length - 1));
    return { rawIdx: rIdx, rawPath: images()[rIdx] || img };
  };

  const getPageOverride = (rawPath: string, rawIdx: number): PageCvOverride => {
    const map = pageOverrides();
    const found = map[rawIdx.toString()]
      || (rawPath ? map[rawPath] : undefined)
      || (rawPath ? map[rawPath.replace(/\\/g, "/")] : undefined)
      || (rawPath ? map[rawPath.replace(/\//g, "\\")] : undefined);

    if (found) return found;
    return {
      useCustom: false,
      skipAll: false,
      split: cvSplit(),
      orient: cvOrient(),
      deskew: cvDeskew(),
      shadows: cvShadows(),
      margins: cvMargins(),
      denoise: cvDenoise(),
      mode: cvFilterMode()
    };
  };

  const updatePageOverride = (rawPath: string, rawIdx: number, patch: Partial<PageCvOverride>) => {
    setPageOverrides(prev => {
      const current = getPageOverride(rawPath, rawIdx);
      const updated = { ...current, ...patch };
      const next = { ...prev };
      next[rawIdx.toString()] = updated;
      if (rawPath) {
        next[rawPath] = updated;
        next[rawPath.replace(/\\/g, "/")] = updated;
        next[rawPath.replace(/\//g, "\\")] = updated;
      }
      return next;
    });
    setIsCvStale(true);
  };

  const resetPageOverride = (rawPath: string, rawIdx: number) => {
    setPageOverrides(prev => {
      const next = { ...prev };
      delete next[rawIdx.toString()];
      if (rawPath) {
        delete next[rawPath];
        delete next[rawPath.replace(/\\/g, "/")];
        delete next[rawPath.replace(/\//g, "\\")];
      }
      return next;
    });
    setIsCvStale(true);
  };

  // Instant optimistic rotation with asynchronous disk persistence
  const rotatePageItem = async (e: MouseEvent, index: number, angle: number) => {
    e.stopPropagation();
    const isCleaned = viewMode() === "cleaned" && cleanedImages().length > 0;
    const list = isCleaned ? cleanedImages() : images();
    const targetImg = list[index];
    if (!targetImg) return;

    // 1. Instant 0ms visual rotation feedback via CSS transform
    setRotationOffsets(prev => ({
      ...prev,
      [targetImg]: (prev[targetImg] || 0) + angle
    }));

    // 2. Background persistence to disk
    try {
      await invoke("rotate_page", { path: targetImg, angle });
      setImageVersion(Date.now());
      setRotationOffsets(prev => {
        const next = { ...prev };
        delete next[targetImg];
        return next;
      });
      addToast(`Rotated page ${index + 1} (${angle > 0 ? "+" : ""}${angle}°)`, "info");
    } catch (err: any) {
      setRotationOffsets(prev => ({
        ...prev,
        [targetImg]: (prev[targetImg] || 0) - angle
      }));
      addToast(`Rotation failed: ${err}`, "error", `${err}`);
    }
  };

  // Export all processed (or currently viewed) images to a chosen folder
  const exportProcessedImages = async () => {
    const list = viewMode() === "cleaned" && cleanedImages().length > 0 ? cleanedImages() : (cleanedImages().length > 0 ? cleanedImages() : images());
    if (list.length === 0) {
      addToast("No images to export", "info");
      return;
    }

    try {
      const selectedDir = await openDialog({
        directory: true,
        multiple: false,
        title: "Select Destination Folder to Export Images"
      });

      if (!selectedDir) return;
      const targetDir = typeof selectedDir === "string" ? selectedDir : selectedDir[0];
      if (!targetDir) return;

      const prefix = outputFilename().trim() || "ScanSmith";
      const exported: string[] = await invoke("export_processed_images", {
        sources: list,
        targetDir,
        prefix
      });

      addToast(`Exported ${exported.length} images to ${targetDir}`, "success");
    } catch (err: any) {
      addToast(`Export failed: ${err}`, "error", `${err}`);
    }
  };

  // Export a single image to a chosen location
  const exportSingleImage = async (imgSrc: string) => {
    try {
      const defaultName = `${outputFilename().trim() || "ScanSmith"}_Page.png`;
      const savePath = await saveDialog({
        defaultPath: defaultName,
        filters: [
          { name: "PNG Image", extensions: ["png"] },
          { name: "JPEG Image", extensions: ["jpg", "jpeg"] }
        ],
        title: "Save Image As"
      });

      if (!savePath) return;

      await invoke("export_single_image", {
        source: imgSrc,
        destination: savePath
      });

      addToast("Image saved successfully", "success");
    } catch (err: any) {
      addToast(`Save failed: ${err}`, "error", `${err}`);
    }
  };

  const clearAllScans = () => {
    setImages([]);
    setCleanedImages([]);
    setOutputResult(null);
    setLastError(null);
    setIsCvStale(false);
    setPageOverrides({});
    setRotationOffsets({});
    setConfiguringPage(null);
    invoke("cleanup_temp_files").catch(() => {});
    addToast("Cleared all scans and temporary cache", "info");
  };

  // Run OpenCV Processing
  const executeOpenCV = async (): Promise<string[]> => {
    if (!images().length) return [];
    setIsProcessing(true);
    setLastError(null);
    setProgressPct(5);
    setProgressMsg("Running OpenCV ScanTailor Optimization Pipeline...");
    try {
      // Build comprehensive overrides payload mapped by raw index and paths
      const overridesPayload: { [key: string]: PageCvOverride } = {};
      images().forEach((img, idx) => {
        const ov = getPageOverride(img, idx);
        if (ov && ov.useCustom) {
          overridesPayload[idx.toString()] = ov;
          overridesPayload[img] = ov;
          overridesPayload[img.replace(/\\/g, "/")] = ov;
          overridesPayload[img.replace(/\//g, "\\")] = ov;
        }
      });

      const results: string[] = await invoke("preprocess_images", {
        imagePaths: images(),
        settings: {
          split: cvSplit(),
          orient: cvOrient(),
          deskew: cvDeskew(),
          margins: cvMargins(),
          shadows: cvShadows(),
          denoise: cvDenoise(),
          mode: cvFilterMode(),
          engine: cvEngine(),
          overrides: overridesPayload
        }
      });
      setCleanedImages(results);
      setIsCvStale(false);
      setImageVersion(Date.now());
      setViewMode("cleaned");
      const engineName = cvEngine() === "neural" ? `ScanSmith Neural AI (${detectedHardwareShort()})` : "OpenCV";
      addToast(`Optimized ${results.length} pages via ${engineName}`, "success");
      return results;
    } catch (err: any) {
      const errMsg = `${err}`;
      setProgressMsg(`OpenCV Error: ${errMsg}`);
      setLastError(`OpenCV Error: ${errMsg}`);
      addToast(`OpenCV Error: ${errMsg}`, "error", errMsg);
      throw err;
    } finally {
      setIsProcessing(false);
    }
  };

  const runOpenCV = async () => {
    try {
      await executeOpenCV();
    } catch {}
  };

  // Generate AI DOCX
  const generateDocx = async () => {
    if (!apiKey().trim()) {
      setShowSettingsDrawer(true);
      addToast("Please enter your Gemini API Key first", "error");
      return;
    }

    if (!images().length) {
      addToast("Please import images first", "error");
      return;
    }

    // Auto-run OpenCV if not yet run or if settings are stale
    let pagesToProcess = cleanedImages();
    if (pagesToProcess.length === 0 || isCvStale()) {
      try {
        pagesToProcess = await executeOpenCV();
      } catch {
        return;
      }
    }

    if (!pagesToProcess.length) {
      addToast("No pages available to process", "error");
      return;
    }

    setIsProcessing(true);
    setLastError(null);
    setProgressPct(10);
    setProgressMsg(`Connecting to ${selectedModelInfo()?.name || model()}...`);

    try {
      const res = await invoke<DocxGenerationResult>("generate_docx", {
        apiKey: apiKey().trim(),
        cleanedPaths: pagesToProcess,
        originalImgPath: images()[0],
        docType: selectedPreset(),
        customPrompt: instructions(),
        model: model(),
        outputFilename: outputFilename().trim() || "Compiled_Document",
        aiAutoName: aiAutoName()
      });

      setOutputResult(res.user_path);
      if (res.filename) {
        setOutputFilename(res.filename);
      }
      addToast(`Created "${res.filename}.docx" in user folder & history archive!`, "success");

      // Record in History with dual paths & document title
      const newHistoryItem: HistoryItem = {
        id: Date.now().toString(),
        filename: res.filename,
        userPath: res.user_path,
        historyPath: res.history_path,
        path: res.user_path,
        title: res.title,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        pageCount: pagesToProcess.length
      };
      const currentList = Array.isArray(history()) ? history() : [];
      const updated = [newHistoryItem, ...currentList.slice(0, 19)];
      setHistory(updated);
      localStorage.setItem("SCANSMITH_HISTORY", JSON.stringify(updated));

      // Accumulate daily API quota and token usage
      const today = getPacificDateStr();
      const currentUsage = apiUsage();
      const isSameDay = currentUsage.date === today;
      const baseReqs = isSameDay ? currentUsage.requests : 0;
      const basePrompt = isSameDay ? currentUsage.promptTokens : 0;
      const baseCand = isSameDay ? currentUsage.candidateTokens : 0;
      const baseTotal = isSameDay ? currentUsage.totalTokens : 0;

      const pTokens = Number(res.token_usage?.prompt_tokens || 0);
      const cTokens = Number(res.token_usage?.candidate_tokens || 0);
      const tTokens = Number(res.token_usage?.total_tokens || (pTokens + cTokens));

      const updatedUsage: DailyUsageState = {
        date: today,
        requests: baseReqs + pagesToProcess.length,
        promptTokens: basePrompt + pTokens,
        candidateTokens: baseCand + cTokens,
        totalTokens: baseTotal + tTokens
      };
      setApiUsage(updatedUsage);
      localStorage.setItem("SCANSMITH_API_USAGE", JSON.stringify(updatedUsage));
    } catch (err: any) {
      const errMsg = `${err}`;
      setProgressMsg(`AI Error: ${errMsg}`);
      setLastError(`AI Error: ${errMsg}`);
      addToast(`Generation Error: ${errMsg}`, "error", errMsg);
    } finally {
      setIsProcessing(false);
    }
  };

  const openGeneratedDoc = async (path: string) => {
    try {
      await invoke("open_document", { path });
      addToast("Opening document in editor...", "info");
    } catch (e) {
      addToast(`Failed to open file: ${e}`, "error", `${e}`);
    }
  };

  const openHistoryDoc = async (item: HistoryItem, forceArchive: boolean = false) => {
    const userPath = item.userPath || item.path;
    const historyPath = item.historyPath;

    if (forceArchive && historyPath) {
      try {
        await invoke("open_document", { path: historyPath });
        addToast("Opening guaranteed archive copy from app history...", "info");
        return;
      } catch (e) {
        addToast(`Failed to open archive copy: ${e}`, "error", `${e}`);
        return;
      }
    }

    // Try user copy first
    if (userPath) {
      try {
        const exists = await invoke<boolean>("check_path_exists", { path: userPath });
        if (exists) {
          await invoke("open_document", { path: userPath });
          addToast("Opening user document...", "info");
          return;
        }
      } catch {}
    }

    // Fallback seamlessly to permanent app history archive copy
    if (historyPath) {
      try {
        const exists = await invoke<boolean>("check_path_exists", { path: historyPath });
        if (exists) {
          await invoke("open_document", { path: historyPath });
          addToast("User copy moved or missing — opened guaranteed archive copy", "info");
          return;
        }
      } catch {}
    }

    if (userPath) {
      try {
        await invoke("open_document", { path: userPath });
      } catch (e) {
        addToast(`File not found: ${userPath}`, "error", `${e}`);
      }
    }
  };

  const handleOpenHistoryFolder = async () => {
    try {
      await invoke("open_history_folder");
      addToast("Opened App History directory", "info");
    } catch (e) {
      addToast(`Failed to open history directory: ${e}`, "error", `${e}`);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    addToast("Copied to clipboard!", "success");
  };

  const handleMinimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch (e) {
      console.warn("Direct window.minimize failed, falling back to invoke:", e);
      try {
        await invoke("app_window_minimize");
      } catch (err) {
        console.error("Failed to minimize window:", err);
      }
    }
  };

  const handleMaximize = async () => {
    try {
      await getCurrentWindow().toggleMaximize();
      const max = await getCurrentWindow().isMaximized();
      setIsMaximized(max);
    } catch (e) {
      console.warn("Direct window.toggleMaximize failed, falling back to invoke:", e);
      try {
        const isMax = await invoke<boolean>("app_window_toggle_maximize");
        setIsMaximized(isMax);
      } catch (err) {
        console.error("Failed to toggle maximize window:", err);
      }
    }
  };

  const handleClose = async () => {
    try {
      await getCurrentWindow().close();
    } catch (e) {
      console.warn("Direct window.close failed, falling back to invoke:", e);
      try {
        await invoke("app_window_close");
      } catch (err) {
        console.error("Failed to close window:", err);
      }
    }
  };

  const selectedModelInfo = () => {
    return MODELS.find(m => m.id === model()) || { id: model(), name: model(), badge: "Custom" };
  };

  // Current Pipeline Step calculation
  const currentStep = () => {
    if (outputResult()) return 4;
    if (cleanedImages().length > 0) return 3;
    if (images().length > 0) return 2;
    return 1;
  };

  const activeDisplayImages = () => {
    if (viewMode() === "cleaned" && cleanedImages().length > 0) {
      return cleanedImages();
    }
    return images();
  };

  return (
    <div class="app-container">
      {/* ==================================================================
          Top Header Bar / Custom Title Bar
          ================================================================== */}
      <header class="header-navbar" data-tauri-drag-region onDblClick={handleMaximize}>
        <div class="brand-section" data-tauri-drag-region>
          <div class="brand-icon-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
          </div>
          <div data-tauri-drag-region>
            <div class="brand-title">
              ScanSmith AI
              <span class="brand-badge">Studio</span>
            </div>
            <div class="brand-subtitle">Document Scan Digitizer & DOCX Converter</div>
          </div>
        </div>

        {/* Stepper Progress */}
        <div class="stepper-nav" data-tauri-drag-region>
          <div class={`step-item ${currentStep() === 1 ? 'active' : ''} ${currentStep() > 1 ? 'completed' : ''}`}>
            <span class="step-dot"></span>
            1. Import
          </div>
          <span class="step-arrow">→</span>
          <div class={`step-item ${currentStep() === 2 ? 'active' : ''} ${currentStep() > 2 ? 'completed' : ''}`}>
            <span class="step-dot"></span>
            2. Enhance
          </div>
          <span class="step-arrow">→</span>
          <div class={`step-item ${currentStep() === 3 ? 'active' : ''} ${currentStep() > 3 ? 'completed' : ''}`}>
            <span class="step-dot"></span>
            3. AI Synthesis
          </div>
          <span class="step-arrow">→</span>
          <div class={`step-item ${currentStep() === 4 ? 'active' : ''}`}>
            <span class="step-dot"></span>
            4. Export
          </div>
        </div>

        {/* Header Actions */}
        <div class="header-actions">
          <button
            class="api-status-pill"
            onClick={() => setShowSettingsDrawer(true)}
            title="Configure Gemini API Key"
          >
            <span class={`status-indicator-dot ${apiKey() ? 'connected' : 'missing'}`}></span>
            <span>{apiKey() ? "API Connected" : "Set API Key"}</span>
          </button>

          <button
            class="icon-btn"
            onClick={() => setShowHistoryDrawer(true)}
            title="Conversion History"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>

          <button
            class="icon-btn"
            onClick={toggleTheme}
            title={theme() === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            <Show when={theme() === 'dark'} fallback={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            }>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            </Show>
          </button>

          {/* Custom Window Control Buttons */}
          <div class="window-controls-group">
            <button class="window-btn" onClick={handleMinimize} title="Minimize Window" aria-label="Minimize Window">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button
              class="window-btn"
              onClick={handleMaximize}
              title={isMaximized() ? "Restore Window" : "Expand / Maximize Window"}
              aria-label={isMaximized() ? "Restore Window" : "Expand / Maximize Window"}
            >
              <Show when={isMaximized()} fallback={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <rect x="5" y="5" width="14" height="14" rx="2" ry="2" />
                </svg>
              }>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M8 5h11a2 2 0 0 1 2 2v11" />
                  <rect x="4" y="8" width="13" height="13" rx="2" ry="2" />
                </svg>
              </Show>
            </button>
            <button class="window-btn close" onClick={handleClose} title="Close Window" aria-label="Close Window">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* ==================================================================
          Main Split View Workspace
          ================================================================== */}
      {/* Floating Expand Sidebar Button (when retracted) */}
      <Show when={isSidebarCollapsed()}>
        <button
          class="sidebar-floating-expand-btn"
          onClick={toggleSidebarCollapse}
          title="Open Controls Panel"
          type="button"
        >
          <span class="expand-icon">▶</span>
          <span class="expand-text">Panel</span>
          <span class={`expand-badge ${cvEngine() === 'neural' ? 'ai' : 'cv'}`}>
            {cvEngine() === 'neural' ? '⚡ AI' : '📐 CV'}
          </span>
        </button>
      </Show>

      <main class="main-workspace">
        {/* Left Inspector Sidebar */}
        <aside
          class={`inspector-sidebar ${isSidebarCollapsed() ? 'collapsed' : ''} ${isDraggingSidebar() ? 'resizing' : ''}`}
          style={{ width: isSidebarCollapsed() ? '0px' : `${sidebarWidth()}px` }}
        >
          <div class="sidebar-tabs">
            <button
              class={`sidebar-tab-btn ${activeSidebarTab() === 'ai' ? 'active' : ''}`}
              onClick={() => setActiveSidebarTab('ai')}
              title="AI Presets & Models"
            >
              <span>🤖</span> Presets
            </button>
            <button
              class={`sidebar-tab-btn ${activeSidebarTab() === 'cv' ? 'active' : ''}`}
              onClick={() => setActiveSidebarTab('cv')}
              title="ScanSmith Neural AI & Computer Vision Filters"
            >
              <span>⚡</span> Scan & CV
            </button>
            <button
              class={`sidebar-tab-btn ${activeSidebarTab() === 'output' ? 'active' : ''}`}
              onClick={() => setActiveSidebarTab('output')}
              title="DOCX Output & Naming"
            >
              <span>⚙️</span> Export
            </button>
            <button
              class={`sidebar-tab-btn ${activeSidebarTab() === 'quota' ? 'active' : ''}`}
              onClick={() => setActiveSidebarTab('quota')}
              title="Gemini API Quota & Usage Analytics"
            >
              <span>📊</span> Quota
            </button>
            <button
              class="sidebar-retract-btn"
              onClick={toggleSidebarCollapse}
              title="Retract Sidebar (Maximize Canvas)"
              aria-label="Retract Sidebar"
              type="button"
            >
              ◀
            </button>
          </div>

          <div class="sidebar-scroll-area">
            {/* AI Presets Tab */}
            <Show when={activeSidebarTab() === 'ai'}>
              <div class="setting-section">
                <div class="setting-title-row">
                  <label class="setting-label">Document Preset</label>
                  <span class="setting-hint">Select structure</span>
                </div>
                <div class="preset-cards-grid">
                  <For each={PRESETS}>
                    {(p) => (
                      <div
                        class={`preset-card ${selectedPreset() === p.name ? 'active' : ''}`}
                        onClick={() => {
                          updateState(setSelectedPreset, "SCANSMITH_PRESET", p.name);
                          updateState(setInstructions, "SCANSMITH_PROMPT", p.prompt);
                        }}
                      >
                        <div class="preset-header">
                          <span>{p.icon}</span>
                          <span>{p.name}</span>
                        </div>
                        <div class="preset-desc">{p.desc}</div>
                      </div>
                    )}
                  </For>
                </div>
              </div>

              {/* Custom Neo Dropdown for AI Model */}
              <div class="setting-section">
                <div class="setting-title-row">
                  <label class="setting-label">AI Model</label>
                  <span class="setting-hint">Gemini Engine</span>
                </div>

                <div class="custom-select-container" onClick={(e) => e.stopPropagation()}>
                  <div
                    class="custom-select-trigger"
                    onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen())}
                  >
                    <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                      <span>⚡</span>
                      <span>{selectedModelInfo()?.name}</span>
                      <span class="model-option-badge">{selectedModelInfo()?.badge}</span>
                    </div>
                    <span style={{ "font-size": "0.75rem", transform: isModelDropdownOpen() ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>▼</span>
                  </div>

                  <Show when={isModelDropdownOpen()}>
                    <ul class="custom-select-menu">
                      <For each={MODELS}>
                        {(m) => (
                          <li
                            class={`custom-select-option ${model() === m.id ? 'selected' : ''}`}
                            onClick={() => {
                              updateState(setModel, "SCANSMITH_MODEL", m.id);
                              setIsModelDropdownOpen(false);
                            }}
                          >
                            <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                              <span>{model() === m.id ? "✔" : "•"}</span>
                              <span>{m.name}</span>
                            </div>
                            <span class="model-option-badge">{m.badge}</span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </div>
              </div>

              <div class="setting-section">
                <div class="setting-title-row">
                  <label class="setting-label">Extraction Prompt</label>
                  <span class="setting-hint">Fine-tune OCR rules</span>
                </div>
                <textarea
                  class="modern-textarea"
                  value={instructions()}
                  onInput={(e) => updateState(setInstructions, "SCANSMITH_PROMPT", e.currentTarget.value)}
                  placeholder="Enter custom instructions for formatting, equations, Bangla font styling..."
                />
              </div>
            </Show>

            {/* AI Scan & CV Pipeline Tab */}
            {/* AI Scan & CV Pipeline Tab - Ultra Compact & Non-Scrolling */}
            <Show when={activeSidebarTab() === 'cv'}>
              {/* Sleek 1-Line Status Strip */}
              <div class={`engine-status-strip ${cvEngine() === 'neural' ? 'ai' : 'cv'}`}>
                <div class="engine-strip-left">
                  <span class={`engine-status-dot ${cvEngine() === 'neural' ? 'neural' : 'classic'}`}></span>
                  <strong class="engine-strip-title">
                    {cvEngine() === 'neural' ? "Neural AI Active" : "OpenCV Vision Active"}
                  </strong>
                  <span class="engine-strip-hw">
                    {cvEngine() === 'neural' ? `${detectedHardwareShort()} (FP16)` : "CPU Math"}
                  </span>
                </div>
                <span class={`engine-strip-badge ${cvEngine() === 'neural' ? 'ai' : 'cv'}`}>
                  {cvEngine() === 'neural' ? '⚡ SOTA' : '📐 FAST'}
                </span>
              </div>

              {/* Module 1: Processing Engine Selector (Compact Segmented Switch) */}
              <div class="compact-control-group">
                <div class="compact-group-label">
                  <span>Engine Architecture</span>
                  <Show when={neuralGpuInfo()?.available && cvEngine() === 'neural'}>
                    <span class="gpu-active-badge">● {detectedHardwareShort()}</span>
                  </Show>
                </div>
                <div class="compact-segment-row">
                  <button
                    class={`compact-segment-btn ${cvEngine() === 'neural' ? 'active-ai' : ''}`}
                    onClick={() => selectCvEngine('neural')}
                    type="button"
                    title={`DocRes Neural Transformer on ${detectedHardwareFull()}. Eradicates bleed-through & creases.`}
                  >
                    <span class="seg-icon">⚡</span>
                    <span class="seg-label">Neural AI</span>
                    <span class="seg-badge-ai">SOTA</span>
                  </button>
                  <button
                    class={`compact-segment-btn ${cvEngine() === 'opencv' ? 'active-cv' : ''}`}
                    onClick={() => selectCvEngine('opencv')}
                    type="button"
                    title="High-speed classical vision pipeline on CPU. Fast deskew & binarization."
                  >
                    <span class="seg-icon">📐</span>
                    <span class="seg-label">OpenCV Fast</span>
                    <span class="seg-badge-cv">CPU</span>
                  </button>
                </div>
              </div>

              {/* Module 2: Enhancement Style & Color (Compact 4-Pill Bar) */}
              <div class="compact-control-group">
                <div class="compact-group-label">
                  <span>Enhancement Style</span>
                  <span class="compact-group-val">{cvFilterMode().toUpperCase()}</span>
                </div>
                <div class="style-pills-row">
                  <button
                    class={`style-pill-btn ${cvFilterMode() === 'color' ? 'active' : ''}`}
                    onClick={() => selectCvFilterMode('color')}
                    type="button"
                    title="Color Doc: Whitens paper, preserves ink and marker colors"
                  >
                    <span class="pill-icon">🎨</span>
                    <span class="pill-label">Color</span>
                  </button>
                  <button
                    class={`style-pill-btn ${cvFilterMode() === 'grayscale' ? 'active' : ''}`}
                    onClick={() => selectCvFilterMode('grayscale')}
                    type="button"
                    title="Grayscale: High-contrast document grayscale"
                  >
                    <span class="pill-icon">🌑</span>
                    <span class="pill-label">Gray</span>
                  </button>
                  <button
                    class={`style-pill-btn ${cvFilterMode() === 'bw' ? 'active' : ''}`}
                    onClick={() => selectCvFilterMode('bw')}
                    type="button"
                    title="Clean B&W: Adaptive binary, ultra-crisp text"
                  >
                    <span class="pill-icon">📄</span>
                    <span class="pill-label">B&W</span>
                  </button>
                  <button
                    class={`style-pill-btn ${cvFilterMode() === 'original' ? 'active' : ''}`}
                    onClick={() => selectCvFilterMode('original')}
                    type="button"
                    title="Natural: Geometric deskew & crop only, keeps raw photo tones"
                  >
                    <span class="pill-icon">🖼️</span>
                    <span class="pill-label">Natural</span>
                  </button>
                </div>
              </div>

              {/* Module 3: Geometry & Correction Tools (2-Column Compact Interactive Grid) */}
              <div class="compact-control-group">
                <div class="compact-group-label">
                  <span>Correction Tools</span>
                  <span class="compact-group-val">
                    {[cvSplit(), cvOrient(), cvDeskew(), cvMargins(), cvShadows(), cvDenoise()].filter(Boolean).length} of 6 ON
                  </span>
                </div>
                <div class="tools-grid-2col">
                  <button
                    class={`tool-chip-btn ${cvSplit() ? 'active' : ''}`}
                    onClick={() => toggleCvSetting(setCvSplit, "SCANSMITH_CV_SPLIT", !cvSplit())}
                    type="button"
                    title="Detects center book spine and separates 2-page spreads"
                  >
                    <span class="tool-chip-check">{cvSplit() ? "✔" : "•"}</span>
                    <span class="tool-chip-icon">📖</span>
                    <span class="tool-chip-name">Book Split</span>
                    <span class="tool-chip-tech cv">CV</span>
                  </button>

                  <button
                    class={`tool-chip-btn ${cvOrient() ? 'active' : ''}`}
                    onClick={() => toggleCvSetting(setCvOrient, "SCANSMITH_CV_ORIENT", !cvOrient())}
                    type="button"
                    title="Tesseract OSD automatically rotates upside-down/sideways scans"
                  >
                    <span class="tool-chip-check">{cvOrient() ? "✔" : "•"}</span>
                    <span class="tool-chip-icon">🧭</span>
                    <span class="tool-chip-name">Auto Rotate</span>
                    <span class="tool-chip-tech cv">CV</span>
                  </button>

                  <button
                    class={`tool-chip-btn ${cvDeskew() ? 'active' : ''}`}
                    onClick={() => toggleCvSetting(setCvDeskew, "SCANSMITH_CV_DESKEW", !cvDeskew())}
                    type="button"
                    title="Radon projection variance straightens slanted text lines"
                  >
                    <span class="tool-chip-check">{cvDeskew() ? "✔" : "•"}</span>
                    <span class="tool-chip-icon">📐</span>
                    <span class="tool-chip-name">Auto Deskew</span>
                    <span class="tool-chip-tech cv">CV</span>
                  </button>

                  <button
                    class={`tool-chip-btn ${cvMargins() ? 'active' : ''}`}
                    onClick={() => toggleCvSetting(setCvMargins, "SCANSMITH_CV_MARGINS", !cvMargins())}
                    type="button"
                    title="Trims dark scanner borders and applies clean white margins"
                  >
                    <span class="tool-chip-check">{cvMargins() ? "✔" : "•"}</span>
                    <span class="tool-chip-icon">✂️</span>
                    <span class="tool-chip-name">Crop Margins</span>
                    <span class="tool-chip-tech cv">CV</span>
                  </button>

                  <button
                    class={`tool-chip-btn ${cvShadows() ? 'active' : ''}`}
                    onClick={() => toggleCvSetting(setCvShadows, "SCANSMITH_CV_SHADOWS", !cvShadows())}
                    type="button"
                    title={cvEngine() === 'neural' ? `DocRes Neural Transformer shadow & crease removal on ${detectedHardwareShort()}` : "OpenCV morphological illumination equalization"}
                  >
                    <span class="tool-chip-check">{cvShadows() ? "✔" : "•"}</span>
                    <span class="tool-chip-icon">💡</span>
                    <span class="tool-chip-name">De-Shadow</span>
                    <span class={`tool-chip-tech ${cvEngine() === 'neural' ? 'ai' : 'cv'}`}>
                      {cvEngine() === 'neural' ? 'AI' : 'CV'}
                    </span>
                  </button>

                  <button
                    class={`tool-chip-btn ${cvDenoise() ? 'active' : ''}`}
                    onClick={() => toggleCvSetting(setCvDenoise, "SCANSMITH_CV_DENOISE", !cvDenoise())}
                    type="button"
                    title={cvEngine() === 'neural' ? `DocRes AI bleed-through & toner speckle purge on ${detectedHardwareShort()}` : "Connected-component speckle purge & background whitening"}
                  >
                    <span class="tool-chip-check">{cvDenoise() ? "✔" : "•"}</span>
                    <span class="tool-chip-icon">✨</span>
                    <span class="tool-chip-name">Despeckle</span>
                    <span class={`tool-chip-tech ${cvEngine() === 'neural' ? 'ai' : 'cv'}`}>
                      {cvEngine() === 'neural' ? 'AI' : 'CV'}
                    </span>
                  </button>
                </div>
              </div>

              {/* Action Section */}
              <Show when={images().length > 0}>
                <div class="compact-action-section">
                  <button
                    class={`btn ${cvEngine() === 'neural' ? 'btn-neural-action' : 'btn-opencv-action'}`}
                    style={{ width: "100%", "justify-content": "center", height: "36px", "font-size": "0.84rem" }}
                    onClick={runOpenCV}
                    disabled={isProcessing()}
                  >
                    <span>{cvEngine() === 'neural' ? '⚡' : '📐'}</span>
                    <span>
                      {isCvStale()
                        ? (cvEngine() === 'neural' ? "Re-apply Neural AI" : "Apply Modified Settings")
                        : (cvEngine() === 'neural' ? `Run Neural AI (${detectedHardwareShort()})` : "Run OpenCV Fast")}
                    </span>
                  </button>
                  <Show when={isCvStale()}>
                    <div class="stale-settings-hint compact">
                      ⚡ Settings changed. Click above to re-apply.
                    </div>
                  </Show>
                </div>
              </Show>
            </Show>

            {/* Output & Export Tab */}
            <Show when={activeSidebarTab() === 'output'}>
              <div class="setting-section">
                <div class="setting-title-row">
                  <label class="setting-label">Document Filename</label>
                  <button
                    class={`pill-toggle-btn ${aiAutoName() ? 'active' : ''}`}
                    onClick={() => toggleAiAutoName(!aiAutoName())}
                    title="Toggle automatic AI semantic naming based on document content"
                  >
                    <span>✨</span>
                    <span>AI Smart Name</span>
                  </button>
                </div>
                <input
                  class="modern-input"
                  type="text"
                  value={outputFilename()}
                  onInput={(e) => setOutputFilename(e.currentTarget.value)}
                  placeholder={aiAutoName() ? "Auto (AI will generate a name)" : "Compiled_Document"}
                />
                <div style={{ "margin-top": "6px", "font-size": "0.73rem", color: "var(--ink-muted)", "line-height": "1.4" }}>
                  {aiAutoName()
                    ? "✨ AI will name your file dynamically from the document title & subject."
                    : "Using custom name. Automatically increments (1, 2...) to prevent overwriting."}
                </div>
              </div>

              <div class="setting-section">
                <div class="setting-title-row">
                  <label class="setting-label">Dual Storage Locations</label>
                </div>
                <div class="dual-storage-info-box">
                  <div class="storage-row">
                    <span class="storage-icon">📂</span>
                    <div class="storage-details">
                      <strong>User Directory:</strong>
                      <span>Saved next to your scan photos</span>
                    </div>
                  </div>
                  <div class="storage-row">
                    <span class="storage-icon">🏛️</span>
                    <div class="storage-details">
                      <strong>App History Archive:</strong>
                      <span>Guaranteed permanent copy in local app storage</span>
                    </div>
                  </div>
                </div>
              </div>

              <div class="setting-section">
                <div class="setting-title-row">
                  <label class="setting-label">Document Typography</label>
                </div>
                <div class="preset-card active">
                  <div class="preset-header">
                    <span>🔤</span>
                    <span>Tiro Bangla / Calibri</span>
                  </div>
                  <div class="preset-desc">Standard Unicode & Math typography rendered into native DOCX XML runs.</div>
                </div>
              </div>
            </Show>

            {/* Quota & Usage Analytics Tab */}
            <Show when={activeSidebarTab() === 'quota'}>
              <div class="quota-tab-content">
                <div class="quota-hero-banner">
                  <div class="quota-hero-header">
                    <div class="quota-title">
                      <span>⚡</span>
                      <strong>Gemini Quota & Usage</strong>
                    </div>
                    <span class={`quota-tier-badge ${activeLimits().tier === 'Paid' ? 'paid' : ''}`}>
                      {activeLimits().tier} Tier
                    </span>
                  </div>
                  <div class="quota-model-specs">
                    <span class="quota-model-name" title={selectedModelInfo()?.name || model()}>
                      {selectedModelInfo()?.name || model()}
                    </span>
                    <span>{activeLimits().rpd.toLocaleString()} RPD • {activeLimits().rpm} RPM</span>
                  </div>
                </div>

                <div class="quota-progress-box">
                  <div class="quota-progress-labels">
                    <span>{apiUsage().requests} / {activeLimits().rpd.toLocaleString()} reqs today</span>
                    <span class="quota-progress-remaining">
                      {Math.max(0, activeLimits().rpd - apiUsage().requests).toLocaleString()} left
                    </span>
                  </div>
                  <div class="quota-progress-track">
                    {(() => {
                      const pct = Math.min(100, (apiUsage().requests / Math.max(1, activeLimits().rpd)) * 100);
                      const colorClass = pct > 90 ? 'danger' : pct > 75 ? 'warning' : 'normal';
                      return (
                        <div
                          class={`quota-progress-fill ${colorClass}`}
                          style={{ width: `${Math.max(pct, apiUsage().requests > 0 ? 3 : 0)}%` }}
                        ></div>
                      );
                    })()}
                  </div>
                </div>

                <div class="quota-metrics-row">
                  <div class="quota-metric-col">
                    <span class="quota-metric-label">Tokens Today</span>
                    <span class="quota-metric-val">
                      {apiUsage().totalTokens >= 1000000
                        ? `${(apiUsage().totalTokens / 1000000).toFixed(2)}M`
                        : apiUsage().totalTokens >= 1000
                        ? `${(apiUsage().totalTokens / 1000).toFixed(1)}k`
                        : apiUsage().totalTokens}
                    </span>
                  </div>
                  <div class="quota-metric-col">
                    <span class="quota-metric-label">Quota Used</span>
                    <span class="quota-metric-val">
                      {((apiUsage().requests / Math.max(1, activeLimits().rpd)) * 100).toFixed(1)}%
                    </span>
                  </div>
                </div>

                <div class="quota-footer-row">
                  <span class="quota-reset-text" title="Google resets daily quotas at midnight Pacific Time">
                    🕒 Resets ~{getHoursUntilPacificMidnight()}h (Midnight PT)
                  </span>
                  <button
                    class="quota-link-btn"
                    onClick={openAIStudioDashboard}
                    title="View full quota, rate limits, and billing in Google AI Studio"
                  >
                    AI Studio ↗
                  </button>
                </div>
              </div>
            </Show>
          </div>

          {/* Mini Quota Footer Ticker (always visible, 1-click toggles Quota tab) */}
          <div
            class="sidebar-mini-ticker"
            onClick={() => setActiveSidebarTab(activeSidebarTab() === 'quota' ? 'cv' : 'quota')}
            title="Click to toggle detailed Gemini API Quota & Usage analytics"
          >
            <div class="ticker-left">
              <span class="ticker-bolt">⚡</span>
              <span class="ticker-text">{apiUsage().requests} / {activeLimits().rpd.toLocaleString()} reqs</span>
              <span class="ticker-dot">•</span>
              <span class="ticker-text">
                {apiUsage().totalTokens >= 1000000
                  ? `${(apiUsage().totalTokens / 1000000).toFixed(1)}M`
                  : apiUsage().totalTokens >= 1000
                  ? `${(apiUsage().totalTokens / 1000).toFixed(1)}k`
                  : apiUsage().totalTokens} toks
              </span>
            </div>
            <div class="ticker-right">
              <span class={`ticker-tier ${activeLimits().tier === 'Paid' ? 'paid' : ''}`}>
                {activeLimits().tier}
              </span>
              <span class="ticker-arrow">
                {activeSidebarTab() === 'quota' ? '▼' : '↗'}
              </span>
            </div>
          </div>
        </aside>

        {/* Sidebar Drag Resizer Handle */}
        <Show when={!isSidebarCollapsed()}>
          <div
            class={`sidebar-resizer ${isDraggingSidebar() ? 'dragging' : ''}`}
            onMouseDown={startSidebarResize}
            title="Drag to resize sidebar width"
          >
            <div class="resizer-knob"></div>
          </div>
        </Show>

        {/* Center Main Stage */}
        <section class="stage-container">
          {/* Progress & Live Console Banner */}
          <Show when={isProcessing() || progressPct() > 0}>
            <div class="live-status-card">
              <div class="status-header-row">
                <div class="status-pill-badge">
                  <span class="pulse-spinner"></span>
                  <span>{progressMsg()}</span>
                </div>
                <span class="setting-hint">{Math.round(progressPct())}%</span>
              </div>
              <div class="progress-track">
                <div class="progress-fill" style={{ width: `${progressPct()}%` }}></div>
              </div>
            </div>
          </Show>

          {/* Persistent Error Alert Banner (if error occurred) */}
          <Show when={lastError()}>
            <div class="error-alert-banner">
              <div class="error-alert-text">
                <div class="error-alert-title">
                  <span>⚠️</span>
                  <span>Pipeline Execution Error</span>
                </div>
                <div>{lastError()}</div>
              </div>
              <div style={{ display: "flex", gap: "8px", "flex-shrink": 0 }}>
                <button class="btn btn-secondary" style={{ padding: "6px 12px", "font-size": "0.78rem" }} onClick={() => copyToClipboard(lastError()!)}>
                  📋 Copy Error
                </button>
                <button class="btn btn-secondary" style={{ padding: "6px 10px", "font-size": "0.78rem" }} onClick={() => setLastError(null)}>
                  ✕ Dismiss
                </button>
              </div>
            </div>
          </Show>

          {/* Results Showcase Card */}
          <Show when={outputResult()}>
            <div class="result-showcase-card">
              <div class="result-meta-box">
                <div class="result-icon-badge">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <div>
                  <div class="result-title">DOCX Document Ready</div>
                  <div class="result-path-text">{outputResult()}</div>
                </div>
              </div>
              <div class="result-buttons">
                <button class="btn btn-secondary" onClick={() => copyToClipboard(outputResult()!)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copy Path
                </button>
                <button class="btn btn-primary" onClick={() => openGeneratedDoc(outputResult()!)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  Open in Document Editor
                </button>
              </div>
            </div>
          </Show>

          {/* Empty Dropzone Hero */}
          <Show when={images().length === 0}>
            <div class="empty-dropzone" onClick={handlePickFiles}>
              <div class="dropzone-icon-circle">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div class="dropzone-title">Drag & Drop Scanned Images Here</div>
              <div class="dropzone-subtitle">
                Drop PNG, JPG, or book scan files anywhere in this window, or click to browse files from your computer.
              </div>
              <div class="dropzone-actions">
                <button class="btn btn-primary" onClick={(e) => { e.stopPropagation(); handlePickFiles(); }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Browse Scan Images
                </button>
              </div>
            </div>
          </Show>

          {/* Active Gallery & Image Pipeline Stage */}
          <Show when={images().length > 0}>
            <div class="stage-action-bar">
              <div class="stage-stats">
                <div class="stat-chip">
                  <span>Raw Pages:</span>
                  <strong>{images().length}</strong>
                </div>
                <Show when={cleanedImages().length > 0}>
                  <div class="stat-chip">
                    <span>Enhanced:</span>
                    <strong style={{ color: "var(--neo-green)" }}>{cleanedImages().length}</strong>
                  </div>
                </Show>
              </div>

              <div class="stage-buttons">
                <button class="btn btn-secondary" onClick={handlePickFiles} disabled={isProcessing()}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Add More Scans
                </button>
                <Show when={cleanedImages().length > 0 || images().length > 0}>
                  <button class="btn btn-secondary" onClick={exportProcessedImages} disabled={isProcessing()} title="Export scans to a local folder on your computer">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ width: "15px", height: "15px" }}>
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Export Images
                  </button>
                </Show>
                <button class="btn btn-danger-ghost" onClick={clearAllScans} disabled={isProcessing()}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                  Clear
                </button>
              </div>
            </div>

            {/* Gallery Section */}
            <div class="gallery-section-card">
              <div class="gallery-header">
                <div class="setting-label">
                  <span>🖼️</span>
                  <span>{viewMode() === 'cleaned' && cleanedImages().length > 0 ? "Enhanced OpenCV Scans" : "Original Raw Scans"}</span>
                </div>

                <Show when={cleanedImages().length > 0}>
                  <div class="view-mode-tabs">
                    <button
                      class={`view-tab-btn ${viewMode() === 'raw' ? 'active' : ''}`}
                      onClick={() => setViewMode('raw')}
                    >
                      Raw ({images().length})
                    </button>
                    <button
                      class={`view-tab-btn ${viewMode() === 'cleaned' ? 'active' : ''}`}
                      onClick={() => setViewMode('cleaned')}
                    >
                      Enhanced ({cleanedImages().length})
                    </button>
                  </div>
                </Show>
              </div>

              {/* Grid of Pages */}
              <div class="gallery-grid">
                <For each={activeDisplayImages()}>
                  {(img, idx) => {
                    const rawInfo = () => getRawInfoForPage(img, idx());
                    const config = () => getPageOverride(rawInfo().rawPath, rawInfo().rawIdx);
                    const isCustom = () => config().useCustom;
                    const isRawSkip = () => config().skipAll;

                    return (
                      <div class="page-card">
                        <div class="page-card-header">
                          <div style={{ display: "flex", "align-items": "center", gap: "6px" }}>
                            <span class="page-number-badge">Page {idx() + 1}</span>
                            <Show when={isCustom()}>
                              <span class={`page-custom-badge ${isRawSkip() ? "raw" : ""}`}>
                                {isRawSkip() ? "⚡ Raw" : "⚙️ Custom"}
                              </span>
                            </Show>
                          </div>
                          <div class="page-actions-row">
                            <button
                              class={`page-mini-btn ${isCustom() ? "active-override" : ""}`}
                              title="Configure processing for this page only"
                              onClick={(e) => {
                                e.stopPropagation();
                                const info = rawInfo();
                                setConfiguringPage({
                                  displayIdx: idx(),
                                  rawIdx: info.rawIdx,
                                  rawPath: info.rawPath
                                });
                              }}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="3" />
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                              </svg>
                            </button>
                            <button
                              class="page-mini-btn"
                              title="Rotate 90° CCW"
                              disabled={isProcessing()}
                              onClick={(e) => rotatePageItem(e, idx(), -90)}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="1 4 1 10 7 10" />
                                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                              </svg>
                            </button>
                            <button
                              class="page-mini-btn"
                              title="Rotate 90° CW"
                              disabled={isProcessing()}
                              onClick={(e) => rotatePageItem(e, idx(), 90)}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="23 4 23 10 17 10" />
                                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                              </svg>
                            </button>
                            <button
                              class="page-mini-btn"
                              title="Move Left"
                              disabled={idx() === 0 || isProcessing()}
                              onClick={(e) => { e.stopPropagation(); movePage(idx(), 'left'); }}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="15 18 9 12 15 6" />
                              </svg>
                            </button>
                            <button
                              class="page-mini-btn"
                              title="Move Right"
                              disabled={idx() === activeDisplayImages().length - 1 || isProcessing()}
                              onClick={(e) => { e.stopPropagation(); movePage(idx(), 'right'); }}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="9 18 15 12 9 6" />
                              </svg>
                            </button>
                            <button
                              class="page-mini-btn delete"
                              title="Remove Page"
                              disabled={isProcessing()}
                              onClick={(e) => { e.stopPropagation(); removePage(idx()); }}
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        <div class="page-img-preview-box" onClick={() => setLightboxImg(img)}>
                          <img
                            src={`${convertFileSrc(img)}?v=${imageVersion()}`}
                            alt={`Scan page ${idx() + 1}`}
                            style={{
                              transform: `rotate(${rotationOffsets()[img] || 0}deg)`,
                              transition: "transform 0.18s cubic-bezier(0.4, 0, 0.2, 1)"
                            }}
                          />
                          <div class="page-zoom-overlay">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ width: "24px", height: "24px" }}>
                              <circle cx="11" cy="11" r="8" />
                              <line x1="21" y1="21" x2="16.65" y2="16.65" />
                              <line x1="11" y1="8" x2="11" y2="14" />
                              <line x1="8" y1="11" x2="14" y2="11" />
                            </svg>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>

              {/* Action Pipeline Footer Bar */}
              <div class="pipeline-footer-bar">
                <div class="footer-info">
                  <div class="footer-step-title">
                    {cleanedImages().length === 0
                      ? "Step 2: Preprocess & Enhance Scans"
                      : isCvStale()
                      ? "Settings Changed — Ready to Re-apply or Generate DOCX"
                      : "Step 3: Generate AI DOCX Document"}
                  </div>
                  <div class="footer-step-desc">
                    {cleanedImages().length === 0
                      ? "Runs OpenCV orientation, deskew, margin cleanup, and dual-page split."
                      : isCvStale()
                      ? "Your OpenCV settings were modified. Click 'Generate AI DOCX' to automatically re-enhance and compile, or 'Re-run OpenCV' to preview."
                      : "Sends enhanced scans to Gemini AI for OCR transcription and native Word DOCX generation."}
                  </div>
                </div>

                <div class="footer-actions">
                  <Show when={cleanedImages().length === 0}>
                    <button class="btn btn-primary" onClick={runOpenCV} disabled={isProcessing()}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                      </svg>
                      Run OpenCV Enhancements
                    </button>
                    <button class="btn btn-secondary" onClick={exportProcessedImages} disabled={isProcessing()} title="Export raw scans to a folder">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ width: "15px", height: "15px" }}>
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Save Images to Folder
                    </button>
                  </Show>
                  <Show when={cleanedImages().length > 0}>
                    <button class="btn btn-secondary" onClick={runOpenCV} disabled={isProcessing()} title="Re-run with modified OpenCV settings">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ width: "15px", height: "15px" }}>
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                      </svg>
                      {isCvStale() ? "Re-apply OpenCV" : "Re-run OpenCV"}
                    </button>
                    <button class="btn btn-secondary" onClick={exportProcessedImages} disabled={isProcessing()} title="Save enhanced images directly to a folder on your computer">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ width: "15px", height: "15px" }}>
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Save Images to Folder
                    </button>
                    <button class="btn btn-success" onClick={generateDocx} disabled={isProcessing()}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="12" y1="18" x2="12" y2="12" />
                        <line x1="9" y1="15" x2="15" y2="15" />
                      </svg>
                      Generate AI DOCX
                    </button>
                  </Show>
                </div>
              </div>
            </div>
          </Show>
        </section>
      </main>

      {/* ==================================================================
          Image Zoom Lightbox Modal with Before/After Comparison
          ================================================================== */}
      <Show when={lightboxImg()}>
        <div class="modal-backdrop" onClick={() => setLightboxImg(null)}>
          <div class="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <div class="lightbox-header">
              <div class="lightbox-title">
                <span>🔍</span>
                <span>Scan Inspection</span>
                <Show when={cleanedImages().includes(lightboxImg()!)}>
                  <span class="lightbox-badge">Enhanced (OpenCV)</span>
                </Show>
              </div>

              <div class="lightbox-actions">
                <button
                  class="btn btn-secondary"
                  style={{ padding: "6px 10px", "font-size": "0.78rem" }}
                  onClick={() => {
                    const img = lightboxImg();
                    if (!img) return;
                    setRotationOffsets(prev => ({
                      ...prev,
                      [img]: (prev[img] || 0) - 90
                    }));
                    invoke("rotate_page", { path: img, angle: -90 })
                      .then(() => {
                        setImageVersion(Date.now());
                        setRotationOffsets(prev => {
                          const next = { ...prev };
                          delete next[img];
                          return next;
                        });
                      })
                      .catch((err) => {
                        setRotationOffsets(prev => ({
                          ...prev,
                          [img]: (prev[img] || 0) + 90
                        }));
                        addToast(`Rotation failed: ${err}`, "error", `${err}`);
                      });
                  }}
                  title="Rotate 90° CCW"
                >
                  ↺ Rotate CCW
                </button>
                <button
                  class="btn btn-secondary"
                  style={{ padding: "6px 10px", "font-size": "0.78rem" }}
                  onClick={() => {
                    const img = lightboxImg();
                    if (!img) return;
                    setRotationOffsets(prev => ({
                      ...prev,
                      [img]: (prev[img] || 0) + 90
                    }));
                    invoke("rotate_page", { path: img, angle: 90 })
                      .then(() => {
                        setImageVersion(Date.now());
                        setRotationOffsets(prev => {
                          const next = { ...prev };
                          delete next[img];
                          return next;
                        });
                      })
                      .catch((err) => {
                        setRotationOffsets(prev => ({
                          ...prev,
                          [img]: (prev[img] || 0) - 90
                        }));
                        addToast(`Rotation failed: ${err}`, "error", `${err}`);
                      });
                  }}
                  title="Rotate 90° CW"
                >
                  ↻ Rotate CW
                </button>

                <button
                  class="btn btn-secondary"
                  style={{ padding: "6px 10px", "font-size": "0.78rem" }}
                  onClick={() => exportSingleImage(lightboxImg()!)}
                  title="Save this image to your computer"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ width: "13px", height: "13px", "margin-right": "4px" }}>
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                  Save Image As...
                </button>

                <Show when={cleanedImages().length > 0 && images().length > 0}>
                  <button
                    class="btn btn-secondary"
                    style={{ padding: "6px 10px", "font-size": "0.78rem" }}
                    onClick={() => setLightboxCompareMode(lightboxCompareMode() === "compare" ? "single" : "compare")}
                  >
                    {lightboxCompareMode() === "compare" ? "Single View" : "Compare Raw vs Enhanced"}
                  </button>
                </Show>

                <button class="page-mini-btn" onClick={() => setLightboxImg(null)} title="Close">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            <Show when={lightboxCompareMode() === "compare" && cleanedImages().length > 0 && images().length > 0} fallback={
              <div class="lightbox-img-box">
                <img
                  src={`${convertFileSrc(lightboxImg()!)}?v=${imageVersion()}`}
                  alt="Zoomed Scan"
                  style={{
                    transform: `rotate(${rotationOffsets()[lightboxImg()!] || 0}deg)`,
                    transition: "transform 0.18s cubic-bezier(0.4, 0, 0.2, 1)"
                  }}
                />
              </div>
            }>
              {(() => {
                const current = lightboxImg();
                const curIdx = current ? (cleanedImages().indexOf(current) !== -1 ? cleanedImages().indexOf(current) : Math.max(0, images().indexOf(current))) : 0;
                const rawImg = images()[curIdx] || images()[0];
                const cleanedImg = cleanedImages()[curIdx] || cleanedImages()[0];
                return (
                  <div class="lightbox-compare-grid">
                    <div class="lightbox-compare-col">
                      <div class="compare-col-header">Original Raw Scan (Page {curIdx + 1})</div>
                      <div class="lightbox-img-box">
                        <img src={`${convertFileSrc(rawImg)}?v=${imageVersion()}`} alt="Original Scan" />
                      </div>
                    </div>
                    <div class="lightbox-compare-col">
                      <div class="compare-col-header">Enhanced (Page {curIdx + 1})</div>
                      <div class="lightbox-img-box">
                        <img src={`${convertFileSrc(cleanedImg)}?v=${imageVersion()}`} alt="Enhanced Scan" />
                      </div>
                    </div>
                  </div>
                );
              })()}
            </Show>
          </div>
        </div>
      </Show>

      {/* ==================================================================
          Per-Page Processing Override Modal
          ================================================================== */}
      <Show when={configuringPage() !== null}>
        {(() => {
          const target = configuringPage()!;
          const currentConfig = () => getPageOverride(target.rawPath, target.rawIdx);
          const filename = target.rawPath.split(/[\\/]/).pop() || `Page ${target.displayIdx + 1}`;

          return (
            <div class="modal-backdrop" onClick={() => setConfiguringPage(null)}>
              <div class="modal-card page-config-modal" onClick={(e) => e.stopPropagation()}>
                <div class="modal-header">
                  <div class="modal-title-row">
                    <span class="modal-icon">⚙️</span>
                    <div>
                      <div class="modal-title">Page {target.displayIdx + 1} Processing Settings</div>
                      <div class="modal-subtitle">
                        Source scan: {filename} • Override OpenCV optimization for this scan
                      </div>
                    </div>
                  </div>
                  <button class="modal-close-btn" onClick={() => setConfiguringPage(null)}>✕</button>
                </div>

                <div class="modal-body">
                  {/* Master toggle for this page */}
                  <div class="toggle-row page-override-master">
                    <div class="toggle-info">
                      <div class="toggle-name">Custom Settings for Page {target.displayIdx + 1}</div>
                      <div class="toggle-desc">Enable to override global sidebar settings for this page</div>
                    </div>
                    <label class="switch">
                      <input
                        type="checkbox"
                        checked={currentConfig().useCustom}
                        onChange={(e) => updatePageOverride(target.rawPath, target.rawIdx, { useCustom: e.currentTarget.checked })}
                      />
                      <span class="slider"></span>
                    </label>
                  </div>

                  <Show when={currentConfig().useCustom}>
                    {/* Skip All Toggle */}
                    <div class="override-skip-card" classList={{ active: currentConfig().skipAll }}>
                      <div class="override-skip-header">
                        <label style={{ "font-weight": "700", cursor: "pointer", display: "flex", "align-items": "center", gap: "8px" }}>
                          <input
                            type="checkbox"
                            checked={currentConfig().skipAll || false}
                            onChange={(e) => updatePageOverride(target.rawPath, target.rawIdx, { skipAll: e.currentTarget.checked })}
                          />
                          <span>⚡ Skip All Processing (Keep 100% Raw Original)</span>
                        </label>
                      </div>
                      <div class="setting-hint" style={{ "margin-left": "24px", "margin-top": "4px" }}>
                        Bypasses all OpenCV steps (no deskew, no margins, no color filter). Uses raw input directly.
                      </div>
                    </div>

                    <Show when={!currentConfig().skipAll}>
                      <div class="page-toggles-grid">
                        <div class="toggle-row mini">
                          <div class="toggle-info">
                            <div class="toggle-name">📖 Split Dual-Page Spreads</div>
                            <div class="toggle-desc">Cut book fold into two pages</div>
                          </div>
                          <label class="switch">
                            <input
                              type="checkbox"
                              checked={currentConfig().split !== false}
                              onChange={(e) => updatePageOverride(target.rawPath, target.rawIdx, { split: e.currentTarget.checked })}
                            />
                            <span class="slider"></span>
                          </label>
                        </div>

                        <div class="toggle-row mini">
                          <div class="toggle-info">
                            <div class="toggle-name">🔄 Auto Orientation</div>
                            <div class="toggle-desc">Rotate upside-down pages upright</div>
                          </div>
                          <label class="switch">
                            <input
                              type="checkbox"
                              checked={currentConfig().orient !== false}
                              onChange={(e) => updatePageOverride(target.rawPath, target.rawIdx, { orient: e.currentTarget.checked })}
                            />
                            <span class="slider"></span>
                          </label>
                        </div>

                        <div class="toggle-row mini">
                          <div class="toggle-info">
                            <div class="toggle-name">📐 Auto Deskew Slant</div>
                            <div class="toggle-desc">Correct text line tilt/angle</div>
                          </div>
                          <label class="switch">
                            <input
                              type="checkbox"
                              checked={currentConfig().deskew !== false}
                              onChange={(e) => updatePageOverride(target.rawPath, target.rawIdx, { deskew: e.currentTarget.checked })}
                            />
                            <span class="slider"></span>
                          </label>
                        </div>

                        <div class="toggle-row mini">
                          <div class="toggle-info">
                            <div class="toggle-name">🌓 Shadow & Crease Removal</div>
                            <div class="toggle-desc">Eliminate spine shadow gradients</div>
                          </div>
                          <label class="switch">
                            <input
                              type="checkbox"
                              checked={currentConfig().shadows !== false}
                              onChange={(e) => updatePageOverride(target.rawPath, target.rawIdx, { shadows: e.currentTarget.checked })}
                            />
                            <span class="slider"></span>
                          </label>
                        </div>

                        <div class="toggle-row mini">
                          <div class="toggle-info">
                            <div class="toggle-name">✂️ Crop Margins</div>
                            <div class="toggle-desc">Trim outside border to content</div>
                          </div>
                          <label class="switch">
                            <input
                              type="checkbox"
                              checked={currentConfig().margins !== false}
                              onChange={(e) => updatePageOverride(target.rawPath, target.rawIdx, { margins: e.currentTarget.checked })}
                            />
                            <span class="slider"></span>
                          </label>
                        </div>

                        <div class="toggle-row mini">
                          <div class="toggle-info">
                            <div class="toggle-name">✨ Denoise & Despeckle</div>
                            <div class="toggle-desc">Fast bilateral noise smoothing</div>
                          </div>
                          <label class="switch">
                            <input
                              type="checkbox"
                              checked={currentConfig().denoise === true}
                              onChange={(e) => updatePageOverride(target.rawPath, target.rawIdx, { denoise: e.currentTarget.checked })}
                            />
                            <span class="slider"></span>
                          </label>
                        </div>
                      </div>

                      {/* Filter Mode Selector */}
                      <div class="page-mode-section">
                        <label class="setting-label">Enhancement Filter Mode for Page {target.displayIdx + 1}</label>
                        <div class="filter-mode-grid mini">
                          {(["color", "grayscale", "bw", "original"] as const).map((m) => (
                            <button
                              class={`filter-mode-chip ${currentConfig().mode === m ? "active" : ""}`}
                              onClick={() => updatePageOverride(target.rawPath, target.rawIdx, { mode: m })}
                            >
                              {m === "color" && "🎨 Color"}
                              {m === "grayscale" && "⚪ Gray"}
                              {m === "bw" && "⬛ B&W"}
                              {m === "original" && "📷 Raw"}
                            </button>
                          ))}
                        </div>
                      </div>
                    </Show>
                  </Show>
                </div>

                <div class="modal-footer">
                  <Show when={currentConfig().useCustom}>
                    <button class="btn btn-secondary" onClick={() => {
                      resetPageOverride(target.rawPath, target.rawIdx);
                      addToast(`Reset Page ${target.displayIdx + 1} to global settings`, "info");
                    }}>
                      Reset to Defaults
                    </button>
                  </Show>
                  <button class="btn btn-primary" onClick={() => {
                    setConfiguringPage(null);
                    if (currentConfig().useCustom) {
                      addToast(`Configured custom settings for Page ${target.displayIdx + 1}. Click 'Re-apply OpenCV' to process.`, "success");
                    }
                  }}>
                    Done
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </Show>

      {/* ==================================================================
          API Key & Settings Drawer
          ================================================================== */}
      <Show when={showSettingsDrawer()}>
        <div class="drawer-backdrop" onClick={() => setShowSettingsDrawer(false)}>
          <div class="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div class="drawer-header">
              <div class="drawer-title">
                <span>🔑</span>
                API Configuration
              </div>
              <button class="page-mini-btn" onClick={() => setShowSettingsDrawer(false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div class="drawer-body">
              <div class="setting-section">
                <label class="setting-label">Google Gemini API Key</label>
                <input
                  type="password"
                  class="modern-input"
                  value={apiKey()}
                  onInput={(e) => updateState(setApiKey, "SCANSMITH_API_KEY", e.currentTarget.value.trim())}
                  placeholder="AIzaSy..."
                />
                <div class="setting-hint">
                  Your key is stored locally in your browser's private storage and is never uploaded anywhere except directly to Google's API.
                </div>
              </div>

              <div class="setting-section" style={{ "margin-top": "12px" }}>
                <button
                  class="btn btn-primary"
                  style={{ width: "100%" }}
                  onClick={() => {
                    setShowSettingsDrawer(false);
                    addToast("API settings saved", "success");
                  }}
                >
                  Save & Close
                </button>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* ==================================================================
          Conversion History Drawer
          ================================================================== */}
      <Show when={showHistoryDrawer()}>
        <div class="drawer-backdrop" onClick={() => setShowHistoryDrawer(false)}>
          <div class="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div class="drawer-header">
              <div class="drawer-title">
                <span>📚</span>
                Document History
              </div>
              <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                <button
                  class="btn btn-secondary"
                  style={{ padding: "4px 10px", "font-size": "0.75rem", display: "flex", "align-items": "center", gap: "5px" }}
                  onClick={handleOpenHistoryFolder}
                  title="Open the app's permanent history archive folder in file manager"
                >
                  <span>📁</span>
                  <span>Archive Folder</span>
                </button>
                <button class="page-mini-btn" onClick={() => setShowHistoryDrawer(false)}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>
            <div class="drawer-body">
              <Show when={history().length === 0}>
                <div style={{ "text-align": "center", color: "var(--ink-muted)", padding: "40px 0" }}>
                  No previous conversions recorded yet.
                </div>
              </Show>
              <For each={history()}>
                {(item) => (
                  <div class="history-item-card">
                    <div class="history-item-top">
                      <div class="history-item-name">{item.filename}.docx</div>
                      <div class="history-item-date">{item.timestamp} • {item.pageCount} pages</div>
                    </div>
                    <Show when={item.title}>
                      <div style={{ "font-size": "0.75rem", color: "var(--ink)", "font-weight": 600, "margin-bottom": "4px" }}>
                        📝 {item.title}
                      </div>
                    </Show>
                    <div class="history-item-paths">
                      <div class="history-path-badge" title={item.userPath || item.path}>
                        <span class="badge-tag user">User</span>
                        <span>{item.userPath || item.path}</span>
                      </div>
                      <Show when={item.historyPath}>
                        <div class="history-path-badge" title={item.historyPath}>
                          <span class="badge-tag archive">Archive</span>
                          <span>{item.historyPath}</span>
                        </div>
                      </Show>
                    </div>
                    <div style={{ display: "flex", gap: "8px", "margin-top": "6px", "flex-wrap": "wrap" }}>
                      <button
                        class="btn btn-secondary"
                        style={{ padding: "4px 10px", "font-size": "0.75rem" }}
                        onClick={() => copyToClipboard(item.userPath || item.path || "")}
                      >
                        Copy Path
                      </button>
                      <button
                        class="btn btn-primary"
                        style={{ padding: "4px 10px", "font-size": "0.75rem" }}
                        onClick={() => openHistoryDoc(item, false)}
                      >
                        Open
                      </button>
                      <Show when={item.historyPath}>
                        <button
                          class="btn btn-secondary"
                          style={{ padding: "4px 10px", "font-size": "0.75rem", background: "var(--bg-surface-elevated)" }}
                          onClick={() => openHistoryDoc(item, true)}
                          title="Open guaranteed permanent archive copy"
                        >
                          🏛️ Archive
                        </button>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>

      {/* ==================================================================
          Toast Notifications (with Copy & Dismiss actions)
          ================================================================== */}
      <div class="toast-container">
        <For each={toasts()}>
          {(t) => (
            <div class={`toast ${t.type}`}>
              <div class="toast-content">
                <span style={{ "font-size": "1.1rem" }}>{t.type === 'success' ? '✓' : t.type === 'error' ? '⚠️' : 'ℹ️'}</span>
                <div class="toast-message">{t.message}</div>
              </div>
              <div class="toast-actions">
                <Show when={t.type === 'error' && (t.rawError || t.message)}>
                  <button
                    class="toast-btn"
                    title="Copy full error to clipboard"
                    onClick={() => copyToClipboard(t.rawError || t.message)}
                  >
                    📋 Copy
                  </button>
                </Show>
                <button
                  class="toast-btn close"
                  title="Close notification"
                  onClick={() => removeToast(t.id)}
                >
                  ✕
                </button>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}