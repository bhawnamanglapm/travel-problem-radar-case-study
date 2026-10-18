// Entry point for the daily live page on Vercel. Same dashboard component, but read-only:
// it shows the latest sweep saved by /api/sweep (via /api/data) and never calls an AI model.
import { createRoot } from "react-dom/client";
import TravelProblemRadar from "../../travel-problem-radar.jsx";

createRoot(document.getElementById("root")).render(<TravelProblemRadar remote="/api/data" />);
