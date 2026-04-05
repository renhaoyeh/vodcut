import { useState, useCallback, useEffect } from "react"
import { createRoot } from "react-dom/client"
import {
  Scissors,
  FolderOpen,
  Settings,
} from "lucide-react"

import { ProjectsPage, type VideoProject } from "@/renderer/pages/projects"
import { SettingsPage } from "@/renderer/pages/settings"
import { PlayerPage } from "@/renderer/pages/player"

type Page = "projects" | "settings"

const navItems = [
  { title: "Projects", icon: FolderOpen, page: "projects" as Page },
  { title: "Settings", icon: Settings, page: "settings" as Page },
]

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("projects")
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
        <nav className="flex items-center gap-1">
          {navItems.map((item) => (
            <button
              key={item.page}
              onClick={() => setCurrentPage(item.page)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                currentPage === item.page
                  ? "bg-muted font-medium"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
            >
              <item.icon className="size-4" />
              {item.title}
            </button>
          ))}
        </nav>
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
          <>
            {currentPage === "projects" && (
              <ProjectsPage
                projects={projects}
                onAddProjects={handleAddProjects}
                onRemoveProject={handleRemoveProject}
                onPreview={handlePreview}
              />
            )}
            {currentPage === "settings" && <SettingsPage />}
          </>
        )}
      </main>
    </div>
  )
}

const root = createRoot(document.getElementById("root"))
root.render(<App />)
