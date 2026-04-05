import React, { useState, useCallback } from "react"
import {
  FileVideo,
  Upload,
  MoreHorizontal,
  FileText,
  Trash2,
  FolderOpen,
} from "lucide-react"

import { Button } from "@/renderer/components/ui/button"
import { Badge } from "@/renderer/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/renderer/components/ui/dropdown-menu"
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
  onConvertToSrt: (id: string) => void
}

export function ProjectsPage({
  projects,
  onAddProjects,
  onRemoveProject,
  onConvertToSrt,
}: ProjectsPageProps) {
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
        filePath: (file as any).path ?? file.name,
        addedAt: new Date(),
        status: "imported",
      }))

      onAddProjects(newProjects)
    },
    [onAddProjects]
  )

  const statusLabel = {
    imported: "Imported",
    converting: "Converting...",
    completed: "Completed",
  } as const

  const statusVariant = {
    imported: "secondary",
    converting: "default",
    completed: "outline",
  } as const

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
          <p className="text-sm font-medium">Drop video files here</p>
          <p className="text-xs text-muted-foreground">
            Supports MP4, MOV, AVI, MKV, WebM
          </p>
        </div>
      </div>

      {/* Project List */}
      {projects.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
          <FileVideo className="size-10" />
          <p className="text-sm">No videos yet</p>
          <p className="text-xs">Drag and drop video files above to get started</p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="space-y-2">
            {projects.map((project) => (
              <div
                key={project.id}
                className="flex items-center gap-3 rounded-lg border p-3"
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
                <Badge variant={statusVariant[project.status]}>
                  {statusLabel[project.status]}
                </Badge>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-8 shrink-0">
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onConvertToSrt(project.id)}>
                      <FileText className="mr-2 size-4" />
                      Convert to SRT
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <FolderOpen className="mr-2 size-4" />
                      Show in Explorer
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => onRemoveProject(project.id)}
                    >
                      <Trash2 className="mr-2 size-4" />
                      Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
