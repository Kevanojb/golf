import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import Bootstrap from "./Bootstrap.jsx";
import "./index.css";
import "./legacy.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Bootstrap />
    </BrowserRouter>
  </React.StrictMode>
);
