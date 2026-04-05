import { useState, useCallback, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { Scissors } from "lucide-react"

import { ProjectsPage, type VideoProject } from "@/renderer/pages/projects"
import { SettingsDialog } from "@/renderer/pages/settings"
import { PlayerPage } from "@/renderer/pages/player"

function App() {
  const [projects, setProjects] = useState<VideoProject[]>([])
  const [playerProject, setPlayerProject] = useState<VideoProject | null>(null)

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
        <div className="ml-auto">
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
    </div>
  )
}

const root = createRoot(document.getElementById("root"))
root.render(<App />)
