"""The API class order is independent of the trained model's output order."""
import math

CLASSES = ("No_DR", "Mild", "Moderate", "Severe", "Proliferative_DR")
BINARY_CLASSES = ("No_DR", "DR")
LABEL_ALIASES = {"Proliferate_DR": "Proliferative_DR", "No DR": "No_DR"}


def canonical_label(label):
    canonical = LABEL_ALIASES.get(label, label)
    if canonical not in (*CLASSES, *BINARY_CLASSES):
        raise ValueError(f"Unknown class label: {label}")
    return canonical


def class_schema(names):
    canonical = tuple(canonical_label(name) for name in names)
    for schema in (BINARY_CLASSES, CLASSES):
        if len(canonical) == len(schema) and set(canonical) == set(schema):
            return schema
    raise ValueError("Expected exactly the binary or severity class set")


def map_probabilities(values, model_class_names):
    """Requires explicit class_names from training, never severity-order guessing."""
    names = [canonical_label(name) for name in model_class_names]
    schema = class_schema(names)
    if len(values) != len(schema):
        raise ValueError("Model output count does not match its class set")
    numbers = [float(value) for value in values]
    if any(not math.isfinite(value) or not 0 <= value <= 1 for value in numbers) or abs(sum(numbers) - 1) > 0.0001:
        raise ValueError("Expected finite softmax probabilities summing to one")
    by_class = dict(zip(names, numbers))
    probabilities = {name: by_class[name] for name in schema}
    predicted = max(probabilities, key=probabilities.get)
    return {"class": predicted, "confidence": probabilities[predicted]}, probabilities
