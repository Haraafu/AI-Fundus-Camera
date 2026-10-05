"""Inspect a ZIP archive that was split into numbered byte chunks."""

from __future__ import annotations

import bisect
import io
import sys
import zipfile
from pathlib import Path


class SplitFile(io.RawIOBase):
    """Expose sequential file parts as one seekable, read-only binary file."""

    def __init__(self, parts: list[Path]):
        self.parts = parts
        self.sizes = [part.stat().st_size for part in parts]
        self.starts = []
        total = 0
        for size in self.sizes:
            self.starts.append(total)
            total += size
        self.total = total
        self.position = 0
        self.handle = None
        self.handle_index = -1

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=io.SEEK_SET):
        if whence == io.SEEK_CUR:
            offset += self.position
        elif whence == io.SEEK_END:
            offset += self.total
        if offset < 0:
            raise ValueError("negative seek position")
        self.position = min(offset, self.total)
        return self.position

    def _open_part(self, index):
        if index != self.handle_index:
            if self.handle:
                self.handle.close()
            self.handle = self.parts[index].open("rb")
            self.handle_index = index

    def readinto(self, buffer):
        if self.position >= self.total:
            return 0
        target = memoryview(buffer)
        written = 0
        while written < len(target) and self.position < self.total:
            index = bisect.bisect_right(self.starts, self.position) - 1
            self._open_part(index)
            local = self.position - self.starts[index]
            self.handle.seek(local)
            count = min(len(target) - written, self.sizes[index] - local)
            got = self.handle.readinto(target[written : written + count])
            if not got:
                break
            written += got
            self.position += got
        return written

    def close(self):
        if self.handle:
            self.handle.close()
        super().close()


def numbered_parts(first_part: Path) -> list[Path]:
    stem = first_part.name.rsplit(".", 1)[0]
    parts = sorted(first_part.parent.glob(f"{stem}.[0-9][0-9][0-9]"))
    if not parts:
        raise FileNotFoundError(f"No numbered parts found for {first_part}")
    return parts


if __name__ == "__main__":
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "data/eyepacs/train.zip.001")
    stream = SplitFile(numbered_parts(path))
    with zipfile.ZipFile(stream) as archive:
        names = archive.namelist()
        print(f"entries={len(names):,}")
        print("first:", names[:5])
        print("last:", names[-5:])
