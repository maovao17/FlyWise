// Wait for the page to load before running scripts
document.addEventListener('DOMContentLoaded', () => {

    // Get all the elements we need
    const fromInput = document.getElementById('from-input');
    const toInput = document.getElementById('to-input');
    const findButton = document.getElementById('find-button');
    const resultsContainer = document.getElementById('results-container');
    const loadingIndicator = document.getElementById('loading-indicator');
    const modal = document.getElementById('details-modal');
    const modalClose = document.querySelector('.modal-close');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');

    // --- ADD MODAL CLOSE LISTENERS ---
    if (modal && modalClose) {
         modalClose.addEventListener('click', () => {
             modal.classList.add('hidden');
         });

         modal.addEventListener('click', (event) => {
             // Close if user clicks outside the modal content
             if (event.target === modal) {
                 modal.classList.add('hidden');
             }
         });
    } else {
        console.error("Modal elements not found!");
    }
    // --- END OF MODAL CLOSE LISTENERS ---


    // --- FIND BUTTON LISTENER ---
    findButton.addEventListener('click', () => {
        // 1. Get user's input
        const fromIata = fromInput.value.trim().toUpperCase();
        const toIata = toInput.value.trim().toUpperCase();
        const priority = document.querySelector('input[name="priority"]:checked').value;

        if (!fromIata || !toIata) {
            alert('Please enter both "From" and "To" IATA codes (e.g., LHR, JFK).');
            return;
        }

        // 2. Show loading and clear old results
        loadingIndicator.classList.remove('hidden');
        resultsContainer.innerHTML = ''; // Clear previous results

        // 3. Build the API URL
        const apiUrl = `http://127.0.0.1:5000/api/routes?from=${fromIata}&to=${toIata}&priority=${priority}`;

        // 4. Call your backend API!
        fetch(apiUrl)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Network response was not ok (Status: ${response.status})`);
                }
                return response.json();
            })
            .then(flights => {
                // 5. Success! Hide loading and show flights
                loadingIndicator.classList.add('hidden');

                if (!Array.isArray(flights)) {
                     console.error("API did not return an array:", flights);
                     resultsContainer.innerHTML = '<p>Error: Invalid response from server.</p>';
                     return;
                }


                if (flights.length === 0) {
                    resultsContainer.innerHTML = '<p>No flights found for this route.</p>';
                    return;
                }

                // Loop through each flight and create a card for it
                flights.forEach(flight => {
                    const flightCard = createFlightCard(flight);
                    resultsContainer.appendChild(flightCard);
                });
            })
            .catch(error => {
                // 6. Handle errors
                loadingIndicator.classList.add('hidden');
                console.error('Error fetching flights:', error);
                resultsContainer.innerHTML = '<p>Error loading flights. Please check the console and try again.</p>';
            });
    }); // --- END OF FIND BUTTON LISTENER ---


    // --- FUNCTION DEFINITIONS ---

    /**
     * Creates an HTML element for a single flight card.
     * @param {object} flight - A flight object from your API
     * @returns {HTMLElement} A div element representing the flight card
     */
    function createFlightCard(flight) {
        const card = document.createElement('div');
        card.className = 'flight-card';
        // console.log('Creating card element for flight:', flight.id); // Optional Debugging

        // Use template literals to build the HTML for the card
        card.innerHTML = `
            <h3>${flight.airline} (${flight.flight_number || 'N/A'})</h3>
            <div class="stat">
                Cost
                <strong>$${flight.cost_usd}</strong>
            </div>
            <div class="stat">
                Duration
                <strong>${flight.duration_hours} hrs</strong>
            </div>
            <div class="stat">
                Eco Score (Low is Good)
                <strong>${flight.eco_score}</strong>
            </div>
            <div class="stat">
                Airport Comfort
                <strong>${flight.origin_comfort_score} / 5.0</strong>
            </div>
        `;

        // Add click listener to the card
        card.addEventListener('click', () => {
            // console.log('Card clicked! Flight ID:', flight.id); // Optional Debugging
            showFlightDetails(flight); // Call the function to show the modal
        });

        return card;
    }


    /**
     * Displays the flight details modal and fetches the ML prediction.
     * @param {object} flight - The flight object clicked by the user
     */
    async function showFlightDetails(flight) {
        // console.log('showFlightDetails called for flight ID:', flight.id); // Optional Debugging

        // 1. Check if modal elements are available
        if (!modal || !modalTitle || !modalBody) {
            console.error("Cannot show details, modal elements not found.");
            return;
        }

        // 2. Populate the modal with basic flight data
        modalTitle.textContent = `${flight.airline} Flight ${flight.flight_number || 'N/A'}`;

        const depTime = flight.departure_time ? new Date(flight.departure_time).toLocaleString() : 'N/A';
        const arrTime = flight.arrival_time ? new Date(flight.arrival_time).toLocaleString() : 'N/A';

        // Initial modal content (without prediction)
        modalBody.innerHTML = `
            <p><strong>Departure:</strong> ${depTime}</p>
            <p><strong>Arrival:</strong> ${arrTime}</p>
            <hr>
            <p><strong>Cost:</strong> $${flight.cost_usd}</p>
            <p><strong>Duration:</strong> ${flight.duration_hours} hours</p>
            <p><strong>Eco Score:</strong> ${flight.eco_score} (Lower is better)</p>
            <p><strong>Origin Comfort:</strong> ${flight.origin_comfort_score} / 5.0</p>
            <p><strong>Destination Comfort:</strong> ${flight.dest_comfort_score} / 5.0</p>
            <hr>
            <p id="prediction-result"><strong>Predicted Fare:</strong> Fetching...</p>
        `;

        // 3. Show the modal
        modal.classList.remove('hidden');

        // 4. Prepare data for the prediction service
        //    CRITICAL: Ensure your main backend ('/api/routes') actually returns
        //    'Days_left', 'Source', 'Destination', 'Class', 'Total_stops_Num' in the flight objects
        //    Otherwise, predictionInput will have undefined values!
        const predictionInput = {
            Duration_in_hours: flight.duration_hours,
            // You MUST ensure 'Days_left' comes from your /api/routes response
            Days_left: flight.Days_left || 30, // Defaulting to 30 if missing - **FIX THIS IN BACKEND**
            Journey_Month: depTime !== 'N/A' ? new Date(flight.departure_time).getMonth() + 1 : null,
            Journey_DayOfWeek: depTime !== 'N/A' ? new Date(flight.departure_time).getDay() : null, // Adjust if model needs Mon=0
            Departure_Num: depTime !== 'N/A' ? mapTimeToNum(new Date(flight.departure_time).getHours()) : null,
            Arrival_Num: arrTime !== 'N/A' ? mapTimeToNum(new Date(flight.arrival_time).getHours()) : null,
             // Ensure 'Total_stops_Num' comes from /api/routes, map it back to string model expects
            Total_stops: mapStopsNumToString(flight.Total_stops_Num), // **FIX THIS IN BACKEND** if Total_stops_Num is missing
            Airline: flight.airline,
            // Ensure 'Source' comes from /api/routes response
            Source: flight.Source || 'Unknown', // **FIX THIS IN BACKEND**
            // Ensure 'Destination' comes from /api/routes response
            Destination: flight.Destination || 'Unknown', // **FIX THIS IN BACKEND**
             // Ensure 'Class' comes from /api/routes response
            Class: flight.Class || 'Economy' // **FIX THIS IN BACKEND**
        };

        // Check if essential data is missing before calling predict
        if (predictionInput.Days_left === undefined ||
            predictionInput.Source === 'Unknown' ||
            predictionInput.Destination === 'Unknown' ||
            predictionInput.Class === undefined) {
             console.error("Missing critical data in flight object for prediction:", flight);
             const predictionResultElement = document.getElementById('prediction-result');
             if(predictionResultElement) predictionResultElement.textContent = 'Prediction Error: Missing input data.';
             return; // Stop if data is missing
        }


        // 5. Call your MAIN backend's prediction endpoint
        try {
            const predictionResponse = await fetch('http://127.0.0.1:5000/api/predict-fare', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(predictionInput),
            });

            const predictionData = await predictionResponse.json();
            const predictionResultElement = document.getElementById('prediction-result');

            if (predictionResultElement) { // Check if element exists
                if (predictionResponse.ok && predictionData.predicted_fare_inr !== undefined) {
                    predictionResultElement.innerHTML = `<strong>Predicted Fare (ML Model):</strong> ₹ ${predictionData.predicted_fare_inr} INR`;
                } else {
                    predictionResultElement.textContent = `Prediction Error: ${predictionData.error || 'Unknown error from prediction service'}`;
                }
            }
        } catch (error) {
            console.error("Error calling prediction endpoint:", error);
            const predictionResultElement = document.getElementById('prediction-result');
            if (predictionResultElement) {
                 predictionResultElement.textContent = 'Prediction Error: Could not reach prediction service.';
            }
        }
    } // --- END of showFlightDetails ---


    // --- HELPER FUNCTIONS ---
    function mapTimeToNum(hour) {
        if (hour < 6) return 0; // Before 6 AM
        if (hour < 12) return 1; // 6 AM - 12 PM
        if (hour < 18) return 2; // 12 PM - 6 PM
        return 3; // After 6 PM
    }

    function mapStopsNumToString(stopsNum) {
        // Adjust based on how 'Total_stops_Num' is stored or passed
        if (stopsNum === 0) return 'non-stop';
        if (stopsNum === 1) return '1-stop';
        // Match the exact string your model expects based on training data
        return '2+-stops'; // Default or adjust if needed
    }
    // --- END OF HELPER FUNCTIONS ---


}); // --- END OF DOMContentLoaded ---