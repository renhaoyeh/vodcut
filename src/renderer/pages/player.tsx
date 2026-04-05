import React, { useEffect, useRef, useState, useCallback } from "react"
import { ArrowLeft, Maximize, Minimize, Pause, Play, Loader2, Sparkles, ListVideo, Scissors, Volume2, VolumeX, Mic, FileText } from "lucide-react"
import { Button } from "@/renderer/components/ui/button"
import { Separator } from "@/renderer/components/ui/separator"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/renderer/components/ui/select"
import type { AnalysisData } from "@/main/store"
import { toast } from "sonner"

const TRANSCRIPTION_MODELS = [
  { value: "whisper-large-v3-turbo", label: "Whisper V3 Turbo" },
  { value: "whisper-large-v3", label: "Whisper V3" },
] as const

const ANALYSIS_MODELS = [
  { value: "gemini:gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "gemini:gemini-2.0-flash", label: "Gemini 2.0 Flash" },
  { value: "groq:meta-llama/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout 17B" },
  { value: "groq:llama-3.3-70b-versatile", label: "Llama 3.3 70B" },
  { value: "groq:llama-3.1-8b-instant", label: "Llama 3.1 8B" },
] as const

// ── SRT parsing ──────────────────────────────────────────────

interface Subtitle {
  startMs: number
  endMs: number
  text: string
}

function formatSrtTimestamp(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const milli = ms % 1000
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(milli).padStart(3, "0")}`
}

function subtitlesToSrt(subs: Subtitle[]): string {
  return subs
    .map((s, i) => `${i + 1}\n${formatSrtTimestamp(s.startMs)} --> ${formatSrtTimestamp(s.endMs)}\n${s.text}\n`)
    .join("\n")
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

// ── Playback Controls (from openscreen PlaybackControls.tsx) ─

interface PlaybackControlsProps {
  isPlaying: boolean
  currentTime: number
  duration: number
  isFullscreen: boolean
  volume: number
  clip: { startMs: number; endMs: number } | null
  sections: Array<{ startMs: number; endMs: number }> | null
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
        size="icon"
        className={
          isPlaying
            ? "size-8 rounded-full border border-white/10 bg-white/10 text-white shadow-none hover:bg-white/20"
            : "size-8 rounded-full border border-white/10 bg-white text-black shadow-[0_0_15px_rgba(255,255,255,0.3)] hover:scale-105 hover:bg-white/90"
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
          ✕ 片段
        </button>
      )}

      {/* Volume */}
      <div className="group/vol flex items-center">
        <Button
          onClick={handleToggleMute}
          size="icon"
          className="size-7 shrink-0 rounded-full border border-transparent text-white shadow-none hover:border-white/10 hover:bg-white/10"
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
        size="icon"
        className="ml-0.5 size-7 shrink-0 rounded-full border border-transparent text-white shadow-none hover:border-white/10 hover:bg-white/10"
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
  const [volume, setVolume] = useState(1)

  // Transcription state
  const [hasSrt, setHasSrt] = useState(initialHasSrt)
  const [transcribing, setTranscribing] = useState(false)
  const [transcribeStage, setTranscribeStage] = useState("")
  const [transcribeProgress, setTranscribeProgress] = useState(0)
  const [transcriptionModelKey, setTranscriptionModelKey] = useState("whisper-large-v3")
  const [savedProgress, setSavedProgress] = useState<{ current: number; total: number } | null>(null)

  // Analysis state
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisModelKey, setAnalysisModelKey] = useState("gemini:gemini-2.5-flash")
  const [panelTab, setPanelTab] = useState<"srt" | "sections" | "clips">("srt")

  // API key availability
  const [hasTranscriptionKey, setHasTranscriptionKey] = useState(false)
  const [hasGroqKey, setHasGroqKey] = useState(false)
  const [hasGeminiKey, setHasGeminiKey] = useState(false)

  // Clip playback: play only a specific time range
  const [activeClip, setActiveClip] = useState<{ startMs: number; endMs: number } | null>(null)
  const activeClipRef = useRef(activeClip)
  activeClipRef.current = activeClip

  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(null)
  const subtitlesRef = useRef<Subtitle[]>([])
  subtitlesRef.current = subtitles
  const handlersRef = useRef<ReturnType<typeof createVideoEventHandlers> | null>(null)

  // Load API key availability + saved transcription progress
  useEffect(() => {
    window.electronAPI.getBackendSettings().then((s) => {
      setHasTranscriptionKey(s.transcriptionApiKeys?.length > 0)
      setHasGroqKey(!!s.groqApiKey)
      setHasGeminiKey(!!s.geminiApiKey)
    })
    window.electronAPI.getTranscriptionProgress(projectId).then((p) => {
      if (p && p.currentChunk < p.numChunks) {
        setSavedProgress({ current: p.currentChunk, total: p.numChunks })
      }
    })
  }, [])

  // Load SRT + existing analysis
  useEffect(() => {
    window.electronAPI.readSrt(projectId).then((srt) => {
      if (srt) {
        setSubtitles(parseSrt(srt))
        setHasSrt(true)
        
      }
    })
    window.electronAPI.getAnalysisData(projectId).then((data) => {
      if (data) {
        setAnalysis(data)
        
      }
    })
  }, [projectId])

  // Transcription progress listeners
  useEffect(() => {
    const c1 = window.electronAPI.onWhisperProgress((pid, pct) => {
      if (pid === projectId) setTranscribeProgress(pct)
    })
    const c2 = window.electronAPI.onWhisperStage((pid, stage) => {
      if (pid === projectId) setTranscribeStage(stage)
    })
    return () => { c1(); c2() }
  }, [projectId])

  const handleTranscribe = useCallback(async () => {
    setTranscribing(true)
    setSavedProgress(null)
    // error shown via toast
    setTranscribeStage("轉換音訊中...")
    setTranscribeProgress(0)
    try {
      // Step 1: Extract audio
      const extractResult = await window.electronAPI.extractAudio(projectId)
      if (!extractResult.success) {
        toast.error(extractResult.error ?? "Audio extraction failed")
        return
      }
      // Step 2: Transcribe
      setTranscribeStage("辨識中...")
      const result = await window.electronAPI.transcribe(projectId, transcriptionModelKey)
      if (result.success) {
        const srt = await window.electronAPI.readSrt(projectId)
        if (srt) setSubtitles(parseSrt(srt))
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

  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true)
    // error shown via toast
    try {
      const [provider, model] = analysisModelKey.split(":", 2)
      const result = await window.electronAPI.analyzeProject(projectId, provider, model)
      if (result.success && result.data) {
        setAnalysis(result.data)
        
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
  }, [projectId, analysisModelKey])

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
        allowPlaybackRef.current = false
        console.error("Video play failed:", err)
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

  const formatMs = (ms: number) => {
    const s = Math.floor(ms / 1000)
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    return `${m}:${String(sec).padStart(2, "0")}`
  }

  const currentMs = currentTime * 1000

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
                  title={!hasTranscriptionKey ? "請先在 Settings 填入 Groq Whisper API Key" : undefined}
                >
                  <Mic className="mr-1 size-4" />
                  {savedProgress ? `繼續轉錄 (${savedProgress.current}/${savedProgress.total})` : hasSrt ? "重新轉錄" : "轉錄"}
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
                <Select value={analysisModelKey} onValueChange={setAnalysisModelKey}>
                  <SelectTrigger className="h-8 w-44 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel className="text-[10px]">Gemini{!hasGeminiKey ? " (no key)" : ""}</SelectLabel>
                      {ANALYSIS_MODELS.filter((m) => m.value.startsWith("gemini:")).map((m) => (
                        <SelectItem key={m.value} value={m.value} className="text-xs" disabled={!hasGeminiKey}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                    <SelectGroup>
                      <SelectLabel className="text-[10px]">Groq{!hasGroqKey ? " (no key)" : ""}</SelectLabel>
                      {ANALYSIS_MODELS.filter((m) => m.value.startsWith("groq:")).map((m) => (
                        <SelectItem key={m.value} value={m.value} className="text-xs" disabled={!hasGroqKey}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" onClick={handleAnalyze}
                  disabled={!hasSrt || (analysisModelKey.startsWith("gemini:") ? !hasGeminiKey : !hasGroqKey)}
                  title={!hasSrt ? "請先轉錄" : undefined}
                >
                  <Sparkles className="mr-1 size-4" />
                  {analysis ? "重新分析" : "分析大綱"}
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" disabled>
                <Loader2 className="mr-1 size-4 animate-spin" />
                分析中...
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Video area */}
        <div
          ref={containerRef}
          className="relative flex min-h-0 flex-1 cursor-pointer items-center justify-center overflow-hidden bg-black"
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
              onClearClip={clearClip}
            />
          </div>
        </div>

        {/* Side panel */}
        {!isFullscreen && (
          <div className="flex w-80 shrink-0 flex-col border-l bg-background">
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
                  字幕 ({subtitles.length})
                </button>
              )}
              {analysis && (
                <>
                  <button
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                      panelTab === "sections"
                        ? "border-b-2 border-primary text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => { setPanelTab("sections"); setActiveClip(null) }}
                  >
                    <ListVideo className="mr-1 inline size-3.5" />
                    段落 ({analysis.sections.length})
                  </button>
                  <button
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                      panelTab === "clips"
                        ? "border-b-2 border-primary text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setPanelTab("clips")}
                  >
                    <Scissors className="mr-1 inline size-3.5" />
                    剪輯建議 ({analysis.clips.length})
                  </button>
                </>
              )}
            </div>

            <div className="flex-1 overflow-y-auto">
              {panelTab === "srt" && subtitles.map((sub, i) => {
                const active = currentMs >= sub.startMs && currentMs < sub.endMs
                return (
                  <div
                    key={i}
                    className={`border-b px-3 py-2 transition-colors hover:bg-accent cursor-pointer ${
                      active ? "bg-accent/50 border-l-2 border-l-primary" : ""
                    }`}
                    onClick={() => seekToMs(sub.startMs)}
                  >
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {formatMs(sub.startMs)} – {formatMs(sub.endMs)}
                    </span>
                    <textarea
                      className="mt-0.5 w-full resize-none bg-transparent text-sm outline-none focus:ring-1 focus:ring-primary/50 rounded px-1"
                      rows={1}
                      value={sub.text}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const updated = [...subtitles]
                        updated[i] = { ...updated[i], text: e.target.value }
                        setSubtitles(updated)
                      }}
                      onBlur={() => {
                        window.electronAPI.saveSrt(projectId, subtitlesToSrt(subtitles))
                      }}
                    />
                  </div>
                )
              })}

              {panelTab === "sections" && analysis?.sections.map((sec, i) => {
                const active = currentMs >= sec.startMs && currentMs < sec.endMs
                return (
                  <button
                    key={i}
                    className={`w-full border-b px-3 py-2.5 text-left transition-colors hover:bg-accent ${
                      active ? "bg-accent/50 border-l-2 border-l-primary" : ""
                    }`}
                    onClick={() => seekToMs(sec.startMs)}
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

              {panelTab === "clips" && analysis?.clips.map((clip, i) => {
                const isActive = activeClip?.startMs === clip.startMs && activeClip?.endMs === clip.endMs
                return (
                  <button
                    key={i}
                    className={`w-full border-b px-3 py-2.5 text-left transition-colors hover:bg-accent ${
                      isActive ? "bg-accent/50 border-l-2 border-l-primary" : ""
                    }`}
                    onClick={() => {
                      if (isActive) {
                        clearClip()
                      } else {
                        playClip(clip.startMs, clip.endMs)
                      }
                    }}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                        {formatMs(clip.startMs)} – {formatMs(clip.endMs)}
                      </span>
                      {isActive && (
                        <span className="text-[10px] text-primary">播放中 · 點擊取消</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm font-medium">{clip.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{clip.reason}</p>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
