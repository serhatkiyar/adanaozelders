import AdminHome, { type Tab } from "@/pages/dashboards/AdminHome";

export default function AdminSectionPage({ section }: { section: Exclude<Tab, "overview"> }) {
  return <AdminHome section={section} />;
}
