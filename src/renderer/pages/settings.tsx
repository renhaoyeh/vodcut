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
  const [transcriptionApiKeys, setTranscriptionApiKeys] = useState("")
  const [groqApiKey, setGroqApiKey] = useState("")
  const [geminiApiKey, setGeminiApiKey] = useState("")

  useEffect(() => {
    if (!open) return
    window.electronAPI.getBackendSettings().then((s) => {
      setTranscriptionApiKeys((s.transcriptionApiKeys ?? []).join("\n"))
      setGroqApiKey(s.groqApiKey)
      setGeminiApiKey(s.geminiApiKey)
    })
  }, [open])

  const handleTranscriptionApiKeysSave = useCallback(async () => {
    const keys = transcriptionApiKeys.split("\n").map(k => k.trim()).filter(Boolean)
    await window.electronAPI.setTranscriptionApiKeys(keys)
  }, [transcriptionApiKeys])

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
            <Label htmlFor="transcription-api-keys" className="text-sm">Groq Whisper (Transcription)</Label>
            <div className="flex gap-2">
              <textarea
                id="transcription-api-keys"
                className="flex min-h-15 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder={"gsk_...\ngsk_..."}
                value={transcriptionApiKeys}
                onChange={(e) => setTranscriptionApiKeys(e.target.value)}
                rows={3}
              />
              <Button size="sm" className="self-start" onClick={handleTranscriptionApiKeysSave}>Save</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              每行一把 key，多把 key 會自動輪替以避免速率限制。至{" "}
              <a href="https://console.groq.com" className="underline" target="_blank" rel="noreferrer">console.groq.com</a> 取得
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
