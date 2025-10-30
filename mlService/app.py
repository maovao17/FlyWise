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
    
    # --- GET FEATURE NAMES FROM THE MODEL ---
    # This is more robust than hardcoding
    expected_features = model.feature_names_in_
    print(f"Model expects {len(expected_features)} features:")
    print(expected_features)

except FileNotFoundError:
    print(f"ERROR: Model file not found at {model_path}. Make sure '{model_filename}' is in the same folder as app.py.")
    model = None
except AttributeError:
    print("ERROR: Model does not have 'feature_names_in_'. Was it trained with scikit-learn >= 0.24 on a DataFrame?")
    print("Please retrain the model or manually define 'expected_features' list.")
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
        input_df_raw = pd.DataFrame([input_data])

        # --- Apply the SAME preprocessing as during training ---
        
        # B) Stop Mapping (Assuming input_data provides 'Total_stops' string)
        stop_mapping = {'non-stop': 0, '1-stop': 1, '2+-stop': 2, '2+-stops': 2}
        if 'Total_stops' in input_df_raw.columns:
             # Use .get() on map to handle unknown stop types gracefully
             input_df_raw['Total_stops_Num'] = input_df_raw['Total_stops'].map(lambda x: stop_mapping.get(x, 0)) # Default to 0 (non-stop) if unknown

        # C) One-Hot Encoding (for 'Airline', 'Source', 'Destination', 'Class')
        input_df_processed = pd.get_dummies(input_df_raw, columns=['Airline', 'Source', 'Destination', 'Class'])

        # D) Align columns with the training features
        #    Add missing columns (that were present during training) and fill with 0
        input_df_aligned = input_df_processed.reindex(columns=expected_features, fill_value=0)

        # Ensure column order is exactly the same as during training
        input_df_final = input_df_aligned[expected_features]


        # 3. Make prediction
        prediction = model.predict(input_df_final)

        # 4. Return prediction as JSON
        # prediction[0] because predict returns an array, and we only have one input row
        return jsonify({"predicted_fare_inr": round(prediction[0], 2)})

    except KeyError as e:
        print(f"ERROR: KeyError during preprocessing: {e}")
        return jsonify({"error": f"Missing or unexpected feature in input data: {e}. Check data sent from frontend."}), 400
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