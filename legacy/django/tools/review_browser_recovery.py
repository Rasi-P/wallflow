"""Review an unsigned legacy recovery file without contacting either database."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
from uuid import UUID


def read_json(path):
    if path.stat().st_size > 6_000_000:
        raise ValueError("Recovery file exceeds the review limit. Keep it for manual review.")
    raw = path.read_bytes()
    return hashlib.sha256(raw).hexdigest(), json.loads(raw)


def inventory(document):
    if isinstance(document, list):
        format_name, boards = "legacy-board-array", document
    elif isinstance(document, dict) and type(document.get("version")) is int:
        if document["version"] == 1 and isinstance(document.get("state"), dict):
            return "wallflow-wall-v1", None
        order, indexed = document.get("boardOrder"), document.get("boards")
        if document["version"] != 2 or not isinstance(order, list) or not isinstance(indexed, dict):
            raise ValueError("Unrecognized workspace format.")
        if not all(isinstance(key, str) and key in indexed for key in order):
            raise ValueError("Invalid workspace board order.")
        if set(order) != set(indexed) or document.get("activeBoardId") not in indexed:
            raise ValueError("Incomplete workspace inventory.")
        if any(not isinstance(indexed[key], dict) or indexed[key].get("id") != key for key in order):
            raise ValueError("Workspace board IDs disagree with the index.")
        format_name, boards = "wallflow-workspace-v2", [indexed[key] for key in order]
    else:
        raise ValueError("Unrecognized legacy recovery format.")
    if not boards or len(boards) > 250:
        raise ValueError("The document must contain 1 to 250 boards.")
    return format_name, boards


def validate_boards(boards):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
    import django
    from django.conf import settings
    settings.configure(INSTALLED_APPS=["django.contrib.auth", "django.contrib.contenttypes", "accounts", "walls"],
                       AUTH_USER_MODEL="accounts.User")
    django.setup()
    from walls.documents import validate_board

    result = {}
    for board in boards:
        checked = validate_board(board)
        if checked["id"] in result:
            raise ValueError("Duplicate recovery board ID.")
        result[checked["id"]] = checked
    return result


def prepare(original_digest, board_index, manifest):
    if not isinstance(manifest, dict) or manifest.get("sha256") != original_digest:
        raise ValueError("The reviewed manifest does not match the original bytes.")
    reviewed = manifest.get("boards")
    if not isinstance(reviewed, list) or not reviewed:
        raise ValueError("Supply explicitly reviewed source decisions for the selected boards.")
    seen_boards, seen_sources, entries = set(), set(), []
    for item in reviewed:
        if not isinstance(item, dict) or item.get("status") != "verified-unclaimed":
            raise ValueError("Only positively verified unclaimed sources can use this import path.")
        board_id, source_id = item.get("boardId"), item.get("sourceId")
        if not isinstance(board_id, str) or board_id not in board_index or board_id in seen_boards:
            raise ValueError("Unknown or repeated board ID in the review.")
        if not isinstance(source_id, str) or str(UUID(source_id)) != source_id or source_id in seen_sources:
            raise ValueError("Expected a unique canonical original source UUID.")
        seen_boards.add(board_id)
        seen_sources.add(source_id)
        entries.append({"sourceId": source_id, "board": board_index[board_id]})
    return {"format": "wallflow-browser-export-v1", "originalSha256": original_digest, "boards": entries}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("original", type=Path)
    parser.add_argument("--review", type=Path, help="Operator-adjudicated claim manifest for positively verified unclaimed boards")
    parser.add_argument("--output", type=Path, help="New file for the reviewed browser export")
    args = parser.parse_args()
    try:
        original_digest, document = read_json(args.original)
        format_name, boards = inventory(document)
        index = validate_boards(boards) if boards is not None else None
        if args.review or args.output:
            if index is None or not args.review or not args.output:
                raise ValueError("Supply both review and output for v2 or board-array files. Use old-origin export for v1.")
            _, manifest = read_json(args.review)
            raw = json.dumps(prepare(original_digest, index, manifest), ensure_ascii=False).encode("utf-8")
            descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "wb") as output:
                output.write(raw)
        print(json.dumps({"format": format_name, "sha256": original_digest, "boardIds": list(index) if index is not None else None}))
    except (OSError, ValueError, TypeError) as failure:
        parser.exit(1, f"Recovery review stopped: {failure}\n")


if __name__ == "__main__":
    main()
