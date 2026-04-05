import { useTranslation } from "react-i18next"
import {
  LayoutDashboard,
  FolderOpen,
  Settings,
  Scissors,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/renderer/components/ui/sidebar"

export type Page = "dashboard" | "projects" | "settings"

interface AppSidebarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
}

export function AppSidebar({ currentPage, onNavigate }: AppSidebarProps) {
  const { t } = useTranslation()

  const mainNav = [
    { title: t("nav.dashboard"), icon: LayoutDashboard, page: "dashboard" as Page },
    { title: t("nav.projects"), icon: FolderOpen, page: "projects" as Page },
  ]

  const secondaryNav = [
    { title: t("nav.settings"), icon: Settings, page: "settings" as Page },
  ]
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="Vodcut">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Scissors className="size-4" />
              </div>
              <div className="flex flex-col gap-0.5 leading-none">
                <span className="font-semibold">Vodcut</span>
                <span className="text-xs text-muted-foreground">v1.0.0</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarSeparator />
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t("nav.main")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainNav.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={currentPage === item.page}
                    tooltip={item.title}
                    onClick={() => onNavigate(item.page)}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          {secondaryNav.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                isActive={currentPage === item.page}
                tooltip={item.title}
                onClick={() => onNavigate(item.page)}
              >
                <item.icon />
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
