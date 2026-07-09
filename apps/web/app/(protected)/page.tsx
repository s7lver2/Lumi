import { redirect } from "next/navigation";
import { SearchDashboard } from "../components/SearchDashboard";

export default function HomePage() {
  return <SearchDashboard />;
}