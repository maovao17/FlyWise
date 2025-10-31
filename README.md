# FlyWise: AI-Powered Smart Flight Search
FlyWise is a modern flight search engine that goes beyond simple price comparison. It uses a custom-trained machine learning model to tell you if a flight price is a "Great Deal" or "Overpriced" compared to its typical fare.

# Core Features
- AI Fare Prediction: Click any flight to see its "Typical Fare (ML Model)". Our AI compares this to the current price to give you real-time "Great Deal," "Spot On," or "Price is high" insights.

- Eco-Friendly Search: Sort flights by their Estimated CO2 Footprint (kg CO2) to make more sustainable travel choices.

- Airport Comfort Filter: Filter your search by a minimum airport Comfort Score (from 0.0 to 4.0+).

- Data-Driven Insights: A live chart displays the "Top Searched Routes" based on analytics collected from all user searches.

- Save Your Favorites: Save and remove flights with a single click. Your choices are saved locally in your browser.


# Project Architecture
This project is a monorepo with three distinct services that work together:
1. /frontend (Client): A static site built with HTML, CSS, and Vanilla JavaScript. It handles all user interaction and makes API calls to the backends.
2. /backend (Node.js API): A robust Node.js & Express server that connects to a MariaDB (or MySQL-compatible) database. It serves airport suggestions, calculates CO2, and fetches live flight data from the AviationStack API.
3. /mlService (Python AI Service): A lightweight Python & Flask microservice. Its only job is to load the pre-trained Scikit-learn model and serve predictions via the /api/predict-fare endpoint.

# Getting Started: 
Local Development
To run this project, you must run all three services (Frontend, Backend, ML) simultaneously.
- Prerequisites
- Node.js
- Python 3 & pip
- A MariaDB 
- A free API Key from AviationStack

Step 1: Database Setup
Connect to your database (e.g., TiDB Cloud SQL console, or a GUI like TablePlus).

Create Tables: You need 4 tables.
airports
planes
routes
search_logs

Import Data: The /data folder contains airports.dat, planes.dat, and routes.dat. These files are messy. You will need to import them into your tables (e.g., using a GUI's "Import from CSV" feature).

Step 2: Backend (Node.js)
Navigate to the /backend folder:
```bash
cd backend
```

Install dependencies:
```bash
npm install
```

# Database Connection
Create a .env file and add your secrets:
Code snippet
```bash
DB_HOST=yourHOSTNAME

DB_PORT=4000

DB_USER=your-user

DB_PASSWORD=your-password

DB_NAME=flywise_db
```
# AviationStack API Key
AVIATIONSTACK_API_KEY=your_aviationstack_key
Start the backend server:

```bash
node server.js
```

Your Node.js API is now running at http://localhost:5000

Step 3: ML Service (Python)
Navigate to the /mlService folder:
(Recommended) Create and activate a Python virtual environment:

```bash

python3 -m venv venv
source venv/bin/activate
```

 On Windows: 
 ```bash
 venv\Scripts\activate
```

Create requirements.txt: Create a file named requirements.txt in the /mlService directory with these contents:
```bash
Flask
pandas
scikit-learn
joblib
```


```bash
pip install -r requirements.txt
```

Start the ML server:

```bash
python3 app.py
```

Your ML API is now running at http://127.0.0.1:5001

Step 4: Frontend (JavaScript)
Open the frontend/js/script.js file.

Change the API_BASE variable to point to your local Node.js server:
```bash
// const API_BASE = '/api'; // For production
const API_BASE = 'http://127.0.0.1:5000/api'; // For local
```
Open frontend/index.html in your browser. 

Using the "Live Server" extension in VS Code is the easiest way.

Your app is now fully running locally!
