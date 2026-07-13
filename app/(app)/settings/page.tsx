"use client";

import dynamic from "next/dynamic";
import { SettingsSkeleton } from "@/components/app/page-skeletons";

const SettingsView = dynamic(
  () => import("@/components/app/settings-view").then((m) => m.SettingsView),
  { loading: () => <SettingsSkeleton /> },
);

export default function SettingsPage() {
  return <SettingsView />;
}
