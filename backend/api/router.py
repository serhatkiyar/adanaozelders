from fastapi import APIRouter

from api.routers import (
    addresses,
    admin,
    auth,
    blog,
    bookings,
    bookmarks,
    clients,
    delivery,
    demands,
    educations,
    exams,
    geocode,
    habits,
    inventory,
    libraries,
    library_bookmarks,
    library_exam_catalogs,
    library_exams,
    library_operators,
    messages,
    notifications,
    packing,
    payments,
    payouts,
    payout,
    qa,
    reports,
    reviews,
    seo,
    speedtests,
    srs,
    support,
    store,
    store_merchandising,
    supplier,
    study_reservations,
    tasks,
    subjects,
    tutor_pre_applications,
    tutors,
    wallet,
    ws,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(tutors.router)
api_router.include_router(clients.router)
api_router.include_router(educations.router)
api_router.include_router(addresses.router)
api_router.include_router(delivery.router)
# Saha router'ı ayrı: ADMIN+KURYE (router-level ADMIN dependency'sinden bağımsız).
api_router.include_router(delivery.field_router)
api_router.include_router(demands.router)
api_router.include_router(blog.public_router)
api_router.include_router(blog.admin_router)
api_router.include_router(bookings.router)
api_router.include_router(bookmarks.router)
api_router.include_router(qa.router)
api_router.include_router(exams.router)
api_router.include_router(geocode.router)
api_router.include_router(habits.router)
api_router.include_router(inventory.router)
api_router.include_router(packing.router)
api_router.include_router(libraries.router)
api_router.include_router(library_bookmarks.router)
api_router.include_router(library_exam_catalogs.router)
api_router.include_router(library_exams.router)
api_router.include_router(library_operators.router)
api_router.include_router(reviews.router)
api_router.include_router(seo.router)
api_router.include_router(speedtests.router)
api_router.include_router(srs.router)
api_router.include_router(support.router)
api_router.include_router(admin.router)
api_router.include_router(notifications.router)
api_router.include_router(messages.router)
api_router.include_router(payments.router)
api_router.include_router(payouts.router)
api_router.include_router(payout.router)
api_router.include_router(wallet.router)
api_router.include_router(reports.router)
api_router.include_router(store.router)
api_router.include_router(store_merchandising.public_router)
api_router.include_router(store_merchandising.admin_router)
# Tedarikçi senkronu. Yol öneki `/store/admin/suppliers` ama AYRI dosyada:
# `store.py` zaten 1500+ satır. `store.router` ile yol çakışması yok —
# `store.py` içinde `/admin/suppliers*` tanımlı değil.
api_router.include_router(supplier.router)
api_router.include_router(study_reservations.router)
api_router.include_router(tasks.router)
api_router.include_router(subjects.router)
api_router.include_router(tutor_pre_applications.router)
api_router.include_router(ws.router)
