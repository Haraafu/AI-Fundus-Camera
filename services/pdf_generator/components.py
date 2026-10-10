import os
from reportlab.platypus import Paragraph, Table, TableStyle, Image, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors
from reportlab.graphics.shapes import Drawing, Rect, String

styles = getSampleStyleSheet()

def get_header_and_disclaimer():
    title = Paragraph("<b>Perancangan dan Implementasi Sistem Kamera Fundus Berbasis AI</b>", styles['Title'])
    disclaimer_text = """<font color="red"><b>PERINGATAN:</b></font> Dokumen ini sifatnya sementara dan bisa diubah"""
    disclaimer = Paragraph(disclaimer_text, styles['Normal'])
    return [title, Spacer(1, 10), disclaimer, Spacer(1, 20)]

def get_metadata_table(data):
    exam_id = Paragraph(f"<font size=8>{data.get('examination_id', 'N/A')}</font>", styles['Normal'])
    data_rows = [
        ["Patient ID:", data.get("patient_id", "N/A"), "Tanggal:", data.get("date", "N/A")],
        ["Exam ID:", exam_id, "Mata:", data.get("eye_side", "N/A")]
    ]
    # t = Table(data_rows, colWidths=[80, 150, 80, 150])
    t = Table(data_rows, colWidths=[70, 200, 60, 130])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.whitesmoke),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('FONTNAME', (0,0), (-1,-1), 'Helvetica-Bold'),
        ('BOTTOMPADDING', (0,0), (-1,-1), 8),
    ]))
    return t

def get_placeholder_image(width=200, height=200, text="Image Unavailable"):
    d = Drawing(width, height)
    d.add(Rect(0, 0, width, height, fillColor=colors.lightgrey, strokeColor=colors.grey))
    d.add(String(width/2, height/2 - 5, text, textAnchor='middle', fontSize=12, fillColor=colors.dimgrey))
    return d

def get_image_table(img_clahe_path, img_gradcam_path):
    def load_image(path, label):
        try:
            from PIL import Image as PILImage
            with PILImage.open(path) as source:
                source.verify()
            return Image(path, width=200, height=200)
        except (OSError, ValueError, TypeError):
            return get_placeholder_image(200, 200, label)
    img1 = load_image(img_clahe_path, "Processed Unavailable")
    img2 = load_image(img_gradcam_path, "Grad-CAM Unavailable")

    data = [
        [Paragraph("<b>Preprocessed Image</b>", styles['Normal']), 
         Paragraph("<b>Grad-CAM Overlay</b>", styles['Normal'])],
        [img1, img2]
    ]
    
    t = Table(data, colWidths=[240, 240])
    t.setStyle(TableStyle([
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('INNERGRID', (0,0), (-1,-1), 0.25, colors.black),
        ('BOX', (0,0), (-1,-1), 0.25, colors.black),
    ]))
    return t