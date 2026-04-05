import React, { useEffect, useRef, useState, useCallback } from "react"
import { ArrowLeft, Maximize, Minimize, Pause, Play } from "lucide-react"
import { Button } from "@/renderer/components/ui/button"

// ── SRT parsing ──────────────────────────────────────────────

interface Subtitle {
  startMs: number
  endMs: number
  text: string
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
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

// ── Playback Controls (from openscreen PlaybackControls.tsx) ─

interface PlaybackControlsProps {
  isPlaying: boolean
  currentTime: number
  duration: number
  isFullscreen: boolean
  onTogglePlayPause: () => void
  onSeek: (time: number) => void
  onToggleFullscreen: () => void
}

function PlaybackControls({
  isPlaying,
  currentTime,
  duration,
  isFullscreen,
  onTogglePlayPause,
  onSeek,
  onToggleFullscreen,
}: PlaybackControlsProps) {
  function handleSeekChange(e: React.ChangeEvent<HTMLInputElement>) {
    onSeek(parseFloat(e.target.value))
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

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
        {formatTime(currentTime)}
      </span>

      <div className="group relative flex h-6 flex-1 items-center">
        <div className="absolute left-0 right-0 h-0.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[#34B27B]"
            style={{ width: `${progress}%` }}
          />
        </div>

        <input
          type="range"
          min="0"
          max={duration || 100}
          value={currentTime}
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
        {formatTime(duration)}
      </span>

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
  onBack: () => void
}

export function PlayerPage({ projectId, filePath, fileName, onBack }: PlayerPageProps) {
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

  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(null)
  const subtitlesRef = useRef<Subtitle[]>([])
  subtitlesRef.current = subtitles
  const handlersRef = useRef<ReturnType<typeof createVideoEventHandlers> | null>(null)

  // Load SRT
  useEffect(() => {
    window.electronAPI.readSrt(projectId).then((srt) => {
      if (srt) setSubtitles(parseSrt(srt))
    })
  }, [projectId])

  // Subtitle update (driven by onTimeUpdate callback)
  const updateSubtitle = useCallback((timeSec: number) => {
    const ms = timeSec * 1000
    const active = subtitlesRef.current.find((s) => ms >= s.startMs && ms <= s.endMs)
    setCurrentText(active?.text ?? "")
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

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-background">
      {!isFullscreen && (
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <Button variant="ghost" size="icon" className="size-8" onClick={onBack}>
            <ArrowLeft className="size-4" />
          </Button>
          <span className="truncate text-sm font-medium">{fileName}</span>
        </div>
      )}

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
            onTogglePlayPause={togglePlayPause}
            onSeek={handleSeek}
            onToggleFullscreen={toggleFullscreen}
          />
        </div>
      </div>
    </div>
  )
}
