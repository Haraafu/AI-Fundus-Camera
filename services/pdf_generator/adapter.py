import json

def load_data(filepath="mock_payload.json"):
    try:
        with open(filepath, 'r') as file:
            data = json.load(file)
            return data
    except FileNotFoundError:
        print(f"Error: {filepath} not found. Using default mock data.")
        return {}
    except json.JSONDecodeError:
        print(f"Error: Format JSON in {filepath} is not valid.")
        return {}

def get_safe_value(data, keys, default="N/A"):
    # Helper function to safely retrieve nested data
    for key in keys:
        try:
            data = data[key]
        except (KeyError, TypeError):
            return default
    return data if data else default