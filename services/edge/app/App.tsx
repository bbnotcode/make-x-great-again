import { Route, Routes } from "react-router-dom";
import { ThemeProvider } from "./lib/theme";
import { AdminPage } from "./pages/AdminPage";

export function App() {
  return (
    <ThemeProvider>
      <Routes>
        <Route path="/admin" element={<AdminPage />} />
        <Route path="*" element={<AdminPage />} />
      </Routes>
    </ThemeProvider>
  );
}
