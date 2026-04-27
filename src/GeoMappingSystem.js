import { useState, useEffect, useRef } from "react";

const NIGERIA_CENTER = [9.082, 8.6753];
const NIGERIA_ZOOM = 6;
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_SIZE = 256;

var tileCache = {};

function lon2tile(lon, zoom) {
  return Math.floor(((lon + 180) / 360) * Math.pow(2, zoom));
}
function lat2tile(lat, zoom) {
  return Math.floor(
    ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) *
      Math.pow(2, zoom)
  );
}
function tile2lon(x, zoom) {
  return (x / Math.pow(2, zoom)) * 360 - 180;
}
function tile2lat(y, zoom) {
  var n = Math.PI - (2 * Math.PI * y) / Math.pow(2, zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
function latlonToPixel(lat, lon, centerLat, centerLon, zoom, canvasW, canvasH) {
  var scale = Math.pow(2, zoom);
  var worldSize = TILE_SIZE * scale;
  function latToY(la) {
    var sinLat = Math.sin((la * Math.PI) / 180);
    return (worldSize / (2 * Math.PI)) * (Math.PI - Math.log((1 + sinLat) / (1 - sinLat)) / 2);
  }
  function lonToX(lo) { return (worldSize * (lo + 180)) / 360; }
  var cx = lonToX(centerLon), cy = latToY(centerLat);
  var px = lonToX(lon), py = latToY(lat);
  return { x: canvasW / 2 + (px - cx), y: canvasH / 2 + (py - cy) };
}
function pixelToLatLon(px, py, centerLat, centerLon, zoom, canvasW, canvasH) {
  var scale = Math.pow(2, zoom);
  var worldSize = TILE_SIZE * scale;
  function latToY(la) {
    var sinLat = Math.sin((la * Math.PI) / 180);
    return (worldSize / (2 * Math.PI)) * (Math.PI - Math.log((1 + sinLat) / (1 - sinLat)) / 2);
  }
  function lonToX(lo) { return (worldSize * (lo + 180)) / 360; }
  var cx = lonToX(centerLon), cy = latToY(centerLat);
  var wx = cx + (px - canvasW / 2);
  var wy = cy + (py - canvasH / 2);
  var lon = (wx / worldSize) * 360 - 180;
  var n = Math.PI - (2 * Math.PI * wy) / worldSize;
  var lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lon };
}
function toDMS(deg, isLat) {
  var d = Math.abs(deg), dd = Math.floor(d);
  var mm = Math.floor((d - dd) * 60);
  var ss = Math.round(((d - dd) * 60 - mm) * 60);
  var dir = isLat ? (deg >= 0 ? "N" : "S") : (deg >= 0 ? "E" : "W");
  return dd + "\u00b0" + mm + "'" + ss + '"' + dir;
}
function loadTile(z, x, y, onLoad) {
  var key = z + "/" + x + "/" + y;
  if (tileCache[key]) { onLoad(tileCache[key]); return; }
  var img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = function () { tileCache[key] = img; onLoad(img); };
  img.onerror = function () { onLoad(null); };
  img.src = TILE_URL.replace("{z}", z).replace("{x}", x).replace("{y}", y);
}

export default function GeoMappingSystem() {
  var canvasRef = useRef(null);
  var [center, setCenter] = useState({ lat: NIGERIA_CENTER[0], lon: NIGERIA_CENTER[1] });
  var [zoom, setZoom] = useState(NIGERIA_ZOOM);
  var [dragging, setDragging] = useState(false);
  var [dragStart, setDragStart] = useState(null);
  var [centerAtDragStart, setCenterAtDragStart] = useState(null);
  var [mode, setMode] = useState("pan");
  var [bbox, setBbox] = useState(null);
  var [bboxStart, setBboxStart] = useState(null);
  var [bboxEnd, setBboxEnd] = useState(null);
  var [drawing, setDrawing] = useState(false);
  var [tiles, setTiles] = useState([]);
  var [tick, setTick] = useState(0);
  var [canvasSize, setCanvasSize] = useState({ w: 900, h: 580 });

  var containerRef = useRef(null);

  useEffect(function () {
    function updateSize() {
      if (containerRef.current) {
        var rect = containerRef.current.getBoundingClientRect();
        setCanvasSize({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
      }
    }
    updateSize();
    window.addEventListener("resize", updateSize);
    return function () { window.removeEventListener("resize", updateSize); };
  }, []);

  var W = canvasSize.w, H = canvasSize.h;

  useEffect(function () {
    var newTiles = [];
    var cx = lon2tile(center.lon, zoom);
    var cy = lat2tile(center.lat, zoom);
    var range = Math.ceil(Math.max(W, H) / TILE_SIZE / 2) + 2;
    for (var x = cx - range; x <= cx + range; x++) {
      for (var y = cy - range; y <= cy + range; y++) {
        var maxTile = Math.pow(2, zoom);
        if (y < 0 || y >= maxTile) continue;
        var nx = ((x % maxTile) + maxTile) % maxTile;
        newTiles.push({ z: zoom, x: nx, y: y, ox: x });
      }
    }
    setTiles(newTiles);
  }, [center, zoom, W, H]);

  useEffect(function () {
    tiles.forEach(function (t) {
      loadTile(t.z, t.x, t.y, function () {
        setTick(function (n) { return n + 1; });
      });
    });
  }, [tiles]);

  useEffect(function () {
    var canvas = canvasRef.current;
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    tiles.forEach(function (t) {
      var key = t.z + "/" + t.x + "/" + t.y;
      var img = tileCache[key];
      var p = latlonToPixel(tile2lat(t.y, zoom), tile2lon(t.ox, zoom), center.lat, center.lon, zoom, W, H);
      var px = Math.round(p.x), py = Math.round(p.y);
      if (img) {
        ctx.drawImage(img, px, py, TILE_SIZE, TILE_SIZE);
      } else {
        ctx.fillStyle = "#e8e8e8";
        ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
        ctx.strokeStyle = "#ccc"; ctx.lineWidth = 0.5;
        ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
      }
    });

    // Vignette
    ctx.save();
    var grad = ctx.createRadialGradient(W/2, H/2, H*0.3, W/2, H/2, H*0.8);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.15)");
    ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // Grid
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 0.8; ctx.setLineDash([4, 4]);
    ctx.font = "10px monospace"; ctx.fillStyle = "rgba(255,255,255,0.85)";
    var gridStep = zoom <= 6 ? 5 : zoom <= 8 ? 2 : zoom <= 10 ? 1 : 0.5;
    var topLeft = pixelToLatLon(0, 0, center.lat, center.lon, zoom, W, H);
    var botRight = pixelToLatLon(W, H, center.lat, center.lon, zoom, W, H);
    var startLon = Math.ceil(topLeft.lon / gridStep) * gridStep;
    var startLat = Math.floor(topLeft.lat / gridStep) * gridStep;
    for (var lo = startLon; lo <= botRight.lon; lo += gridStep) {
      var p = latlonToPixel(center.lat, lo, center.lat, center.lon, zoom, W, H);
      ctx.beginPath(); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, H); ctx.stroke();
      ctx.fillText(toDMS(lo, false), p.x + 3, H - 6);
    }
    for (var la = startLat; la >= botRight.lat; la -= gridStep) {
      var p2 = latlonToPixel(la, center.lon, center.lat, center.lon, zoom, W, H);
      ctx.beginPath(); ctx.moveTo(0, p2.y); ctx.lineTo(W, p2.y); ctx.stroke();
      ctx.fillText(toDMS(la, true), 4, p2.y - 3);
    }
    ctx.setLineDash([]); ctx.restore();

    // Bounding box
    var drawBox = bbox || (bboxStart && bboxEnd ? { start: bboxStart, end: bboxEnd } : null);
    if (drawBox) {
      var s = drawBox.start, e = drawBox.end;
      var p1 = latlonToPixel(s.lat, s.lon, center.lat, center.lon, zoom, W, H);
      var p2b = latlonToPixel(e.lat, e.lon, center.lat, center.lon, zoom, W, H);
      var bx = Math.min(p1.x, p2b.x), by = Math.min(p1.y, p2b.y);
      var bw = Math.abs(p2b.x - p1.x), bh = Math.abs(p2b.y - p1.y);
      ctx.save();
      ctx.fillStyle = "rgba(240,192,64,0.15)"; ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = "#f0c040"; ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 3]); ctx.strokeRect(bx, by, bw, bh); ctx.setLineDash([]);
      ctx.fillStyle = "#f0c040"; ctx.font = "bold 10px monospace";
      var minLat = Math.min(s.lat, e.lat), maxLat = Math.max(s.lat, e.lat);
      var minLon = Math.min(s.lon, e.lon), maxLon = Math.max(s.lon, e.lon);
      ctx.fillText(toDMS(maxLat, true) + " " + toDMS(minLon, false), bx + 4, by + 14);
      ctx.fillText(toDMS(minLat, true) + " " + toDMS(maxLon, false), bx + bw - 160, by + bh - 4);
      ctx.restore();
    }

    // North arrow
    ctx.save();
    var ax = W - 50, ay = 50;
    ctx.shadowColor = "rgba(0,0,0,0.4)"; ctx.shadowBlur = 8;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(ax, ay, 22, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#c0392b";
    ctx.beginPath(); ctx.moveTo(ax, ay-18); ctx.lineTo(ax-8, ay+4); ctx.lineTo(ax+8, ay+4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#333";
    ctx.beginPath(); ctx.moveTo(ax, ay+18); ctx.lineTo(ax-8, ay-4); ctx.lineTo(ax+8, ay-4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#c0392b"; ctx.font = "bold 12px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("N", ax, ay - 22); ctx.textAlign = "left";
    ctx.restore();

    // Scale bar
    ctx.save();
    var metersPerPixel = (156543.03392 * Math.cos((center.lat * Math.PI) / 180)) / Math.pow(2, zoom);
    var barMeters = zoom >= 12 ? 500 : zoom >= 10 ? 2000 : zoom >= 8 ? 20000 : zoom >= 6 ? 100000 : 500000;
    var barPx = barMeters / metersPerPixel;
    var sx = 20, sy = H - 28;
    ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.fillRect(sx - 5, sy - 16, barPx + 10, 24);
    ctx.fillStyle = "#222"; ctx.fillRect(sx, sy - 8, barPx / 2, 10);
    ctx.fillStyle = "#888"; ctx.fillRect(sx + barPx / 2, sy - 8, barPx / 2, 10);
    ctx.strokeStyle = "#222"; ctx.lineWidth = 1.5; ctx.strokeRect(sx, sy - 8, barPx, 10);
    ctx.fillStyle = "#222"; ctx.font = "bold 9px sans-serif";
    ctx.fillText("0", sx, sy - 10);
    var label = barMeters >= 1000 ? (barMeters / 1000) + " km" : barMeters + " m";
    ctx.fillText(label, sx + barPx - 10, sy - 10);
    ctx.restore();

    // Attribution
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.fillRect(W - 205, H - 18, 205, 18);
    ctx.fillStyle = "#555"; ctx.font = "9px sans-serif";
    ctx.fillText("\u00a9 OpenStreetMap contributors", W - 200, H - 5);
    ctx.restore();

  }, [tiles, center, zoom, tick, bbox, bboxStart, bboxEnd, W, H]);

  function getLatLon(e) {
    var rect = canvasRef.current.getBoundingClientRect();
    var scaleX = W / rect.width, scaleY = H / rect.height;
    var x = (e.clientX - rect.left) * scaleX;
    var y = (e.clientY - rect.top) * scaleY;
    return pixelToLatLon(x, y, center.lat, center.lon, zoom, W, H);
  }
  function onMouseDown(e) {
    if (mode === "pan") {
      setDragging(true);
      setDragStart({ x: e.clientX, y: e.clientY });
      setCenterAtDragStart({ ...center });
    } else {
      var ll = getLatLon(e);
      setBboxStart(ll); setBboxEnd(ll); setDrawing(true); setBbox(null);
    }
  }
  function onMouseMove(e) {
    if (mode === "pan" && dragging && dragStart) {
      var scale = Math.pow(2, zoom);
      var worldSize = TILE_SIZE * scale;
      var dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
      var rect = canvasRef.current.getBoundingClientRect();
      var scaleX = W / rect.width, scaleY = H / rect.height;
      var dLon = (-dx * scaleX / worldSize) * 360;
      var dLat = (dy * scaleY / worldSize) * 180;
      setCenter({
        lat: Math.max(-85, Math.min(85, centerAtDragStart.lat + dLat)),
        lon: centerAtDragStart.lon + dLon,
      });
    } else if (mode === "bbox" && drawing) {
      setBboxEnd(getLatLon(e));
    }
  }
  function onMouseUp(e) {
    if (mode === "pan") {
      setDragging(false);
    } else if (mode === "bbox" && drawing) {
      var end = getLatLon(e);
      setBboxEnd(end); setDrawing(false);
      if (bboxStart) setBbox({ start: bboxStart, end: end });
    }
  }
  function onWheel(e) {
    e.preventDefault();
    setZoom(function (z) { return Math.max(4, Math.min(18, z + (e.deltaY > 0 ? -1 : 1))); });
  }
  function clearBbox() { setBbox(null); setBboxStart(null); setBboxEnd(null); }

  var bboxInfo = bbox ? {
    minLat: Math.min(bbox.start.lat, bbox.end.lat),
    maxLat: Math.max(bbox.start.lat, bbox.end.lat),
    minLon: Math.min(bbox.start.lon, bbox.end.lon),
    maxLon: Math.max(bbox.start.lon, bbox.end.lon),
  } : null;

  var btnBase = { border: "none", borderRadius: 6, padding: "7px 16px", cursor: "pointer", fontSize: 12, fontWeight: "bold" };

  return (
    <div style={{ background: "#0d0d1f", height: "100vh", fontFamily: "sans-serif", color: "#eee", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Header */}
      <div style={{ background: "#12122e", borderBottom: "1px solid #2a2a5a", padding: "8px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 34, height: 34, background: "#f0c040", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🗺</div>
          <div>
            <div style={{ fontWeight: "bold", fontSize: 16, color: "#f0c040" }}>Geo Mapping System</div>
            <div style={{ fontSize: 10, color: "#555" }}>Nigeria Geological Survey Platform — v0.1</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ background: "#1a3a1a", border: "1px solid #27ae60", borderRadius: 12, padding: "3px 12px", fontSize: 10, color: "#27ae60" }}>● OpenStreetMap Live</div>
          <div style={{ background: "#1a1a3a", border: "1px solid #3a3a6a", borderRadius: 12, padding: "3px 12px", fontSize: 10, color: "#888" }}>Zoom: {zoom}</div>
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ background: "#0f0f28", borderBottom: "1px solid #2a2a5a", padding: "6px 18px", display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: "#555" }}>MODE:</span>
        <button onClick={function () { setMode("pan"); }}
          style={Object.assign({}, btnBase, { background: mode === "pan" ? "#f0c040" : "#1e1e3a", color: mode === "pan" ? "#000" : "#aaa" })}>
          ✋ Pan & Zoom
        </button>
        <button onClick={function () { setMode("bbox"); }}
          style={Object.assign({}, btnBase, { background: mode === "bbox" ? "#f0c040" : "#1e1e3a", color: mode === "bbox" ? "#000" : "#aaa" })}>
          ⬜ Draw Study Area
        </button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button onClick={function () { setZoom(function (z) { return Math.min(18, z + 1); }); }}
            style={Object.assign({}, btnBase, { background: "#1e1e3a", color: "#fff", padding: "7px 14px" })}>+</button>
          <button onClick={function () { setZoom(function (z) { return Math.max(4, z - 1); }); }}
            style={Object.assign({}, btnBase, { background: "#1e1e3a", color: "#fff", padding: "7px 14px" })}>−</button>
          <button onClick={function () { setCenter({ lat: NIGERIA_CENTER[0], lon: NIGERIA_CENTER[1] }); setZoom(NIGERIA_ZOOM); clearBbox(); }}
            style={Object.assign({}, btnBase, { background: "#1e1e3a", color: "#aaa" })}>🇳🇬 Reset to Nigeria</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* Map */}
        <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <canvas ref={canvasRef} width={W} height={H}
            onMouseDown={onMouseDown} onMouseMove={onMouseMove}
            onMouseUp={onMouseUp} onMouseLeave={function () { setDragging(false); setDrawing(false); }}
            onWheel={onWheel}
            style={{ display: "block", width: "100%", height: "100%", cursor: mode === "pan" ? (dragging ? "grabbing" : "grab") : "crosshair" }}
          />
          {mode === "bbox" && !bbox && (
            <div style={{ position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)", background: "rgba(240,192,64,0.92)", color: "#000", borderRadius: 8, padding: "7px 16px", fontSize: 12, fontWeight: "bold", pointerEvents: "none" }}>
              Click and drag to draw your study area
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div style={{ width: 270, background: "#0a0a1e", borderLeft: "1px solid #2a2a5a", padding: 14, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>

          {/* Sequence status */}
          <div style={{ background: "#12122e", border: "1px solid #2a2a5a", borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 11, color: "#f0c040", fontWeight: "bold", marginBottom: 8 }}>SEQUENCE 1 — BASE MAP</div>
            {[
              ["OpenStreetMap tiles", true],
              ["Nigeria centered", true],
              ["Pan and zoom", true],
              ["DMS coordinate grid", true],
              ["North arrow", true],
              ["Scale bar", true],
              ["Study area drawing", true],
              ["Bounding box confirmed", !!bbox],
            ].map(function (item, i) {
              return (
                <div key={i} style={{ display: "flex", gap: 8, fontSize: 11, marginBottom: 4 }}>
                  <span style={{ color: item[1] ? "#27ae60" : "#444" }}>{item[1] ? "✓" : "○"}</span>
                  <span style={{ color: item[1] ? "#8fbb8f" : "#555" }}>{item[0]}</span>
                </div>
              );
            })}
          </div>

          {/* Bounding box */}
          <div style={{ background: "#12122e", border: "1px solid " + (bbox ? "#f0c040" : "#2a2a5a"), borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 11, color: "#f0c040", fontWeight: "bold", marginBottom: 8 }}>STUDY AREA BOUNDARY</div>
            {!bbox ? (
              <div style={{ fontSize: 11, color: "#555", lineHeight: 1.6 }}>
                No boundary defined yet.<br />
                Switch to <strong style={{ color: "#f0c040" }}>Draw Study Area</strong> and drag a box over your field location.
              </div>
            ) : (
              <div>
                {[
                  ["North", toDMS(bboxInfo.maxLat, true)],
                  ["South", toDMS(bboxInfo.minLat, true)],
                  ["West", toDMS(bboxInfo.minLon, false)],
                  ["East", toDMS(bboxInfo.maxLon, false)],
                ].map(function (row, i) {
                  return (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 5, borderBottom: "1px solid #1a1a3a", paddingBottom: 4 }}>
                      <span style={{ color: "#666" }}>{row[0]}</span>
                      <span style={{ color: "#f0c040", fontFamily: "monospace" }}>{row[1]}</span>
                    </div>
                  );
                })}
                <button onClick={clearBbox}
                  style={Object.assign({}, btnBase, { width: "100%", marginTop: 8, background: "#3a1a1a", color: "#e74c3c", border: "1px solid #e74c3c" })}>
                  Clear Boundary
                </button>
                <button style={Object.assign({}, btnBase, { width: "100%", marginTop: 6, background: "#1a3a1a", color: "#27ae60", border: "1px solid #27ae60" })}>
                  Confirm — Go to Step 2 →
                </button>
              </div>
            )}
          </div>

          {/* Quick nav */}
          <div style={{ background: "#12122e", border: "1px solid #2a2a5a", borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 11, color: "#f0c040", fontWeight: "bold", marginBottom: 8 }}>QUICK NAVIGATE</div>
            {[
              { label: "All Nigeria", lat: 9.082, lon: 8.675, z: 6 },
              { label: "Lagos", lat: 6.524, lon: 3.379, z: 11 },
              { label: "Abuja", lat: 9.072, lon: 7.492, z: 11 },
              { label: "Port Harcourt", lat: 4.815, lon: 7.049, z: 11 },
              { label: "Calabar", lat: 4.958, lon: 8.327, z: 11 },
              { label: "Akwa Ibom", lat: 5.007, lon: 7.849, z: 10 },
              { label: "Enugu", lat: 6.441, lon: 7.499, z: 11 },
              { label: "Jos Plateau", lat: 9.896, lon: 8.858, z: 10 },
            ].map(function (place, i) {
              return (
                <button key={i} onClick={function () { setCenter({ lat: place.lat, lon: place.lon }); setZoom(place.z); }}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", color: "#aaa", border: "none", borderBottom: "1px solid #1a1a3a", padding: "6px 2px", cursor: "pointer", fontSize: 11 }}>
                  📍 {place.label}
                </button>
              );
            })}
          </div>

          {/* Next */}
          <div style={{ background: "#0f0f1e", border: "1px dashed #2a2a4a", borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 11, color: "#444", fontWeight: "bold", marginBottom: 4 }}>NEXT: SEQUENCE 2</div>
            <div style={{ fontSize: 10, color: "#333", lineHeight: 1.6 }}>
              Click-to-draw tools for towns, roads, rivers, samples, and geology polygons. Unlocks after study area confirmed.
            </div>
          </div>

        </div>
      </div>

      {/* Footer */}
      <div style={{ background: "#0a0a1e", borderTop: "1px solid #2a2a5a", padding: "5px 18px", display: "flex", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: "#333" }}>Geo Mapping System v0.1 — Sequence 1</span>
        <span style={{ fontSize: 10, color: "#333" }}>Nigeria-first · WGS84 · OpenStreetMap</span>
      </div>
    </div>
  );
}