import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AppErrorBoundary } from "./components/AppErrorBoundary.tsx";
import { reloadAfterChunkError } from "./lib/chunk-recovery.ts";
import "./index.css";

window.addEventListener('vite:preloadError', event => {
  if (reloadAfterChunkError()) event.preventDefault()
})

if (window.location.protocol === "http:" && !["localhost", "127.0.0.1"].includes(window.location.hostname)) {
  window.location.replace(`https://${window.location.host}${window.location.pathname}${window.location.search}${window.location.hash}`);
}

createRoot(document.getElementById("root")!).render(<AppErrorBoundary><App /></AppErrorBoundary>);
