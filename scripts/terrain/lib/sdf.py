"""Distance-field and channel encoders for the physical layers (manifest `encodings`).

The distance transforms themselves live in lib/faces.py (face_signed_distance_km,
face_distance_km, equirect_signed_distance_km): geodesic great-circle distances to the
EDT-picked nearest feature texel, so faces agree across seams.
"""
from __future__ import annotations

import numpy as np

from .faces import equirect_signed_distance_km, face_distance_km, face_signed_distance_km  # noqa: F401
from .io import to_u8

H_MAX_M = 9000.0  # height: terrain.r / heightHi.r  -> v = sqrt(h / 9000)
B_MAX_M = 11000.0  # bathy: terrain.g              -> v = sqrt(d / 11000)
COAST_HALF_KM = 128.0  # coastSdf: terrain.b       -> v = 0.5 + sd / 256, + land
LAKE_HALF_KM = 64.0  # lakeSdf: hydro.g            -> v = 0.5 + sd / 128, + water
RIVER_BAND_KM = 24.0  # river: hydro.r             -> v = clamp(1 - d / 24)


def enc_height(h_m: np.ndarray) -> np.ndarray:
    return to_u8(np.sqrt(np.clip(h_m, 0, H_MAX_M) / H_MAX_M))


def dec_height(v) -> np.ndarray:
    return (np.asarray(v, np.float64) / 255.0) ** 2 * H_MAX_M


def enc_bathy(d_m: np.ndarray) -> np.ndarray:
    return to_u8(np.sqrt(np.clip(d_m, 0, B_MAX_M) / B_MAX_M))


def dec_bathy(v) -> np.ndarray:
    return (np.asarray(v, np.float64) / 255.0) ** 2 * B_MAX_M


def enc_sdf(sd_km: np.ndarray, half_km: float) -> np.ndarray:
    return to_u8(0.5 + np.clip(sd_km, -half_km, half_km) / (2 * half_km))


def dec_sdf(v, half_km: float) -> np.ndarray:
    return (np.asarray(v, np.float64) / 255.0 - 0.5) * 2 * half_km
