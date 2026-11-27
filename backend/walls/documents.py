"""Validate and map the browser's persisted Board contract without normalizing its data."""
import math
import re
from datetime import date

from .models import CHOICES

SCHEMA_VERSION = 1
MAX_ACTIVE_NOTES = 60
NOTE_WIDTH, NOTE_HEIGHT = 2.62, 2.78


class InvalidDocument(ValueError):
    pass


def require(condition, path):
    if not condition:
        raise InvalidDocument(f"Invalid board data at {path}.")


def fields(value, required, path, optional=()):
    require(isinstance(value, dict), path)
    require(set(required) <= value.keys() <= set(required).union(optional), path)
    return value


def array(value, path, limit=None):
    require(isinstance(value, list) and (limit is None or len(value) <= limit), path)
    return value


def text(value, path, limit=None, nonempty=False):
    require(isinstance(value, str) and "\x00" not in value, path)
    try:
        length = len(value.encode("utf-16-le")) // 2
    except UnicodeEncodeError:
        raise InvalidDocument(f"Invalid Unicode at {path}.") from None
    require((limit is None or length <= limit) and (not nonempty or bool(value.strip())), path)


def number(value, path):
    require(type(value) in (float, int) and abs(value) <= 9007199254740991 and math.isfinite(value), path)


def pair(value, path):
    require(isinstance(value, list) and len(value) == 2, path)
    for item in value:
        number(item, path)
    return value


def unique(identifier, seen, path):
    text(identifier, path, nonempty=True)
    require(identifier not in seen, path)
    seen.add(identifier)


def civil_day(value, path):
    require(isinstance(value, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value), path)
    try:
        date.fromisoformat(value)
    except ValueError:
        raise InvalidDocument(f"Invalid date at {path}.") from None


APPEARANCE_FIELDS = {
    "theme": "theme", "shade": "wall_shade", "intensity": "light_intensity", "ambience": "ambience",
}
DEFAULT_FIELDS = {
    "color": "default_note_color", "typography": "default_note_typography",
    "size": "default_note_size", "rotation": "default_note_rotation",
}


def enum(value, choices, path):
    require(isinstance(value, str) and value in choices, path)


def validate_preferences(board):
    prefs = fields(board["preferences"], ("showHints", "onboardingComplete", "noteDefaults"), "preferences")
    for flag in ("showHints", "onboardingComplete"):
        require(type(prefs[flag]) is bool, flag)
    defaults = fields(prefs["noteDefaults"], DEFAULT_FIELDS, "noteDefaults")
    for name, model_field in DEFAULT_FIELDS.items():
        enum(defaults[name], CHOICES[model_field], f"noteDefaults.{name}")
    presentation = fields(board["presentation"], ("lighting", "appearance"), "presentation")
    enum(presentation["lighting"], CHOICES["lighting"], "lighting")
    appearance = fields(presentation["appearance"], APPEARANCE_FIELDS, "appearance", ("photoWorkspace",))
    for name, model_field in APPEARANCE_FIELDS.items():
        if name == "intensity":
            require(type(appearance[name]) is int and appearance[name] in range(85, 116, 5), name)
        else:
            enum(appearance[name], CHOICES[model_field], f"appearance.{name}")
    enum(appearance.get("photoWorkspace", "professor"), CHOICES["photo_workspace"], "appearance.photoWorkspace")


# Kept compatible with src/utils/sketches.ts. Legacy illustrations remain valid.
SKETCH_IDS = {
    'open-book', 'closed-book', 'graduation-cap', 'pencil', 'pen', 'notebook',
    'document', 'bookmark', 'light-bulb', 'brain', 'star', 'target',
    'magnifying-glass', 'sparkles', 'flask', 'microscope', 'atom', 'molecule',
    'dna', 'test-tube', 'calendar', 'clock', 'checklist', 'bar-chart',
    'line-graph', 'computer', 'folder', 'layers', 'presentation', 'paintbrush',
    'palette', 'camera', 'music-note', 'paper-plane', 'light-rays',
    "spark", "flower", "leaf",
}
NOTE_FIELDS = ("id", "title", "body", "color", "position", "rotation")
NOTE_OPTIONAL = (
    "size", "typography", "doodle", "inlineSketches", "archived", "sectionId", "plannedOn",
    "reminder", "checklist", "priority", "dueDate", "completed",
)


def validate_note(note, path, ids, section_ids, reminders):
    fields(note, NOTE_FIELDS, path, NOTE_OPTIONAL)
    unique(note["id"], ids, f"{path}.id")
    text(note["title"], f"{path}.title", 72)
    text(note["body"], f"{path}.body", 240)
    enum(note["color"], CHOICES["default_note_color"], f"{path}.color")
    x, y = pair(note["position"], f"{path}.position")
    rotation = note["rotation"]
    number(rotation, f"{path}.rotation")
    width, height = pair(note.get("size", [NOTE_WIDTH, NOTE_HEIGHT]), f"{path}.size")
    require(NOTE_WIDTH * .65 <= width <= NOTE_WIDTH * 2.2 and NOTE_HEIGHT * .65 <= height <= NOTE_HEIGHT * 2.2, f"{path}.size")
    c, s = abs(math.cos(rotation)), abs(math.sin(rotation))
    require(abs(x) <= 16 - max(NOTE_WIDTH, (c * width + s * height) / 2 + .15) + 1e-9
            and abs(y) <= 11 - max(NOTE_HEIGHT, (s * width + c * height) / 2 + .15) + 1e-9, f"{path}.position")
    for name, choices in (
        ("typography", CHOICES["default_note_typography"]), ("doodle", SKETCH_IDS), ("priority", ("low", "medium", "high")),
        ("sectionId", section_ids),
    ):
        if name in note:
            enum(note[name], choices, f"{path}.{name}")
    for name in ("archived", "completed", "inlineSketches"):
        if name in note:
            require(type(note[name]) is bool, f"{path}.{name}")
    for name in ("dueDate", "plannedOn"):
        if name in note:
            civil_day(note[name], f"{path}.{name}")
    if "reminder" in note:
        reminder = fields(note["reminder"], ("id", "at"), f"{path}.reminder")
        unique(reminder["id"], reminders, f"{path}.reminder.id")
        text(reminder["id"], f"{path}.reminder.id", 100, nonempty=True)
        require(type(reminder["at"]) is int and -62135596800000 <= reminder["at"] <= 253402300799999, f"{path}.reminder.at")
    items = set()
    for item in array(note.get("checklist", []), f"{path}.checklist", 24):
        fields(item, ("id", "text", "done"), f"{path}.checklist item", ("plannedOn",))
        unique(item["id"], items, f"{path}.checklist item id")
        text(item["text"], f"{path}.checklist text", 120)
        require(type(item["done"]) is bool, f"{path}.checklist done")
        if "plannedOn" in item:
            civil_day(item["plannedOn"], f"{path}.checklist plannedOn")


def validate_board(board):
    fields(board, ("id", "name", "document", "preferences", "presentation", "notifiedReminders"), "board")
    text(board["id"], "board.id", nonempty=True)
    text(board["name"], "board.name", 48, nonempty=True)
    require(board["name"].strip() == board["name"], "board.name")
    validate_preferences(board)
    document = fields(board["document"], ("notes", "sections", "wallRotation"), "document")
    tilt, turn = pair(document["wallRotation"], "document.wallRotation")
    require(abs(tilt) <= 25 and abs(turn) <= 30, "document.wallRotation")
    section_ids = set()
    for index, section in enumerate(array(document["sections"], "document.sections", 24)):
        path = f"sections[{index}]"
        fields(section, ("id", "name", "position"), path)
        unique(section["id"], section_ids, f"{path}.id")
        text(section["name"], f"{path}.name", 40, nonempty=True)
        require(section["name"] == section["name"].strip(), f"{path}.name")
        x, y = pair(section["position"], f"{path}.position")
        require(abs(x) <= 12.15 + 1e-9 and abs(y) <= 8.05 + 1e-9, f"{path}.position")
    ids, reminders = set(), set()
    active = 0
    for index, note in enumerate(array(document["notes"], "document.notes")):
        validate_note(note, f"notes[{index}]", ids, section_ids, reminders)
        active += not note.get("archived", False)
    require(active <= MAX_ACTIVE_NOTES, "active note limit")
    receipts = set()
    for receipt in array(board["notifiedReminders"], "notifiedReminders"):
        unique(receipt, receipts, "notifiedReminders")
    return board


def write_board(document, board):
    wall = document.wall
    wall.name = board["name"]
    wall.tilt_deg, wall.turn_deg = board["document"]["wallRotation"]
    wall.revision += 1
    wall.save(update_fields=("name", "tilt_deg", "turn_deg", "revision", "updated_at"))
    prefs = wall.preferences
    for name, model_field in DEFAULT_FIELDS.items():
        setattr(prefs, model_field, board["preferences"]["noteDefaults"][name])
    for name, model_field in APPEARANCE_FIELDS.items():
        setattr(prefs, model_field, board["presentation"]["appearance"][name])
    prefs.photo_workspace = board["presentation"]["appearance"].get("photoWorkspace", "professor")
    prefs.lighting = board["presentation"]["lighting"]
    prefs.show_hints = board["preferences"]["showHints"]
    prefs.onboarding_complete = board["preferences"]["onboardingComplete"]
    prefs.save()
    document.notes = board["document"]["notes"]
    document.sections = board["document"]["sections"]
    document.reminder_receipts = board["notifiedReminders"]
    document.save()


def serialize_board(document):
    wall = document.wall
    prefs = wall.preferences
    appearance = {name: getattr(prefs, model_field) for name, model_field in APPEARANCE_FIELDS.items()}
    if prefs.photo_workspace != "professor":
        appearance["photoWorkspace"] = prefs.photo_workspace
    return {
        "id": str(wall.pk), "name": wall.name,
        "document": {"notes": document.notes, "sections": document.sections, "wallRotation": [wall.tilt_deg, wall.turn_deg]},
        "preferences": {
            "noteDefaults": {name: getattr(prefs, model_field) for name, model_field in DEFAULT_FIELDS.items()},
            "showHints": prefs.show_hints, "onboardingComplete": prefs.onboarding_complete,
        },
        "presentation": {"lighting": prefs.lighting, "appearance": appearance},
        "notifiedReminders": document.reminder_receipts,
    }
