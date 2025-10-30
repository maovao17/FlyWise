/* FlyWise JS: modern UX, animations, suggestions, chart, modal, graceful fallback */
/* Assumes Chart.js loaded (deferred) and DOMContentLoaded by 'defer' script loading. */

(() => {
  // ---------- Config ----------
  const API_BASE = 'http://127.0.0.1:5000/api'; // keep for your backend
  const USE_DEMO = false; // toggled by demo button; initial helpful fallback true
  let demoMode = USE_DEMO;

  // small list of IATA codes + names for suggestions (extend as needed)
  async function fetchAirportSuggestions(query) {
  try {
    const resp = await fetch(`${API_BASE}/airports?q=${encodeURIComponent(query)}`);
    if (!resp.ok) throw new Error('Bad response');
    return await resp.json();
  } catch {
    return []; // fallback empty
  }
}

function showSuggestions(listEl, inputEl) {
  const q = inputEl.value.trim();
  listEl.innerHTML = '';
  if (!q) { listEl.classList.remove('show'); return; }

  fetchAirportSuggestions(q).then(matches => {
    if (!matches.length) { listEl.classList.remove('show'); return; }
    matches.forEach(m => {
      const li = document.createElement('li');
      li.innerHTML = `<strong>${m.iata}</strong> — ${m.name}, ${m.city}`;
      li.addEventListener('click', () => {
        inputEl.value = m.iata;
        listEl.classList.remove('show');
      });
      listEl.appendChild(li);
    });
    listEl.classList.add('show');
  });
}
  // demo fallback flights (used if API fails)
  const DEMO_FLIGHTS = (from, to) => ([
    { airline: 'AirSmart', flight_number: 'AS 214', cost_usd: 320, duration_hours: 7.3, eco_score: 2.1, origin_comfort_score: 4.2, dest_comfort_score: 3.9, departure_time: new Date(Date.now()+36*3600e3).toISOString(), arrival_time: new Date(Date.now()+36*3600e3 + 7.3*3600e3).toISOString(), Days_left: 30, Total_stops_Num: 0, Airline: 'AirSmart', Source: from, Destination: to, Class: 'Economy' },
    { airline: 'GreenWings', flight_number: 'GW 77', cost_usd: 395, duration_hours: 6.8, eco_score: 1.2, origin_comfort_score: 4.6, dest_comfort_score: 4.1, departure_time: new Date(Date.now()+48*3600e3).toISOString(), arrival_time: new Date(Date.now()+48*3600e3 + 6.8*3600e3).toISOString(), Days_left: 45, Total_stops_Num: 1, Airline: 'GreenWings', Source: from, Destination: to, Class: 'Economy' },
    { airline: 'BudgetAir', flight_number: 'BA 545', cost_usd: 260, duration_hours: 11.4, eco_score: 3.8, origin_comfort_score: 3.4, dest_comfort_score: 3.2, departure_time: new Date(Date.now()+24*3600e3).toISOString(), arrival_time: new Date(Date.now()+24*3600e3 + 11.4*3600e3).toISOString(), Days_left: 7, Total_stops_Num: 2, Airline: 'BudgetAir', Source: from, Destination: to, Class: 'Economy' }
  ]);

  // ---------- Elements ----------
  const fromInput = document.getElementById('from-input');
  const toInput = document.getElementById('to-input');
  const findButton = document.getElementById('find-button');
  const clearButton = document.getElementById('clear-button');
  const resultsContainer = document.getElementById('results-container');
  const loadingIndicator = document.getElementById('loading-indicator');
  const modal = document.getElementById('details-modal');
  const modalContent = modal.querySelector('.modal-content');
  const modalClose = modal.querySelector('.modal-close');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const toast = document.getElementById('toast');
  const demoBtn = document.getElementById('demo-data-btn');

  const fromSug = document.getElementById('from-suggestions');
  const toSug = document.getElementById('to-suggestions');

  // Chart-related
  let busiestChart = null;

  // ---------- Utilities ----------
  const el = (tag, cls = '') => {
    const d = document.createElement(tag);
    if (cls) d.className = cls;
    return d;
  };

  function showToast(msg, ms = 3500) {
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), ms);
  }

  function showLoading(on = true) {
    if (on) {
      loadingIndicator.classList.remove('hidden');
      loadingIndicator.setAttribute('aria-hidden', 'false');
    } else {
      loadingIndicator.classList.add('hidden');
      loadingIndicator.setAttribute('aria-hidden', 'true');
    }
  }

  function mapStopsNumToString(stopsNum) {
    if (stopsNum === 0) return 'non-stop';
    if (stopsNum === 1) return '1-stop';
    return '2+-stops';
  }

  function mapTimeToNum(hour) {
    if (hour < 6) return 0;
    if (hour < 12) return 1;
    if (hour < 18) return 2;
    return 3;
  }

  // debounce helper
  function debounce(fn, delay = 220) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
  }

  // ---------- Suggestions (basic fuzzy match) ----------
  function showSuggestions(listEl, inputEl, data) {
    const q = inputEl.value.trim().toUpperCase();
    listEl.innerHTML = '';
    if (!q) { listEl.classList.remove('show'); return; }
    const matches = data.filter(item => item.code.includes(q) || item.name.toUpperCase().includes(q)).slice(0,10);
    if (!matches.length) {
      const li = el('li'); li.textContent = 'No matches'; li.className='no-match';
      listEl.appendChild(li); listEl.classList.add('show'); return;
    }
    matches.forEach(m => {
      const li = el('li');
      li.tabIndex = 0;
      li.setAttribute('role','option');
      li.innerHTML = `<strong>${m.code}</strong> — <span style="color: #6b7280">${m.name}</span>`;
      li.addEventListener('click', () => {
        inputEl.value = m.code;
        listEl.classList.remove('show');
      });
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { inputEl.value = m.code; listEl.classList.remove('show'); }
      });
      listEl.appendChild(li);
    });
    listEl.classList.add('show');
  }

  // ---------- Flight card creation ----------
  function createFlightCard(flight, delayIndex = 0) {
    const card = el('article', 'flight-card');
    card.tabIndex = 0; // keyboard accessible
    // structured content
    const title = el('h3'); title.textContent = `${flight.airline} • ${flight.flight_number || '—'}`;
    const costWrap = el('div','meta-row');
    costWrap.innerHTML = `<div>Fare</div><div class="big">$${flight.cost_usd}</div>`;

    const duration = el('div','meta-row');
    duration.innerHTML = `<div>Duration</div><div class="big">${flight.duration_hours} hrs</div>`;

    const eco = el('div','meta-row');
    eco.innerHTML = `<div>Eco score</div><div class="pill">${flight.eco_score} <span style="opacity:.6;margin-left:6px;font-weight:400"> (lower better)</span></div>`;

    const airports = el('div','meta-row');
    airports.innerHTML = `<div>Route</div><div class="big">${flight.Source || 'N/A'} → ${flight.Destination || 'N/A'}</div>`;

    card.appendChild(title);
    card.appendChild(costWrap);
    card.appendChild(duration);
    card.appendChild(eco);
    card.appendChild(airports);

    // animate entrance
    setTimeout(() => card.classList.add('visible'), 60 * delayIndex);

    // click and keyboard open modal
    card.addEventListener('click', () => showFlightDetails(flight));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') showFlightDetails(flight); });

    return card;
  }

  // ---------- Show details modal & call prediction ----------
  async function showFlightDetails(flight) {
    // populate
    modalTitle.textContent = `${flight.airline} ${flight.flight_number || ''}`.trim();
    const dep = flight.departure_time ? new Date(flight.departure_time).toLocaleString() : 'N/A';
    const arr = flight.arrival_time ? new Date(flight.arrival_time).toLocaleString() : 'N/A';

    modalBody.innerHTML = `
      <p><strong>Departure:</strong> ${dep}</p>
      <p><strong>Arrival:</strong> ${arr}</p>
      <hr/>
      <p><strong>Fare (API):</strong> $${flight.cost_usd}</p>
      <p><strong>Duration:</strong> ${flight.duration_hours} hrs</p>
      <p><strong>Eco Score:</strong> ${flight.eco_score}</p>
      <p><strong>Stops:</strong> ${mapStopsNumToString(flight.Total_stops_Num)}</p>
      <p><strong>Origin Comfort:</strong> ${flight.origin_comfort_score} / 5.0</p>
      <p><strong>Destination Comfort:</strong> ${flight.dest_comfort_score} / 5.0</p>
      <hr/>
      <p id="prediction-result"><strong>Predicted Fare:</strong> Fetching...</p>
    `;

    // show modal with animation
    modal.classList.remove('hidden');
    requestAnimationFrame(() => modal.classList.add('open'));

    // prepare prediction payload
    const depDate = flight.departure_time ? new Date(flight.departure_time) : null;
    const arrDate = flight.arrival_time ? new Date(flight.arrival_time) : null;
    const payload = {
      Duration_in_hours: flight.duration_hours,
      Days_left: flight.Days_left || 7,
      Journey_Month: depDate ? (depDate.getMonth() + 1) : null,
      Journey_DayOfWeek: depDate ? depDate.getDay() : null,
      Departure_Num: depDate ? mapTimeToNum(depDate.getHours()) : null,
      Arrival_Num: arrDate ? mapTimeToNum(arrDate.getHours()) : null,
      Total_stops: mapStopsNumToString(flight.Total_stops_Num),
      Airline: flight.Airline,
      Source: flight.Source,
      Destination: flight.Destination,
      Class: flight.Class || 'Economy'
    };

    // call prediction endpoint (with timeout)
    const predEl = document.getElementById('prediction-result');
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 4500);

      const resp = await fetch(`${API_BASE}/predict-fare`, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      clearTimeout(id);
      if (!resp.ok) throw new Error('Prediction service error');
      const data = await resp.json();
      if (data && data.predicted_fare_inr !== undefined) {
        predEl.innerHTML = `<strong>Predicted Fare (ML):</strong> ₹ ${data.predicted_fare_inr} INR`;
      } else {
        throw new Error(data?.error || 'Invalid response');
      }
    } catch (err) {
      // graceful fallback message
      predEl.innerHTML = `<strong>Predicted Fare:</strong> unavailable — (prediction service offline)`;
    }
  }

  // ---------- Close modal helpers ----------
  function closeModal() {
    modal.classList.remove('open');
    setTimeout(() => modal.classList.add('hidden'), 220);
  }
  modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // ---------- Render results (main entry) ----------
  async function searchFlights(from, to, priority) {
    // clear previous
    resultsContainer.innerHTML = '';
    showLoading(true);

    // Build URL
    const url = `${API_BASE}/routes?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&priority=${encodeURIComponent(priority)}`;

    try {
      // try network fetch with timeout
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 4500);
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(id);

      if (!resp.ok) throw new Error('API fetch failed');
      const flights = await resp.json();
      renderFlightsArray(Array.isArray(flights) ? flights : []);

      showLoading(false);
    } catch (err) {
      // If network fails, use demo or fallback
      showLoading(false);
      if (demoMode) {
        showToast('Using demo results (backend unreachable)');
        const demo = DEMO_FLIGHTS(from, to);
        renderFlightsArray(demo);
      } else {
        showToast('Could not fetch flights — try demo mode');
        resultsContainer.innerHTML = '<div style="color:#6b7280;padding:16px;border-radius:10px;background:#fff;"><strong>Error:</strong> Could not reach the backend.</div>';
      }
    }
  }

  function renderFlightsArray(arr) {
    resultsContainer.innerHTML = '';
    if (!arr || !arr.length) {
      resultsContainer.innerHTML = '<div style="padding:16px;color:#6b7280;background:#fff;border-radius:12px">No flights found for this route.</div>';
      return;
    }
    arr.forEach((f, i) => {
      const c = createFlightCard(f, i + 1);
      resultsContainer.appendChild(c);
    });
  }

  // ---------- Load insights chart ----------
  async function loadInsights() {
    // try to fetch; fallback to demo
    try {
      const resp = await fetch(`${API_BASE}/insights/busiest-routes`);
      if (!resp.ok) throw new Error('No insights');
      const data = await resp.json();
      buildChartFromData(Array.isArray(data) ? data : []);
    } catch (err) {
      // demo chart data
      const demo = [
        { origin_iata: 'LHR', dest_iata: 'JFK', search_count: 24 },
        { origin_iata: 'DEL', dest_iata: 'DXB', search_count: 17 },
        { origin_iata: 'SFO', dest_iata: 'HND', search_count: 12 },
        { origin_iata: 'BOM', dest_iata: 'SIN', search_count: 8 }
      ];
      buildChartFromData(demo);
    }
  }

  function buildChartFromData(data) {
    const labels = data.map(r => `${r.origin_iata} → ${r.dest_iata}`);
    const values = data.map(r => Number(r.search_count || 0));
    const ctx = document.getElementById('busiestRoutesChart').getContext('2d');

    if (busiestChart) {
      busiestChart.data.labels = labels;
      busiestChart.data.datasets[0].data = values;
      busiestChart.update();
      return;
    }

    busiestChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Searches',
          data: values,
          // Chart.js default colors are used; don't force color
          borderWidth: 1,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 800 },
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } }
        }
      }
    });
  }

  // ---------- Events ----------
  // Submit handler
  document.getElementById('search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const from = fromInput.value.trim().toUpperCase();
    const to = toInput.value.trim().toUpperCase();
    const priority = document.querySelector('input[name="priority"]:checked').value;

    if (!from || !to) { showToast('Please enter both From and To IATA codes'); return; }
    if (from === to) { showToast('From and To cannot be the same'); return; }

    searchFlights(from, to, priority);
  });

  // Clear form
  clearButton.addEventListener('click', () => {
    fromInput.value = '';
    toInput.value = '';
    resultsContainer.innerHTML = '';
    showToast('Cleared search');
  });

  // Demo toggle
  demoBtn.addEventListener('click', () => {
    demoMode = !demoMode;
    demoBtn.textContent = demoMode ? 'Demo data' : 'Live only';
    showToast(`Demo mode ${demoMode ? 'ON' : 'OFF'}`);
  });

  // suggestions behavior
  fromInput.addEventListener('input', debounce(() => showSuggestions(fromSug, fromInput, IATA_LIST), 120));
  toInput.addEventListener('input', debounce(() => showSuggestions(toSug, toInput, IATA_LIST), 120));

  // hide suggestions on blur
  document.addEventListener('click', (e) => {
    if (!fromInput.contains(e.target) && !fromSug.contains(e.target)) fromSug.classList.remove('show');
    if (!toInput.contains(e.target) && !toSug.contains(e.target)) toSug.classList.remove('show');
  });

  // keyboard: press Enter in inputs to trigger search
  [fromInput, toInput].forEach(inp => inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      findButton.click();
    }
  }));

  // ---------- Initial load ----------
  loadInsights();
  // Optionally preload suggestions cache (we already have IATA_LIST)

  // small accessibility: focus trap when modal open (simple)
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      const focusables = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // Small initial demo search so the UI isn't empty (optional)
  if (demoMode) {
    // populate some defaults
    fromInput.value = 'BOM';
    toInput.value = 'DEL';
    // tiny delay then run
    setTimeout(() => {
      document.getElementById('search-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }, 450);
  }
})();
