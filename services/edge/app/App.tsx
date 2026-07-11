import { lazy, Suspense } from "react";
import { Route, Routes } from "react-router-dom";
import { ThemeProvider } from "./lib/theme";

const LandingPage = lazy(() =>
  import("./pages/LandingPage").then(({ LandingPage }) => ({ default: LandingPage })),
);
const ListPage = lazy(() =>
  import("./pages/ListPage").then(({ ListPage }) => ({ default: ListPage })),
);
const AdminPage = lazy(() =>
  import("./pages/AdminPage").then(({ AdminPage }) => ({ default: AdminPage })),
);

function RouteFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
      <output aria-live="polite">
        正在加载…
      </output>
    </main>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/list" element={<ListPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<LandingPage />} />
        </Routes>
      </Suspense>
    </ThemeProvider>
  );
}
