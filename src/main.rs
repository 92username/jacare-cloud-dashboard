use std::{
    collections::HashMap,
    env,
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    sync::Arc,
    time::Duration,
};

use anyhow::{Context, Result};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use chrono::{DateTime, Datelike, Days, TimeZone, Timelike, Utc};
use chrono_tz::America::Sao_Paulo;
use reqwest::Client;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::RwLock;
use tower_http::{services::ServeDir, trace::TraceLayer};
use tracing::{error, info, warn};

const SBJR_LAT: f64 = -22.9875;
const SBJR_LON: f64 = -43.3700;
const NORTH: f64 = -22.9390;
const SOUTH: f64 = -23.0650;
const WEST: f64 = -43.4750;
const EAST: f64 = -43.2600;
const MAX_ALTITUDE_FT: f64 = 6000.0;
type PhotoCache = Arc<RwLock<HashMap<String, (DateTime<Utc>, Value)>>>;

#[derive(Clone)]
struct AppState {
    live: Arc<RwLock<LiveResponse>>,
    db_path: PathBuf,
    client: Client,
    photo_cache: PhotoCache,
    demo: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
struct LiveResponse {
    generated_at: String,
    source: String,
    demo: bool,
    schedule_active: bool,
    aircraft: Vec<Aircraft>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Aircraft {
    hex: String,
    flight: Option<String>,
    registration: Option<String>,
    aircraft_type: Option<String>,
    lat: f64,
    lon: f64,
    altitude_ft: f64,
    ground_speed_kt: Option<f64>,
    track_deg: Option<f64>,
    vertical_rate_fpm: Option<f64>,
    seen_seconds: f64,
    on_ground: bool,
}

#[derive(Debug, Clone)]
struct TrackState {
    last: Aircraft,
    was_inner: bool,
    was_ground: bool,
    approach_seen: bool,
    last_event_at: Option<DateTime<Utc>>,
    last_seen_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
struct AdsbResponse {
    #[serde(default)]
    ac: Vec<AdsbAircraft>,
}

#[derive(Debug, Deserialize)]
struct AdsbAircraft {
    hex: Option<String>,
    flight: Option<String>,
    r: Option<String>,
    t: Option<String>,
    lat: Option<f64>,
    lon: Option<f64>,
    alt_baro: Option<Altitude>,
    alt_geom: Option<f64>,
    gs: Option<f64>,
    track: Option<f64>,
    baro_rate: Option<f64>,
    geom_rate: Option<f64>,
    seen: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum Altitude {
    Number(f64),
    Text(String),
}

#[derive(Debug, Serialize)]
struct Event {
    id: i64,
    occurred_at: String,
    kind: String,
    confidence: String,
    hex: String,
    registration: Option<String>,
    flight: Option<String>,
    aircraft_type: Option<String>,
    altitude_ft: f64,
}

#[derive(Debug, Deserialize)]
struct EventQuery {
    limit: Option<usize>,
}

#[tokio::main]
async fn main() -> Result<()> {
    if env::args().any(|arg| arg == "--healthcheck") {
        healthcheck_cli()?;
        return Ok(());
    }
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let bind = env::var("JACARE_BIND").unwrap_or_else(|_| "0.0.0.0:8080".into());
    let static_dir = env::var("JACARE_STATIC_DIR").unwrap_or_else(|_| "dashboard-v1".into());
    let data_dir = PathBuf::from(env::var("JACARE_DATA_DIR").unwrap_or_else(|_| "./var".into()));
    let demo = env_flag("JACARE_DEMO");
    std::fs::create_dir_all(&data_dir).context("criando diretório persistente")?;
    let db_path = data_dir.join("traffic.sqlite3");
    init_db(&db_path)?;

    let client = Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent("JacareCloud/2.0 (+https://jacare.cloud)")
        .build()?;
    let initial = if demo {
        demo_live()
    } else {
        LiveResponse::default()
    };
    let state = AppState {
        live: Arc::new(RwLock::new(initial)),
        db_path,
        client,
        photo_cache: Arc::new(RwLock::new(HashMap::new())),
        demo,
    };

    tokio::spawn(collector(state.clone()));

    let api = Router::new()
        .route("/live", get(live))
        .route("/events", get(events))
        .route("/stats", get(stats))
        .route("/photo/{hex}", get(photo));

    let app = Router::new()
        .route("/healthz", get(health))
        .nest("/api/traffic", api)
        .fallback_service(ServeDir::new(static_dir).append_index_html_on_directories(true))
        .layer(TraceLayer::new_for_http())
        .with_state(state.clone());

    let address: SocketAddr = bind.parse().context("JACARE_BIND inválido")?;
    let listener = tokio::net::TcpListener::bind(address).await?;
    info!(%address, demo, "Jacaré Cloud iniciado");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

fn healthcheck_cli() -> Result<()> {
    let mut stream = TcpStream::connect_timeout(
        &"127.0.0.1:8080".parse().expect("endereço fixo válido"),
        Duration::from_secs(2),
    )?;
    stream.write_all(b"GET /healthz HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")?;
    let mut response = String::new();
    stream.read_to_string(&mut response)?;
    anyhow::ensure!(
        response.starts_with("HTTP/1.1 200"),
        "health check sem HTTP 200"
    );
    Ok(())
}

async fn collector(state: AppState) {
    let mut tracks: HashMap<String, TrackState> = HashMap::new();
    let mut interval = tokio::time::interval(Duration::from_secs(20));
    loop {
        interval.tick().await;
        if state.demo {
            *state.live.write().await = demo_live();
            continue;
        }
        let active = schedule_active();
        if !active {
            let mut live = state.live.write().await;
            live.schedule_active = false;
            live.generated_at = Utc::now().to_rfc3339();
            live.aircraft.clear();
            continue;
        }
        match fetch_aircraft(&state.client).await {
            Ok(aircraft) => {
                if let Err(err) = persist_and_detect(&state.db_path, &aircraft, &mut tracks) {
                    error!(%err, "falha ao persistir posições");
                }
                *state.live.write().await = LiveResponse {
                    generated_at: Utc::now().to_rfc3339(),
                    source: "adsb.lol".into(),
                    demo: false,
                    schedule_active: true,
                    aircraft,
                };
            }
            Err(err) => warn!(%err, "consulta ADS-B falhou; mantendo última amostra"),
        }
        if Utc::now().minute() == 1
            && let Err(err) = cleanup(&state.db_path)
        {
            warn!(%err, "limpeza de trajetórias falhou");
        }
    }
}

async fn fetch_aircraft(client: &Client) -> Result<Vec<Aircraft>> {
    let url = format!("https://api.adsb.lol/v2/lat/{SBJR_LAT}/lon/{SBJR_LON}/dist/12");
    let response = client.get(url).send().await?.error_for_status()?;
    let payload: AdsbResponse = response.json().await?;
    Ok(payload
        .ac
        .into_iter()
        .filter_map(normalize_aircraft)
        .collect())
}

fn normalize_aircraft(raw: AdsbAircraft) -> Option<Aircraft> {
    let lat = raw.lat?;
    let lon = raw.lon?;
    if !(SOUTH..=NORTH).contains(&lat) || !(WEST..=EAST).contains(&lon) {
        return None;
    }
    let (altitude_ft, on_ground) = match raw.alt_baro {
        Some(Altitude::Number(value)) => (value, false),
        Some(Altitude::Text(value)) if value.eq_ignore_ascii_case("ground") => (0.0, true),
        _ => (raw.alt_geom?, false),
    };
    if altitude_ft >= MAX_ALTITUDE_FT || raw.seen.unwrap_or(999.0) > 60.0 {
        return None;
    }
    Some(Aircraft {
        hex: raw.hex?.trim().to_lowercase(),
        flight: clean(raw.flight),
        registration: clean(raw.r),
        aircraft_type: clean(raw.t),
        lat,
        lon,
        altitude_ft,
        ground_speed_kt: raw.gs,
        track_deg: raw.track,
        vertical_rate_fpm: raw.baro_rate.or(raw.geom_rate),
        seen_seconds: raw.seen.unwrap_or_default(),
        on_ground,
    })
}

fn clean(value: Option<String>) -> Option<String> {
    value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn persist_and_detect(
    path: &PathBuf,
    aircraft: &[Aircraft],
    tracks: &mut HashMap<String, TrackState>,
) -> Result<()> {
    let mut conn = Connection::open(path)?;
    let tx = conn.transaction()?;
    let now = Utc::now();
    for plane in aircraft {
        tx.execute(
            "INSERT INTO positions(observed_at, hex, lat, lon, altitude_ft, ground_speed_kt, track_deg, vertical_rate_fpm) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![now.to_rfc3339(), plane.hex, plane.lat, plane.lon, plane.altitude_ft, plane.ground_speed_kt, plane.track_deg, plane.vertical_rate_fpm],
        )?;
        let distance = distance_nm(plane.lat, plane.lon, SBJR_LAT, SBJR_LON);
        let inner = distance <= 1.2;
        let descending = plane.vertical_rate_fpm.unwrap_or_default() < -150.0;
        let climbing = plane.vertical_rate_fpm.unwrap_or_default() > 150.0;
        let mut event_kind = None;
        let mut confidence = "provável";
        if let Some(previous) = tracks.get(&plane.hex) {
            let cooldown_ok = previous
                .last_event_at
                .is_none_or(|at| now.signed_duration_since(at).num_minutes() >= 20);
            if cooldown_ok
                && previous.approach_seen
                && inner
                && (plane.on_ground || plane.altitude_ft < 350.0)
            {
                event_kind = Some("arrival");
                confidence = if plane.on_ground {
                    "confirmado"
                } else {
                    "provável"
                };
            } else if cooldown_ok
                && previous.was_inner
                && (previous.was_ground || previous.last.altitude_ft < 250.0)
                && distance > 1.2
                && climbing
                && plane.altitude_ft > previous.last.altitude_ft
            {
                event_kind = Some("departure");
                confidence = "confirmado";
            }
        }
        if let Some(kind) = event_kind {
            tx.execute(
                "INSERT INTO events(occurred_at, kind, confidence, hex, registration, flight, aircraft_type, altitude_ft) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
                params![now.to_rfc3339(), kind, confidence, plane.hex, plane.registration, plane.flight, plane.aircraft_type, plane.altitude_ft],
            )?;
        }
        let approach_seen = if event_kind.is_some() {
            false
        } else {
            tracks.get(&plane.hex).is_some_and(|t| t.approach_seen)
                || (distance < 5.0 && descending && plane.altitude_ft < 3000.0)
        };
        tracks.insert(
            plane.hex.clone(),
            TrackState {
                last: plane.clone(),
                was_inner: inner,
                was_ground: plane.on_ground,
                approach_seen,
                last_event_at: event_kind
                    .map(|_| now)
                    .or_else(|| tracks.get(&plane.hex).and_then(|t| t.last_event_at)),
                last_seen_at: now,
            },
        );
    }
    tracks.retain(|_, track| now.signed_duration_since(track.last_seen_at).num_minutes() < 30);
    tx.commit()?;
    Ok(())
}

fn init_db(path: &PathBuf) -> Result<()> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS positions(id INTEGER PRIMARY KEY, observed_at TEXT NOT NULL, hex TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL, altitude_ft REAL NOT NULL, ground_speed_kt REAL, track_deg REAL, vertical_rate_fpm REAL);
         CREATE INDEX IF NOT EXISTS positions_time_idx ON positions(observed_at);
         CREATE INDEX IF NOT EXISTS positions_hex_idx ON positions(hex, observed_at);
         CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, occurred_at TEXT NOT NULL, kind TEXT NOT NULL, confidence TEXT NOT NULL, hex TEXT NOT NULL, registration TEXT, flight TEXT, aircraft_type TEXT, altitude_ft REAL NOT NULL);
         CREATE INDEX IF NOT EXISTS events_time_idx ON events(occurred_at);
         CREATE INDEX IF NOT EXISTS events_kind_idx ON events(kind, occurred_at);"
    )?;
    Ok(())
}

fn cleanup(path: &PathBuf) -> Result<()> {
    let conn = Connection::open(path)?;
    let cutoff = (Utc::now() - chrono::Duration::days(30)).to_rfc3339();
    conn.execute("DELETE FROM positions WHERE observed_at < ?1", [cutoff])?;
    Ok(())
}

async fn live(State(state): State<AppState>) -> Json<LiveResponse> {
    Json(state.live.read().await.clone())
}

async fn events(
    State(state): State<AppState>,
    Query(query): Query<EventQuery>,
) -> Result<Json<Value>, ApiError> {
    let limit = query.limit.unwrap_or(10).clamp(1, 100) as i64;
    let conn = Connection::open(&state.db_path)?;
    let read = |kind: &str| -> rusqlite::Result<Vec<Event>> {
        let mut stmt = conn.prepare("SELECT id, occurred_at, kind, confidence, hex, registration, flight, aircraft_type, altitude_ft FROM events WHERE kind=?1 ORDER BY occurred_at DESC LIMIT ?2")?;
        let rows = stmt.query_map(params![kind, limit], |row| {
            Ok(Event {
                id: row.get(0)?,
                occurred_at: row.get(1)?,
                kind: row.get(2)?,
                confidence: row.get(3)?,
                hex: row.get(4)?,
                registration: row.get(5)?,
                flight: row.get(6)?,
                aircraft_type: row.get(7)?,
                altitude_ft: row.get(8)?,
            })
        })?;
        rows.collect()
    };
    let mut arrivals = read("arrival")?;
    let mut departures = read("departure")?;
    if state.demo && arrivals.is_empty() {
        arrivals = demo_events("arrival");
        departures = demo_events("departure");
    }
    Ok(Json(
        json!({ "arrivals": arrivals, "departures": departures }),
    ))
}

async fn stats(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    let conn = Connection::open(&state.db_path)?;
    let local_now = Utc::now().with_timezone(&Sao_Paulo);
    let local_date = local_now.date_naive();
    let next_date = local_date
        .checked_add_days(Days::new(1))
        .expect("data seguinte válida");
    let start = Sao_Paulo
        .with_ymd_and_hms(
            local_date.year(),
            local_date.month(),
            local_date.day(),
            0,
            0,
            0,
        )
        .single()
        .expect("meia-noite BRT válida")
        .with_timezone(&Utc)
        .to_rfc3339();
    let end = Sao_Paulo
        .with_ymd_and_hms(
            next_date.year(),
            next_date.month(),
            next_date.day(),
            0,
            0,
            0,
        )
        .single()
        .expect("meia-noite BRT válida")
        .with_timezone(&Utc)
        .to_rfc3339();
    let day = local_date.format("%Y-%m-%d").to_string();
    let mut stmt = conn.prepare("SELECT kind, COUNT(*), COUNT(DISTINCT hex) FROM events WHERE occurred_at>=?1 AND occurred_at<?2 GROUP BY kind")?;
    let rows: Vec<(String, i64, i64)> = stmt
        .query_map(params![start, end], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    let mut arrivals = 0;
    let mut departures = 0;
    let mut distinct = 0;
    for (kind, count, aircraft) in rows {
        if kind == "arrival" {
            arrivals = count;
        } else {
            departures = count;
        }
        distinct += aircraft;
    }
    if state.demo && arrivals + departures == 0 {
        arrivals = 18;
        departures = 21;
        distinct = 27;
    }
    Ok(Json(
        json!({ "date": day, "arrivals": arrivals, "departures": departures, "movements": arrivals + departures, "distinct_aircraft": distinct }),
    ))
}

async fn photo(
    State(state): State<AppState>,
    Path(hex): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let hex = hex.trim().to_lowercase();
    if !hex.chars().all(|c| c.is_ascii_hexdigit()) || !(6..=7).contains(&hex.len()) {
        return Err(ApiError::bad_request("hex ICAO inválido"));
    }
    if let Some((cached_at, value)) = state.photo_cache.read().await.get(&hex)
        && Utc::now().signed_duration_since(*cached_at).num_hours() < 24
    {
        return Ok(Json(value.clone()));
    }
    if state.demo {
        return Ok(Json(json!({"photos": []})));
    }
    let url = format!("https://api.planespotters.net/pub/photos/hex/{hex}");
    let value: Value = state
        .client
        .get(url)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    state
        .photo_cache
        .write()
        .await
        .insert(hex, (Utc::now(), value.clone()));
    Ok(Json(value))
}

async fn health(State(state): State<AppState>) -> Json<Value> {
    Json(json!({"status":"ok", "demo": state.demo, "time": Utc::now().to_rfc3339()}))
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    message: String,
}
impl ApiError {
    fn bad_request(message: &str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: message.into(),
        }
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        (self.status, Json(json!({"error": self.message}))).into_response()
    }
}
impl From<rusqlite::Error> for ApiError {
    fn from(value: rusqlite::Error) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: value.to_string(),
        }
    }
}
impl From<reqwest::Error> for ApiError {
    fn from(value: reqwest::Error) -> Self {
        Self {
            status: StatusCode::BAD_GATEWAY,
            message: value.to_string(),
        }
    }
}

fn schedule_active() -> bool {
    let local = Utc::now().with_timezone(&Sao_Paulo);
    let minutes = local.hour() * 60 + local.minute();
    (6 * 60 + 15..=20 * 60).contains(&minutes)
}

fn distance_nm(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let radius_nm = 3440.065;
    let dlat = (lat2 - lat1).to_radians();
    let dlon = (lon2 - lon1).to_radians();
    let a = (dlat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (dlon / 2.0).sin().powi(2);
    radius_nm * 2.0 * a.sqrt().atan2((1.0 - a).sqrt())
}

fn demo_live() -> LiveResponse {
    let aircraft = vec![
        demo_plane(
            "e495af", "PR-AJV", "AJV221", "C208", -22.973, -43.393, 1250.0, 102.0, 92.0, -420.0,
        ),
        demo_plane(
            "e48f12", "PP-MMB", "MMB17", "H145", -23.014, -43.338, 850.0, 88.0, 244.0, 100.0,
        ),
        demo_plane(
            "e4a021", "PR-VCT", "VCT403", "E50P", -23.047, -43.425, 3720.0, 198.0, 58.0, 780.0,
        ),
        demo_plane(
            "e493c3", "PT-WCP", "", "AS50", -23.027, -43.293, 620.0, 74.0, 272.0, 0.0,
        ),
    ];
    LiveResponse {
        generated_at: Utc::now().to_rfc3339(),
        source: "demonstração local".into(),
        demo: true,
        schedule_active: true,
        aircraft,
    }
}

#[allow(clippy::too_many_arguments)]
fn demo_plane(
    hex: &str,
    reg: &str,
    flight: &str,
    kind: &str,
    lat: f64,
    lon: f64,
    alt: f64,
    speed: f64,
    track: f64,
    vr: f64,
) -> Aircraft {
    Aircraft {
        hex: hex.into(),
        registration: Some(reg.into()),
        flight: clean(Some(flight.into())),
        aircraft_type: Some(kind.into()),
        lat,
        lon,
        altitude_ft: alt,
        ground_speed_kt: Some(speed),
        track_deg: Some(track),
        vertical_rate_fpm: Some(vr),
        seen_seconds: 1.0,
        on_ground: false,
    }
}

fn demo_events(kind: &str) -> Vec<Event> {
    let base = if kind == "arrival" { 0 } else { 8 };
    (0..5)
        .map(|i| Event {
            id: i + base,
            occurred_at: (Utc::now() - chrono::Duration::minutes(i * 17 + base)).to_rfc3339(),
            kind: kind.into(),
            confidence: if i == 3 {
                "provável".into()
            } else {
                "confirmado".into()
            },
            hex: format!("e49{:03x}", i + base),
            registration: Some(format!(
                "PR-{}{}{}",
                (b'A' + i as u8) as char,
                (b'J' + i as u8) as char,
                (b'V' + i as u8) as char
            )),
            flight: None,
            aircraft_type: Some(if i % 2 == 0 { "C208" } else { "H145" }.into()),
            altitude_ft: 120.0,
        })
        .collect()
}

fn env_flag(name: &str) -> bool {
    env::var(name).is_ok_and(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(altitude: Altitude, lat: f64, lon: f64) -> AdsbAircraft {
        AdsbAircraft {
            hex: Some("e40001".into()),
            flight: Some(" TEST1 ".into()),
            r: Some("PR-TST".into()),
            t: Some("C208".into()),
            lat: Some(lat),
            lon: Some(lon),
            alt_baro: Some(altitude),
            alt_geom: None,
            gs: Some(100.0),
            track: Some(90.0),
            baro_rate: Some(-300.0),
            geom_rate: None,
            seen: Some(1.0),
        }
    }

    #[test]
    fn accepts_aircraft_below_six_thousand_feet() {
        let plane = normalize_aircraft(raw(Altitude::Number(5999.0), SBJR_LAT, SBJR_LON))
            .expect("aeronave deveria passar pelo filtro");
        assert_eq!(plane.flight.as_deref(), Some("TEST1"));
        assert_eq!(plane.altitude_ft, 5999.0);
    }

    #[test]
    fn rejects_aircraft_at_six_thousand_feet() {
        assert!(normalize_aircraft(raw(Altitude::Number(6000.0), SBJR_LAT, SBJR_LON)).is_none());
    }

    #[test]
    fn rejects_aircraft_outside_map_bounds() {
        assert!(
            normalize_aircraft(raw(Altitude::Number(1000.0), NORTH + 0.01, SBJR_LON)).is_none()
        );
    }

    #[test]
    fn accepts_ground_altitude() {
        let plane = normalize_aircraft(raw(Altitude::Text("ground".into()), SBJR_LAT, SBJR_LON))
            .expect("aeronave no solo deveria ser exibida");
        assert!(plane.on_ground);
        assert_eq!(plane.altitude_ft, 0.0);
    }

    #[test]
    fn distance_at_same_point_is_zero() {
        assert!(distance_nm(SBJR_LAT, SBJR_LON, SBJR_LAT, SBJR_LON) < 0.001);
    }
}
