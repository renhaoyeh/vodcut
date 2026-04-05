import { useState, useCallback } from "react"
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

const stats = [
  {
    title: "Total Projects",
    value: "12",
    description: "3 in progress",
    icon: Film,
  },
  {
    title: "Editing Hours",
    value: "48.5",
    description: "+12% from last week",
    icon: Clock,
  },
  {
    title: "Storage Used",
    value: "24.3 GB",
    description: "of 100 GB",
    icon: HardDrive,
  },
  {
    title: "Exports",
    value: "36",
    description: "+8 this week",
    icon: TrendingUp,
  },
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
}

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("projects")
  const [projects, setProjects] = useState<VideoProject[]>([])

  const handleAddProjects = useCallback((newProjects: VideoProject[]) => {
    setProjects((prev) => [...prev, ...newProjects])
  }, [])

  const handleRemoveProject = useCallback((id: string) => {
    setProjects((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const handleConvertToSrt = useCallback((id: string) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, status: "converting" as const } : p))
    )
  }, [])

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
            onAddProjects={handleAddProjects}
            onRemoveProject={handleRemoveProject}
            onConvertToSrt={handleConvertToSrt}
          />
        )}
      </SidebarInset>
    </SidebarProvider>
  )
}

const root = createRoot(document.getElementById("root"))
root.render(<App />)
