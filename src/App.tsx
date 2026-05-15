// Tiny client-side router: only two routes, no react-router needed.
//   "/"            → Home  (create / join room)
//   "/r/<CODE>"    → Room

import { useEffect, useState } from "react";
import Home from "./pages/Home";
import Room from "./pages/Room";

type Route = { kind: "home" } | { kind: "room"; id: string };

function parseRoute(): Route {
  const path = window.location.pathname;
  const match = path.match(/^\/r\/([A-Z0-9]+)/i);
  if (match) {
    return { kind: "room", id: match[1].toUpperCase() };
  }
  return { kind: "home" };
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute());

  useEffect(() => {
    const onPop = () => setRoute(parseRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function navigate(to: string) {
    window.history.pushState({}, "", to);
    setRoute(parseRoute());
  }

  if (route.kind === "room") {
    return <Room roomId={route.id} onLeave={() => navigate("/")} />;
  }
  return <Home onJoin={(id) => navigate(`/r/${id.toUpperCase()}`)} />;
}
