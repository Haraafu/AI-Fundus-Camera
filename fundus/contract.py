"""The API class order is independent of the trained model's output order."""
import math

CLASSES = ("No_DR", "Mild", "Moderate", "Severe", "Proliferative_DR")
LABEL_ALIASES = {"Proliferate_DR": "Proliferative_DR"}


def canonical_label(label):
    canonical = LABEL_ALIASES.get(label, label)
    if canonical not in CLASSES:
        raise ValueError(f"Unknown class label: {label}")
    return canonical


def map_probabilities(values, model_class_names):
    """Requires explicit class_names from training, never severity-order guessing."""
    names = [canonical_label(name) for name in model_class_names]
    if len(names) != 5 or set(names) != set(CLASSES) or len(values) != 5:
        raise ValueError("Expected each of the five classes exactly once")
    numbers = [float(value) for value in values]
    if any(not math.isfinite(value) or not 0 <= value <= 1 for value in numbers) or abs(sum(numbers) - 1) > 0.0001:
        raise ValueError("Expected finite softmax probabilities summing to one")
    by_class = dict(zip(names, numbers))
    probabilities = {name: by_class[name] for name in CLASSES}
    predicted = max(probabilities, key=probabilities.get)
    return {"class": predicted, "confidence": probabilities[predicted]}, probabilities
