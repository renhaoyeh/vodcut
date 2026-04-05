import { useState, useEffect, useCallback } from "react"

import { Button } from "@/renderer/components/ui/button"
import { Input } from "@/renderer/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/renderer/components/ui/radio-group"
import { Label } from "@/renderer/components/ui/label"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/renderer/components/ui/card"

export function SettingsPage() {
  const [transcriptionApiKey, setTranscriptionApiKey] = useState("")
  const [transcriptionModel, setTranscriptionModel] = useState("whisper-large-v3-turbo")
  const [groqApiKey, setGroqApiKey] = useState("")
  const [geminiApiKey, setGeminiApiKey] = useState("")

  useEffect(() => {
    window.electronAPI.getBackendSettings().then((s) => {
      setTranscriptionApiKey(s.transcriptionApiKey)
      setTranscriptionModel(s.transcriptionModel)
      setGroqApiKey(s.groqApiKey)
      setGeminiApiKey(s.geminiApiKey)
    })
  }, [])

  const handleTranscriptionApiKeySave = useCallback(async () => {
    await window.electronAPI.setTranscriptionApiKey(transcriptionApiKey)
  }, [transcriptionApiKey])

  const handleTranscriptionModelChange = useCallback(async (value: string) => {
    setTranscriptionModel(value)
    await window.electronAPI.setTranscriptionModel(value)
  }, [])

  const handleGroqApiKeySave = useCallback(async () => {
    await window.electronAPI.setGroqApiKey(groqApiKey)
  }, [groqApiKey])

  const handleGeminiApiKeySave = useCallback(async () => {
    await window.electronAPI.setGeminiApiKey(geminiApiKey)
  }, [geminiApiKey])

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Transcription (Groq)</CardTitle>
          <CardDescription>Groq Whisper API for speech recognition.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm">Model</Label>
            <RadioGroup value={transcriptionModel} onValueChange={handleTranscriptionModelChange}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="whisper-large-v3-turbo" id="groq-turbo" />
                <Label htmlFor="groq-turbo" className="font-normal">Large V3 Turbo <span className="text-muted-foreground text-xs">— faster</span></Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="whisper-large-v3" id="groq-v3" />
                <Label htmlFor="groq-v3" className="font-normal">Large V3 <span className="text-muted-foreground text-xs">— more accurate</span></Label>
              </div>
            </RadioGroup>
          </div>
          <div className="space-y-2">
            <Label htmlFor="transcription-api-key" className="text-sm">API Key</Label>
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
              Get your key at{" "}
              <a href="https://console.groq.com" className="underline" target="_blank" rel="noreferrer">console.groq.com</a>
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Analysis API Keys</CardTitle>
          <CardDescription>Fill in API keys for providers you want to use. Choose which to run from the player page.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="gemini-api-key" className="text-sm">Gemini API Key</Label>
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
              Get your key at{" "}
              <a href="https://aistudio.google.com/apikey" className="underline" target="_blank" rel="noreferrer">aistudio.google.com</a>
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="groq-analysis-api-key" className="text-sm">Groq API Key</Label>
            <div className="flex gap-2">
              <Input
                id="groq-analysis-api-key"
                type="password"
                placeholder="gsk_..."
                value={groqApiKey}
                onChange={(e) => setGroqApiKey(e.target.value)}
              />
              <Button size="sm" onClick={handleGroqApiKeySave}>Save</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Get your key at{" "}
              <a href="https://console.groq.com" className="underline" target="_blank" rel="noreferrer">console.groq.com</a>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
