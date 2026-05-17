import MainAdminPanel from "./components/mockups/dashboard/MainAdminPanel";
import WebDashboard from "./components/mockups/dashboard/WebDashboard";

function getBasePath(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "");
}

function getLocalPath(): string {
  const basePath = getBasePath();
  const { pathname } = window.location;
  return basePath && pathname.startsWith(basePath)
    ? pathname.slice(basePath.length) || "/"
    : pathname;
}

function App() {
  const path = getLocalPath();

  // Keep the sub-admin/device dashboard route working because MainAdminPanel
  // opens app dashboards using this URL.
  if (path === "/preview/dashboard/WebDashboard") {
    return <WebDashboard />;
  }

  // Main app now has only one primary preview: Master Admin.
  // Root, /preview, and old preview/design routes all open the same screen.
  return <MainAdminPanel />;
}

export default App;
