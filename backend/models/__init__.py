from sqlalchemy import DDL, event

from core.database import Base
from models.admin import Admin
from models.audit_log import AuditLog
from models.booking import Booking, BookingStatus
from models.booking_comment import BookingComment
from models.booking_private_note import BookingPrivateNote
from models.booking_resource import BookingResource
from models.bookmark import Bookmark
from models.client import Client, ClientEducation
from models.demand import Demand, DemandStatus
from models.exam import PracticeExam, PracticeExamSubject
from models.messaging import Conversation, Message
from models.notification import Notification
from models.qa import QAMessage, QAStatus, QAThread
from models.review import Review
from models.role import Role, RoleType
from models.tutor import (
    Tutor,
    TutorAvailability,
    TutorEducation,
    TutorStatus,
    TutorSubject,
)

for _extension in ("btree_gist", "pg_trgm"):
    event.listen(
        Base.metadata,
        "before_create",
        DDL(f'CREATE EXTENSION IF NOT EXISTS "{_extension}"'),
    )

__all__ = [
    "Admin",
    "AuditLog",
    "Booking",
    "BookingComment",
    "BookingPrivateNote",
    "BookingResource",
    "BookingStatus",
    "Bookmark",
    "Client",
    "ClientEducation",
    "Conversation",
    "Demand",
    "DemandStatus",
    "Message",
    "Notification",
    "PracticeExam",
    "PracticeExamSubject",
    "QAMessage",
    "QAStatus",
    "QAThread",
    "Review",
    "Role",
    "RoleType",
    "Tutor",
    "TutorAvailability",
    "TutorEducation",
    "TutorStatus",
    "TutorSubject",
]
