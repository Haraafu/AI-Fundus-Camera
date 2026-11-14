from reportlab.platypus import Paragraph, Table, TableStyle, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

styles = getSampleStyleSheet()

def get_primary_screening_table(screening_data):
    """
    Renders the primary screening result card (Severity Stage, Risk Level, Confidence Score).
    """
    stage = screening_data.get("severity_stage", "N/A")
    risk = str(screening_data.get("risk_level", "N/A")).upper()
    confidence = screening_data.get("confidence_score", "N/A")

    # Map friendly display name for ICDR stages
    stage_display_names = {
        "No_DR": "No DR (Normal)",
        "Mild": "Mild NPDR",
        "Moderate": "Moderate NPDR",
        "Severe": "Severe NPDR",
        "Proliferative_DR": "Proliferative DR"
    }
    stage_text = stage_display_names.get(stage, stage)

    # Risk badge color
    if "LOW" in risk or "RENDAH" in risk:
        badge_bg = colors.HexColor("#16a34a") # Emerald Green
    elif "MEDIUM" in risk or "SEDANG" in risk:
        badge_bg = colors.HexColor("#d97706") # Amber
    else:
        badge_bg = colors.HexColor("#dc2626") # Rose Red

    header_style = ParagraphStyle(
        'ScreenHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=9,
        leading=11,
        textColor=colors.whitesmoke,
        alignment=1 # Center
    )
    val_bold = ParagraphStyle(
        'ValBold',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=10,
        leading=13,
        alignment=1
    )
    risk_paragraph = Paragraph(f"<font color='white'><b>{risk}</b></font>", val_bold)

    data = [
        [Paragraph("Tingkat Keparahan (ICDR)", header_style), 
         Paragraph("Kategori Risiko", header_style), 
         Paragraph("Keyakinan AI (Confidence)", header_style)],
        [Paragraph(f"<b>{stage_text}</b>", val_bold), 
         risk_paragraph, 
         Paragraph(f"<b>{confidence}</b>", val_bold)]
    ]
    
    t = Table(data, colWidths=[170, 140, 170])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#1e293b")),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('BOTTOMPADDING', (0,0), (-1,0), 6),
        ('TOPPADDING', (0,0), (-1,0), 6),
        ('BACKGROUND', (0,1), (0,1), colors.HexColor("#f8fafc")),
        ('BACKGROUND', (1,1), (1,1), badge_bg),
        ('BACKGROUND', (2,1), (2,1), colors.HexColor("#f8fafc")),
        ('INNERGRID', (0,0), (-1,-1), 0.5, colors.HexColor("#cbd5e1")),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor("#94a3b8")),
        ('TOPPADDING', (0,1), (-1,1), 6),
        ('BOTTOMPADDING', (0,1), (-1,1), 6),
    ]))
    return t

def get_5_class_probabilities_table(probabilities, predicted_class=""):
    """
    Renders detailed distribution across all 5 ICDR Diabetic Retinopathy classes,
    highlighting the predicted class.
    """
    header_style = ParagraphStyle(
        'ProbHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=9,
        leading=11,
        textColor=colors.whitesmoke,
        alignment=0
    )

    data = [[
        Paragraph("Klasifikasi Tingkat Keparahan (ICDR)", header_style), 
        Paragraph("Probabilitas Model AI", header_style)
    ]]
    
    style_commands = [
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#334155")),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('INNERGRID', (0,0), (-1,-1), 0.25, colors.HexColor("#e2e8f0")),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor("#94a3b8")),
        ('TOPPADDING', (0,0), (-1,-1), 3),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
    ]

    labels = {
        "No_DR": "No DR — Tidak Terdeteksi Retinopati Diabetik",
        "Mild": "Mild NPDR — Retinopati Non-Proliferatif Derajat Ringan",
        "Moderate": "Moderate NPDR — Retinopati Non-Proliferatif Derajat Sedang",
        "Severe": "Severe NPDR — Retinopati Non-Proliferatif Derajat Berat",
        "Proliferative_DR": "Proliferative DR (PDR) — Retinopati Diabetik Proliferatif"
    }

    canonical_order = ["No_DR", "Mild", "Moderate", "Severe", "Proliferative_DR"]
    keys = canonical_order if all(k in probabilities for k in canonical_order) else list(probabilities.keys())

    row_idx = 1
    for key in keys:
        val = probabilities.get(key, 0.0)
        class_name = labels.get(key, key)
        prob_pct = f"{round(float(val) * 100, 1)}%" if isinstance(val, (int, float)) else str(val)
        
        is_predicted = (key == predicted_class or (predicted_class in key))
        name_markup = f"<b>{class_name}  ◄ [Hasil Prediksi]</b>" if is_predicted else class_name
        val_markup = f"<b>{prob_pct}</b>" if is_predicted else prob_pct

        name_p = Paragraph(f"<font size=8.5>{name_markup}</font>", styles['Normal'])
        val_p = Paragraph(f"<font size=8.5>{val_markup}</font>", styles['Normal'])
        data.append([name_p, val_p])

        if is_predicted:
            style_commands.append(('BACKGROUND', (0, row_idx), (-1, row_idx), colors.HexColor("#dcfce7"))) # Soft green highlight
        row_idx += 1

    t = Table(data, colWidths=[360, 120])
    t.setStyle(TableStyle(style_commands))
    return t

def get_clinical_recommendations_table(severity_stage):
    """
    Renders actionable clinical recommendations and ICDR guidelines based on predicted DR stage.
    """
    recommendations_map = {
        "No_DR": (
            "Tidak terdeteksi kelainan mikrovaskular atau lesi retinopati diabetik pada citra fundus.",
            "Skrining retina berkala rutin setiap 12 bulan dan pertahankan kontrol glikemik (HbA1c)."
        ),
        "Mild": (
            "Terdeteksi mikroaneurisma minimal tanpa kelainan perdarahan atau eksudat masif.",
            "Pemeriksaan mata ulang dalam 6–12 bulan dan evaluasi faktor risiko metabolik oleh dokter umum/penyakit dalam."
        ),
        "Moderate": (
            "Terdeteksi mikroaneurisma multipel, perdarahan intraretina minor, dan/atau eksudat keras.",
            "Rujukan ke Dokter Spesialis Mata (Sp.M) dalam 2–4 bulan untuk evaluasi funduskopi lanjutan."
        ),
        "Severe": (
            "Memenuhi kriteria kualitatif berat (perdarahan kuadran luas, venous beading, atau IRMA).",
            "Rujukan Segera ke Dokter Spesialis Mata (Sp.M) dalam 2–4 minggu untuk pertimbangan terapi fotokoagulasi laser."
        ),
        "Proliferative_DR": (
            "Terdeteksi pembentukan neovaskularisasi retina/diskus atau potensi perdarahan vitreous.",
            "Rujukan Prioritas Tinggi / Mendesak ke Dokter Spesialis Mata Konsultan Vitreoretina untuk tindakan intervensi."
        )
    }

    # Default fallback
    finding, action = recommendations_map.get(
        severity_stage, 
        ("Evaluasi gambaran vaskular dan retina berdasarkan analisis komputasional AI.",
         "Konsultasikan hasil skrining dengan dokter spesialis mata (Sp.M).")
    )

    cell_style = ParagraphStyle(
        'RecText',
        parent=styles['Normal'],
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#1e293b")
    )
    header_style = ParagraphStyle(
        'RecHeader',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8.5,
        leading=11,
        textColor=colors.whitesmoke
    )

    data = [
        [Paragraph("Panduan Klinis & Temuan AI", header_style), 
         Paragraph("Rekomendasi Tindak Lanjut Medis", header_style)],
        [Paragraph(finding, cell_style), 
         Paragraph(f"<b>{action}</b>", cell_style)]
    ]

    t = Table(data, colWidths=[240, 240])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#475569")),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('INNERGRID', (0,0), (-1,-1), 0.25, colors.HexColor("#cbd5e1")),
        ('BOX', (0,0), (-1,-1), 0.5, colors.HexColor("#94a3b8")),
        ('BACKGROUND', (0,1), (-1,1), colors.HexColor("#f8fafc")),
        ('TOPPADDING', (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
        ('LEFTPADDING', (0,0), (-1,-1), 8),
        ('RIGHTPADDING', (0,0), (-1,-1), 8),
    ]))
    return t

# Backwards compatibility stub for older tests/callers if needed
def get_9_risk_categories_table(risk_list=None):
    return get_clinical_recommendations_table("Moderate")
