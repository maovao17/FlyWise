const express = require('express');
const mariadb = require('mariadb');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors()); // Enable Cross-Origin Resource Sharing
app.use(express.json()); // Middleware to parse JSON request bodies
const port = 5000; // Port for this main backend server

// --- Environment Variables ---
const AVIATIONSTACK_KEY = process.env.AVIATIONSTACK_API_KEY;

// --- Database Connection Pool ---
const pool = mariadb.createPool({
    host: process.env.DB_HOST, // Should be 'localhost' or 'host.docker.internal'
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, // Use your strong password
    database: process.env.DB_NAME,
    connectionLimit: 5, // Max number of connections in the pool
    supportBigNumbers: true, // FIX for BigInt error
    bigNumberStrings: true // FIX for BigInt error
});

// --- Helper Functions ---
function haversine(lat1, lon1, lat2, lon2) {
  function toRad(x) { return x * Math.PI / 180; }
  const R = 6378; // Earth radius in kilometers
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  lat1 = toRad(lat1);
  lat2 = toRad(lat2);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

async function logSearchAnalytics(origin, dest, priority, results) {
    if (!results || results.length === 0) return;
    const costs = results.map(f => f.cost_inr); // Use cost_inr
    const scores = results.map(f => f.eco_score);
    const min_price = costs.length > 0 ? Math.min(...costs) : 0;
    const min_eco_score = scores.length > 0 ? Math.min(...scores) : 0;
    const result_count = results.length;
    let conn;
    try {
        conn = await pool.getConnection();
        const sql = `
            INSERT INTO search_logs (origin_iata, dest_iata, priority_searched, min_price, min_eco_score, result_count, search_timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        // Note: min_price is now in INR
        await conn.query(sql, [origin, dest, priority, min_price, min_eco_score, result_count, new Date()]);
    } catch (err) {
        console.error("Analytics Log Error:", err.message);
    } finally {
        if (conn) conn.release();
    }
}

// --- API Endpoints ---
app.get('/api/test', async (req, res) => { /* ... (no change) ... */ 
    let conn;
    try {
        conn = await pool.getConnection();
        const rows = await conn.query("SELECT 1 AS test_col");
        res.json({ message: "Database connection success!", data: rows[0].test_col });
    } catch (err) {
        console.error("ERROR in /api/test:", err);
        res.status(500).json({ message: `Database connection failed: ${err.message}` });
    } finally {
        if (conn) conn.release();
    }
});
app.get('/api/airports', async (req, res) => { /* ... (no change) ... */
    const searchQuery = req.query.q;
    if (!searchQuery) return res.json([]);
    let conn;
    try {
        conn = await pool.getConnection();
        const sqlQuery = `
            SELECT name, city, country, iata
            FROM airports
            WHERE name LIKE ? OR city LIKE ? OR iata LIKE ?
            LIMIT 10
        `;
        const searchTerm = `${searchQuery}%`;
        const rows = await conn.query(sqlQuery, [searchTerm, searchTerm, searchTerm]);
        res.json(rows);
    } catch (err) {
        console.error("ERROR in /api/airports:", err);
        res.status(500).json({ message: `Database query failed: ${err.message}` });
    } finally {
        if (conn) conn.release();
    }
});

/**
 * @route GET /api/routes
 * @desc Fetch flight routes, merge with local data, calculate scores, and sort.
 */
app.get('/api/routes', async (req, res) => {
    // --- UPDATED: Get days_left from query ---
    const { from: fromIata, to: toIata, priority = 'cheapest', days_left: daysLeft } = req.query;

    if (!fromIata || !toIata || !daysLeft) {
        return res.status(400).json({ message: "Missing 'from', 'to', or 'days_left' parameter" });
    }
    const daysLeftNum = parseInt(daysLeft, 10);
    if (isNaN(daysLeftNum) || daysLeftNum < 1) {
         return res.status(400).json({ message: "Invalid 'days_left' parameter" });
    }

    let conn;
    try {
        // 1. Get airport data (lat/lon, comfort) and fuel factor from MariaDB
        conn = await pool.getConnection();
        const [originRows] = await conn.query("SELECT latitude, longitude, metadata FROM airports WHERE iata = ?", [fromIata]);
        const [destRows] = await conn.query("SELECT latitude, longitude, metadata FROM airports WHERE iata = ?", [toIata]);
        const origin = originRows;
        const destination = destRows;

        if (!origin || !destination) {
            if (conn) conn.release();
            return res.status(404).json({ message: "Invalid 'from' or 'to' IATA code" });
        }

        const distanceKm = haversine(origin.latitude, origin.longitude, destination.latitude, destination.longitude);
        const [routeInfoRows] = await conn.query(`
            SELECT AVG(p.fuel_burn_factor) as avgFuelFactor
            FROM routes r
            LEFT JOIN planes p ON FIND_IN_SET(p.iata, REPLACE(r.equipment, ' ', ',')) > 0
            WHERE r.source_airport = ? AND r.dest_airport = ?
        `, [fromIata, toIata]);
        const avgFuelFactor = (routeInfoRows && routeInfoRows.avgFuelFactor) ? Number(routeInfoRows.avgFuelFactor) : 1.2;

        if (conn) conn.release();
        conn = null;

        // 2. Call AviationStack API
        const apiParams = {
            access_key: AVIATIONSTACK_KEY,
            dep_iata: fromIata,
            arr_iata: toIata,
            limit: 25
        };
        const apiResponse = await axios.get('http://api.aviationstack.com/v1/flights', { params: apiParams });
        const apiData = apiResponse.data;

        if (apiData.error) {
            console.error("AviationStack API Error:", apiData.error);
            return res.status(500).json({ message: `API Error: ${apiData.error.info || 'Unknown API error'}` });
        }

        let processedFlights = [];
        if (apiData.data && apiData.data.length > 0) {
            apiData.data.forEach((flight, i) => {
                // 3. Merge API data with calculated/mocked data
                const baseDuration = (distanceKm / 800) + Math.random() * 2;
                // --- MOCK COST IN INR (e.g., ~₹8 per km) ---
                const baseCost = distanceKm * (Math.random() * (10 - 6) + 6); 

                processedFlights.push({
                    id: i,
                    airline: flight.airline?.name || 'Unknown Airline',
                    flight_number: flight.flight?.iata || 'N/A',
                    departure_time: flight.departure?.scheduled || 'N/A',
                    arrival_time: flight.arrival?.scheduled || 'N/A',
                    duration_hours: Math.round(baseDuration * 10) / 10,
                    cost_inr: Math.round(baseCost), // --- CHANGED TO cost_inr ---
                    eco_score: Math.round((distanceKm * avgFuelFactor) * (Math.random() * (1.1 - 0.9) + 0.9)),
                    origin_comfort_score: origin.metadata?.comfortScore || 4.0,
                    dest_comfort_score: destination.metadata?.comfortScore || 4.0,

                    // --- Fields needed for prediction service (NOW REAL) ---
                    Source: fromIata,
                    Destination: toIata,
                    Class: 'Economy',
                    Days_left: daysLeftNum, // --- USE REAL daysLeftNum ---
                    Total_stops_Num: 0 // Hardcoded default
                });
            });
        }

        // 4. Sort results based on priority
        if (priority === 'shortest') {
            processedFlights.sort((a, b) => a.duration_hours - b.duration_hours);
        } else if (priority === 'eco') {
            processedFlights.sort((a, b) => a.eco_score - b.eco_score);
        } else { // Default to 'cheapest'
            processedFlights.sort((a, b) => a.cost_inr - b.cost_inr); // --- SORT BY cost_inr ---
        }

        // 5. Log search analytics (asynchronously)
        logSearchAnalytics(fromIata, toIata, priority, processedFlights);

        // 6. Send response
        res.json(processedFlights.slice(0, 10));

    } catch (err) {
        console.error("ERROR in /api/routes:", err);
        if (conn) {
            try { await conn.release(); } catch (releaseErr) { console.error("Error releasing connection on error:", releaseErr); }
        }
        res.status(500).json({ message: `Query failed: ${err.message}` });
    }
});

/**
 * @route GET /api/insights/busiest-routes
 * @desc Get the top 5 most searched routes from logs.
 */
app.get('/api/insights/busiest-routes', async (req, res) => {
    let conn;
    try {
        conn = await pool.getConnection();
        const sql = `
            SELECT origin_iata, dest_iata, COUNT(*) as search_count
            FROM search_logs
            GROUP BY origin_iata, dest_iata
            ORDER BY search_count DESC
            LIMIT 5;
        `;
        const rows = await conn.query(sql);
        res.json(rows);
    } catch (err) {
        console.error("ERROR in /api/insights/busiest-routes:", err);
        res.status(500).json({ message: `Analytics query failed: ${err.message}` });
    } finally {
        if (conn) conn.release();
    }
});

/**
 * @route POST /api/predict-fare
 * @desc Proxy endpoint to call the Python ML prediction service.
 */
app.post('/api/predict-fare', async (req, res) => {
    const flightData = req.body;
    if (!flightData || !flightData.Days_left || !flightData.Airline) {
        return res.status(400).json({ error: 'Missing required flight data for prediction.' });
    }

    try {
        // Call Python prediction service (running on port 5001)
        const predictionServiceUrl = 'http://127.0.0.1:5001/predict';
        const response = await axios.post(predictionServiceUrl, flightData);
        res.json(response.data); // Forward response
    } catch (error) {
        // Log detailed error from the prediction service if available
        const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error("Error calling prediction service:", errorMsg);
        res.status(500).json({ error: `Failed to get prediction from ML service. ${errorMsg}` });
    }
});

// --- Start Server ---
app.listen(port, () => {
    console.log(`Main backend server running on http://localhost:${port}`);
    if (!AVIATIONSTACK_KEY) {
        console.warn("WARNING: AVIATIONSTACK_API_KEY is not set in the .env file!");
    }
    if (!process.env.DB_HOST) {
         console.warn("WARNING: DB_HOST is not set in the .env file! Using default (might fail).");
    }
});