(() => {
  
  const API_BASE = 'http://127.0.0.1:5000/api';
  let chartInstance = null;
  const USD_TO_INR_RATE = 83;

  const fromInput = document.getElementById('from-input');
  const toInput = document.getElementById('to-input');
  const dateInput = document.getElementById('date-input');
  const fromSug = document.getElementById('from-sug');
  const toSug = document.getElementById('to-sug');
  const findButton = document.getElementById('find-button');
  const resultsContainer = document.getElementById('results-container');
  const loadingIndicator = document.getElementById('loading-indicator');
  const modal = document.getElementById('details-modal');
  const modalClose = document.querySelector('.modal-close');
  const modalTitle = document.getElementById('modal-title');
  const modalBody = document.getElementById('modal-body');
  const toast = document.getElementById('toast-notify');
  const chartCanvas = document.getElementById('busiestRoutesChart');
  const prefClass = document.getElementById('pref-class');
  const prefCurrency = document.getElementById('pref-currency');
  const savedFlightsContainer = document.getElementById('saved-flights-container');
  const noSavedFlightsMsg = document.getElementById('no-saved-flights');
  const comfortFilter = document.getElementById('comfort-filter');

  let savedFlights = JSON.parse(localStorage.getItem('flyWiseSaved')) || [];
  let userPrefs = JSON.parse(localStorage.getItem('flyWisePrefs')) || {
    currency: 'INR',
    class: 'Economy'
  };

  function savePrefs() {
    localStorage.setItem('flyWisePrefs', JSON.stringify(userPrefs));
  }

  prefClass.value = userPrefs.class;
  prefCurrency.value = userPrefs.currency;

  prefClass.addEventListener('change', (e) => {
    userPrefs.class = e.target.value;
    savePrefs();
    showToast('Class preference saved!', 'success');
  });
  prefCurrency.addEventListener('change', (e) => {
    userPrefs.currency = e.target.value;
    savePrefs();
    showToast('Currency preference saved!', 'success');
    renderSavedFlights();
  });

  function formatCurrency(valueInr) {
    if (userPrefs.currency === 'USD') {
      return `$${(valueInr / USD_TO_INR_RATE).toFixed(2)}`;
    }
    return `₹${Math.round(valueInr)}`;
  }
  
  const defaultDate = new Date();
  defaultDate.setDate(defaultDate.getDate() + 15);
  dateInput.value = defaultDate.toISOString().split('T')[0];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  dateInput.min = tomorrow.toISOString().split('T')[0];

  function showToast(message, type = 'danger') {
    toast.textContent = message;
    toast.className = 'toast show';
    toast.classList.add(type); 
    setTimeout(() => {
      toast.classList.remove('show');
    }, 3000);
  }

  async function fetchAirportSuggestions(query) {
    try {
      const resp = await fetch(`${API_BASE}/airports?q=${encodeURIComponent(query)}`);
      if (!resp.ok) throw new Error('Bad response');
      return await resp.json();
    } catch (err) {
      console.error('Failed to fetch suggestions:', err);
      return []; 
    }
  }

  function showSuggestions(listEl, inputEl, matches) {
    listEl.innerHTML = '';
    if (!matches.length) {
      listEl.classList.remove('show');
      return;
    }
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
  }

  fromInput.addEventListener('input', () => {
    const q = fromInput.value.trim();
    if (q.length < 2) { fromSug.classList.remove('show'); return; }
    fetchAirportSuggestions(q).then(matches => showSuggestions(fromSug, fromInput, matches));
  });

  toInput.addEventListener('input', () => {
    const q = toInput.value.trim();
    if (q.length < 2) { toSug.classList.remove('show'); return; }
    fetchAirportSuggestions(q).then(matches => showSuggestions(toSug, toInput, matches));
  });

  async function handleSearch() {
    const fromIata = fromInput.value.trim().toUpperCase();
    const toIata = toInput.value.trim().toUpperCase();
    const departureDate = dateInput.value; 
    const priority = document.querySelector('input[name="priority"]:checked').value;
    const minComfort = comfortFilter.value; 
    const prefClass = userPrefs.class; 

    if (!fromIata || !toIata) {
      showToast('Please enter both origin and destination.');
      return;
    }
    
    if (!departureDate) {
      showToast('Please select a departure date.');
      return;
    }
    const today = new Date();
    const depDate = new Date(departureDate);
    today.setHours(0, 0, 0, 0);
    depDate.setHours(0, 0, 0, 0);
    const diffTime = depDate - today;
    const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (daysLeft < 1) {
      showToast('Please select a future date.');
      return;
    }

    loadingIndicator.classList.remove('hidden');
    resultsContainer.innerHTML = '';
    findButton.disabled = true;
    findButton.textContent = 'Searching...';

    const apiUrl = `${API_BASE}/routes?from=${fromIata}&to=${toIata}&priority=${priority}&days_left=${daysLeft}&min_comfort=${minComfort}&class=${prefClass}`;

    try {
      const response = await fetch(apiUrl);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('No flights found for this route.');
        }
        throw new Error(`Server error: ${response.statusText}`);
      }
      const flights = await response.json();

      if (!Array.isArray(flights)) {
        throw new Error('Invalid response from server.');
      }
      if (flights.length === 0) {
        resultsContainer.innerHTML = '<p class="loader-text">No flights found for this route.</p>';
      } else {
        flights.forEach(flight => {
          const flightCard = createFlightCard(flight, false); 
          resultsContainer.appendChild(flightCard);
        });
        loadInsights();
      }
    } catch (error) {
      console.error('Error fetching flights:', error);
      if (error.message.includes('No flights found')) {
        resultsContainer.innerHTML = '<p class="loader-text">No flights found for this route.</p>';
      } else {
        showToast('Error loading flights. Please try again.');
      }
    } finally {
      loadingIndicator.classList.add('hidden');
      findButton.disabled = false;
      findButton.textContent = 'Find Flights';
    }
  }

  findButton.addEventListener('click', handleSearch);

  async function loadInsights() {
    try {
      const response = await fetch(`${API_BASE}/insights/busiest-routes`);
      if (!response.ok) return; 
      const data = await response.json();

      if (!data || data.length === 0) {
        console.log('No insights data to display yet.');
        return;
      }
      const labels = data.map(route => `${route.origin_iata} → ${route.dest_iata}`);
      const values = data.map(route => route.search_count);

      if (chartInstance) {
        chartInstance.destroy(); 
      }
      
      const ctx = chartCanvas.getContext('2d');
      if (!ctx) return; 

      chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{
            label: 'Total Searches',
            data: values,
            backgroundColor: 'rgba(14, 165, 233, 0.6)',
            borderColor: 'rgba(14, 165, 233, 1)',
            borderWidth: 1,
            borderRadius: 5,
          }]
        },
        options: {
          scales: {
            y: {
              beginAtZero: true,
              ticks: { stepSize: 1, color: 'white' },
              grid: { color: 'rgba(255, 255, 255, 0.1)' }
            },
            x: {
              ticks: { color: 'white' },
              grid: { color: 'rgba(255, 255, 255, 0.05)' }
            }
          },
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: '#0b1220',
                titleColor: 'white',
                bodyColor: 'white',
                padding: 10
            }
          }
        }
      });
    } catch (error) {
      console.error('Error loading insights:', error);
    }
  }
  
  function createFlightCard(flight, isSavedCard) {
    const card = document.createElement('div');
    card.className = 'flight-card';

    const cost = formatCurrency(flight.cost_inr);
    const duration = flight.duration_hours.toFixed(1);
    const co2 = Math.round(flight.co2_kg);
    const originComfort = (flight.origin_comfort_score || 4.0).toFixed(1);
    const destComfort = (flight.dest_comfort_score || 4.0).toFixed(1);
    
    const starIcon = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fill-rule="evenodd" d="M10.868 2.884c.321-.772 1.415-.772 1.736 0l1.681 4.06c.064.155.19.27.357.3l4.467.65c.801.117 1.12.964.545 1.49l-3.232 3.15c-.12.117-.175.28-.15.445l.764 4.45c.137.798-.7.14-1.423-.33l-3.985-2.095a.998.998 0 00-.916 0l-3.985 2.095c-.723.38-1.56-.532-1.423-.33l.764-4.45c.025-.165-.03-.328-.15-.445L.454 9.384c-.576-.526-.256-1.373.545-1.49l4.467-.65c.167-.024.3-.145.357-.3L9.13 2.884z" clip-rule="evenodd" />
      </svg>`;
      
    const logoIcon = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
      </svg>`;

    card.innerHTML = `
      <div class="card-header">
        <div class="card-logo">
          <div class="logo-bg">
            ${logoIcon}
          </div>
          <div>
            <div class="card-airline">${flight.airline}</div>
            <div class="card-flight-num">${flight.flight_number || 'N/A'}</div>
          </div>
        </div>
        <div class="pill">${cost}</div>
      </div>
      <div class="card-main">
        <div class="route-col">
          <div class="iata">${flight.Source}</div>
          <div class="card-meta">
            ${starIcon}
            ${originComfort} Comfort
          </div>
        </div>
        <div class="route-arrow">→</div>
        <div class="route-col" style="text-align: right;">
          <div class="iata">${flight.Destination}</div>
          <div class="card-meta" style="justify-content: flex-end;">
            ${starIcon}
            ${destComfort} Comfort
          </div>
        </div>
      </div>
      <div class="card-stats">
        <div class="stat-item">Duration<strong>${duration} hrs</strong></div>
        <div class="stat-item">CO2 Est.<strong>${co2} kg</strong></div>
      </div>
      <div class="card-actions">
      </div>
    `;
    
    const actionsContainer = card.querySelector('.card-actions');
    if (isSavedCard) {
      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Remove';
      removeBtn.className = 'card-btn remove-btn';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation(); 
        removeSavedFlight(flight);
      });
      actionsContainer.appendChild(removeBtn);
    } else {
      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Save';
      saveBtn.className = 'card-btn save-btn';
      saveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        addSavedFlight(flight);
      });
      actionsContainer.appendChild(saveBtn);
    }

    card.addEventListener('click', () => showFlightDetails(flight));
    return card;
  }

  async function showFlightDetails(flight) {
    if (!modal || !modalTitle || !modalBody) {
      console.error('Cannot show details, modal elements not found.');
      return;
    }

    const depTime = flight.departure_time ? new Date(flight.departure_time).toLocaleString() : 'N/A';
    const arrTime = flight.arrival_time ? new Date(flight.arrival_time).toLocaleString() : 'N/A';

    modalTitle.textContent = `${flight.airline} (${flight.flight_number || 'N/A'})`;
    modalBody.innerHTML = `
      <p><strong>Route:</strong> ${flight.Source} → ${flight.Destination}</p>
      <p><strong>Departure:</strong> ${depTime}</p>
      <p><strong>Arrival:</strong> ${arrTime}</p>
      <hr>
      <p><strong>Est. Current Cost:</strong> ${formatCurrency(flight.cost_inr)}</p>
      <p><strong>Duration:</strong> ${flight.duration_hours} hours</p>
      <p><strong>Est. Carbon Footprint:</strong> ${Math.round(flight.co2_kg)} kg CO2</p>
      <p><strong>Origin Comfort:</strong> ${flight.origin_comfort_score} / 5.0</p>
      <p><strong>Dest. Comfort:</strong> ${flight.dest_comfort_score} / 5.0</p>
      <hr>
      <p id="prediction-result"><strong>Typical Fare (ML Model):</strong> Fetching...</p>
    `;
    modal.classList.add('open');
    modal.classList.remove('hidden');

    const predictionInput = {
      Duration_in_hours: flight.duration_hours,
      Days_left: flight.Days_left, 
      Journey_Month: depTime !== 'N/A' ? new Date(flight.departure_time).getMonth() + 1 : null,
      Journey_DayOfWeek: depTime !== 'N/A' ? new Date(flight.departure_time).getDay() : null, 
      Departure_Num: depTime !== 'N/A' ? mapTimeToNum(new Date(flight.departure_time).getHours()) : null,
      Arrival_Num: arrTime !== 'N/A' ? mapTimeToNum(new Date(flight.arrival_time).getHours()) : null,
      Total_stops: mapStopsNumToString(flight.Total_stops_Num),
      Airline: flight.airline,
      Source: flight.Source,
      Destination: flight.Destination,
      Class: flight.Class
    };

    const predictionResultElement = document.getElementById('prediction-result');

    try {
      const response = await fetch(`${API_BASE}/predict-fare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(predictionInput),
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error || 'Prediction failed');
      }
      
      let insightText = '';
      const predicted = data.predicted_fare_inr;
      const current = flight.cost_inr;
      const predictedFormatted = formatCurrency(predicted);
      
      const goodDealThreshold = predicted * 0.9; 
      const badDealThreshold = predicted * 1.1;  
      const spotOnLower = predicted * 0.98; 
      const spotOnUpper = predicted * 1.02; 

      if (current < goodDealThreshold) {
          insightText = ` <span class="prediction-good">(Great Deal! This is much cheaper than the typical ${predictedFormatted} fare)</span>`;
      } else if (current > badDealThreshold) {
          insightText = ` <span class="prediction-bad">(Price is high. The typical fare is closer to ${predictedFormatted})</span>`;
      } else if (current >= spotOnLower && current <= spotOnUpper) {
          insightText = ` <span class="prediction-good">(Spot on! This price is right at the typical ${predictedFormatted} fare)</span>`;
      } else {
          insightText = ` <span>(This price is about average for this booking time.)</span>`;
      }
      
      predictionResultElement.innerHTML = `<strong>Typical Fare (ML Model):</strong> ${predictedFormatted} ${insightText}`;
      
    } catch (error) {
      console.error('Error calling prediction endpoint:', error);
      predictionResultElement.textContent = `Prediction Error: ${error.message}`;
    }
  }

  modalClose.addEventListener('click', () => {
    modal.classList.remove('open');
    modal.classList.add('hidden');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('open');
      modal.classList.add('hidden');
    }
  });
  
  function renderSavedFlights() {
    savedFlightsContainer.innerHTML = ''; 
    if (savedFlights.length === 0) {
      noSavedFlightsMsg.style.display = 'block';
    } else {
      noSavedFlightsMsg.style.display = 'none';
      savedFlights.forEach(flight => {
        const card = createFlightCard(flight, true);
        savedFlightsContainer.appendChild(card);
      });
    }
  }

  function addSavedFlight(flight) {
    if (!savedFlights.some(f => f.id === flight.id && f.departure_time === flight.departure_time)) {
      savedFlights.push(flight);
      localStorage.setItem('flyWiseSaved', JSON.stringify(savedFlights));
      renderSavedFlights();
      showToast('Flight saved!', 'success');
    } else {
      showToast('Flight already saved.');
    }
  }

  function removeSavedFlight(flight) {
    savedFlights = savedFlights.filter(f => !(f.id === flight.id && f.departure_time === flight.departure_time));
    localStorage.setItem('flyWiseSaved', JSON.stringify(savedFlights));
    renderSavedFlights();
    showToast('Flight removed.', 'success');
  }


  function mapTimeToNum(hour) {
    if (hour < 6) return 0;
    if (hour < 12) return 1;
    if (hour < 18) return 2;
    return 3;
  }
  function mapStopsNumToString(stopsNum) {
    if (stopsNum === 0) return 'non-stop';
    if (stopsNum === 1) return '1-stop';
    return '2+-stops';
  }

  document.addEventListener('click', (e) => {
    if (!fromInput.contains(e.target) && !fromSug.contains(e.target)) fromSug.classList.remove('show');
    if (!toInput.contains(e.target) && !toSug.contains(e.target)) toSug.classList.remove('show');
  });

  [fromInput, toInput, dateInput].forEach(inp => inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      findButton.click();
    }
  }));

  loadInsights();
  renderSavedFlights();

})(); 