import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";

const container = document.getElementById("app");
if (!container) {
  throw new Error("#app container not found");
}

createRoot(container).render(<App />);
