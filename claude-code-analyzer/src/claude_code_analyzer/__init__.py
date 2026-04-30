try:
    from .snapshot import parse_snapshot
    __all__ = ["parse_snapshot"]
except ModuleNotFoundError:
    # snapshot module is not yet implemented; allow partial imports.
    __all__ = []
