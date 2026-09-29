import { MarginExtender } from "./MarginExtender.jsx";

const { useState, useEffect } = React;

const TOOLS = [
  {
    id: "margins",
    title: "Margin extender",
    desc: "Add blank space around every page, e.g. room for handwritten notes next to lecture slides.",
    Component: MarginExtender,
  },
];

function currentTool() {
  const id = window.location.hash.slice(1);
  return TOOLS.find((t) => t.id === id) ?? null;
}

export function PdfToolsApp() {
  const [tool, setTool] = useState(currentTool);

  useEffect(() => {
    const onHash = () => setTool(currentTool());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.title = tool ? `${tool.title} · PDF Tools` : "PDF Tools";
  }, [tool]);

  return (
    <div className={`pt${tool ? " pt-wide" : ""}`}>
      <header className="pt-header">
        <a className="pt-back" href={tool ? "#" : "./"} aria-label={tool ? "All PDF tools" : "All apps"}>‹</a>
        <h1>{tool ? tool.title : "PDF Tools"}</h1>
      </header>

      {tool ? (
        <tool.Component />
      ) : (
        <main className="pt-list">
          {TOOLS.map((t) => (
            <a className="pt-item" key={t.id} href={`#${t.id}`}>
              <span className="pt-item-title">{t.title}</span>
              <span className="pt-muted">{t.desc}</span>
            </a>
          ))}
        </main>
      )}
    </div>
  );
}
