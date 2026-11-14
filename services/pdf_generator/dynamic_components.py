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
        "No_DR": "No DR",
        "DR": "DR",
        "Mild": "Mild NPDR",
        "Moderate": "Moderate NPDR",
        "Severe": "Severe NPDR",
        "Proliferative_DR": "Proliferative DR"
    }
    stage_text = stage_display_names.get(stage, stage)

    # Risk badge color
    if risk == "NOT_ASSESSED":
        badge_bg = colors.HexColor("#64748b")
    elif "LOW" in risk or "RENDAH" in risk:
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
    risk_text = "Tidak dinilai" if risk == "NOT_ASSESSED" else risk
    risk_paragraph = Paragraph(f"<font color='white'><b>{risk_text}</b></font>", val_bold)

    data = [
        [Paragraph("Klasifikasi DR" if risk == "NOT_ASSESSED" else "Tingkat Keparahan (ICDR)", header_style),
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

def get_class_probabilities_table(probabilities, predicted_class=""):
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
        Paragraph("Klasifikasi DR" if "DR" in probabilities else "Klasifikasi Tingkat Keparahan (ICDR)", header_style),
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
        "No_DR": "No DR",
        "DR": "DR - Retinopati Diabetik",
        "Mild": "Mild NPDR - Retinopati Non-Proliferatif Derajat Ringan",
        "Moderate": "Moderate NPDR - Retinopati Non-Proliferatif Derajat Sedang",
        "Severe": "Severe NPDR - Retinopati Non-Proliferatif Derajat Berat",
        "Proliferative_DR": "Proliferative DR (PDR) - Retinopati Diabetik Proliferatif"
    }

    canonical_order = ["No_DR", "Mild", "Moderate", "Severe", "Proliferative_DR"]
    keys = canonical_order if all(k in probabilities for k in canonical_order) else list(probabilities.keys())

    row_idx = 1
    for key in keys:
        val = probabilities.get(key, 0.0)
        class_name = labels.get(key, key)
        prob_pct = f"{round(float(val) * 100, 1)}%" if isinstance(val, (int, float)) else str(val)

        is_predicted = key == predicted_class
        name_markup = f"<b>{class_name} [Hasil Prediksi]</b>" if is_predicted else class_name
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

get_5_class_probabilities_table = get_class_probabilities_table


def get_clinical_recommendations_table(severity_stage, risk_level=None, is_mock=False):
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
            "Pemeriksaan mata ulang dalam 6-12 bulan dan evaluasi faktor risiko metabolik oleh dokter umum/penyakit dalam."
        ),
        "Moderate": (
            "Terdeteksi mikroaneurisma multipel, perdarahan intraretina minor, dan/atau eksudat keras.",
            "Rujukan ke Dokter Spesialis Mata (Sp.M) dalam 2-4 bulan untuk evaluasi funduskopi lanjutan."
        ),
        "Severe": (
            "Memenuhi kriteria kualitatif berat (perdarahan kuadran luas, venous beading, atau IRMA).",
            "Rujukan Segera ke Dokter Spesialis Mata (Sp.M) dalam 2-4 minggu untuk pertimbangan terapi fotokoagulasi laser."
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

    if risk_level == "NOT_ASSESSED":
        finding = "Model biner mengklasifikasikan citra sebagai No DR atau DR, tanpa menentukan tingkat keparahan. No DR tidak menyingkirkan kemungkinan DR."
        action = "Hasil skrining perlu ditinjau oleh tenaga medis bersama informasi pemeriksaan lainnya."
    if is_mock:
        finding = "Prediksi dummy untuk pengujian integrasi software."
        action = "Hasil MOCK tidak digunakan untuk penilaian medis."

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
        [Paragraph("Interpretasi Hasil AI", header_style),
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

def get_9_risk_categories_table(risk_list):
    # Table header
    data = [["Kategori Biomarker", "Nilai Terdeteksi", "Status"]]

    # Style
    style_commands = [
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#34495e")),
        ('TEXTCOLOR', (0,0), (-1,0), colors.whitesmoke),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('GRID', (0,0), (-1,-1), 0.25, colors.lightgrey),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]

    if not risk_list:
        p_note = Paragraph("<i>CRAE/CRVE/AVR memerlukan penandaan pembuluh pada foto asli.</i>", styles['Normal'])
        data.append([p_note, "Belum diukur", "Belum diukur"])
        style_commands.append(('BACKGROUND', (2, 1), (2, 1), colors.HexColor("#7f8c8d")))
        style_commands.append(('ALIGN', (2, 1), (2, 1), 'CENTER'))
        t = Table(data, colWidths=[200, 180, 100])
        t.setStyle(TableStyle(style_commands))
        return t

    for i, item in enumerate(risk_list):
        row_idx = i + 1
        name = Paragraph(item.get("name", "N/A"), styles['Normal'])
        value = Paragraph(item.get("value", "N/A"), styles['Normal'])
        status_text = item.get("status", "N/A")

        # Giving some colors for markers
        if status_text == "Normal":
            color = colors.HexColor("#27ae60") # Hijau
        elif status_text == "Warning":
            color = colors.HexColor("#f39c12") # Kuning/Amber
        elif status_text == "Belum divalidasi":
            color = colors.HexColor("#64748b")
        else:
            color = colors.HexColor("#c0392b") # Merah (Positive/Abnormal/High)

        status_paragraph = Paragraph(f"<font color='white'><b>{status_text}</b></font>", styles['Normal'])
        data.append([name, value, status_paragraph])

        # Given that the status cell is colored, we need to apply the background color for that specific cell
        style_commands.append(('BACKGROUND', (2, row_idx), (2, row_idx), color))
        style_commands.append(('ALIGN', (2, row_idx), (2, row_idx), 'CENTER'))

    t = Table(data, colWidths=[200, 180, 100])
    t.setStyle(TableStyle(style_commands))
    return t
