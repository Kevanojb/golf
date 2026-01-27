import React from "react";
import ReactDOM from "react-dom/client";
import AuthGate from "./AuthGate.jsx";

// ✅ THIS is what applies Tailwind / your global styles
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AuthGate />
  </React.StrictMode>
);
