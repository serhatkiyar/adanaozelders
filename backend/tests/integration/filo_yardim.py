"""İP-19 filo test yardımcıları — `vehicle="LADA"` sabitinin yerine geçer.

Eski testler `DeliveryRun(vehicle="LADA")` yazıyordu; İP-19 aracı tabloya
taşıdı (`delivery_runs.vehicle_id` FK). Migration LADA/COROLLA satırlarını
seed'lediği için testler aracı **koddan değil veriden** alır — tam da üretim
kuralının kendisi (K-1). Sabit id (1/2) YAZILMAZ: id'ler seed sırasına
bağlıdır ve testin işi koda sayı gömmek değil.
"""
from __future__ import annotations

from sqlalchemy import select

from core.database import AsyncSessionLocal
from models.vehicle import Vehicle


async def arac_id(code: str = "LADA") -> int:
    """Seed'li aracın id'si (varsayılan LADA — eski testlerin tek aracı)."""
    async with AsyncSessionLocal() as s:
        return (
            await s.execute(select(Vehicle.id).where(Vehicle.code == code))
        ).scalar_one()
