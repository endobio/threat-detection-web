import DeckGL from "@deck.gl/react";
import { GeoJsonLayer } from "@deck.gl/layers";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { useEffect, useMemo, useState } from "react";
import MapLibreMap from "react-map-gl/maplibre";

type StatusClass =
  | "no-data"
  | "negative-surveillance"
  | "historical-positive"
  | "recent-positive"
  | "new-positive-county"
  | "unreviewed-positive";

type CountyProperties = {
  GEOID?: string;
  NAME?: string;
  STATEFP?: string;
  [key: string]: unknown;
};

type CountyFeature = Feature<Geometry, CountyProperties>;

type CountyMetric = {
  fipscode: string;
  county: string;
  state: string;
  positiveCount: number;
  negativeCount: number;
  totalReports: number;
  reviewedCount: number;
  latestObserved: string | null;
  positiveRate: number | null;
  emergenceScore: number;
  statusClass: StatusClass;
  whyFlagged: string;
  scoreComponents: {
    recency: number;
    novelty: number;
    positiveSignal: number;
    verification: number;
    negativeEvidence: number;
  };
};

type TrendRow = {
  week: string;
  positiveReports: number;
  negativeReports: number;
  newPositiveCounties: number;
  positiveCounties: number;
  statesPositive: number;
};

type AlertRow = {
  level: string;
  fipscode: string;
  county: string;
  state: string;
  latestObserved: string | null;
  positiveCount: number;
  negativeCount: number;
  emergenceScore: number;
  whyFlagged: string;
};

type DiseaseSummary = {
  subjectnumber: number;
  scientificname: string | null;
  displayname: string | null;
  total_reports: number;
  total_positive: number;
  total_negative: number;
  counties_seen: number;
  counties_positive: number;
  states_seen: number;
  states_positive: number;
  first_observed: string | null;
  latest_observed: string | null;
  countyMetrics: CountyMetric[];
  trend: TrendRow[];
  alerts: AlertRow[];
};

type DemoSummary = {
  generatedAt: string;
  counties: FeatureCollection<Geometry, CountyProperties>;
  diseases: DiseaseSummary[];
};

const INITIAL_VIEW_STATE = {
  longitude: -98.6,
  latitude: 39.7,
  zoom: 3.25,
  minZoom: 2.4,
  maxZoom: 9,
  pitch: 0,
  bearing: 0
};

const STATUS_COLORS: Record<StatusClass, [number, number, number, number]> = {
  "no-data": [226, 226, 218, 70],
  "negative-surveillance": [59, 134, 172, 155],
  "historical-positive": [147, 139, 114, 145],
  "recent-positive": [219, 126, 72, 190],
  "new-positive-county": [191, 62, 55, 220],
  "unreviewed-positive": [126, 77, 153, 200]
};

function getGeoid(feature: CountyFeature) {
  return feature.properties?.GEOID ?? String(feature.id ?? "").padStart(5, "0");
}

function formatNumber(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return value.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  });
}

function rgba(color: [number, number, number, number]) {
  return `rgba(${color[0]},${color[1]},${color[2]},${color[3] / 255})`;
}

function emptyMetric(feature: CountyFeature): CountyMetric {
  const geoid = getGeoid(feature);
  return {
    fipscode: geoid,
    county: String(feature.properties?.NAME ?? geoid),
    state: String(feature.properties?.STATEFP ?? geoid.slice(0, 2)),
    positiveCount: 0,
    negativeCount: 0,
    totalReports: 0,
    reviewedCount: 0,
    latestObserved: null,
    positiveRate: null,
    emergenceScore: 0,
    statusClass: "no-data",
    whyFlagged: "No records for this disease",
    scoreComponents: {
      recency: 0,
      novelty: 0,
      positiveSignal: 0,
      verification: 0,
      negativeEvidence: 0
    }
  };
}

export default function App() {
  const [summary, setSummary] = useState<DemoSummary | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<number | null>(null);
  const [threshold, setThreshold] = useState(0);
  const [activeMetric, setActiveMetric] = useState<CountyMetric | null>(null);

  useEffect(() => {
    async function loadSummary() {
      const response = await fetch("/data/demo_summary.json");
      const payload = (await response.json()) as DemoSummary;
      setSummary(payload);
      setSelectedSubject(payload.diseases[0]?.subjectnumber ?? null);
    }
    void loadSummary();
  }, []);

  const selectedDisease = useMemo(() => {
    if (!summary) return null;
    return summary.diseases.find((disease) => disease.subjectnumber === selectedSubject) ?? summary.diseases[0] ?? null;
  }, [selectedSubject, summary]);

  const metricsByFips = useMemo(() => {
    const metrics = new Map<string, CountyMetric>();
    selectedDisease?.countyMetrics.forEach((metric) => {
      if (metric.emergenceScore >= threshold) metrics.set(metric.fipscode, metric);
    });
    return metrics;
  }, [selectedDisease, threshold]);

  const layers = useMemo(() => {
    if (!summary) return [];
    return [
      new GeoJsonLayer<CountyFeature>({
        id: "demo-county-emergence",
        data: summary.counties.features,
        pickable: true,
        stroked: true,
        filled: true,
        lineWidthMinPixels: 0.4,
        getLineColor: [255, 255, 255, 120],
        getFillColor: (feature) => {
          const metric = metricsByFips.get(getGeoid(feature));
          if (!metric) return STATUS_COLORS["no-data"];
          const color = STATUS_COLORS[metric.statusClass];
          if (metric.statusClass === "recent-positive" || metric.statusClass === "new-positive-county") {
            const boost = Math.min(1, metric.emergenceScore);
            return [color[0], Math.round(color[1] * (1 - boost * 0.25)), Math.round(color[2] * (1 - boost * 0.35)), color[3]];
          }
          return color;
        },
        onHover: ({ object }) => {
          if (!object) {
            setActiveMetric(null);
            return;
          }
          const feature = object as CountyFeature;
          setActiveMetric(metricsByFips.get(getGeoid(feature)) ?? emptyMetric(feature));
        },
        onClick: ({ object }) => {
          if (!object) return;
          const feature = object as CountyFeature;
          setActiveMetric(metricsByFips.get(getGeoid(feature)) ?? emptyMetric(feature));
        }
      })
    ];
  }, [metricsByFips, summary]);

  const maxTrend = Math.max(
    1,
    ...(selectedDisease?.trend ?? []).flatMap((row) => [row.positiveReports, row.negativeReports])
  );

  if (!summary || !selectedDisease) {
    return <main className="loading">Loading disease summary...</main>;
  }

  return (
    <main className="dashboard">
      <header className="topbar">
        <div>
          <p className="eyebrow">Vite demo summary</p>
          <h1>Emerging crop disease intelligence</h1>
        </div>
        <div className="summaryStats">
          <span>{summary.diseases.length} demo diseases</span>
          <span>{selectedDisease.countyMetrics.length} reporting counties</span>
          <span>{selectedDisease.alerts.length} alerts</span>
        </div>
      </header>

      <section className="controlBand">
        <label>
          Disease
          <select value={selectedDisease.subjectnumber} onChange={(event) => setSelectedSubject(Number(event.target.value))}>
            {summary.diseases.map((disease) => (
              <option key={disease.subjectnumber} value={disease.subjectnumber}>
                {disease.displayname ?? disease.scientificname ?? disease.subjectnumber}
              </option>
            ))}
          </select>
        </label>
        <label>
          Emergence threshold {threshold.toFixed(2)}
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={threshold}
            onChange={(event) => setThreshold(Number(event.target.value))}
          />
        </label>
        <div className="demoNote">
          Summary generated {summary.generatedAt.slice(0, 10)}. The demo uses pre-aggregated all-time disease-county metrics.
        </div>
      </section>

      <section className="workspace">
        <div className="mapPane">
          <DeckGL initialViewState={INITIAL_VIEW_STATE} controller layers={layers}>
            <MapLibreMap mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json" reuseMaps />
          </DeckGL>
          <div className="legend">
            {(Object.keys(STATUS_COLORS) as StatusClass[]).map((status) => (
              <span key={status}>
                <i style={{ background: rgba(STATUS_COLORS[status]) }} />
                {status.replaceAll("-", " ")}
              </span>
            ))}
          </div>
        </div>

        <aside className="sidePanel">
          <section className="detailBlock">
            <p className="panelLabel">Selected disease</p>
            <h2>{selectedDisease.displayname}</h2>
            <p className="muted">{selectedDisease.scientificname}</p>
            <div className="metricGrid">
              <span>Subject</span>
              <strong>{selectedDisease.subjectnumber}</strong>
              <span>Total positives</span>
              <strong>{formatNumber(selectedDisease.total_positive)}</strong>
              <span>Total negatives</span>
              <strong>{formatNumber(selectedDisease.total_negative)}</strong>
              <span>Positive counties</span>
              <strong>{formatNumber(selectedDisease.counties_positive)}</strong>
              <span>Latest observed</span>
              <strong>{selectedDisease.latest_observed ?? "n/a"}</strong>
            </div>
          </section>

          <section className="detailBlock">
            <p className="panelLabel">County tooltip</p>
            {activeMetric ? (
              <>
                <h2>
                  {activeMetric.county} County, {activeMetric.state}
                </h2>
                <p className={`statusText ${activeMetric.statusClass}`}>{activeMetric.statusClass.replaceAll("-", " ")}</p>
                <div className="metricGrid">
                  <span>Latest observation</span>
                  <strong>{activeMetric.latestObserved ?? "n/a"}</strong>
                  <span>Positive reports</span>
                  <strong>{activeMetric.positiveCount}</strong>
                  <span>Negative reports</span>
                  <strong>{activeMetric.negativeCount}</strong>
                  <span>Total reports</span>
                  <strong>{activeMetric.totalReports}</strong>
                  <span>Reviewed</span>
                  <strong>
                    {activeMetric.reviewedCount} / {activeMetric.totalReports}
                  </strong>
                  <span>Positive rate</span>
                  <strong>{activeMetric.positiveRate === null ? "n/a" : `${formatNumber(activeMetric.positiveRate * 100, 1)}%`}</strong>
                  <span>Emergence score</span>
                  <strong>{formatNumber(activeMetric.emergenceScore, 2)}</strong>
                </div>
                <p className="interpretation">{activeMetric.whyFlagged}</p>
                <div className="scoreParts">
                  <span>Recency {formatNumber(activeMetric.scoreComponents.recency, 2)}</span>
                  <span>Novelty {formatNumber(activeMetric.scoreComponents.novelty, 2)}</span>
                  <span>Positive {formatNumber(activeMetric.scoreComponents.positiveSignal, 2)}</span>
                  <span>Review {formatNumber(activeMetric.scoreComponents.verification, 2)}</span>
                  <span>Negative evidence {formatNumber(activeMetric.scoreComponents.negativeEvidence, 2)}</span>
                </div>
              </>
            ) : (
              <p className="muted">Hover or click a county.</p>
            )}
          </section>
        </aside>
      </section>

      <section className="lowerBand">
        <div className="trendPanel">
          <div className="sectionHead">
            <h2>Weekly trend</h2>
            <span>Last {selectedDisease.trend.length} active weeks</span>
          </div>
          <div className="bars">
            {selectedDisease.trend.map((row) => (
              <div className="barRow" key={row.week}>
                <span>{row.week.slice(5)}</span>
                <div>
                  <i className="positiveBar" style={{ width: `${(row.positiveReports / maxTrend) * 100}%` }} />
                  <i className="negativeBar" style={{ width: `${(row.negativeReports / maxTrend) * 100}%` }} />
                </div>
                <strong>
                  {row.positiveReports} / {row.negativeReports}
                </strong>
              </div>
            ))}
          </div>
        </div>

        <div className="alertsPanel">
          <div className="sectionHead">
            <h2>Emergence alerts</h2>
            <span>Ranked by summary score</span>
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Level</th>
                  <th>County</th>
                  <th>Latest</th>
                  <th>Pos</th>
                  <th>Neg</th>
                  <th>Score</th>
                  <th>Why flagged</th>
                </tr>
              </thead>
              <tbody>
                {selectedDisease.alerts.map((alert) => (
                  <tr key={alert.fipscode}>
                    <td>{alert.level}</td>
                    <td>
                      {alert.county}, {alert.state}
                    </td>
                    <td>{alert.latestObserved ?? "n/a"}</td>
                    <td>{alert.positiveCount}</td>
                    <td>{alert.negativeCount}</td>
                    <td>{formatNumber(alert.emergenceScore, 2)}</td>
                    <td>{alert.whyFlagged}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
