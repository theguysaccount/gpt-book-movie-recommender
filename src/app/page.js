// Entry point on every page. Loads the app only where it is needed.
import { pageview } from "./dom.js";

pageview();
const cls = document.body.className;
if (cls.includes("page-home")) import("./app.js").then((m) => m.boot());
else if (cls.includes("page-shared")) import("./shared.js").then((m) => m.boot());
