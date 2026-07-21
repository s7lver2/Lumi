// apps/web/app/setup/layout.tsx
import { PageFadeTransition } from "../components/PageFadeTransition";

export default function SetupLayout({ children }: { children: React.ReactNode }) {
  return <PageFadeTransition>{children}</PageFadeTransition>;
}