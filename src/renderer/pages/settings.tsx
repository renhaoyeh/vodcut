import { useState, useEffect, useCallback } from "react"

import { Button } from "@/renderer/components/ui/button"
import { Input } from "@/renderer/components/ui/input"
import { Label } from "@/renderer/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/renderer/components/ui/dialog"
import { Settings } from "lucide-react"

export function SettingsDialog() {
  const [open, setOpen] = useState(false)
  const [transcriptionApiKey, setTranscriptionApiKey] = useState("")
  const [groqApiKey, setGroqApiKey] = useState("")
  const [geminiApiKey, setGeminiApiKey] = useState("")

  useEffect(() => {
    if (!open) return
    window.electronAPI.getBackendSettings().then((s) => {
      setTranscriptionApiKey(s.transcriptionApiKey)
      setGroqApiKey(s.groqApiKey)
      setGeminiApiKey(s.geminiApiKey)
    })
  }, [open])

  const handleTranscriptionApiKeySave = useCallback(async () => {
    await window.electronAPI.setTranscriptionApiKey(transcriptionApiKey)
  }, [transcriptionApiKey])

  const handleGroqApiKeySave = useCallback(async () => {
    await window.electronAPI.setGroqApiKey(groqApiKey)
  }, [groqApiKey])

  const handleGeminiApiKeySave = useCallback(async () => {
    await window.electronAPI.setGeminiApiKey(geminiApiKey)
  }, [geminiApiKey])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <Settings className="size-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>API keys for transcription and analysis services.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 pt-2">
          <div className="space-y-2">
            <Label htmlFor="transcription-api-key" className="text-sm">Groq Whisper (Transcription)</Label>
            <div className="flex gap-2">
              <Input
                id="transcription-api-key"
                type="password"
                placeholder="gsk_..."
                value={transcriptionApiKey}
                onChange={(e) => setTranscriptionApiKey(e.target.value)}
              />
              <Button size="sm" onClick={handleTranscriptionApiKeySave}>Save</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              For speech-to-text. Get your key at{" "}
              <a href="https://console.groq.com" className="underline" target="_blank" rel="noreferrer">console.groq.com</a>
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="groq-api-key" className="text-sm">Groq LLM (Analysis)</Label>
            <div className="flex gap-2">
              <Input
                id="groq-api-key"
                type="password"
                placeholder="gsk_..."
                value={groqApiKey}
                onChange={(e) => setGroqApiKey(e.target.value)}
              />
              <Button size="sm" onClick={handleGroqApiKeySave}>Save</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              For LLM analysis. Get your key at{" "}
              <a href="https://console.groq.com" className="underline" target="_blank" rel="noreferrer">console.groq.com</a>
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="gemini-api-key" className="text-sm">Gemini (Analysis)</Label>
            <div className="flex gap-2">
              <Input
                id="gemini-api-key"
                type="password"
                placeholder="AIza..."
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
              />
              <Button size="sm" onClick={handleGeminiApiKeySave}>Save</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              For LLM analysis. Get your key at{" "}
              <a href="https://aistudio.google.com/apikey" className="underline" target="_blank" rel="noreferrer">aistudio.google.com</a>
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
