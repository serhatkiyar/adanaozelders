from sqlalchemy import DDL, event

from core.database import Base
from models.admin import Admin
from models.audit_log import AuditLog
from models.booking import Booking, BookingStatus
from models.booking_comment import BookingComment
from models.booking_private_note import BookingPrivateNote
from models.booking_resource import BookingResource
from models.bookmark import Bookmark
from models.client import Client, ClientAddress, ClientEducation
from models.demand import Demand, DemandStatus
from models.exam import PracticeExam, PracticeExamSubject
from models.flashcard import Flashcard, FlashcardDeck
from models.habit import Habit, HabitEntry
from models.library import (
    Library,
    LibraryAmenity,
    LibraryHours,
    LibraryReview,
    LibraryStatus,
)
from models.library_exam import (
    ExamRegistration,
    ExamSessionStatus,
    LibraryExamSession,
    RegistrationStatus,
)
from models.library_operator import LibraryOperator
from models.messaging import Conversation, Message
from models.study_reservation import StudyReservation
from models.notification import Notification
from models.payment import Payment, PaymentStatus
from models.qa import QAMessage, QAStatus, QAThread
from models.refresh_token import RefreshToken
from models.reminder import TaskReminder
from models.report import Report, ReportReason, ReportStatus
from models.review import Review
from models.role import Role, RoleType
from models.task import Subtask, Task, TaskFilter, TaskLabel, TaskList
from models.tutor import (
    Tutor,
    TutorAvailability,
    TutorEducation,
    TutorStatus,
    TutorSubject,
)
from models.verification_token import TokenPurpose, VerificationToken

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
    "ClientAddress",
    "ClientEducation",
    "Conversation",
    "Demand",
    "DemandStatus",
    "ExamRegistration",
    "ExamSessionStatus",
    "Flashcard",
    "FlashcardDeck",
    "Habit",
    "HabitEntry",
    "Library",
    "LibraryAmenity",
    "LibraryExamSession",
    "LibraryHours",
    "LibraryOperator",
    "LibraryReview",
    "LibraryStatus",
    "Message",
    "RegistrationStatus",
    "StudyReservation",
    "Notification",
    "Payment",
    "PaymentStatus",
    "PracticeExam",
    "PracticeExamSubject",
    "QAMessage",
    "QAStatus",
    "QAThread",
    "RefreshToken",
    "Report",
    "ReportReason",
    "ReportStatus",
    "Review",
    "Role",
    "RoleType",
    "Subtask",
    "Task",
    "TaskFilter",
    "TaskLabel",
    "TaskList",
    "TaskReminder",
    "TokenPurpose",
    "Tutor",
    "TutorAvailability",
    "TutorEducation",
    "TutorStatus",
    "TutorSubject",
    "VerificationToken",
]
