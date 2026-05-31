from fastapi import APIRouter

from api.routers import (
    addresses,
    admin,
    auth,
    bookings,
    bookmarks,
    clients,
    demands,
    educations,
    exams,
    flashcards,
    leaderboard,
    messages,
    notifications,
    payments,
    qa,
    reports,
    reviews,
    tutors,
    ws,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(tutors.router)
api_router.include_router(clients.router)
api_router.include_router(educations.router)
api_router.include_router(addresses.router)
api_router.include_router(demands.router)
api_router.include_router(bookings.router)
api_router.include_router(bookmarks.router)
api_router.include_router(qa.router)
api_router.include_router(exams.router)
api_router.include_router(flashcards.router)
api_router.include_router(reviews.router)
api_router.include_router(admin.router)
api_router.include_router(notifications.router)
api_router.include_router(messages.router)
api_router.include_router(leaderboard.router)
api_router.include_router(payments.router)
api_router.include_router(reports.router)
api_router.include_router(ws.router)
