import { Navigate, Route, Routes } from "react-router-dom";
import { HomePage } from "@/pages/HomePage";
import { ProblemsPage } from "@/pages/ProblemsPage";
import { ProblemEditorPage } from "@/pages/ProblemEditorPage";
import { ExecutorPage } from "@/pages/ExecutorPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { ThemeToggle } from "@/components/ThemeToggle";
import { APP_MODE, ENABLE_EXECUTOR, ENABLE_PROBLEMS } from "@/lib/app-config";

function App() {
  return (
    <>
      <ThemeToggle />
      <Routes>
        {APP_MODE === "all" && <Route path="/" element={<HomePage />} />}
        {APP_MODE === "executor" && <Route path="/" element={<ExecutorPage />} />}
        {APP_MODE === "problems" && <Route path="/" element={<ProblemsPage />} />}

        {ENABLE_EXECUTOR ? (
          <Route path="/executor" element={APP_MODE === "executor" ? <Navigate to="/" replace /> : <ExecutorPage />} />
        ) : (
          <Route path="/executor" element={<NotFoundPage />} />
        )}

        {ENABLE_PROBLEMS ? (
          <>
            <Route path="/problems" element={APP_MODE === "problems" ? <Navigate to="/" replace /> : <ProblemsPage />} />
            <Route path="/problems/:id" element={<ProblemEditorPage />} />
          </>
        ) : (
          <>
            <Route path="/problems" element={<NotFoundPage />} />
            <Route path="/problems/:id" element={<NotFoundPage />} />
          </>
        )}

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}

export default App;