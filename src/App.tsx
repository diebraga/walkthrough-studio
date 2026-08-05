import { useEffect, useRef } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { start } from "./walk-demo/entry";

function NotFound() {
  return (
    <pre style={{ color: "#eee", font: "13px/1.6 monospace", padding: 24 }}>
      {`No route for ${location.pathname}\n\nAvailable:\n  /`}
    </pre>
  );
}

function WalkRoute() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    return start(host);
  }, []);

  return <div ref={hostRef} style={{ width: "100%", height: "100%" }} />;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WalkRoute />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
