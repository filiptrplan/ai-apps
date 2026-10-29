// Hash routing: "#/deck", "#/card/<id>", … ("#/" is Today).
const { useState, useEffect } = React;

function parseHash() {
  const [name = "", param = null] = location.hash.replace(/^#\/?/, "").split("/");
  return { name, param: param && decodeURIComponent(param) };
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function go(href) {
  location.hash = href.replace(/^#/, "");
}
