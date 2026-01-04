import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EditorView } from "@/components/EditorView";

export function ProblemEditorPage() {
  const navigate = useNavigate();
  const params = useParams();

  const problemId = useMemo(() => {
    const n = Number(params.id);
    return Number.isFinite(n) ? n : 0;
  }, [params.id]);

  return <EditorView problemId={problemId} onBack={() => navigate("/problems")} />;
}
