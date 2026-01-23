import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

// GitHub Pages-safe base path (e.g. /den-society-vite/)
const BASE = import.meta.env.BASE_URL || "/";
document.documentElement.style.setProperty(
  "--course-bg-url",
  `url('${BASE}course-bg.jpg')`
);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
