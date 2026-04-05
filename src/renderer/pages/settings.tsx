import { useState, useEffect, useCallback } from "react"
import { Download, Check, Loader2 } from "lucide-react"

import { Button } from "@/renderer/components/ui/button"
import { Badge } from "@/renderer/components/ui/badge"
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

interface ModelInfo {
  id: string
  label: string
  size: string
  downloaded: boolean
  selected: boolean
}

export function SettingsPage() {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [modelsDir, setModelsDir] = useState("")
  const [gpuBackend, setGpuBackend] = useState("unknown")
  const [downloading, setDownloading] = useState<Record<string, number>>({})
  const [backend, setBackend] = useState("local")
  const [groqApiKey, setGroqApiKey] = useState("")
  const [groqModel, setGroqModel] = useState("whisper-large-v3-turbo")

  const loadModels = useCallback(() => {
    window.electronAPI.getModelInfo().then((info) => {
      setModels(info.models)
      setModelsDir(info.modelsDir)
      setGpuBackend(info.gpuBackend)
    })
  }, [])

  const loadBackendSettings = useCallback(() => {
    window.electronAPI.getBackendSettings().then((settings) => {
      setBackend(settings.backend)
      setGroqApiKey(settings.groqApiKey)
      setGroqModel(settings.groqModel)
    })
  }, [])

  useEffect(() => {
    loadModels()
    loadBackendSettings()
  }, [loadModels, loadBackendSettings])

  useEffect(() => {
    const cleanup = window.electronAPI.onDownloadProgress((modelSize, percent) => {
      setDownloading((prev) => ({ ...prev, [modelSize]: percent }))
    })
    return cleanup
  }, [])

  const handleDownload = useCallback(async (modelId: string) => {
    setDownloading((prev) => ({ ...prev, [modelId]: 0 }))
    const result = await window.electronAPI.downloadModel(modelId)
    setDownloading((prev) => {
      const next = { ...prev }
      delete next[modelId]
      return next
    })
    if (result.success) {
      loadModels()
    }
  }, [loadModels])

  const handleSelect = useCallback(async (modelId: string) => {
    await window.electronAPI.selectModel(modelId)
    loadModels()
  }, [loadModels])

  const handleBackendChange = useCallback(async (value: string) => {
    setBackend(value)
    await window.electronAPI.setBackend(value)
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
      {/* Backend Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Transcription Backend</CardTitle>
          <CardDescription>
            Choose between local Whisper model or Groq cloud API.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RadioGroup value={backend} onValueChange={handleBackendChange}>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="local" id="backend-local" />
              <Label htmlFor="backend-local">Local (Whisper)</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="groq" id="backend-groq" />
              <Label htmlFor="backend-groq">Groq Cloud API</Label>
            </div>
          </RadioGroup>

          {backend === "groq" && (
            <div className="mt-4 space-y-4">
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
            </div>
          )}
        </CardContent>
      </Card>

      {/* Local Whisper Model */}
      <Card className={backend !== "local" ? "opacity-50" : ""}>
        <CardHeader>
          <CardTitle>Whisper Model</CardTitle>
          <CardDescription>
            Select and download a speech recognition model. Larger models are more accurate but slower.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {models.map((model) => (
              <div
                key={model.id}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <p className="text-sm font-medium">{model.label}</p>
                    <p className="text-xs text-muted-foreground">{model.size}</p>
                  </div>
                  {model.selected && (
                    <Badge variant="default">Active</Badge>
                  )}
                  {model.downloaded && !model.selected && (
                    <Badge variant="secondary">Downloaded</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {downloading[model.id] !== undefined ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin" />
                      <span className="text-xs text-muted-foreground">
                        {downloading[model.id] >= 100 ? "寫入中..." : `${downloading[model.id]}%`}
                      </span>
                    </div>
                  ) : model.downloaded ? (
                    !model.selected && (
                      <Button size="sm" variant="outline" onClick={() => handleSelect(model.id)}>
                        <Check className="mr-1 size-3" />
                        Use
                      </Button>
                    )
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => handleDownload(model.id)}>
                      <Download className="mr-1 size-3" />
                      Download
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
            <span>Backend: <span className={gpuBackend === 'cuda' || gpuBackend === 'metal' ? 'text-green-500 font-medium' : ''}>{gpuBackend.toUpperCase()}</span></span>
            <span>·</span>
            <span>Models: {modelsDir}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
