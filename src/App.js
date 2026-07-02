import { useState } from "react";
import GeoMappingSystem from "./GeoMappingSystem";
import VESSystem from "./VESSystem";

var MODULES = [
  {
    key: "maps",
    label: "Geo Mapping",
    icon: "🗺",
    color: "#f0c040",
    desc: "Geological maps, sample location, cross-sections, stratigraphy",
  },
  {
    key: "ves",
    label: "VES",
    icon: "⚡",
    color: "#27ae60",
    desc: "Vertical Electrical Sounding, sounding curves, geoelectric sections",
  },
];

function ModuleSelector({ onSelect }) {
  return (
    <div style={{ background: "#0d0d1f", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "sans-serif" }}>
      <div style={{ width: 460 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🌍</div>
          <div style={{ fontSize: 18, fontWeight: "bold", color: "#f0c040" }}>Geoscience Field Platform</div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>Choose a module to continue</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {MODULES.map(function (m) {
            return (
              <div
                key={m.key}
                onClick={function () { onSelect(m.key); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  background: "#12122e",
                  border: "1px solid #2a2a5a",
                  borderRadius: 10,
                  padding: 16,
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    flexShrink: 0,
                    background: m.color,
                    borderRadius: 10,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 22,
                  }}
                >
                  {m.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: "bold", color: m.color }}>{m.label}</div>
                  <div style={{ fontSize: 10, color: "#888", marginTop: 2, lineHeight: 1.5 }}>{m.desc}</div>
                </div>
                <div style={{ fontSize: 16, color: "#444" }}>→</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  var [currentModule, setCurrentModule] = useState(null);

  if (currentModule === "maps") {
    return <GeoMappingSystem />;
  }
  if (currentModule === "ves") {
    return <VESSystem onBackToModules={function () { setCurrentModule(null); }} />;
  }

  return <ModuleSelector onSelect={setCurrentModule} />;
}