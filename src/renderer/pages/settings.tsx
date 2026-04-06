import { useState, useEffect, useCallback } from "react"
import { useTranslation, Trans } from "react-i18next"

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
import { toast } from "sonner"
import type { RateLimitInfo } from "@/main/store"

function RateLimitBadge({ info, t }: { info: RateLimitInfo | undefined; t: (key: string, opts?: Record<string, unknown>) => string }) {
  if (!info) return <p className="text-xs text-muted-foreground/60">{t("settings.rateLimitNoData")}</p>
  const updatedTime = new Date(info.updatedAt).toLocaleTimeString()
  const reqPct = info.limitRequests > 0 ? info.remainingRequests / info.limitRequests : 0
  const barColor = reqPct > 0.3 ? "bg-emerald-500" : reqPct > 0.1 ? "bg-amber-500" : "bg-red-500"
  return (
    <div className="space-y-1 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">{t("settings.rateLimitRequests", { remaining: info.remainingRequests, limit: info.limitRequests })}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.max(reqPct * 100, 1)}%` }} />
      </div>
      <div className="flex items-center justify-between text-muted-foreground/60">
        <span>{t("settings.rateLimitTokens", { remaining: info.remainingTokens.toLocaleString(), limit: info.limitTokens.toLocaleString() })}</span>
        <span>{t("settings.rateLimitUpdatedAt", { time: updatedTime })}</span>
      </div>
    </div>
  )
}

export function SettingsDialog() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [transcriptionApiKeys, setTranscriptionApiKeys] = useState("")
  const [groqApiKey, setGroqApiKey] = useState("")
  const [geminiApiKey, setGeminiApiKey] = useState("")
  const [rateLimits, setRateLimits] = useState<Record<string, RateLimitInfo>>({})

  useEffect(() => {
    if (!open) return
    window.electronAPI.getBackendSettings().then((s) => {
      setTranscriptionApiKeys((s.transcriptionApiKeys ?? []).join("\n"))
      setGroqApiKey(s.groqApiKey)
      setGeminiApiKey(s.geminiApiKey)
    })
    window.electronAPI.getRateLimits().then(setRateLimits)
  }, [open])

  const handleTranscriptionApiKeysSave = useCallback(async () => {
    const keys = transcriptionApiKeys.split("\n").map(k => k.trim()).filter(Boolean)
    await window.electronAPI.setTranscriptionApiKeys(keys)
    toast.success(t("settings.saved"), { duration: 1500 })
  }, [transcriptionApiKeys, t])

  const handleGroqApiKeySave = useCallback(async () => {
    await window.electronAPI.setGroqApiKey(groqApiKey)
    toast.success(t("settings.saved"), { duration: 1500 })
  }, [groqApiKey, t])

  const handleGeminiApiKeySave = useCallback(async () => {
    await window.electronAPI.setGeminiApiKey(geminiApiKey)
    toast.success(t("settings.saved"), { duration: 1500 })
  }, [geminiApiKey, t])

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
            <Label htmlFor="transcription-api-keys" className="text-sm">{t("settings.transcriptionLabel")}</Label>
            <div className="flex gap-2">
              <textarea
                id="transcription-api-keys"
                className="flex min-h-15 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                placeholder={"gsk_...\ngsk_..."}
                value={transcriptionApiKeys}
                onChange={(e) => setTranscriptionApiKeys(e.target.value)}
                rows={3}
              />
              <Button size="sm" className="self-start" onClick={handleTranscriptionApiKeysSave}>{t("settings.save")}</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              <Trans i18nKey="settings.transcriptionHelp" components={{ link: <a href="https://console.groq.com" className="underline" target="_blank" rel="noreferrer" /> }} />
            </p>
            {transcriptionApiKeys.split("\n").map(k => k.trim()).filter(Boolean).map((key) => {
              const keyId = key.slice(-8)
              const info = rateLimits[keyId]
              return (
                <div key={keyId} className="space-y-1">
                  <p className="text-xs font-mono text-muted-foreground">...{keyId}</p>
                  <RateLimitBadge info={info} t={t} />
                </div>
              )
            })}
          </div>
          <div className="space-y-2">
            <Label htmlFor="groq-api-key" className="text-sm">{t("settings.groqLabel")}</Label>
            <div className="flex gap-2">
              <Input
                id="groq-api-key"
                type="password"
                placeholder="gsk_..."
                value={groqApiKey}
                onChange={(e) => setGroqApiKey(e.target.value)}
              />
              <Button size="sm" onClick={handleGroqApiKeySave}>{t("settings.save")}</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              <Trans i18nKey="settings.groqHelp" components={{ link: <a href="https://console.groq.com" className="underline" target="_blank" rel="noreferrer" /> }} />
            </p>
            {groqApiKey && (
              <RateLimitBadge info={rateLimits[groqApiKey.slice(-8)]} t={t} />
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="gemini-api-key" className="text-sm">{t("settings.geminiLabel")}</Label>
            <div className="flex gap-2">
              <Input
                id="gemini-api-key"
                type="password"
                placeholder="AIza..."
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
              />
              <Button size="sm" onClick={handleGeminiApiKeySave}>{t("settings.save")}</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              <Trans i18nKey="settings.geminiHelp" components={{ link: <a href="https://aistudio.google.com/apikey" className="underline" target="_blank" rel="noreferrer" /> }} />
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
