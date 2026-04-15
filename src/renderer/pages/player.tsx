import React, { useEffect, useRef, useState, useCallback } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import { useTranslation } from "react-i18next"
import { ArrowLeft, Maximize, Minimize, Pause, Play, Loader2, Sparkles, ListVideo, Scissors, Volume2, VolumeX, Mic, FileText, ArrowDown, Pencil, Download, Copy, Wand2, Split, Merge, AlertTriangle, RefreshCw, ListChecks, Check, X } from "lucide-react"
import { Button } from "@/renderer/components/ui/button"
import { Separator } from "@/renderer/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/renderer/components/ui/select"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/renderer/components/ui/resizable"
import { ScrollArea } from "@/renderer/components/ui/scroll-area"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/renderer/components/ui/dialog"
import { Checkbox } from "@/renderer/components/ui/checkbox"
import { Label } from "@/renderer/components/ui/label"
import type { AnalysisData } from "@/main/store"
import { toast } from "sonner"

/**
 * Whisper `avg_logprob` threshold: anything below this we flag as low-confidence.
 * logprob is <= 0; typical good values are > -0.5. -0.8 is quite low.
 */
const LOW_CONFIDENCE_THRESHOLD = -0.8

const TRANSCRIPTION_MODELS = [
  { value: "whisper-large-v3", label: "Whisper V3" },
  { value: "whisper-large-v3-turbo", label: "Whisper V3 Turbo" },
] as const

const CLAUDE_MODELS = [
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
  { value: "haiku", label: "Haiku" },
] as const


// ── SRT parsing ──────────────────────────────────────────────

interface Subtitle {
  startMs: number
  endMs: number
  text: string
  /** Whisper `avg_logprob` (<= 0, higher is more confident) when available. */
  confidence?: number
}

function parseSrt(srt: string): Subtitle[] {
  const blocks = srt.trim().split(/\n\s*\n/)
  const subs: Subtitle[] = []

  for (const block of blocks) {
    const lines = block.trim().split("\n")
    if (lines.length < 3) continue

    const m = lines[1].match(
      /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/
    )
    if (!m) continue

    const startMs = +m[1] * 3600000 + +m[2] * 60000 + +m[3] * 1000 + +m[4]
    const endMs = +m[5] * 3600000 + +m[6] * 60000 + +m[7] * 1000 + +m[8]
    subs.push({ startMs, endMs, text: lines.slice(2).join("\n") })
  }
  return subs
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || isNaN(seconds) || seconds < 0) return "0:00"
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
  return `${m}:${String(s).padStart(2, "0")}`
}

/** Format ms as H:MM:SS (YouTube chapter format, no leading zero on hours). */
function formatYouTubeTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, "0")
  const ss = String(sec).padStart(2, "0")
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Format ms as SRT timestamp: HH:MM:SS,mmm */
function formatSrtTimestamp(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const milli = Math.round(ms % 1000)
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(milli).padStart(3, "0")}`
}

/** Convert Subtitle[] back to SRT text. */
function subtitlesToSrt(subs: Subtitle[]): string {
  return subs
    .map((s, i) => `${i + 1}\n${formatSrtTimestamp(s.startMs)} --> ${formatSrtTimestamp(s.endMs)}\n${s.text}\n`)
    .join("\n")
}

/** A filename-safe slug for clip exports. */
function slugify(s: string, fallback: string): string {
  const cleaned = s.replace(/[\\/:*?"<>|\n\r\t]+/g, "").trim().slice(0, 60)
  return cleaned || fallback
}

// ── Playback Controls (from openscreen PlaybackControls.tsx) ─

interface PlaybackControlsProps {
  isPlaying: boolean
  currentTime: number
  duration: number
  isFullscreen: boolean
  volume: number
  clip: { startMs: number; endMs: number } | null
  sections: Array<{ startMs: number; endMs: number }> | null
  clearClipLabel: string
  onTogglePlayPause: () => void
  onSeek: (time: number) => void
  onToggleFullscreen: () => void
  onVolumeChange: (volume: number) => void
  onClearClip: () => void
}

function PlaybackControls({
  isPlaying,
  currentTime,
  duration,
  isFullscreen,
  volume,
  clip,
  sections,
  clearClipLabel,
  onTogglePlayPause,
  onSeek,
  onToggleFullscreen,
  onVolumeChange,
  onClearClip,
}: PlaybackControlsProps) {
  const [prevVolume, setPrevVolume] = useState(volume || 1)

  // When clip is active, remap time/duration to clip range
  const clipStart = clip ? clip.startMs / 1000 : 0
  const clipEnd = clip ? clip.endMs / 1000 : duration
  const clipDuration = clipEnd - clipStart
  const displayTime = clip ? Math.max(0, currentTime - clipStart) : currentTime
  const displayDuration = clip ? clipDuration : duration

  function handleSeekChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseFloat(e.target.value)
    // Map back to absolute time if clip is active
    onSeek(clip ? val + clipStart : val)
  }

  function handleToggleMute() {
    if (volume > 0) {
      setPrevVolume(volume)
      onVolumeChange(0)
    } else {
      onVolumeChange(prevVolume)
    }
  }

  const progress = displayDuration > 0 ? (displayTime / displayDuration) * 100 : 0

  return (
    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-1 py-0.5 shadow-xl backdrop-blur-md transition-all duration-300 hover:border-white/20 hover:bg-black/70">
      <Button
        onClick={onTogglePlayPause}
        variant="ghost"
        size="icon"
        className={
          isPlaying
            ? "size-8 rounded-full border border-white/10 bg-white/10 text-white shadow-none hover:bg-white/20 hover:text-white"
            : "size-8 rounded-full border border-white/10 bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.3)] hover:scale-105 hover:bg-white/90 hover:text-black"
        }
      >
        {isPlaying ? (
          <Pause className="size-3.5 fill-current" />
        ) : (
          <Play className="ml-0.5 size-3.5 fill-current" />
        )}
      </Button>

      <span className="w-[30px] text-right text-[9px] font-medium tabular-nums text-slate-300">
        {formatTime(displayTime)}
      </span>

      <div className="group relative flex h-6 flex-1 items-center">
        {/* Progress bar track */}
        <div className={`absolute left-0 right-0 h-1 overflow-hidden rounded-full transition-all group-hover:h-1.5 ${clip ? "bg-primary/20" : "bg-white/15"}`}>
          <div
            className={`h-full rounded-full ${clip ? "bg-primary" : "bg-[#34B27B]"}`}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Section markers on the full timeline (above progress bar) */}
        {!clip && sections && duration > 0 && sections.map((sec, i) => {
          const left = (sec.startMs / 1000 / duration) * 100
          const width = ((sec.endMs - sec.startMs) / 1000 / duration) * 100
          const colors = ["bg-blue-500/50", "bg-emerald-500/50", "bg-amber-500/50", "bg-purple-500/50", "bg-rose-500/50"]
          return (
            <div
              key={i}
              className={`pointer-events-none absolute top-1/2 h-1.5 -translate-y-1/2 rounded-sm ${colors[i % colors.length]}`}
              style={{ left: `${left}%`, width: `${width}%` }}
            />
          )
        })}

        <input
          type="range"
          min="0"
          max={displayDuration || 100}
          value={displayTime}
          onChange={handleSeekChange}
          step="0.01"
          className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
        />

        <div
          className="pointer-events-none absolute size-2.5 rounded-full bg-white shadow-lg transition-transform duration-100 group-hover:scale-125"
          style={{ left: `${progress}%`, transform: "translateX(-50%)" }}
        />
      </div>

      <span className="w-[30px] text-[9px] font-medium tabular-nums text-slate-500">
        {formatTime(displayDuration)}
      </span>

      {clip && (
        <button
          onClick={onClearClip}
          className="shrink-0 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-medium text-primary-foreground hover:bg-primary/80"
        >
          {clearClipLabel}
        </button>
      )}

      {/* Volume */}
      <div className="group/vol flex items-center">
        <Button
          onClick={handleToggleMute}
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 rounded-full border border-transparent text-white shadow-none hover:border-white/10 hover:bg-white/10 hover:text-white"
        >
          {volume === 0 ? (
            <VolumeX className="size-3.5" />
          ) : (
            <Volume2 className="size-3.5" />
          )}
        </Button>
        <div className="flex h-7 w-0 items-center overflow-hidden transition-all duration-200 group-hover/vol:w-16">
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
            className="h-1 w-14 cursor-pointer accent-white"
          />
        </div>
      </div>

      <Button
        onClick={onToggleFullscreen}
        variant="ghost"
        size="icon"
        className="ml-0.5 size-7 shrink-0 rounded-full border border-transparent text-white shadow-none hover:border-white/10 hover:bg-white/10 hover:text-white"
      >
        {isFullscreen ? (
          <Minimize className="size-3.5" />
        ) : (
          <Maximize className="size-3.5" />
        )}
      </Button>
    </div>
  )
}

// ── Video event handlers (from openscreen videoEventHandlers.ts) ─

function createVideoEventHandlers(params: {
  video: HTMLVideoElement
  isSeekingRef: React.MutableRefObject<boolean>
  isPlayingRef: React.MutableRefObject<boolean>
  allowPlaybackRef: React.MutableRefObject<boolean>
  currentTimeRef: React.MutableRefObject<number>
  timeUpdateAnimationRef: React.MutableRefObject<number | null>
  onPlayStateChange: (playing: boolean) => void
  onTimeUpdate: (time: number) => void
}) {
  const {
    video,
    isSeekingRef,
    isPlayingRef,
    allowPlaybackRef,
    currentTimeRef,
    timeUpdateAnimationRef,
    onPlayStateChange,
    onTimeUpdate,
  } = params

  const emitTime = (timeValue: number) => {
    currentTimeRef.current = timeValue * 1000
    onTimeUpdate(timeValue)
  }

  function updateTime() {
    if (!video) return

    emitTime(video.currentTime)

    if (!video.paused && !video.ended) {
      timeUpdateAnimationRef.current = requestAnimationFrame(updateTime)
    }
  }

  const handlePlay = () => {
    if (isSeekingRef.current) {
      video.pause()
      return
    }

    if (!allowPlaybackRef.current) {
      video.pause()
      return
    }

    isPlayingRef.current = true
    onPlayStateChange(true)
    if (timeUpdateAnimationRef.current) {
      cancelAnimationFrame(timeUpdateAnimationRef.current)
    }
    timeUpdateAnimationRef.current = requestAnimationFrame(updateTime)
  }

  const handlePause = () => {
    isPlayingRef.current = false
    onPlayStateChange(false)
    if (timeUpdateAnimationRef.current) {
      cancelAnimationFrame(timeUpdateAnimationRef.current)
      timeUpdateAnimationRef.current = null
    }
    emitTime(video.currentTime)
  }

  const handleSeeked = () => {
    isSeekingRef.current = false

    if (!isPlayingRef.current && !video.paused) {
      video.pause()
    }
    emitTime(video.currentTime)
  }

  const handleSeeking = () => {
    isSeekingRef.current = true

    if (!isPlayingRef.current && !video.paused) {
      video.pause()
    }
    emitTime(video.currentTime)
  }

  return { handlePlay, handlePause, handleSeeked, handleSeeking }
}

// ── Player Page ──────────────────────────────────────────────

interface PlayerPageProps {
  projectId: string
  filePath: string
  fileName: string
  hasSrt: boolean
  onBack: () => void
}

export function PlayerPage({ projectId, filePath, fileName, hasSrt: initialHasSrt, onBack }: PlayerPageProps) {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Refs matching openscreen's pattern
  const isSeekingRef = useRef(false)
  const isPlayingRef = useRef(false)
  const allowPlaybackRef = useRef(false)
  const currentTimeRef = useRef(0)
  const timeUpdateAnimationRef = useRef<number | null>(null)

  const [subtitles, setSubtitles] = useState<Subtitle[]>([])
  const [currentText, setCurrentText] = useState("")
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem("volume")
    return saved !== null ? parseFloat(saved) : 0.6
  })

  // Transcription state
  const [hasSrt, setHasSrt] = useState(initialHasSrt)
  const [transcribing, setTranscribing] = useState(false)
  const [transcribeStage, setTranscribeStage] = useState("")
  const [transcribeProgress, setTranscribeProgress] = useState(0)
  const [transcriptionModelKey, setTranscriptionModelKey] = useState("whisper-large-v3")
  const [claudeModelKey, setClaudeModelKey] = useState("sonnet")
  const [savedProgress, setSavedProgress] = useState<{ current: number; total: number } | null>(null)

  // Analysis state
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisStage, setAnalysisStage] = useState("")
  const [savedModels, setSavedModels] = useState<string[]>([])
  const [activeAnalysisModel, setActiveAnalysisModel] = useState<string | null>(null)
  const [panelTab, setPanelTab] = useState<"srt" | "analysis">("srt")

  // API key availability
  const [hasTranscriptionKey, setHasTranscriptionKey] = useState(false)

  // Clip playback: play only a specific time range
  const [activeClip, setActiveClip] = useState<{ startMs: number; endMs: number } | null>(null)
  const activeClipRef = useRef(activeClip)
  activeClipRef.current = activeClip

  // Subtitle editor state (A4)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editText, setEditText] = useState("")
  const editInputRef = useRef<HTMLInputElement>(null)
  const [retryingIdx, setRetryingIdx] = useState<number | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIdxs, setSelectedIdxs] = useState<Set<number>>(() => new Set())
  const [selectAnchor, setSelectAnchor] = useState<number | null>(null)
  const [retryingRange, setRetryingRange] = useState(false)

  // Clip export state (C2)
  const [exportProgress, setExportProgress] = useState<Record<string, number>>({})
  const [exportBurnSubs, setExportBurnSubs] = useState(false)
  const [exportPrecise, setExportPrecise] = useState(true)

  // Vocabulary / enhance transcription (A2)
  const [vocabOpen, setVocabOpen] = useState(false)
  const [vocabTerms, setVocabTerms] = useState<Array<{ term: string; selected: boolean }>>([])
  const [vocabExtracting, setVocabExtracting] = useState(false)
  const [vocabCustom, setVocabCustom] = useState("")

  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(null)
  const subtitlesRef = useRef<Subtitle[]>([])
  const [srtAutoScroll, setSrtAutoScroll] = useState(true)
  const srtAutoScrollRef = useRef(true)
  const prevActiveSrtIdx = useRef<number>(-1)
  const srtScrollRef = useRef<HTMLDivElement>(null)
  subtitlesRef.current = subtitles
  const handlersRef = useRef<ReturnType<typeof createVideoEventHandlers> | null>(null)

  // Load API key availability + saved transcription progress
  useEffect(() => {
    window.electronAPI.getBackendSettings().then((s) => {
      setHasTranscriptionKey(s.transcriptionApiKeys?.length > 0)
    })
    window.electronAPI.getTranscriptionProgress(projectId).then((p) => {
      if (p && p.currentChunk < p.numChunks) {
        setSavedProgress({ current: p.currentChunk, total: p.numChunks })
      }
    })
  }, [])

  // Load SRT + existing analysis.
  // Prefer segments.json (has confidence scores); fall back to parsed SRT for legacy projects.
  useEffect(() => {
    (async () => {
      const segs = await window.electronAPI.readSegments(projectId)
      if (Array.isArray(segs) && segs.length > 0) {
        setSubtitles(segs.map((s: any) => ({
          startMs: s.startMs, endMs: s.endMs, text: s.text,
          confidence: typeof s.confidence === "number" ? s.confidence : undefined,
        })))
        setHasSrt(true)
        return
      }
      const srt = await window.electronAPI.readSrt(projectId)
      if (srt) {
        setSubtitles(parseSrt(srt))
        setHasSrt(true)
      }
    })()
    window.electronAPI.listAnalysisModels(projectId).then((models) => {
      setSavedModels(models)
      if (models.length > 0) {
        // Load the first saved model's analysis
        const firstModel = models[0]
        setActiveAnalysisModel(firstModel)
        window.electronAPI.getAnalysisDataForModel(projectId, firstModel).then((data) => {
          if (data) setAnalysis(data)
        })
      } else {
        // Fallback to legacy analysis.json
        window.electronAPI.getAnalysisData(projectId).then((data) => {
          if (data) setAnalysis(data)
        })
      }
    })
  }, [projectId])

  // Analysis status listener
  useEffect(() => {
    const cleanup = window.electronAPI.onAnalyzerStatus((pid, status) => {
      if (pid !== projectId) return
      try {
        const data = JSON.parse(status)
        if (data.key) { setAnalysisStage(t(data.key, data) as string); return }
      } catch { /* plain string */ }
      setAnalysisStage(status === "analyzing" ? t("player.analyzing") : status)
    })
    return cleanup
  }, [projectId, t])

  // Transcription progress listeners
  useEffect(() => {
    const c1 = window.electronAPI.onWhisperProgress((pid, pct) => {
      if (pid === projectId) setTranscribeProgress(pct)
    })
    const c2 = window.electronAPI.onWhisperStage((pid, stage) => {
      if (pid !== projectId) return
      try {
        const data = JSON.parse(stage)
        if (data.key) { setTranscribeStage(t(data.key, data) as string); return }
      } catch { /* plain string */ }
      setTranscribeStage(stage)
    })
    return () => { c1(); c2() }
  }, [projectId])

  const handleTranscribe = useCallback(async () => {
    setTranscribing(true)
    setSavedProgress(null)
    // error shown via toast
    setTranscribeStage(t("player.convertingAudio"))
    setTranscribeProgress(0)
    try {
      // Step 1: Extract audio
      const extractResult = await window.electronAPI.extractAudio(projectId)
      if (!extractResult.success) {
        toast.error(extractResult.error ?? "Audio extraction failed")
        return
      }
      // Step 2: Transcribe
      setTranscribeStage(t("player.recognizing"))
      const autoRefine = localStorage.getItem("autoRefineLowConfidence") !== "0"
      const result = await window.electronAPI.transcribe(projectId, transcriptionModelKey, autoRefine)
      if (result.success) {
        // Prefer segments.json (has confidence); fall back to SRT.
        const segs = await window.electronAPI.readSegments(projectId)
        if (Array.isArray(segs) && segs.length > 0) {
          setSubtitles(segs.map((s: any) => ({
            startMs: s.startMs, endMs: s.endMs, text: s.text,
            confidence: typeof s.confidence === "number" ? s.confidence : undefined,
          })))
        } else {
          const srt = await window.electronAPI.readSrt(projectId)
          if (srt) setSubtitles(parseSrt(srt))
        }
        setHasSrt(true)
        setPanelTab("srt")
      } else {
        toast.error(result.error ?? "Transcription failed")
      }
    } catch (err) {
      toast.error(String(err))
    } finally {
      setTranscribing(false)
    }
  }, [projectId, transcriptionModelKey])

  // Wrap claudeModelKey in a ref so handleAnalyze always sees the latest value
  const claudeModelRef = useRef(claudeModelKey)
  claudeModelRef.current = claudeModelKey

  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true)
    setAnalysisStage(t("player.analyzing"))
    try {
      const selectedModel = claudeModelRef.current
      const result = await window.electronAPI.analyzeProject(projectId, selectedModel)
      if (result.success && result.data) {
        setAnalysis(result.data)
        setActiveAnalysisModel(result.model ?? "claude")
        const models = await window.electronAPI.listAnalysisModels(projectId)
        setSavedModels(models)
      } else {
        console.error("[analyzer] failed:", result.error)
        toast.error(result.error ?? "Unknown error")
      }
    } catch (err) {
      console.error("[analyzer] exception:", err)
      toast.error(String(err))
    } finally {
      setAnalyzing(false)
    }
  }, [projectId])

  // Subtitle update + clip boundary check (driven by onTimeUpdate callback)
  const updateSubtitle = useCallback((timeSec: number) => {
    const ms = timeSec * 1000
    const active = subtitlesRef.current.find((s) => ms >= s.startMs && ms <= s.endMs)
    setCurrentText(active?.text ?? "")

    // Auto-pause at clip end
    const clip = activeClipRef.current
    if (clip && ms >= clip.endMs) {
      const video = videoRef.current
      if (video) {
        allowPlaybackRef.current = false
        video.pause()
        video.currentTime = clip.endMs / 1000
      }
    }
  }, [])

  // Set up video event handlers (from openscreen videoEventHandlers.ts)
  const handleLoadedMetadata = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget
    setDuration(video.duration)
    video.currentTime = 0
    video.volume = volume
    video.pause()
    allowPlaybackRef.current = false
    currentTimeRef.current = 0

    const handlers = createVideoEventHandlers({
      video,
      isSeekingRef,
      isPlayingRef,
      allowPlaybackRef,
      currentTimeRef,
      timeUpdateAnimationRef,
      onPlayStateChange: setIsPlaying,
      onTimeUpdate: (time) => {
        setCurrentTime(time)
        updateSubtitle(time)
      },
    })
    handlersRef.current = handlers

    video.onplay = handlers.handlePlay
    video.onpause = handlers.handlePause
    video.onseeking = handlers.handleSeeking
    video.onseeked = handlers.handleSeeked
  }, [updateSubtitle])

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (timeUpdateAnimationRef.current) cancelAnimationFrame(timeUpdateAnimationRef.current)
    }
  }, [])

  // Play/pause matching openscreen's VideoEditor.togglePlayPause + VideoPlayback.play/pause
  const togglePlayPause = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    if (isPlaying) {
      // pause: from openscreen VideoPlayback.pause()
      allowPlaybackRef.current = false
      video.pause()
    } else {
      // play: from openscreen VideoPlayback.play()
      allowPlaybackRef.current = true
      video.play().catch((err) => {
        if (err.name !== "AbortError") console.error("Video play failed:", err)
        allowPlaybackRef.current = false
      })
    }
  }, [isPlaying])

  // Seek: from openscreen VideoEditor.handleSeek
  const handleSeek = useCallback((time: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = time
  }, [])

  const handleVolumeChange = useCallback((v: number) => {
    setVolume(v)
    localStorage.setItem("volume", String(v))
    if (videoRef.current) videoRef.current.volume = v
  }, [])

  // Fullscreen
  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen()
    else el.requestFullscreen()
  }, [])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", handler)
    return () => document.removeEventListener("fullscreenchange", handler)
  }, [])

  // Auto-hide controls
  const resetHideTimer = useCallback(() => {
    setShowControls(true)
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setShowControls(false)
    }, 3000)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const video = videoRef.current
      if (!video) return
      if (e.key === " " || e.key === "k") { e.preventDefault(); togglePlayPause() }
      else if (e.key === "ArrowLeft") { video.currentTime = Math.max(0, video.currentTime - 5); resetHideTimer() }
      else if (e.key === "ArrowRight") { video.currentTime = Math.min(video.duration, video.currentTime + 5); resetHideTimer() }
      else if (e.key === "f") toggleFullscreen()
      else if (e.key === "Escape" && isFullscreen) document.exitFullscreen()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [togglePlayPause, toggleFullscreen, resetHideTimer, isFullscreen])

  // From openscreen projectPersistence.ts toFileUrl()
  const videoSrc = (() => {
    const normalized = filePath.replace(/\\/g, "/")
    const encoded = normalized
      .split("/")
      .map((segment, index) => {
        if (!segment) return ""
        // Keep Windows drive letter as-is (e.g. "C:")
        if (index === 0 && /^[a-zA-Z]:$/.test(segment)) return segment
        return encodeURIComponent(segment)
      })
      .join("/")
    return `file:///${encoded}`
  })()

  const seekToMs = useCallback((ms: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = ms / 1000
  }, [])

  const playClip = useCallback((startMs: number, endMs: number) => {
    const video = videoRef.current
    if (!video) return
    setActiveClip({ startMs, endMs })
    video.currentTime = startMs / 1000
    allowPlaybackRef.current = true
    video.play().catch(() => { allowPlaybackRef.current = false })
  }, [])

  const clearClip = useCallback(() => {
    setActiveClip(null)
  }, [])

  // ── Subtitle editing (A4) ─────────────────────────────────
  const persistSubtitles = useCallback(async (next: Subtitle[]) => {
    setSubtitles(next)
    const segsToSave = next.map((s, i) => ({
      index: i + 1,
      startMs: s.startMs, endMs: s.endMs, text: s.text,
      confidence: s.confidence,
    }))
    await window.electronAPI.saveSegments(projectId, segsToSave)
    await window.electronAPI.saveSrt(projectId, subtitlesToSrt(next))
  }, [projectId])

  const startEditSubtitle = useCallback((idx: number) => {
    setEditingIdx(idx)
    setEditText(subtitlesRef.current[idx]?.text ?? "")
    setTimeout(() => editInputRef.current?.focus(), 0)
  }, [])

  const commitEditSubtitle = useCallback(async () => {
    if (editingIdx == null) return
    const next = [...subtitlesRef.current]
    const cur = next[editingIdx]
    if (!cur) { setEditingIdx(null); return }
    // User-edited text is implicitly high-confidence — clear the flag.
    next[editingIdx] = { ...cur, text: editText, confidence: undefined }
    await persistSubtitles(next)
    setEditingIdx(null)
  }, [editingIdx, editText, persistSubtitles])

  const cancelEditSubtitle = useCallback(() => {
    setEditingIdx(null)
    setEditText("")
  }, [])

  const mergeWithNext = useCallback(async (idx: number) => {
    const cur = subtitlesRef.current
    if (idx < 0 || idx >= cur.length - 1) return
    const merged: Subtitle = {
      startMs: cur[idx].startMs,
      endMs: cur[idx + 1].endMs,
      text: `${cur[idx].text}${cur[idx].text.endsWith(" ") ? "" : ""}${cur[idx + 1].text}`.trim(),
      confidence: undefined,
    }
    const next = [...cur.slice(0, idx), merged, ...cur.slice(idx + 2)]
    await persistSubtitles(next)
  }, [persistSubtitles])

  const splitSubtitle = useCallback(async (idx: number) => {
    const cur = subtitlesRef.current
    const target = cur[idx]
    if (!target || target.text.length < 2) return
    // Split text at middle char; split time proportionally.
    const mid = Math.floor(target.text.length / 2)
    const leftText = target.text.slice(0, mid).trim()
    const rightText = target.text.slice(mid).trim()
    if (!leftText || !rightText) return
    const midMs = target.startMs + Math.round((target.endMs - target.startMs) * (mid / target.text.length))
    const left: Subtitle = { startMs: target.startMs, endMs: midMs, text: leftText, confidence: undefined }
    const right: Subtitle = { startMs: midMs, endMs: target.endMs, text: rightText, confidence: undefined }
    const next = [...cur.slice(0, idx), left, right, ...cur.slice(idx + 1)]
    await persistSubtitles(next)
  }, [persistSubtitles])

  const retranscribeSubtitle = useCallback(async (idx: number) => {
    const cur = subtitlesRef.current
    const target = cur[idx]
    if (!target) return
    const CONTEXT_SPAN = 3
    const before = cur.slice(Math.max(0, idx - CONTEXT_SPAN), idx).map((s) => s.text).join("")
    const after = cur.slice(idx + 1, idx + 1 + CONTEXT_SPAN).map((s) => s.text).join("")
    setRetryingIdx(idx)
    try {
      const result = await window.electronAPI.retranscribeSegment(
        projectId, target.startMs, target.endMs, before, after, transcriptionModelKey,
      )
      if (!result.success || !result.text) {
        toast.error(result.error || t("player.retranscribeFailed"))
        return
      }
      const next = [...subtitlesRef.current]
      const latest = next[idx]
      if (!latest) return
      next[idx] = { ...latest, text: result.text, confidence: undefined }
      await persistSubtitles(next)
      toast.success(t("player.retranscribeDone"))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setRetryingIdx(null)
    }
  }, [projectId, transcriptionModelKey, persistSubtitles, t])

  const toggleSelectMode = useCallback(() => {
    setSelectMode((prev) => {
      if (prev) {
        setSelectedIdxs(new Set())
        setSelectAnchor(null)
      }
      return !prev
    })
  }, [])

  const toggleSelectRow = useCallback((idx: number, shiftKey: boolean) => {
    setSelectedIdxs((prev) => {
      const next = new Set(prev)
      if (shiftKey && selectAnchor !== null) {
        const lo = Math.min(selectAnchor, idx)
        const hi = Math.max(selectAnchor, idx)
        for (let i = lo; i <= hi; i++) next.add(i)
        return next
      }
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
    if (!shiftKey) setSelectAnchor(idx)
  }, [selectAnchor])

  const clearSelection = useCallback(() => {
    setSelectedIdxs(new Set())
    setSelectAnchor(null)
  }, [])

  const retranscribeSelection = useCallback(async () => {
    if (selectedIdxs.size === 0) return
    const sorted = [...selectedIdxs].sort((a, b) => a - b)
    const lo = sorted[0]
    const hi = sorted[sorted.length - 1]
    // Enforce contiguous selection.
    if (hi - lo + 1 !== sorted.length) {
      toast.error(t("player.selectionNotContiguous"))
      return
    }
    const cur = subtitlesRef.current
    const first = cur[lo]
    const last = cur[hi]
    if (!first || !last) return
    const CONTEXT_SPAN = 3
    const before = cur.slice(Math.max(0, lo - CONTEXT_SPAN), lo).map((s) => s.text).join("")
    const after = cur.slice(hi + 1, hi + 1 + CONTEXT_SPAN).map((s) => s.text).join("")
    setRetryingRange(true)
    try {
      const result = await window.electronAPI.retranscribeRange(
        projectId, first.startMs, last.endMs, before, after, transcriptionModelKey,
      )
      if (!result.success || !result.segments || result.segments.length === 0) {
        toast.error(result.error || t("player.retranscribeFailed"))
        return
      }
      const replacement: Subtitle[] = result.segments.map((s) => ({
        startMs: s.startMs, endMs: s.endMs, text: s.text, confidence: undefined as number | undefined,
      }))
      const next = [...cur.slice(0, lo), ...replacement, ...cur.slice(hi + 1)]
      await persistSubtitles(next)
      toast.success(t("player.retranscribeDone"))
      setSelectedIdxs(new Set())
      setSelectAnchor(null)
      setSelectMode(false)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setRetryingRange(false)
    }
  }, [selectedIdxs, projectId, transcriptionModelKey, persistSubtitles, t])

  // ── YouTube chapters (B1) ─────────────────────────────────
  const copyYouTubeChapters = useCallback(async () => {
    if (!analysis || analysis.sections.length === 0) return
    // YouTube requires the first chapter to be 00:00.
    const lines: string[] = []
    const sections = [...analysis.sections].sort((a, b) => a.startMs - b.startMs)
    lines.push(`00:00 ${sections[0].title}`)
    for (let i = 1; i < sections.length; i++) {
      lines.push(`${formatYouTubeTime(sections[i].startMs)} ${sections[i].title}`)
    }
    const text = lines.join("\n")
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t("player.copiedYouTubeChapters"))
    } catch {
      toast.error("Copy failed")
    }
  }, [analysis, t])

  // ── Clip export (C1/C2) ────────────────────────────────────
  useEffect(() => {
    const cleanup = window.electronAPI.onExportProgress((pid, clipKey, percent) => {
      if (pid !== projectId) return
      setExportProgress((prev) => ({ ...prev, [clipKey]: percent }))
    })
    return cleanup
  }, [projectId])

  const exportClip = useCallback(async (clip: { title: string; startMs: number; endMs: number }) => {
    const key = `${clip.startMs}-${clip.endMs}`
    setExportProgress((prev) => ({ ...prev, [key]: 0 }))
    try {
      const result = await window.electronAPI.exportClip(projectId, clip, {
        burnSubtitles: exportBurnSubs,
        precise: exportPrecise || exportBurnSubs,
      })
      if (result.success && result.outputPath) {
        toast.success(t("player.clipExported", { path: result.outputPath }), {
          action: {
            label: t("player.revealInFolder"),
            onClick: () => window.electronAPI.revealInFolder(result.outputPath),
          },
        })
      } else {
        toast.error(result.error ?? "Export failed")
      }
    } catch (err) {
      toast.error(String(err))
    } finally {
      setExportProgress((prev) => {
        const { [key]: _, ...rest } = prev
        return rest
      })
    }
  }, [projectId, t, exportBurnSubs, exportPrecise])

  // ── Enhance transcription: vocabulary extraction (A2) ─────
  const openVocabDialog = useCallback(async () => {
    setVocabOpen(true)
    setVocabExtracting(true)
    try {
      const existing = await window.electronAPI.readVocabulary(projectId)
      // Kick off fresh extraction from current SRT.
      const result = await window.electronAPI.extractVocabulary(projectId)
      setVocabExtracting(false)
      if (result.success && Array.isArray(result.terms)) {
        const existingSet = new Set<string>(existing)
        const merged: Array<{ term: string; selected: boolean }> = []
        for (const t of result.terms) {
          merged.push({ term: t, selected: existingSet.has(t) })
        }
        // Append any existing terms not re-discovered.
        for (const ex of existing) {
          if (!result.terms.includes(ex)) {
            merged.push({ term: ex, selected: true })
          }
        }
        setVocabTerms(merged)
      } else {
        // Extraction failed but still allow manual editing.
        setVocabTerms(existing.map((term: string) => ({ term, selected: true })))
        if (result.error) toast.error(result.error)
      }
    } catch (err) {
      setVocabExtracting(false)
      toast.error(String(err))
    }
  }, [projectId])

  const saveVocabAndReTranscribe = useCallback(async () => {
    const chosen = vocabTerms.filter((v) => v.selected).map((v) => v.term)
    const custom = vocabCustom.split(/[、,\s\n]+/).map((s) => s.trim()).filter(Boolean)
    const all = Array.from(new Set([...chosen, ...custom]))
    await window.electronAPI.saveVocabulary(projectId, all)
    setVocabOpen(false)
    toast.info(t("player.vocabSavedPrompt"))
  }, [projectId, vocabTerms, vocabCustom, t])

  const formatMs = (ms: number) => {
    const s = Math.floor(ms / 1000)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    return `${m}:${String(sec).padStart(2, "0")}`
  }

  const currentMs = currentTime * 1000
  const activeSrtIdx = subtitles.findIndex((s) => currentMs >= s.startMs && currentMs < s.endMs)

  const srtVirtualizer = useVirtualizer({
    count: subtitles.length,
    getScrollElement: () => srtScrollRef.current,
    estimateSize: () => 52,
    overscan: 10,
  })

  useEffect(() => {
    if (!srtAutoScrollRef.current) return
    if (activeSrtIdx === -1 || activeSrtIdx === prevActiveSrtIdx.current) return
    prevActiveSrtIdx.current = activeSrtIdx
    srtVirtualizer.scrollToIndex(activeSrtIdx, { align: "center", behavior: "smooth" })
  }, [activeSrtIdx, srtVirtualizer])

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-background">
      {!isFullscreen && (
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <Button variant="ghost" size="icon" className="size-8" onClick={onBack}>
            <ArrowLeft className="size-4" />
          </Button>
          <span className="flex-1 truncate text-sm font-medium">{fileName}</span>

          {/* Step 1: Transcription */}
          <div className="flex items-center gap-1">
            {!transcribing ? (
              <>
                <Select value={transcriptionModelKey} onValueChange={setTranscriptionModelKey}>
                  <SelectTrigger className="h-8 w-40 text-xs" disabled={!hasTranscriptionKey}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRANSCRIPTION_MODELS.map((m) => (
                      <SelectItem key={m.value} value={m.value} className="text-xs">
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={handleTranscribe} disabled={!hasTranscriptionKey}
                  title={!hasTranscriptionKey ? t("player.transcribeNoKey") : undefined}
                >
                  <Mic className="mr-1 size-4" />
                  {savedProgress ? t("player.resumeTranscribe", { current: savedProgress.current, total: savedProgress.total }) : hasSrt ? t("player.retranscribe") : t("player.transcribe")}
                </Button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                <span className="text-xs text-muted-foreground">{transcribeStage} {transcribeProgress > 0 ? `${transcribeProgress}%` : ""}</span>
              </div>
            )}
          </div>

          <Separator orientation="vertical" className="h-5" />

          {/* Step 2: Analysis */}
          <div className="flex items-center gap-1">
            {!analyzing ? (
              <>
                <Select value={claudeModelKey} onValueChange={setClaudeModelKey}>
                  <SelectTrigger className="h-8 w-36 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLAUDE_MODELS.map((m) => (
                      <SelectItem key={m.value} value={m.value} className="text-xs">
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={handleAnalyze}
                  disabled={!hasSrt}
                  title={!hasSrt ? t("player.analyzeNoSrt") : undefined}
                >
                  <Sparkles className="mr-1 size-4" />
                  {analysis ? t("player.reanalyze") : t("player.analyze")}
                </Button>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled>
                  <Loader2 className="mr-1 size-4 animate-spin" />
                  {t("player.analyzing")}
                </Button>
                <span className="text-xs text-muted-foreground">{analysisStage}</span>
              </div>
            )}
          </div>
        </div>
      )}

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        {/* Video area */}
        <ResizablePanel defaultSize={75} minSize={20}>
        <div
          ref={containerRef}
          className="relative flex h-full cursor-pointer items-center justify-center overflow-hidden bg-black"
          onMouseMove={resetHideTimer}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("[data-controls]")) return
            togglePlayPause()
            resetHideTimer()
          }}
        >
          <video
            ref={videoRef}
            src={videoSrc}
            className="size-full object-contain"
            preload="metadata"
            playsInline
            onLoadedMetadata={handleLoadedMetadata}
            onDurationChange={(e) => setDuration(e.currentTarget.duration)}
            onError={() => console.error("Failed to load video")}
          />

          {currentText && (
            <div className="pointer-events-none absolute bottom-20 left-0 right-0 text-center">
              <span
                className="inline-block rounded-md bg-black/80 px-4 py-2 text-xl font-medium leading-relaxed text-white"
                style={{ textShadow: "0 2px 8px rgba(0,0,0,0.9)" }}
              >
                {currentText}
              </span>
            </div>
          )}

          <div
            data-controls
            className={`absolute bottom-4 left-4 right-4 transition-opacity duration-300 ${
              showControls ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            <PlaybackControls
              isPlaying={isPlaying}
              currentTime={currentTime}
              duration={duration}
              isFullscreen={isFullscreen}
              volume={volume}
              clip={activeClip}
              sections={analysis?.sections ?? null}
              onTogglePlayPause={togglePlayPause}
              onSeek={handleSeek}
              onToggleFullscreen={toggleFullscreen}
              onVolumeChange={handleVolumeChange}
              clearClipLabel={t("player.clearClip")}
              onClearClip={clearClip}
            />
          </div>
        </div>
        </ResizablePanel>

        {/* Side panel */}
        {!isFullscreen && <ResizableHandle withHandle />}
        <ResizablePanel defaultSize={isFullscreen ? 0 : 25} minSize={isFullscreen ? 0 : 15}>
          <div className={`flex h-full flex-col bg-background ${isFullscreen ? "hidden" : ""}`}>
            <div className="flex border-b">
              {hasSrt && (
                <button
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                    panelTab === "srt"
                      ? "border-b-2 border-primary text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => { setPanelTab("srt"); setActiveClip(null) }}
                >
                  <FileText className="mr-1 inline size-3.5" />
                  {t("player.tabSubtitles", { count: subtitles.length })}
                </button>
              )}
              {(analysis || savedModels.length > 0) && (
                <button
                  className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                    panelTab === "analysis"
                      ? "border-b-2 border-primary text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  onClick={() => { setPanelTab("analysis"); setActiveClip(null) }}
                >
                  <Sparkles className="mr-1 inline size-3.5" />
                  {t("player.tabAnalysis")}
                </button>
              )}
            </div>

            {panelTab === "srt" && (
              <div className="relative flex flex-1 flex-col overflow-hidden">
                <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px]"
                    onClick={openVocabDialog}
                    disabled={!hasSrt}
                    title={t("player.enhanceTranscriptTooltip") as string}
                  >
                    <Wand2 className="mr-1 size-3.5" />
                    {t("player.enhanceTranscript")}
                  </Button>
                  <Button
                    size="sm"
                    variant={selectMode ? "default" : "ghost"}
                    className="h-7 text-[11px]"
                    onClick={toggleSelectMode}
                    disabled={!hasSrt}
                    title={t("player.selectModeTooltip") as string}
                  >
                    <ListChecks className="mr-1 size-3.5" />
                    {t("player.selectMode")}
                  </Button>
                </div>
                <div
                  ref={srtScrollRef}
                  className="relative flex-1 overflow-y-auto"
                  onWheel={() => { if (srtAutoScrollRef.current) { srtAutoScrollRef.current = false; setSrtAutoScroll(false) } }}
                >
                  <div style={{ height: srtVirtualizer.getTotalSize(), position: "relative" }}>
                    {srtVirtualizer.getVirtualItems().map((vItem) => {
                      const sub = subtitles[vItem.index]
                      const active = vItem.index === activeSrtIdx
                      const isEditing = editingIdx === vItem.index
                      const lowConfidence = typeof sub.confidence === "number" && sub.confidence < LOW_CONFIDENCE_THRESHOLD
                      const isSelected = selectMode && selectedIdxs.has(vItem.index)
                      return (
                        <div
                          key={vItem.index}
                          style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vItem.start}px)` }}
                          ref={srtVirtualizer.measureElement}
                          data-index={vItem.index}
                          className={`group border-b px-3 py-2 transition-colors cursor-pointer ${
                            active ? "bg-accent/50 border-l-2 border-l-primary" : "hover:bg-accent"
                          } ${lowConfidence ? "bg-orange-500/10 border-l-2 border-l-orange-500/60" : ""} ${
                            isSelected ? "bg-primary/15 border-l-2 border-l-primary" : ""
                          }`}
                          onClick={(e) => {
                            if (isEditing) return
                            if (selectMode) { toggleSelectRow(vItem.index, e.shiftKey); return }
                            setActiveClip(null); seekToMs(sub.startMs)
                          }}
                        >
                          <div className="flex items-center gap-1.5">
                            {selectMode && (
                              <span className={`inline-flex size-3.5 items-center justify-center rounded border ${
                                isSelected ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/50"
                              }`}>
                                {isSelected && <Check className="size-2.5" />}
                              </span>
                            )}
                            <span className="text-[10px] tabular-nums text-muted-foreground">
                              {formatMs(sub.startMs)} – {formatMs(sub.endMs)}
                            </span>
                            {lowConfidence && (
                              <AlertTriangle className="size-3 text-orange-500" aria-label={t("player.lowConfidence") as string} />
                            )}
                            <div className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                              {lowConfidence && (
                                <button
                                  type="button"
                                  className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
                                  title={t("player.retranscribeSubtitle") as string}
                                  disabled={retryingIdx === vItem.index}
                                  onClick={(e) => { e.stopPropagation(); retranscribeSubtitle(vItem.index) }}
                                >
                                  {retryingIdx === vItem.index
                                    ? <Loader2 className="size-3 animate-spin" />
                                    : <RefreshCw className="size-3" />}
                                </button>
                              )}
                              <button
                                type="button"
                                className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                                title={t("player.editSubtitle") as string}
                                onClick={(e) => { e.stopPropagation(); startEditSubtitle(vItem.index) }}
                              >
                                <Pencil className="size-3" />
                              </button>
                              <button
                                type="button"
                                className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                                title={t("player.splitSubtitle") as string}
                                onClick={(e) => { e.stopPropagation(); splitSubtitle(vItem.index) }}
                              >
                                <Split className="size-3" />
                              </button>
                              {vItem.index < subtitles.length - 1 && (
                                <button
                                  type="button"
                                  className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                                  title={t("player.mergeSubtitle") as string}
                                  onClick={(e) => { e.stopPropagation(); mergeWithNext(vItem.index) }}
                                >
                                  <Merge className="size-3" />
                                </button>
                              )}
                            </div>
                          </div>
                          {isEditing ? (
                            <input
                              ref={editInputRef}
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); commitEditSubtitle() }
                                else if (e.key === "Escape") { e.preventDefault(); cancelEditSubtitle() }
                              }}
                              onBlur={commitEditSubtitle}
                              onClick={(e) => e.stopPropagation()}
                              className="mt-0.5 w-full rounded border border-primary bg-background px-1 py-0.5 text-sm outline-none"
                            />
                          ) : (
                            <p className="mt-0.5 text-sm">{sub.text}</p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
                {!srtAutoScroll && selectedIdxs.size === 0 && (
                  <button
                    className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg transition-opacity hover:opacity-90"
                    onClick={() => { srtAutoScrollRef.current = true; setSrtAutoScroll(true); if (activeSrtIdx !== -1) srtVirtualizer.scrollToIndex(activeSrtIdx, { align: "center", behavior: "smooth" }) }}
                  >
                    <ArrowDown className="size-3.5" />
                    {t("player.scrollToActive")}
                  </button>
                )}
                {selectMode && selectedIdxs.size > 0 && (
                  <div className="shrink-0 flex items-center gap-2 border-t bg-background px-3 py-2">
                    <span className="text-xs text-muted-foreground">
                      {t("player.selectedCount", { count: selectedIdxs.size })}
                    </span>
                    <Button
                      size="sm"
                      className="h-7 text-[11px]"
                      onClick={retranscribeSelection}
                      disabled={retryingRange}
                    >
                      {retryingRange
                        ? <Loader2 className="mr-1 size-3.5 animate-spin" />
                        : <RefreshCw className="mr-1 size-3.5" />}
                      {t("player.retranscribeSelection", { count: selectedIdxs.size })}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-[11px]"
                      onClick={clearSelection}
                      disabled={retryingRange}
                    >
                      <X className="mr-1 size-3.5" />
                      {t("player.clearSelection")}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {panelTab === "analysis" && analysis && (
              <div className="flex h-full flex-col">
              {savedModels.length > 1 && (
                <div className="flex items-center gap-1 border-b px-3 py-1.5">
                  {savedModels.map((m) => {
                    const label = m === "claude" ? "Claude" : m.split("/").pop()
                    const isActive = activeAnalysisModel === m
                    return (
                      <button
                        key={m}
                        className={`rounded-md px-2 py-0.5 text-[11px] transition-colors ${
                          isActive
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                        onClick={async () => {
                          const data = await window.electronAPI.getAnalysisDataForModel(projectId, m)
                          if (data) {
                            setAnalysis(data)
                            setActiveAnalysisModel(m)
                          }
                        }}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
              )}
              <ResizablePanelGroup orientation="vertical" className="flex-1">
                <ResizablePanel defaultSize={50} minSize={20}>
                  <div className="flex h-full flex-col">
                    <div className="flex items-center gap-1 border-b px-3 py-1.5">
                      <ListVideo className="size-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium text-muted-foreground">{t("player.tabSections", { count: analysis.sections.length })}</span>
                      <button
                        type="button"
                        className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
                        title={t("player.copyYouTubeChaptersTooltip") as string}
                        onClick={copyYouTubeChapters}
                        disabled={analysis.sections.length === 0}
                      >
                        <Copy className="size-3" />
                        {t("player.copyYouTubeChapters")}
                      </button>
                    </div>
                    <ScrollArea className="flex-1">
                      {analysis.sections.map((sec, i) => {
                        const active = currentMs >= sec.startMs && currentMs < sec.endMs
                        return (
                          <button
                            key={i}
                            className={`w-full border-b px-3 py-2.5 text-left transition-colors hover:bg-accent ${
                              active ? "bg-accent/50 border-l-2 border-l-primary" : ""
                            }`}
                            onClick={() => { setActiveClip(null); seekToMs(sec.startMs) }}
                          >
                            <div className="flex items-baseline gap-2">
                              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                                {formatMs(sec.startMs)}
                              </span>
                              <span className="text-sm font-medium">{sec.title}</span>
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{sec.summary}</p>
                          </button>
                        )
                      })}
                    </ScrollArea>
                  </div>
                </ResizablePanel>
                <ResizableHandle withHandle orientation="vertical" />
                <ResizablePanel defaultSize={50} minSize={20}>
                  <div className="flex h-full flex-col">
                    <div className="flex items-center gap-1 border-b px-3 py-1.5">
                      <Scissors className="size-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium text-muted-foreground">{t("player.tabClips", { count: analysis.clips.length })}</span>
                      <div className="ml-auto flex items-center gap-2">
                        <label
                          className="flex items-center gap-1 text-[10px] text-muted-foreground"
                          title={t("player.exportBurnSubtitlesTooltip") as string}
                        >
                          <Checkbox
                            checked={exportBurnSubs}
                            onCheckedChange={(v) => setExportBurnSubs(v === true)}
                            className="size-3"
                          />
                          {t("player.exportBurnSubtitles")}
                        </label>
                      </div>
                    </div>
                    <ScrollArea className="flex-1">
                      {analysis.clips.map((clip, i) => {
                        const isActive = activeClip?.startMs === clip.startMs && activeClip?.endMs === clip.endMs
                        const exportKey = `${clip.startMs}-${clip.endMs}`
                        const exporting = exportProgress[exportKey] !== undefined
                        return (
                          <div
                            key={i}
                            className={`group w-full border-b px-3 py-2.5 text-left transition-colors hover:bg-accent ${
                              isActive ? "bg-accent/50 border-l-2 border-l-primary" : ""
                            }`}
                          >
                            <div
                              className="cursor-pointer"
                              onClick={() => {
                                if (isActive) clearClip()
                                else playClip(clip.startMs, clip.endMs)
                              }}
                            >
                              <div className="flex items-baseline gap-2">
                                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                                  {formatMs(clip.startMs)} – {formatMs(clip.endMs)}
                                </span>
                                {isActive && (
                                  <span className="text-[10px] text-primary">{t("player.playingClickToCancel")}</span>
                                )}
                                <button
                                  type="button"
                                  className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100 disabled:opacity-50"
                                  title={t("player.exportClipTooltip") as string}
                                  disabled={exporting}
                                  onClick={(e) => { e.stopPropagation(); exportClip(clip) }}
                                >
                                  {exporting ? (
                                    <>
                                      <Loader2 className="size-3 animate-spin" />
                                      {exportProgress[exportKey]}%
                                    </>
                                  ) : (
                                    <>
                                      <Download className="size-3" />
                                      {t("player.exportClip")}
                                    </>
                                  )}
                                </button>
                              </div>
                              <p className="mt-0.5 text-sm font-medium">{clip.title}</p>
                              <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{clip.reason}</p>
                            </div>
                          </div>
                        )
                      })}
                    </ScrollArea>
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Vocabulary / Enhance transcription dialog (A2) */}
      <Dialog open={vocabOpen} onOpenChange={setVocabOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("player.enhanceTranscript")}</DialogTitle>
            <DialogDescription>{t("player.enhanceTranscriptDesc")}</DialogDescription>
          </DialogHeader>
          {vocabExtracting ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("player.extractingVocabulary")}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="max-h-64 overflow-y-auto rounded border px-2 py-1">
                {vocabTerms.length === 0 ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">
                    {t("player.noVocabularyFound")}
                  </div>
                ) : (
                  vocabTerms.map((v, i) => (
                    <label key={i} className="flex cursor-pointer items-center gap-2 py-1 text-sm">
                      <Checkbox
                        checked={v.selected}
                        onCheckedChange={(checked) => {
                          setVocabTerms((prev) => prev.map((p, pi) => pi === i ? { ...p, selected: checked === true } : p))
                        }}
                      />
                      <span className={v.selected ? "" : "text-muted-foreground"}>{v.term}</span>
                    </label>
                  ))
                )}
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">{t("player.additionalTerms")}</Label>
                <textarea
                  value={vocabCustom}
                  onChange={(e) => setVocabCustom(e.target.value)}
                  placeholder={t("player.additionalTermsPlaceholder") as string}
                  className="mt-1 w-full rounded border bg-background px-2 py-1 text-sm outline-none focus:border-primary"
                  rows={2}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setVocabOpen(false)}>
              {t("settings.cancel")}
            </Button>
            <Button size="sm" onClick={saveVocabAndReTranscribe} disabled={vocabExtracting}>
              <Wand2 className="mr-1 size-3.5" />
              {t("player.saveVocabulary")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
