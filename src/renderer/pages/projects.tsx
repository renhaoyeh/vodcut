import React, { useState, useCallback } from "react"
import { useTranslation } from "react-i18next"
import {
  FileVideo,
  Upload,
  Trash2,
  FileText,
} from "lucide-react"

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/renderer/components/ui/context-menu"
import { ScrollArea } from "@/renderer/components/ui/scroll-area"

export interface VideoProject {
  id: string
  fileName: string
  filePath: string
  addedAt: Date
  status: "imported" | "converting" | "completed"
}

interface ProjectsPageProps {
  projects: VideoProject[]
  onAddProjects: (projects: VideoProject[]) => void
  onRemoveProject: (id: string) => void
  onPreview: (id: string) => void
}

export function ProjectsPage({
  projects,
  onAddProjects,
  onRemoveProject,
  onPreview,
}: ProjectsPageProps) {
  const { t } = useTranslation()
  const [isDragOver, setIsDragOver] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragOver(false)

      const files = Array.from(e.dataTransfer.files).filter((file) =>
        file.type.startsWith("video/")
      )

      if (files.length === 0) return

      const newProjects: VideoProject[] = files.map((file) => ({
        id: crypto.randomUUID(),
        fileName: file.name,
        filePath: window.electronAPI.getPathForFile(file),
        addedAt: new Date(),
        status: "imported",
      }))

      onAddProjects(newProjects)
    },
    [onAddProjects]
  )

  return (
    <div className="flex flex-1 flex-col gap-4 p-4">
      {/* Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors ${
          isDragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/25 hover:border-muted-foreground/50"
        }`}
      >
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Upload className="size-6 text-muted-foreground" />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium">{t("projects.dropZone")}</p>
          <p className="text-xs text-muted-foreground">
            {t("projects.supportedFormats")}
          </p>
        </div>
      </div>

      {/* Project List */}
      {projects.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
          <FileVideo className="size-10" />
          <p className="text-sm">{t("projects.noVideos")}</p>
          <p className="text-xs">{t("projects.dragToStart")}</p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="space-y-2">
            {projects.map((project) => (
              <ContextMenu key={project.id}>
                <ContextMenuTrigger asChild>
                  <div
                    className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => onPreview(project.id)}
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                      <FileVideo className="size-5 text-muted-foreground" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{project.fileName}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {project.filePath}
                      </p>
                    </div>
                    {project.status === "completed" && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground"><FileText className="size-4" />SRT</span>
                    )}
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    className="text-destructive"
                    onClick={() => onRemoveProject(project.id)}
                  >
                    <Trash2 className="mr-2 size-4" />
                    {t("projects.delete")}
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
