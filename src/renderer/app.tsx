import { useState, useCallback, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { useTranslation } from "react-i18next"
import { Scissors, Sun, Moon, Languages } from "lucide-react"

import "@/renderer/i18n"
import { ProjectsPage, type VideoProject } from "@/renderer/pages/projects"
import { SettingsDialog } from "@/renderer/pages/settings"
import { PlayerPage } from "@/renderer/pages/player"
import { Toaster } from "@/renderer/components/ui/sonner"

function App() {
  const [projects, setProjects] = useState<VideoProject[]>([])
  const [playerProject, setPlayerProject] = useState<VideoProject | null>(null)
  const { i18n } = useTranslation()
  const [dark, setDark] = useState(() => localStorage.getItem("theme") === "dark")

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
    localStorage.setItem("theme", dark ? "dark" : "light")
  }, [dark])

  const syncProjects = useCallback((stored: any[]) => {
    setProjects(stored.map((p) => ({ ...p, addedAt: new Date(p.addedAt) })))
  }, [])

  useEffect(() => {
    window.electronAPI.getProjects().then(syncProjects)
  }, [syncProjects])

  const handleAddProjects = useCallback((newProjects: VideoProject[]) => {
    const toStore = newProjects.map((p) => ({ ...p, addedAt: p.addedAt.toISOString() }))
    window.electronAPI.addProjects(toStore).then(syncProjects)
  }, [syncProjects])

  const handleRemoveProject = useCallback((id: string) => {
    window.electronAPI.removeProject(id).then(syncProjects)
  }, [syncProjects])

  const handlePreview = useCallback((id: string) => {
    const project = projects.find((p) => p.id === id)
    if (project) setPlayerProject(project)
  }, [projects])

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b px-4">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Scissors className="size-3.5" />
          </div>
          <span className="text-sm font-semibold">Vodcut</span>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => i18n.changeLanguage(i18n.language === "zh-TW" ? "en" : "zh-TW")}
            title={i18n.language === "zh-TW" ? "English" : "繁體中文"}
          >
            <Languages className="size-4" />
          </button>
          <button
            className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            onClick={() => setDark((d) => !d)}
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <SettingsDialog />
        </div>
      </header>
      <main className="flex flex-1 flex-col overflow-hidden">
        {playerProject ? (
          <PlayerPage
            projectId={playerProject.id}
            filePath={playerProject.filePath}
            fileName={playerProject.fileName}
            hasSrt={playerProject.status === "completed"}
            onBack={() => { setPlayerProject(null); window.electronAPI.getProjects().then(syncProjects) }}
          />
        ) : (
          <ProjectsPage
            projects={projects}
            onAddProjects={handleAddProjects}
            onRemoveProject={handleRemoveProject}
            onPreview={handlePreview}
          />
        )}
      </main>
      <Toaster richColors position="bottom-right" expand style={{ zIndex: 9999 }} />
    </div>
  )
}

const root = createRoot(document.getElementById("root"))
root.render(<App />)
