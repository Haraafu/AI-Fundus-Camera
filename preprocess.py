from pathlib import Path
import cv2
from fundus.preprocessing import apply_clahe, crop_black_border, preprocess_fundus_image

# =========================
# KONFIGURASI PATH
# =========================

BASE_DIR = Path(__file__).resolve().parent

CSV_PATH = BASE_DIR / "train.csv"
INPUT_DIR = BASE_DIR / "colored_images"
OUTPUT_DIR = BASE_DIR / "preprocessed_images"

IMG_SIZE = 300



# =========================
# MAPPING LABEL DATASET
# =========================
# Sesuaikan dengan nama folder dataset Anda

label_map = {
    0: "No_DR",
    1: "Mild",
    2: "Moderate",
    3: "Severe",
    4: "Proliferate_DR"
}


# =========================
# FUNGSI BANTU
# =========================

def find_image_path(folder: Path, image_id: str):
    """
    Mencari file gambar dengan beberapa kemungkinan ekstensi.
    """
    for ext in [".png", ".jpg", ".jpeg"]:
        path = folder / f"{image_id}{ext}"
        if path.exists():
            return path
    return None


# =========================
# MAIN PROGRAM
# =========================

def main():
    import pandas as pd
    from tqdm import tqdm

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print("Base directory:", BASE_DIR)
    print("CSV path:", CSV_PATH)
    print("Input folder:", INPUT_DIR)
    print("Output folder:", OUTPUT_DIR)

    if not CSV_PATH.exists():
        raise FileNotFoundError(f"File train.csv tidak ditemukan di: {CSV_PATH}")

    if not INPUT_DIR.exists():
        raise FileNotFoundError(f"Folder colored_images tidak ditemukan di: {INPUT_DIR}")

    df = pd.read_csv(CSV_PATH)

    if "id_code" not in df.columns or "diagnosis" not in df.columns:
        raise ValueError("train.csv harus memiliki kolom 'id_code' dan 'diagnosis'.")

    success_count = 0
    failed_count = 0

    for _, row in tqdm(df.iterrows(), total=len(df)):
        image_id = str(row["id_code"])
        label = int(row["diagnosis"])

        class_folder = label_map.get(label)

        if class_folder is None:
            print(f"Label tidak dikenali untuk {image_id}: {label}")
            failed_count += 1
            continue

        input_class_dir = INPUT_DIR / class_folder
        output_class_dir = OUTPUT_DIR / class_folder
        output_class_dir.mkdir(parents=True, exist_ok=True)

        image_path = find_image_path(input_class_dir, image_id)

        if image_path is None:
            print(f"Gambar tidak ditemukan: {input_class_dir / image_id}")
            failed_count += 1
            continue

        try:
            processed = preprocess_fundus_image(image_path, IMG_SIZE)

            save_path = output_class_dir / f"{image_id}.png"

            # Convert RGB ke BGR sebelum disimpan oleh OpenCV
            processed_bgr = cv2.cvtColor(processed, cv2.COLOR_RGB2BGR)
            cv2.imwrite(str(save_path), processed_bgr)

            success_count += 1

        except Exception as e:
            print(f"Error pada {image_id}: {e}")
            failed_count += 1

    print("\nPreprocessing selesai.")
    print(f"Berhasil diproses : {success_count}")
    print(f"Gagal diproses    : {failed_count}")
    print(f"Hasil disimpan di : {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
