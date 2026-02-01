import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";

import Bootstrap from "./Bootstrap.jsx";
import "./index.css";
import "./legacy.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <HashRouter basename={import.meta.env.BASE_URL}>
      <Bootstrap />
    </HashRouter>
  </React.StrictMode>
);
