import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.jsx";

// ✅ Make sure styles load in both dev + GitHub Pages (/golf/)
import "./index.css";   // your Tailwind / base styles (if you have it)
import "./legacy.css";  // the big legacy block you pasted

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
