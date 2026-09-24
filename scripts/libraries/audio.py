"""Minimal WAV handling for the library builder: read any common WAV variant
(16/24/32-bit PCM, 32/64-bit float, WAVE_FORMAT_EXTENSIBLE), convert to 16-bit
PCM, measure RMS level and apply gain. Standard library only; uses audioop
when present (Python <= 3.12) and a slower pure-Python path otherwise."""

import math
import struct
from array import array

try:
    import warnings

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        import audioop
except ImportError:  # Python 3.13+
    audioop = None


class Clip:
    def __init__(self, frames, channels, rate):
        self.frames = frames  # 16-bit little-endian PCM
        self.channels = channels
        self.rate = rate

    @property
    def seconds(self):
        return len(self.frames) / (2 * self.channels * self.rate)

    def samples(self):
        a = array("h")
        a.frombytes(self.frames)
        return a

    def rms_db(self):
        if audioop:
            rms = audioop.rms(self.frames, 2)
        else:
            a = self.samples()
            rms = math.sqrt(sum(x * x for x in a) / max(1, len(a)))
        return 20 * math.log10(rms / 32768) if rms else -120.0

    def peak_db(self):
        peak = audioop.max(self.frames, 2) if audioop else max(map(abs, self.samples()), default=0)
        return 20 * math.log10(peak / 32768) if peak else -120.0

    def gain(self, db, ceiling_db=-1.0):
        """Apply gain, limited so the peak stays under the ceiling.
        Returns the gain actually applied."""
        db = min(db, ceiling_db - self.peak_db())
        factor = 10 ** (db / 20)
        if audioop:
            self.frames = audioop.mul(self.frames, 2, factor)
        else:
            a = self.samples()
            self.frames = array("h", (max(-32768, min(32767, round(x * factor))) for x in a)).tobytes()
        return db

    def to_wav(self):
        header = struct.pack(
            "<4sI4s4sIHHIIHH4sI",
            b"RIFF", 36 + len(self.frames), b"WAVE",
            b"fmt ", 16, 1, self.channels, self.rate,
            self.rate * self.channels * 2, self.channels * 2, 16,
            b"data", len(self.frames),
        )
        return header + self.frames


def read_wav(data):
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("not a WAV file")
    pos, fmt, frames = 12, None, None
    while pos + 8 <= len(data):
        cid, size = struct.unpack_from("<4sI", data, pos)
        body = data[pos + 8 : pos + 8 + size]
        if cid == b"fmt ":
            tag, channels, rate, _, _, bits = struct.unpack_from("<HHIIHH", body)
            if tag == 0xFFFE and len(body) >= 26:
                tag = struct.unpack_from("<H", body, 24)[0]
            fmt = (tag, channels, rate, bits)
        elif cid == b"data":
            frames = body
        pos += 8 + size + (size & 1)
    if not fmt or frames is None:
        raise ValueError("WAV without fmt or data chunk")
    tag, channels, rate, bits = fmt

    if tag == 1 and bits == 16:
        pcm = frames
    elif tag == 1 and bits in (24, 32) and audioop:
        pcm = audioop.lin2lin(frames, bits // 8, 2)
    elif tag == 1 and bits == 24:
        pcm = array("h", (int.from_bytes(frames[i + 1 : i + 3], "little", signed=True)
                          for i in range(0, len(frames) - 2, 3))).tobytes()
    elif tag == 3 and bits in (32, 64):
        floats = array("f" if bits == 32 else "d")
        floats.frombytes(frames[: len(frames) - len(frames) % floats.itemsize])
        pcm = array("h", (max(-32768, min(32767, int(x * 32767))) for x in floats)).tobytes()
    else:
        raise ValueError(f"unsupported WAV format tag {tag}, {bits}-bit")
    return Clip(pcm, channels, rate)
