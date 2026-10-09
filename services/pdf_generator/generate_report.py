import os
import sys
import argparse
from config import create_document_canvas
from components import get_header_and_disclaimer, get_metadata_table, get_image_table
from dynamic_components import get_primary_screening_table, get_9_risk_categories_table, get_5_class_probabilities_table
from adapter import load_data, get_safe_value
from reportlab.platypus import Spacer

def resolve_path(filepath):
    # Resolves relative paths based on the location of this script, not the terminal CWD.
    base_dir = os.path.dirname(os.path.abspath(__file__))
    if not os.path.isabs(filepath):
        return os.path.join(base_dir, filepath)
    return filepath

def main():
    parser = argparse.ArgumentParser(description="Generate Fundus AI PDF Report")
    parser.add_argument("--input", required=True, help="Path to input JSON payload")
    parser.add_argument("--output", required=True, help="Path to save the generated PDF")
    args = parser.parse_args()

    input_path = resolve_path(args.input)
    output_path = resolve_path(args.output)

    # 1. Load Data
    data = load_data(input_path)
    if not data:
        print(f"Error: Could not load valid JSON from {input_path}")
        sys.exit(1)
        
    doc = create_document_canvas(output_path)
    story = []
    
    # 2. Build Document Flowables
    story.extend(get_header_and_disclaimer())
    story.append(get_metadata_table(data)) 
    story.append(Spacer(1, 15))
    
    screening_data = data.get("primary_screening", {})
    story.append(get_primary_screening_table(screening_data))
    story.append(Spacer(1, 15))
    
    img_clahe = resolve_path(get_safe_value(data, ["images", "clahe"], "invalid_path"))
    img_gradcam = resolve_path(get_safe_value(data, ["images", "gradcam"], "invalid_path"))
    story.append(get_image_table(img_clahe, img_gradcam))
    story.append(Spacer(1, 15))

    # the 5 Class DR Probabilities Table
    probabilities = data.get("probabilities", {})
    predicted_class = screening_data.get("severity_stage", "")
    story.append(get_5_class_probabilities_table(probabilities, predicted_class))
    story.append(Spacer(1, 15))

    # 9 Category Table, shows placeholder kalau kosong
    risk_list = data.get("risk_categories", [])
    story.append(get_9_risk_categories_table(risk_list))
    
    # 3. Render
    try:
        doc.build(story)
        print(f"Success: Report generated at {output_path}")
    except Exception as e:
        print(f"Error building PDF: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()