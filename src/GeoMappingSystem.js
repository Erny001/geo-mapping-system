import { useState, useEffect, useRef, useCallback } from "react";

const NIGERIA_CENTER = [9.082, 8.6753];
const NIGERIA_ZOOM = 6;
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_SIZE = 256;
const ROCK_COLORS = {
  Shale: "#6b6b2a", Limestone: "#00bcd4", Sandstone: "#e8e04a",
  Clay: "#9c27b0", Siltstone: "#f4a460", Marl: "#b8860b", Gravel: "#a0a0a0",
};

var tileCache = {};

function lon2tile(lon,z){return Math.floor(((lon+180)/360)*Math.pow(2,z));}
function lat2tile(lat,z){return Math.floor(((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2)*Math.pow(2,z));}
function tile2lon(x,z){return x/Math.pow(2,z)*360-180;}
function tile2lat(y,z){var n=Math.PI-2*Math.PI*y/Math.pow(2,z);return 180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n)));}
function ll2px(lat,lon,clat,clon,z,W,H){
  var ws=TILE_SIZE*Math.pow(2,z);
  function ly(la){var s=Math.sin(la*Math.PI/180);return ws/(2*Math.PI)*(Math.PI-Math.log((1+s)/(1-s))/2);}
  function lx(lo){return ws*(lo+180)/360;}
  return {x:W/2+(lx(lon)-lx(clon)),y:H/2+(ly(lat)-ly(clat))};
}
function px2ll(px,py,clat,clon,z,W,H){
  var ws=TILE_SIZE*Math.pow(2,z);
  function ly(la){var s=Math.sin(la*Math.PI/180);return ws/(2*Math.PI)*(Math.PI-Math.log((1+s)/(1-s))/2);}
  function lx(lo){return ws*(lo+180)/360;}
  var wx=lx(clon)+(px-W/2),wy=ly(clat)+(py-H/2);
  var n=Math.PI-2*Math.PI*wy/ws;
  return {lat:180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))),lon:wx/ws*360-180};
}
function toDMS(deg,isLat){
  var d=Math.abs(deg),dd=Math.floor(d),mm=Math.floor((d-dd)*60),ss=Math.round(((d-dd)*60-mm)*60);
  return dd+"\u00b0"+mm+"'"+ss+'"'+(isLat?(deg>=0?"N":"S"):(deg>=0?"E":"W"));
}
function toDMSval(deg,isLat){
  var d=Math.abs(deg),dd=Math.floor(d),mm=Math.floor((d-dd)*60),ss=((d-dd)*60-mm)*60;
  var dir=isLat?(deg>=0?"N":"S"):(deg>=0?"E":"W");
  return {d:dd,m:mm,s:parseFloat(ss.toFixed(1)),dir:dir};
}
function loadTile(z,x,y,cb){
  var k=z+"/"+x+"/"+y;
  if(tileCache[k]){cb(tileCache[k]);return;}
  var img=new Image();img.crossOrigin="anonymous";
  img.onload=function(){tileCache[k]=img;cb(img);};
  img.onerror=function(){cb(null);};
  img.src=TILE_URL.replace("{z}",z).replace("{x}",x).replace("{y}",y);
}
function dist(p1,p2){return Math.sqrt(Math.pow(p1.x-p2.x,2)+Math.pow(p1.y-p2.y,2));}

// ── SMOOTH CURVE HELPER ───────────────────────────────────────────────────
function drawSmooth(ctx, pts) {
  if(pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if(pts.length === 2) {
    ctx.lineTo(pts[1].x, pts[1].y);
  } else {
    for(var i = 0; i < pts.length - 1; i++) {
      var mx = (pts[i].x + pts[i+1].x) / 2;
      var my = (pts[i].y + pts[i+1].y) / 2;
      if(i === 0) ctx.lineTo(mx, my);
      else ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length-1].x, pts[pts.length-1].y);
  }
}

// ── PARSE COORDINATE INPUT ─────────────────────────────────────────────────
// Accepts: "5.5033" or "5°30'12\"N" or "5 30 12 N"
function parseCoord(str, isLat) {
  if(!str||!str.trim())return null;
  str=str.trim();
  // Decimal
  var dec=parseFloat(str);
  if(!isNaN(dec)&&str.match(/^-?[\d.]+$/))return dec;
  // DMS with symbols or spaces: 5°30'12"N or 5 30 12 N or 5d30m12sN
  var m=str.replace(/[°d]/g," ").replace(/['m]/g," ").replace(/["s]/g," ").replace(/[NSEW]/gi," $& ").trim().split(/\s+/);
  var nums=[],dir=null;
  m.forEach(function(p){
    if(p.match(/^[NSEWnsew]$/))dir=p.toUpperCase();
    else if(!isNaN(parseFloat(p)))nums.push(parseFloat(p));
  });
  if(nums.length===0)return null;
  var dd=nums[0]||0, mm2=nums[1]||0, ss=nums[2]||0;
  var val=dd+mm2/60+ss/3600;
  if(dir==="S"||dir==="W")val=-val;
  return isNaN(val)?null:val;
}

function formatDMS(deg,isLat){
  var v=toDMSval(deg,isLat);
  return v.d+"\u00b0"+v.m+"'"+v.s+'"'+v.dir;
}

// ── COORDINATE INPUT WIDGET ────────────────────────────────────────────────
function CoordInput({onPlace, label}) {
  var [fmt, setFmt] = useState("dec");
  var [latStr, setLatStr] = useState("");
  var [lonStr, setLonStr] = useState("");
  var [err, setErr] = useState("");

  function handle() {
    var lat=parseCoord(latStr, true);
    var lon=parseCoord(lonStr, false);
    if(lat===null||lon===null){setErr("Invalid coordinates. Try: 5.503 or 5°30'12\"N");return;}
    if(lat<-90||lat>90||lon<-180||lon>180){setErr("Out of range.");return;}
    setErr("");
    onPlace({lat,lon});
    setLatStr(""); setLonStr("");
  }

  var ph = fmt==="dec"
    ? {lat:"e.g. 5.5033", lon:"e.g. 7.7591"}
    : {lat:'e.g. 5°30\'12"N', lon:'e.g. 7°45\'33"E'};

  return (
    <div style={{background:"#0d1a2a",border:"1px solid #2a4a6a",borderRadius:7,padding:9,marginTop:6}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
        <span style={{fontSize:10,color:"#4a9adf",fontWeight:"bold"}}>📍 {label||"Enter Coordinates"}</span>
        <div style={{display:"flex",gap:3}}>
          {["dec","dms"].map(function(f){
            return <button key={f} onClick={function(){setFmt(f);setLatStr("");setLonStr("");setErr("");}}
              style={{border:"none",borderRadius:3,padding:"2px 7px",fontSize:9,cursor:"pointer",
                background:fmt===f?"#f0c040":"#1a2a3a",color:fmt===f?"#000":"#888",fontWeight:"bold"}}>
              {f==="dec"?"Dec":"DMS"}
            </button>;
          })}
        </div>
      </div>
      <div style={{display:"flex",gap:4,marginBottom:4}}>
        <div style={{flex:1}}>
          <div style={{fontSize:9,color:"#666",marginBottom:2}}>Latitude</div>
          <input value={latStr} onChange={function(e){setLatStr(e.target.value);setErr("");}}
            onKeyDown={function(e){if(e.key==="Enter")handle();}}
            placeholder={ph.lat}
            style={{width:"100%",background:"#1e2e3e",color:"#fff",border:"1px solid #3a5a7a",borderRadius:4,padding:"5px 6px",fontSize:10,boxSizing:"border-box"}}/>
        </div>
        <div style={{flex:1}}>
          <div style={{fontSize:9,color:"#666",marginBottom:2}}>Longitude</div>
          <input value={lonStr} onChange={function(e){setLonStr(e.target.value);setErr("");}}
            onKeyDown={function(e){if(e.key==="Enter")handle();}}
            placeholder={ph.lon}
            style={{width:"100%",background:"#1e2e3e",color:"#fff",border:"1px solid #3a5a7a",borderRadius:4,padding:"5px 6px",fontSize:10,boxSizing:"border-box"}}/>
        </div>
      </div>
      {err&&<div style={{fontSize:9,color:"#e74c3c",marginBottom:4}}>{err}</div>}
      <button onClick={handle}
        style={{width:"100%",background:"#1a4a2a",color:"#27ae60",border:"1px solid #27ae60",borderRadius:4,padding:"5px",fontSize:10,cursor:"pointer",fontWeight:"bold"}}>
        ✓ Place on Map &amp; Pan
      </button>
    </div>
  );
}

// ── MAP OUTPUT RENDERER ────────────────────────────────────────────────────
function renderMap(type, data, projectName, exportDPI) {
  exportDPI = exportDPI || 300;
  const W = 1123, H = 1587;
  const MARGIN = { top: 70, left: 60, right: 60, bottom: 220 };
  const MAP_W = W - MARGIN.left - MARGIN.right;
  const MAP_H = H - MARGIN.top - MARGIN.bottom;
  const { towns, roads, rivers, samples, geoZones, center, zoom } = data;

  var html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>${type==="map2"?"MAP 2":"MAP 3"} | ${projectName}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"><\/script>
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{background:#e8e8e8;font-family:"Times New Roman",serif;}
  .page{width:${W}px;margin:20px auto;background:#fff;box-shadow:0 4px 24px rgba(0,0,0,0.18);}
  canvas{display:block;}
  .controls{width:${W}px;margin:0 auto;padding:12px;background:#f5f5f5;border:1px solid #ccc;display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
  .controls button{background:#2c5f8a;color:#fff;border:none;padding:8px 18px;border-radius:5px;font-weight:bold;cursor:pointer;font-size:13px;font-family:sans-serif;}
  .controls button:hover{background:#1a4a70;}
  .dpi-badge{background:#e8f4e8;border:1px solid #4a8a4a;border-radius:4px;padding:4px 10px;font-size:12px;color:#2a6a2a;font-family:sans-serif;font-weight:bold;}
  @media print{body{background:#fff;}.controls{display:none;}.page{margin:0;box-shadow:none;}@page{size:A3 portrait;margin:0;}}
</style>
</head>
<body>
<div class="controls">
  <button onclick="download300PNG()">⬇ PNG ${exportDPI}dpi</button>
  <button onclick="downloadPDF()">⬇ PDF A3</button>
  <button onclick="window.print()">🖨 Print</button>
  <span class="dpi-badge">Quality: ${exportDPI} dpi</span>
  <span>PDF = A3 portrait · Print: margins to None</span>
</div>
<div class="page"><canvas id="mapCanvas" width="${W}" height="${H}"></canvas></div>
<script>
var W=${W},H=${H},MARGIN={top:${MARGIN.top},left:${MARGIN.left},right:${MARGIN.right},bottom:${MARGIN.bottom}};
var MAP_W=${MAP_W},MAP_H=${MAP_H},center=${JSON.stringify(center)},zoom=${zoom};
var towns=${JSON.stringify(towns)},roads=${JSON.stringify(roads)},rivers=${JSON.stringify(rivers)};
var samples=${JSON.stringify(samples)},geoZones=${JSON.stringify(geoZones)};
var ROCK_COLORS=${JSON.stringify(ROCK_COLORS)},projectName=${JSON.stringify(projectName)},mapType=${JSON.stringify(type)};
var exportDPI=${exportDPI},SCREEN_DPI=96,TILE_SIZE=256,tileCache={};
var canvas=document.getElementById("mapCanvas"),ctx=canvas.getContext("2d");
function lon2tile(lon,z){return Math.floor(((lon+180)/360)*Math.pow(2,z));}
function lat2tile(lat,z){return Math.floor(((1-Math.log(Math.tan(lat*Math.PI/180)+1/Math.cos(lat*Math.PI/180))/Math.PI)/2)*Math.pow(2,z));}
function tile2lon(x,z){return x/Math.pow(2,z)*360-180;}
function tile2lat(y,z){var n=Math.PI-2*Math.PI*y/Math.pow(2,z);return 180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n)));}
function ll2px(lat,lon){var ws=TILE_SIZE*Math.pow(2,zoom);function ly(la){var s=Math.sin(la*Math.PI/180);return ws/(2*Math.PI)*(Math.PI-Math.log((1+s)/(1-s))/2);}function lx(lo){return ws*(lo+180)/360;}return{x:MAP_W/2+(lx(lon)-lx(center.lon))+MARGIN.left,y:MAP_H/2+(ly(lat)-ly(center.lat))+MARGIN.top};}
function px2ll(px,py){var ws=TILE_SIZE*Math.pow(2,zoom);function ly(la){var s=Math.sin(la*Math.PI/180);return ws/(2*Math.PI)*(Math.PI-Math.log((1+s)/(1-s))/2);}function lx(lo){return ws*(lo+180)/360;}var wx=lx(center.lon)+(px-MARGIN.left-MAP_W/2),wy=ly(center.lat)+(py-MARGIN.top-MAP_H/2);var n=Math.PI-2*Math.PI*wy/ws;return{lat:180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))),lon:wx/ws*360-180};}
function toDMS(deg,isLat){var d=Math.abs(deg),dd=Math.floor(d),mm=Math.floor((d-dd)*60),ss=Math.round(((d-dd)*60-mm)*60);return dd+"\u00b0"+mm+"'"+ss+'"'+(isLat?(deg>=0?"N":"S"):(deg>=0?"E":"W"));}
function loadTile(z,x,y,cb){var k=z+"/"+x+"/"+y;if(tileCache[k]){cb(tileCache[k]);return;}var img=new Image();img.crossOrigin="anonymous";img.onload=function(){tileCache[k]=img;cb(img);};img.onerror=function(){cb(null);};img.src="https://tile.openstreetmap.org/"+z+"/"+x+"/"+y+".png";}
function drawAll(){
  ctx.clearRect(0,0,W,H);ctx.fillStyle="#fff";ctx.fillRect(0,0,W,H);
  ctx.strokeStyle="#000";ctx.lineWidth=3;ctx.strokeRect(2,2,W-4,H-4);
  ctx.strokeStyle="#000";ctx.lineWidth=1;ctx.strokeRect(8,8,W-16,H-16);
  ctx.strokeStyle="#000";ctx.lineWidth=1.5;ctx.strokeRect(MARGIN.left,MARGIN.top,MAP_W,MAP_H);
  ctx.save();ctx.beginPath();ctx.rect(MARGIN.left,MARGIN.top,MAP_W,MAP_H);ctx.clip();
  var cx2=lon2tile(center.lon,zoom),cy2=lat2tile(center.lat,zoom),range=Math.ceil(Math.max(MAP_W,MAP_H)/TILE_SIZE/2)+2;
  for(var tx=cx2-range;tx<=cx2+range;tx++){for(var ty=cy2-range;ty<=cy2+range;ty++){var max=Math.pow(2,zoom);if(ty<0||ty>=max)continue;var ox=tx,rx=((tx%max)+max)%max,img=tileCache[zoom+"/"+rx+"/"+ty],pt=ll2px(tile2lat(ty,zoom),tile2lon(ox,zoom));if(img){ctx.globalAlpha=mapType==="map3"?0.35:0.65;ctx.drawImage(img,Math.round(pt.x),Math.round(pt.y),TILE_SIZE,TILE_SIZE);ctx.globalAlpha=1;}else{ctx.fillStyle="#f5f5f5";ctx.fillRect(Math.round(pt.x),Math.round(pt.y),TILE_SIZE,TILE_SIZE);}}}
  if(mapType==="map3"){geoZones.forEach(function(z){if(z.points.length<3)return;ctx.beginPath();z.points.forEach(function(pt,i){var pp=ll2px(pt.lat,pt.lon);if(i===0)ctx.moveTo(pp.x,pp.y);else ctx.lineTo(pp.x,pp.y);});ctx.closePath();ctx.globalAlpha=0.7;ctx.fillStyle=ROCK_COLORS[z.rock]||"#ccc";ctx.fill();ctx.globalAlpha=1;ctx.strokeStyle="#333";ctx.lineWidth=1.5;ctx.stroke();var cx3=z.points.reduce(function(s,pt){return s+pt.lon;},0)/z.points.length,cy3=z.points.reduce(function(s,pt){return s+pt.lat;},0)/z.points.length,cp=ll2px(cy3,cx3);ctx.fillStyle="#000";ctx.font="bold 8px Times New Roman";ctx.textAlign="center";ctx.fillText(z.rock,cp.x,cp.y);ctx.textAlign="left";});}
  roads.forEach(function(road){if(road.points.length<2)return;ctx.beginPath();road.points.forEach(function(pt,i){var pp=ll2px(pt.lat,pt.lon);if(i===0)ctx.moveTo(pp.x,pp.y);else ctx.lineTo(pp.x,pp.y);});if(road.type==="major"){ctx.strokeStyle="#c0392b";ctx.lineWidth=3;ctx.stroke();ctx.strokeStyle="#e07030";ctx.lineWidth=1.5;ctx.stroke();}else{ctx.strokeStyle="#888";ctx.lineWidth=1.2;ctx.stroke();}});
  rivers.forEach(function(river){if(river.points.length<2)return;ctx.beginPath();river.points.forEach(function(pt,i){var pp=ll2px(pt.lat,pt.lon);if(i===0)ctx.moveTo(pp.x,pp.y);else ctx.lineTo(pp.x,pp.y);});ctx.strokeStyle="#2471a3";ctx.lineWidth=1.8;ctx.stroke();});
  towns.forEach(function(town){var pp=ll2px(town.lat,town.lon);ctx.fillStyle="#000";ctx.beginPath();ctx.arc(pp.x,pp.y,4,0,Math.PI*2);ctx.fill();ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(pp.x,pp.y,2.5,0,Math.PI*2);ctx.fill();ctx.fillStyle="#000";ctx.font="bold 8px Times New Roman";ctx.fillText(town.name||"Town",pp.x+5,pp.y-3);});
  samples.forEach(function(s){var pp=ll2px(s.lat,s.lon),sz=mapType==="map2"?8:5;ctx.fillStyle="#c0392b";ctx.beginPath();ctx.moveTo(pp.x,pp.y-sz);ctx.lineTo(pp.x+sz*0.75,pp.y+sz*0.5);ctx.lineTo(pp.x-sz*0.75,pp.y+sz*0.5);ctx.closePath();ctx.fill();ctx.strokeStyle="#7b241c";ctx.lineWidth=0.5;ctx.stroke();if(mapType==="map2"){ctx.fillStyle="#000";ctx.font="7px Times New Roman";ctx.fillText(s.id,pp.x+sz+1,pp.y+2);}});
  ctx.restore();
  ctx.save();ctx.strokeStyle="rgba(0,0,0,0.3)";ctx.lineWidth=0.5;ctx.setLineDash([3,3]);ctx.font="8px Times New Roman";ctx.fillStyle="#000";
  var step=zoom<=6?5:zoom<=8?2:zoom<=10?1:0.5,tl=px2ll(MARGIN.left,MARGIN.top),br=px2ll(MARGIN.left+MAP_W,MARGIN.top+MAP_H);
  for(var lo=Math.ceil(tl.lon/step)*step;lo<=br.lon;lo+=step){var ppx=ll2px(center.lat,lo).x;if(ppx<MARGIN.left||ppx>MARGIN.left+MAP_W)continue;ctx.beginPath();ctx.moveTo(ppx,MARGIN.top);ctx.lineTo(ppx,MARGIN.top+MAP_H);ctx.stroke();ctx.fillText(toDMS(lo,false),ppx-14,MARGIN.top+MAP_H+12);ctx.fillText(toDMS(lo,false),ppx-14,MARGIN.top-4);}
  for(var la=Math.floor(tl.lat/step)*step;la>=br.lat;la-=step){var ppy=ll2px(la,center.lon).y;if(ppy<MARGIN.top||ppy>MARGIN.top+MAP_H)continue;ctx.beginPath();ctx.moveTo(MARGIN.left,ppy);ctx.lineTo(MARGIN.left+MAP_W,ppy);ctx.stroke();ctx.save();ctx.translate(MARGIN.left-4,ppy+14);ctx.rotate(-Math.PI/2);ctx.fillText(toDMS(la,true),0,0);ctx.restore();ctx.save();ctx.translate(MARGIN.left+MAP_W+12,ppy+14);ctx.rotate(-Math.PI/2);ctx.fillText(toDMS(la,true),0,0);ctx.restore();}
  ctx.setLineDash([]);ctx.restore();
  ctx.save();ctx.font="bold 16px Times New Roman";ctx.fillStyle="#000";ctx.textAlign="center";ctx.fillText(mapType==="map2"?"MAP 2: SAMPLE LOCATION MAP":"MAP 3: GEOLOGIC MAP",MARGIN.left+MAP_W/2,MARGIN.top-30);ctx.font="11px Times New Roman";ctx.fillText("OF "+(projectName||"STUDY AREA").toUpperCase(),MARGIN.left+MAP_W/2,MARGIN.top-14);ctx.textAlign="left";ctx.restore();
  var BY=MARGIN.top+MAP_H+10;ctx.save();ctx.strokeStyle="#000";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(MARGIN.left,BY);ctx.lineTo(W-MARGIN.right,BY);ctx.stroke();ctx.restore();
  var ax=MARGIN.left+60,ay=BY+60;ctx.save();ctx.fillStyle="#fff";ctx.strokeStyle="#000";ctx.lineWidth=1.2;ctx.beginPath();ctx.arc(ax,ay,28,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle="#000";ctx.beginPath();ctx.moveTo(ax,ay-22);ctx.lineTo(ax-9,ay+5);ctx.lineTo(ax+9,ay+5);ctx.closePath();ctx.fill();ctx.fillStyle="#fff";ctx.beginPath();ctx.moveTo(ax,ay+22);ctx.lineTo(ax-9,ay-5);ctx.lineTo(ax+9,ay-5);ctx.closePath();ctx.fill();ctx.strokeStyle="#000";ctx.lineWidth=0.8;ctx.beginPath();ctx.moveTo(ax,ay+22);ctx.lineTo(ax-9,ay-5);ctx.lineTo(ax+9,ay-5);ctx.closePath();ctx.stroke();ctx.fillStyle="#000";ctx.font="bold 15px Times New Roman";ctx.textAlign="center";ctx.fillText("N",ax,ay-27);ctx.textAlign="left";ctx.restore();
  var mpp=(156543.03392*Math.cos(center.lat*Math.PI/180))/Math.pow(2,zoom),bm=zoom>=12?500:zoom>=10?2000:zoom>=8?20000:zoom>=6?100000:500000,bp=Math.min(bm/mpp,180),sx=MARGIN.left+20,sy=BY+115;
  ctx.save();ctx.font="bold 10px Times New Roman";ctx.fillStyle="#000";ctx.fillText("SCALE",sx,sy-16);ctx.fillStyle="#000";ctx.fillRect(sx,sy-10,bp/2,10);ctx.fillStyle="#fff";ctx.fillRect(sx+bp/2,sy-10,bp/2,10);ctx.strokeStyle="#000";ctx.lineWidth=1;ctx.strokeRect(sx,sy-10,bp,10);ctx.font="9px Times New Roman";ctx.fillStyle="#000";ctx.fillText("0",sx-2,sy+12);ctx.fillText(bm>=1000?bm/1000+" km":bm+" m",sx+bp-10,sy+12);ctx.restore();
  var lx=MARGIN.left+200,ly2=BY+20;ctx.save();ctx.font="bold 11px Times New Roman";ctx.fillStyle="#000";ctx.fillText("LEGEND",lx,ly2);ly2+=16;ctx.strokeStyle="#000";ctx.lineWidth=0.8;ctx.beginPath();ctx.moveTo(lx,ly2);ctx.lineTo(lx+300,ly2);ctx.stroke();ly2+=12;var col1x=lx,col2x=lx+160,row=ly2;ctx.fillStyle="#000";ctx.beginPath();ctx.arc(col1x+7,row,5,0,Math.PI*2);ctx.fill();ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(col1x+7,row,3,0,Math.PI*2);ctx.fill();ctx.fillStyle="#000";ctx.font="10px Times New Roman";ctx.fillText("Town",col1x+16,row+4);ctx.strokeStyle="#c0392b";ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(col2x,row);ctx.lineTo(col2x+24,row);ctx.stroke();ctx.fillStyle="#000";ctx.font="10px Times New Roman";ctx.fillText("Major Road",col2x+28,row+4);row+=18;ctx.strokeStyle="#888";ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(col1x,row);ctx.lineTo(col1x+24,row);ctx.stroke();ctx.fillStyle="#000";ctx.font="10px Times New Roman";ctx.fillText("Minor Road",col1x+28,row+4);ctx.strokeStyle="#2471a3";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(col2x,row);ctx.lineTo(col2x+24,row);ctx.stroke();ctx.fillStyle="#000";ctx.font="10px Times New Roman";ctx.fillText("River",col2x+28,row+4);row+=18;ctx.fillStyle="#c0392b";ctx.beginPath();ctx.moveTo(col1x+8,row-9);ctx.lineTo(col1x+15,row+4);ctx.lineTo(col1x+1,row+4);ctx.closePath();ctx.fill();ctx.fillStyle="#000";ctx.font="10px Times New Roman";ctx.fillText("Sample Point",col1x+20,row+4);row+=18;
  if(mapType==="map3"){ctx.beginPath();ctx.moveTo(lx,row);ctx.lineTo(lx+300,row);ctx.stroke();row+=12;ctx.font="bold 10px Times New Roman";ctx.fillStyle="#000";ctx.fillText("LITHOLOGY",lx,row);row+=12;var usedRocks={};geoZones.forEach(function(z){usedRocks[z.rock]=true;});var col=0;Object.keys(usedRocks).forEach(function(rock){var rx2=col===0?col1x:col2x,ry=row;ctx.fillStyle=ROCK_COLORS[rock]||"#ccc";ctx.fillRect(rx2,ry-10,14,12);ctx.strokeStyle="#333";ctx.lineWidth=0.5;ctx.strokeRect(rx2,ry-10,14,12);ctx.fillStyle="#000";ctx.font="10px Times New Roman";ctx.fillText(rock,rx2+18,ry);col++;if(col>=2){col=0;row+=16;}});}
  ctx.restore();
  var tbx=W-MARGIN.right-280,tby=BY+10,tbw=260,tbh=H-BY-20;ctx.save();ctx.strokeStyle="#000";ctx.lineWidth=1.2;ctx.strokeRect(tbx,tby,tbw,tbh);ctx.beginPath();ctx.moveTo(tbx,tby+tbh*0.45);ctx.lineTo(tbx+tbw,tby+tbh*0.45);ctx.stroke();ctx.font="bold 11px Times New Roman";ctx.fillStyle="#000";ctx.textAlign="center";ctx.fillText(mapType==="map2"?"MAP 2: SAMPLE LOCATION MAP":"MAP 3: GEOLOGIC MAP",tbx+tbw/2,tby+20);ctx.font="10px Times New Roman";ctx.fillText("OF "+(projectName||"STUDY AREA").toUpperCase(),tbx+tbw/2,tby+36);ctx.font="9px Times New Roman";ctx.fillStyle="#555";ctx.fillText("Projection: WGS84 / Geographic",tbx+tbw/2,tby+tbh*0.45+18);ctx.fillText("Base map: \u00a9 OpenStreetMap contributors",tbx+tbw/2,tby+tbh*0.45+32);ctx.fillText("Generated by Geo Mapping System",tbx+tbw/2,tby+tbh*0.45+46);ctx.textAlign="left";ctx.restore();
}
function init(){var cx2=lon2tile(center.lon,zoom),cy2=lat2tile(center.lat,zoom),range=Math.ceil(Math.max(MAP_W,MAP_H)/TILE_SIZE/2)+2,toLoad=[];for(var tx=cx2-range;tx<=cx2+range;tx++){for(var ty=cy2-range;ty<=cy2+range;ty++){var max=Math.pow(2,zoom);if(ty<0||ty>=max)continue;toLoad.push({z:zoom,x:((tx%max)+max)%max,y:ty});}}if(toLoad.length===0){drawAll();return;}toLoad.forEach(function(t){loadTile(t.z,t.x,t.y,function(){drawAll();});});}
function getFilename(ext){return(mapType==="map2"?"MAP2_":"MAP3_")+(projectName||"geomap").replace(/\s+/g,"_")+"."+ext;}
function download300PNG(){var SCALE=exportDPI/SCREEN_DPI;if(exportDPI>=1200){if(!confirm("1200dpi = ~120MB file. Continue?"))return;}var hiCanvas=document.createElement("canvas");hiCanvas.width=Math.round(W*SCALE);hiCanvas.height=Math.round(H*SCALE);var hiCtx=hiCanvas.getContext("2d");hiCtx.scale(SCALE,SCALE);hiCtx.fillStyle="#fff";hiCtx.fillRect(0,0,W,H);var cx2=lon2tile(center.lon,zoom),cy2=lat2tile(center.lat,zoom),range=Math.ceil(Math.max(MAP_W,MAP_H)/TILE_SIZE/2)+2;for(var tx=cx2-range;tx<=cx2+range;tx++){for(var ty=cy2-range;ty<=cy2+range;ty++){var max=Math.pow(2,zoom);if(ty<0||ty>=max)continue;var ox=tx,rx=((tx%max)+max)%max,img=tileCache[zoom+"/"+rx+"/"+ty],pt=ll2px(tile2lat(ty,zoom),tile2lon(ox,zoom));if(img){hiCtx.globalAlpha=mapType==="map3"?0.35:0.65;hiCtx.drawImage(img,Math.round(pt.x),Math.round(pt.y),TILE_SIZE,TILE_SIZE);hiCtx.globalAlpha=1;}}}hiCtx.drawImage(canvas,0,0,W,H);hiCanvas.toBlob(function(blob){var url=URL.createObjectURL(blob),a=document.createElement("a");a.download=getFilename("png");a.href=url;a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);},"image/png");}
function downloadPDF(){if(!window.jspdf){alert("PDF library loading. Try again in a moment.");return;}var doc=new window.jspdf.jsPDF({orientation:"portrait",unit:"mm",format:"a3"});doc.addImage(canvas.toDataURL("image/png",1.0),"PNG",0,0,297,420);doc.save(getFilename("pdf"));}
window.download300PNG=download300PNG;window.downloadPDF=downloadPDF;
init();
<\/script>
</body>
</html>`;
  return html;
}

// ── MAIN COMPONENT ─────────────────────────────────────────────────────────
const MODES = ["pan","town","road-major","road-minor","river","sample","geology"];
const MODE_LABELS = {pan:"✋ Pan",town:"🏘 Town","road-major":"🟠 Major Road","road-minor":"⬛ Minor Road",river:"🌊 River",sample:"🔺 Sample",geology:"🪨 Geology"};
const MODE_COLORS = {pan:"#2a2a4a",town:"#1a3a5a","road-major":"#5a2a00","road-minor":"#2a2a2a",river:"#003a5a",sample:"#5a1a1a",geology:"#2a1a5a"};
const DPI_OPTIONS = [{dpi:150,label:"150 dpi",desc:"Screen / digital"},{dpi:300,label:"300 dpi",desc:"Thesis standard"},{dpi:600,label:"600 dpi",desc:"NGSA publication"},{dpi:1200,label:"1200 dpi",desc:"Large format print"}];

export default function GeoMappingSystem() {
  var canvasRef=useRef(null), containerRef=useRef(null);
  var [center,setCenter]=useState({lat:NIGERIA_CENTER[0],lon:NIGERIA_CENTER[1]});
  var [zoom,setZoom]=useState(NIGERIA_ZOOM);
  var [mode,setMode]=useState("pan");
  var [tiles,setTiles]=useState([]);
  var [tick,setTick]=useState(0);
  var [size,setSize]=useState({w:800,h:560});
  var [tab,setTab]=useState("draw");
  var [projectName,setProjectName]=useState("");
  var [exportDPI,setExportDPI]=useState(300);
  var [cursorLL,setCursorLL]=useState(null); // live cursor coordinates

  var [towns,setTowns]=useState([]);
  var [roads,setRoads]=useState([]);
  var [rivers,setRivers]=useState([]);
  var [samples,setSamples]=useState([]);
  var [geoZones,setGeoZones]=useState([]);
  var [previewPin,setPreviewPin]=useState(null);
  var [selectedFeature,setSelectedFeature]=useState(null); // {type,id} // typed-coord preview marker

  var [activeRoad,setActiveRoad]=useState(null);
  var [activeRiver,setActiveRiver]=useState(null);
  var [activeGeo,setActiveGeo]=useState(null);
  var [mousePos,setMousePos]=useState(null);

  var [townForm,setTownForm]=useState({name:""});
  var [sampleForm,setSampleForm]=useState({id:"",rock:"Shale",notes:""});
  var [geoRock,setGeoRock]=useState("Shale");

  var dragRef=useRef(null);
  var W=size.w, H=size.h;

  useEffect(function(){
    function upd(){if(containerRef.current){var r=containerRef.current.getBoundingClientRect();setSize({w:Math.floor(r.width)||800,h:Math.floor(r.height)||560});}}
    upd();window.addEventListener("resize",upd);
    return function(){window.removeEventListener("resize",upd);};
  },[]);

  useEffect(function(){
    var cx=lon2tile(center.lon,zoom),cy=lat2tile(center.lat,zoom);
    var range=Math.ceil(Math.max(W,H)/TILE_SIZE/2)+2,next=[];
    for(var x=cx-range;x<=cx+range;x++){for(var y=cy-range;y<=cy+range;y++){var max=Math.pow(2,zoom);if(y<0||y>=max)continue;next.push({z:zoom,x:((x%max)+max)%max,y:y,ox:x});}}
    setTiles(next);
  },[center,zoom,W,H]);

  useEffect(function(){
    tiles.forEach(function(t){loadTile(t.z,t.x,t.y,function(){setTick(function(n){return n+1;});});});
  },[tiles]);

  useEffect(function(){
    var canvas=canvasRef.current;if(!canvas)return;
    var ctx=canvas.getContext("2d");
    ctx.clearRect(0,0,W,H);
    function p(lat,lon){return ll2px(lat,lon,center.lat,center.lon,zoom,W,H);}

    // Tiles
    tiles.forEach(function(t){var img=tileCache[t.z+"/"+t.x+"/"+t.y];var pt=p(tile2lat(t.y,zoom),tile2lon(t.ox,zoom));if(img){ctx.drawImage(img,Math.round(pt.x),Math.round(pt.y),TILE_SIZE,TILE_SIZE);}else{ctx.fillStyle="#e8e8e8";ctx.fillRect(Math.round(pt.x),Math.round(pt.y),TILE_SIZE,TILE_SIZE);}});

    var g=ctx.createRadialGradient(W/2,H/2,H*0.25,W/2,H/2,H*0.75);g.addColorStop(0,"rgba(0,0,0,0)");g.addColorStop(1,"rgba(0,0,0,0.1)");ctx.fillStyle=g;ctx.fillRect(0,0,W,H);

    // Grid
    ctx.save();ctx.strokeStyle="rgba(255,255,255,0.25)";ctx.lineWidth=0.7;ctx.setLineDash([4,4]);ctx.font="9px monospace";ctx.fillStyle="rgba(255,255,255,0.8)";
    var step=zoom<=6?5:zoom<=8?2:zoom<=10?1:0.5;
    var tl=px2ll(0,0,center.lat,center.lon,zoom,W,H),br=px2ll(W,H,center.lat,center.lon,zoom,W,H);
    for(var lo=Math.ceil(tl.lon/step)*step;lo<=br.lon;lo+=step){var px2=p(center.lat,lo).x;ctx.beginPath();ctx.moveTo(px2,0);ctx.lineTo(px2,H);ctx.stroke();ctx.fillText(toDMS(lo,false),px2+2,H-5);}
    for(var la=Math.floor(tl.lat/step)*step;la>=br.lat;la-=step){var py2=p(la,center.lon).y;ctx.beginPath();ctx.moveTo(0,py2);ctx.lineTo(W,py2);ctx.stroke();ctx.fillText(toDMS(la,true),3,py2-3);}
    ctx.setLineDash([]);ctx.restore();

    // Geo zones
    geoZones.forEach(function(z2){if(z2.points.length<2)return;ctx.beginPath();z2.points.forEach(function(pt,i){var pp=p(pt.lat,pt.lon);if(i===0)ctx.moveTo(pp.x,pp.y);else ctx.lineTo(pp.x,pp.y);});if(z2.points.length>2)ctx.closePath();ctx.globalAlpha=0.55;ctx.fillStyle=ROCK_COLORS[z2.rock]||"#aaa";ctx.fill();ctx.globalAlpha=1;ctx.strokeStyle=ROCK_COLORS[z2.rock]||"#aaa";ctx.lineWidth=2;ctx.stroke();if(z2.points.length>2){var cx2=z2.points.reduce(function(s,pt){return s+pt.lon;},0)/z2.points.length,cy2=z2.points.reduce(function(s,pt){return s+pt.lat;},0)/z2.points.length,cp=p(cy2,cx2);ctx.fillStyle="#fff";ctx.font="bold 9px sans-serif";ctx.textAlign="center";ctx.fillText(z2.rock,cp.x,cp.y);ctx.textAlign="left";}});

    // Active geo
    if(activeGeo&&activeGeo.points.length>0){ctx.beginPath();activeGeo.points.forEach(function(pt,i){var pp=p(pt.lat,pt.lon);if(i===0)ctx.moveTo(pp.x,pp.y);else ctx.lineTo(pp.x,pp.y);});if(mousePos){var mp=p(mousePos.lat,mousePos.lon);ctx.lineTo(mp.x,mp.y);}ctx.strokeStyle=ROCK_COLORS[geoRock]||"#aaa";ctx.lineWidth=2;ctx.setLineDash([5,3]);ctx.stroke();ctx.setLineDash([]);activeGeo.points.forEach(function(pt){var pp=p(pt.lat,pt.lon);ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(pp.x,pp.y,4,0,Math.PI*2);ctx.fill();});if(activeGeo.points.length>2){var fp=p(activeGeo.points[0].lat,activeGeo.points[0].lon);ctx.strokeStyle="#27ae60";ctx.lineWidth=2;ctx.beginPath();ctx.arc(fp.x,fp.y,8,0,Math.PI*2);ctx.stroke();}}

    // Roads — smooth curves
    roads.forEach(function(road,ri){
      if(road.points.length<1)return;
      var pts=road.points.map(function(pt){return p(pt.lat,pt.lon);});
      var isSelected=selectedFeature&&selectedFeature.type==="road"&&selectedFeature.id===ri;
      if(isSelected){ctx.shadowColor="#f0c040";ctx.shadowBlur=10;}
      if(road.type==="major"){
        drawSmooth(ctx,pts);
        ctx.strokeStyle=isSelected?"#f0c040":"#c0392b";ctx.lineWidth=4;ctx.stroke();
        drawSmooth(ctx,pts);
        ctx.strokeStyle=isSelected?"#ffe080":"#e07030";ctx.lineWidth=2;ctx.stroke();
      } else {
        drawSmooth(ctx,pts);
        ctx.strokeStyle=isSelected?"#f0c040":"#888";ctx.lineWidth=1.8;ctx.stroke();
      }
      ctx.shadowBlur=0;
      if(road===activeRoad&&mousePos){
        var last=pts[pts.length-1],mp=p(mousePos.lat,mousePos.lon);
        ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(mp.x,mp.y);
        ctx.strokeStyle="#e07030";ctx.lineWidth=1.5;ctx.setLineDash([4,3]);ctx.stroke();ctx.setLineDash([]);
      }
      if(road===activeRoad){pts.forEach(function(pp){ctx.fillStyle=road.type==="major"?"#e07030":"#888";ctx.beginPath();ctx.arc(pp.x,pp.y,3,0,Math.PI*2);ctx.fill();});}
    });

    // Rivers — smooth curves
    rivers.forEach(function(river,ri){
      if(river.points.length<1)return;
      var pts=river.points.map(function(pt){return p(pt.lat,pt.lon);});
      var isSelected=selectedFeature&&selectedFeature.type==="river"&&selectedFeature.id===ri;
      if(isSelected){ctx.shadowColor="#f0c040";ctx.shadowBlur=10;}
      drawSmooth(ctx,pts);
      ctx.strokeStyle=isSelected?"#f0c040":"#2980d9";ctx.lineWidth=isSelected?3:2;ctx.stroke();
      ctx.shadowBlur=0;
      if(river===activeRiver&&mousePos){
        var last=pts[pts.length-1],mp=p(mousePos.lat,mousePos.lon);
        ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(mp.x,mp.y);
        ctx.strokeStyle="#2980d9";ctx.lineWidth=1.5;ctx.setLineDash([4,3]);ctx.stroke();ctx.setLineDash([]);
      }
    });

    // Towns
    towns.forEach(function(town,ti){
      var pp=p(town.lat,town.lon);
      var isSelected=selectedFeature&&selectedFeature.type==="town"&&selectedFeature.id===ti;
      if(isSelected){ctx.shadowColor="#f0c040";ctx.shadowBlur=12;}
      ctx.fillStyle=isSelected?"#f0c040":"#000";ctx.beginPath();ctx.arc(pp.x,pp.y,isSelected?6:4,0,Math.PI*2);ctx.fill();
      ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(pp.x,pp.y,isSelected?4:2.5,0,Math.PI*2);ctx.fill();
      ctx.shadowBlur=0;
      ctx.fillStyle=isSelected?"#f0c040":"#000";ctx.font="bold 9px sans-serif";ctx.fillText(town.name||"Town",pp.x+6,pp.y-3);
    });

    // Samples
    samples.forEach(function(s,si){
      var pp=p(s.lat,s.lon);
      var isSelected=selectedFeature&&selectedFeature.type==="sample"&&selectedFeature.id===si;
      if(isSelected){ctx.shadowColor="#f0c040";ctx.shadowBlur=12;}
      ctx.fillStyle=isSelected?"#f0c040":"#c0392b";
      var sz=isSelected?11:9;
      ctx.beginPath();ctx.moveTo(pp.x,pp.y-sz);ctx.lineTo(pp.x+sz*0.7,pp.y+sz*0.5);ctx.lineTo(pp.x-sz*0.7,pp.y+sz*0.5);ctx.closePath();ctx.fill();
      ctx.shadowBlur=0;
      ctx.fillStyle=isSelected?"#f0c040":"#c0392b";ctx.font="6px sans-serif";ctx.fillText(s.id,pp.x+sz+1,pp.y+2);
    });

    // Preview pin (typed coordinates)
    if(previewPin){
      var pp=p(previewPin.lat,previewPin.lon);
      ctx.save();
      ctx.strokeStyle="#f0c040";ctx.lineWidth=2;
      ctx.beginPath();ctx.arc(pp.x,pp.y,10,0,Math.PI*2);ctx.stroke();
      ctx.beginPath();ctx.moveTo(pp.x-14,pp.y);ctx.lineTo(pp.x+14,pp.y);ctx.stroke();
      ctx.beginPath();ctx.moveTo(pp.x,pp.y-14);ctx.lineTo(pp.x,pp.y+14);ctx.stroke();
      ctx.fillStyle="#f0c040";ctx.font="bold 9px sans-serif";
      ctx.fillText(previewPin.lat.toFixed(5)+", "+previewPin.lon.toFixed(5),pp.x+16,pp.y-4);
      ctx.restore();
    }

    // North arrow
    var ax=W-36,ay=36;ctx.save();ctx.fillStyle="#fff";ctx.beginPath();ctx.arc(ax,ay,18,0,Math.PI*2);ctx.fill();ctx.fillStyle="#c0392b";ctx.beginPath();ctx.moveTo(ax,ay-14);ctx.lineTo(ax-6,ay+3);ctx.lineTo(ax+6,ay+3);ctx.closePath();ctx.fill();ctx.fillStyle="#333";ctx.beginPath();ctx.moveTo(ax,ay+14);ctx.lineTo(ax-6,ay-3);ctx.lineTo(ax+6,ay-3);ctx.closePath();ctx.fill();ctx.fillStyle="#c0392b";ctx.font="bold 10px sans-serif";ctx.textAlign="center";ctx.fillText("N",ax,ay-17);ctx.textAlign="left";ctx.restore();

    // Scale
    var mpp=(156543.03392*Math.cos(center.lat*Math.PI/180))/Math.pow(2,zoom),bm=zoom>=12?500:zoom>=10?2000:zoom>=8?20000:zoom>=6?100000:500000,bp=bm/mpp,sx=10,sy=H-20;
    ctx.save();ctx.fillStyle="rgba(255,255,255,0.88)";ctx.fillRect(sx-3,sy-12,bp+6,18);ctx.fillStyle="#222";ctx.fillRect(sx,sy-6,bp/2,7);ctx.fillStyle="#999";ctx.fillRect(sx+bp/2,sy-6,bp/2,7);ctx.strokeStyle="#222";ctx.lineWidth=1;ctx.strokeRect(sx,sy-6,bp,7);ctx.fillStyle="#222";ctx.font="8px sans-serif";ctx.fillText("0",sx,sy-8);ctx.fillText(bm>=1000?bm/1000+"km":bm+"m",sx+bp-6,sy-8);ctx.restore();

    // Mode indicator
    ctx.save();ctx.fillStyle="rgba(0,0,0,0.55)";ctx.fillRect(8,8,140,22);ctx.fillStyle="#f0c040";ctx.font="bold 11px sans-serif";ctx.fillText("MODE: "+MODE_LABELS[mode],14,23);ctx.restore();

    // Attribution
    ctx.save();ctx.fillStyle="rgba(255,255,255,0.7)";ctx.fillRect(W-185,H-15,185,15);ctx.fillStyle="#666";ctx.font="8px sans-serif";ctx.fillText("\u00a9 OpenStreetMap contributors",W-182,H-4);ctx.restore();

  },[tiles,center,zoom,tick,towns,roads,rivers,samples,geoZones,activeRoad,activeRiver,activeGeo,mousePos,mode,geoRock,W,H,previewPin]);

  function getLL(e){var r=canvasRef.current.getBoundingClientRect();return px2ll((e.clientX-r.left)*(W/r.width),(e.clientY-r.top)*(H/r.height),center.lat,center.lon,zoom,W,H);}

  function handleClick(e){
    var ll=getLL(e);

    // ── SELECT MODE ──
    if(mode==="select"){
      var SNAP=14;
      var cx=ll2px(ll.lat,ll.lon,center.lat,center.lon,zoom,W,H);
      // Check towns
      for(var ti=0;ti<towns.length;ti++){
        var tp=ll2px(towns[ti].lat,towns[ti].lon,center.lat,center.lon,zoom,W,H);
        if(dist(cx,tp)<SNAP){setSelectedFeature({type:"town",id:ti});return;}
      }
      // Check samples
      for(var si=0;si<samples.length;si++){
        var sp=ll2px(samples[si].lat,samples[si].lon,center.lat,center.lon,zoom,W,H);
        if(dist(cx,sp)<SNAP){setSelectedFeature({type:"sample",id:si});return;}
      }
      // Check roads (any node)
      for(var ri=0;ri<roads.length;ri++){
        for(var rj=0;rj<roads[ri].points.length;rj++){
          var rp=ll2px(roads[ri].points[rj].lat,roads[ri].points[rj].lon,center.lat,center.lon,zoom,W,H);
          if(dist(cx,rp)<SNAP){setSelectedFeature({type:"road",id:ri});return;}
        }
      }
      // Check rivers
      for(var rvi=0;rvi<rivers.length;rvi++){
        for(var rvj=0;rvj<rivers[rvi].points.length;rvj++){
          var rvp=ll2px(rivers[rvi].points[rvj].lat,rivers[rvi].points[rvj].lon,center.lat,center.lon,zoom,W,H);
          if(dist(cx,rvp)<SNAP){setSelectedFeature({type:"river",id:rvi});return;}
        }
      }
      // Check geology zones
      for(var gi=0;gi<geoZones.length;gi++){
        for(var gj=0;gj<geoZones[gi].points.length;gj++){
          var gp=ll2px(geoZones[gi].points[gj].lat,geoZones[gi].points[gj].lon,center.lat,center.lon,zoom,W,H);
          if(dist(cx,gp)<SNAP){setSelectedFeature({type:"geology",id:gi});return;}
        }
      }
      setSelectedFeature(null);
      return;
    }

    if(mode==="town"){var name=townForm.name||"Town "+(towns.length+1);setTowns(function(t){return t.concat([{lat:ll.lat,lon:ll.lon,name:name}]);});setTownForm({name:""});}
    else if(mode==="road-major"||mode==="road-minor"){if(!activeRoad){var road={type:mode==="road-major"?"major":"minor",points:[ll]};setRoads(function(r){return r.concat([road]);});setActiveRoad(road);}else{setRoads(function(prev){return prev.map(function(r){if(r===activeRoad){return Object.assign({},r,{points:r.points.concat([ll])});}return r;});});setActiveRoad(function(prev){return prev?Object.assign({},prev,{points:prev.points.concat([ll])}):null;});}}
    else if(mode==="river"){if(!activeRiver){var river={points:[ll]};setRivers(function(r){return r.concat([river]);});setActiveRiver(river);}else{setRivers(function(prev){return prev.map(function(r){if(r===activeRiver){return Object.assign({},r,{points:r.points.concat([ll])});}return r;});});setActiveRiver(function(prev){return prev?Object.assign({},prev,{points:prev.points.concat([ll])}):null;});}}
    else if(mode==="sample"){var id=sampleForm.id||"SAMPLE-"+(samples.length+1);setSamples(function(s){return s.concat([{lat:ll.lat,lon:ll.lon,id:id,rock:sampleForm.rock,notes:sampleForm.notes}]);});setSampleForm(function(f){return Object.assign({},f,{id:"",notes:""});});}
    else if(mode==="geology"){if(!activeGeo){var zone={rock:geoRock,points:[ll]};setActiveGeo(zone);}else{if(activeGeo.points.length>2){var fp2=ll2px(activeGeo.points[0].lat,activeGeo.points[0].lon,center.lat,center.lon,zoom,W,H);var cp2=ll2px(ll.lat,ll.lon,center.lat,center.lon,zoom,W,H);if(dist(fp2,cp2)<16){setGeoZones(function(z){return z.concat([activeGeo]);});setActiveGeo(null);return;}}setActiveGeo(function(prev){return prev?Object.assign({},prev,{points:prev.points.concat([ll])}):null;});}}
  }

  function deleteSelected(){
    if(!selectedFeature)return;
    var t=selectedFeature.type, id=selectedFeature.id;
    if(t==="town")setTowns(function(a){return a.filter(function(_,i){return i!==id;});});
    else if(t==="sample")setSamples(function(a){return a.filter(function(_,i){return i!==id;});});
    else if(t==="road")setRoads(function(a){return a.filter(function(_,i){return i!==id;});});
    else if(t==="river")setRivers(function(a){return a.filter(function(_,i){return i!==id;});});
    else if(t==="geology")setGeoZones(function(a){return a.filter(function(_,i){return i!==id;});});
    setSelectedFeature(null);
  }

  function onMouseDown(e){if(mode==="pan"){dragRef.current={sx:e.clientX,sy:e.clientY,clat:center.lat,clon:center.lon};}}
  function onMouseMove(e){
    var ll=getLL(e);
    setCursorLL(ll);
    if(mode==="pan"&&dragRef.current){var d=dragRef.current,ws=TILE_SIZE*Math.pow(2,zoom),r=canvasRef.current.getBoundingClientRect();setCenter({lat:Math.max(-85,Math.min(85,d.clat+((e.clientY-d.sy)*(H/r.height)/ws)*180)),lon:d.clon+(-(e.clientX-d.sx)*(W/r.width)/ws)*360});}
    else{setMousePos(ll);}
  }
  function onMouseUp(e){if(mode==="pan"){dragRef.current=null;}else{handleClick(e);}}
  function onMouseLeave(){dragRef.current=null;setMousePos(null);setCursorLL(null);}
  function onWheel(e){e.preventDefault();setZoom(function(z){return Math.max(4,Math.min(18,z+(e.deltaY>0?-1:1)));});}

  function finishRoad(){setActiveRoad(null);}
  function finishRiver(){setActiveRiver(null);}
  function finishGeo(){if(activeGeo&&activeGeo.points.length>2){setGeoZones(function(z){return z.concat([activeGeo]);});}setActiveGeo(null);}
  function undoLastNode(){
    if(mode==="road-major"||mode==="road-minor"){if(activeRoad&&activeRoad.points.length>1){setRoads(function(prev){return prev.map(function(r){if(r===activeRoad){var np=r.points.slice(0,-1);var nr=Object.assign({},r,{points:np});setActiveRoad(nr);return nr;}return r;});});}}
    else if(mode==="river"){if(activeRiver&&activeRiver.points.length>1){setRivers(function(prev){return prev.map(function(r){if(r===activeRiver){var np=r.points.slice(0,-1);var nr=Object.assign({},r,{points:np});setActiveRiver(nr);return nr;}return r;});});}}
    else if(mode==="geology"){if(activeGeo&&activeGeo.points.length>1){setActiveGeo(function(prev){return prev?Object.assign({},prev,{points:prev.points.slice(0,-1)}):null;});}}
  }
  function clearAll(){setTowns([]);setRoads([]);setRivers([]);setSamples([]);setGeoZones([]);setActiveRoad(null);setActiveRiver(null);setActiveGeo(null);setPreviewPin(null);setSelectedFeature(null);}

  // Place feature from typed coordinates
  function placeFromCoord(ll) {
    setPreviewPin(ll);
    setCenter({lat:ll.lat,lon:ll.lon});
    if(zoom<10)setZoom(10);
    if(mode==="town"){
      var name=townForm.name||"Town "+(towns.length+1);
      setTowns(function(t){return t.concat([{lat:ll.lat,lon:ll.lon,name:name}]);});
      setTownForm({name:""});
    } else if(mode==="sample"){
      var id=sampleForm.id||"SAMPLE-"+(samples.length+1);
      setSamples(function(s){return s.concat([{lat:ll.lat,lon:ll.lon,id:id,rock:sampleForm.rock,notes:sampleForm.notes}]);});
      setSampleForm(function(f){return Object.assign({},f,{id:"",notes:""});});
    } else if(mode==="geology"){
      if(!activeGeo){setActiveGeo({rock:geoRock,points:[ll]});}
      else{setActiveGeo(function(prev){return prev?Object.assign({},prev,{points:prev.points.concat([ll])}):null;});}
    }
    setTimeout(function(){setPreviewPin(null);},2500);
  }

  var openMap=useCallback(function(type){var data={towns,roads,rivers,samples,geoZones,center,zoom};var html=renderMap(type,data,projectName||"Study Area",exportDPI);var w=window.open("","_blank");w.document.write(html);w.document.close();},[towns,roads,rivers,samples,geoZones,center,zoom,projectName,exportDPI]);
  var openMapExport=useCallback(function(type,fmt){var data={towns,roads,rivers,samples,geoZones,center,zoom};var html=renderMap(type,data,projectName||"Study Area",exportDPI);var w=window.open("","_blank");w.document.write(html);w.document.close();w.addEventListener("load",function(){setTimeout(function(){if(fmt==="png"&&w.download300PNG)w.download300PNG();if(fmt==="pdf"&&w.downloadPDF)w.downloadPDF();},3000);});},[towns,roads,rivers,samples,geoZones,center,zoom,projectName,exportDPI]);

  var totalNodes=roads.reduce(function(s,r){return s+r.points.length;},0)+rivers.reduce(function(s,r){return s+r.points.length;},0);
  var btnBase={border:"none",borderRadius:6,cursor:"pointer",fontFamily:"sans-serif",fontWeight:"bold"};

  return (
    <div style={{background:"#0d0d1f",height:"100vh",fontFamily:"sans-serif",color:"#eee",display:"flex",flexDirection:"column",overflow:"hidden"}}>

      {/* Header */}
      <div style={{background:"#12122e",borderBottom:"1px solid #2a2a5a",padding:"7px 14px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:30,height:30,background:"#f0c040",borderRadius:7,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>🗺</div>
          <div>
            <div style={{fontWeight:"bold",fontSize:14,color:"#f0c040"}}>Geo Mapping System</div>
            <div style={{fontSize:9,color:"#555"}}>Nigeria Geological Survey — Sequence 4</div>
          </div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <input value={projectName} onChange={function(e){setProjectName(e.target.value);}}
            placeholder="Study area name…"
            style={{background:"#1a1a3a",color:"#fff",border:"1px solid #3a3a6a",borderRadius:5,padding:"4px 8px",fontSize:11,width:160}}/>
          <button onClick={function(){openMap("map2");}} style={Object.assign({},btnBase,{background:"#1a3a5a",color:"#4a9adf",border:"1px solid #2a5a8a",padding:"5px 10px",fontSize:10})}>📄 MAP 2</button>
          <button onClick={function(){openMap("map3");}} style={Object.assign({},btnBase,{background:"#2a1a5a",color:"#9b59b6",border:"1px solid #5a2a8a",padding:"5px 10px",fontSize:10})}>🪨 MAP 3</button>
          <div style={{background:"#1a3a1a",border:"1px solid #27ae60",borderRadius:10,padding:"2px 8px",fontSize:9,color:"#27ae60"}}>● Live</div>
          <div style={{background:"#1a1a3a",border:"1px solid #3a3a6a",borderRadius:10,padding:"2px 8px",fontSize:9,color:"#888"}}>z{zoom}</div>
        </div>
      </div>

      {/* Mode toolbar */}
      <div style={{background:"#0a0a20",borderBottom:"1px solid #2a2a5a",padding:"6px 10px",display:"flex",gap:4,alignItems:"center",flexShrink:0,overflowX:"auto"}}>
        {MODES.map(function(m){return(<button key={m} onClick={function(){setMode(m);if(m==="pan"){setActiveRoad(null);setActiveRiver(null);setActiveGeo(null);}}} style={Object.assign({},btnBase,{background:mode===m?"#f0c040":MODE_COLORS[m]||"#2a2a4a",color:mode===m?"#000":"#ccc",padding:"6px 10px",fontSize:10,whiteSpace:"nowrap",border:"1px solid "+(mode===m?"#f0c040":"#3a3a6a")})}>{MODE_LABELS[m]}</button>);})}
        <div style={{marginLeft:"auto",display:"flex",gap:4}}>
          <button onClick={function(){setZoom(function(z){return Math.min(18,z+1);});}} style={Object.assign({},btnBase,{background:"#1e1e3a",color:"#fff",padding:"6px 11px",border:"1px solid #3a3a6a"})}>+</button>
          <button onClick={function(){setZoom(function(z){return Math.max(4,z-1);});}} style={Object.assign({},btnBase,{background:"#1e1e3a",color:"#fff",padding:"6px 11px",border:"1px solid #3a3a6a"})}>−</button>
          <button onClick={function(){setCenter({lat:NIGERIA_CENTER[0],lon:NIGERIA_CENTER[1]});setZoom(NIGERIA_ZOOM);}} style={Object.assign({},btnBase,{background:"#1e1e3a",color:"#aaa",padding:"6px 10px",fontSize:10,border:"1px solid #3a3a6a"})}>🇳🇬</button>
        </div>
      </div>

      {/* Body */}
      <div style={{display:"flex",flex:1,overflow:"hidden"}}>
        <div ref={containerRef} style={{flex:1,position:"relative",overflow:"hidden"}}>
          <canvas ref={canvasRef} width={W} height={H}
            onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
            onMouseLeave={onMouseLeave} onWheel={onWheel}
            style={{display:"block",width:"100%",height:"100%",cursor:mode==="pan"?(dragRef.current?"grabbing":"grab"):"crosshair"}}
          />

          {/* ── FIXED COORDINATE DISPLAY ── */}
          <div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(0,0,0,0.82)",borderTop:"1px solid #2a2a5a",padding:"4px 12px",display:"flex",gap:16,alignItems:"center",pointerEvents:"none"}}>
            <span style={{fontSize:10,color:"#555",fontFamily:"monospace"}}>📍 CURSOR</span>
            {cursorLL ? (
              <>
                <span style={{fontSize:11,color:"#f0c040",fontFamily:"monospace",fontWeight:"bold",letterSpacing:1}}>
                  {toDMS(cursorLL.lat,true)}
                </span>
                <span style={{fontSize:11,color:"#f0c040",fontFamily:"monospace",fontWeight:"bold",letterSpacing:1}}>
                  {toDMS(cursorLL.lon,false)}
                </span>
                <span style={{fontSize:10,color:"#555",fontFamily:"monospace"}}>
                  ({cursorLL.lat.toFixed(5)}, {cursorLL.lon.toFixed(5)})
                </span>
              </>
            ) : (
              <span style={{fontSize:10,color:"#333",fontFamily:"monospace"}}>Move cursor over map to read coordinates</span>
            )}
          </div>

          {/* Drawing hints */}
          {(mode==="road-major"||mode==="road-minor")&&(
            <div style={{position:"absolute",bottom:32,left:"50%",transform:"translateX(-50%)",background:"rgba(0,0,0,0.75)",color:"#fff",borderRadius:8,padding:"6px 14px",fontSize:11,display:"flex",gap:8}}>
              <span>Click to add nodes</span>
              {activeRoad&&<button onClick={finishRoad} style={Object.assign({},btnBase,{background:"#27ae60",color:"#fff",padding:"3px 10px",fontSize:10})}>✓ Finish Road</button>}
              {activeRoad&&<button onClick={undoLastNode} style={Object.assign({},btnBase,{background:"#e74c3c",color:"#fff",padding:"3px 8px",fontSize:10})}>↩ Undo</button>}
            </div>
          )}
          {mode==="river"&&(
            <div style={{position:"absolute",bottom:32,left:"50%",transform:"translateX(-50%)",background:"rgba(0,0,0,0.75)",color:"#fff",borderRadius:8,padding:"6px 14px",fontSize:11,display:"flex",gap:8}}>
              <span>Click to add nodes</span>
              {activeRiver&&<button onClick={finishRiver} style={Object.assign({},btnBase,{background:"#27ae60",color:"#fff",padding:"3px 10px",fontSize:10})}>✓ Finish River</button>}
              {activeRiver&&<button onClick={undoLastNode} style={Object.assign({},btnBase,{background:"#e74c3c",color:"#fff",padding:"3px 8px",fontSize:10})}>↩ Undo</button>}
            </div>
          )}
          {mode==="geology"&&(
            <div style={{position:"absolute",bottom:32,left:"50%",transform:"translateX(-50%)",background:"rgba(0,0,0,0.75)",color:"#fff",borderRadius:8,padding:"6px 14px",fontSize:11,display:"flex",gap:8,alignItems:"center"}}>
              {!activeGeo?<span>Click to start polygon</span>:<span>Click nodes · click green circle to close</span>}
              {activeGeo&&activeGeo.points.length>2&&<button onClick={finishGeo} style={Object.assign({},btnBase,{background:"#27ae60",color:"#fff",padding:"3px 10px",fontSize:10})}>✓ Close</button>}
              {activeGeo&&<button onClick={undoLastNode} style={Object.assign({},btnBase,{background:"#e74c3c",color:"#fff",padding:"3px 8px",fontSize:10})}>↩ Undo</button>}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div style={{width:240,background:"#0a0a1e",borderLeft:"1px solid #2a2a5a",display:"flex",flexDirection:"column",flexShrink:0}}>
          <div style={{display:"flex",borderBottom:"1px solid #2a2a5a"}}>
            {["draw","data","output"].map(function(t){return(<button key={t} onClick={function(){setTab(t);}} style={Object.assign({},btnBase,{flex:1,padding:"8px 4px",fontSize:10,background:tab===t?"#1a1a3a":"transparent",color:tab===t?"#f0c040":"#555",borderRadius:0,borderBottom:tab===t?"2px solid #f0c040":"2px solid transparent"})}>{t==="draw"?"✏️ Draw":t==="data"?"📊 Data":"🗺 Output"}</button>);})}
          </div>

          <div style={{flex:1,overflowY:"auto",padding:12}}>

            {tab==="draw"&&(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>

                {mode==="town"&&(
                  <div style={{background:"#12122e",border:"1px solid #1a3a5a",borderRadius:8,padding:10}}>
                    <div style={{fontSize:11,color:"#4a9adf",fontWeight:"bold",marginBottom:8}}>🏘 PLACE TOWN</div>
                    <label style={{fontSize:10,color:"#888",display:"block",marginBottom:3}}>Town Name</label>
                    <input value={townForm.name} onChange={function(e){setTownForm({name:e.target.value});}}
                      placeholder="e.g. Ananamong"
                      style={{width:"100%",background:"#1e1e3a",color:"#fff",border:"1px solid #3a3a6a",borderRadius:5,padding:"6px 8px",fontSize:11,boxSizing:"border-box"}}/>
                    <div style={{fontSize:10,color:"#555",marginTop:6}}>Click map to place</div>
                    <CoordInput label="Place Town by Coordinates" onPlace={placeFromCoord}/>
                  </div>
                )}

                {(mode==="road-major"||mode==="road-minor")&&(
                  <div style={{background:"#12122e",border:"1px solid #5a2a00",borderRadius:8,padding:10}}>
                    <div style={{fontSize:11,color:"#e07030",fontWeight:"bold",marginBottom:6}}>{mode==="road-major"?"🟠 MAJOR ROAD":"⬛ MINOR ROAD"}</div>
                    <div style={{fontSize:10,color:"#888",lineHeight:1.6}}>Click to place nodes · Finish when done</div>
                    {activeRoad&&<div style={{marginTop:8,fontSize:10,color:"#f0c040"}}>{activeRoad.points.length} nodes placed</div>}
                  </div>
                )}

                {mode==="river"&&(
                  <div style={{background:"#12122e",border:"1px solid #003a5a",borderRadius:8,padding:10}}>
                    <div style={{fontSize:11,color:"#2980d9",fontWeight:"bold",marginBottom:6}}>🌊 DRAW RIVER</div>
                    <div style={{fontSize:10,color:"#888",lineHeight:1.6}}>Click upstream → downstream</div>
                    {activeRiver&&<div style={{marginTop:8,fontSize:10,color:"#f0c040"}}>{activeRiver.points.length} nodes placed</div>}
                  </div>
                )}

                {mode==="sample"&&(
                  <div style={{background:"#12122e",border:"1px solid #5a1a1a",borderRadius:8,padding:10}}>
                    <div style={{fontSize:11,color:"#e74c3c",fontWeight:"bold",marginBottom:8}}>🔺 PLACE SAMPLE</div>
                    <label style={{fontSize:10,color:"#888",display:"block",marginBottom:3}}>Sample ID</label>
                    <input value={sampleForm.id} onChange={function(e){setSampleForm(function(f){return Object.assign({},f,{id:e.target.value});});}}
                      placeholder="e.g. UU/GS/GLG/25/57"
                      style={{width:"100%",background:"#1e1e3a",color:"#fff",border:"1px solid #3a3a6a",borderRadius:5,padding:"6px 8px",fontSize:10,boxSizing:"border-box",marginBottom:6}}/>
                    <label style={{fontSize:10,color:"#888",display:"block",marginBottom:3}}>Rock Type</label>
                    <select value={sampleForm.rock} onChange={function(e){setSampleForm(function(f){return Object.assign({},f,{rock:e.target.value});});}}
                      style={{width:"100%",background:"#1e1e3a",color:"#fff",border:"1px solid #3a3a6a",borderRadius:5,padding:"6px 8px",fontSize:10,boxSizing:"border-box",marginBottom:6}}>
                      {Object.keys(ROCK_COLORS).map(function(r){return <option key={r}>{r}</option>;})}
                    </select>
                    <label style={{fontSize:10,color:"#888",display:"block",marginBottom:3}}>Field Notes</label>
                    <textarea value={sampleForm.notes} onChange={function(e){setSampleForm(function(f){return Object.assign({},f,{notes:e.target.value});});}}
                      rows={2} style={{width:"100%",background:"#1e1e3a",color:"#fff",border:"1px solid #3a3a6a",borderRadius:5,padding:"6px 8px",fontSize:10,boxSizing:"border-box",resize:"none",marginBottom:0}}/>
                    <div style={{fontSize:10,color:"#555",marginTop:6}}>Click map to place · or use coordinates below</div>
                    <CoordInput label="Place Sample by Coordinates" onPlace={placeFromCoord}/>
                  </div>
                )}

                {mode==="geology"&&(
                  <div style={{background:"#12122e",border:"1px solid #2a1a5a",borderRadius:8,padding:10}}>
                    <div style={{fontSize:11,color:"#9b59b6",fontWeight:"bold",marginBottom:8}}>🪨 GEOLOGY ZONE</div>
                    <select value={geoRock} onChange={function(e){setGeoRock(e.target.value);}}
                      style={{width:"100%",background:"#1e1e3a",color:"#fff",border:"1px solid #3a3a6a",borderRadius:5,padding:"6px 8px",fontSize:10,boxSizing:"border-box",marginBottom:8}}>
                      {Object.keys(ROCK_COLORS).map(function(r){return <option key={r}>{r}</option>;})}
                    </select>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                      <div style={{width:18,height:18,background:ROCK_COLORS[geoRock],borderRadius:3,border:"1px solid #fff"}}/>
                      <span style={{fontSize:10,color:"#888"}}>{geoRock}</span>
                    </div>
                    <div style={{fontSize:10,color:"#888",lineHeight:1.6}}>Click nodes · green circle to close · min 3 nodes</div>
                    {activeGeo&&<div style={{marginTop:6,fontSize:10,color:"#f0c040"}}>{activeGeo.points.length} nodes placed</div>}
                    <CoordInput label="Add Node by Coordinates" onPlace={placeFromCoord}/>
                  </div>
                )}

                {mode==="select"&&(
                  <div style={{background:"#12122e",border:"1px solid #1a3a1a",borderRadius:8,padding:10}}>
                    <div style={{fontSize:11,color:"#27ae60",fontWeight:"bold",marginBottom:8}}>👆 SELECT &amp; DELETE</div>
                    <div style={{fontSize:10,color:"#888",lineHeight:1.6,marginBottom:10}}>Click any feature on the map to select it. Selected features glow yellow.</div>
                    {selectedFeature ? (
                      <div>
                        <div style={{background:"#1a2a1a",border:"1px solid #27ae60",borderRadius:6,padding:"8px 10px",marginBottom:8}}>
                          <div style={{fontSize:10,color:"#27ae60",fontWeight:"bold"}}>Selected:</div>
                          <div style={{fontSize:11,color:"#f0c040",marginTop:3,textTransform:"capitalize"}}>
                            {selectedFeature.type} #{selectedFeature.id+1}
                            {selectedFeature.type==="town"&&towns[selectedFeature.id]?" — "+towns[selectedFeature.id].name:""}
                            {selectedFeature.type==="sample"&&samples[selectedFeature.id]?" — "+samples[selectedFeature.id].id:""}
                            {selectedFeature.type==="road"&&roads[selectedFeature.id]?" — "+(roads[selectedFeature.id].type==="major"?"Major":"Minor")+" Road":""}
                          </div>
                          {selectedFeature.type==="sample"&&samples[selectedFeature.id]&&(
                            <div style={{fontSize:9,color:"#888",fontFamily:"monospace",marginTop:3}}>
                              {samples[selectedFeature.id].lat.toFixed(5)}, {samples[selectedFeature.id].lon.toFixed(5)}
                            </div>
                          )}
                        </div>
                        <button onClick={deleteSelected}
                          style={Object.assign({},btnBase,{width:"100%",background:"#3a0a0a",color:"#e74c3c",border:"1px solid #e74c3c",padding:"8px",fontSize:11})}>
                          🗑 Delete Selected Feature
                        </button>
                        <button onClick={function(){setSelectedFeature(null);}}
                          style={Object.assign({},btnBase,{width:"100%",background:"#1a1a2a",color:"#888",border:"1px solid #3a3a6a",padding:"6px",fontSize:10,marginTop:4})}>
                          ✕ Deselect
                        </button>
                      </div>
                    ) : (
                      <div style={{fontSize:10,color:"#444",textAlign:"center",padding:"10px 0"}}>No feature selected</div>
                    )}
                  </div>
                )}
                  <div style={{fontSize:11,color:"#555",textAlign:"center",padding:20,lineHeight:1.8}}>
                    Select a drawing tool above to begin.
                  </div>
                

                <button onClick={clearAll} style={Object.assign({},btnBase,{background:"#3a1a1a",color:"#e74c3c",border:"1px solid #e74c3c",padding:"7px",fontSize:10,width:"100%"})}>
                  🗑 Clear All Features
                </button>
              </div>
            )}

            {tab==="data"&&(
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {[
                  {label:"Towns",count:towns.length,color:"#3498db"},
                  {label:"Major Roads",count:roads.filter(function(r){return r.type==="major";}).length,color:"#e07030"},
                  {label:"Minor Roads",count:roads.filter(function(r){return r.type==="minor";}).length,color:"#888"},
                  {label:"Rivers",count:rivers.length,color:"#2980d9"},
                  {label:"Samples",count:samples.length,color:"#e74c3c"},
                  {label:"Geology Zones",count:geoZones.length,color:"#9b59b6"},
                  {label:"Total Road Nodes",count:totalNodes,color:"#f0c040"},
                ].map(function(item,i){return(<div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#12122e",borderRadius:6,padding:"8px 10px",borderLeft:"3px solid "+item.color}}><span style={{fontSize:11,color:"#aaa"}}>{item.label}</span><span style={{fontSize:16,fontWeight:"bold",color:item.color}}>{item.count}</span></div>);})}
                {samples.length>0&&(
                  <div style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:8,padding:10,marginTop:4}}>
                    <div style={{fontSize:11,color:"#f0c040",fontWeight:"bold",marginBottom:6}}>SAMPLE LIST</div>
                    {samples.map(function(s,i){return(<div key={i} style={{fontSize:10,borderBottom:"1px solid #1a1a3a",padding:"4px 0"}}>
                      <div style={{display:"flex",justifyContent:"space-between"}}><span style={{color:"#ffaaaa"}}>{s.id}</span><span style={{color:"#888"}}>{s.rock}</span></div>
                      <div style={{color:"#555",fontSize:9,fontFamily:"monospace"}}>{s.lat.toFixed(5)}, {s.lon.toFixed(5)}</div>
                    </div>);})}
                  </div>
                )}
              </div>
            )}

            {tab==="output"&&(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:8,padding:10}}>
                  <div style={{fontSize:11,color:"#f0c040",fontWeight:"bold",marginBottom:8}}>EXPORT QUALITY</div>
                  {DPI_OPTIONS.map(function(opt){var active=exportDPI===opt.dpi;return(<div key={opt.dpi} onClick={function(){setExportDPI(opt.dpi);}} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:active?"#1a3a1a":"#0f0f2a",border:"1px solid "+(active?"#27ae60":"#2a2a5a"),borderRadius:5,padding:"6px 8px",marginBottom:4,cursor:"pointer"}}><span style={{fontSize:11,fontWeight:"bold",color:active?"#27ae60":"#aaa"}}>{opt.label}</span><span style={{fontSize:9,color:active?"#8fbb8f":"#444"}}>{opt.desc}</span>{active&&<span style={{fontSize:9,color:"#27ae60"}}>✓</span>}</div>);})}
                </div>
                <div style={{background:"#12122e",border:"1px solid #2a2a5a",borderRadius:8,padding:10}}>
                  <div style={{fontSize:11,color:"#f0c040",fontWeight:"bold",marginBottom:8}}>GENERATE MAPS</div>
                  <button onClick={function(){openMap("map2");}} style={Object.assign({},btnBase,{width:"100%",background:"#1a3a5a",color:"#4a9adf",border:"1px solid #2a5a8a",padding:"9px",fontSize:11,marginBottom:8})}>📄 Generate MAP 2<br/><span style={{fontSize:9,fontWeight:"normal",color:"#888"}}>Sample Location Map</span></button>
                  <button onClick={function(){openMap("map3");}} style={Object.assign({},btnBase,{width:"100%",background:"#2a1a5a",color:"#9b59b6",border:"1px solid #5a2a8a",padding:"9px",fontSize:11,marginBottom:12})}>🪨 Generate MAP 3<br/><span style={{fontSize:9,fontWeight:"normal",color:"#888"}}>Geological Map</span></button>
                  <div style={{fontSize:10,color:"#f0c040",fontWeight:"bold",marginBottom:6}}>QUICK EXPORT</div>
                  {[{label:"⬇ MAP 2 — PNG "+exportDPI+"dpi",type:"map2",fmt:"png"},{label:"⬇ MAP 2 — PDF A3",type:"map2",fmt:"pdf"},{label:"⬇ MAP 3 — PNG "+exportDPI+"dpi",type:"map3",fmt:"png"},{label:"⬇ MAP 3 — PDF A3",type:"map3",fmt:"pdf"}].map(function(item,i){return(<button key={i} onClick={function(){openMapExport(item.type,item.fmt);}} style={Object.assign({},btnBase,{width:"100%",background:"#0f1f2f",color:"#7ab",border:"1px solid #2a4a6a",padding:"7px",fontSize:10,marginBottom:4})}>{item.label}</button>);})}
                </div>
                <div style={{background:"#0f0f1e",border:"1px dashed #2a2a4a",borderRadius:8,padding:10}}>
                  <div style={{fontSize:10,color:"#444",fontWeight:"bold",marginBottom:4}}>NEXT: SEQUENCE 5</div>
                  <div style={{fontSize:10,color:"#333",lineHeight:1.6}}>GeoJSON, KML and CSV export formats.</div>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      <div style={{background:"#0a0a1e",borderTop:"1px solid #2a2a5a",padding:"4px 14px",display:"flex",justifyContent:"space-between",flexShrink:0}}>
        <span style={{fontSize:9,color:"#333"}}>Geo Mapping System v0.4 — Sequence 4</span>
        <span style={{fontSize:9,color:"#333"}}>Nigeria · WGS84 · OpenStreetMap</span>
      </div>
    </div>
  );
}