import React, { useEffect, useState } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from "react-leaflet";
import Topbar from "../../../shared/components/Topbar.jsx";
import { useExplore } from "../hooks/useExplore.js";
import "../../../style/explore.css";
import "leaflet/dist/leaflet.css";

const PRESETS = [
  "Show flood extent in Kosi basin near Supaul",
  "Crop stress, Punjab",
  "Deforestation, Odisha",
  "Glacial lake, Chamoli",
];

const MapViewport = ({ coordinates }) => {
  const map = useMap();

  useEffect(() => {
    map.setView([coordinates.lat, coordinates.lng], 11, { animate: true });
  }, [coordinates.lat, coordinates.lng, map]);

  return null;
};

const Explore = () => {
  const [input, setInput] = useState("");
  const { result, loading, error, ask } = useExplore();

  const handleAsk = (text) => {
    setInput(text);
    ask(text);
  };

  const onSubmit = (e) => {
    e.preventDefault();
    ask(input);
  };

  const q = result?.query;
  const sat = q?.satelliteResult;
  const coordinates = q?.parsedIntent?.coordinates;

  const metrics = sat
    ? [
        { label: "AREA AFFECTED", value: sat.areaAffectedKm2 != null ? `${sat.areaAffectedKm2} km²` : "—" },
        { label: "CONFIDENCE", value: sat.confidence != null ? `${sat.confidence}%` : "—" },
        { label: "VS. BASELINE", value: sat.changeVsBaselinePct != null ? `${sat.changeVsBaselinePct > 0 ? "+" : ""}${sat.changeVsBaselinePct}%` : "—" },
      ]
    : [];

  return (
    <>
      <Topbar title="Explore" subtitle="Query any region in natural language" />
      <div className="content">
        <div className="explore-hero">
          <form className="cmdbar" onSubmit={onSubmit}>
            <span className="icon">&#9678;</span>
            <input
              type="text"
              placeholder="Enter an address or ask for NDVI, flood, crop stress..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
            />
            <button type="submit" disabled={loading || !input.trim()}>
              {loading ? "Asking..." : "Query"}
            </button>
          </form>
          <div className="chip-row">
            {PRESETS.map((p) => (
              <div key={p} className="chip" onClick={() => handleAsk(p)}>
                {p}
              </div>
            ))}
          </div>
        </div>

        {error && <div className="state-msg error">{error}</div>}

        {q && (
          <div className="brief-grid">
            <div className="pane pane-imagery">
              <div className="pane-head">
                <div className="pane-tag live">&#9679; {sat?.source || "satellite pass"}</div>
                <div className="pane-tag">{q.parsedIntent?.region || "Region"}</div>
              </div>
              {coordinates ? (
                <MapContainer
                  className="real-map"
                  center={[coordinates.lat, coordinates.lng]}
                  zoom={11}
                  scrollWheelZoom
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <MapViewport coordinates={coordinates} />
                  <CircleMarker
                    center={[coordinates.lat, coordinates.lng]}
                    radius={10}
                    pathOptions={{ color: "#0b668f", fillColor: "#20c7b5", fillOpacity: 0.9 }}
                  >
                    <Popup>
                      <strong>{q.parsedIntent?.region || "Query location"}</strong>
                      <br />
                      {coordinates.lat}, {coordinates.lng}
                    </Popup>
                  </CircleMarker>
                </MapContainer>
              ) : (
                <div className="map-empty">No coordinates found for this query.</div>
              )}
              <div className="metric-strip">
                {metrics.map((m) => (
                  <div className="metric-cell" key={m.label}>
                    <div className="n">{m.value}</div>
                    <div className="l">{m.label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="pane pane-answer">
              <div className="answer-eyebrow">SATQUERY RESPONSE</div>
              <div className="answer-query">"{q.rawQueryText}"</div>
              <div className="answer-text">{q.responseText}</div>
              <div className="confidence-bar">
                <div className="lbl">
                  <span>Detection confidence</span>
                  <span>{sat?.confidence ?? 0}%</span>
                </div>
                <div className="confidence-track">
                  <div className="confidence-fill" style={{ width: `${sat?.confidence ?? 0}%` }} />
                </div>
              </div>
            </div>

            <div className="pane pane-index">
              <div className="index-title">INDEX BREAKDOWN</div>
              <div className="index-row">
                <span>Metric</span>
                <span className="index-val ok">{sat?.metric || "—"}</span>
              </div>
              <div className="index-row">
                <span>Value</span>
                <span className="index-val hot">{sat?.value ?? "—"}</span>
              </div>
              <div className="index-row">
                <span>Data source</span>
                <span className="index-val ok">{sat?.source || "—"}</span>
              </div>
              <div className="index-row">
                <span>Real satellite data</span>
                <span className="index-val ok">{result.meta?.usedRealSatelliteData ? "Yes" : "No (fallback)"}</span>
              </div>
              <div className="index-row">
                <span>RAG context used</span>
                <span className="index-val ok">{result.meta?.usedRAGContext ? "Yes" : "No"}</span>
              </div>
              <div className="index-row">
                <span>Stored in Pinecone</span>
                <span className="index-val ok">{result.meta?.pineconeStored ? "Yes" : "No"}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default Explore;
