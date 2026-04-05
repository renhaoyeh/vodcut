import { useState, useCallback, useEffect } from "react"
import { createRoot } from "react-dom/client"
import {
  Film,
  Clock,
  HardDrive,
  TrendingUp,
} from "lucide-react"

import { SidebarProvider, SidebarInset, SidebarTrigger } from "@/renderer/components/ui/sidebar"
import { Separator } from "@/renderer/components/ui/separator"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/renderer/components/ui/card"
import { AppSidebar, type Page } from "@/renderer/components/app-sidebar"
import { ProjectsPage, type VideoProject } from "@/renderer/pages/projects"
import { SettingsPage } from "@/renderer/pages/settings"

const stats = [
  { title: "Total Projects", value: "12", description: "3 in progress", icon: Film },
  { title: "Editing Hours", value: "48.5", description: "+12% from last week", icon: Clock },
  { title: "Storage Used", value: "24.3 GB", description: "of 100 GB", icon: HardDrive },
  { title: "Exports", value: "36", description: "+8 this week", icon: TrendingUp },
]

function Dashboard() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
              <stat.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stat.value}</div>
              <p className="text-xs text-muted-foreground">{stat.description}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

const pageTitle: Record<Page, string> = {
  dashboard: "Dashboard",
  projects: "Projects",
  settings: "Settings",
}

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("projects")
  const [projects, setProjects] = useState<VideoProject[]>([])
  const [progress, setProgress] = useState<Record<string, number>>({})

  const syncProjects = useCallback((stored: any[]) => {
    setProjects(stored.map((p) => ({ ...p, addedAt: new Date(p.addedAt) })))
  }, [])

  useEffect(() => {
    window.electronAPI.getProjects().then(syncProjects)
  }, [syncProjects])

  useEffect(() => {
    const c1 = window.electronAPI.onFfmpegProgress((projectId, percent) => {
      setProgress((prev) => ({ ...prev, [projectId]: percent }))
    })
    const c2 = window.electronAPI.onWhisperProgress((projectId, percent) => {
      setProgress((prev) => ({ ...prev, [projectId]: percent }))
    })
    return () => { c1(); c2() }
  }, [])

  const handleAddProjects = useCallback((newProjects: VideoProject[]) => {
    const toStore = newProjects.map((p) => ({ ...p, addedAt: p.addedAt.toISOString() }))
    window.electronAPI.addProjects(toStore).then(syncProjects)
  }, [syncProjects])

  const handleRemoveProject = useCallback((id: string) => {
    window.electronAPI.removeProject(id).then(syncProjects)
  }, [syncProjects])

  const handleConvertToSrt = useCallback(async (id: string) => {
    // Check if model is downloaded
    const modelInfo = await window.electronAPI.getModelInfo()
    const selected = modelInfo.models.find((m) => m.selected)
    if (!selected?.downloaded) {
      setCurrentPage("settings")
      return
    }

    await window.electronAPI.updateProjectStatus(id, "converting").then(syncProjects)
    setProgress((prev) => ({ ...prev, [id]: 0 }))

    // Step 1: Extract audio
    const extractResult = await window.electronAPI.extractAudio(id)
    if (!extractResult.success) {
      await window.electronAPI.updateProjectStatus(id, "imported").then(syncProjects)
      setProgress((prev) => { const n = { ...prev }; delete n[id]; return n })
      return
    }

    // Step 2: Transcribe with Whisper
    setProgress((prev) => ({ ...prev, [id]: 0 }))
    const transcribeResult = await window.electronAPI.transcribe(id)
    if (!transcribeResult.success) {
      await window.electronAPI.updateProjectStatus(id, "imported").then(syncProjects)
    }

    await window.electronAPI.getProjects().then(syncProjects)
    setProgress((prev) => { const n = { ...prev }; delete n[id]; return n })
  }, [syncProjects])

  return (
    <SidebarProvider>
      <AppSidebar currentPage={currentPage} onNavigate={setCurrentPage} />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4!" />
          <h1 className="text-sm font-medium">{pageTitle[currentPage]}</h1>
        </header>
        {currentPage === "dashboard" && <Dashboard />}
        {currentPage === "projects" && (
          <ProjectsPage
            projects={projects}
            progress={progress}
            onAddProjects={handleAddProjects}
            onRemoveProject={handleRemoveProject}
            onConvertToSrt={handleConvertToSrt}
          />
        )}
        {currentPage === "settings" && <SettingsPage />}
      </SidebarInset>
    </SidebarProvider>
  )
}

const root = createRoot(document.getElementById("root"))
root.render(<App />)
