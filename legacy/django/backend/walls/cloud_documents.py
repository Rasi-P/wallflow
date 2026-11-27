import uuid

from .documents import fields, require, serialize_board, validate_board
from .models import ImportedBoardSource


def canonical_uuid(value):
    try:
        return isinstance(value, str) and str(uuid.UUID(value)) == value
    except (ValueError, TypeError):
        return False


def validate_workspace(value):
    fields(value, ("version", "boardOrder", "boards", "activeBoardId"), "workspace")
    require(type(value["version"]) is int and value["version"] == 2, "workspace.version")
    order, boards = value["boardOrder"], value["boards"]
    require(isinstance(order, list) and order and all(canonical_uuid(id) for id in order), "workspace.boardOrder")
    require(isinstance(boards, dict) and len(order) == len(boards) and set(order) == boards.keys(), "workspace.boards")
    require(isinstance(value["activeBoardId"], str) and value["activeBoardId"] in boards, "workspace.activeBoardId")
    for id in order:
        require(validate_board(boards[id])["id"] == id, "workspace.board.id")
    return value


def initial_workspace(document):
    board = serialize_board(document)
    board_id = board["id"]
    return {"version": 2, "boardOrder": [board_id], "boards": {board_id: board}, "activeBoardId": board_id}


def save_workspace(document, workspace):
    document.cloud_workspace = workspace
    document.save(update_fields=("cloud_workspace",))
    document.wall.revision += 1
    document.wall.save(update_fields=("revision", "updated_at"))


def source_claimed(source_id):
    from .models import WallDocument

    return (ImportedBoardSource.objects.filter(source_id=source_id).exists()
            or WallDocument.objects.filter(source_id=source_id).exists())


def legacy_board(document):
    workspace = document.cloud_workspace
    if workspace is None:
        return serialize_board(document)
    board_id = str(document.wall_id)
    return workspace["boards"].get(board_id) or workspace["boards"][workspace["boardOrder"][0]]
