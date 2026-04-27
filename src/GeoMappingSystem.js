import { useState, useEffect, useRef, useCallback } from "react";

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
function tile2lon(x, zoom) { return (x / Math.pow(2, zoom)) * 360 - 180; }
function tile2lat(y, zoom) {
  var n = Math.PI - (2 * Math.PI * y) / Math.pow(2, zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}
function latlonToPixel(lat, lon, centerLat, centerLon, zoom, W, H) {
  var scale = Math.pow(2, zoom);
  var worldSize = TILE_SIZE * scale;
  function latToY(la) {
    var s = Math.sin((la * Math.PI) / 180);
    return (worldSize / (2 * Math.PI)) * (Math.PI - Math.log((1 + s) / (1 - s)) / 2);
  }
  function lonToX(lo) { return (worldSize * (lo + 180)) / 360; }
  var cx = lonToX(centerLon), cy = latToY(centerLat);
  return { x: W / 2 + (lonToX(lon) - cx), y: H / 2 + (latToY(lat) - cy) };
}
function pixelToLatLon(px, py, centerLat, centerLon, zoom, W, H) {
  var scale = Math.pow(2, zoom);
  var worldSize = TILE_SIZE * scale;
  function latToY(la) {
    var s = Math.sin((la * Math.PI) / 180);
    return (worldSize / (2 * Math.PI)) * (Math.PI - Math.log((1 + s) / (1 - s)) / 2);
  }
  function lonToX(lo) { return (worldSize * (lo + 180)) / 360; }
  var wx = lonToX(centerLon) + (px - W / 2);
  var wy = latToY(centerLat) + (py - H / 2);
  var lon = (wx / worldSize) * 360 - 180;
  var n = Math.PI - (2 * Math.PI * wy) / worldSize;
  return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lon };
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
  var containerRef = useRef(null);
  var [center, setCenter] = useState({ lat: NIGERIA_CENTER[0], lon: NIGERIA_CENTER[1] });
  var [zoom, setZoom] = useState(NIGERIA_ZOOM);
  var [mode, setMode] = useState("pan");
  var [bbox, setBbox] = useState(null);
  var [bboxStart, setBboxStart] = useState(null);
  var [bboxEnd, setBboxEnd] = useState(null);
  var [tiles, setTiles] = useState([]);
  var [tick, setTick] = useState(0);
  var [size, setSize] = useState({ w: 375, h: 500 });
  var [sidebarOpen, setSidebarOpen] = useState(false);
  var [isMobile, setIsMobile] = useState(false);

  // interaction state refs (avoid stale closures in event handlers)
  var dragRef = useRef(null);
  var drawingRef = useRef(false);
  var bboxStartRef = useRef(null);
  var touchRef = useRef(null); // for pinch zoom
  var centerRef = useRef(center);
  var zoomRef = useRef(zoom);
  centerRef.current = center;
  zoomRef.current = zoom;

  var W = size.w, H = size.h;

  // ── Responsive size ────────────────────────────────────────────────────
  useEffect(function () {
    function update() {
      var mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (containerRef.current) {
        var r = containerRef.current.getBoundingClientRect();
        setSize({ w: Math.floor(r.width) || window.innerWidth, h: Math.floor(r.height) || window.innerHeight - 140 });
      }
    }
    update();
    window.addEventListener("resize", update);
    return function () { window.removeEventListener("resize", update); };
  }, []);

  // ── Tiles ──────────────────────────────────────────────────────────────
  useEffect(function () {
    var cx = lon2tile(center.lon, zoom), cy = lat2tile(center.lat, zoom);
    var range = Math.ceil(Math.max(W, H) / TILE_SIZE / 2) + 2;
    var next = [];
    for (var x = cx - range; x <= cx + range; x++) {
      for (var y = cy - range; y <= cy + range; y++) {
        var max = Math.pow(2, zoom);
        if (y < 0 || y >= max) continue;
        next.push({ z: zoom, x: ((x % max) + max) % max, y: y, ox: x });
      }
    }
    setTiles(next);
  }, [center, zoom, W, H]);

  useEffect(function () {
    tiles.forEach(function (t) {
      loadTile(t.z, t.x, t.y, function () { setTick(function (n) { return n + 1; }); });
    });
  }, [tiles]);

  // ── Draw ───────────────────────────────────────────────────────────────
  useEffect(function () {
    var canvas = canvasRef.current;
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    // Tiles
    tiles.forEach(function (t) {
      var img = tileCache[t.z + "/" + t.x + "/" + t.y];
      var p = latlonToPixel(tile2lat(t.y, zoom), tile2lon(t.ox, zoom), center.lat, center.lon, zoom, W, H);
      if (img) {
        ctx.drawImage(img, Math.round(p.x), Math.round(p.y), TILE_SIZE, TILE_SIZE);
      } else {
        ctx.fillStyle = "#e8e8e8";
        ctx.fillRect(Math.round(p.x), Math.round(p.y), TILE_SIZE, TILE_SIZE);
      }
    });

    // Vignette
    var g = ctx.createRadialGradient(W/2, H/2, H*0.25, W/2, H/2, H*0.75);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.12)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.28)"; ctx.lineWidth = 0.7; ctx.setLineDash([4, 4]);
    ctx.font = (isMobile ? "9" : "10") + "px monospace"; ctx.fillStyle = "rgba(255,255,255,0.82)";
    var step = zoom <= 6 ? 5 : zoom <= 8 ? 2 : zoom <= 10 ? 1 : 0.5;
    var tl = pixelToLatLon(0, 0, center.lat, center.lon, zoom, W, H);
    var br = pixelToLatLon(W, H, center.lat, center.lon, zoom, W, H);
    for (var lo = Math.ceil(tl.lon / step) * step; lo <= br.lon; lo += step) {
      var px = latlonToPixel(center.lat, lo, center.lat, center.lon, zoom, W, H).x;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke();
      if (!isMobile || step >= 2) ctx.fillText(toDMS(lo, false), px + 2, H - 5);
    }
    for (var la = Math.floor(tl.lat / step) * step; la >= br.lat; la -= step) {
      var py = latlonToPixel(la, center.lon, center.lat, center.lon, zoom, W, H).y;
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(W, py); ctx.stroke();
      if (!isMobile || step >= 2) ctx.fillText(toDMS(la, true), 3, py - 3);
    }
    ctx.setLineDash([]); ctx.restore();

    // Bbox
    var box = bbox || (bboxStart && bboxEnd ? { start: bboxStart, end: bboxEnd } : null);
    if (box && box.start && box.end) {
      var p1 = latlonToPixel(box.start.lat, box.start.lon, center.lat, center.lon, zoom, W, H);
      var p2 = latlonToPixel(box.end.lat, box.end.lon, center.lat, center.lon, zoom, W, H);
      var bx = Math.min(p1.x, p2.x), by = Math.min(p1.y, p2.y);
      var bw = Math.abs(p2.x - p1.x), bh = Math.abs(p2.y - p1.y);
      ctx.save();
      ctx.fillStyle = "rgba(240,192,64,0.12)"; ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = "#f0c040"; ctx.lineWidth = 2.5; ctx.setLineDash([6, 3]);
      ctx.strokeRect(bx, by, bw, bh); ctx.setLineDash([]);
      ctx.fillStyle = "#f0c040"; ctx.font = "bold " + (isMobile ? "9" : "10") + "px monospace";
      var minLat = Math.min(box.start.lat, box.end.lat), maxLat = Math.max(box.start.lat, box.end.lat);
      var minLon = Math.min(box.start.lon, box.end.lon), maxLon = Math.max(box.start.lon, box.end.lon);
      if (bw > 80) {
        ctx.fillText(toDMS(maxLat, true), bx + 3, by + 12);
        ctx.fillText(toDMS(minLon, false), bx + 3, by + 23);
        ctx.fillText(toDMS(minLat, true), bx + bw - 90, by + bh - 13);
        ctx.fillText(toDMS(maxLon, false), bx + bw - 90, by + bh - 2);
      }
      ctx.restore();
    }

    // North arrow
    var arrowSize = isMobile ? 18 : 22;
    var ax = W - arrowSize - 12, ay = arrowSize + 12;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)"; ctx.shadowBlur = 6;
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ax, ay, arrowSize, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#c0392b";
    ctx.beginPath(); ctx.moveTo(ax, ay - arrowSize + 2); ctx.lineTo(ax - arrowSize * 0.35, ay + arrowSize * 0.2);
    ctx.lineTo(ax + arrowSize * 0.35, ay + arrowSize * 0.2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#444";
    ctx.beginPath(); ctx.moveTo(ax, ay + arrowSize - 2); ctx.lineTo(ax - arrowSize * 0.35, ay - arrowSize * 0.2);
    ctx.lineTo(ax + arrowSize * 0.35, ay - arrowSize * 0.2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#c0392b"; ctx.font = "bold " + (isMobile ? "10" : "12") + "px sans-serif";
    ctx.textAlign = "center"; ctx.fillText("N", ax, ay - arrowSize - 2); ctx.textAlign = "left";
    ctx.restore();

    // Scale bar
    var mpp = (156543.03392 * Math.cos((center.lat * Math.PI) / 180)) / Math.pow(2, zoom);
    var bm = zoom >= 12 ? 500 : zoom >= 10 ? 2000 : zoom >= 8 ? 20000 : zoom >= 6 ? 100000 : 500000;
    var bp = bm / mpp;
    var sx = 12, sy = H - (isMobile ? 20 : 26);
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.88)"; ctx.fillRect(sx - 3, sy - 13, bp + 6, 20);
    ctx.fillStyle = "#222"; ctx.fillRect(sx, sy - 7, bp / 2, 8);
    ctx.fillStyle = "#999"; ctx.fillRect(sx + bp / 2, sy - 7, bp / 2, 8);
    ctx.strokeStyle = "#222"; ctx.lineWidth = 1.2; ctx.strokeRect(sx, sy - 7, bp, 8);
    ctx.fillStyle = "#222"; ctx.font = "bold 8px sans-serif";
    ctx.fillText("0", sx, sy - 9);
    ctx.fillText(bm >= 1000 ? bm / 1000 + "km" : bm + "m", sx + bp - 8, sy - 9);
    ctx.restore();

    // Attribution
    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.fillRect(W - 185, H - 16, 185, 16);
    ctx.fillStyle = "#666"; ctx.font = "8px sans-serif";
    ctx.fillText("\u00a9 OpenStreetMap contributors", W - 182, H - 4);
    ctx.restore();

  }, [tiles, center, zoom, tick, bbox, bboxStart, bboxEnd, W, H, isMobile]);

  // ── Helpers ────────────────────────────────────────────────────────────
  function getPos(e, isTouch) {
    var canvas = canvasRef.current;
    var rect = canvas.getBoundingClientRect();
    var sx = W / rect.width, sy = H / rect.height;
    var src = isTouch ? e.touches[0] : e;
    return pixelToLatLon(
      (src.clientX - rect.left) * sx,
      (src.clientY - rect.top) * sy,
      centerRef.current.lat, centerRef.current.lon,
      zoomRef.current, W, H
    );
  }
  function getRawPos(e, isTouch) {
    var canvas = canvasRef.current;
    var rect = canvas.getBoundingClientRect();
    var sx = W / rect.width, sy = H / rect.height;
    var src = isTouch ? e.touches[0] : e;
    return { x: (src.clientX - rect.left) * sx, y: (src.clientY - rect.top) * sy };
  }

  // ── Mouse events ───────────────────────────────────────────────────────
  function onMouseDown(e) {
    if (mode === "pan") {
      dragRef.current = { sx: e.clientX, sy: e.clientY, clat: center.lat, clon: center.lon };
    } else {
      var ll = getPos(e, false);
      bboxStartRef.current = ll; setBboxStart(ll); setBboxEnd(ll); setBbox(null);
      drawingRef.current = true;
    }
  }
  function onMouseMove(e) {
    if (mode === "pan" && dragRef.current) {
      var d = dragRef.current;
      var scale = Math.pow(2, zoom), ws = TILE_SIZE * scale;
      var rect = canvasRef.current.getBoundingClientRect();
      var sx = W / rect.width, sy2 = H / rect.height;
      setCenter({
        lat: Math.max(-85, Math.min(85, d.clat + ((e.clientY - d.sy) * sy2 / ws) * 180)),
        lon: d.clon + (-(e.clientX - d.sx) * sx / ws) * 360,
      });
    } else if (mode === "bbox" && drawingRef.current) {
      setBboxEnd(getPos(e, false));
    }
  }
  function onMouseUp(e) {
    if (mode === "pan") { dragRef.current = null; }
    else if (drawingRef.current) {
      var end = getPos(e, false);
      setBboxEnd(end); drawingRef.current = false;
      if (bboxStartRef.current) setBbox({ start: bboxStartRef.current, end });
    }
  }
  function onWheel(e) {
    e.preventDefault();
    setZoom(function (z) { return Math.max(4, Math.min(18, z + (e.deltaY > 0 ? -1 : 1))); });
  }

  // ── Touch events ───────────────────────────────────────────────────────
  function onTouchStart(e) {
    if (e.touches.length === 2) {
      // pinch zoom start
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      touchRef.current = { dist: Math.sqrt(dx*dx + dy*dy), zoom: zoomRef.current };
      dragRef.current = null;
      return;
    }
    if (mode === "pan") {
      dragRef.current = { sx: e.touches[0].clientX, sy: e.touches[0].clientY, clat: centerRef.current.lat, clon: centerRef.current.lon };
    } else {
      var ll = getPos(e, true);
      bboxStartRef.current = ll; setBboxStart(ll); setBboxEnd(ll); setBbox(null);
      drawingRef.current = true;
    }
  }
  function onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 2 && touchRef.current) {
      var dx = e.touches[0].clientX - e.touches[1].clientX;
      var dy = e.touches[0].clientY - e.touches[1].clientY;
      var dist = Math.sqrt(dx*dx + dy*dy);
      var ratio = dist / touchRef.current.dist;
      var newZoom = Math.max(4, Math.min(18, Math.round(touchRef.current.zoom + Math.log2(ratio))));
      setZoom(newZoom);
      return;
    }
    if (mode === "pan" && dragRef.current) {
      var d = dragRef.current;
      var scale = Math.pow(2, zoomRef.current), ws = TILE_SIZE * scale;
      var rect = canvasRef.current.getBoundingClientRect();
      var sx = W / rect.width, sy2 = H / rect.height;
      setCenter({
        lat: Math.max(-85, Math.min(85, d.clat + ((e.touches[0].clientY - d.sy) * sy2 / ws) * 180)),
        lon: d.clon + (-(e.touches[0].clientX - d.sx) * sx / ws) * 360,
      });
    } else if (mode === "bbox" && drawingRef.current) {
      setBboxEnd(getPos(e, true));
    }
  }
  function onTouchEnd(e) {
    touchRef.current = null;
    if (mode === "pan") { dragRef.current = null; }
    else if (drawingRef.current && e.changedTouches.length > 0) {
      var rect = canvasRef.current.getBoundingClientRect();
      var sx = W / rect.width, sy2 = H / rect.height;
      var t = e.changedTouches[0];
      var end = pixelToLatLon(
        (t.clientX - rect.left) * sx, (t.clientY - rect.top) * sy2,
        centerRef.current.lat, centerRef.current.lon, zoomRef.current, W, H
      );
      setBboxEnd(end); drawingRef.current = false;
      if (bboxStartRef.current) setBbox({ start: bboxStartRef.current, end });
    }
  }

  function clearBbox() { setBbox(null); setBboxStart(null); setBboxEnd(null); bboxStartRef.current = null; }

  var bboxInfo = bbox ? {
    minLat: Math.min(bbox.start.lat, bbox.end.lat),
    maxLat: Math.max(bbox.start.lat, bbox.end.lat),
    minLon: Math.min(bbox.start.lon, bbox.end.lon),
    maxLon: Math.max(bbox.start.lon, bbox.end.lon),
  } : null;

  // ── Styles ─────────────────────────────────────────────────────────────
  var btnBase = { border: "none", borderRadius: 6, cursor: "pointer", fontWeight: "bold", fontFamily: "sans-serif" };
  var toolBtn = function(active) {
    return Object.assign({}, btnBase, {
      background: active ? "#f0c040" : "#1e1e3a",
      color: active ? "#000" : "#aaa",
      padding: isMobile ? "10px 12px" : "7px 14px",
      fontSize: isMobile ? 13 : 12,
      border: "1px solid " + (active ? "#f0c040" : "#3a3a6a"),
    });
  };

  var places = [
    { label: "All Nigeria", lat: 9.082, lon: 8.675, z: 6 },
    { label: "Lagos", lat: 6.524, lon: 3.379, z: 11 },
    { label: "Abuja", lat: 9.072, lon: 7.492, z: 11 },
    { label: "Port Harcourt", lat: 4.815, lon: 7.049, z: 11 },
    { label: "Calabar", lat: 4.958, lon: 8.327, z: 11 },
    { label: "Akwa Ibom", lat: 5.007, lon: 7.849, z: 10 },
    { label: "Enugu", lat: 6.441, lon: 7.499, z: 11 },
    { label: "Jos Plateau", lat: 9.896, lon: 8.858, z: 10 },
  ];

  return (
    <div style={{ background: "#0d0d1f", height: "100vh", fontFamily: "sans-serif", color: "#eee", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* ── Header ── */}
      <div style={{ background: "#12122e", borderBottom: "1px solid #2a2a5a", padding: isMobile ? "8px 12px" : "8px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: isMobile ? 28 : 34, height: isMobile ? 28 : 34, background: "#f0c040", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: isMobile ? 16 : 20 }}>🗺</div>
          <div>
            <div style={{ fontWeight: "bold", fontSize: isMobile ? 13 : 16, color: "#f0c040" }}>Geo Mapping System</div>
            {!isMobile && <div style={{ fontSize: 10, color: "#555" }}>Nigeria Geological Survey Platform — v0.1</div>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {!isMobile && (
            <div style={{ background: "#1a3a1a", border: "1px solid #27ae60", borderRadius: 12, padding: "3px 10px", fontSize: 10, color: "#27ae60" }}>● Live</div>
          )}
          <div style={{ background: "#1a1a3a", border: "1px solid #3a3a6a", borderRadius: 12, padding: "3px 10px", fontSize: 10, color: "#888" }}>z{zoom}</div>
          {isMobile && (
            <button onClick={function () { setSidebarOpen(function (o) { return !o; }); }}
              style={Object.assign({}, btnBase, { background: sidebarOpen ? "#f0c040" : "#1e1e3a", color: sidebarOpen ? "#000" : "#fff", padding: "8px 12px", fontSize: 16, border: "1px solid #3a3a6a" })}>
              {sidebarOpen ? "✕" : "☰"}
            </button>
          )}
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div style={{ background: "#0f0f28", borderBottom: "1px solid #2a2a5a", padding: isMobile ? "6px 10px" : "6px 18px", display: "flex", gap: 6, alignItems: "center", flexShrink: 0, flexWrap: "wrap" }}>
        <button onClick={function () { setMode("pan"); }} style={toolBtn(mode === "pan")}>✋ {isMobile ? "Pan" : "Pan & Zoom"}</button>
        <button onClick={function () { setMode("bbox"); }} style={toolBtn(mode === "bbox")}>⬜ {isMobile ? "Study Area" : "Draw Study Area"}</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
          <button onClick={function () { setZoom(function (z) { return Math.min(18, z + 1); }); }}
            style={Object.assign({}, btnBase, { background: "#1e1e3a", color: "#fff", padding: isMobile ? "10px 16px" : "7px 13px", fontSize: isMobile ? 18 : 14, border: "1px solid #3a3a6a" })}>+</button>
          <button onClick={function () { setZoom(function (z) { return Math.max(4, z - 1); }); }}
            style={Object.assign({}, btnBase, { background: "#1e1e3a", color: "#fff", padding: isMobile ? "10px 16px" : "7px 13px", fontSize: isMobile ? 18 : 14, border: "1px solid #3a3a6a" })}>−</button>
          <button onClick={function () { setCenter({ lat: NIGERIA_CENTER[0], lon: NIGERIA_CENTER[1] }); setZoom(NIGERIA_ZOOM); clearBbox(); }}
            style={Object.assign({}, btnBase, { background: "#1e1e3a", color: "#aaa", padding: isMobile ? "10px 10px" : "7px 12px", fontSize: isMobile ? 12 : 11, border: "1px solid #3a3a6a" })}>
            🇳🇬 {isMobile ? "" : "Reset"}
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", position: "relative" }}>

        {/* Map canvas */}
        <div ref={containerRef} style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <canvas ref={canvasRef} width={W} height={H}
            onMouseDown={onMouseDown} onMouseMove={onMouseMove}
            onMouseUp={onMouseUp} onMouseLeave={function () { dragRef.current = null; drawingRef.current = false; }}
            onWheel={onWheel}
            onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
            style={{ display: "block", width: "100%", height: "100%", cursor: mode === "pan" ? "grab" : "crosshair", touchAction: "none" }}
          />
          {mode === "bbox" && !bbox && (
            <div style={{ position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", background: "rgba(240,192,64,0.93)", color: "#000", borderRadius: 8, padding: isMobile ? "8px 14px" : "7px 16px", fontSize: isMobile ? 13 : 12, fontWeight: "bold", pointerEvents: "none", whiteSpace: "nowrap" }}>
              {isMobile ? "Drag to draw study area" : "Click and drag to draw your study area"}
            </div>
          )}
        </div>

        {/* Sidebar — slide in on mobile, always visible on desktop */}
        <div style={{
          width: isMobile ? "100%" : 270,
          maxWidth: isMobile ? 340 : "none",
          background: "#0a0a1e",
          borderLeft: isMobile ? "none" : "1px solid #2a2a5a",
          borderTop: isMobile ? "1px solid #2a2a5a" : "none",
          padding: 14,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          flexShrink: 0,
          position: isMobile ? "absolute" : "relative",
          right: isMobile ? 0 : "auto",
          top: isMobile ? 0 : "auto",
          bottom: isMobile ? 0 : "auto",
          zIndex: isMobile ? 100 : "auto",
          transform: isMobile ? (sidebarOpen ? "translateX(0)" : "translateX(100%)") : "none",
          transition: "transform 0.25s ease",
          boxShadow: isMobile && sidebarOpen ? "-4px 0 20px rgba(0,0,0,0.5)" : "none",
        }}>

          {/* Status */}
          <div style={{ background: "#12122e", border: "1px solid #2a2a5a", borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 11, color: "#f0c040", fontWeight: "bold", marginBottom: 8 }}>SEQUENCE 1 — BASE MAP</div>
            {[
              ["OpenStreetMap tiles", true],
              ["Nigeria centered", true],
              ["Pan and zoom", true],
              ["Touch & pinch zoom", true],
              ["DMS coordinate grid", true],
              ["North arrow + scale bar", true],
              ["Mobile responsive", true],
              ["Study area confirmed", !!bbox],
            ].map(function (item, i) {
              return (
                <div key={i} style={{ display: "flex", gap: 8, fontSize: 11, marginBottom: 4 }}>
                  <span style={{ color: item[1] ? "#27ae60" : "#444" }}>{item[1] ? "✓" : "○"}</span>
                  <span style={{ color: item[1] ? "#8fbb8f" : "#555" }}>{item[0]}</span>
                </div>
              );
            })}
          </div>

          {/* Bbox */}
          <div style={{ background: "#12122e", border: "1px solid " + (bbox ? "#f0c040" : "#2a2a5a"), borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 11, color: "#f0c040", fontWeight: "bold", marginBottom: 8 }}>STUDY AREA BOUNDARY</div>
            {!bbox ? (
              <div style={{ fontSize: 11, color: "#555", lineHeight: 1.7 }}>
                No boundary defined.<br />
                Tap <strong style={{ color: "#f0c040" }}>Study Area</strong> mode then drag on the map.
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
                  style={Object.assign({}, btnBase, { width: "100%", marginTop: 8, background: "#3a1a1a", color: "#e74c3c", border: "1px solid #e74c3c", padding: "8px" })}>
                  Clear Boundary
                </button>
                <button style={Object.assign({}, btnBase, { width: "100%", marginTop: 6, background: "#1a3a1a", color: "#27ae60", border: "1px solid #27ae60", padding: "8px" })}>
                  Confirm — Go to Step 2 →
                </button>
              </div>
            )}
          </div>

          {/* Quick nav */}
          <div style={{ background: "#12122e", border: "1px solid #2a2a5a", borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 11, color: "#f0c040", fontWeight: "bold", marginBottom: 8 }}>QUICK NAVIGATE</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr", gap: 4 }}>
              {places.map(function (place, i) {
                return (
                  <button key={i}
                    onClick={function () { setCenter({ lat: place.lat, lon: place.lon }); setZoom(place.z); if (isMobile) setSidebarOpen(false); }}
                    style={Object.assign({}, btnBase, { textAlign: "left", background: "#1a1a2e", color: "#aaa", border: "1px solid #2a2a4a", padding: "8px 10px", fontSize: 11, fontWeight: "normal" })}>
                    📍 {place.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Next */}
          <div style={{ background: "#0f0f1e", border: "1px dashed #2a2a4a", borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 11, color: "#444", fontWeight: "bold", marginBottom: 4 }}>NEXT: SEQUENCE 2</div>
            <div style={{ fontSize: 10, color: "#333", lineHeight: 1.6 }}>Click-to-draw tools for towns, roads, rivers, samples, and geology polygons.</div>
          </div>

        </div>
      </div>

      {/* Footer */}
      <div style={{ background: "#0a0a1e", borderTop: "1px solid #2a2a5a", padding: "4px 14px", display: "flex", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: "#333" }}>Geo Mapping System v0.1</span>
        <span style={{ fontSize: 9, color: "#333" }}>Nigeria · WGS84 · OpenStreetMap</span>
      </div>
    </div>
  );
}