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

export function SettingsDialog() {
  const { t } = useTranslation()
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
