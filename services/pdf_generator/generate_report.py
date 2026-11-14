import os
import sys
import argparse
from config import create_document_canvas
from components import get_header_and_disclaimer, get_metadata_table, get_image_table
from dynamic_components import (
    get_primary_screening_table,
    get_class_probabilities_table,
    get_clinical_recommendations_table,
    get_9_risk_categories_table
)
from adapter import load_data, get_safe_value
from reportlab.platypus import Spacer, Paragraph
from reportlab.lib.styles import getSampleStyleSheet
from xml.sax.saxutils import escape

def resolve_path(filepath):
    if not filepath or not isinstance(filepath, str) or filepath == "invalid_path":
        return None
    if os.path.isabs(filepath):
        return filepath
    # Check if exists relative to current working directory
    if os.path.exists(filepath):
        return os.path.abspath(filepath)
    # Check if exists relative to script directory
    base_dir = os.path.dirname(os.path.abspath(__file__))
    candidate = os.path.join(base_dir, filepath)
    if os.path.exists(candidate):
        return candidate
    # Default for new files (e.g. output PDF): resolve relative to CWD
    return os.path.abspath(filepath)

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

    provenance = data.get("provenance") or {}

    doc = create_document_canvas(output_path)
    story = []

    # 2. Build Document Flowables
    story.extend(get_header_and_disclaimer())
    if provenance.get("is_mock"):
        story.append(Paragraph("<b>HASIL MOCK: prediksi dummy untuk pengujian, bukan hasil analisis model.</b>", getSampleStyleSheet()["Normal"]))
        story.append(Spacer(1, 7))
    story.append(get_metadata_table(data))
    story.append(Spacer(1, 9))

    screening_data = data.get("primary_screening", {})
    story.append(get_primary_screening_table(screening_data))
    story.append(Spacer(1, 9))

    img_clahe = resolve_path(get_safe_value(data, ["images", "clahe"], "invalid_path"))
    img_gradcam = resolve_path(get_safe_value(data, ["images", "gradcam"], "invalid_path"))
    story.append(get_image_table(img_clahe, img_gradcam))
    story.append(Spacer(1, 9))

    # Show the class set supplied by the active checkpoint.
    probabilities = data.get("probabilities", {})
    predicted_class = screening_data.get("severity_stage", "")
    story.append(get_class_probabilities_table(probabilities, predicted_class))
    story.append(Spacer(1, 9))

    # ICDR Clinical Recommendations & Follow-Up
    story.append(get_clinical_recommendations_table(predicted_class, screening_data.get("risk_level"), provenance.get("is_mock", False)))
    story.append(Spacer(1, 7))
    info = "Model: {}<br/>Preprocessing: {}<br/>Aturan risiko: {}".format(*[
        escape(str(provenance.get(key, "Tidak tercatat")))
        for key in ["model_version", "preprocessing_version", "risk_rule_version"]])
    small = getSampleStyleSheet()["Normal"]
    small.fontSize = 7.5
    small.leading = 10
    story.append(Paragraph(info, small))
    story.append(Spacer(1, 4))
    story.append(Paragraph("Grad-CAM menunjukkan kontribusi relatif area citra terhadap prediksi, bukan segmentasi lesi atau diagnosis. Koordinat mengikuti citra hasil prapemrosesan.", small))

    # Preserve optional measurements supplied explicitly by the caller.
    risk_list = data.get("risk_categories", [])
    if risk_list:
        story.append(Spacer(1, 7))
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
