import { createRoot } from "react-dom/client";
import App from './App';

document.querySelector('#loading')!.remove();

createRoot(document.getElementById("root")).render(
  <App serverData={window.SERVER_DATA} />,
);