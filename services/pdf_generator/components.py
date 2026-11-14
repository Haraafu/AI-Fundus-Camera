import os
from reportlab.platypus import Paragraph, Table, TableStyle, Image, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.lib.utils import ImageReader

styles = getSampleStyleSheet()

def get_header_and_disclaimer():
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Title'],
        fontName='Helvetica-Bold',
        fontSize=14,
        leading=17,
        textColor=colors.HexColor("#0f172a"),
        alignment=1 # Center
    )
    subtitle_style = ParagraphStyle(
        'DocSub',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=9,
        leading=11,
        textColor=colors.HexColor("#0284c7"),
        alignment=1
    )
    disclaimer_style = ParagraphStyle(
        'Disclaimer',
        parent=styles['Normal'],
        fontSize=7.5,
        leading=10,
        textColor=colors.HexColor("#64748b"),
        alignment=1
    )
    
    title = Paragraph("<b>LAPORAN HASIL SKRINING AI — RETINOPATI DIABETIK</b>", title_style)
    subtitle = Paragraph("SISTEM KAMERA FUNDUS CERDAS BERBASIS DEEP LEARNING (EFFICIENTNET)", subtitle_style)
    disclaimer_text = """<b>PEMBERITAHUAN MEDIS:</b> Dokumen ini adalah hasil analisis komputasional awal berbasis kecerdasan buatan (AI) untuk skrining pendukung dan <i>bukan merupakan diagnosis klinis final</i>. Evaluasi definitif tetap memerlukan pemeriksaan oleh dokter spesialis mata (Sp.M)."""
    disclaimer = Paragraph(disclaimer_text, disclaimer_style)
    
    return [title, Spacer(1, 2), subtitle, Spacer(1, 4), disclaimer, Spacer(1, 8)]

def get_metadata_table(data):
    exam_id = Paragraph(f"<font size=8>{data.get('examination_id', 'N/A')}</font>", styles['Normal'])
    data_rows = [
        ["ID Pasien:", data.get("patient_id", "N/A"), "Tanggal Periksa:", data.get("date", "N/A")],
        ["ID Pemeriksaan:", exam_id, "Mata Diperiksa:", data.get("eye_side", "N/A")]
    ]
    t = Table(data_rows, colWidths=[80, 180, 100, 120])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor("#f8fafc")),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('FONTNAME', (0,0), (0,-1), 'Helvetica-Bold'),
        ('FONTNAME', (2,0), (2,-1), 'Helvetica-Bold'),
        ('TEXTCOLOR', (0,0), (0,-1), colors.HexColor("#334155")),
        ('TEXTCOLOR', (2,0), (2,-1), colors.HexColor("#334155")),
        ('INNERGRID', (0,0), (-1,-1), 0.25, colors.HexColor("#e2e8f0")),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor("#cbd5e1")),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 3),
    ]))
    return t

def get_placeholder_image(width=215, height=170, text="Image Unavailable"):
    d = Drawing(width, height)
    d.add(Rect(0, 0, width, height, fillColor=colors.HexColor("#f8fafc"), strokeColor=colors.HexColor("#cbd5e1"), strokeWidth=1))
    d.add(String(width/2, height/2 - 4, text, textAnchor='middle', fontSize=9, fillColor=colors.HexColor("#94a3b8"), fontName="Helvetica-Bold"))
    return d

def create_proportional_image(image_path, max_width=215, max_height=170):
    """
    Loads an image while strictly preserving aspect ratio within bounding box
    (max_width, max_height). High source DPI is retained for crisp print and screen display.
    """
    if not image_path or not isinstance(image_path, str) or not os.path.exists(image_path):
        return None
    try:
        reader = ImageReader(image_path)
        orig_w, orig_h = reader.getSize()
        if orig_w <= 0 or orig_h <= 0:
            return None
        
        # Calculate aspect-ratio preserving scaling factor
        ratio = min(max_width / float(orig_w), max_height / float(orig_h))
        scaled_w = orig_w * ratio
        scaled_h = orig_h * ratio
        
        return Image(image_path, width=scaled_w, height=scaled_h)
    except Exception:
        return None

def get_image_table(img_clahe_path, img_gradcam_path, max_width=215, max_height=170):
    img1 = create_proportional_image(img_clahe_path, max_width=max_width, max_height=max_height)
    if img1 is None:
        img1 = get_placeholder_image(max_width, max_height, "Citra CLAHE Belum Tersedia")
        
    img2 = create_proportional_image(img_gradcam_path, max_width=max_width, max_height=max_height)
    if img2 is None:
        img2 = get_placeholder_image(max_width, max_height, "Grad-CAM Belum Tersedia")
    
    header_style = ParagraphStyle(
        'ImgHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8.5,
        leading=11,
        alignment=1, # Center
        textColor=colors.HexColor("#0f172a")
    )

    data = [
        [Paragraph("<b>Citra Fundus Preprocessed (CLAHE)</b>", header_style), 
         Paragraph("<b>Visualisasi Area Lesi (Grad-CAM)</b>", header_style)],
        [img1, img2]
    ]
    
    t = Table(data, colWidths=[240, 240])
    t.setStyle(TableStyle([
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#f1f5f9")),
        ('INNERGRID', (0,0), (-1,-1), 0.25, colors.HexColor("#e2e8f0")),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor("#94a3b8")),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ]))
    return t