import flask
from flask import Flask, request, jsonify
import joblib
import pandas as pd
import os
import numpy as np # Make sure numpy is imported

app = Flask(__name__)

# --- Load Model ---
model_filename = 'flight_fare_predictor.pkl'
model_path = os.path.join('.', model_filename)

try:
    model = joblib.load(model_path)
    print(f"Model loaded successfully from {model_path}")
    # --- Get the expected feature names from the model ---
    # This assumes the model was trained on a pandas DataFrame
    # If using older scikit-learn, might need model.feature_names_in_
    # If using newer scikit-learn (>= 0.24), _check_n_features requires feature names during prediction
    # Best practice is to save feature names WITH the model or define them here
    # For now, let's try getting them if available, otherwise define expected columns manually based on training
    try:
         expected_features = model.feature_names_in_
         print("Found feature names in model.")
    except AttributeError:
        print("Feature names not found in model. Manually defining expected features based on training script.")
        # --- IMPORTANT: Define the EXACT columns your model was trained on, IN ORDER ---
        # This list MUST match the columns in X_train after preprocessing
        expected_features = [
             'Duration_in_hours', 'Days_left', 'Journey_Month', 'Journey_DayOfWeek',
             'Departure_Num', 'Arrival_Num', 'Total_stops_Num',
             # Add ALL the one-hot encoded columns from get_dummies, e.g.:
             'Airline_Air India', 'Airline_GO FIRST', 'Airline_Indigo', 'Airline_SpiceJet', 'Airline_Vistara',
             'Source_Chennai', 'Source_Delhi', 'Source_Hyderabad', 'Source_Kolkata', 'Source_Mumbai',
             'Destination_Chennai', 'Destination_Delhi', 'Destination_Hyderabad', 'Destination_Kolkata', 'Destination_Mumbai',
             'Class_First Class', 'Class_Premium Economy', 'Class_Economy' # Ensure this matches drop_first=True behavior
             # Make sure this list is COMPLETE and in the correct order as X_train.columns
        ]
        print(f"Manually defined {len(expected_features)} features.")

except FileNotFoundError:
    print(f"ERROR: Model file not found at {model_path}. Make sure '{model_filename}' is in the same folder as app.py.")
    model = None
except Exception as e:
    print(f"ERROR loading model: {e}")
    model = None

# --- Prediction Endpoint ---
@app.route('/predict', methods=['POST'])
def predict():
    if model is None:
        return jsonify({"error": "Model not loaded. Check server logs."}), 500

    try:
        # 1. Get input data from the request JSON
        input_data = request.get_json()
        if not input_data:
            return jsonify({"error": "No input data provided in JSON body"}), 400

        # 2. Convert input data into a pandas DataFrame (single row)
        # Ensure the input JSON keys match expected features BEFORE one-hot encoding
        input_df_raw = pd.DataFrame([input_data])

        # --- Apply the SAME preprocessing as during training ---
        # A) Date/Time Features (Assuming input_data contains 'Date_of_journey', 'Dep_Time', 'Arrival_Time')
        #    It's often easier if the CALLING service calculates these numerical features first
        #    Let's assume the input_data directly provides numerical features like:
        #    'Journey_Month', 'Journey_DayOfWeek', 'Departure_Num', 'Arrival_Num'

        # B) Stop Mapping (Assuming input_data provides 'Total_stops' string)
        stop_mapping = {'non-stop': 0, '1-stop': 1, '2+-stop': 2, '2+-stops': 2}
        if 'Total_stops' in input_df_raw.columns:
             input_df_raw['Total_stops_Num'] = input_df_raw['Total_stops'].map(stop_mapping)

        # C) One-Hot Encoding (for 'Airline', 'Source', 'Destination', 'Class')
        #    Need to ensure ALL columns created during training are present, even if the input doesn't have that category
        input_df_processed = pd.get_dummies(input_df_raw, columns=['Airline', 'Source', 'Destination', 'Class'])

        # D) Align columns with the training features
        #    Add missing columns (that were present during training) and fill with 0
        #    Remove extra columns (if any were created from input data not seen during training)
        input_df_aligned = input_df_processed.reindex(columns=expected_features, fill_value=0)

        # Ensure column order is exactly the same as during training
        input_df_final = input_df_aligned[expected_features]


        # 3. Make prediction
        prediction = model.predict(input_df_final)

        # 4. Return prediction as JSON
        # prediction[0] because predict returns an array, and we only have one input row
        return jsonify({"predicted_fare_inr": round(prediction[0], 2)})

    except KeyError as e:
        return jsonify({"error": f"Missing expected feature in input data: {e}. Ensure input JSON has all required keys."}), 400
    except Exception as e:
        print(f"ERROR during prediction: {e}") # Log the full error server-side
        return jsonify({"error": f"An error occurred during prediction: {str(e)}"}), 500

# --- Health Check Endpoint ---
@app.route('/health', methods=['GET'])
def health_check():
    if model:
        return jsonify({"status": "OK", "model_loaded": True}), 200
    else:
        return jsonify({"status": "ERROR", "model_loaded": False}), 500

# --- Run the App ---
if __name__ == '__main__':
    # Use a different port than your main backend (e.g., 5001)
    app.run(debug=True, port=5001)