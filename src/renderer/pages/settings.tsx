import { useState, useEffect, useCallback } from "react"
import { Download, Check, Loader2 } from "lucide-react"

import { Button } from "@/renderer/components/ui/button"
import { Badge } from "@/renderer/components/ui/badge"
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
  const [downloading, setDownloading] = useState<Record<string, number>>({})

  const loadModels = useCallback(() => {
    window.electronAPI.getModelInfo().then((info) => {
      setModels(info.models)
      setModelsDir(info.modelsDir)
    })
  }, [])

  useEffect(() => {
    loadModels()
  }, [loadModels])

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

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <Card>
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
                        {downloading[model.id]}%
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
          <p className="mt-4 text-xs text-muted-foreground">
            Models stored in: {modelsDir}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
