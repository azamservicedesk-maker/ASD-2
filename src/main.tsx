import { createRoot } from "react-dom/client";
import App from "./app";
import "./index.css";
import AuthWrapper from "./main-auth";

createRoot(document.getElementById("root")!).render(
  <AuthWrapper>
    <App />
  </AuthWrapper>
);
