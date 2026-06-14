import { redirect } from "next/navigation";

// Avoid conflict with app/page.tsx — both resolve to "/".
// Dashboard is now at /leads (the primary landing page for authenticated users).
export default function AppRootPage() {
  redirect("/leads");
}
