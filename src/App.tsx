import { Route, Routes } from "react-router-dom";
import { HomePage } from "@/pages/HomePage";
import { ProblemsPage } from "@/pages/ProblemsPage";
import { ProblemEditorPage } from "@/pages/ProblemEditorPage";
import { ExecutorPage } from "@/pages/ExecutorPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { ThemeToggle } from "@/components/ThemeToggle";

function App() {
  return (
    <>
      <ThemeToggle />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/executor" element={<ExecutorPage />} />
        <Route path="/problems" element={<ProblemsPage />} />
        <Route path="/problems/:id" element={<ProblemEditorPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </>
  );
}

export default App;