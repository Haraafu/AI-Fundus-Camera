from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate
from reportlab.lib.units import inch

# 36 pt margins = 0.5 inch
MARGIN = 0.5 * inch 

def create_document_canvas(output_path):
    return SimpleDocTemplate(
        output_path,
        pagesize=A4,
        rightMargin=MARGIN,
        leftMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN
    )