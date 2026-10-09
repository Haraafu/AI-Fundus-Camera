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
    # Conditionally load the image or generate the placeholder
    if os.path.exists(img_clahe_path):
        img1 = Image(img_clahe_path, width=200, height=200)
    else:
        img1 = get_placeholder_image(200, 200, "CLAHE Unavailable")
        
    if os.path.exists(img_gradcam_path):
        img2 = Image(img_gradcam_path, width=200, height=200)
    else:
        img2 = get_placeholder_image(200, 200, "Grad-CAM Unavailable")
    
    data = [
        [Paragraph("<b>Preprocessed Image</b>", styles['Normal']), 
         Paragraph("<b>Heatmap Analysis</b>", styles['Normal'])],
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