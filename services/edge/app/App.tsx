import { Route, Routes } from "react-router-dom";
import { ThemeProvider } from "./lib/theme";
import { AdminPage } from "./pages/AdminPage";
import { LandingPage } from "./pages/LandingPage";
import { ListPage } from "./pages/ListPage";

export function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/list" element={<ListPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<LandingPage />} />
      </Routes>
    </ThemeProvider>
  );
}
