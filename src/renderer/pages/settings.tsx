import { useState, useEffect, useCallback } from "react"
import { useTranslation, Trans } from "react-i18next"

import { Button } from "@/renderer/components/ui/button"
import { Input } from "@/renderer/components/ui/input"
import { Label } from "@/renderer/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/renderer/components/ui/dialog"
import { Settings, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type { RateLimitInfo } from "@/main/store"

function RateLimitBadge({ info, t }: { info: RateLimitInfo | undefined; t: (key: string, opts?: Record<string, unknown>) => string }) {
  if (!info) return <p className="text-xs text-muted-foreground/60">{t("settings.rateLimitNoData")}</p>
  const updatedTime = new Date(info.updatedAt).toLocaleTimeString()
  const reqPct = info.limitRequests > 0 ? info.remainingRequests / info.limitRequests : 0
  const barColor = reqPct > 0.3 ? "bg-emerald-500" : reqPct > 0.1 ? "bg-amber-500" : "bg-red-500"
  return (
    <div className="space-y-1 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs">
      {info.lastError && (
        <div className="rounded bg-destructive/10 px-2 py-1 text-destructive">
          {info.lastError}
          {info.lastErrorAt && (
            <span className="ml-1.5 text-destructive/60">({new Date(info.lastErrorAt).toLocaleTimeString()})</span>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{t("settings.rateLimitRequests", { remaining: info.remainingRequests, limit: info.limitRequests })}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.max(reqPct * 100, 1)}%` }} />
      </div>
      <div className="flex items-center justify-between text-muted-foreground/60">
        {info.limitTokens > 0 && (
          <span>{t("settings.rateLimitTokens", { remaining: info.remainingTokens.toLocaleString(), limit: info.limitTokens.toLocaleString() })}</span>
        )}
        <span className="ml-auto">{t("settings.rateLimitUpdatedAt", { time: updatedTime })}</span>
      </div>
    </div>
  )
}

export function SettingsDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [transcriptionKeys, setTranscriptionKeys] = useState<string[]>([])
  const [groqApiKey, setGroqApiKey] = useState("")
  const [geminiApiKey, setGeminiApiKey] = useState("")
  const [rateLimits, setRateLimits] = useState<Record<string, RateLimitInfo>>({})

  useEffect(() => {
    if (!open) return
    window.electronAPI.getBackendSettings().then((s) => {
      setTranscriptionKeys(s.transcriptionApiKeys?.length ? s.transcriptionApiKeys : [""])
      setGroqApiKey(s.groqApiKey)
      setGeminiApiKey(s.geminiApiKey)
    })
    window.electronAPI.getRateLimits().then(setRateLimits)
  }, [open])

  const updateKey = useCallback((index: number, value: string) => {
    setTranscriptionKeys(prev => {
      const next = [...prev]
      next[index] = value
      return next
    })
  }, [])

  const removeKey = useCallback((index: number) => {
    setTranscriptionKeys(prev => {
      const next = prev.filter((_, i) => i !== index)
      return next.length ? next : [""]
    })
  }, [])

  const addKey = useCallback(() => {
    setTranscriptionKeys(prev => [...prev, ""])
  }, [])

  const handleSave = useCallback(async () => {
    const cleanedKeys = transcriptionKeys.map(k => k.trim()).filter(Boolean)
    await Promise.all([
      window.electronAPI.setTranscriptionApiKeys(cleanedKeys),
      window.electronAPI.setGroqApiKey(groqApiKey),
      window.electronAPI.setGeminiApiKey(geminiApiKey),
    ])
    toast.success(t("settings.saved"), { duration: 1500 })
    setOpen(false)
  }, [transcriptionKeys, groqApiKey, geminiApiKey, t])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
          <Settings className="size-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription>{t("settings.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 pt-2">
          <div className="space-y-2">
            <Label className="text-sm">{t("settings.transcriptionLabel")}</Label>
            <p className="text-xs text-muted-foreground">
              <Trans i18nKey="settings.transcriptionHelp" components={{ link: <a href="https://console.groq.com" className="underline" target="_blank" rel="noreferrer" /> }} />
            </p>
            <div className="space-y-3">
              {transcriptionKeys.map((key, i) => (
                <div key={i} className="space-y-1.5">
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder="gsk_..."
                      value={key}
                      onChange={(e) => updateKey(i, e.target.value)}
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeKey(i)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                  {key.trim() && (
                    <RateLimitBadge info={rateLimits[key.trim().slice(-8)]} t={t} />
                  )}
                </div>
              ))}
            </div>
            <Button size="sm" variant="outline" className="w-full" onClick={addKey} disabled={transcriptionKeys.length > 0 && !transcriptionKeys[transcriptionKeys.length - 1].trim()}>
              <Plus className="mr-1.5 size-3.5" />
              {t("settings.addKey")}
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="groq-api-key" className="text-sm">{t("settings.groqLabel")}</Label>
            <Input
              id="groq-api-key"
              type="password"
              placeholder="gsk_..."
              value={groqApiKey}
              onChange={(e) => setGroqApiKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              <Trans i18nKey="settings.groqHelp" components={{ link: <a href="https://console.groq.com" className="underline" target="_blank" rel="noreferrer" /> }} />
            </p>
            {groqApiKey && (
              <RateLimitBadge info={rateLimits[groqApiKey.slice(-8)]} t={t} />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="gemini-api-key" className="text-sm">{t("settings.geminiLabel")}</Label>
            <Input
              id="gemini-api-key"
              type="password"
              placeholder="AIza..."
              value={geminiApiKey}
              onChange={(e) => setGeminiApiKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              <Trans i18nKey="settings.geminiHelp" components={{ link: <a href="https://aistudio.google.com/apikey" className="underline" target="_blank" rel="noreferrer" /> }} />
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{t("settings.cancel")}</Button>
          <Button onClick={handleSave}>{t("settings.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
