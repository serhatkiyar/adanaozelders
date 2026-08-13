from sqlalchemy import DDL, event

from core.database import Base
from models.admin import Admin
from models.admin_access import (
    AdminPermission,
    AdminRole,
    AdminRoleAssignment,
    AdminRolePermission,
)
from models.audit_log import AuditLog
from models.booking import Booking, BookingStatus
from models.booking_comment import BookingComment
from models.booking_private_note import BookingPrivateNote
from models.booking_resource import BookingResource
from models.bookmark import Bookmark
from models.client import Client, ClientAddress, ClientEducation
from models.consent import ConsentDoc, UserConsent
from models.product_bookmark import ProductBookmark
from models.courier import Courier
from models.courier_account import CourierAccount
from models.delivery import (
    DeliveryClosedDay,
    DeliveryFeedback,
    DeliveryProof,
    DeliveryRun,
    DeliveryRunStatus,
    DeliveryStop,
    DeliveryStopStatus,
    DeliveryVehicle,
    FeedbackProblem,
)
from models.demand import Demand, DemandStatus
from models.demand_response import DemandResponse
from models.exam import PracticeExam, PracticeExamSubject
from models.feature_flag import FeatureFlag
from models.flashcard import Flashcard, FlashcardDeck
from models.habit import Habit, HabitEntry
from models.inventory import (
    COUNT_ADJUSTMENT_REASONS,
    DAMAGE_REASONS,
    CountLineStatus,
    CountSessionStatus,
    DamageEventKind,
    StockCountLine,
    StockCountLineEvent,
    StockCountSession,
    StockDamageEvent,
)
from models.library import (
    Library,
    LibraryAmenity,
    LibraryHours,
    LibraryImage,
    LibraryReview,
    LibraryStatus,
)
from models.library_bookmark import LibraryBookmark
from models.library_speedtest import LibrarySpeedTest
from models.library_exam import (
    ExamRegistration,
    ExamSessionStatus,
    LibraryExamSession,
    RegistrationStatus,
)
from models.library_exam_catalog import ExamType, LibraryExamCatalog
from models.library_operator import LibraryOperator
from models.messaging import Conversation, Message, MessageReaction
from models.name_change_request import NameChangeRequest
from models.study_reservation import StudyReservation
from models.notification import Notification
from models.outbox import OutboxEvent, OutboxStatus
from models.packing import (
    LIVE_PACKAGE_SQL,
    PACKAGE_EVENT_TYPES,
    PACKAGE_STATUSES,
    SCAN_RESULTS,
    TERMINAL_PACKAGE_STATUSES,
    OrderPackage,
    OrderPackageItem,
    PackageScanEvent,
)
from models.payment import Payment, PaymentStatus
from models.payout import PayeeType, PayoutRecord
from models.qa import QAMessage, QAStatus, QAThread
from models.refresh_token import RefreshToken
from models.reminder import TaskReminder
from models.report import Report, ReportReason, ReportStatus
from models.review import Review
from models.role import Role, RoleType
from models.srs import (
    SrsCard,
    SrsDeck,
    SrsDeckAssignment,
    SrsNote,
    SrsNoteTag,
    SrsProgress,
    SrsReviewLog,
    SrsTag,
)
from models.store import (
    Collection,
    CollectionItem,
    Coupon,
    CouponDiscountType,
    CouponRedemption,
    DeliveryPref,
    Order,
    OrderItem,
    OrderPaymentStatus,
    OrderReturn,
    OrderReturnItem,
    OrderStatus,
    OrderStatusHistory,
    Product,
    ProductCategory,
    ProductImage,
    ProductKind,
    ProductPriceHistory,
    ProductReview,
    ProductStatus,
    ReturnRefundStatus,
    ReturnStatus,
    ReturnType,
    SellerType,
    StockMovement,
    StockBucket,
    StockMovementType,
    StockNotification,
)
from models.task import Subtask, Task, TaskFilter, TaskLabel, TaskList
from models.tutor import (
    Tutor,
    TutorAvailability,
    TutorEducation,
    TutorStatus,
    TutorSubject,
)
from models.verification_token import TokenPurpose, VerificationToken
from models.phone_otp import PhoneOtp

# PostgreSQL eklentileri: btree_gist (booking GiST exclusion) + pg_trgm (trigram
# arama). Üretim/açılış yolu artık `alembic upgrade head` olduğundan extension'lar
# baseline migration'da kurulur; bu `before_create` event'i yalnız doğrudan
# `Base.metadata.create_all` çağrılırsa (test/yardımcı script) devreye girer.
for _extension in ("btree_gist", "pg_trgm"):
    event.listen(
        Base.metadata,
        "before_create",
        DDL(f'CREATE EXTENSION IF NOT EXISTS "{_extension}"'),
    )

__all__ = [
    "Admin",
    "AdminPermission",
    "AdminRole",
    "AdminRoleAssignment",
    "AdminRolePermission",
    "AuditLog",
    "Booking",
    "BookingComment",
    "BookingPrivateNote",
    "BookingResource",
    "BookingStatus",
    "Bookmark",
    "ProductBookmark",
    "Client",
    "ClientAddress",
    "ClientEducation",
    "Conversation",
    "Courier",
    "CourierAccount",
    "DeliveryClosedDay",
    "DeliveryFeedback",
    "DeliveryProof",
    "DeliveryRun",
    "DeliveryRunStatus",
    "DeliveryStop",
    "DeliveryStopStatus",
    "DeliveryVehicle",
    "Demand",
    "DemandResponse",
    "DemandStatus",
    "ExamRegistration",
    "ExamSessionStatus",
    "ExamType",
    "FeatureFlag",
    "FeedbackProblem",
    "Flashcard",
    "FlashcardDeck",
    "Habit",
    "HabitEntry",
    "Library",
    "LibraryAmenity",
    "LibraryBookmark",
    "LibrarySpeedTest",
    "LibraryExamCatalog",
    "LibraryExamSession",
    "LibraryHours",
    "LibraryImage",
    "LibraryOperator",
    "LibraryReview",
    "LibraryStatus",
    "Message",
    "MessageReaction",
    "RegistrationStatus",
    "StudyReservation",
    "Notification",
    "OutboxEvent",
    "OutboxStatus",
    "ConsentDoc",
    "Collection",
    "CollectionItem",
    "Coupon",
    "CouponDiscountType",
    "CouponRedemption",
    "DeliveryPref",
    "Order",
    "OrderItem",
    "OrderReturnItem",
    "OrderPaymentStatus",
    "OrderReturn",
    "OrderStatus",
    "OrderStatusHistory",
    "Payment",
    "PaymentStatus",
    "UserConsent",
    "PayeeType",
    "PayoutRecord",
    "Product",
    "ProductPriceHistory",
    "ProductCategory",
    "ProductImage",
    "ProductKind",
    "ProductReview",
    "ProductStatus",
    "StockMovement",
    "StockMovementType",
    "StockBucket",
    # F29 — sayım ve hasarlı stok
    "COUNT_ADJUSTMENT_REASONS",
    "DAMAGE_REASONS",
    "CountLineStatus",
    "CountSessionStatus",
    "DamageEventKind",
    "StockCountLine",
    "StockCountLineEvent",
    "StockCountSession",
    "StockDamageEvent",
    # F30 — paketleme ve QR
    "LIVE_PACKAGE_SQL",
    "PACKAGE_EVENT_TYPES",
    "PACKAGE_STATUSES",
    "SCAN_RESULTS",
    "TERMINAL_PACKAGE_STATUSES",
    "OrderPackage",
    "OrderPackageItem",
    "PackageScanEvent",
    "ReturnStatus",
    "ReturnType",
    "ReturnRefundStatus",
    "SellerType",
    "StockNotification",
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
    # İP-16 — aralıklı tekrar (FSRS)
    "SrsCard",
    "SrsDeck",
    "SrsDeckAssignment",
    "SrsNote",
    "SrsNoteTag",
    "SrsProgress",
    "SrsReviewLog",
    "SrsTag",
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
    "PhoneOtp",
    "NameChangeRequest",
]
