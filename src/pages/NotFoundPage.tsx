import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

export function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4">
        <div className="text-2xl font-bold">页面不存在</div>
        <Button asChild>
          <Link to="/">返回首页</Link>
        </Button>
      </div>
    </div>
  );
}
