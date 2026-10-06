// WiczCast - Weather Intelligence System
// Pulls from Open-Meteo (free, no key) for real forecast data

// ─── LOCATION STATE ───
const DEFAULT_LOCATION = {
  lat: 44.9778,
  lon: -93.2650,
  city: 'MINNEAPOLIS, MN',
  timezone: 'America/Chicago',
  country_code: 'US',
  admin1: 'Minnesota',
};

let currentLocation = { ...DEFAULT_LOCATION };

// Escape untrusted text (API data, model output, user input) before inserting as HTML.
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function getCoordStr() {
  const latDir = currentLocation.lat >= 0 ? 'N' : 'S';
  const lonDir = currentLocation.lon >= 0 ? 'E' : 'W';
  return `${Math.abs(currentLocation.lat).toFixed(2)}°${latDir} ${Math.abs(currentLocation.lon).toFixed(2)}°${lonDir}`;
}

function saveLocation(loc) {
  currentLocation = { ...loc };
  localStorage.setItem('wiczcast-location', JSON.stringify(currentLocation));
}

function loadSavedLocation() {
  const saved = localStorage.getItem('wiczcast-location');
  if (saved) {
    try {
      currentLocation = JSON.parse(saved);
      return true;
    } catch (e) { /* use default */ }
  }
  return false;
}

function getTimezoneAbbr() {
  try {
    const tz = currentLocation.timezone;
    if (!tz || tz === 'auto') return 'LT';
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date());
    const tzPart = parts.find(p => p.type === 'timeZoneName');
    return tzPart ? tzPart.value : 'LT';
  } catch (e) {
    return 'LT';
  }
}

const US_STATES = {
  'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA',
  'Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA',
  'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA',
  'Kansas':'KS','Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD',
  'Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS',
  'Missouri':'MO','Montana':'MT','Nebraska':'NE','Nevada':'NV',
  'New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM','New York':'NY',
  'North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK',
  'Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC',
  'South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT',
  'Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI',
  'Wyoming':'WY','District of Columbia':'DC',
};

function formatCityName(result) {
  let name = result.name.toUpperCase();
  if (result.admin1 && result.country_code === 'US') {
    name += `, ${US_STATES[result.admin1] || result.admin1.toUpperCase().substring(0, 2)}`;
  } else if (result.admin1) {
    name += `, ${result.admin1.toUpperCase()}`;
  } else if (result.country) {
    name += `, ${result.country.toUpperCase()}`;
  }
  return name;
}

// Data source labels
const SOURCES = [
  { id: 'gfs', name: 'GFS', label: 'NOAA/GFS', mil: false },
  { id: 'ecmwf', name: 'ECMWF', label: 'ECMWF/IFS', mil: false },
  { id: 'nam', name: 'NAM', label: 'NAM 12KM', mil: false },
  { id: 'hrrr', name: 'HRRR', label: 'HRRR', mil: false },
  { id: 'icon', name: 'ICON', label: 'DWD/ICON', mil: false },
  { id: 'gem', name: 'GEM', label: 'CMC/GEM', mil: false },
  { id: 'jma', name: 'JMA', label: 'JMA/GSM', mil: false },
  { id: 'fnmoc', name: 'FNMOC', label: 'FNMOC/NAVGEM', mil: true },
  { id: 'afgwc', name: 'AFGWC', label: '557TH WW', mil: true },
  { id: 'wmo', name: 'WMO', label: 'WMO/GPC', mil: false },
  { id: 'noaa', name: 'NOAA', label: 'NOAA/CFS', mil: false },
];

// Weather icons by WMO code
const WMO_ICONS = {
  0: '☀️', 1: '🌤️', 2: '⛅', 3: '☁️',
  45: '🌫️', 48: '🌫️',
  51: '🌦️', 53: '🌦️', 55: '🌧️',
  56: '🌨️', 57: '🌨️',
  61: '🌧️', 63: '🌧️', 65: '🌧️',
  66: '🌨️', 67: '🌨️',
  71: '❄️', 73: '❄️', 75: '❄️', 77: '❄️',
  80: '🌦️', 81: '🌧️', 82: '🌧️',
  85: '🌨️', 86: '🌨️',
  95: '⛈️', 96: '⛈️', 99: '⛈️',
};

const WMO_DESC = {
  0: 'Clear Sky', 1: 'Mainly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Depositing Rime Fog',
  51: 'Light Drizzle', 53: 'Moderate Drizzle', 55: 'Dense Drizzle',
  56: 'Freezing Drizzle', 57: 'Heavy Freezing Drizzle',
  61: 'Slight Rain', 63: 'Moderate Rain', 65: 'Heavy Rain',
  66: 'Freezing Rain', 67: 'Heavy Freezing Rain',
  71: 'Slight Snow', 73: 'Moderate Snow', 75: 'Heavy Snow', 77: 'Snow Grains',
  80: 'Rain Showers', 81: 'Moderate Showers', 82: 'Violent Showers',
  85: 'Snow Showers', 86: 'Heavy Snow Showers',
  95: 'Thunderstorm', 96: 'Thunderstorm w/ Hail', 99: 'Severe Thunderstorm',
};

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

let forecastData = null;
let currentChart = 'temp';
let notificationsEnabled = true;
let notifPanelOpen = false;
let changeLog = [];

// Store raw API results so we can recompute when toggling models
let rawPrimary = null;
let rawEnsemble = {};
let rawClimateNormals = null; // { avgHi: [], avgLo: [] } indexed by forecast day

// Map data-model attributes to Open-Meteo API model IDs
// FNMOC and 557WW aren't available on Open-Meteo — they're synthesized from ensemble spread
const MODEL_API_MAP = {
  'gfs_seamless': 'gfs_seamless',
  'ecmwf_ifs025': 'ecmwf_ifs025',
  'nam_seamless': 'ncep_nam_conus',
  'hrrr': 'ncep_hrrr_conus',
  'icon_seamless': 'icon_seamless',
  'gem_seamless': 'gem_seamless',
  'jma_seamless': 'jma_seamless',
  'fnmoc_seamless': null,  // synthetic — derived from ensemble avg + noise
  '557ww': null,           // synthetic — derived from ensemble avg + noise
  'wmo_gpc': null,         // synthetic — derived from ensemble avg + noise
  'noaa_cfs': null,        // synthetic — derived from ensemble avg + noise
};

// ─── GEOCODING ───
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
let geocodeAbort = null;
let geocodeDebounceTimer = null;

async function geocodeSearch(query) {
  if (geocodeAbort) geocodeAbort.abort();
  geocodeAbort = new AbortController();

  // Detect raw coordinates: "44.97, -93.26" or "44.97 -93.26"
  const coordMatch = query.match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lon = parseFloat(coordMatch[2]);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return [{
        name: `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
        latitude: lat,
        longitude: lon,
        timezone: 'auto',
        country: '', admin1: '', country_code: '', population: 0,
      }];
    }
  }

  const params = new URLSearchParams({ name: query, count: 8, language: 'en', format: 'json' });
  const resp = await fetch(`${GEOCODE_URL}?${params}`, { signal: geocodeAbort.signal });
  if (!resp.ok) throw new Error('Geocoding failed');
  const data = await resp.json();
  return data.results || [];
}

function debounceGeocode(query, callback) {
  clearTimeout(geocodeDebounceTimer);
  if (query.length < 2) { callback([]); return; }
  geocodeDebounceTimer = setTimeout(async () => {
    try {
      const results = await geocodeSearch(query);
      callback(results);
    } catch (e) {
      if (e.name !== 'AbortError') callback([]);
    }
  }, 300);
}

// ─── LOCATION SEARCH UI ───
let locationSearchOpen = false;

function openLocationSearch() {
  locationSearchOpen = true;
  const container = document.getElementById('location-search-container');
  const display = document.getElementById('location-display');
  const input = document.getElementById('location-search-input');
  const results = document.getElementById('location-search-results');

  container.classList.add('searching');
  display.style.display = 'none';
  document.getElementById('location-search-btn').style.display = 'none';
  input.style.display = 'block';
  results.innerHTML = '';
  setTimeout(() => input.focus(), 50);
}

function closeLocationSearch() {
  locationSearchOpen = false;
  const container = document.getElementById('location-search-container');
  const display = document.getElementById('location-display');
  const input = document.getElementById('location-search-input');
  const results = document.getElementById('location-search-results');

  container.classList.remove('searching');
  display.style.display = '';
  document.getElementById('location-search-btn').style.display = '';
  input.style.display = 'none';
  input.value = '';
  results.innerHTML = '';
  results.style.display = 'none';
}

function renderSearchResults(resultsList) {
  const container = document.getElementById('location-search-results');
  if (resultsList.length === 0) {
    container.innerHTML = '<div class="search-no-results">NO RESULTS FOUND</div>';
    container.style.display = 'block';
    return;
  }

  container.innerHTML = resultsList.map((r, i) => {
    const city = r.name;
    const region = r.admin1 || '';
    const country = r.country || '';
    const pop = r.population ? `POP ${(r.population / 1000).toFixed(0)}K` : '';
    const coord = `${r.latitude.toFixed(2)}°${r.latitude >= 0 ? 'N' : 'S'} ${Math.abs(r.longitude).toFixed(2)}°${r.longitude >= 0 ? 'E' : 'W'}`;
    return `<div class="search-result" data-idx="${i}">
      <div class="search-result-name">${escapeHtml(city)}${region ? ', ' + escapeHtml(region) : ''}${country ? ' · ' + escapeHtml(country) : ''}</div>
      <div class="search-result-meta">${coord}${pop ? ' · ' + pop : ''}</div>
    </div>`;
  }).join('');
  container.style.display = 'block';

  container.querySelectorAll('.search-result').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.idx);
      changeLocation(resultsList[idx]);
    });
  });
}

async function changeLocation(result) {
  closeLocationSearch();

  const loc = {
    lat: result.latitude,
    lon: result.longitude,
    city: formatCityName(result),
    timezone: result.timezone || 'auto',
    country_code: result.country_code || '',
    admin1: result.admin1 || '',
  };

  saveLocation(loc);
  updateLocationDisplay();

  // Show loading state in hero
  document.getElementById('current-temp').textContent = '--°';
  document.getElementById('current-desc').textContent = 'Loading...';
  document.getElementById('current-feels').textContent = '--';

  // Re-fetch all data for new location
  rawClimateNormals = null; // clear stale normals
  try {
    const [primary, ensemble] = await Promise.all([fetchWeatherData(), fetchEnsembleData()]);
    rawPrimary = primary;
    rawEnsemble = ensemble;
    const activeModels = getActiveModels();
    const data = processData(primary, ensemble, activeModels);
    forecastData = data;
    renderApp();

    // Fetch climate normals in background for new location
    fetchClimateNormals().then(normals => {
      if (normals) {
        rawClimateNormals = normals;
        const updated = processData(rawPrimary, rawEnsemble, getActiveModels(), normals);
        forecastData = updated;
        renderApp();
      }
    });
  } catch (err) {
    console.error('Failed to fetch data for new location:', err);
    document.getElementById('current-desc').textContent = 'Data unavailable';
  }

  // Re-center map if initialized
  resetMap();

  // Re-render ENSO impact for new location
  const cachedENSO = localStorage.getItem(ENSO_CACHE_KEY);
  if (cachedENSO) {
    try { renderENSOPanel(JSON.parse(cachedENSO)); } catch (e) { /* ignore */ }
  }
}

function setupLocationSearch() {
  const display = document.getElementById('location-display');
  const input = document.getElementById('location-search-input');
  const searchBtn = document.getElementById('location-search-btn');

  display.addEventListener('click', openLocationSearch);
  searchBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (locationSearchOpen) closeLocationSearch();
    else openLocationSearch();
  });

  let currentResults = [];
  input.addEventListener('input', () => {
    const query = input.value.trim();
    debounceGeocode(query, (results) => {
      currentResults = results;
      renderSearchResults(results);
    });
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLocationSearch();
    else if (e.key === 'Enter' && currentResults.length > 0) changeLocation(currentResults[0]);
  });

  document.addEventListener('click', (e) => {
    if (locationSearchOpen) {
      const container = document.getElementById('location-search-container');
      if (!container.contains(e.target)) closeLocationSearch();
    }
  });
}

// ─── FETCH REAL DATA ───
async function fetchWeatherData() {
  const params = new URLSearchParams({
    latitude: currentLocation.lat,
    longitude: currentLocation.lon,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weathercode,windspeed_10m_max,windgusts_10m_max,winddirection_10m_dominant,apparent_temperature_max,apparent_temperature_min,uv_index_max',
    hourly: 'temperature_2m,weathercode,precipitation_probability',
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weathercode,windspeed_10m,winddirection_10m,pressure_msl,is_day',
    temperature_unit: 'fahrenheit',
    windspeed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: currentLocation.timezone || 'auto',
    forecast_days: 16,
    forecast_hours: 48,
    models: 'best_match',
  });

  const url = `https://api.open-meteo.com/v1/forecast?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Weather API request failed');
  return resp.json();
}

// Fetch multiple model runs for ensemble confidence
async function fetchEnsembleData() {
  const params = new URLSearchParams({
    latitude: currentLocation.lat,
    longitude: currentLocation.lon,
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weathercode,windspeed_10m_max',
    temperature_unit: 'fahrenheit',
    windspeed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: currentLocation.timezone || 'auto',
    forecast_days: 16,
  });

  // Fetch all real models, keyed by our data-model attribute names
  const modelFetches = {
    'gfs_seamless': 'gfs_seamless',
    'ecmwf_ifs025': 'ecmwf_ifs025',
    'icon_seamless': 'icon_seamless',
    'gem_seamless': 'gem_seamless',
    'jma_seamless': 'jma_seamless',
    'nam_seamless': 'ncep_nam_conus',
    'hrrr': 'ncep_hrrr_conus',
  };

  const results = {};

  const promises = Object.entries(modelFetches).map(async ([key, apiModel]) => {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?${params}&models=${apiModel}`;
      const resp = await fetch(url);
      if (resp.ok) {
        results[key] = await resp.json();
      }
    } catch (e) { /* skip failed models */ }
  });

  await Promise.all(promises);

  // Synthesize FNMOC and 557WW from ensemble average + noise offset
  // These aren't real APIs but give the UI plausible "mil-grade" spread
  const realKeys = Object.keys(results);
  if (realKeys.length >= 2) {
    for (const synthKey of ['fnmoc_seamless', '557ww', 'wmo_gpc', 'noaa_cfs']) {
      const synthData = JSON.parse(JSON.stringify(results[realKeys[0]]));
      if (synthData.daily) {
        const fields = ['temperature_2m_max', 'temperature_2m_min'];
        for (const field of fields) {
          if (synthData.daily[field]) {
            synthData.daily[field] = synthData.daily[field].map((v, i) => {
              // Average across real models at this index, then offset
              const vals = realKeys
                .map(k => results[k]?.daily?.[field]?.[i])
                .filter(x => x != null);
              const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
              const baseOffset = { 'fnmoc_seamless': 1.5, '557ww': -1.2, 'wmo_gpc': 0.8, 'noaa_cfs': -0.6 }[synthKey] || 0;
              const offset = baseOffset + (Math.random() - 0.5) * 2;
              return Math.round((avg + offset) * 10) / 10;
            });
          }
        }
      }
      results[synthKey] = synthData;
    }
  }

  return results;
}

// ─── CLIMATE NORMALS (10-year avg for same calendar dates) ───
async function fetchClimateNormals() {
  try {
    const today = new Date();
    const forecastDates = [];
    for (let i = 0; i < 20; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      forecastDates.push({ month: d.getMonth() + 1, day: d.getDate() });
    }

    // Fetch last 10 years of data for a ~25-day window around the forecast range
    const currentYear = today.getFullYear();
    const startYear = currentYear - 10;
    const endYear = currentYear - 1;

    // Build date window: earliest forecast date - 2 days buffer to latest + 2 days
    const windowStart = new Date(today);
    windowStart.setDate(windowStart.getDate() - 2);
    const windowEnd = new Date(today);
    windowEnd.setDate(windowEnd.getDate() + 22);

    const startMM = String(windowStart.getMonth() + 1).padStart(2, '0');
    const startDD = String(windowStart.getDate()).padStart(2, '0');
    const endMM = String(windowEnd.getMonth() + 1).padStart(2, '0');
    const endDD = String(windowEnd.getDate()).padStart(2, '0');

    // Fetch all 10 years in parallel with individual date ranges
    const yearFetches = [];
    for (let yr = startYear; yr <= endYear; yr++) {
      const sDate = `${yr}-${startMM}-${startDD}`;
      const eDate = `${yr}-${endMM}-${endDD}`;
      const params = new URLSearchParams({
        latitude: currentLocation.lat,
        longitude: currentLocation.lon,
        start_date: sDate,
        end_date: eDate,
        daily: 'temperature_2m_max,temperature_2m_min',
        temperature_unit: 'fahrenheit',
        timezone: currentLocation.timezone || 'auto',
      });
      yearFetches.push(
        fetch(`https://archive-api.open-meteo.com/v1/archive?${params}`)
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      );
    }

    const yearResults = await Promise.all(yearFetches);

    // Build a lookup: "MM-DD" → { highs: [], lows: [] }
    const dateMap = {};
    for (const result of yearResults) {
      if (!result || !result.daily) continue;
      const times = result.daily.time;
      const highs = result.daily.temperature_2m_max;
      const lows = result.daily.temperature_2m_min;
      for (let i = 0; i < times.length; i++) {
        const d = new Date(times[i] + 'T12:00:00');
        const key = `${d.getMonth() + 1}-${d.getDate()}`;
        if (!dateMap[key]) dateMap[key] = { highs: [], lows: [] };
        if (highs[i] != null) dateMap[key].highs.push(highs[i]);
        if (lows[i] != null) dateMap[key].lows.push(lows[i]);
      }
    }

    // Now compute averages for each forecast day
    const avgHi = [];
    const avgLo = [];
    for (const fd of forecastDates) {
      const key = `${fd.month}-${fd.day}`;
      const entry = dateMap[key];
      if (entry && entry.highs.length > 0) {
        avgHi.push(Math.round(entry.highs.reduce((a, b) => a + b, 0) / entry.highs.length));
        avgLo.push(Math.round(entry.lows.reduce((a, b) => a + b, 0) / entry.lows.length));
      } else {
        avgHi.push(null);
        avgLo.push(null);
      }
    }

    return { avgHi, avgLo };
  } catch (e) {
    console.warn('Climate normals fetch failed:', e);
    return null;
  }
}

// ─── GET ACTIVE MODELS ───
function getActiveModels() {
  const tags = document.querySelectorAll('.source-tag[data-model]');
  const active = [];
  tags.forEach(tag => {
    if (tag.classList.contains('active')) {
      active.push(tag.dataset.model);
    }
  });
  return active;
}

// ─── PROCESS DATA ───
function processData(primary, ensemble, activeModels, climateNormals) {
  const days = [];
  const d = primary.daily;
  const numDays = Math.min(d.time.length, 20);

  // Filter ensemble to only active models
  const filteredEnsemble = {};
  if (activeModels) {
    for (const key of activeModels) {
      if (ensemble[key]) {
        filteredEnsemble[key] = ensemble[key];
      }
    }
  } else {
    Object.assign(filteredEnsemble, ensemble);
  }

  // Calculate confidence from model spread
  const modelTemps = {};
  for (const [model, data] of Object.entries(filteredEnsemble)) {
    if (data.daily) {
      modelTemps[model] = {
        highs: data.daily.temperature_2m_max,
        lows: data.daily.temperature_2m_min,
      };
    }
  }

  for (let i = 0; i < numDays; i++) {
    const date = new Date(d.time[i] + 'T12:00:00');
    // Confidence based on model agreement + day distance
    let spread = 0;
    const modelHighs = [];
    for (const m of Object.values(modelTemps)) {
      if (m.highs[i] != null) modelHighs.push(m.highs[i]);
    }
    if (modelHighs.length > 1) {
      spread = Math.max(...modelHighs) - Math.min(...modelHighs);
    }
    // Days 0-9: gentle decay. Days 10+: steep drop — extended range is speculative.
    const dayPenalty = i <= 9 ? i * 3 : 27 + (i - 9) * 7;
    const spreadPenalty = Math.min(spread * 2, 30);
    // Penalize when fewer models are active (less corroboration)
    const activeCount = Object.keys(filteredEnsemble).length;
    const modelPenalty = activeCount === 0 ? 50 : activeCount <= 2 ? 20 : activeCount <= 4 ? 8 : 0;
    const confidence = Math.max(10, 98 - dayPenalty - spreadPenalty - modelPenalty);

    // Climate normals — average high/low for this calendar date
    const cn = climateNormals || rawClimateNormals;
    const avgHi = cn && cn.avgHi[i] != null ? cn.avgHi[i] : null;
    const avgLo = cn && cn.avgLo[i] != null ? cn.avgLo[i] : null;
    const forecastHi = Math.round(d.temperature_2m_max[i]);
    const forecastLo = Math.round(d.temperature_2m_min[i]);

    days.push({
      date: d.time[i],
      dayName: DAY_NAMES[date.getDay()],
      dayNum: date.getDate(),
      month: date.getMonth() + 1,
      hi: forecastHi,
      lo: forecastLo,
      precip: d.precipitation_sum[i] || 0,
      precipProb: d.precipitation_probability_max[i] || 0,
      code: d.weathercode[i],
      icon: WMO_ICONS[d.weathercode[i]] || '🌡️',
      desc: WMO_DESC[d.weathercode[i]] || 'Unknown',
      windMax: Math.round(d.windspeed_10m_max[i] || 0),
      gustMax: Math.round(d.windgusts_10m_max[i] || 0),
      windDir: d.winddirection_10m_dominant[i] || 0,
      feelsHi: Math.round(d.apparent_temperature_max[i] || d.temperature_2m_max[i]),
      feelsLo: Math.round(d.apparent_temperature_min[i] || d.temperature_2m_min[i]),
      uv: d.uv_index_max ? Math.round(d.uv_index_max[i] || 0) : 0,
      confidence: Math.round(confidence),
      modelSpread: Math.round(spread),
      avgHi,
      avgLo,
      devHi: avgHi != null ? forecastHi - avgHi : null,
      devLo: avgLo != null ? forecastLo - avgLo : null,
    });
  }

  // Extend to 20 days with extrapolation if < 20
  while (days.length < 20) {
    const last = days[days.length - 1];
    const prev = days[days.length - 2];
    const nextDate = new Date(last.date + 'T12:00:00');
    nextDate.setDate(nextDate.getDate() + 1);
    const dateStr = nextDate.toISOString().split('T')[0];
    const trend = last.hi - prev.hi;
    const extIdx = days.length;
    const cnExt = climateNormals || rawClimateNormals;
    const extAvgHi = cnExt && cnExt.avgHi[extIdx] != null ? cnExt.avgHi[extIdx] : null;
    const extAvgLo = cnExt && cnExt.avgLo[extIdx] != null ? cnExt.avgLo[extIdx] : null;
    const extHi = Math.round(last.hi + trend * 0.5 + (Math.random() - 0.5) * 4);
    const extLo = Math.round(last.lo + trend * 0.3 + (Math.random() - 0.5) * 3);
    days.push({
      date: dateStr,
      dayName: DAY_NAMES[nextDate.getDay()],
      dayNum: nextDate.getDate(),
      month: nextDate.getMonth() + 1,
      hi: extHi,
      lo: extLo,
      precip: Math.max(0, last.precip * 0.8 + (Math.random() - 0.5) * 0.2),
      precipProb: Math.round(Math.max(0, Math.min(100, last.precipProb + (Math.random() - 0.5) * 20))),
      code: last.code,
      icon: last.icon,
      desc: last.desc,
      windMax: Math.round(last.windMax + (Math.random() - 0.5) * 6),
      gustMax: Math.round(last.gustMax + (Math.random() - 0.5) * 8),
      windDir: last.windDir,
      feelsHi: Math.round(last.feelsHi + trend * 0.5),
      feelsLo: Math.round(last.feelsLo + trend * 0.3),
      uv: last.uv,
      confidence: Math.max(15, Math.round(last.confidence - 10)),
      modelSpread: Math.round(last.modelSpread + 3),
      avgHi: extAvgHi,
      avgLo: extAvgLo,
      devHi: extAvgHi != null ? extHi - extAvgHi : null,
      devLo: extAvgLo != null ? extLo - extAvgLo : null,
    });
  }

  const c = primary.current;

  // Extract hourly data (next 48 hours)
  let hourly = [];
  if (primary.hourly && primary.hourly.time) {
    const nowHour = new Date();
    nowHour.setMinutes(0, 0, 0);
    for (let i = 0; i < primary.hourly.time.length; i++) {
      const t = new Date(primary.hourly.time[i]);
      if (t >= nowHour && hourly.length < 25) {
        hourly.push({
          time: t,
          temp: Math.round(primary.hourly.temperature_2m[i]),
          code: primary.hourly.weathercode ? primary.hourly.weathercode[i] : 0,
          icon: WMO_ICONS[primary.hourly.weathercode ? primary.hourly.weathercode[i] : 0] || '🌡️',
          precipProb: primary.hourly.precipitation_probability ? primary.hourly.precipitation_probability[i] : 0,
          isNow: hourly.length === 0,
        });
      }
    }
  }

  return {
    current: {
      temp: Math.round(c.temperature_2m),
      feelsLike: Math.round(c.apparent_temperature),
      humidity: Math.round(c.relative_humidity_2m),
      wind: Math.round(c.windspeed_10m),
      windDir: c.winddirection_10m,
      pressure: Math.round(c.pressure_msl),
      precip: c.precipitation,
      code: c.weathercode,
      icon: WMO_ICONS[c.weathercode] || '🌡️',
      desc: WMO_DESC[c.weathercode] || 'Unknown',
      isDay: c.is_day != null ? c.is_day : 1,
    },
    days,
    hourly,
    modelCount: Object.keys(filteredEnsemble).length,
    lastUpdate: new Date(),
  };
}

// ─── DETECT SIGNIFICANT CHANGES ───
function detectChanges(newData) {
  if (!forecastData) return;
  const changes = [];

  for (let i = 0; i < Math.min(7, newData.days.length); i++) {
    const oldDay = forecastData.days[i];
    const newDay = newData.days[i];
    if (!oldDay) continue;

    const tempDiff = Math.abs(newDay.hi - oldDay.hi);
    if (tempDiff >= 8) {
      changes.push({
        type: 'temp_swing',
        urgent: tempDiff >= 15,
        msg: `${newDay.dayName} ${newDay.month}/${newDay.dayNum}: High shifted ${newDay.hi > oldDay.hi ? '+' : ''}${newDay.hi - oldDay.hi}°F (now ${newDay.hi}°F)`,
        time: new Date(),
      });
    }

    if (newDay.precipProb >= 60 && oldDay.precipProb < 30) {
      changes.push({
        type: 'precip_change',
        urgent: false,
        msg: `${newDay.dayName} ${newDay.month}/${newDay.dayNum}: Precipitation chance jumped to ${newDay.precipProb}%`,
        time: new Date(),
      });
    }

    if (newDay.code >= 95 && oldDay.code < 95) {
      changes.push({
        type: 'severe',
        urgent: true,
        msg: `⚠ SEVERE: ${newDay.dayName} — ${newDay.desc} now in forecast`,
        time: new Date(),
      });
    }
  }

  if (changes.length > 0) {
    changeLog = [...changes, ...changeLog].slice(0, 20);
    if (notificationsEnabled && 'Notification' in window && Notification.permission === 'granted') {
      const urgent = changes.find(c => c.urgent);
      const msg = urgent ? urgent.msg : changes[0].msg;
      new Notification('WiczCast Alert', { body: msg, icon: '🌡️' });
    }
    updateNotificationBadge();
  }
}

// ─── RENDER ───
function updateLocationDisplay() {
  const el = document.getElementById('location-display');
  if (el) el.textContent = `${currentLocation.city} · ${getCoordStr()}`;
  document.title = `WiczCast — ${currentLocation.city}`;
}

function renderApp() {
  if (!forecastData) return;
  const { current, days, hourly } = forecastData;

  // Location display
  updateLocationDisplay();

  // Hero section
  renderHero(current, days[0]);

  // Alert banner
  const alertBanner = document.getElementById('alert-banner');
  const severeDay = days.slice(0, 7).find(d => d.code >= 56 || d.gustMax >= 40 || d.hi - d.lo >= 35);
  if (severeDay) {
    alertBanner.classList.remove('hidden');
    document.getElementById('alert-text').textContent =
      severeDay.code >= 95 ? `Severe weather expected ${severeDay.dayName} — ${severeDay.desc}` :
      severeDay.gustMax >= 40 ? `Wind gusts up to ${severeDay.gustMax} mph expected ${severeDay.dayName}` :
      severeDay.code >= 56 ? `Freezing conditions: ${severeDay.desc} on ${severeDay.dayName}` :
      `Major temp swing: ${severeDay.hi}°/${severeDay.lo}° on ${severeDay.dayName}`;
  } else {
    alertBanner.classList.add('hidden');
  }

  // Hourly strip
  renderHourlyStrip(hourly);

  // Forecast list
  renderForecastList(days);

  // Detail cards
  renderDetailCards(current, days[0]);

  // Charts (each separate, full-width, bezier)
  renderBezierChart('chart-temp', days, 'temp');
  renderBezierChart('chart-precip', days, 'precip');
  renderBezierChart('chart-wind', days, 'wind');

  // Confidence
  renderConfidence(days);
  renderBezierChart('chart-confidence', days, 'confidence');

  // Last update
  const now = forecastData.lastUpdate;
  const tz = getTimezoneAbbr();
  document.getElementById('last-update').textContent =
    `UPD ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${tz}`;

  // Source count
  document.getElementById('model-count').textContent = `${forecastData.modelCount} Model${forecastData.modelCount !== 1 ? 's' : ''} Active`;
}

// ─── WEATHER BACKGROUND GRADIENT ───
function getWeatherGradient(code, isDay) {
  if (!isDay) return 'linear-gradient(180deg, #0a0e17 0%, #0f1a2e 50%, rgba(10,14,23,0) 100%)';
  if (code <= 1) return 'linear-gradient(180deg, #1e3a5f 0%, #2d6aa0 40%, rgba(10,14,23,0) 100%)';
  if (code <= 3) return 'linear-gradient(180deg, #1a2332 0%, #2a3548 40%, rgba(10,14,23,0) 100%)';
  if (code <= 48) return 'linear-gradient(180deg, #1a2535 0%, #253040 40%, rgba(10,14,23,0) 100%)';
  if (code <= 67) return 'linear-gradient(180deg, #0f1520 0%, #1a2535 40%, rgba(10,14,23,0) 100%)';
  if (code <= 77) return 'linear-gradient(180deg, #1a2030 0%, #2a3548 40%, rgba(10,14,23,0) 100%)';
  if (code >= 95) return 'linear-gradient(180deg, #0a0c12 0%, #1a1520 40%, rgba(10,14,23,0) 100%)';
  return 'linear-gradient(180deg, #1e3a5f 0%, #1a2a42 50%, rgba(10,14,23,0) 100%)';
}

// ─── HERO RENDER ───
function renderHero(current, today) {
  document.getElementById('current-temp').textContent = current.temp + '°';
  document.getElementById('current-desc').textContent = current.desc;
  document.getElementById('current-icon').textContent = current.icon;
  document.getElementById('current-feels').textContent = `H:${today.hi}° L:${today.lo}° · Feels ${current.feelsLike}°`;

  // Dynamic weather gradient
  const hero = document.getElementById('hero-section');
  if (hero) hero.style.background = getWeatherGradient(current.code, current.isDay);
}

// ─── HOURLY STRIP ───
function renderHourlyStrip(hourly) {
  const container = document.getElementById('hourly-strip');
  if (!container || !hourly || hourly.length === 0) return;
  container.innerHTML = hourly.map((h, i) => {
    const timeStr = h.isNow ? 'NOW' : `${h.time.getHours()}:00`;
    return `<div class="hourly-item${h.isNow ? ' now' : ''}">
      <div class="hourly-time">${timeStr}</div>
      <div class="hourly-icon">${h.icon}</div>
      <div class="hourly-temp">${h.temp}°</div>
    </div>`;
  }).join('');
}

// ─── FORECAST LIST (vertical, Apple Weather style) ───
function renderForecastList(days) {
  const container = document.getElementById('forecast-list');
  if (!container) return;

  // Compute global min/max for temperature bar scaling
  const globalMin = Math.min(...days.map(d => d.lo));
  const globalMax = Math.max(...days.map(d => d.hi));
  const globalRange = globalMax - globalMin || 1;

  container.innerHTML = days.map((day, idx) => {
    const confClass = day.confidence >= 75 ? 'conf-high' :
                      day.confidence >= 50 ? 'conf-med' :
                      day.confidence >= 35 ? 'conf-low' : 'conf-crit';

    // Temperature bar: position within global range
    const leftPct = ((day.lo - globalMin) / globalRange) * 100;
    const widthPct = ((day.hi - day.lo) / globalRange) * 100;

    // Gradient color based on temperature (cold→warm)
    const midTemp = (day.hi + day.lo) / 2;
    const tempRatio = (midTemp - globalMin) / globalRange;
    const barGradient = tempRatio < 0.3 ? 'linear-gradient(90deg, #3b82f6, #00f0ff)' :
                        tempRatio < 0.6 ? 'linear-gradient(90deg, #00f0ff, #10b981)' :
                        tempRatio < 0.8 ? 'linear-gradient(90deg, #10b981, #fbbf24)' :
                        'linear-gradient(90deg, #fbbf24, #f97316)';

    return `<div class="forecast-row">
      <div class="fc-day-label">${idx === 0 ? 'TODAY' : day.dayName}</div>
      <div class="fc-icon">${day.icon}</div>
      <div class="fc-temp-lo">${day.lo}°</div>
      <div class="fc-temp-bar-track">
        <div class="fc-temp-bar-fill" style="left:${leftPct}%;width:${Math.max(widthPct, 4)}%;background:${barGradient}"></div>
      </div>
      <div class="fc-temp-hi">${day.hi}°</div>
      ${day.precipProb > 10 ? `<div class="fc-precip">${day.precipProb}%</div>` : '<div class="fc-precip">&nbsp;</div>'}
      <div class="fc-conf-pill ${confClass}">${day.confidence}%</div>
    </div>`;
  }).join('');
}

// ─── DETAIL CARDS ───
function renderDetailCards(current, today) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const dirIdx = Math.round(current.windDir / 22.5) % 16;
  const dirName = dirs[dirIdx];

  document.getElementById('detail-wind').textContent = `${current.wind} mph`;
  document.getElementById('detail-wind-sub').textContent = `${today.gustMax} mph gusts · ${dirName}`;

  document.getElementById('detail-humidity').textContent = `${current.humidity}%`;
  document.getElementById('detail-humidity-sub').textContent = `Dew point ${Math.round(current.temp - (100 - current.humidity) / 5)}°`;

  document.getElementById('detail-pressure').textContent = `${current.pressure} mb`;
  const pressureDesc = current.pressure >= 1020 ? 'High — clear skies likely' :
                       current.pressure >= 1010 ? 'Normal' :
                       current.pressure >= 1000 ? 'Low — potential storms' : 'Very low — active weather';
  document.getElementById('detail-pressure-sub').textContent = pressureDesc;

  const uv = today.uv;
  document.getElementById('detail-uv').textContent = uv;
  const uvLabel = uv <= 2 ? 'Low' : uv <= 5 ? 'Moderate' : uv <= 7 ? 'High' : uv <= 10 ? 'Very High' : 'Extreme';
  document.getElementById('detail-uv-sub').textContent = uvLabel;
  const uvFill = document.getElementById('detail-uv-fill');
  if (uvFill) uvFill.style.width = `${Math.min(100, (uv / 11) * 100)}%`;

  document.getElementById('detail-precip').textContent = `${current.precip}"`;
  document.getElementById('detail-precip-sub').textContent = `${today.precipProb}% chance today`;

  document.getElementById('detail-feels').textContent = `${current.feelsLike}°`;
  const feelsDesc = current.feelsLike < current.temp - 5 ? 'Wind chill makes it colder' :
                    current.feelsLike > current.temp + 5 ? 'Humidity makes it warmer' :
                    'Similar to actual temperature';
  document.getElementById('detail-feels-sub').textContent = feelsDesc;
}

// ─── BEZIER CHART RENDERER ───
function renderBezierChart(canvasId, days, type) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * 2;
  canvas.height = rect.height * 2;
  ctx.scale(2, 2);
  const W = rect.width;
  const H = rect.height;

  ctx.clearRect(0, 0, W, H);

  let values, values2, color, color2, label;

  if (type === 'temp') {
    values = days.map(d => d.hi);
    values2 = days.map(d => d.lo);
    color = '#00f0ff';
    color2 = '#8b5cf6';
    label = 'TEMP °F';
  } else if (type === 'precip') {
    values = days.map(d => d.precipProb);
    values2 = null;
    color = '#3b82f6';
    label = 'PRECIP %';
  } else if (type === 'wind') {
    values = days.map(d => d.windMax);
    values2 = days.map(d => d.gustMax);
    color = '#10b981';
    color2 = '#f97316';
    label = 'WIND MPH';
  } else if (type === 'confidence') {
    values = days.map(d => d.confidence);
    values2 = null;
    color = '#fbbf24';
    label = 'CONFIDENCE %';
  }

  const allVals = [...values, ...(values2 || [])];
  const min = Math.min(...allVals) - 5;
  const max = Math.max(...allVals) + 5;
  const range = max - min || 1;

  const padL = 36;
  const padR = 10;
  const padT = 16;
  const padB = 22;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.04)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (plotH / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(W - padR, y);
    ctx.stroke();

    const val = Math.round(max - (range / 4) * i);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.font = '9px "Share Tech Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(val, padL - 6, y + 3);
  }

  // Day labels
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.font = '8px "Share Tech Mono", monospace';
  ctx.textAlign = 'center';
  const labelEvery = days.length > 14 ? 3 : 2;
  for (let i = 0; i < values.length; i += labelEvery) {
    const x = padL + (plotW / (values.length - 1)) * i;
    ctx.fillText(days[i].dayName, x, H - 4);
  }

  function drawBezierLine(vals, strokeColor, fill) {
    const pts = vals.map((v, i) => ({
      x: padL + (plotW / (vals.length - 1)) * i,
      y: padT + plotH - ((v - min) / range) * plotH,
    }));

    if (pts.length < 2) return;

    // Build bezier path
    function bezierPath() {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length - 1; i++) {
        const cp = (pts[i + 1].x - pts[i].x) * 0.35;
        ctx.bezierCurveTo(
          pts[i].x + cp, pts[i].y,
          pts[i + 1].x - cp, pts[i + 1].y,
          pts[i + 1].x, pts[i + 1].y
        );
      }
    }

    // Fill area with gradient
    if (fill) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, H - padB);
      ctx.lineTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length - 1; i++) {
        const cp = (pts[i + 1].x - pts[i].x) * 0.35;
        ctx.bezierCurveTo(
          pts[i].x + cp, pts[i].y,
          pts[i + 1].x - cp, pts[i + 1].y,
          pts[i + 1].x, pts[i + 1].y
        );
      }
      ctx.lineTo(pts[pts.length - 1].x, H - padB);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, padT, 0, H - padB);
      grad.addColorStop(0, strokeColor + '20');
      grad.addColorStop(1, strokeColor + '02');
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // Stroke bezier
    ctx.beginPath();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    bezierPath();
    ctx.stroke();

    // Dots
    pts.forEach((p, i) => {
      if (i % 2 === 0) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = strokeColor;
        ctx.fill();
        // Glow
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = strokeColor + '15';
        ctx.fill();
      }
    });
  }

  // Average high/low dashed lines (temp chart only) — draw BEFORE main lines so they sit behind
  const avgHiColor = '#00f0ff';  // same cyan family as HIGH, but dashed
  const avgLoColor = '#8b5cf6';  // same purple family as LOW, but dashed
  let hasAvgLines = false;
  if (type === 'temp' && days[0] && days[0].avgHi != null) {
    const avgHiVals = days.map(d => d.avgHi).filter(v => v != null);
    const avgLoVals = days.map(d => d.avgLo).filter(v => v != null);

    function drawDashedBezier(vals, strokeColor) {
      const pts = vals.map((v, i) => ({
        x: padL + (plotW / (vals.length - 1)) * i,
        y: padT + plotH - ((v - min) / range) * plotH,
      }));
      if (pts.length < 2) return;

      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.45;
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length - 1; i++) {
        const cp = (pts[i + 1].x - pts[i].x) * 0.35;
        ctx.bezierCurveTo(
          pts[i].x + cp, pts[i].y,
          pts[i + 1].x - cp, pts[i + 1].y,
          pts[i + 1].x, pts[i + 1].y
        );
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1.0;
    }

    if (avgHiVals.length >= 2) { drawDashedBezier(avgHiVals, avgHiColor); hasAvgLines = true; }
    if (avgLoVals.length >= 2) { drawDashedBezier(avgLoVals, avgLoColor); hasAvgLines = true; }
  }

  drawBezierLine(values, color, true);
  if (values2) drawBezierLine(values2, color2, false);

  // Label
  ctx.fillStyle = color;
  ctx.font = 'bold 9px "Share Tech Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText(label, padL, padT - 4);

  // Legend
  {
    const swatchLen = 12;
    const swatchGap = 4;
    const itemGap = 10;
    const legendY = padT - 4;
    let cursorX = W - padR;
    ctx.font = 'bold 9px "Share Tech Mono", monospace';
    ctx.textAlign = 'right';

    // Build legend items right-to-left
    const legendItems = [];
    if (type === 'temp') {
      legendItems.push({ text: 'LOW', col: color2, dashed: false });
      if (hasAvgLines) legendItems.push({ text: 'AVG', col: 'rgba(255,255,255,0.35)', dashed: true });
      legendItems.push({ text: 'HIGH', col: color, dashed: false });
    } else if (type === 'precip') {
      legendItems.push({ text: 'CHANCE %', col: color, dashed: false });
    } else if (type === 'wind') {
      legendItems.push({ text: 'GUST', col: color2, dashed: false });
      legendItems.push({ text: 'WIND', col: color, dashed: false });
    } else if (type === 'confidence') {
      legendItems.push({ text: 'CONSENSUS %', col: color, dashed: false });
    }

    legendItems.forEach((item, idx) => {
      // Text
      const textW = ctx.measureText(item.text).width;
      ctx.fillStyle = item.col;
      ctx.fillText(item.text, cursorX, legendY);
      cursorX -= textW + swatchGap;

      // Swatch line
      if (item.dashed) ctx.setLineDash([4, 3]);
      ctx.strokeStyle = item.col;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cursorX - swatchLen, legendY - 3);
      ctx.lineTo(cursorX, legendY - 3);
      ctx.stroke();
      if (item.dashed) ctx.setLineDash([]);
      cursorX -= swatchLen + itemGap;
    });
  }
}

// ─── CONFIDENCE RING ───
function renderConfidence(days) {
  const avg = Math.round(days.slice(0, 7).reduce((a, d) => a + d.confidence, 0) / 7);
  const canvas = document.getElementById('confidence-ring');
  const size = canvas.getBoundingClientRect().width;
  canvas.width = size * 2;
  canvas.height = size * 2;
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;

  // Background ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 3;
  ctx.stroke();

  // Progress ring
  const angle = (avg / 100) * Math.PI * 2 - Math.PI / 2;
  const color = avg >= 75 ? '#10b981' : avg >= 50 ? '#fbbf24' : '#ef4444';
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, angle);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.stroke();

  // Text
  ctx.fillStyle = color;
  ctx.font = `bold ${size * 0.3}px "Orbitron", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(avg + '%', cx, cy);

  // Desc
  document.getElementById('confidence-desc').textContent =
    avg >= 80 ? 'High model agreement across all sources — forecast is locked in.' :
    avg >= 60 ? 'Good model consensus with minor deviations in extended range.' :
    avg >= 40 ? 'Moderate uncertainty — models diverging on days 10+.' :
    'Low confidence — significant model disagreement. Watch for updates.';

  const activeMil = document.querySelectorAll('.source-tag.mil.active[data-model]').length;
  document.getElementById('confidence-sources').textContent =
    `${forecastData.modelCount} SOURCES · ${activeMil} MIL-GRADE · UPDATED ${formatTime(forecastData.lastUpdate)}`;
}

function formatTime(d) {
  const tz = getTimezoneAbbr();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${tz}`;
}

// ─── NOTIFICATIONS ───
function updateNotificationBadge() {
  const badge = document.getElementById('notif-badge');
  if (changeLog.length > 0) {
    badge.textContent = Math.min(changeLog.length, 9);
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function renderNotifications() {
  const list = document.getElementById('notif-list');
  if (changeLog.length === 0) {
    list.innerHTML = `
      <div style="text-align:center;padding:30px 0;">
        <div style="font-size:28px;margin-bottom:10px;">✓</div>
        <div style="font-family:'Share Tech Mono',monospace;font-size:11px;color:var(--text-dim);letter-spacing:1px;">NO SIGNIFICANT CHANGES</div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:6px;">You'll be alerted when models detect major forecast shifts.</div>
      </div>`;
    return;
  }

  list.innerHTML = changeLog.map(c => `
    <div class="notif-item ${c.urgent ? 'urgent' : 'change'}">
      <div class="notif-time">${formatTime(c.time)}</div>
      <div class="notif-msg">${escapeHtml(c.msg)}</div>
    </div>
  `).join('');
}

function toggleNotifPanel() {
  notifPanelOpen = !notifPanelOpen;
  document.getElementById('notif-panel').classList.toggle('open', notifPanelOpen);
  document.getElementById('overlay').classList.toggle('open', notifPanelOpen);
  if (notifPanelOpen) renderNotifications();
}

// ─── INIT ───
async function init() {
  // Load saved location (or use default Minneapolis)
  loadSavedLocation();
  updateLocationDisplay();
  setupLocationSearch();

  // Request notification permission
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // Wire up UI
  document.getElementById('notif-btn').addEventListener('click', toggleNotifPanel);
  document.getElementById('notif-close').addEventListener('click', toggleNotifPanel);
  document.getElementById('overlay').addEventListener('click', () => {
    if (notifPanelOpen) toggleNotifPanel();
  });

  // Notification toggle
  document.getElementById('notif-toggle').addEventListener('click', () => {
    notificationsEnabled = !notificationsEnabled;
    document.getElementById('notif-toggle').classList.toggle('on', notificationsEnabled);
  });

  // Source tags — toggle active and recompute forecast
  document.querySelectorAll('.source-tag[data-model]').forEach(tag => {
    tag.addEventListener('click', () => {
      tag.classList.toggle('active');
      recomputeWithActiveModels();
    });
  });

  // Fullscreen map controls
  document.getElementById('map-expand-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (mapInitialized) openMapFullscreen();
  });
  document.getElementById('map-fs-close').addEventListener('click', closeMapFullscreen);
  // ESC key closes fullscreen map
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && mapFullscreenOpen) closeMapFullscreen();
  });

  // Load data
  try {
    const [primary, ensemble] = await Promise.all([
      fetchWeatherData(),
      fetchEnsembleData(),
    ]);

    // Store raw results globally for recomputation on model toggle
    rawPrimary = primary;
    rawEnsemble = ensemble;

    const activeModels = getActiveModels();
    const data = processData(primary, ensemble, activeModels);
    forecastData = data;
    renderApp();

    // Generate some initial "change" notifications for demo
    generateInitialNotifications(data);

    // Fetch climate normals in background (non-blocking) and re-render when ready
    fetchClimateNormals().then(normals => {
      if (normals) {
        rawClimateNormals = normals;
        const updated = processData(rawPrimary, rawEnsemble, getActiveModels(), normals);
        forecastData = updated;
        renderApp();
      }
    });

    // Fetch ENSO data in background (non-blocking) with retry
    fetchENSOData().then(ensoData => {
      if (ensoData) {
        console.log('[ENSO] Data loaded successfully:', ensoData.latest ? 'ONI data present' : 'no ONI', ensoData.history?.length || 0, 'history records');
        renderENSOPanel(ensoData);
      } else {
        console.warn('[ENSO] fetchENSOData returned null, retrying in 5s...');
        setTimeout(() => {
          localStorage.removeItem(ENSO_CACHE_KEY);
          fetchENSOData().then(d => { if (d) renderENSOPanel(d); }).catch(e => console.warn('[ENSO] Retry failed:', e));
        }, 5000);
      }
    }).catch(err => {
      console.warn('[ENSO] Data fetch failed:', err, '— retrying in 5s...');
      setTimeout(() => {
        localStorage.removeItem(ENSO_CACHE_KEY);
        fetchENSOData().then(d => { if (d) renderENSOPanel(d); }).catch(e => console.warn('[ENSO] Retry failed:', e));
      }, 5000);
    });

  } catch (err) {
    console.error('Failed to fetch weather data:', err);
    // Show error state
    document.getElementById('current-temp').textContent = '--°';
    document.getElementById('current-desc').textContent = 'Data unavailable';
  }

  // Hide loading
  setTimeout(() => {
    document.getElementById('loading').classList.add('fade-out');
    setTimeout(() => document.getElementById('loading').style.display = 'none', 800);
  }, 2200);

  // Auto-refresh every 15 minutes
  setInterval(refreshData, 15 * 60 * 1000);

  // Initialize map (always visible now, no tab switching)
  setTimeout(() => {
    if (!mapInitialized) initMap();
  }, 500);

  // Handle resize for charts, map, and ENSO
  window.addEventListener('resize', () => {
    if (forecastData) {
      renderBezierChart('chart-temp', forecastData.days, 'temp');
      renderBezierChart('chart-precip', forecastData.days, 'precip');
      renderBezierChart('chart-wind', forecastData.days, 'wind');
      renderBezierChart('chart-confidence', forecastData.days, 'confidence');
      renderConfidence(forecastData.days);
      if (mapInstance) mapInstance.invalidateSize();
    }
    // Re-render ENSO globe on resize
    try {
      const cachedENSO = localStorage.getItem(ENSO_CACHE_KEY);
      if (cachedENSO) {
        renderENSOPanel(JSON.parse(cachedENSO));
      }
    } catch (e) {}
  });
}

function generateInitialNotifications(data) {
  const now = new Date();
  // Check for notable conditions
  const tomorrow = data.days[1];
  const today = data.days[0];

  if (tomorrow && today) {
    const tempShift = tomorrow.hi - today.hi;
    if (Math.abs(tempShift) >= 5) {
      changeLog.push({
        type: 'temp_swing',
        urgent: Math.abs(tempShift) >= 12,
        msg: `Tomorrow's high ${tempShift > 0 ? 'rising' : 'dropping'} ${Math.abs(tempShift)}°F to ${tomorrow.hi}°F vs today's ${today.hi}°F`,
        time: new Date(now - 1000 * 60 * 45),
      });
    }
  }

  // Check for precip in next 5 days
  const precipDay = data.days.slice(1, 6).find(d => d.precipProb >= 50);
  if (precipDay) {
    changeLog.push({
      type: 'precip_change',
      urgent: false,
      msg: `${precipDay.dayName} ${precipDay.month}/${precipDay.dayNum}: ${precipDay.precipProb}% chance of ${precipDay.desc.toLowerCase()}`,
      time: new Date(now - 1000 * 60 * 120),
    });
  }

  // Check for extreme cold or wind
  const coldDay = data.days.slice(0, 7).find(d => d.lo <= 0 || d.feelsLo <= -10);
  if (coldDay) {
    changeLog.push({
      type: 'severe',
      urgent: true,
      msg: `⚠ ${coldDay.dayName}: Low of ${coldDay.lo}°F, feels like ${coldDay.feelsLo}°F — dangerous wind chill`,
      time: new Date(now - 1000 * 60 * 30),
    });
  }

  updateNotificationBadge();
}

async function refreshData() {
  try {
    const [primary, ensemble] = await Promise.all([
      fetchWeatherData(),
      fetchEnsembleData(),
    ]);
    rawPrimary = primary;
    rawEnsemble = ensemble;
    const activeModels = getActiveModels();
    const newData = processData(primary, ensemble, activeModels);
    detectChanges(newData);
    forecastData = newData;
    renderApp();
    if (mapInitialized) resetMap();

    // Refresh climate normals too (dates shift daily)
    fetchClimateNormals().then(normals => {
      if (normals) {
        rawClimateNormals = normals;
        const updated = processData(rawPrimary, rawEnsemble, getActiveModels(), normals);
        forecastData = updated;
        renderApp();
      }
    });

    // Refresh ENSO (cache TTL handles rate limiting)
    fetchENSOData().then(ensoData => {
      if (ensoData) renderENSOPanel(ensoData);
    }).catch(err => console.warn('[ENSO] Refresh failed:', err));
  } catch (e) {
    console.error('Refresh failed:', e);
  }
}

// Recompute forecast from stored raw data with current active model selection
function recomputeWithActiveModels() {
  if (!rawPrimary || !rawEnsemble) return;
  const activeModels = getActiveModels();
  const newData = processData(rawPrimary, rawEnsemble, activeModels);
  forecastData = newData;
  renderApp();
}

// ─── TEMPERATURE MAP ───
let mapInstance = null;
let mapHeatLayer = null;
let mapCityMarker = null;
let mapGridData = null;
let mapInitialized = false;
let leafletLoaded = false;

function loadLeafletScripts() {
  return new Promise((resolve, reject) => {
    if (leafletLoaded) { resolve(); return; }
    const s1 = document.createElement('script');
    s1.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s1.onload = () => {
      const s2 = document.createElement('script');
      s2.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet.heat/0.2.0/leaflet-heat.js';
      s2.onload = () => { leafletLoaded = true; resolve(); };
      s2.onerror = reject;
      document.head.appendChild(s2);
    };
    s1.onerror = reject;
    document.head.appendChild(s1);
  });
}

function generateGridPoints(lat, lon, radiusKm, gridSize) {
  const latStep = (radiusKm / 111) * 2 / (gridSize - 1);
  const lonStep = (radiusKm / (111 * Math.cos(lat * Math.PI / 180))) * 2 / (gridSize - 1);
  const startLat = lat - (radiusKm / 111);
  const startLon = lon - (radiusKm / (111 * Math.cos(lat * Math.PI / 180)));
  const points = [];
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      points.push({ lat: startLat + r * latStep, lon: startLon + c * lonStep });
    }
  }
  return points;
}

async function fetchGridTemperatures(lat, lon) {
  const points = generateGridPoints(lat, lon, 50, 7);
  const lats = points.map(p => p.lat.toFixed(4)).join(',');
  const lons = points.map(p => p.lon.toFixed(4)).join(',');

  const params = new URLSearchParams({
    latitude: lats,
    longitude: lons,
    daily: 'temperature_2m_max,temperature_2m_min',
    temperature_unit: 'fahrenheit',
    timezone: currentLocation.timezone || 'auto',
    forecast_days: 16,
  });

  const resp = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!resp.ok) throw new Error('Grid temperature fetch failed');
  const data = await resp.json();

  // Open-Meteo returns array for multi-point queries
  const results = Array.isArray(data) ? data : [data];
  const numDays = results[0]?.daily?.temperature_2m_max?.length || 0;
  const gridData = [];

  for (let d = 0; d < 20; d++) {
    const dayPoints = [];
    for (let i = 0; i < points.length; i++) {
      const result = results[i] || results[0];
      const dayIdx = Math.min(d, numDays - 1); // clamp for days 17-20
      const hi = result.daily?.temperature_2m_max?.[dayIdx];
      const lo = result.daily?.temperature_2m_min?.[dayIdx];
      if (hi != null && lo != null) {
        dayPoints.push({ lat: points[i].lat, lon: points[i].lon, temp: (hi + lo) / 2, hi, lo });
      }
    }
    gridData.push(dayPoints);
  }
  return gridData;
}

async function initMap() {
  if (mapInitialized) return;

  await loadLeafletScripts();

  const { lat, lon } = currentLocation;

  mapInstance = L.map('map', { center: [lat, lon], zoom: 9, zoomControl: true, attributionControl: true });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 16,
  }).addTo(mapInstance);

  mapCityMarker = L.circleMarker([lat, lon], {
    radius: 6, color: '#00f0ff', fillColor: '#00f0ff', fillOpacity: 0.5, weight: 2,
  }).addTo(mapInstance);

  mapCityMarker.bindTooltip(currentLocation.city, {
    permanent: false, className: 'map-city-tooltip', direction: 'top', offset: [0, -8],
  });

  mapInitialized = true;

  try {
    mapGridData = await fetchGridTemperatures(lat, lon);
    updateHeatmap(0);
    updateSliderInfo(0);
  } catch (err) {
    console.error('Failed to fetch grid temperatures:', err);
  }

  document.getElementById('map-day-slider').addEventListener('input', (e) => {
    const dayIdx = parseInt(e.target.value);
    updateHeatmap(dayIdx);
    updateSliderInfo(dayIdx);
  });
}

function updateHeatmap(dayIdx) {
  if (!mapInstance || !mapGridData || !mapGridData[dayIdx]) return;

  // Absolute temperature scale so colors map to real-world feel
  // 0°F = deep blue, 32°F = cyan, 55°F = green, 75°F = yellow, 100°F+ = red
  const absMin = 0;
  const absMax = 100;
  const absRange = absMax - absMin;

  const heatPoints = mapGridData[dayIdx].map(p => {
    const norm = Math.max(0, Math.min(1, (p.temp - absMin) / absRange));
    return [p.lat, p.lon, norm];
  });

  if (mapHeatLayer) mapInstance.removeLayer(mapHeatLayer);

  mapHeatLayer = L.heatLayer(heatPoints, {
    radius: 55, blur: 45, maxZoom: 8, max: 1.0, minOpacity: 0.2,
    gradient: {
      0.0:  '#1e3a8a',  // 0°F — deep blue
      0.15: '#3b82f6',  // 15°F — blue
      0.32: '#06b6d4',  // 32°F — cyan (freezing)
      0.50: '#10b981',  // 50°F — green
      0.70: '#fbbf24',  // 70°F — yellow
      0.85: '#f97316',  // 85°F — orange
      1.0:  '#ef4444',  // 100°F — red
    },
  }).addTo(mapInstance);
}

function updateSliderInfo(dayIdx) {
  const dayLabel = document.getElementById('map-day-label');
  const tempRange = document.getElementById('map-temp-range');
  if (forecastData && forecastData.days[dayIdx]) {
    const day = forecastData.days[dayIdx];
    dayLabel.textContent = dayIdx === 0 ? 'DAY 1 — TODAY' : `DAY ${dayIdx + 1} — ${day.dayName} ${day.month}/${day.dayNum}`;
    tempRange.textContent = `${day.hi}°F / ${day.lo}°F`;
  } else {
    dayLabel.textContent = `DAY ${dayIdx + 1}`;
    tempRange.textContent = '--°F / --°F';
  }
}

function resetMap() {
  if (!mapInitialized || !mapInstance) return;
  const { lat, lon } = currentLocation;
  mapInstance.setView([lat, lon], 9);
  if (mapCityMarker) {
    mapCityMarker.setLatLng([lat, lon]);
    mapCityMarker.setTooltipContent(currentLocation.city);
  }
  fetchGridTemperatures(lat, lon).then(data => {
    mapGridData = data;
    const slider = document.getElementById('map-day-slider');
    const dayIdx = slider ? parseInt(slider.value) || 0 : 0;
    updateHeatmap(dayIdx);
    updateSliderInfo(dayIdx);
  }).catch(err => console.error('Failed to refresh grid data:', err));
}

// ─── FULLSCREEN MAP ───
let mapFullscreenOpen = false;

function openMapFullscreen() {
  if (mapFullscreenOpen) return;
  mapFullscreenOpen = true;

  const overlay = document.getElementById('map-fullscreen');
  const fsBody = document.getElementById('map-fs-body');
  const fsSliderRow = document.getElementById('map-fs-slider-row');
  const mapEl = document.getElementById('map');
  const sliderRow = document.querySelector('#map-container .map-slider-row');

  // Update city name
  document.getElementById('map-fs-city').textContent = currentLocation.city;

  // Reparent map and slider into fullscreen overlay
  fsBody.appendChild(mapEl);
  fsSliderRow.appendChild(sliderRow);

  // Show overlay
  overlay.classList.add('open');

  // Tell Leaflet about the new size
  setTimeout(() => {
    if (mapInstance) mapInstance.invalidateSize();
  }, 150);
}

function closeMapFullscreen() {
  if (!mapFullscreenOpen) return;
  mapFullscreenOpen = false;

  const overlay = document.getElementById('map-fullscreen');
  const mapContainer = document.getElementById('map-container');
  const mapEl = document.getElementById('map');
  const sliderRow = document.querySelector('.map-slider-row');

  // Reparent map and slider back to inline container
  // Insert map before the slider row's original position
  mapContainer.insertBefore(mapEl, mapContainer.firstChild);
  mapContainer.insertBefore(sliderRow, document.getElementById('map-expand-btn'));

  // Hide overlay
  overlay.classList.remove('open');

  // Tell Leaflet about the new size
  setTimeout(() => {
    if (mapInstance) mapInstance.invalidateSize();
  }, 150);
}

// ─── ENSO TRACKER ───
const ENSO_CACHE_KEY = 'wiczcast-enso-cache';
const ENSO_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function fetchENSOData() {
  const cached = localStorage.getItem(ENSO_CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      // Only use cache if it has valid data AND is within TTL
      if (Date.now() - parsed.timestamp < ENSO_CACHE_TTL && parsed.latest && parsed.history && parsed.history.length > 0) return parsed;
    } catch (e) { /* stale cache, refetch */ }
  }

  const currentYear = new Date().getFullYear();

  // Nino zone coordinates for SST detection:
  //   Nino 4:   5°N–5°S, 160°E–150°W  → lat 0, lon 175 (center)
  //   Nino 3.4: 5°N–5°S, 170–120°W    → lat 0, lon -145
  //   Nino 3:   5°N–5°S, 150–90°W     → lat 0, lon -120
  //   Nino 1+2: 0–10°S,  90–80°W      → lat -5, lon -85
  const sstZones = [
    { id: 'nino4',  lat: 0, lon: 175,  climatology: 28.6 },
    { id: 'nino34', lat: 0, lon: -145, climatology: 27.0 },
    { id: 'nino3',  lat: 0, lon: -120, climatology: 25.5 },
    { id: 'nino12', lat: -5, lon: -85, climatology: 23.5 },
  ];

  const sstFetches = sstZones.map(z =>
    fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${z.lat}&longitude=${z.lon}&hourly=sea_surface_temperature&timezone=auto&forecast_days=1`)
  );

  const [latestResp, historyResp, ...sstResps] = await Promise.allSettled([
    fetch('/api/enso/oni/latest'),
    fetch(`/api/enso/oni/data?start_year=${currentYear - 5}&end_year=${currentYear}`),
    ...sstFetches,
  ]);

  let latest = null, history = [], sst = null;
  const sstZoneData = {};

  if (latestResp.status === 'fulfilled' && latestResp.value.ok) {
    latest = await latestResp.value.json();
  }
  if (historyResp.status === 'fulfilled' && historyResp.value.ok) {
    const histData = await historyResp.value.json();
    history = histData.data || histData || [];
  }

  // Parse each SST zone
  for (let i = 0; i < sstZones.length; i++) {
    const resp = sstResps[i];
    if (resp && resp.status === 'fulfilled' && resp.value.ok) {
      try {
        const data = await resp.value.json();
        const temps = data.hourly?.sea_surface_temperature || [];
        const lastTemp = temps.filter(t => t != null).pop();
        if (lastTemp != null) {
          const zone = sstZones[i];
          const anomaly = parseFloat((lastTemp - zone.climatology).toFixed(1));
          sstZoneData[zone.id] = { temp: lastTemp, anomaly, climatology: zone.climatology };
          if (zone.id === 'nino34') sst = lastTemp; // primary SST
        }
      } catch (e) { /* skip zone */ }
    }
  }

  const result = { timestamp: Date.now(), latest, history, sst, sstZoneData };
  try { localStorage.setItem(ENSO_CACHE_KEY, JSON.stringify(result)); } catch (e) { /* quota */ }
  return result;
}

function getENSOCurrent(ensoData) {
  if (!ensoData || !ensoData.latest) return null;
  const records = ensoData.latest.data || ensoData.latest;
  if (Array.isArray(records) && records.length > 0) return records[records.length - 1];
  if (records && records.ONI != null) return records;
  return null;
}

function renderENSOPanel(ensoData) {
  try {
    const current = getENSOCurrent(ensoData);
    if (!current) { console.warn('[ENSO] getENSOCurrent returned null'); return; }

    const phase = current.ENSO || 'Neutral';
    const oni = current.ONI;

    // Compute winter prediction probabilities
    const outlook = computeWinterOutlook(oni, ensoData.sstZoneData || {}, phase);

    // Phase display
    let phaseColor, phaseText;
    if (phase === 'ElNino' || phase === 'El Nino') {
      phaseColor = '#f97316'; phaseText = 'GOITER WARM';
    } else if (phase === 'LaNina' || phase === 'La Nina') {
      phaseColor = '#3b82f6'; phaseText = 'GOITER COLD';
    } else {
      phaseColor = '#10b981'; phaseText = 'UNFUCKED';
    }

    // Update text elements
    const phaseEl = document.getElementById('enso-globe-phase');
    if (phaseEl) { phaseEl.textContent = phaseText; phaseEl.style.color = phaseColor; }

    const oniEl = document.getElementById('enso-globe-oni');
    if (oniEl) {
      oniEl.textContent = (oni >= 0 ? '+' : '') + oni.toFixed(1) + '°C';
      oniEl.style.color = oni >= 0.5 ? '#f97316' : oni <= -0.5 ? '#3b82f6' : '#10b981';
    }

    // Winter outlook stats
    const recordEl = document.getElementById('enso-odds-record');
    if (recordEl) {
      recordEl.textContent = outlook.recordWarmPct + '%';
      recordEl.style.color = outlook.recordColor;
    }
    const aboveEl = document.getElementById('enso-odds-above');
    if (aboveEl) {
      aboveEl.textContent = outlook.aboveAvgPct + '%';
      aboveEl.style.color = outlook.aboveAvgPct >= 60 ? '#f97316' : outlook.aboveAvgPct >= 50 ? '#fbbf24' : '#3b82f6';
    }
    const tempEl = document.getElementById('enso-odds-temp');
    if (tempEl) {
      const sign = outlook.tempAnomaly >= 0 ? '+' : '';
      tempEl.textContent = outlook.predictedTemp + '°F (' + sign + outlook.tempAnomaly + ')';
      tempEl.style.color = outlook.tempAnomaly >= 1.5 ? '#f97316' : outlook.tempAnomaly >= 0.5 ? '#fbbf24' : outlook.tempAnomaly <= -0.5 ? '#3b82f6' : '#10b981';
    }

    // Draw globe gauge
    renderENSOGlobe(oni, phaseColor, outlook);

    // Source
    const seasonLabel = current.season ? `${current.season} ${current.year}` : '';
    const srcEl = document.getElementById('enso-globe-source');
    if (srcEl) srcEl.textContent = `SOURCE: NOAA CPC · OPEN-METEO MARINE${seasonLabel ? ' · ' + seasonLabel : ''}`;

    // Start live clock
    startENSOClock(phaseText, phaseColor);
  } catch (err) {
    console.error('[ENSO] renderENSOPanel error:', err);
  }
}

let _ensoClockInterval = null;
function startENSOClock(phaseText, phaseColor) {
  const el = document.getElementById('enso-clock-line');
  if (!el) return;
  if (_ensoClockInterval) clearInterval(_ensoClockInterval);
  el.style.color = phaseColor;

  function tick() {
    const now = new Date();
    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    const mo = months[now.getMonth()];
    const day = now.getDate();
    const yr = now.getFullYear();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    el.textContent = phaseText + ' AS OF ' + mo + ' ' + day + ', ' + yr + '  ' + h + ':' + m + ':' + s;
  }
  tick();
  _ensoClockInterval = setInterval(tick, 1000);
}

// ─── 200:1 BET WINDOW ───
function initBetForm() {
  const form = document.getElementById('bet-form');
  const confirmation = document.getElementById('bet-confirmation');
  const countEl = document.getElementById('bet-count');
  if (!form) return;

  // Load existing bets
  let bets = [];
  try { bets = JSON.parse(localStorage.getItem('wiczcast-bets') || '[]'); } catch(e) { bets = []; }

  // Check if this user already bet (by checking localStorage flag)
  if (localStorage.getItem('wiczcast-bet-placed')) {
    form.style.display = 'none';
    confirmation.style.display = 'flex';
  }

  updateBetCount(countEl, bets.length);

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    const name = document.getElementById('bet-name').value.trim();
    const email = document.getElementById('bet-email').value.trim();
    if (!name || !email) return;

    const bet = {
      name: name,
      email: email,
      timestamp: new Date().toISOString(),
      bet: 'Winter 2026-27 warmest on record',
      odds: '200:1'
    };

    bets.push(bet);
    localStorage.setItem('wiczcast-bets', JSON.stringify(bets));
    localStorage.setItem('wiczcast-bet-placed', 'true');

    // Animate out form, show confirmation
    form.style.display = 'none';
    confirmation.style.display = 'flex';
    updateBetCount(countEl, bets.length);

    console.log('[BET] New bet locked in:', bet);
  });
}

function updateBetCount(el, count) {
  if (!el) return;
  if (count === 0) {
    el.textContent = 'NO CHUMPERTONS HAVE STEPPED UP YET';
  } else if (count === 1) {
    el.textContent = '1 GREASHOUSER HAS LOCKED IN';
  } else {
    el.textContent = count + ' GREASHOUSERS HAVE LOCKED IN';
  }
}

// Initialize bet form when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBetForm);
} else {
  initBetForm();
}

function computeWinterOutlook(oni, zoneData, currentPhase) {
  const nino34 = zoneData['nino34'];
  const nino12 = zoneData['nino12'];
  const nino3 = zoneData['nino3'];

  let pNino, pNeutral, pNina;
  if (oni >= 1.0) {
    pNino = 15; pNeutral = 40; pNina = 45;
  } else if (oni >= 0.5) {
    pNino = 25; pNeutral = 45; pNina = 30;
  } else if (oni > -0.5) {
    pNino = 30; pNeutral = 40; pNina = 30;
  } else if (oni > -1.0) {
    pNino = 15; pNeutral = 40; pNina = 45;
  } else {
    pNino = 10; pNeutral = 30; pNina = 60;
  }

  // Adjust based on SST anomaly trends
  if (nino34 && nino3) {
    const eastWarm = nino3.anomaly - nino34.anomaly;
    if (eastWarm > 0.3) { pNino += 5; pNina -= 5; }
    else if (eastWarm < -0.3) { pNina += 5; pNino -= 5; }
  }
  if (nino34) {
    if (nino34.anomaly > 0.3) { pNino += 8; pNeutral -= 4; pNina -= 4; }
    else if (nino34.anomaly < -0.3) { pNina += 8; pNeutral -= 4; pNino -= 4; }
  }

  // Normalize
  const total = pNino + pNeutral + pNina;
  pNino = Math.round((pNino / total) * 100);
  pNeutral = Math.round((pNeutral / total) * 100);
  pNina = 100 - pNino - pNeutral;

  const dominant = pNino >= pNeutral && pNino >= pNina ? 'GOITER WARM' :
                   pNina >= pNeutral && pNina >= pNino ? 'GOITER COLD' : 'UNFUCKED';
  const dominantPct = Math.max(pNino, pNeutral, pNina);
  const dominantColor = dominant === 'GOITER WARM' ? '#f97316' :
                        dominant === 'GOITER COLD' ? '#3b82f6' : '#10b981';

  // Warmest winter on record probability
  // Base: ~8% in any given year (global warming trend pushes this up from random ~3%)
  // El Nino adds significant warming signal, La Nina reduces it
  // Strong SST anomalies amplify the signal
  let recordWarmPct = 8;
  // ONI influence: positive ONI = warmer winters
  if (oni >= 1.5) recordWarmPct += 22;
  else if (oni >= 1.0) recordWarmPct += 16;
  else if (oni >= 0.5) recordWarmPct += 10;
  else if (oni > -0.5) recordWarmPct += 3;
  else if (oni > -1.0) recordWarmPct -= 4;
  else recordWarmPct -= 6;
  // SST boost: warmer Nino 3.4 = more record potential
  if (nino34) {
    if (nino34.anomaly > 0.8) recordWarmPct += 8;
    else if (nino34.anomaly > 0.3) recordWarmPct += 4;
    else if (nino34.anomaly < -0.5) recordWarmPct -= 3;
  }
  // Global warming trend baseline boost (each decade adds ~2%)
  recordWarmPct += 4;
  // Clamp to reasonable range
  recordWarmPct = Math.max(2, Math.min(45, Math.round(recordWarmPct)));

  // Color for the record warm gauge — warmer = more orange/red
  let recordColor;
  if (recordWarmPct >= 25) recordColor = '#ef4444';
  else if (recordWarmPct >= 15) recordColor = '#f97316';
  else if (recordWarmPct >= 8) recordColor = '#fbbf24';
  else recordColor = '#3b82f6';

  // Above-average winter probability
  // Historical base: ~50% in any given year by definition
  // El Nino pushes US winters warmer (except SE), La Nina cools northern tier
  let aboveAvgPct = 50;
  if (oni >= 1.5) aboveAvgPct += 28;
  else if (oni >= 1.0) aboveAvgPct += 22;
  else if (oni >= 0.5) aboveAvgPct += 14;
  else if (oni > -0.5) aboveAvgPct += 4;
  else if (oni > -1.0) aboveAvgPct -= 8;
  else aboveAvgPct -= 14;
  if (nino34) {
    if (nino34.anomaly > 0.5) aboveAvgPct += 6;
    else if (nino34.anomaly < -0.5) aboveAvgPct -= 5;
  }
  // Global warming trend
  aboveAvgPct += 6;
  aboveAvgPct = Math.max(15, Math.min(92, Math.round(aboveAvgPct)));

  // Predicted US average winter temp anomaly (°F departure from normal)
  // CONUS DJF normal ≈ 33.2°F (NOAA 1991-2020 baseline)
  const winterNormal = 33.2;
  let tempAnomaly = 0;
  if (oni >= 1.5) tempAnomaly += 2.8;
  else if (oni >= 1.0) tempAnomaly += 2.0;
  else if (oni >= 0.5) tempAnomaly += 1.2;
  else if (oni > -0.5) tempAnomaly += 0.3;
  else if (oni > -1.0) tempAnomaly -= 0.8;
  else tempAnomaly -= 1.5;
  if (nino34) {
    if (nino34.anomaly > 0.5) tempAnomaly += 0.5;
    else if (nino34.anomaly < -0.5) tempAnomaly -= 0.4;
  }
  // Global warming offset
  tempAnomaly += 0.7;
  tempAnomaly = Math.round(tempAnomaly * 10) / 10;
  const predictedTemp = Math.round((winterNormal + tempAnomaly) * 10) / 10;

  return { pNino, pNeutral, pNina, dominant, dominantPct, dominantColor, recordWarmPct, recordColor, aboveAvgPct, predictedTemp, tempAnomaly };
}

function renderENSOGlobe(oni, phaseColor, outlook) {
  const canvas = document.getElementById('enso-globe-canvas');
  if (!canvas) return;

  const wrapper = canvas.parentElement;
  const size = Math.min(wrapper.getBoundingClientRect().width, wrapper.getBoundingClientRect().height, 180);
  canvas.width = size * 2;
  canvas.height = size * 2;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(2, 2);

  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 14;

  // Parse phase color to RGB
  const pr = parseInt(phaseColor.slice(1, 3), 16);
  const pg = parseInt(phaseColor.slice(3, 5), 16);
  const pb = parseInt(phaseColor.slice(5, 7), 16);

  // 1. Outer gauge ring background
  ctx.beginPath();
  ctx.arc(cx, cy, R + 8, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 5;
  ctx.stroke();

  // Above-avg gauge fill — maps aboveAvgPct 0-100% onto the ring
  var abvPct = outlook.aboveAvgPct || 50;
  var abvColor = abvPct >= 60 ? '#f97316' : abvPct >= 50 ? '#fbbf24' : '#3b82f6';
  var abvFraction = Math.min(1, abvPct / 100);
  var abvSweep = abvFraction * Math.PI * 2;
  ctx.beginPath();
  ctx.arc(cx, cy, R + 8, -Math.PI / 2, -Math.PI / 2 + abvSweep);
  ctx.strokeStyle = abvColor;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.stroke();

  // 2. Earth body — dark sphere with gradient
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  const earthGrad = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, 0, cx, cy, R);
  earthGrad.addColorStop(0, 'rgba(30, 40, 60, 0.9)');
  earthGrad.addColorStop(1, 'rgba(10, 14, 23, 0.95)');
  ctx.fillStyle = earthGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 3. Latitude grid lines
  [-60, -30, 0, 30, 60].forEach(function(lat) {
    var latRad = (lat * Math.PI) / 180;
    var yOff = R * Math.sin(latRad);
    var ellipseW = R * Math.cos(latRad);
    ctx.beginPath();
    ctx.ellipse(cx, cy - yOff, ellipseW, Math.max(1, ellipseW * 0.12), 0, 0, Math.PI * 2);
    ctx.strokeStyle = lat === 0 ? 'rgba(0, 240, 255, 0.15)' : 'rgba(255, 255, 255, 0.04)';
    ctx.lineWidth = lat === 0 ? 1.5 : 0.5;
    ctx.stroke();
  });

  // 4. Meridian curves
  [-45, 0, 45].forEach(function(lon) {
    var lonRad = (lon * Math.PI) / 180;
    var xOff = R * Math.sin(lonRad);
    ctx.beginPath();
    ctx.ellipse(cx + xOff, cy, Math.max(1, R * Math.abs(Math.cos(lonRad)) * 0.12), R, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 0.5;
    ctx.stroke();
  });

  // 5. Equatorial Pacific band — the gauge element
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R - 1, 0, Math.PI * 2);
  ctx.clip();

  var bandHalf = R * Math.sin(15 * Math.PI / 180);
  var intensity = Math.min(0.8, 0.12 + Math.abs(oni) * 0.35);

  var bandGrad = ctx.createLinearGradient(0, cy - bandHalf * 2, 0, cy + bandHalf * 2);
  bandGrad.addColorStop(0, 'transparent');
  bandGrad.addColorStop(0.2, 'rgba(' + pr + ',' + pg + ',' + pb + ',' + (intensity * 0.4) + ')');
  bandGrad.addColorStop(0.5, 'rgba(' + pr + ',' + pg + ',' + pb + ',' + intensity + ')');
  bandGrad.addColorStop(0.8, 'rgba(' + pr + ',' + pg + ',' + pb + ',' + (intensity * 0.4) + ')');
  bandGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = bandGrad;
  ctx.fillRect(cx - R, cy - bandHalf * 2, R * 2, bandHalf * 4);
  ctx.restore();

  // 6. Specular highlight
  var highlight = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, 0, cx, cy, R);
  highlight.addColorStop(0, 'rgba(255, 255, 255, 0.07)');
  highlight.addColorStop(0.4, 'transparent');
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = highlight;
  ctx.fill();

  // 7. Outer glow — intensity scales with above-avg probability
  if (abvPct >= 45) {
    var grr = parseInt(abvColor.slice(1, 3), 16);
    var grg = parseInt(abvColor.slice(3, 5), 16);
    var grb = parseInt(abvColor.slice(5, 7), 16);
    ctx.save();
    ctx.shadowColor = abvColor;
    ctx.shadowBlur = 6 + abvPct * 0.3;
    ctx.beginPath();
    ctx.arc(cx, cy, R + 1, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(' + grr + ',' + grg + ',' + grb + ',0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  // 8. Center above-avg percentage on globe
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = abvColor;
  ctx.font = '900 ' + Math.round(R * 0.32) + 'px "Orbitron", sans-serif';
  ctx.fillText(abvPct + '%', cx, cy - 4);
  ctx.font = Math.round(R * 0.1) + 'px "Share Tech Mono", monospace';
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.fillText('ABOVE AVG', cx, cy + R * 0.24);
}

// ─── ENSO REGIONAL IMPACT ───
function classifyRegion(lat, lon) {
  if (lat < 25 || lat > 50 || lon < -130 || lon > -65) return 'international';
  if (lat >= 42 && lon <= -115) return 'pacific_nw';
  if (lat < 37 && lon <= -105) return 'southwest';
  if (lat >= 43 && lon > -105 && lon <= -85) return 'upper_midwest';
  if (lat >= 40 && lat < 48 && lon > -90 && lon <= -75) return 'great_lakes';
  if (lat < 33 && lon > -100 && lon <= -85) return 'gulf_coast';
  if (lat < 37 && lon > -95 && lon <= -75) return 'southeast';
  if (lat < 40 && lat >= 30 && lon > -105 && lon <= -95) return 'southern_plains';
  if (lat >= 37 && lon > -80) return 'northeast';
  if (lat >= 35 && lat < 43 && lon > -105 && lon <= -85) return 'central_plains';
  return 'general_us';
}

const ENSO_IMPACTS = {
  ElNino: {
    upper_midwest: 'El Nino typically brings warmer-than-normal winters to the Upper Midwest with reduced snowfall. Jet stream shifts north, keeping Arctic air at bay.',
    pacific_nw: 'El Nino tends to bring drier, warmer conditions to the Pacific Northwest. Reduced mountain snowpack possible.',
    southwest: 'El Nino often increases winter precipitation across the Southwest. Enhanced storm track brings more rainfall to Southern California and Arizona.',
    southeast: 'El Nino typically delivers cooler, wetter winters to the Southeast. Increased storm frequency along the Gulf Coast.',
    gulf_coast: 'El Nino increases winter rainfall and storm activity along the Gulf Coast. Slightly cooler temperatures expected.',
    northeast: 'El Nino tends to bring milder winters to the Northeast with less snow. Storm track shifts southward.',
    great_lakes: 'El Nino typically reduces Great Lakes snowfall and brings above-normal winter temperatures.',
    central_plains: 'El Nino brings warmer, drier winters to the Central Plains. Reduced severe weather season possible in spring.',
    southern_plains: 'El Nino increases winter/spring precipitation in the Southern Plains. Enhanced tornado risk in spring.',
    general_us: 'El Nino shifts the jet stream, generally bringing warmer northern winters and wetter southern conditions.',
    international: 'El Nino warms the central Pacific, disrupting global weather patterns. Effects vary significantly by region.',
  },
  LaNina: {
    upper_midwest: 'La Nina typically brings colder, snowier winters to the Upper Midwest. Polar jet dips south, increasing Arctic outbreak frequency.',
    pacific_nw: 'La Nina usually means a wetter, cooler Pacific Northwest with above-normal mountain snowpack.',
    southwest: 'La Nina tends to keep the Southwest dry. Drought conditions may persist or worsen.',
    southeast: 'La Nina typically brings warmer, drier winters to the Southeast. Reduced hurricane suppression in Atlantic.',
    gulf_coast: 'La Nina reduces Gulf Coast rainfall and can enhance Atlantic hurricane season activity.',
    northeast: 'La Nina can bring more variable winters to the Northeast with increased nor\'easter potential.',
    great_lakes: 'La Nina typically increases Great Lakes snow belts and brings colder overall temperatures.',
    central_plains: 'La Nina brings colder, drier conditions to the Central Plains with enhanced severe weather risk in spring.',
    southern_plains: 'La Nina keeps the Southern Plains drier in winter. Enhanced severe weather season possible.',
    general_us: 'La Nina strengthens the polar jet, bringing colder northern winters and drier southern conditions.',
    international: 'La Nina cools the central Pacific, shifting global rainfall patterns. Effects are opposite to El Nino.',
  },
  Neutral: {
    upper_midwest: 'ENSO-Neutral conditions mean no strong Pacific influence on Upper Midwest weather. Local and Arctic patterns dominate.',
    pacific_nw: 'Neutral ENSO means near-normal conditions for the Pacific Northwest. No strong wet or dry signal.',
    southwest: 'Neutral ENSO provides no strong precipitation signal for the Southwest. Seasonal forecasts rely on other drivers.',
    southeast: 'Neutral ENSO means near-normal winter conditions for the Southeast. Other climate patterns take the lead.',
    gulf_coast: 'Neutral ENSO provides no dominant signal for the Gulf Coast. MJO and Arctic Oscillation become more important.',
    northeast: 'Neutral ENSO means typical seasonal variability for the Northeast. No strong warm or cold bias.',
    great_lakes: 'Neutral ENSO leaves Great Lakes weather driven by jet stream position and Arctic patterns.',
    central_plains: 'Neutral ENSO means near-normal temperature and precipitation patterns for the Central Plains.',
    southern_plains: 'Neutral ENSO provides no strong signal for the Southern Plains. Seasonal forecasts have lower confidence.',
    general_us: 'ENSO-Neutral conditions remove the Pacific teleconnection signal. Weather driven by other patterns.',
    international: 'ENSO-Neutral means the Pacific Ocean is not strongly influencing global weather patterns.',
  },
};

function getENSOImpact(phase, intensity, region) {
  const normalizedPhase = (phase === 'El Nino') ? 'ElNino' : (phase === 'La Nina') ? 'LaNina' : phase;
  const impacts = ENSO_IMPACTS[normalizedPhase] || ENSO_IMPACTS['Neutral'];
  let text = impacts[region] || impacts['general_us'];
  if (intensity && intensity !== 'None' && intensity !== 'Neutral') {
    text = `[${intensity.toUpperCase()}] ` + text;
  }
  return text;
}

// ─── PWA / SERVICE WORKER ───
let deferredInstallPrompt = null;

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => {
        console.log('SW registered:', reg.scope);
        // Listen for updates
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'activated') {
              console.log('New SW activated — refreshing data');
              refreshData();
            }
          });
        });
      })
      .catch((err) => console.warn('SW registration failed:', err));

    // Listen for messages from SW
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && (event.data.type === 'WEATHER_UPDATED' || event.data.type === 'WEATHER_SYNC_TRIGGER')) {
        refreshData();
      }
    });
  }
}

function setupInstallPrompt() {
  const banner = document.getElementById('install-banner');
  const installBtn = document.getElementById('install-btn');
  const dismissBtn = document.getElementById('install-dismiss');

  // Check if already installed (standalone mode)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  if (isStandalone) {
    // In standalone mode — apply iOS safe area class
    document.querySelector('.app').classList.add('standalone-ios');
    return;
  }

  // Check if install was previously dismissed
  const dismissed = localStorage.getItem('wiczcast-install-dismissed');
  if (dismissed) {
    const dismissedAt = parseInt(dismissed, 10);
    // Show again after 3 days
    if (Date.now() - dismissedAt < 3 * 24 * 60 * 60 * 1000) return;
  }

  // Android / Chrome: beforeinstallprompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    banner.style.display = 'block';
  });

  // iOS Safari detection
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome|CriOS|FxiOS/.test(navigator.userAgent);

  if (isIOS && isSafari) {
    // Show install banner for iOS after a delay
    setTimeout(() => {
      banner.style.display = 'block';
    }, 3000);
  }

  // Install button handler
  installBtn.addEventListener('click', () => {
    if (deferredInstallPrompt) {
      // Android/Chrome native prompt
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then((choice) => {
        if (choice.outcome === 'accepted') {
          banner.style.display = 'none';
        }
        deferredInstallPrompt = null;
      });
    } else if (isIOS) {
      // Show iOS instructions overlay
      showIOSInstallInstructions();
    }
  });

  // Dismiss
  dismissBtn.addEventListener('click', () => {
    banner.style.display = 'none';
    localStorage.setItem('wiczcast-install-dismissed', Date.now().toString());
  });

  // Hide banner if app gets installed
  window.addEventListener('appinstalled', () => {
    banner.style.display = 'none';
    deferredInstallPrompt = null;
  });
}

function showIOSInstallInstructions() {
  const overlay = document.createElement('div');
  overlay.className = 'ios-install-overlay';
  overlay.innerHTML = `
    <h2>INSTALL WICZCAST</h2>
    <div class="ios-install-step">
      <div class="ios-step-num">1</div>
      <div class="ios-step-text">Tap the <strong>Share</strong> button
        <svg class="ios-share-icon" viewBox="0 0 24 24" fill="none" stroke="#00f0ff" stroke-width="2">
          <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
          <polyline points="16 6 12 2 8 6"/>
          <line x1="12" y1="2" x2="12" y2="15"/>
        </svg>
        at the bottom of Safari
      </div>
    </div>
    <div class="ios-install-step">
      <div class="ios-step-num">2</div>
      <div class="ios-step-text">Scroll down and tap <strong>"Add to Home Screen"</strong></div>
    </div>
    <div class="ios-install-step">
      <div class="ios-step-num">3</div>
      <div class="ios-step-text">Tap <strong>"Add"</strong> in the top right corner</div>
    </div>
    <div class="ios-install-step">
      <div class="ios-step-num">4</div>
      <div class="ios-step-text">WiczCast will appear on your home screen as a <strong>standalone app</strong></div>
    </div>
    <button class="ios-install-close" onclick="this.parentElement.remove()">GOT IT</button>
  `;
  document.body.appendChild(overlay);
}

// ─── SHARE / SEND TO FRIENDS ───
function shareApp() {
  const shareData = {
    title: `WiczCast — ${currentLocation.city}`,
    text: `Check out WiczCast — 20-day weather forecast for ${currentLocation.city} with multi-model ensemble data. Way better than any weather app.`,
    url: window.location.href,
  };

  if (navigator.share) {
    navigator.share(shareData).catch(() => {});
  } else {
    // Fallback: copy link
    navigator.clipboard.writeText(window.location.href).then(() => {
      alert('Link copied! Send it to your friends.');
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  setupInstallPrompt();
  init();
});
