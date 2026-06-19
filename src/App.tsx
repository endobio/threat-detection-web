import DeckGL from "@deck.gl/react";
import { GeoJsonLayer } from "@deck.gl/layers";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { useEffect, useMemo, useState } from "react";
import MapLibreMap from "react-map-gl/maplibre";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartTooltip,
  XAxis,
  YAxis
} from "recharts";

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
  historicTrend: CountyTrendRow[];
};

type TrendRow = {
  week: string;
  positiveReports: number;
  negativeReports: number;
  newPositiveCounties: number;
  positiveCounties: number;
  statesPositive: number;
};

type HistoryBin = {
  label: string;
  from: string;
  to: string;
  positiveReports: number;
  negativeReports: number;
  totalReports: number;
  reviewedReports: number;
  reportingCounties: number;
  positiveCounties: number;
  statesPositive: number;
  isRecentWindow: boolean;
};

type CountyTrendRow = {
  week: string;
  positiveReports: number;
  negativeReports: number;
  totalReports: number;
  reviewedReports: number;
  emergenceScore: number;
  statusClass: StatusClass;
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
  recentWindow: {
    days: number;
    from: string;
    to: string;
    positiveReports: number;
    negativeReports: number;
    reportingCounties: number;
    positiveCounties: number;
  };
  countyMetrics: CountyMetric[];
  trend: TrendRow[];
  historicAnnual: HistoryBin[];
  historicPeriods: HistoryBin[];
  alerts: AlertRow[];
};

type DemoSummary = {
  generatedAt: string;
  recentWindow: {
    days: number;
    from: string;
    to: string;
  };
  counties: FeatureCollection<Geometry, CountyProperties>;
  diseases: DiseaseSummary[];
};

type MapTooltip = {
  x: number;
  y: number;
  metric: CountyMetric;
} | null;

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

const DISEASE_COLORS = ["#EF4444", "#F97316", "#8B5CF6", "#EAB308", "#10B981", "#0071E3"];

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

function rgb(color: [number, number, number, number]) {
  return `rgb(${color[0]},${color[1]},${color[2]})`;
}

function riskLevel(score: number) {
  if (score >= 0.7) return "Critical";
  if (score >= 0.45) return "High";
  if (score >= 0.2) return "Moderate";
  return "Low";
}

function displayDiseaseName(disease: DiseaseSummary) {
  return (disease.displayname ?? disease.scientificname ?? `Subject ${disease.subjectnumber}`).replace(/\s*\([^)]*\)\s*$/, "");
}

function fourWeekGrowth(rows: TrendRow[]) {
  if (rows.length < 8) return 0;
  const recent = rows.slice(-4).reduce((sum, row) => sum + row.positiveCounties, 0);
  const prior = rows.slice(-8, -4).reduce((sum, row) => sum + row.positiveCounties, 0);
  if (!prior) return recent > 0 ? 100 : 0;
  return Math.round(((recent - prior) / prior) * 100);
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
    },
    historicTrend: []
  };
}

export default function App() {
  const [summary, setSummary] = useState<DemoSummary | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<number | null>(null);
  const [threshold, setThreshold] = useState(0);
  const [historyMode, setHistoryMode] = useState<"annual" | "period">("annual");
  const [hoveredFips, setHoveredFips] = useState<string | null>(null);
  const [selectedFips, setSelectedFips] = useState<string | null>(null);
  const [mapTooltip, setMapTooltip] = useState<MapTooltip>(null);

  useEffect(() => {
    async function loadSummary() {
      const response = await fetch(`${import.meta.env.BASE_URL}data/demo_summary.json`);
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
  const selectedDiseaseIndex = summary?.diseases.findIndex((disease) => disease.subjectnumber === selectedDisease?.subjectnumber) ?? 0;
  const diseaseColor = DISEASE_COLORS[Math.max(0, selectedDiseaseIndex) % DISEASE_COLORS.length];

  useEffect(() => {
    setHoveredFips(null);
    setSelectedFips(null);
    setMapTooltip(null);
  }, [selectedSubject]);

  const allMetricsByFips = useMemo(() => {
    const metrics = new Map<string, CountyMetric>();
    selectedDisease?.countyMetrics.forEach((metric) => {
      metrics.set(metric.fipscode, metric);
    });
    return metrics;
  }, [selectedDisease]);

  const colorMetricsByFips = useMemo(() => {
    const metrics = new Map<string, CountyMetric>();
    allMetricsByFips.forEach((metric, fips) => {
      if (metric.emergenceScore >= threshold) metrics.set(fips, metric);
    });
    return metrics;
  }, [allMetricsByFips, threshold]);

  const featuresByFips = useMemo(() => {
    const features = new Map<string, CountyFeature>();
    summary?.counties.features.forEach((feature) => features.set(getGeoid(feature), feature));
    return features;
  }, [summary]);

  const activeFips = hoveredFips ?? selectedFips;
  const activeMetric = useMemo(() => {
    if (!activeFips) return null;
    return allMetricsByFips.get(activeFips) ?? (featuresByFips.get(activeFips) ? emptyMetric(featuresByFips.get(activeFips)!) : null);
  }, [activeFips, allMetricsByFips, featuresByFips]);

  const historicalCountyFeatures = useMemo(() => {
    return summary?.counties.features.filter((feature) => allMetricsByFips.has(getGeoid(feature))) ?? [];
  }, [allMetricsByFips, summary]);

  const layers = useMemo(() => {
    if (!summary || !selectedDisease) return [];
    return [
      new GeoJsonLayer<CountyFeature>({
        id: `demo-county-emergence-${selectedDisease.subjectnumber}`,
        data: historicalCountyFeatures,
        pickable: true,
        stroked: true,
        filled: true,
        lineWidthMinPixels: 0.4,
        getLineColor: [255, 255, 255, 120],
        getFillColor: (feature) => {
          const metric = colorMetricsByFips.get(getGeoid(feature));
          if (!metric) return [232, 232, 237, 120];
          const color = STATUS_COLORS[metric.statusClass];
          if (metric.statusClass === "recent-positive" || metric.statusClass === "new-positive-county") {
            const boost = Math.min(1, metric.emergenceScore);
            return [color[0], Math.round(color[1] * (1 - boost * 0.25)), Math.round(color[2] * (1 - boost * 0.35)), color[3]];
          }
          return color;
        },
        onHover: ({ object, x, y }) => {
          if (!object) {
            setHoveredFips(null);
            setMapTooltip(null);
            return;
          }
          const feature = object as CountyFeature;
          const fips = getGeoid(feature);
          const metric = allMetricsByFips.get(fips) ?? emptyMetric(feature);
          setHoveredFips(fips);
          setMapTooltip({ x, y, metric });
        },
        onClick: ({ object }) => {
          if (!object) return;
          setSelectedFips(getGeoid(object as CountyFeature));
        },
        updateTriggers: {
          getFillColor: [selectedDisease.subjectnumber, threshold]
        }
      })
    ];
  }, [allMetricsByFips, colorMetricsByFips, historicalCountyFeatures, selectedDisease, summary, threshold]);

  const maxTrend = Math.max(
    1,
    ...(selectedDisease?.trend ?? []).flatMap((row) => [row.positiveReports, row.negativeReports])
  );
  const maxCountyTrend = Math.max(
    1,
    ...(activeMetric?.historicTrend ?? []).flatMap((row) => [row.positiveReports, row.negativeReports])
  );
  const historyBins = historyMode === "annual" ? selectedDisease?.historicAnnual ?? [] : selectedDisease?.historicPeriods ?? [];
  const maxHistory = Math.max(1, ...historyBins.flatMap((row) => [row.positiveReports, row.negativeReports]));
  const maxEmergenceScore = Math.max(0, ...(selectedDisease?.countyMetrics ?? []).map((metric) => metric.emergenceScore));
  const activeHotspots = (selectedDisease?.countyMetrics ?? []).filter((metric) => metric.positiveCount > 0 && metric.emergenceScore >= 0.2).length;
  const trendGrowth = fourWeekGrowth(selectedDisease?.trend ?? []);
  const trendChartData = (selectedDisease?.trend ?? []).map((row) => ({
    week: row.week.slice(5),
    hotspots: row.positiveCounties,
    reports: row.positiveReports
  }));
  const selectedCountyMetric = selectedFips ? allMetricsByFips.get(selectedFips) ?? null : null;
  const countySparkData = (selectedCountyMetric?.historicTrend ?? []).slice(-10).map((row) => ({
    week: row.week.slice(5),
    reports: row.positiveReports
  }));

  if (!summary || !selectedDisease) {
    return <main className="loading">Loading disease summary...</main>;
  }

  return (
    <div className="infographicApp">
      <header className="infoHeader">
        <div className="brandBlock">
          <div className="brandIcon">CW</div>
          <div>
            <p>USDA Grant A1713</p>
            <h1>CropWatch Disease Surveillance</h1>
          </div>
          <span className="headerDivider" />
          <strong>Emerging Hotspot Intelligence · County Resolution</strong>
        </div>
        <div className="windowControl">
          <span>Surveillance window</span>
          <button>{selectedDisease.recentWindow.days}d</button>
        </div>
      </header>

      <main className="infoMain">
        <section className="statStrip">
          <div className="statCard">
            <span>Active Hotspots</span>
            <strong style={{ color: diseaseColor }}>{activeHotspots}</strong>
            <p>Positive counties · latest {selectedDisease.recentWindow.days}d</p>
          </div>
          <div className="statCard">
            <span>Counties Affected</span>
            <strong>{historicalCountyFeatures.length}</strong>
            <p>With disease history</p>
          </div>
          <div className="statCard">
            <span>Total Reports</span>
            <strong>{formatNumber(selectedDisease.recentWindow.positiveReports + selectedDisease.recentWindow.negativeReports)}</strong>
            <p>Positive and negative surveillance</p>
          </div>
          <div className="statCard">
            <span>4-Week Trend</span>
            <strong className={trendGrowth >= 0 ? "trendUp" : "trendDown"}>{trendGrowth >= 0 ? "+" : ""}{trendGrowth}%</strong>
            <p>Positive county growth rate</p>
          </div>
        </section>

        <section className="infoContent">
          <aside className="diseaseRail">
            <div className="railCard">
              <p className="railTitle">Diseases</p>
              {summary.diseases.map((disease, index) => {
                const selected = disease.subjectnumber === selectedDisease.subjectnumber;
                const color = DISEASE_COLORS[index % DISEASE_COLORS.length];
                return (
                  <button
                    className={`diseaseButton ${selected ? "selected" : ""}`}
                    key={disease.subjectnumber}
                    onClick={() => setSelectedSubject(disease.subjectnumber)}
                  >
                    <i style={{ background: color, boxShadow: selected ? `0 0 0 3px ${color}22` : "none" }} />
                    <span>
                      <strong>{displayDiseaseName(disease)}</strong>
                      <em>{disease.scientificname ?? "Unknown pathogen"}</em>
                    </span>
                    {selected && <b>{riskLevel(maxEmergenceScore)}</b>}
                  </button>
                );
              })}
            </div>
            <div className="aboutCard">
              <p>About</p>
              <span>
                Emerging signal is based on recent positives, new county detections, reviewed reports, and negative surveillance evidence.
              </span>
              <label>
                Score threshold {threshold.toFixed(2)}
                <input min="0" max="1" step="0.01" type="range" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} />
              </label>
            </div>
          </aside>

          <section className="mapAndDetail">
            <div className="mapCard">
              <div className="mapHeader">
                <div>
                  <h2>{displayDiseaseName(selectedDisease)} — County Hotspot Map</h2>
                  <p>
                    {historicalCountyFeatures.length} counties with history · {selectedDisease.recentWindow.days}-day emergence window · click any county
                  </p>
                </div>
                <span className={`riskPill ${riskLevel(maxEmergenceScore).toLowerCase()}`}>{riskLevel(maxEmergenceScore)}</span>
              </div>
              <DeckGL initialViewState={INITIAL_VIEW_STATE} controller layers={layers}>
                <MapLibreMap mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json" reuseMaps />
              </DeckGL>
              <div className="severityLegend">
                <p>Emergence class</p>
                <div>
                  <span><i style={{ background: rgb(STATUS_COLORS["negative-surveillance"]) }} /> Surveillance</span>
                  <span><i style={{ background: rgb(STATUS_COLORS["recent-positive"]) }} /> Recent positive</span>
                  <span><i style={{ background: rgb(STATUS_COLORS["new-positive-county"]) }} /> New county</span>
                </div>
              </div>
              {mapTooltip && (
                <div className="mapTooltip" style={{ left: mapTooltip.x + 14, top: mapTooltip.y + 14 }}>
                  <strong>{mapTooltip.metric.county} County</strong>
                  <span>{mapTooltip.metric.state}</span>
                  <p>{mapTooltip.metric.positiveCount} positive · {mapTooltip.metric.negativeCount} negative</p>
                </div>
              )}
            </div>

            <aside className="countyPanel">
              {selectedCountyMetric ? (
                <>
                  <div className="countyPanelHeader">
                    <div>
                      <p>{selectedCountyMetric.state}</p>
                      <h3>{selectedCountyMetric.county} County</h3>
                    </div>
                    <button onClick={() => setSelectedFips(null)}>×</button>
                  </div>
                  <div className="severityBlock">
                    <span>Emergence score</span>
                    <strong style={{ color: diseaseColor }}>{formatNumber(selectedCountyMetric.emergenceScore, 2)}</strong>
                    <div><i style={{ width: `${Math.min(100, selectedCountyMetric.emergenceScore * 100)}%`, background: diseaseColor }} /></div>
                  </div>
                  <div className="countyStats">
                    <span><b>{selectedCountyMetric.positiveCount}</b>Positive reports</span>
                    <span><b>{selectedCountyMetric.negativeCount}</b>Negative reports</span>
                    <span><b>{selectedCountyMetric.reviewedCount}</b>Reviewed</span>
                    <span><b>{selectedCountyMetric.latestObserved ?? "n/a"}</b>Latest</span>
                  </div>
                  <p className="countyFlag">{selectedCountyMetric.whyFlagged}</p>
                  <div className="miniChart">
                    <p>County positive report trend</p>
                    <ResponsiveContainer width="100%" height={82}>
                      <BarChart data={countySparkData} barCategoryGap="25%">
                        <Bar dataKey="reports" radius={[3, 3, 0, 0]}>
                          {countySparkData.map((_, index) => (
                            <Cell key={index} fill={index === countySparkData.length - 1 ? diseaseColor : `${diseaseColor}66`} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              ) : (
                <div className="emptyCounty">
                  <strong>Select a county</strong>
                  <p>Click a highlighted county to inspect recent reports and historical activity.</p>
                </div>
              )}
            </aside>
          </section>
        </section>

        <section className="bottomAnalytics">
          <div className="chartCard wide">
            <div className="chartHeader">
              <div>
                <h2>Recent Hotspot Trend — {displayDiseaseName(selectedDisease)}</h2>
                <p>Weekly positive county count in the latest {selectedDisease.recentWindow.days} days</p>
              </div>
              <span style={{ background: `${diseaseColor}18`, color: diseaseColor }}>{trendGrowth >= 0 ? "+" : ""}{trendGrowth}%</span>
            </div>
            <ResponsiveContainer width="100%" height={130}>
              <AreaChart data={trendChartData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="recentTrendGradient" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="5%" stopColor={diseaseColor} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={diseaseColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(0,0,0,0.05)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: "#6E6E73" }} tickLine={false} axisLine={false} interval={2} />
                <YAxis tick={{ fontSize: 10, fill: "#6E6E73" }} tickLine={false} axisLine={false} />
                <RechartTooltip />
                <Area type="monotone" dataKey="hotspots" stroke={diseaseColor} strokeWidth={2} fill="url(#recentTrendGradient)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="chartCard history">
            <div className="chartHeader">
              <div>
                <h2>Historical Baseline</h2>
                <p>{historyMode === "annual" ? "Binned by year" : "Binned by 60-day period"}</p>
              </div>
              <div className="modeToggle">
                <button className={historyMode === "annual" ? "active" : ""} onClick={() => setHistoryMode("annual")}>Year</button>
                <button className={historyMode === "period" ? "active" : ""} onClick={() => setHistoryMode("period")}>60d</button>
              </div>
            </div>
            <div className="historyBars">
              {historyBins.map((row) => (
                <div className={`historyBarRow ${row.isRecentWindow ? "recentBin" : ""}`} key={`${historyMode}-${row.label}`}>
                  <span title={`${row.from} to ${row.to}`}>{historyMode === "annual" ? row.label : row.from.slice(5)}</span>
                  <div>
                    <i className="positiveBar" style={{ width: `${(row.positiveReports / maxHistory) * 100}%` }} />
                    <i className="negativeBar" style={{ width: `${(row.negativeReports / maxHistory) * 100}%` }} />
                  </div>
                  <strong>{row.positiveReports} / {row.negativeReports}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="infoFooter">
        <span>USDA NIFA Grant A1713 · Emerging Crop Disease Surveillance Program</span>
        <span>Data: Bugwood / EDDMapS-style surveillance · Updated {summary.generatedAt.slice(0, 10)}</span>
      </footer>
    </div>
  );
}
