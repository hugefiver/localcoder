import { useNavigate } from "react-router-dom";
import { ExecutorView } from "@/components/ExecutorView";

export function ExecutorPage() {
  const navigate = useNavigate();
  return <ExecutorView onBack={() => navigate(-1)} />;
}
