import { createSignal, onMount, For, Show } from "solid-js";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

// Interface definitions
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

interface HistoryItem {
  id: string;
  filename: string;
  path: string;
  timestamp: string;
  pageCount: number;
}

interface ToastInfo {
  id: number;
  message: string;
  type: "info" | "success" | "error";
  rawError?: string;
}

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

  // Document & Image State
  const [images, setImages] = createSignal<string[]>([]);
  const [cleanedImages, setCleanedImages] = createSignal<string[]>([]);
  const [outputFilename, setOutputFilename] = createSignal("Compiled_Document");
  const [viewMode, setViewMode] = createSignal<"raw" | "cleaned">("raw");

  // Processing & Results State
  const [isProcessing, setIsProcessing] = createSignal(false);
  const [progressPct, setProgressPct] = createSignal(0);
  const [progressMsg, setProgressMsg] = createSignal("System Ready");
  const [outputResult, setOutputResult] = createSignal<string | null>(null);
  const [lastError, setLastError] = createSignal<string | null>(null);

  // UI Modals & Drawers
  const [activeSidebarTab, setActiveSidebarTab] = createSignal<"ai" | "cv" | "output">("ai");
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
    return () => window.removeEventListener("click", handleWindowClick);
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

  const rotatePageItem = async (e: MouseEvent, index: number, angle: number) => {
    e.stopPropagation();
    const isCleaned = viewMode() === "cleaned" && cleanedImages().length > 0;
    const list = isCleaned ? cleanedImages() : images();
    const targetImg = list[index];
    if (!targetImg) return;

    try {
      await invoke("rotate_page", { path: targetImg, angle });
      setImageVersion(Date.now());
      addToast(`Rotated page ${index + 1} (${angle > 0 ? "+" : ""}${angle}°)`, "info");
    } catch (err: any) {
      addToast(`Rotation failed: ${err}`, "error", `${err}`);
    }
  };

  const clearAllScans = () => {
    setImages([]);
    setCleanedImages([]);
    setOutputResult(null);
    setLastError(null);
    setIsCvStale(false);
    addToast("Cleared all scans", "info");
  };

  // Run OpenCV Processing
  const executeOpenCV = async (): Promise<string[]> => {
    if (!images().length) return [];
    setIsProcessing(true);
    setLastError(null);
    setProgressPct(5);
    setProgressMsg("Running OpenCV ScanTailor Optimization Pipeline...");
    try {
      const results: string[] = await invoke("preprocess_images", {
        imagePaths: images(),
        settings: {
          split: cvSplit(),
          orient: cvOrient(),
          deskew: cvDeskew(),
          margins: cvMargins(),
          shadows: cvShadows(),
          denoise: cvDenoise(),
          mode: cvFilterMode()
        }
      });
      setCleanedImages(results);
      setIsCvStale(false);
      setImageVersion(Date.now());
      setViewMode("cleaned");
      addToast(`Optimized ${results.length} pages via OpenCV`, "success");
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
      const res = await invoke<string>("generate_docx", {
        apiKey: apiKey().trim(),
        cleanedPaths: pagesToProcess,
        originalImgPath: images()[0],
        docType: selectedPreset(),
        customPrompt: instructions(),
        model: model(),
        outputFilename: outputFilename().trim() || "Compiled_Document"
      });

      setOutputResult(res);
      addToast("Document created successfully!", "success");

      // Record in History
      const newHistoryItem: HistoryItem = {
        id: Date.now().toString(),
        filename: outputFilename(),
        path: res,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        pageCount: pagesToProcess.length
      };
      const currentList = Array.isArray(history()) ? history() : [];
      const updated = [newHistoryItem, ...currentList.slice(0, 19)];
      setHistory(updated);
      localStorage.setItem("SCANSMITH_HISTORY", JSON.stringify(updated));
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
      <main class="main-workspace">
        {/* Left Inspector Sidebar */}
        <aside class="inspector-sidebar">
          <div class="sidebar-tabs">
            <button
              class={`sidebar-tab-btn ${activeSidebarTab() === 'ai' ? 'active' : ''}`}
              onClick={() => setActiveSidebarTab('ai')}
            >
              <span>🤖</span> AI Presets
            </button>
            <button
              class={`sidebar-tab-btn ${activeSidebarTab() === 'cv' ? 'active' : ''}`}
              onClick={() => setActiveSidebarTab('cv')}
            >
              <span>⚡</span> OpenCV
            </button>
            <button
              class={`sidebar-tab-btn ${activeSidebarTab() === 'output' ? 'active' : ''}`}
              onClick={() => setActiveSidebarTab('output')}
            >
              <span>⚙️</span> Export
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

            {/* OpenCV Pipeline Tab */}
            <Show when={activeSidebarTab() === 'cv'}>
              {/* Enhancement Filter Mode */}
              <div class="setting-section">
                <div class="setting-title-row">
                  <label class="setting-label">Enhancement Filter</label>
                  <span class="setting-hint">Document style</span>
                </div>
                <div class="filter-mode-grid">
                  <button
                    class={`filter-mode-btn ${cvFilterMode() === 'color' ? 'active' : ''}`}
                    onClick={() => selectCvFilterMode('color')}
                    type="button"
                  >
                    <div class="filter-mode-icon">🎨</div>
                    <div class="filter-mode-text">
                      <div class="filter-mode-title">Color Doc</div>
                      <div class="filter-mode-sub">Whitens paper, keeps pen & colors</div>
                    </div>
                  </button>
                  <button
                    class={`filter-mode-btn ${cvFilterMode() === 'grayscale' ? 'active' : ''}`}
                    onClick={() => selectCvFilterMode('grayscale')}
                    type="button"
                  >
                    <div class="filter-mode-icon">🌑</div>
                    <div class="filter-mode-text">
                      <div class="filter-mode-title">Grayscale</div>
                      <div class="filter-mode-sub">High contrast crisp doc gray</div>
                    </div>
                  </button>
                  <button
                    class={`filter-mode-btn ${cvFilterMode() === 'bw' ? 'active' : ''}`}
                    onClick={() => selectCvFilterMode('bw')}
                    type="button"
                  >
                    <div class="filter-mode-icon">📄</div>
                    <div class="filter-mode-text">
                      <div class="filter-mode-title">Clean B&W</div>
                      <div class="filter-mode-sub">High-legibility adaptive binary</div>
                    </div>
                  </button>
                  <button
                    class={`filter-mode-btn ${cvFilterMode() === 'original' ? 'active' : ''}`}
                    onClick={() => selectCvFilterMode('original')}
                    type="button"
                  >
                    <div class="filter-mode-icon">🖼️</div>
                    <div class="filter-mode-text">
                      <div class="filter-mode-title">Natural</div>
                      <div class="filter-mode-sub">Geometric fixes only, raw photo</div>
                    </div>
                  </button>
                </div>
              </div>

              {/* Toggles */}
              <div class="setting-section">
                <div class="setting-title-row">
                  <label class="setting-label">Correction Tools</label>
                  <span class="setting-hint">{[cvSplit(), cvOrient(), cvDeskew(), cvMargins(), cvShadows(), cvDenoise()].filter(Boolean).length} Active</span>
                </div>
                <div class="cv-toggles-container">
                  <div class="toggle-row">
                    <div class="toggle-info">
                      <div class="toggle-name">📖 Split 2-Page Spreads</div>
                      <div class="toggle-desc">Detects center spine & separates dual-page book scans</div>
                    </div>
                    <label class="switch">
                      <input type="checkbox" checked={cvSplit()} onChange={(e) => toggleCvSetting(setCvSplit, "SCANSMITH_CV_SPLIT", e.currentTarget.checked)} />
                      <span class="slider"></span>
                    </label>
                  </div>

                  <div class="toggle-row">
                    <div class="toggle-info">
                      <div class="toggle-name">🧭 Auto Fix Orientation</div>
                      <div class="toggle-desc">Tesseract OSD automatically rotates upside-down/rotated pages</div>
                    </div>
                    <label class="switch">
                      <input type="checkbox" checked={cvOrient()} onChange={(e) => toggleCvSetting(setCvOrient, "SCANSMITH_CV_ORIENT", e.currentTarget.checked)} />
                      <span class="slider"></span>
                    </label>
                  </div>

                  <div class="toggle-row">
                    <div class="toggle-info">
                      <div class="toggle-name">📐 Auto Deskew Slant</div>
                      <div class="toggle-desc">Radon projection variance straightens slanted text lines</div>
                    </div>
                    <label class="switch">
                      <input type="checkbox" checked={cvDeskew()} onChange={(e) => toggleCvSetting(setCvDeskew, "SCANSMITH_CV_DESKEW", e.currentTarget.checked)} />
                      <span class="slider"></span>
                    </label>
                  </div>

                  <div class="toggle-row">
                    <div class="toggle-info">
                      <div class="toggle-name">✂️ Auto Crop & Margins</div>
                      <div class="toggle-desc">Trims dark scanned borders and adds uniform white margins</div>
                    </div>
                    <label class="switch">
                      <input type="checkbox" checked={cvMargins()} onChange={(e) => toggleCvSetting(setCvMargins, "SCANSMITH_CV_MARGINS", e.currentTarget.checked)} />
                      <span class="slider"></span>
                    </label>
                  </div>

                  <div class="toggle-row">
                    <div class="toggle-info">
                      <div class="toggle-name">💡 Shadow & Crease Removal</div>
                      <div class="toggle-desc">Equalizes illumination, camera shadows & book spine darkness</div>
                    </div>
                    <label class="switch">
                      <input type="checkbox" checked={cvShadows()} onChange={(e) => toggleCvSetting(setCvShadows, "SCANSMITH_CV_SHADOWS", e.currentTarget.checked)} />
                      <span class="slider"></span>
                    </label>
                  </div>

                  <div class="toggle-row">
                    <div class="toggle-info">
                      <div class="toggle-name">✨ Denoise & Despeckle</div>
                      <div class="toggle-desc">Removes isolated scanner dust specks and background noise</div>
                    </div>
                    <label class="switch">
                      <input type="checkbox" checked={cvDenoise()} onChange={(e) => toggleCvSetting(setCvDenoise, "SCANSMITH_CV_DENOISE", e.currentTarget.checked)} />
                      <span class="slider"></span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <Show when={images().length > 0}>
                <div class="setting-section">
                  <button
                    class="btn btn-primary"
                    style={{ width: "100%", "justify-content": "center" }}
                    onClick={runOpenCV}
                    disabled={isProcessing()}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ width: "16px", height: "16px" }}>
                      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                    </svg>
                    {isCvStale() ? "Apply Modified Settings" : "Run OpenCV Preprocessing"}
                  </button>
                  <Show when={isCvStale()}>
                    <div class="stale-settings-hint">
                      ⚡ Settings changed. Click above to re-apply to scans.
                    </div>
                  </Show>
                </div>
              </Show>
            </Show>

            {/* Output & Export Tab */}
            <Show when={activeSidebarTab() === 'output'}>
              <div class="setting-section">
                <div class="setting-title-row">
                  <label class="setting-label">Output Filename</label>
                  <span class="setting-hint">Saved in source folder</span>
                </div>
                <input
                  class="modern-input"
                  type="text"
                  value={outputFilename()}
                  onInput={(e) => setOutputFilename(e.currentTarget.value)}
                  placeholder="Compiled_Document"
                />
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
          </div>
        </aside>

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
                  {(img, idx) => (
                    <div class="page-card">
                      <div class="page-card-header">
                        <span class="page-number-badge">Page {idx() + 1}</span>
                        <div class="page-actions-row">
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
                        <img src={`${convertFileSrc(img)}?v=${imageVersion()}`} alt={`Scan page ${idx() + 1}`} />
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
                  )}
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
                  </Show>
                  <Show when={cleanedImages().length > 0}>
                    <button class="btn btn-secondary" onClick={runOpenCV} disabled={isProcessing()} title="Re-run with modified OpenCV settings">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style={{ width: "15px", height: "15px" }}>
                        <polyline points="23 4 23 10 17 10" />
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                      </svg>
                      {isCvStale() ? "Re-apply OpenCV" : "Re-run OpenCV"}
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
                  onClick={async () => {
                    const img = lightboxImg();
                    if (img) {
                      await invoke("rotate_page", { path: img, angle: -90 });
                      setImageVersion(Date.now());
                    }
                  }}
                  title="Rotate 90° CCW"
                >
                  ↺ Rotate CCW
                </button>
                <button
                  class="btn btn-secondary"
                  style={{ padding: "6px 10px", "font-size": "0.78rem" }}
                  onClick={async () => {
                    const img = lightboxImg();
                    if (img) {
                      await invoke("rotate_page", { path: img, angle: 90 });
                      setImageVersion(Date.now());
                    }
                  }}
                  title="Rotate 90° CW"
                >
                  ↻ Rotate CW
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
                <img src={`${convertFileSrc(lightboxImg()!)}?v=${imageVersion()}`} alt="Zoomed Scan" />
              </div>
            }>
              <div class="lightbox-compare-grid">
                <div class="lightbox-compare-col">
                  <div class="compare-col-header">Original Raw Scan</div>
                  <div class="lightbox-img-box">
                    <img src={`${convertFileSrc(images()[0])}?v=${imageVersion()}`} alt="Original Scan" />
                  </div>
                </div>
                <div class="lightbox-compare-col">
                  <div class="compare-col-header">Enhanced (OpenCV Pipeline)</div>
                  <div class="lightbox-img-box">
                    <img src={`${convertFileSrc(cleanedImages()[0])}?v=${imageVersion()}`} alt="Enhanced Scan" />
                  </div>
                </div>
              </div>
            </Show>
          </div>
        </div>
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
              <button class="page-mini-btn" onClick={() => setShowHistoryDrawer(false)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
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
                    <div class="history-item-path">{item.path}</div>
                    <div style={{ display: "flex", gap: "8px", "margin-top": "6px" }}>
                      <button class="btn btn-secondary" style={{ padding: "4px 10px", "font-size": "0.75rem" }} onClick={() => copyToClipboard(item.path)}>
                        Copy Path
                      </button>
                      <button class="btn btn-primary" style={{ padding: "4px 10px", "font-size": "0.75rem" }} onClick={() => openGeneratedDoc(item.path)}>
                        Open
                      </button>
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