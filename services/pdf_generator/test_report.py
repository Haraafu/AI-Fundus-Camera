import os
import sys
import json
import pytest
from PIL import Image as PILImage

# Ensure generator root is in sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from adapter import get_safe_value, load_data
from components import (
    get_placeholder_image,
    create_proportional_image,
    get_image_table,
    get_header_and_disclaimer,
    get_metadata_table
)
from dynamic_components import (
    get_primary_screening_table,
    get_class_probabilities_table,
    get_5_class_probabilities_table,
    get_clinical_recommendations_table,
    get_9_risk_categories_table
)
from config import create_document_canvas
from reportlab.platypus import Spacer

@pytest.fixture
def bad_json_file(tmp_path):
    f = tmp_path / "bad.json"
    f.write_text("{ unclosed json: ")
    return str(f)

@pytest.fixture
def dummy_4_3_image(tmp_path):
    # Create a 4:3 non-square test image (640x480) simulating hardware camera feed
    img_path = str(tmp_path / "hardware_feed_4_3.png")
    img = PILImage.new("RGB", (640, 480), color=(73, 109, 137))
    img.save(img_path)
    return img_path

def test_get_safe_value_missing_keys():
    payload = {"patient_id": "P-001"}
    assert get_safe_value(payload, ["primary_screening", "severity_stage"], "N/A") == "N/A"

def test_get_safe_value_success():
    payload = {"primary_screening": {"severity_stage": "Moderate"}}
    assert get_safe_value(payload, ["primary_screening", "severity_stage"], "N/A") == "Moderate"

def test_load_data_corrupt_file(bad_json_file):
    assert load_data(bad_json_file) == {}

def test_load_data_missing_file():
    assert load_data("non_existent_file_xyz.json") == {}

def test_placeholder_image_creation():
    d = get_placeholder_image(215, 170, "Test Placeholder")
    assert d is not None
    assert d.width == 215
    assert d.height == 170

def test_proportional_image_aspect_ratio_preservation(dummy_4_3_image):
    # 640x480 is 4:3. With max_width=215 and max_height=170:
    # 215 / (640/480) = 215 * 0.75 = 161.25 <= 170
    flowable = create_proportional_image(dummy_4_3_image, max_width=215, max_height=170)
    assert flowable is not None
    assert flowable.drawWidth == pytest.approx(215.0, 0.1)
    assert flowable.drawHeight == pytest.approx(161.25, 0.1)
    assert flowable.drawWidth / flowable.drawHeight == pytest.approx(640 / 480, 0.01)

def test_proportional_image_missing_or_invalid():
    assert create_proportional_image(None) is None
    assert create_proportional_image("non_existent_path.png") is None
    assert create_proportional_image(12345) is None

def test_image_table_rendering_with_mixed_inputs(dummy_4_3_image):
    # Table should render even if one image exists and the other is None (Grad-CAM fallback)
    table = get_image_table(dummy_4_3_image, None, max_width=215, max_height=170)
    assert table is not None

def test_clinical_recommendations_for_all_stages():
    # Verify valid table flowable is returned for every ICDR stage
    for stage in ["No_DR", "Mild", "Moderate", "Severe", "Proliferative_DR", "Unknown"]:
        table = get_clinical_recommendations_table(stage)
        assert table is not None


@pytest.mark.parametrize('predicted', ['No_DR', 'DR'])
def test_binary_report_keeps_two_classes_and_no_severity_claim(predicted):
    result = get_primary_screening_table({'severity_stage': predicted, 'risk_level': 'NOT_ASSESSED', 'confidence_score': '80%'})
    assert result._cellvalues[0][0].getPlainText() == 'Klasifikasi DR'
    assert result._cellvalues[1][1].getPlainText() == 'Tidak dinilai'
    table = get_class_probabilities_table({'No_DR': .2, 'DR': .8}, predicted)
    assert len(table._cellvalues) == 3
    rows = [row[0].getPlainText() for row in table._cellvalues[1:]]
    assert sum('[Hasil Prediksi]' in row for row in rows) == 1
    assert '[Hasil Prediksi]' in rows[0 if predicted == 'No_DR' else 1]
    recommendations = get_clinical_recommendations_table(predicted, 'NOT_ASSESSED')
    finding = recommendations._cellvalues[1][0].getPlainText()
    assert 'tanpa menentukan tingkat keparahan' in finding
    assert 'tidak menyingkirkan kemungkinan DR' in finding


def test_mock_report_recommendations_are_marked_as_dummy():
    table = get_clinical_recommendations_table('Moderate', is_mock=True)
    assert 'dummy' in table._cellvalues[1][0].getPlainText()
    assert 'tidak digunakan untuk penilaian medis' in table._cellvalues[1][1].getPlainText()


def test_single_page_budget_enforcement(tmp_path, dummy_4_3_image):
    # Verify that maximum content payload strictly renders on exactly 1 single A4 page
    output_pdf = str(tmp_path / "budget_test.pdf")
    doc = create_document_canvas(output_pdf)
    pages = []

    dr_payload = {
        "patient_id": "P-TEST-10",
        "examination_id": "EXAM-2026-10",
        "date": "2026-10-28",
        "eye_side": "OD (Kanan)",
        "primary_screening": {
            "severity_stage": "Moderate",
            "risk_level": "Medium",
            "confidence_score": "88%"
        },
        "probabilities": {
            "No_DR": 0.02,
            "Mild": 0.07,
            "Moderate": 0.88,
            "Severe": 0.02,
            "Proliferative_DR": 0.01
        }
    }

    story = []
    story.extend(get_header_and_disclaimer())
    story.append(get_metadata_table(dr_payload))
    story.append(Spacer(1, 9))
    story.append(get_primary_screening_table(dr_payload["primary_screening"]))
    story.append(Spacer(1, 9))
    story.append(get_image_table(dummy_4_3_image, dummy_4_3_image))
    story.append(Spacer(1, 9))
    story.append(get_5_class_probabilities_table(dr_payload["probabilities"], "Moderate"))
    story.append(Spacer(1, 9))
    story.append(get_clinical_recommendations_table("Moderate"))

    doc.build(story, onFirstPage=lambda c, d: pages.append(d.page), onLaterPages=lambda c, d: pages.append(d.page))
    assert len(pages) == 1, f"Expected 1 page budget, but got {len(pages)} pages"
