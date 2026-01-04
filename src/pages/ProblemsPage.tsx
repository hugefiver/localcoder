import { useNavigate } from "react-router-dom";
import { ProblemList } from "@/components/ProblemList";
import { useLocalStorageState } from "@/hooks/use-local-storage";

export function ProblemsPage() {
  const navigate = useNavigate();
  const [solvedProblems] = useLocalStorageState<number[]>("solved-problems", []);

  return (
    <ProblemList
      onSelectProblem={(id) => navigate(`/problems/${id}`)}
      onOpenExecutor={() => navigate("/executor")}
      solvedProblems={new Set(solvedProblems)}
    />
  );
}
