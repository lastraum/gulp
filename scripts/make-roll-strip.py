#!/usr/bin/env python3
"""Thin spherical ribbon sized to a 1m-diameter DCL sphere.

The SDK sphere is 1m across (radius 0.5). This mesh is a narrow equatorial
band of that sphere, slightly proud of the surface so it does not z-fight.
Scale the entity to the player blob's diameter and it hugs the body.
"""
from __future__ import annotations

import json
import math
import struct
from pathlib import Path

# DCL MeshRenderer.setSphere diameter = 1m
RADIUS = 0.5
OUTER = RADIUS * 1.035
INNER = RADIUS * 1.012
HALF_WIDTH_DEG = 9.0
LON_SEGS = 72
LAT_SEGS = 3
OUT = Path(__file__).resolve().parents[1] / "models" / "roll-strip.glb"


def sphere_point(r: float, lat: float, lon: float) -> tuple[float, float, float]:
    cl = math.cos(lat)
    return (r * cl * math.cos(lon), r * math.sin(lat), r * cl * math.sin(lon))


def add_quad(indices: list[int], a: int, b: int, c: int, d: int, flip: bool) -> None:
    if flip:
        indices.extend((a, c, b, a, d, c))
    else:
        indices.extend((a, b, c, a, c, d))


def build_mesh() -> tuple[list[float], list[float], list[int]]:
    half = math.radians(HALF_WIDTH_DEG)
    lats = [ -half + (2 * half) * (j / LAT_SEGS) for j in range(LAT_SEGS + 1) ]
    lons = [ (2 * math.pi) * (i / LON_SEGS) for i in range(LON_SEGS) ]

    pos: list[float] = []
    nrm: list[float] = []

    def push(p: tuple[float, float, float], n: tuple[float, float, float]) -> int:
        idx = len(pos) // 3
        pos.extend(p)
        nrm.extend(n)
        return idx

    def ring(r: float, outward: bool) -> list[list[int]]:
        rows: list[list[int]] = []
        sign = 1.0 if outward else -1.0
        for lat in lats:
            row: list[int] = []
            for lon in lons:
                p = sphere_point(r, lat, lon)
                ln = math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]) or 1.0
                n = (sign * p[0] / ln, sign * p[1] / ln, sign * p[2] / ln)
                row.append(push(p, n))
            rows.append(row)
        return rows

    outer = ring(OUTER, True)
    inner = ring(INNER, False)
    indices: list[int] = []

    def stitch(rows: list[list[int]], flip: bool) -> None:
        for j in range(LAT_SEGS):
            for i in range(LON_SEGS):
                i2 = (i + 1) % LON_SEGS
                add_quad(indices, rows[j][i], rows[j][i2], rows[j + 1][i2], rows[j + 1][i], flip)

    stitch(outer, False)
    stitch(inner, True)

    # latitudinal cut caps (top / bottom of the ribbon)
    for edge, lat in ((0, lats[0]), (LAT_SEGS, lats[-1])):
        for i in range(LON_SEGS):
            i2 = (i + 1) % LON_SEGS
            a, b = inner[edge][i], inner[edge][i2]
            c, d = outer[edge][i2], outer[edge][i]
            p0 = pos[a * 3 : a * 3 + 3]
            p1 = pos[b * 3 : b * 3 + 3]
            p2 = pos[c * 3 : c * 3 + 3]
            ux, uy, uz = p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]
            vx, vy, vz = p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]
            nx = uy * vz - uz * vy
            ny = uz * vx - ux * vz
            nz = ux * vy - uy * vx
            if edge == 0:
                nx, ny, nz = -nx, -ny, -nz
            ln = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
            n = (nx / ln, ny / ln, nz / ln)
            ia = push((pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]), n)
            ib = push((pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]), n)
            ic = push((pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]), n)
            id_ = push((pos[d * 3], pos[d * 3 + 1], pos[d * 3 + 2]), n)
            add_quad(indices, ia, ib, ic, id_, False)

    return pos, nrm, indices


def f32_array(values: list[float]) -> bytes:
    return b"".join(struct.pack("<f", v) for v in values)


def u16_array(values: list[int]) -> bytes:
    return b"".join(struct.pack("<H", v) for v in values)


def pad4(data: bytes, pad: bytes) -> bytes:
    extra = (4 - (len(data) % 4)) % 4
    return data + pad * extra


def bounds(values: list[float], stride: int) -> tuple[list[float], list[float]]:
    mins = [min(values[i::stride]) for i in range(stride)]
    maxs = [max(values[i::stride]) for i in range(stride)]
    return mins, maxs


def write_glb(path: Path) -> None:
    pos, nrm, indices = build_mesh()
    pos_b = f32_array(pos)
    nrm_b = f32_array(nrm)
    idx_b = u16_array(indices)
    if len(idx_b) % 4:
        idx_b += b"\x00\x00"

    nrm_off = len(pos_b)
    idx_off = nrm_off + len(nrm_b)
    blob = pos_b + nrm_b + idx_b

    pos_min, pos_max = bounds(pos, 3)
    gltf = {
        "asset": {"version": "2.0", "generator": "gulp-roll-strip"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": "rollStrip"}],
        "meshes": [
            {
                "name": "rollStrip",
                "primitives": [
                    {
                        "attributes": {"POSITION": 0, "NORMAL": 1},
                        "indices": 2,
                        "material": 0,
                    }
                ],
            }
        ],
        "materials": [
            {
                "name": "ribbon",
                "doubleSided": True,
                "pbrMetallicRoughness": {
                    "baseColorFactor": [1.0, 0.96, 0.92, 1.0],
                    "metallicFactor": 0.04,
                    "roughnessFactor": 0.38,
                },
            }
        ],
        "accessors": [
            {
                "bufferView": 0,
                "componentType": 5126,
                "count": len(pos) // 3,
                "type": "VEC3",
                "min": pos_min,
                "max": pos_max,
            },
            {
                "bufferView": 1,
                "componentType": 5126,
                "count": len(nrm) // 3,
                "type": "VEC3",
            },
            {
                "bufferView": 2,
                "componentType": 5123,
                "count": len(indices),
                "type": "SCALAR",
            },
        ],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": len(pos_b)},
            {"buffer": 0, "byteOffset": nrm_off, "byteLength": len(nrm_b)},
            {"buffer": 0, "byteOffset": idx_off, "byteLength": len(indices) * 2, "target": 34963},
        ],
        "buffers": [{"byteLength": len(blob)}],
    }

    json_bytes = pad4(json.dumps(gltf, separators=(",", ":")).encode("utf-8"), b" ")
    bin_bytes = pad4(blob, b"\x00")
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    header = struct.pack("<4sII", b"glTF", 2, total)
    json_chunk = struct.pack("<I4s", len(json_bytes), b"JSON") + json_bytes
    bin_chunk = struct.pack("<I4s", len(bin_bytes), b"BIN\x00") + bin_bytes
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(header + json_chunk + bin_chunk)
    print(f"wrote {path} ({path.stat().st_size} bytes, {len(indices) // 3} tris)")


if __name__ == "__main__":
    write_glb(OUT)
