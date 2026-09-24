"""Read members of a remote zip over HTTP range requests, without downloading
the whole archive. Used for the International Soundscape Database, whose
per-city zips are 1-5 GB when we only want a few recordings from each."""

import io
import time
import urllib.request

TIMEOUT = 60
RETRIES = 5


def fetch(url, start, end):
    """GET bytes start..end inclusive, retrying stalled or dropped requests."""
    for attempt in range(RETRIES):
        try:
            request = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})
            with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
                return response.read()
        except OSError:
            if attempt == RETRIES - 1:
                raise
            time.sleep(2 * (attempt + 1))


class HTTPRangeFile(io.RawIOBase):
    def __init__(self, url):
        self.url = url
        self.pos = 0
        request = urllib.request.Request(url, headers={"Range": "bytes=0-0"})
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            self.size = int(response.headers["Content-Range"].split("/")[1])

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=io.SEEK_SET):
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self.pos, io.SEEK_END: self.size}[whence]
        self.pos = max(0, base + offset)
        return self.pos

    def readinto(self, buffer):
        if self.pos >= self.size:
            return 0
        # large reads go in 8 MB pieces so one stall only costs a retry
        end = min(self.size, self.pos + min(len(buffer), 8 << 20)) - 1
        data = fetch(self.url, self.pos, end)
        buffer[: len(data)] = data
        self.pos += len(data)
        return len(data)


def open_remote(url, buffer_size=1 << 20):
    return io.BufferedReader(HTTPRangeFile(url), buffer_size=buffer_size)
