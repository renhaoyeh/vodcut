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
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/renderer/components/ui/card"
import { AppSidebar } from "@/renderer/components/app-sidebar"

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

const recentProjects = [
  { name: "Product Demo v2", date: "2 hours ago", duration: "3:24", status: "Editing" },
  { name: "Tutorial Series Ep.5", date: "Yesterday", duration: "12:08", status: "Exported" },
  { name: "Social Media Clip", date: "2 days ago", duration: "0:45", status: "Exported" },
  { name: "Client Presentation", date: "3 days ago", duration: "8:32", status: "Draft" },
  { name: "Webinar Recording", date: "5 days ago", duration: "45:12", status: "Editing" },
]

function Dashboard() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      {/* Stats Cards */}
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

      {/* Recent Projects */}
      <Card className="flex-1">
        <CardHeader>
          <CardTitle>Recent Projects</CardTitle>
          <CardDescription>Your recently edited video projects</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {recentProjects.map((project) => (
              <div
                key={project.name}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-10 items-center justify-center rounded-md bg-muted">
                    <Film className="size-5 text-muted-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{project.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {project.duration} &middot; {project.date}
                    </p>
                  </div>
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    project.status === "Editing"
                      ? "bg-primary/10 text-primary"
                      : project.status === "Exported"
                        ? "bg-green-500/10 text-green-600"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {project.status}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function App() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4!" />
          <h1 className="text-sm font-medium">Dashboard</h1>
        </header>
        <Dashboard />
      </SidebarInset>
    </SidebarProvider>
  )
}

const root = createRoot(document.getElementById("root"))
root.render(<App />)
