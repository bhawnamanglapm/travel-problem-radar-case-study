// Entry point for the GitHub Pages demo. Renders the same dashboard component
// as the Claude artifact, but with the saved sample, so no API is called.
import { createRoot } from "react-dom/client";
import TravelProblemRadar from "../../travel-problem-radar.jsx";
import sample from "../../sampleData.json";

createRoot(document.getElementById("root")).render(<TravelProblemRadar sample={sample} />);
