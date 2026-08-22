import { UserApp } from "./UserApp.jsx";
import { AdminApp } from "./AdminApp.jsx";
import { globalCss } from "./ui.jsx";

const { useState, useEffect } = React;

function currentRoute() {
  return window.location.hash === "#/admin" ? "admin" : "user";
}

export function Root() {
  const [route, setRoute] = useState(currentRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <>
      <style>{globalCss}</style>
      {route === "admin"
        ? <AdminApp onExit={() => { window.location.hash = ""; }} />
        : <UserApp onOpenAdmin={() => { window.location.hash = "#/admin"; }} />}
    </>
  );
}
