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
  const [groqApiKey, setGroqApiKey] = useState("")
  const [groqModel, setGroqModel] = useState("whisper-large-v3-turbo")

  useEffect(() => {
    window.electronAPI.getBackendSettings().then((settings) => {
      setGroqApiKey(settings.groqApiKey)
      setGroqModel(settings.groqModel)
    })
  }, [])

  const handleApiKeySave = useCallback(async () => {
    await window.electronAPI.setGroqApiKey(groqApiKey)
  }, [groqApiKey])

  const handleGroqModelChange = useCallback(async (value: string) => {
    setGroqModel(value)
    await window.electronAPI.setGroqModel(value)
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
            <RadioGroup value={groqModel} onValueChange={handleGroqModelChange}>
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
                value={groqApiKey}
                onChange={(e) => setGroqApiKey(e.target.value)}
              />
              <Button size="sm" onClick={handleApiKeySave}>Save</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Free tier: 28,800 sec/day. Get your key at{" "}
              <a href="https://console.groq.com" className="underline" target="_blank" rel="noreferrer">console.groq.com</a>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
