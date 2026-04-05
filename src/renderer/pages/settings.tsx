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
  const [analysisApiKey, setAnalysisApiKey] = useState("")

  useEffect(() => {
    window.electronAPI.getBackendSettings().then((settings) => {
      setTranscriptionApiKey(settings.transcriptionApiKey)
      setTranscriptionModel(settings.transcriptionModel)
      setAnalysisApiKey(settings.analysisApiKey)
    })
  }, [])

  const handleTranscriptionApiKeySave = useCallback(async () => {
    await window.electronAPI.setTranscriptionApiKey(transcriptionApiKey)
  }, [transcriptionApiKey])

  const handleAnalysisApiKeySave = useCallback(async () => {
    await window.electronAPI.setAnalysisApiKey(analysisApiKey)
  }, [analysisApiKey])

  const handleTranscriptionModelChange = useCallback(async (value: string) => {
    setTranscriptionModel(value)
    await window.electronAPI.setTranscriptionModel(value)
  }, [])

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Transcription (Groq Cloud API)</CardTitle>
          <CardDescription>
            Configure the Groq cloud API for speech recognition.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm">Model</Label>
            <RadioGroup value={transcriptionModel} onValueChange={handleTranscriptionModelChange}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="whisper-large-v3-turbo" id="groq-turbo" />
                <Label htmlFor="groq-turbo" className="font-normal">Large V3 Turbo <span className="text-muted-foreground text-xs">— faster, $0.04/hr</span></Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="whisper-large-v3" id="groq-v3" />
                <Label htmlFor="groq-v3" className="font-normal">Large V3 <span className="text-muted-foreground text-xs">— more accurate, $0.111/hr</span></Label>
              </div>
            </RadioGroup>
          </div>
          <div className="space-y-2">
            <Label htmlFor="groq-api-key" className="text-sm">API Key</Label>
            <div className="flex gap-2">
              <Input
                id="groq-api-key"
                type="password"
                placeholder="gsk_..."
                value={transcriptionApiKey}
                onChange={(e) => setTranscriptionApiKey(e.target.value)}
              />
              <Button size="sm" onClick={handleTranscriptionApiKeySave}>Save</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Free tier: 28,800 sec/day. Get your key at{" "}
              <a href="https://console.groq.com" className="underline" target="_blank" rel="noreferrer">console.groq.com</a>
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Analysis (Groq Cloud API)</CardTitle>
          <CardDescription>
            Configure a separate Groq API key for content analysis (LLM).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="groq-analysis-api-key" className="text-sm">API Key</Label>
            <div className="flex gap-2">
              <Input
                id="groq-analysis-api-key"
                type="password"
                placeholder="gsk_..."
                value={analysisApiKey}
                onChange={(e) => setAnalysisApiKey(e.target.value)}
              />
              <Button size="sm" onClick={handleAnalysisApiKeySave}>Save</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Uses Llama 3.3 70B for analysis. Get your key at{" "}
              <a href="https://console.groq.com" className="underline" target="_blank" rel="noreferrer">console.groq.com</a>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
