from reportlab.platypus import Paragraph, Table, TableStyle, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors

styles = getSampleStyleSheet()

def get_primary_screening_table(screening_data):
    # Getting data from adapter.py
    stage = screening_data.get("severity_stage", "N/A")
    risk = screening_data.get("risk_level", "N/A")
    confidence = screening_data.get("confidence_score", "N/A")
    
    data = [
        ["Severity Stage", "Risk Level", "Confidence Score"],
        [Paragraph(f"<b>{stage}</b>", styles['Normal']), 
         Paragraph(f"<b>{risk}</b>", styles['Normal']), 
         Paragraph(f"<b>{confidence}</b>", styles['Normal'])]
    ]
    
    t = Table(data, colWidths=[160, 160, 160])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#2c3e50")),
        ('TEXTCOLOR', (0,0), (-1,0), colors.whitesmoke),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('BOTTOMPADDING', (0,0), (-1,0), 8),
        ('BACKGROUND', (0,1), (-1,1), colors.HexColor("#ecf0f1")),
        ('GRID', (0,0), (-1,-1), 0.5, colors.grey),
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
        p_note = Paragraph("<i>Analisis Biomarker & Pembuluh Darah (CRAE/CRVE/AVR) terjadwal pada Rilis P2/P3.</i>", styles['Normal'])
        data.append([p_note, "-", "Masih pending"])
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

def get_5_class_probabilities_table(probabilities, predicted_class=""):
    data = [["Kelas Klasifikasi AI (DR)", "Probabilitas (Confidence)"]]
    style_commands = [
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor("#2c3e50")),
        ('TEXTCOLOR', (0,0), (-1,0), colors.whitesmoke),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('GRID', (0,0), (-1,-1), 0.25, colors.lightgrey),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
    ]

    labels = {
        "No_DR": "No DR",
        "Mild": "Mild DR",
        "Moderate": "Moderate DR",
        "Severe": "Severe DR",
        "Proliferative_DR": "Proliferative DR"
    }

    row_idx = 1
    for key, val in probabilities.items():
        class_name = labels.get(key, key)
        prob_pct = f"{round(float(val) * 100, 1)}%" if isinstance(val, (int, float)) else str(val)
        
        name_p = Paragraph(f"<b>{class_name}</b>" if key == predicted_class else class_name, styles['Normal'])
        val_p = Paragraph(f"<b>{prob_pct}</b>" if key == predicted_class else prob_pct, styles['Normal'])
        data.append([name_p, val_p])

        if key == predicted_class:
            style_commands.append(('BACKGROUND', (0, row_idx), (-1, row_idx), colors.HexColor("#d5f5e3")))
        row_idx += 1

    t = Table(data, colWidths=[280, 200])
    t.setStyle(TableStyle(style_commands))
    return t
